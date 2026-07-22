import { enableMapSet } from "immer";
import { type StoreApi, type UseBoundStore, create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { artifactBus, publishArtifactTransitions } from "../runtime/events/artifacts";
import {
  ACCIDENTAL_SLIP_DRIP_PER_CONVERSATION,
  CALLING_CARD_DECLINE_AFFECTION_PENALTY,
  CONVERSATION_HISTORY_LIMIT_PER_PAIR,
  DUEL_DEMAND_SATISFACTION_REPUTATION_COST,
  FAUX_PAS_LOCK_DURATION_IN_TICKS,
  OPENER_TIMEOUT_MS,
  type StaffAssignment,
  type Stance,
  type Tactic,
  type WeaponizationBranch,
} from "./constants";
import {
  type ConversationFailure,
  type ConversationPairKey,
  type Exchange,
  makePairKey,
} from "./conversation/types";
import {
  type Betrothal,
  type CallingCard,
  type Character,
  CharacterSchema,
  type CourierPayload,
  type Duel,
  type FlavorContentEntry,
  type ForgeryRecord,
  type GameState,
  GameStateSchema,
  type GlobalEvent,
  type Grievance,
  type House,
  HouseSchema,
  type MarriageRecord,
  MarriageRecordSchema,
  type PatronessRecord,
  type RivalActorState,
  type Scheme,
  type StaffMember,
  type Whisper,
} from "./entities";
import { type ArtifactDefinition, resolveArtifactDefinition } from "./fixtures/artifacts";
import { makeDuelId } from "./fixtures/duelIdFactory";
import { FACTION_PAIRS } from "./fixtures/factions";
import type { LocationId } from "./fixtures/locations";
import { PATRONESSES_FIXTURE } from "./fixtures/patronesses";
import {
  type ArtifactDefinitionId,
  type ArtifactInstanceId,
  type BallSessionId,
  type BetrothalId,
  type CallingCardId,
  type CharacterId,
  type CourierPayloadId,
  type DuelId,
  type ElopementId,
  type FactionPairKey,
  type FlavorContentId,
  type ForgeryId,
  type GlobalEventId,
  type GrievanceId,
  type HouseId,
  INDEPENDENT_HOUSE_ID,
  type MarriageId,
  PLAYER_HOUSE_ID,
  type PatronessId,
  type RngState,
  type SchemeId,
  type StaffId,
  type ThiefAttemptId,
  type TraitId,
  type WhisperId,
  createRngState,
} from "./rng";
import {
  applyCommissionForgeryPure,
  applyEquipArtifactPure,
  applyPreBallComposurePenaltyPure,
  applyThwartTheftPure,
  applyUnequipArtifactPure,
  getEffectiveTraits,
} from "./rules/artifacts";
import type {
  CommissionRejection,
  EquipRejection,
  ThwartRejection,
  UnequipRejection,
} from "./rules/artifacts";
import { applyBankruptcyEscape, canEscapeBankruptcy } from "./rules/bankruptcyEscape";
import type { EscapeRejection } from "./rules/bankruptcyEscape";
import { resolveCombat } from "./rules/combat";
import { resolveDuel } from "./rules/duel";
import { applyResearchFastCouriers } from "./rules/globalEvents";
import { type AudienceOutcome, applyAudience } from "./rules/monarchsAudience";
import {
  type CancelSchemeRejection,
  type StartSchemeInput,
  type StartSchemeRejection,
  cancelScheme as cancelSchemePure,
  tryStartScheme,
} from "./rules/schemes";
import {
  type AssignStaffRejection,
  type FireStaffRejection,
  type HireStaffRejection,
  type SpymasterInterceptRejection,
  fireStaff as fireStaffPure,
  hireStaff as hireStaffPure,
  tryAssignStaff,
  trySpymasterMailIntercept,
} from "./rules/staff";
import { type PromoteStaffRejection, promoteStaffToCharacter } from "./rules/staffPromotion";
import { applyTravel, canTravel } from "./rules/travel";
import type { TravelRejection } from "./rules/travel";
import { applyWardrobeRefresh, canRefreshWardrobe } from "./rules/wardrobeRefresh";
import type { WardrobeRejection } from "./rules/wardrobeRefresh";
import {
  type DismissWhisperRejection,
  type WeaponizeWhisperRejection,
  dismissWhisper as dismissWhisperPure,
  generateSynergyWhisper,
  generateWhisperCourier,
  ingestLlmAdditiveWhisper,
  pickWallflowerBonusSubject,
  tryWeaponizeWhisper,
} from "./rules/whispers";
import { clamp } from "./util/clamp";
import { getHouseOrThrow } from "./util/lookups";

// Re-exports for convenience: existing call sites import entity types and
// GameState/GameStateSchema from store.ts (P0-era code path). New consumers
// should prefer importing from game/entities directly; both work.
export type { Character, GameState, House, MarriageRecord };
export { CharacterSchema, GameStateSchema, HouseSchema, MarriageRecordSchema };

// P2: default campaign name written into every new save. Lives here
// (not in game/constants.ts) because it's an initialization string,
// not a designer-tuned gameplay value.
export const DEFAULT_CAMPAIGN_NAME = "Unnamed Campaign";

// Immer needs explicit opt-in for Map/Set mutation tracking.
enableMapSet();

// Bootstrap helper. Imported by createInitialState (game-store) and by the
// migration (persist/migrations/v1-to-v2.ts). Lives in src/game/bootstrap.ts
// so the dependency direction is persist → game, not the inverse.
// (Import path is direct; not cyclic because bootstrap.ts only imports from
// rng.ts + fixtures + constants.)
import {
  bootstrapNonPlayerArtifactsForInit,
  bootstrapNpcMountFamily,
  bootstrapPlayerArtifactsForInit,
  seedStartingFamily,
} from "./bootstrap";

export function createInitialState(
  seed: string,
  campaignName: string = DEFAULT_CAMPAIGN_NAME,
): GameState {
  const playerRng = createRngState(seed);
  const seeded = seedStartingFamily(playerRng, seed);
  const rng = new Map<HouseId, RngState>();
  rng.set(PLAYER_HOUSE_ID, seeded.rngState);
  // P4: Independent's RNG state is deterministically derived from the
  // player seed. Required because applyMoodDriftPhase iterates every house
  // and calls getOrThrow(state.rng, houseId).
  rng.set(INDEPENDENT_HOUSE_ID, createRngState(`${seed}|independent`));
  // P8: 3 per-rival RNG entries. Same `${seed}|${rivalHouseId}` string-concat
  // form as Independent; mood drift + rival action both consume from these.
  for (const [rivalId, rivalRng] of seeded.rivalRngEntries) {
    rng.set(rivalId, rivalRng);
  }
  const houses = new Map<HouseId, House>();
  for (const h of seeded.houses) houses.set(h.id, h);
  const characters = new Map<CharacterId, Character>();
  for (const c of seeded.characters) characters.set(c.id, c);
  // P6: staff Map mirrors the houses/characters parallel-loop pattern;
  // populated from BASELINE_STAFF via seedStartingFamily.
  const staff = new Map<StaffId, StaffMember>();
  for (const s of seeded.staff) staff.set(s.id, s);
  // P8: patronesses, rivalActors, factionTensions, duels.
  const patronesses = new Map<PatronessId, PatronessRecord>();
  for (const p of PATRONESSES_FIXTURE) patronesses.set(p.id, p);
  const rivalActors = new Map<HouseId, RivalActorState>();
  for (const ra of seeded.rivalActors) rivalActors.set(ra.houseId, ra);
  const factionTensions = new Map<FactionPairKey, number>();
  for (const pair of FACTION_PAIRS) factionTensions.set(pair, 0);
  // P10: seed player starting artifact inventory. Mutates the `characters`
  // Map in-place (sets playerHead.equippedArtifactIds); returns the
  // artifactInstances Map for the literal below.
  const artifactInstances = bootstrapPlayerArtifactsForInit(characters, houses, 0);
  // P12: seed NPC mount-family equip on baseline NPCs (Lord Blackwood +
  // Miss Carrington). Mutates BOTH characters AND artifactInstances IN PLACE.
  // Runs AFTER bootstrapPlayerArtifactsForInit so the per-definitionId
  // counter for "mount" lands at 0 for the player head, 1+2 for NPCs.
  // Idempotent — second call is a no-op.
  bootstrapNpcMountFamily(characters, artifactInstances, 0);
  // P24b (E1): procedural artifact definitions generated by seedStartingFamily
  // from the transient sub-stream. Built into a Map for the literal below.
  const proceduralArtifactDefinitions = new Map<ArtifactDefinitionId, ArtifactDefinition>();
  for (const d of seeded.proceduralArtifactDefinitions) {
    proceduralArtifactDefinitions.set(d.id, d);
  }
  // P24b (E6): seed equipped procedural instances into rival + society houses
  // from the transient `${seed}|procedural-artifact-instances` stream. Mutates
  // `characters` + `artifactInstances` IN PLACE and populates `forgeries`. Runs
  // AFTER the procedural defs Map is built (it picks from those definitions).
  const forgeries = new Map<ForgeryId, ForgeryRecord>();
  bootstrapNonPlayerArtifactsForInit(
    characters,
    houses,
    proceduralArtifactDefinitions,
    artifactInstances,
    forgeries,
    seed,
    0,
  );
  return {
    tick: 0,
    rng,
    houses,
    characters,
    marriages: new Map<MarriageId, MarriageRecord>(),
    campaignName,
    era: "Earlier",
    // P4: empty per-pair-key collections on fresh state.
    conversationHistory: new Map<ConversationPairKey, Exchange[]>(),
    affectionMap: new Map<ConversationPairKey, number>(),
    // P5: empty scheme registry. Grievances ride inside House.grievances —
    // see seedStartingFamily for the empty-array defaults on player + Independent.
    schemes: new Map<SchemeId, Scheme>(),
    // P6: empty whisper/courier registries at fresh state; staff seeded from
    // BASELINE_STAFF above. Whispers and couriers are produced at runtime
    // (synergy hits, staff cadences, LLM-additive ingest).
    whispers: new Map<WhisperId, Whisper>(),
    couriers: new Map<CourierPayloadId, CourierPayload>(),
    staff,
    // P7: empty proposal/tutor logs + no pending tutor-trait choices at
    // fresh state. Populated at runtime by proposeMarriage / assignTutor /
    // applyMaturationStep / chooseTutorBonusTrait.
    proposalsLog: new Map(),
    tutorAssignmentsLog: new Map(),
    pendingTutorTraitChoices: new Map(),
    // P8: 5 patronesses, 3 rivalActors, 6 factionTensions (all 0), 0 duels.
    patronesses,
    rivalActors,
    factionTensions,
    duels: new Map<DuelId, Duel>(),
    // P9: no active sprint on fresh state. Mounted as a side-effect of
    // applySchemeResolutionPhase when a Seduction discovery roll lands true.
    elopements: new Map(),
    // P10: starting artifact inventory (3 instances, 2 equipped on the player
    // head). Forgeries and thiefAttempts start empty — these grow at runtime
    // via commissionForgery / applyThiefNoticePhase.
    artifactInstances,
    forgeries,
    thiefAttempts: new Map(),
    // P24b: procedural artifact definitions (generated at bootstrap; persisted).
    proceduralArtifactDefinitions,
    // P13: empty global events at fresh state. Events spawn via the slot-6
    // global-event roll (5%/tick); no seeding helper.
    globalEvents: new Map<GlobalEventId, GlobalEvent>(),
    // P18: empty flavor content at fresh state. Entries land at runtime via
    // flavorOrchestrator's success path (recordFlavorText); no seeding helper.
    flavorText: new Map<FlavorContentId, FlavorContentEntry>(),
    // P23: empty betrothal registry at fresh state. Entries land via
    // arrangeBetrothal; no seeding helper.
    betrothals: new Map<BetrothalId, Betrothal>(),
    // P26: empty calling-card registry at fresh state. Cards are minted by the
    // slot-8 applyCallingCardPhase per-tick roll; no seeding helper.
    callingCards: new Map<CallingCardId, CallingCard>(),
  };
}

// P4: input for sendBallroomMessage. UI builds this from form state.
export type BallroomMessageInput = {
  targetCharacterId: CharacterId;
  pinnedTactic: Tactic | null;
  stance: Stance;
  freeformMessage: string;
};

export type StoreActions = {
  advanceTick: () => void;
  runYearPass: () => void;
  replaceState: (next: GameState) => void;
  // P3 player-elected location actions. Each follows the pre-tick action
  // pattern: validate → mutate (pure rule) → advance tick (orchestrator) →
  // publish event. Rejections are returned as typed discriminated unions
  // (NOT thrown) so the UI can render reason-specific prose.
  travel: (to: LocationId) => { ok: true } | { ok: false; reason: TravelRejection };
  requestAudience: () => { outcome: AudienceOutcome };
  escapeBankruptcy: () => { ok: true } | { ok: false; reason: EscapeRejection };
  refreshWardrobe: () => { ok: true } | { ok: false; reason: WardrobeRejection };
  // P4 ballroom actions. enterBallroom/exitBallroom manage session state on
  // the orchestrator. sendBallroomMessage POSTs through the localhost proxy
  // at /api/llm/conversation (the proxy holds the Gemini key server-side).
  // All four return typed discriminated unions for UI prose rendering.
  enterBallroom: () =>
    | { ok: true; sessionId: BallSessionId; approachingCharacterId: CharacterId | null }
    | { ok: false; reason: BallEntryRejection };
  exitBallroom: (playerComposureAtExit: number) => void;
  sendBallroomMessage: (
    input: BallroomMessageInput,
  ) => Promise<
    { ok: true; outcome: ConversationResponse } | { ok: false; reason: ConversationFailure }
  >;
  abortBallroomRequest: () => void;
  // P5 scheme actions. startScheme and cancelScheme are FREE ACTIONS — they
  // do NOT advance the tick (unlike P3 pre-tick actions). The wealth cost
  // IS the cost; no tick consumed at start. Per CLAUDE.md non-negotiable §5:
  // validate → mutate (atomic). Rejections returned as typed unions.
  startScheme: (
    input: StartSchemeInput,
  ) => { ok: true; schemeId: SchemeId } | { ok: false; reason: StartSchemeRejection };
  cancelScheme: (schemeId: SchemeId) => { ok: true } | { ok: false; reason: CancelSchemeRejection };
  // P6 espionage actions. All FREE ACTIONS — no tick advance. Per
  // CLAUDE.md non-negotiable §5: validate → mutate atomic; rejection
  // unions include { kind: "PlayerExiled" } gated at the action top.
  weaponizeWhisper: (
    whisperId: WhisperId,
    branch: WeaponizationBranch,
  ) => { ok: true } | { ok: false; reason: WeaponizeWhisperRejection };
  dismissWhisper: (
    whisperId: WhisperId,
  ) => { ok: true } | { ok: false; reason: DismissWhisperRejection };
  assignStaff: (
    staffId: StaffId,
    newAssignment: StaffAssignment,
  ) => { ok: true } | { ok: false; reason: AssignStaffRejection };
  spymasterIntercept: () => { ok: true } | { ok: false; reason: SpymasterInterceptRejection };
  // P24c: staff network lifecycle (free actions; direct-publish their own events).
  hireStaff: () => { ok: true; staffId: StaffId } | { ok: false; reason: HireStaffRejection };
  fireStaff: (staffId: StaffId) => { ok: true } | { ok: false; reason: FireStaffRejection };
  promoteStaff: (
    staffId: StaffId,
  ) => { ok: true; characterId: CharacterId } | { ok: false; reason: PromoteStaffRejection };
  // P7 family actions. proposeMarriage is tick-advancing (pre-tick action
  // pattern). assignTutor and chooseTutorBonusTrait are FREE actions.
  proposeMarriage: (targetCharacterId: CharacterId) => ProposalOutcome;
  assignTutor: (
    childCharacterId: CharacterId,
    tutorCharacterId: CharacterId,
  ) => { ok: true; reassignmentCount: number } | { ok: false; reason: AssignTutorRejection };
  chooseTutorBonusTrait: (
    childCharacterId: CharacterId,
    chosenTraitId: TraitId,
  ) => { ok: true } | { ok: false; reason: ChooseTutorBonusTraitRejection };
  // P23: pre-adulthood betrothals. Both FREE actions (no tick advance) — mirror
  // assignTutor's modal-state gate shape. arrange direct-publishes
  // BetrothalArranged; break direct-publishes BetrothalBroken.
  arrangeBetrothal: (
    partyAId: CharacterId,
    partyBId: CharacterId,
  ) => { ok: true; betrothalId: BetrothalId } | { ok: false; reason: ArrangeBetrothalRejection };
  breakBetrothal: (
    betrothalId: BetrothalId,
  ) => { ok: true } | { ok: false; reason: BreakBetrothalRejection };
  // P24a (C3, Q25): deliberate marriage dissolution. Free action; modal-state
  // gated. Reuses MarriageDissolved (deceasedSpouseId: null) on publish.
  abandonMarriage: (marriageId: MarriageId) =>
    | { ok: true }
    | {
        ok: false;
        reason:
          | AbandonMarriageRejection
          | { kind: "PlayerExiled" }
          | { kind: "ElopementInProgress" };
      };
  // P8: demand-satisfaction → duel. Free action (no tick advance). Reads the
  // grievance from the player's house (only the player can demand satisfaction
  // at v1 — rival-perpetrated grievances live on PLAYER_HOUSE_ID's grievances
  // array). Returns the resolved duel's id + outcome on success.
  demandSatisfaction: (
    perpetratorHouseId: HouseId,
    grievanceId: GrievanceId,
  ) =>
    | { ok: true; duelId: DuelId; outcome: import("./entities").DuelOutcome }
    | { ok: false; reason: DemandSatisfactionRejection };
  // P9/P24a elopement sprint actions. Free actions — no tick advance. Keyed by
  // ElopementId (the player may have concurrent sprints). The only mutations
  // allowed while a player sprint is active. push/freshHorses mutate tile
  // positions; surrender always loses; setElopementAbandonOnWin toggles the
  // dissolve-then-mint-on-win flag (C3).
  elopementPush: (
    id: ElopementId,
  ) => { ok: true } | { ok: false; reason: ElopementActionRejection };
  elopementFreshHorses: (
    id: ElopementId,
  ) => { ok: true } | { ok: false; reason: ElopementFreshHorsesRejection };
  elopementSurrender: (
    id: ElopementId,
  ) => { ok: true } | { ok: false; reason: ElopementActionRejection };
  setElopementAbandonOnWin: (id: ElopementId, abandonOnWin: boolean) => void;
  // P10 artifact actions. All FREE ACTIONS — no tick advance. Modal-state
  // gates (PlayerExiled + ElopementInProgress) included in every rejection
  // union per CLAUDE.md "Modal-state rule-layer gate principle."
  equipArtifact: (
    characterId: CharacterId,
    artifactInstanceId: ArtifactInstanceId,
  ) => { ok: true } | { ok: false; reason: EquipRejection };
  unequipArtifact: (
    characterId: CharacterId,
    artifactInstanceId: ArtifactInstanceId,
  ) => { ok: true } | { ok: false; reason: UnequipRejection };
  commissionForgery: (
    forgerCharacterId: CharacterId,
    definitionId: ArtifactDefinitionId,
  ) => { ok: true; forgeryId: ForgeryId } | { ok: false; reason: CommissionRejection };
  thwartTheft: (
    thiefAttemptId: ThiefAttemptId,
  ) => { ok: true; outcome: "Thwarted" | "Stolen" } | { ok: false; reason: ThwartRejection };
  // P13: research fast couriers. Free action (no tick advance). Gated on
  // era === "Later" + !house.courierResearchEarned + wealth >= cost +
  // modal-state gates (PlayerExiled / ElopementInProgress). Deducts wealth +
  // flips the latch; direct-publishes CourierResearchUnlocked on globalEventBus.
  researchFastCouriers: () =>
    | { ok: true }
    | { ok: false; reason: import("./rules/globalEvents").ResearchFastCouriersRejection };
  // P11: reconcile a sibling-rival. Pre-tick action (advances the tick on
  // ok:true paths — Success + Failure). Costs `SIBLING_RIVAL_RECONCILIATION_WEALTH_COST`
  // wealth + `_REPUTATION_COST` reputation regardless of outcome. Roll for
  // success scales inversely with hostility. Failure bumps hostility by
  // `SIBLING_RIVAL_HOSTILITY_PER_FAILED_RECONCILIATION` (clamped). Success
  // flips `reconciled: true` AND `hostility: 0`.
  reconcileSibling: (
    siblingCharacterId: CharacterId,
  ) =>
    | { ok: true }
    | { ok: false; reason: import("./rules/siblingRivals").ReconciliationRejection };
  // P12 promenade actions. enterPromenade/exitPromenade manage session
  // state on the orchestrator (in-memory). sendPromenadeMessage POSTs
  // through the same proxy at /api/llm/conversation with mode="Promenade".
  // exitPromenade ADVANCES THE TICK (commit-on-leave) and fires the full
  // 10-publisher set per CLAUDE.md "10/10/9 publisher set across store
  // wrappers". The other three are session-management; they do NOT tick.
  enterPromenade: () =>
    | {
        ok: true;
        sessionId: import("./rng").PromenadeSessionId;
        partnerCharacterId: CharacterId;
      }
    | { ok: false; reason: import("./rules/promenade").PromenadeEntryRejection };
  exitPromenade: () => void;
  sendPromenadeMessage: (
    input: PromenadeMessageInput,
  ) => Promise<
    { ok: true; outcome: ConversationResponse } | { ok: false; reason: ConversationFailure }
  >;
  abortPromenadeRequest: () => void;
  // P26: NPC-initiated calling-card actions (Q14). Accept opens a Visit
  // session (drawing-room call); decline marks the card + applies a small
  // affection penalty. Both are free actions (no tick advance) with the modal
  // gates. exitVisit is the tick-on-exit (commit-on-leave) close, mirroring
  // exitPromenade. sendVisitMessage mirrors sendPromenadeMessage.
  acceptCallingCard: (
    cardId: CallingCardId,
  ) =>
    | { ok: true; sessionId: import("./rng").VisitSessionId }
    | { ok: false; reason: CallingCardActionRejection };
  declineCallingCard: (
    cardId: CallingCardId,
  ) => { ok: true } | { ok: false; reason: CallingCardActionRejection };
  exitVisit: () => void;
  sendVisitMessage: (
    input: PromenadeMessageInput,
  ) => Promise<
    { ok: true; outcome: ConversationResponse } | { ok: false; reason: ConversationFailure }
  >;
  abortVisitRequest: () => void;
  // P26: append an NPC-authored opener line (Q14, NPC speaks first) to the
  // (player, target) conversation history. Free action: no tick, no publishers
  // (interactive-only LLM append, same class as a normal exchange). Staleness-
  // guarded: no-ops when the requesting session is no longer current (CLAUDE.md
  // rule #7). Called ONLY from the fire-and-forget opener round-trip.
  recordNpcOpener: (
    sessionId: BallSessionId | VisitSessionId,
    targetCharacterId: CharacterId,
    text: string,
  ) => void;
  // P18: persist one generated flavor entry. Called ONLY from the
  // flavorOrchestrator success path (never a UI affordance). Free action:
  // no tick advance, no publisher fan-out, no modal-state gate (a conscious
  // divergence from the P9 free-action-gate pin — the write is additive keyed
  // text with no gameplay effect, so landing it during exile/elopement is
  // harmless). No-op if the id is already present (honors "produced at most
  // once" even against a race past ensureFlavor's check).
  recordFlavorText: (entry: FlavorContentEntry) => void;
  // P18: trigger NPC-bio generation when the player opens an NPC's "Who is
  // this?" expander (the deliberate reveal — NOT gated behind a conversation).
  // Fire-and-forget + flag-gated inside ensureFlavor (inert in tests/replay);
  // idempotent (no-op if already persisted / in flight). Skips player-house
  // characters (bios are for ballroom NPCs).
  revealNpcBio: (characterId: CharacterId) => void;
};

// P12: input shape for sendPromenadeMessage. Differs from BallroomMessageInput
// in that pinnedTactic is ALWAYS one of the 3 promenade tactics (the UI has
// no "freely classify" affordance — every player message comes with a pinned
// promenade-tactic button click).
export type PromenadeMessageInput = {
  freeformMessage: string;
  pinnedTactic: "WittyBanter" | "DeepEmpathy" | "ComplimentMount";
  // P26 (H1): the promenade stance. Only "Mingle" enables the mount bonus. The
  // Visit UI (no stance toggle) always passes "Mingle".
  stance: Stance;
};

// P26: rejection union for acceptCallingCard / declineCallingCard. Includes
// the standard modal-gate variants (per CLAUDE.md: every new player action's
// rejection union must carry PlayerExiled + ElopementInProgress).
export type CallingCardActionRejection =
  | { kind: "PlayerExiled" }
  | { kind: "ElopementInProgress" }
  | { kind: "CardNotPending" }
  | { kind: "CallerDead" }
  | { kind: "SessionAlreadyOpen" };

export type DemandSatisfactionRejection =
  | { kind: "GrievanceNotFound" }
  | { kind: "GrievanceAlreadyResolved" }
  | { kind: "LegacyGrievanceUnactionable" }
  | { kind: "ChallengerDead" }
  | { kind: "DefenderDead" }
  | { kind: "DefenderExiled" }
  | { kind: "PlayerExiled" }
  | { kind: "ElopementInProgress" };

export type StoreState = GameState & StoreActions;

export type SeasonStore = UseBoundStore<StoreApi<StoreState>>;

import {
  type AbandonMarriageRejection,
  applyAbandonMarriagePure,
} from "../game/rules/abandonMarriage";
import {
  type ArrangeBetrothalRejection,
  type BreakBetrothalRejection,
  applyArrangeBetrothalPure,
  applyBreakBetrothalPure,
} from "../game/rules/betrothal";
// P7 imports.
// P9 elopement imports.
import {
  type ElopementActionRejection,
  type ElopementFreshHorsesRejection,
  applyElopementFreshHorsesPure,
  applyElopementPushPure,
  applyElopementSurrenderPure,
  hasActivePlayerElopement,
  setElopementAbandonOnWin,
} from "../game/rules/elopement";
import { type ProposalOutcome, applyProposalPure } from "../game/rules/proposal";
import {
  type AssignTutorRejection,
  type ChooseTutorBonusTraitRejection,
  applyAssignTutorPure,
  applyChooseTutorBonusTraitPure,
} from "../game/rules/tutor";
import { fetchOpener } from "../llm/opener";
import type { ConversationResponse, OpenerRequest } from "../llm/types";
import { conversationOrchestrator } from "../runtime/conversationOrchestrator";
import {
  conversationBus,
  publishCallingCardTransitions,
  publishCharacterDeaths,
} from "../runtime/events/conversation";
import type { BallEntryRejection } from "../runtime/events/conversation";
import { duelBus } from "../runtime/events/duels";
import { publishDynastyPerkAwards } from "../runtime/events/dynastyLegacy";
import { elopementBus, publishElopementTransitions } from "../runtime/events/elopement";
import {
  familyBus,
  publishArchetypeReclassificationsFromSuccession,
  publishBetrothalTransitions,
  publishChildMaturationTransitions,
  publishMarriageTransitions,
  publishTemptationLatchTransitions,
} from "../runtime/events/family";
import { globalEventBus, publishGlobalEventTransitions } from "../runtime/events/globalEvent";
import {
  publishBloodFeudTransitions,
  publishInheritedSecretTransitions,
} from "../runtime/events/inheritedSecret";
import { locationBus } from "../runtime/events/location";
import { publishSchemeTransitions, schemeBus } from "../runtime/events/scheme";
import { publishSiblingRivalTransitions, siblingRivalBus } from "../runtime/events/siblingRival";
import { publishWhisperTransitions, whisperBus } from "../runtime/events/whispers";
// P18: importing flavorOrchestrator registers its bus subscriptions (NPC bio +
// scandal column) at module load; bindFlavorStore wires the state accessor;
// ensureFlavor is called from equipArtifact (artifact backstory trigger).
import { bindStore as bindFlavorStore, ensureFlavor } from "../runtime/flavorOrchestrator";
// P17: importing semanticIndex registers its bus subscriptions (indexing) at
// module load; bindStore wires the state accessor; retrieve runs the read path.
import {
  bindStore as bindSemanticIndexStore,
  retrieve as retrieveSemanticHits,
} from "../runtime/semanticIndex";
// Re-import here at the bottom of the file (cycle-avoidance pattern) — the
// runtime layer imports rules layer, which is OK after store.ts symbols
// have been declared above.
import { advanceTickPure } from "../runtime/tickOrchestrator";
import { runYearPassPure } from "../runtime/yearPass";
import type { PromenadeSessionId, VisitSessionId } from "./rng";
import { computeKeyMoment } from "./rules/keyMoments";
// P12 promenade imports. bootstrapNpcMountFamily is imported with the rest
// of bootstrap.ts at the top (line 134); rules-side helpers live here.
import {
  type PromenadeEntryRejection,
  appendPromenadeExchange,
  canEnterPromenade,
  characterEquipsMountFamily,
  narrowToPromenadeTactic,
  pickPromenadePartner,
  playerHeadEquipsMountFamily,
  resolvePromenadeCombat,
  rollBallroomApproach,
} from "./rules/promenade";
import { applyReconciliationAttempt } from "./rules/siblingRivals";

// P26 (Q14): fire-and-forget NPC opener round-trip. Builds the persona snapshot
// from current state, requests a short opening line from the proxy, and appends
// it via recordNpcOpener (which staleness-guards the session). Any failure
// degrades silently (the conversation opens with no opener line). The
// `typeof fetch` guard keeps it inert in non-browser envs without a fetch stub.
async function fireNpcOpener(
  readState: () => StoreState,
  targetCharacterId: CharacterId,
  sessionId: BallSessionId | VisitSessionId,
  approachContext: "Ballroom" | "Visit",
): Promise<void> {
  if (typeof fetch !== "function") return;
  const state = readState();
  const target = state.characters.get(targetCharacterId);
  if (target === undefined) return;
  let targetMarriage: MarriageRecord | null = null;
  let spouse: Character | null = null;
  if (target.marriageId !== null) {
    const m = state.marriages.get(target.marriageId);
    if (m !== undefined) {
      targetMarriage = m;
      if (!m.dissolved) {
        const spouseId = m.spouseAId === target.id ? m.spouseBId : m.spouseAId;
        spouse = state.characters.get(spouseId) ?? null;
      }
    }
  }
  const pairKey = makePairKey(PLAYER_HOUSE_ID, targetCharacterId);
  const history = (state.conversationHistory.get(pairKey) ?? []).map((ex) => ({
    speaker: ex.speaker,
    text: ex.text,
  }));
  const request: OpenerRequest = {
    characterStateSnapshot: {
      target: {
        ...target,
        traits: getEffectiveTraits(state, targetCharacterId),
        equippedArtifactIds: [...target.equippedArtifactIds],
      },
      targetMarriage,
      spouse,
    },
    history,
    approachContext,
  };
  try {
    const text = await fetchOpener(request, AbortSignal.timeout(OPENER_TIMEOUT_MS));
    readState().recordNpcOpener(sessionId, targetCharacterId, text);
  } catch {
    // Silent degrade — no opener line (spec §5 failure behavior).
  }
}

// Apply a full GameState swap to the immer draft. Used by every store
// action that produces a new GameState via pure rules + orchestrator.
function overwriteFromGameState(draft: GameState, next: GameState): void {
  draft.tick = next.tick;
  draft.rng = next.rng;
  draft.houses = next.houses;
  draft.characters = next.characters;
  draft.marriages = next.marriages;
  draft.campaignName = next.campaignName;
  draft.era = next.era;
  // P4 additions — pair-keyed collections shared by the orphan-prune
  // cascade in aging.ts. Schema↔projection↔selector triple-sync gate
  // (schema-projection-selector-extension.test.ts) enforces this.
  draft.conversationHistory = next.conversationHistory;
  draft.affectionMap = next.affectionMap;
  // P5: scheme registry. Grievances ride inside `next.houses` — no
  // separate per-field write needed (handled by `draft.houses = next.houses`
  // above). The trip-wire test does NOT catch a missing `draft.schemes`
  // write — it only enforces schema/projection/selector keyset equality,
  // not the Immer-draft helper's writes. Without this line, every tick-
  // advancing action silently clears state.schemes.
  draft.schemes = next.schemes;
  // P6: whisper/courier/staff registries. Same "OFTEN-FORGOTTEN fourth
  // surface" trap as schemes — the schema-projection-selector trip-wire
  // only enforces top-level keyset equality across GameStateSchema /
  // hashableState / selectGameState; this helper is a write-side mirror,
  // not a projection. Without these three lines, every tick-advancing
  // action silently clears the new Maps. Exiled (the House field) rides
  // inside `next.houses` and is covered by the draft.houses write above.
  draft.whispers = next.whispers;
  draft.couriers = next.couriers;
  draft.staff = next.staff;
  // P7: proposalsLog, tutorAssignmentsLog, pendingTutorTraitChoices.
  // Same quad-sync fourth-surface — found via store.replace-state.test.ts
  // P7 it() blocks (the seeded entries were silently cleared by every
  // tick-advancing action prior to this fix).
  draft.proposalsLog = next.proposalsLog;
  draft.tutorAssignmentsLog = next.tutorAssignmentsLog;
  draft.pendingTutorTraitChoices = next.pendingTutorTraitChoices;
  // P8: 4 new top-level Maps (patronesses, rivalActors, factionTensions, duels).
  // Same fourth-surface trap as schemes (P5) and proposalsLog (P7) —
  // schema↔projection↔selector trip-wire enforces top-level keyset equality;
  // this helper is the write-side mirror. Without these four lines, every
  // tick-advancing action silently clears the new Maps.
  draft.patronesses = next.patronesses;
  draft.rivalActors = next.rivalActors;
  draft.factionTensions = next.factionTensions;
  draft.duels = next.duels;
  // P9 addition — the 5th surface of the quint-sync. Without this line, every
  // tick-advancing action silently CLEARS state.elopements.
  draft.elopements = next.elopements;
  // P10 additions — three new top-level Maps. Same "OFTEN-FORGOTTEN fourth
  // surface" trap; without these, every tick-advancing action silently clears
  // the artifact/forgery/thief-attempt registries.
  draft.artifactInstances = next.artifactInstances;
  draft.forgeries = next.forgeries;
  draft.thiefAttempts = next.thiefAttempts;
  // P24b addition — procedural artifact definitions Map. Without this line,
  // every tick-advancing action silently CLEARS state.proceduralArtifactDefinitions
  // (→ every artifact resolve falls back to the fixture registry only).
  draft.proceduralArtifactDefinitions = next.proceduralArtifactDefinitions;
  // P13 addition — global events Map. Without this line, every tick-advancing
  // action silently CLEARS state.globalEvents (critical because slot 6's
  // applyGlobalEventPhase mutates this Map every tick).
  draft.globalEvents = next.globalEvents;
  // P18 addition — generated flavor content. Without this line, every tick-
  // advancing action silently CLEARS state.flavorText (so a scandal column or
  // backstory recorded mid-campaign would vanish on the next tick).
  draft.flavorText = next.flavorText;
  // P23 addition — betrothal registry. Without this line, every tick-advancing
  // action silently CLEARS state.betrothals (so an arranged betrothal would
  // vanish on the next tick, and the auto-honor step would never fire).
  draft.betrothals = next.betrothals;
  // P26 addition — calling-card registry. Without this line, every tick-
  // advancing action silently CLEARS state.callingCards (so a minted card would
  // vanish on the next tick and the accept/decline affordances would never see
  // it). Slot-8 applyCallingCardPhase mutates this Map every tick.
  draft.callingCards = next.callingCards;
}

export function createStore({ seed }: { seed: string }): SeasonStore {
  const store = create<StoreState>()(
    immer((set, get) => ({
      ...createInitialState(seed),
      // P5: arrow→block-form refactor with `before` snapshot capture for
      // publishSchemeTransitions + publishCharacterDeaths diff helpers.
      // Both helpers fire per tick-advance — publishCharacterDeaths detects
      // Assassination kills (Active→alive=false in characters Map);
      // publishSchemeTransitions detects scheme status transitions and
      // grievance-array appends.
      advanceTick: () => {
        const exileGate = get();
        if (exileGate.houses.get(PLAYER_HOUSE_ID)?.exiled === true) {
          whisperBus.publish({
            kind: "PlayerExileBlocked",
            tick: exileGate.tick,
            action: "advanceTick",
          });
          return;
        }
        // P9 Q4 — ElopementInProgress gate. Void-publish to elopementBus.
        if (hasActivePlayerElopement(exileGate)) {
          elopementBus.publish({
            kind: "ElopementBlocked",
            tick: exileGate.tick,
            attemptedAction: "advanceTick",
          });
          return;
        }
        const before = get();
        const after = advanceTickPure(before);
        set((state) => {
          overwriteFromGameState(state, after);
        });
        publishCharacterDeaths(before, after);
        publishSchemeTransitions(before, after);
        publishWhisperTransitions(before, after);
        // P7: marriage dissolutions + temptation latch flips can fire from
        // tick phases (aging+orphan-prune for marriage dissolution via
        // Assassination; happiness-phase slot 8 for temptation latch).
        publishMarriageTransitions(before, after);
        publishBetrothalTransitions(before, after);
        publishTemptationLatchTransitions(before, after);
        // P9: applySchemeResolutionPhase can mount state.elopement on a
        // discovered Seduction. Diff helper publishes ElopementStarted on
        // the null → non-null transition. runYearPass does NOT call this
        // helper (year-pass STEPS doesn't include scheme resolution + Q4
        // gate blocks runYearPass when sprint already active).
        publishElopementTransitions(before, after);
        // P10: artifact-transition diff helper (ForgerySurfaced + ThiefNoticeFired
        // + TheftResolved). runYearPass skips this — year-pass STEPS doesn't
        // include the artifact phases.
        publishArtifactTransitions(before, after);
        // P11: 3 new publishers — sibling-rival (action phase + auto-reconciliation),
        // inherited-secret (surfacing), and blood-feud (open/resolved).
        publishSiblingRivalTransitions(before, after);
        publishInheritedSecretTransitions(before, after);
        publishBloodFeudTransitions(before, after);
        // P13: global-event transitions (EraTransitioned + GlobalEventStarted +
        // GlobalEventExpired). runYearPass omits this — year-pass STEPS doesn't
        // include applyGlobalEventPhase.
        publishGlobalEventTransitions(before, after);
        publishCallingCardTransitions(before, after);
        // P15: dynasty-perk awards (DynastyPerkAwarded) — rides every tick-
        // advancing wrapper including runYearPass (12/12/10 set).
        publishDynastyPerkAwards(before, after);
      },
      runYearPass: () => {
        const exileGate = get();
        if (exileGate.houses.get(PLAYER_HOUSE_ID)?.exiled === true) {
          whisperBus.publish({
            kind: "PlayerExileBlocked",
            tick: exileGate.tick,
            action: "runYearPass",
          });
          return;
        }
        // P9 Q4 gate, P24a-narrowed: only PLAYER-controlled sprints suspend
        // year-pass. Non-player sprints keep running, so death-cascade
        // Branch 5 IS reachable through runYearPass for them — the
        // elopement-transition diff helper rides below to surface those.
        if (hasActivePlayerElopement(exileGate)) {
          elopementBus.publish({
            kind: "ElopementBlocked",
            tick: exileGate.tick,
            attemptedAction: "runYearPass",
          });
          return;
        }
        const before = get();
        const after = runYearPassPure(before);
        set((state) => {
          overwriteFromGameState(state, after);
        });
        publishCharacterDeaths(before, after);
        // P6: runYearPassPure's applyAgingStep calls pruneOrphanedConversationKeys
        // which CAN flip whispers to Dismissed on subject death — distinct from
        // the P5 publishSchemeTransitions discipline (year-pass doesn't touch
        // schemes/grievances; runYearPass STILL skips publishSchemeTransitions).
        publishWhisperTransitions(before, after);
        // P7 — 6-publisher list for runYearPass. Maturation + succession
        // archetype-reclassify ride exclusively on runYearPass (they don't
        // fire from advanceTick because year-pass STEPS don't run inside
        // tick-advance). Marriage dissolutions (branch 3 of pruneOrphaned-
        // ConversationKeys) and temptation latch flips also fire here.
        publishMarriageTransitions(before, after);
        publishBetrothalTransitions(before, after);
        publishTemptationLatchTransitions(before, after);
        publishChildMaturationTransitions(before, after);
        publishArchetypeReclassificationsFromSuccession(before, after);
        // P11: year-pass is the accumulation site (succession step) AND the
        // promotion site (NEW STEPS slot 4). All three new publishers ride here.
        publishSiblingRivalTransitions(before, after);
        publishInheritedSecretTransitions(before, after);
        publishBloodFeudTransitions(before, after);
        // P24a: an aging-step death of a sprint participant flips a non-player
        // sprint resolved/Lost via death-cascade Branch 5 — publish it. No
        // double-publish risk: the interactive sprint actions direct-publish
        // and never run inside year-pass (player sprints gate year-pass above).
        publishElopementTransitions(before, after);
        // P15: dynasty-perk awards ride runYearPass too (the Patronage perk
        // awards at the year-pass terminal STEPS slot 6) — 12/12/10 set.
        publishDynastyPerkAwards(before, after);
      },
      replaceState: (next: GameState) => {
        // P12: defensive session-clear. The orchestrator's currentSession is
        // in-memory and would persist across a load if not explicitly cleared.
        // Without this, a post-load `currentMode() === "Promenade"` would
        // falsely block enterBallroom/enterPromenade via the cross-mode
        // SessionAlreadyOpen gate (the loaded GameState carries no session).
        // abortCurrent() handles the load-mid-fetch race.
        conversationOrchestrator.abortCurrent();
        conversationOrchestrator.endSession();
        set((state) => {
          overwriteFromGameState(state, next);
        });
      },
      travel: (to: LocationId) => {
        const stateBefore = get();
        if (stateBefore.houses.get(PLAYER_HOUSE_ID)?.exiled === true) {
          return { ok: false, reason: { kind: "PlayerExiled" as const } };
        }
        if (hasActivePlayerElopement(stateBefore)) {
          return { ok: false, reason: { kind: "ElopementInProgress" as const } };
        }
        const check = canTravel(stateBefore, PLAYER_HOUSE_ID, to);
        if (!check.ok) {
          locationBus.publish({
            kind: "TravelRejected",
            tick: stateBefore.tick,
            houseId: PLAYER_HOUSE_ID,
            target: to,
            reason: check.reason,
          });
          return { ok: false, reason: check.reason };
        }
        const from = getHouseOrThrow(stateBefore, PLAYER_HOUSE_ID).currentLocation;
        const afterTravel = applyTravel(stateBefore, PLAYER_HOUSE_ID, to);
        const afterTick = advanceTickPure(afterTravel);
        set((state) => {
          overwriteFromGameState(state, afterTick);
        });
        locationBus.publish({
          kind: "TraveledTo",
          tick: afterTick.tick,
          houseId: PLAYER_HOUSE_ID,
          from,
          to,
        });
        // P5 diff publishers — Assassination/scheme completions can land
        // during this travel's advanceTickPure phase chain.
        publishCharacterDeaths(stateBefore, afterTick);
        publishSchemeTransitions(stateBefore, afterTick);
        publishWhisperTransitions(stateBefore, afterTick);
        // P9 followup: P7 publisher-trio drift fix — marriage dissolutions
        // (aging orphan-prune branch 3) and temptation-latch flips
        // (happiness-drift phase slot 8) can both land during a P3 pre-tick
        // wrapper's advanceTickPure chain. CLAUDE.md "5/5/6 publisher trio"
        // claimed these fired on P3 wrappers but the calls were missing.
        publishMarriageTransitions(stateBefore, afterTick);
        publishBetrothalTransitions(stateBefore, afterTick);
        publishTemptationLatchTransitions(stateBefore, afterTick);
        // P9: applySchemeResolutionPhase can mount state.elopement on a
        // discovered Seduction during this wrapper's advanceTickPure chain.
        publishElopementTransitions(stateBefore, afterTick);
        publishArtifactTransitions(stateBefore, afterTick);
        // P11: 3 new publishers ride on this wrapper (10-publisher set).
        publishSiblingRivalTransitions(stateBefore, afterTick);
        publishInheritedSecretTransitions(stateBefore, afterTick);
        publishBloodFeudTransitions(stateBefore, afterTick);
        // P13: global-event transitions ride here too (every tick-advancing
        // wrapper except runYearPass per the 11/11/9 publisher set).
        publishGlobalEventTransitions(stateBefore, afterTick);
        publishCallingCardTransitions(stateBefore, afterTick);
        publishDynastyPerkAwards(stateBefore, afterTick);
        return { ok: true };
      },
      requestAudience: () => {
        const stateBefore = get();
        if (stateBefore.houses.get(PLAYER_HOUSE_ID)?.exiled === true) {
          const exiledOutcome: AudienceOutcome = {
            kind: "Denied",
            reason: { kind: "PlayerExiled" },
          };
          locationBus.publish({
            kind: "RequestedAudience",
            tick: stateBefore.tick,
            houseId: PLAYER_HOUSE_ID,
            outcome: exiledOutcome,
          });
          return { outcome: exiledOutcome };
        }
        // P9 Q4 — ElopementInProgress gate. requestAudience uses distinct
        // AudienceOutcome.Denied{ reason } shape (NOT generic ok/reason).
        if (hasActivePlayerElopement(stateBefore)) {
          const elopementOutcome: AudienceOutcome = {
            kind: "Denied",
            reason: { kind: "ElopementInProgress" },
          };
          locationBus.publish({
            kind: "RequestedAudience",
            tick: stateBefore.tick,
            houseId: PLAYER_HOUSE_ID,
            outcome: elopementOutcome,
          });
          return { outcome: elopementOutcome };
        }
        const { state: afterAudience, outcome } = applyAudience(stateBefore, PLAYER_HOUSE_ID);
        // Denied path: state unchanged; no tick advance per cost-paid-only-on-
        // success contract. Publish so UI can show the rejection toast.
        if (outcome.kind === "Denied") {
          locationBus.publish({
            kind: "RequestedAudience",
            tick: stateBefore.tick,
            houseId: PLAYER_HOUSE_ID,
            outcome,
          });
          return { outcome };
        }
        const afterTick = advanceTickPure(afterAudience);
        set((state) => {
          overwriteFromGameState(state, afterTick);
        });
        locationBus.publish({
          kind: "RequestedAudience",
          tick: afterTick.tick,
          houseId: PLAYER_HOUSE_ID,
          outcome,
        });
        publishCharacterDeaths(stateBefore, afterTick);
        publishSchemeTransitions(stateBefore, afterTick);
        publishWhisperTransitions(stateBefore, afterTick);
        // P9 followup: see travel wrapper for rationale (CLAUDE.md 5/5/6 pin).
        publishMarriageTransitions(stateBefore, afterTick);
        publishBetrothalTransitions(stateBefore, afterTick);
        publishTemptationLatchTransitions(stateBefore, afterTick);
        publishElopementTransitions(stateBefore, afterTick);
        publishArtifactTransitions(stateBefore, afterTick);
        // P11: 3 new publishers ride on this wrapper (10-publisher set).
        publishSiblingRivalTransitions(stateBefore, afterTick);
        publishInheritedSecretTransitions(stateBefore, afterTick);
        publishBloodFeudTransitions(stateBefore, afterTick);
        publishGlobalEventTransitions(stateBefore, afterTick);
        publishCallingCardTransitions(stateBefore, afterTick);
        publishDynastyPerkAwards(stateBefore, afterTick);
        return { outcome };
      },
      escapeBankruptcy: () => {
        const stateBefore = get();
        if (stateBefore.houses.get(PLAYER_HOUSE_ID)?.exiled === true) {
          return { ok: false, reason: { kind: "PlayerExiled" as const } };
        }
        if (hasActivePlayerElopement(stateBefore)) {
          return { ok: false, reason: { kind: "ElopementInProgress" as const } };
        }
        const check = canEscapeBankruptcy(stateBefore, PLAYER_HOUSE_ID);
        if (!check.ok) {
          locationBus.publish({
            kind: "BankruptcyEscapeRejected",
            tick: stateBefore.tick,
            houseId: PLAYER_HOUSE_ID,
            reason: check.reason,
          });
          return { ok: false, reason: check.reason };
        }
        const afterEscape = applyBankruptcyEscape(stateBefore, PLAYER_HOUSE_ID);
        const afterTick = advanceTickPure(afterEscape);
        set((state) => {
          overwriteFromGameState(state, afterTick);
        });
        locationBus.publish({
          kind: "EscapedBankruptcy",
          tick: afterTick.tick,
          houseId: PLAYER_HOUSE_ID,
        });
        publishCharacterDeaths(stateBefore, afterTick);
        publishSchemeTransitions(stateBefore, afterTick);
        publishWhisperTransitions(stateBefore, afterTick);
        // P9 followup: P7 publisher-trio drift fix — marriage dissolutions
        // (aging orphan-prune branch 3) and temptation-latch flips
        // (happiness-drift phase slot 8) can both land during a P3 pre-tick
        // wrapper's advanceTickPure chain. CLAUDE.md "5/5/6 publisher trio"
        // claimed these fired on P3 wrappers but the calls were missing.
        publishMarriageTransitions(stateBefore, afterTick);
        publishBetrothalTransitions(stateBefore, afterTick);
        publishTemptationLatchTransitions(stateBefore, afterTick);
        // P9: applySchemeResolutionPhase can mount state.elopement on a
        // discovered Seduction during this wrapper's advanceTickPure chain.
        publishElopementTransitions(stateBefore, afterTick);
        publishArtifactTransitions(stateBefore, afterTick);
        // P11: 3 new publishers ride on this wrapper (10-publisher set).
        publishSiblingRivalTransitions(stateBefore, afterTick);
        publishInheritedSecretTransitions(stateBefore, afterTick);
        publishBloodFeudTransitions(stateBefore, afterTick);
        // P13: global-event transitions ride here too (every tick-advancing
        // wrapper except runYearPass per the 11/11/9 publisher set).
        publishGlobalEventTransitions(stateBefore, afterTick);
        publishCallingCardTransitions(stateBefore, afterTick);
        publishDynastyPerkAwards(stateBefore, afterTick);
        return { ok: true };
      },
      refreshWardrobe: () => {
        const stateBefore = get();
        if (stateBefore.houses.get(PLAYER_HOUSE_ID)?.exiled === true) {
          return { ok: false, reason: { kind: "PlayerExiled" as const } };
        }
        if (hasActivePlayerElopement(stateBefore)) {
          return { ok: false, reason: { kind: "ElopementInProgress" as const } };
        }
        const check = canRefreshWardrobe(stateBefore, PLAYER_HOUSE_ID);
        if (!check.ok) {
          locationBus.publish({
            kind: "WardrobeRefreshRejected",
            tick: stateBefore.tick,
            houseId: PLAYER_HOUSE_ID,
            reason: check.reason,
          });
          return { ok: false, reason: check.reason };
        }
        const afterRefresh = applyWardrobeRefresh(stateBefore, PLAYER_HOUSE_ID);
        const afterTick = advanceTickPure(afterRefresh);
        set((state) => {
          overwriteFromGameState(state, afterTick);
        });
        locationBus.publish({
          kind: "RefreshedWardrobe",
          tick: afterTick.tick,
          houseId: PLAYER_HOUSE_ID,
        });
        publishCharacterDeaths(stateBefore, afterTick);
        publishSchemeTransitions(stateBefore, afterTick);
        publishWhisperTransitions(stateBefore, afterTick);
        // P9 followup: P7 publisher-trio drift fix — marriage dissolutions
        // (aging orphan-prune branch 3) and temptation-latch flips
        // (happiness-drift phase slot 8) can both land during a P3 pre-tick
        // wrapper's advanceTickPure chain. CLAUDE.md "5/5/6 publisher trio"
        // claimed these fired on P3 wrappers but the calls were missing.
        publishMarriageTransitions(stateBefore, afterTick);
        publishBetrothalTransitions(stateBefore, afterTick);
        publishTemptationLatchTransitions(stateBefore, afterTick);
        // P9: applySchemeResolutionPhase can mount state.elopement on a
        // discovered Seduction during this wrapper's advanceTickPure chain.
        publishElopementTransitions(stateBefore, afterTick);
        publishArtifactTransitions(stateBefore, afterTick);
        // P11: 3 new publishers ride on this wrapper (10-publisher set).
        publishSiblingRivalTransitions(stateBefore, afterTick);
        publishInheritedSecretTransitions(stateBefore, afterTick);
        publishBloodFeudTransitions(stateBefore, afterTick);
        // P13: global-event transitions ride here too (every tick-advancing
        // wrapper except runYearPass per the 11/11/9 publisher set).
        publishGlobalEventTransitions(stateBefore, afterTick);
        publishCallingCardTransitions(stateBefore, afterTick);
        publishDynastyPerkAwards(stateBefore, afterTick);
        return { ok: true };
      },
      // ── P4 ballroom actions ───────────────────────────────────────────
      enterBallroom: () => {
        const stateBefore = get();
        if (stateBefore.houses.get(PLAYER_HOUSE_ID)?.exiled === true) {
          return { ok: false, reason: { kind: "PlayerExiled" as const } };
        }
        if (hasActivePlayerElopement(stateBefore)) {
          return { ok: false, reason: { kind: "ElopementInProgress" as const } };
        }
        // P12/P26: cross-mode mutual exclusion. Reject if a Promenade OR Visit
        // session is already open. The orchestrator throws on misuse as
        // defense-in-depth, but the store-action layer gates first so the UI
        // sees a typed rejection rather than an exception.
        const openMode = conversationOrchestrator.currentMode();
        if (openMode === "Promenade" || openMode === "Visit") {
          return { ok: false, reason: { kind: "SessionAlreadyOpen" as const } };
        }
        const player = stateBefore.houses.get(PLAYER_HOUSE_ID);
        if (player === undefined || player.currentLocation !== "Capital") {
          return {
            ok: false,
            reason: {
              kind: "WrongLocation",
              current: player?.currentLocation ?? "Capital",
            } as const,
          };
        }
        // P26: the ballroom-approach roll fires only on a NEW session (not a
        // same-tick idempotent re-entry). Capture BEFORE beginSession, which
        // returns an id in both cases — keying the draw on its return would
        // double-draw on re-entry and desync the hash.
        const wasNoSession = conversationOrchestrator.currentSessionId() === null;
        // P10: apply pre-ball composure penalty for out-of-season equipped
        // artifacts BEFORE beginSession. Snapshot semantics: deduction
        // persists; mid-ball equip/unequip does NOT re-trigger.
        const stateAfterPenalty = applyPreBallComposurePenaltyPure(stateBefore);
        // P26: on a new session, roll whether an NPC approaches first (Q14).
        // The advanced player-rng MUST commit unconditionally (enterBallroom
        // otherwise commits only conditionally) so the draw isn't replayed.
        let committedState = stateAfterPenalty;
        let approachingCharacterId: CharacterId | null = null;
        if (wasNoSession) {
          const approach = rollBallroomApproach(stateAfterPenalty);
          committedState = approach.nextState;
          approachingCharacterId = approach.approachingCharacterId;
        }
        if (committedState !== stateBefore) {
          set((draft) => {
            overwriteFromGameState(draft, committedState);
          });
        }
        const sessionId = conversationOrchestrator.beginSession(get().tick);
        conversationBus.publish({
          kind: "BallroomEntered",
          tick: stateBefore.tick,
          houseId: PLAYER_HOUSE_ID,
          sessionId,
          approachingCharacterId,
        });
        // P26: if an NPC approached first, fire the opener round-trip.
        if (approachingCharacterId !== null) {
          void fireNpcOpener(get, approachingCharacterId, sessionId, "Ballroom");
        }
        return { ok: true, sessionId, approachingCharacterId };
      },
      exitBallroom: (playerComposureAtExit: number) => {
        // P12: cross-mode union — currentSessionId() returns BallSessionId |
        // PromenadeSessionId | null. exitBallroom defensively narrows on
        // currentMode() so a stray exitBallroom call against a Promenade
        // session is a no-op (the dispatch path should never reach this
        // branch — store-action layer routes to exitPromenade instead).
        if (conversationOrchestrator.currentMode() !== "Ballroom") return;
        const sessionId = conversationOrchestrator.currentSessionId() as BallSessionId | null;
        if (sessionId === null) return; // no-op if not in a session
        // Abort any in-flight conversation BEFORE committing composure.
        conversationOrchestrator.abortCurrent();
        const stateBefore = get();
        // Re-fetch playerHeadId at commit time (defense-in-depth against
        // future async-tick triggers).
        const playerHeadId = stateBefore.houses.get(PLAYER_HOUSE_ID)?.headOfHouseCharacterId;
        set((state) => {
          if (playerHeadId === undefined) return;
          const head = state.characters.get(playerHeadId);
          if (head === undefined) return;
          head.composure = clamp(playerComposureAtExit, 0, head.maxComposure);
        });
        conversationOrchestrator.endSession();
        conversationBus.publish({
          kind: "BallroomExited",
          tick: stateBefore.tick,
          houseId: PLAYER_HOUSE_ID,
          sessionId,
          finalPlayerComposure: playerComposureAtExit,
        });
      },
      sendBallroomMessage: async (input) => {
        const stateBefore = get();
        // Defensive — UI should never reach this without an open session.
        if (conversationOrchestrator.currentSessionId() === null) {
          return { ok: false, reason: { reason: "cancelled" } };
        }
        const target = stateBefore.characters.get(input.targetCharacterId);
        const playerHead = stateBefore.houses.get(PLAYER_HOUSE_ID);
        if (target === undefined || !target.alive || playerHead === undefined) {
          return { ok: false, reason: { reason: "cancelled" } };
        }
        const pairKey = makePairKey(PLAYER_HOUSE_ID, target.id);
        const history = stateBefore.conversationHistory.get(pairKey) ?? [];
        // P6: scene composition — lex-sorted living non-player non-target
        // NPCs so the persona prompt + generateWhisper toolCall validation
        // see deterministic ordering across replay-harness runs.
        const otherCharactersInScene = [...stateBefore.characters.values()]
          .filter((c) => c.alive && c.id !== target.id && c.houseId !== PLAYER_HOUSE_ID)
          .sort((a, b) => a.id.localeCompare(b.id));

        // P7.5: client extracts the persona-state snapshot here (resolving
        // spouse inline) so the server can rebuild the persona without
        // GameState access. Three marriage states pinned at
        // formatMarriageStatusLine in server/prompts/persona.ts.
        let targetMarriage: MarriageRecord | null = null;
        let spouse: Character | null = null;
        if (target.marriageId !== null) {
          const m = stateBefore.marriages.get(target.marriageId);
          if (m !== undefined) {
            targetMarriage = m;
            if (!m.dissolved) {
              const spouseId = m.spouseAId === target.id ? m.spouseBId : m.spouseAId;
              spouse = stateBefore.characters.get(spouseId) ?? null;
            }
          }
        }

        // P17: retrieve semantic-memory hits BEFORE the request build. Inert
        // ([] ) when semantic memory is disabled or on any failure (recency-only,
        // spec §7 line 657). Awaited here, so its budget is additive to the
        // round-trip — see EMBED_RETRIEVAL_TIMEOUT_MS.
        const semanticContext = await retrieveSemanticHits(target.id, input.freeformMessage);

        const request = {
          targetCharacterId: target.id,
          playerHouseId: PLAYER_HOUSE_ID,
          freeformMessage: input.freeformMessage,
          history,
          otherCharactersInScene,
          characterStateSnapshot: {
            // P10: shallow-clone target so the effective-traits projection
            // does NOT mutate state.characters. Also defensive-clone the
            // equippedArtifactIds array for future-phase reads. The persona
            // prompt at server/prompts/persona.ts reads `target.traits` —
            // the effective union (persistent + equipped grants) ships here.
            target: {
              ...target,
              traits: getEffectiveTraits(stateBefore, target.id),
              equippedArtifactIds: [...target.equippedArtifactIds],
            },
            targetMarriage,
            spouse,
          },
          // P12: ballroom mode framing. The Zod schema's `.default("Ballroom")`
          // would supply this on parse, but emitting explicitly avoids the
          // pre-parse construction-vs-parse asymmetry.
          mode: "Ballroom" as const,
          semanticContext,
          keyMoment: computeKeyMoment(stateBefore, target.id),
        };

        // Publish ConversationSent BEFORE awaiting the LLM (per
        // bus-publishing discipline — fires from store-action wrappers).
        conversationBus.publish({
          kind: "ConversationSent",
          tick: stateBefore.tick,
          pairKey,
          tactic: input.pinnedTactic,
          stance: input.stance,
        });

        const result = await conversationOrchestrator.send(request, input.pinnedTactic);
        if (result.kind === "Failed") {
          conversationBus.publish({
            kind: "ConversationFailed",
            tick: stateBefore.tick,
            pairKey,
            failure: result.failure,
          });
          return { ok: false, reason: result.failure };
        }
        const response = result.response;

        // Resolve combat synchronously via the pure rule.
        const outcome = resolveCombat({
          tactic: response.classifiedTactic,
          stance: input.stance,
          qualityMultiplier: response.qualityMultiplier,
          targetMood: target.mood,
          targetTraits: target.traits,
          isAgainstPinnedTarget: input.pinnedTactic !== null,
          // P26 (H4): gate the ComplimentMount tactic on the target's mount.
          targetHasMountFamilyEquipped: characterEquipsMountFamily(
            stateBefore,
            target.equippedArtifactIds,
          ),
        });

        // Build the two Exchange records.
        const playerExchange: Exchange = {
          speaker: "house-head",
          text: input.freeformMessage,
          classifiedTactic: response.classifiedTactic,
          tick: stateBefore.tick,
        };
        const npcExchange: Exchange = {
          speaker: "other",
          text: response.dialogue,
          classifiedTactic: null,
          tick: stateBefore.tick,
        };

        // Capture wasAlreadyLocked BEFORE the set body so the post-set
        // publish sees the pre-extension lock state.
        const wasAlreadyLocked = target.moodLockUntilTick > stateBefore.tick;
        const fauxPasFired = outcome.kind === "InstantFail";

        // P5: spec §3 line 122 — public faux-pas records a grievance against
        // the offending house. Build the Grievance BEFORE the set body so
        // (a) the index walks the pre-mutation state (avoids double-counting
        // the entry we're about to append), (b) the post-set bus publish has
        // a stable id to emit.
        //
        // Determinism: fauxPasIndexOnThisTick lex-sorts houses outer / walks
        // each house's grievances in insertion order inner. At P5 with single-
        // threaded ballroom + only Independent house holding grievances, the
        // index is always 0 — but the walk is forward-compatible for P8's
        // rival houses.
        //
        // sendBallroomMessage await-serialization dependency: this whole
        // function is single-flight via the conversationOrchestrator. If
        // React Strict Mode's double-effect or multi-tab use ever produced
        // two concurrent fauxPasFired branches, both would compute
        // fauxPasIndex=0 and the id would collide. The orchestrator's
        // single-flight contract is the load-bearing invariant.
        let fauxPasGrievance: Grievance | null = null;
        if (fauxPasFired) {
          let fauxPasIndex = 0;
          const sortedHouseIds = [...stateBefore.houses.keys()].sort();
          for (const hid of sortedHouseIds) {
            const grievances = stateBefore.houses.get(hid)?.grievances ?? [];
            for (const g of grievances) {
              if (g.source === "FauxPas" && g.recordedAtTick === stateBefore.tick) {
                fauxPasIndex += 1;
              }
            }
          }
          fauxPasGrievance = {
            id: `${PLAYER_HOUSE_ID}:FauxPas:${stateBefore.tick}:${fauxPasIndex}` as GrievanceId,
            perpetratorHouseId: PLAYER_HOUSE_ID,
            // P8: faux-pas grievance defendant is the player head — at v1 the
            // head is the only player-house character with ballroom-action
            // affordance. Player-perpetrated so demandSatisfaction would
            // reject as LegacyGrievanceUnactionable... wait, this is a NEW
            // post-P8 grievance — set the defendant explicitly per the plan.
            defendantCharacterId:
              stateBefore.houses.get(PLAYER_HOUSE_ID)?.headOfHouseCharacterId ?? null,
            source: "FauxPas",
            schemeId: null,
            recordedAtTick: stateBefore.tick,
            resolved: false,
          };
        }

        // Apply combat delta atomically in one set body. enableMapSet()
        // precondition already satisfied at this module's top.
        set((state) => {
          const t = state.characters.get(target.id);
          if (t !== undefined) {
            t.composure = clamp(t.composure + outcome.composureDelta, 0, t.maxComposure);
            if (fauxPasFired) {
              t.moodLockUntilTick = state.tick + FAUX_PAS_LOCK_DURATION_IN_TICKS;
              if (!wasAlreadyLocked) t.mood = "Defensive";
            } else if (response.moodHint !== null && t.moodLockUntilTick <= state.tick) {
              // Pure assignment, no PRNG draws. Within-tick conversation
              // overrides the prior year-pass mood-drift roll.
              t.mood = response.moodHint;
            }
          }
          // Affection — Map.set (NOT Map.get-as-lvalue).
          const affPrev = state.affectionMap.get(pairKey) ?? 0;
          state.affectionMap.set(pairKey, clamp(affPrev + outcome.affectionDelta, 0, 100));
          // Conversation history append + truncate.
          const hist = state.conversationHistory.get(pairKey) ?? [];
          const nextHist = [...hist, playerExchange, npcExchange].slice(
            -CONVERSATION_HISTORY_LIMIT_PER_PAIR,
          );
          state.conversationHistory.set(pairKey, nextHist);
          // P5: append FauxPas grievance to the target's house in-place.
          // Immer draft-mutation style matches the other mutations in this
          // set body (affectionMap.set, conversationHistory.set, character
          // field writes). Hash-relevant insertion order: append-at-end.
          if (fauxPasGrievance !== null) {
            const targetHouse = state.houses.get(target.houseId);
            if (targetHouse !== undefined) {
              targetHouse.grievances.push(fauxPasGrievance);
            }
          }

          // ─── P6: whisper-creation inline block ─────────────────────────
          // CRITICAL ordering: whisper creation runs BEFORE the AccidentalSlip
          // drip block (a same-tick weaponized AccidentalSlip whisper about
          // the conversation subject would otherwise drip on the JUST-created
          // synergy whisper if order were reversed — semantically inconsistent).
          //
          // The pure-rule functions (generateSynergyWhisper / pickWallflower
          // BonusSubject / ingestLlmAdditiveWhisper / generateWhisperCourier)
          // read state.whispers via makeWhisperId's index walk; the Immer
          // draft mutations (state.whispers.set / state.couriers.set) are
          // visible to subsequent calls within this producer body, so two
          // same-message whispers from the same source about different
          // subjects get distinct ids (the (source, subject) partition in
          // makeWhisperId increments per pair).
          if (outcome.kind === "Normal" && outcome.synergy) {
            // (1) Synergy whisper — source = target NPC, subject = target.
            const w = generateSynergyWhisper(state, target.id, target.id, state.tick);
            state.whispers.set(w.id, w);
            const c = generateWhisperCourier(state, w, "Capital", PLAYER_HOUSE_ID);
            state.couriers.set(c.id, c);
            // (2) Wallflower-bonus whisper — ONLY on Wallflower + SlyGossip
            // + synergy. Subject = lex-smallest non-target living non-player.
            if (input.stance === "Wallflower" && response.classifiedTactic === "SlyGossip") {
              const bonusSubject = pickWallflowerBonusSubject(state, target.id);
              if (bonusSubject !== null) {
                const wb = generateSynergyWhisper(state, target.id, bonusSubject.id, state.tick);
                state.whispers.set(wb.id, wb);
                const cb = generateWhisperCourier(state, wb, "Capital", PLAYER_HOUSE_ID);
                state.couriers.set(cb.id, cb);
              }
            }
          }
          // (3) LLM-additive whisper — survives three-predicate validation
          // (exists + not-target + not-player-house). Synergy not required.
          for (const tc of response.toolCalls) {
            if (tc.name !== "generateWhisper") continue;
            const subjectId = tc.args.subjectCharacterId as CharacterId;
            const subjChar = state.characters.get(subjectId);
            if (subjChar === undefined) continue;
            if (subjectId === target.id) continue;
            if (subjChar.houseId === PLAYER_HOUSE_ID) continue;
            const wL = ingestLlmAdditiveWhisper(state, target.id, subjectId, tc.args.text);
            state.whispers.set(wL.id, wL);
            const cL = generateWhisperCourier(state, wL, "Capital", PLAYER_HOUSE_ID);
            state.couriers.set(cL.id, cL);
          }

          // ─── P6: AccidentalSlip drip block ─────────────────────────────
          // Walks state.whispers for active Slips targeting the conversation
          // subject; applies -2 reputation to the subject's house per drip
          // AND decrements accidentalSlipDripsRemaining by 1. Pure-rule
          // mirror at applyAccidentalSlipDripOnConversation; this inlined
          // form must stay semantically identical (Vitest assertion).
          for (const [, w] of state.whispers) {
            if (
              w.status === "Weaponized" &&
              w.weaponizedAs === "AccidentalSlip" &&
              w.accidentalSlipDripsRemaining > 0 &&
              w.subjectCharacterId === target.id
            ) {
              const subjectHouse = state.houses.get(target.houseId);
              if (subjectHouse !== undefined) {
                subjectHouse.reputation = clamp(
                  subjectHouse.reputation + ACCIDENTAL_SLIP_DRIP_PER_CONVERSATION,
                  0,
                  100,
                );
              }
              w.accidentalSlipDripsRemaining -= 1;
            }
          }
        });

        // Publish AFTER set returns (per bus-publishing discipline).
        conversationBus.publish({
          kind: "ConversationResolved",
          tick: stateBefore.tick,
          pairKey,
          classifiedTactic: response.classifiedTactic,
          affectionDelta: outcome.affectionDelta,
          composureDelta: outcome.composureDelta,
          synergy: outcome.kind === "Normal" ? outcome.synergy : false,
          moodHint: response.moodHint,
        });
        if (fauxPasFired) {
          conversationBus.publish({
            kind: "FauxPasFired",
            tick: stateBefore.tick,
            targetCharacterId: target.id,
            lockUntilTick: stateBefore.tick + FAUX_PAS_LOCK_DURATION_IN_TICKS,
            wasAlreadyLocked,
          });
          // P5: spec §3 line 122 — emit GrievanceRecorded for the FauxPas
          // entry just appended to target's house. fauxPasGrievance is
          // non-null inside this branch by construction (computed in the
          // same `if (fauxPasFired)` block above).
          if (fauxPasGrievance !== null) {
            schemeBus.publish({
              kind: "GrievanceRecorded",
              tick: stateBefore.tick,
              grievanceId: fauxPasGrievance.id,
              perpetratorHouseId: PLAYER_HOUSE_ID,
              victimHouseId: target.houseId,
              source: "FauxPas",
            });
          }
        }
        // P6: publish WhisperCreated for any synergy / wallflower-bonus /
        // LLM-additive whispers emitted inside the set body's whisper-
        // creation block. The diff helper sees new ids in after.whispers
        // and emits WhisperCreated; no skip needed (sendBallroomMessage
        // doesn't direct-publish these).
        const afterMsg = get();
        publishWhisperTransitions(stateBefore, afterMsg);
        return { ok: true, outcome: response };
      },
      abortBallroomRequest: () => {
        conversationOrchestrator.abortCurrent();
      },
      // ── P5 scheme actions ─────────────────────────────────────────────
      // Free actions: NO advanceTickPure call. Starting a scheme is a
      // free action (wealth IS the cost); cancelling is a status flip
      // with no time cost. Publishers fire after set returns.
      startScheme: (input: StartSchemeInput) => {
        const state = get();
        if (state.houses.get(PLAYER_HOUSE_ID)?.exiled === true) {
          return { ok: false, reason: { kind: "PlayerExiled" as const } };
        }
        if (hasActivePlayerElopement(state)) {
          return { ok: false, reason: { kind: "ElopementInProgress" as const } };
        }
        const result = tryStartScheme(state, PLAYER_HOUSE_ID, input);
        if (!result.ok) return { ok: false, reason: result.reason };
        set((draft) => {
          overwriteFromGameState(draft, result.state);
        });
        const scheme = result.state.schemes.get(result.schemeId);
        if (scheme !== undefined) {
          schemeBus.publish({
            kind: "SchemeStarted",
            tick: result.state.tick,
            schemeId: result.schemeId,
            schemeKind: scheme.kind,
            ownerHouseId: PLAYER_HOUSE_ID,
            targetCharacterId: scheme.targetCharacterId,
            endsAtTick: scheme.endsAtTick,
          });
        }
        return { ok: true, schemeId: result.schemeId };
      },
      cancelScheme: (schemeId: SchemeId) => {
        const state = get();
        if (state.houses.get(PLAYER_HOUSE_ID)?.exiled === true) {
          return { ok: false, reason: { kind: "PlayerExiled" as const } };
        }
        if (hasActivePlayerElopement(state)) {
          return { ok: false, reason: { kind: "ElopementInProgress" as const } };
        }
        // P5 INVARIANT: cancellation ONLY mutates `status` + `resolvedAtTick`;
        // kind/owner/target fields unchanged. Reading from pre-set snapshot
        // is equivalent. If a future phase extends cancellation with
        // side-mutations (e.g., wealth rebate), switch to post-set reads.
        const cancelled = state.schemes.get(schemeId);
        const result = cancelSchemePure(state, schemeId);
        if (!result.ok) return { ok: false, reason: result.reason };
        set((draft) => {
          overwriteFromGameState(draft, result.state);
        });
        if (cancelled !== undefined) {
          schemeBus.publish({
            kind: "SchemeCancelled",
            tick: result.state.tick,
            schemeId,
            schemeKind: cancelled.kind,
            ownerHouseId: cancelled.ownerHouseId,
            targetCharacterId: cancelled.targetCharacterId,
            cancelSource: "Player",
          });
        }
        return { ok: true };
      },
      // ── P6 espionage actions ──────────────────────────────────────────
      weaponizeWhisper: (whisperId: WhisperId, branch: WeaponizationBranch) => {
        const before = get();
        if (before.houses.get(PLAYER_HOUSE_ID)?.exiled === true) {
          return { ok: false, reason: { kind: "PlayerExiled" as const } };
        }
        if (hasActivePlayerElopement(before)) {
          return { ok: false, reason: { kind: "ElopementInProgress" as const } };
        }
        // PINNED: ownerHouseId passed explicitly (PLAYER_HOUSE_ID at v1; P8
        // may extend to rival-owned whispers).
        const result = tryWeaponizeWhisper(before, PLAYER_HOUSE_ID, whisperId, branch);
        if (!result.ok) return { ok: false, reason: result.reason };
        set((draft) => {
          overwriteFromGameState(draft, result.state);
        });
        // Direct publish: wrapper owns the WhisperWeaponized event for this
        // whisperId. The diff helper below SKIPs via wrapperPublishedKeys.
        const weaponized = result.state.whispers.get(whisperId);
        if (weaponized !== undefined) {
          whisperBus.publish({
            kind: "WhisperWeaponized",
            tick: result.state.tick,
            whisperId,
            branch,
            subjectCharacterId: weaponized.subjectCharacterId,
            scandalSheetAttribution:
              branch === "ScandalSheet" ? weaponized.scandalSheetAttribution : null,
          });
          if (branch === "ScandalSheet" && weaponized.scandalSheetAttribution === true) {
            whisperBus.publish({
              kind: "PlayerExiled",
              tick: result.state.tick,
              reason: "ScandalSheetAttribution",
              whisperId,
            });
          }
        }
        // Diff helper picks up any other side effects (e.g., the ScandalSheet
        // RNG draw doesn't surface as an event; the wrapper-owned skip is
        // applied so we don't double-publish WhisperWeaponized).
        publishWhisperTransitions(before, result.state, new Set([`weaponize:${whisperId}`]));
        return { ok: true };
      },
      dismissWhisper: (whisperId: WhisperId) => {
        const before = get();
        if (before.houses.get(PLAYER_HOUSE_ID)?.exiled === true) {
          return { ok: false, reason: { kind: "PlayerExiled" as const } };
        }
        if (hasActivePlayerElopement(before)) {
          return { ok: false, reason: { kind: "ElopementInProgress" as const } };
        }
        const result = dismissWhisperPure(before, whisperId);
        if (!result.ok) return { ok: false, reason: result.reason };
        set((draft) => {
          overwriteFromGameState(draft, result.state);
        });
        whisperBus.publish({
          kind: "WhisperDismissed",
          tick: result.state.tick,
          whisperId,
        });
        publishWhisperTransitions(before, result.state, new Set([`dismiss:${whisperId}`]));
        return { ok: true };
      },
      assignStaff: (staffId: StaffId, newAssignment: StaffAssignment) => {
        const before = get();
        if (before.houses.get(PLAYER_HOUSE_ID)?.exiled === true) {
          return { ok: false, reason: { kind: "PlayerExiled" as const } };
        }
        if (hasActivePlayerElopement(before)) {
          return { ok: false, reason: { kind: "ElopementInProgress" as const } };
        }
        const fromAssignment = before.staff.get(staffId)?.assignment;
        const result = tryAssignStaff(before, staffId, newAssignment);
        if (!result.ok) return { ok: false, reason: result.reason };
        set((draft) => {
          overwriteFromGameState(draft, result.state);
        });
        if (fromAssignment !== undefined) {
          whisperBus.publish({
            kind: "StaffReassigned",
            tick: result.state.tick,
            staffId,
            from: fromAssignment,
            to: newAssignment,
          });
        }
        publishWhisperTransitions(before, result.state, new Set([`reassign:${staffId}`]));
        return { ok: true };
      },
      // ── P24c staff network lifecycle (free actions; direct-publish) ──────
      hireStaff: () => {
        const before = get();
        if (before.houses.get(PLAYER_HOUSE_ID)?.exiled === true) {
          return { ok: false, reason: { kind: "PlayerExiled" as const } };
        }
        if (hasActivePlayerElopement(before)) {
          return { ok: false, reason: { kind: "ElopementInProgress" as const } };
        }
        const result = hireStaffPure(before);
        if (!result.ok) return { ok: false, reason: result.reason };
        set((draft) => {
          overwriteFromGameState(draft, result.state);
        });
        whisperBus.publish({
          kind: "StaffHired",
          tick: result.state.tick,
          staffId: result.staffId,
        });
        return { ok: true, staffId: result.staffId };
      },
      fireStaff: (staffId: StaffId) => {
        const before = get();
        if (before.houses.get(PLAYER_HOUSE_ID)?.exiled === true) {
          return { ok: false, reason: { kind: "PlayerExiled" as const } };
        }
        if (hasActivePlayerElopement(before)) {
          return { ok: false, reason: { kind: "ElopementInProgress" as const } };
        }
        const result = fireStaffPure(before, staffId);
        if (!result.ok) return { ok: false, reason: result.reason };
        set((draft) => {
          overwriteFromGameState(draft, result.state);
        });
        whisperBus.publish({ kind: "StaffDismissed", tick: result.state.tick, staffId });
        return { ok: true };
      },
      promoteStaff: (staffId: StaffId) => {
        const before = get();
        if (before.houses.get(PLAYER_HOUSE_ID)?.exiled === true) {
          return { ok: false, reason: { kind: "PlayerExiled" as const } };
        }
        if (hasActivePlayerElopement(before)) {
          return { ok: false, reason: { kind: "ElopementInProgress" as const } };
        }
        const result = promoteStaffToCharacter(before, staffId);
        if (!result.ok) return { ok: false, reason: result.reason };
        set((draft) => {
          overwriteFromGameState(draft, result.state);
        });
        whisperBus.publish({
          kind: "StaffPromoted",
          tick: result.state.tick,
          staffId,
          characterId: result.characterId,
        });
        return { ok: true, characterId: result.characterId };
      },
      spymasterIntercept: () => {
        const before = get();
        if (before.houses.get(PLAYER_HOUSE_ID)?.exiled === true) {
          return { ok: false, reason: { kind: "PlayerExiled" as const } };
        }
        if (hasActivePlayerElopement(before)) {
          return { ok: false, reason: { kind: "ElopementInProgress" as const } };
        }
        const result = trySpymasterMailIntercept(before);
        if (!result.ok) return { ok: false, reason: result.reason };
        set((draft) => {
          overwriteFromGameState(draft, result.state);
        });
        // Determine which courier was intercepted (the diff between before
        // and after — exactly one InFlight → Intercepted transition).
        let interceptedId: string | null = null;
        for (const [cid, afterC] of result.state.couriers) {
          const beforeC = before.couriers.get(cid);
          if (
            beforeC !== undefined &&
            beforeC.status === "InFlight" &&
            afterC.status === "Intercepted"
          ) {
            interceptedId = cid;
            break;
          }
        }
        const wrapperKeys =
          interceptedId !== null ? new Set([`intercept:${interceptedId}`]) : new Set<string>();
        if (interceptedId !== null) {
          const intercepted = result.state.couriers.get(interceptedId as never);
          if (intercepted !== undefined) {
            whisperBus.publish({
              kind: "CourierIntercepted",
              tick: result.state.tick,
              courierId: intercepted.id,
              whisperId: intercepted.whisperId,
              source: "SpymasterAction",
            });
          }
        }
        publishWhisperTransitions(before, result.state, wrapperKeys);
        return { ok: true };
      },
      // ── P7 family actions ─────────────────────────────────────────────
      proposeMarriage: (targetCharacterId: CharacterId): ProposalOutcome => {
        const stateBefore = get();
        // Exile gate at the TOP per CLAUDE.md non-negotiable + P6 pattern.
        // Optional-chaining `?.exiled` matches the convention from existing
        // exile-gate publishes at store.ts.
        if (stateBefore.houses.get(PLAYER_HOUSE_ID)?.exiled === true) {
          whisperBus.publish({
            kind: "PlayerExileBlocked",
            tick: stateBefore.tick,
            action: "proposeMarriage",
          });
          return { ok: false, reason: { kind: "PlayerExiled" } } as ProposalOutcome;
        }
        // P9 Q4 — ElopementInProgress dual-fire (typed-return + void-publish).
        if (hasActivePlayerElopement(stateBefore)) {
          elopementBus.publish({
            kind: "ElopementBlocked",
            tick: stateBefore.tick,
            attemptedAction: "proposeMarriage",
          });
          return { ok: false, reason: { kind: "ElopementInProgress" } } as ProposalOutcome;
        }
        const { nextState, outcome } = applyProposalPure(stateBefore, targetCharacterId);
        if (!outcome.ok) {
          return outcome;
        }
        // Both accept and reject paths consumed a tick (gates 1-13 passed).
        const tickAdvanced = advanceTickPure(nextState);
        set((draft) => {
          overwriteFromGameState(draft, tickAdvanced);
        });
        // Canonical proposeMarriage publisher list (5): proposalOutcome
        // (direct-published below) + marriageTransitions + temptationLatch +
        // characterDeaths + whisperTransitions. publishSchemeTransitions is
        // NOT fired (proposal doesn't invoke scheme resolution).
        if (outcome.accepted) {
          familyBus.publish({
            kind: "ProposalAccepted",
            proposerId:
              stateBefore.houses.get(PLAYER_HOUSE_ID)?.headOfHouseCharacterId ?? targetCharacterId,
            targetId: targetCharacterId,
            marriageId: outcome.marriageId,
            tick: tickAdvanced.tick,
          });
        } else {
          familyBus.publish({
            kind: "ProposalRejected",
            proposerId:
              stateBefore.houses.get(PLAYER_HOUSE_ID)?.headOfHouseCharacterId ?? targetCharacterId,
            targetId: targetCharacterId,
            scandalDelta: outcome.scandalDelta,
            tick: tickAdvanced.tick,
          });
        }
        publishMarriageTransitions(stateBefore, tickAdvanced);
        publishBetrothalTransitions(stateBefore, tickAdvanced);
        publishTemptationLatchTransitions(stateBefore, tickAdvanced);
        publishCharacterDeaths(stateBefore, tickAdvanced);
        publishWhisperTransitions(stateBefore, tickAdvanced);
        publishElopementTransitions(stateBefore, tickAdvanced);
        publishArtifactTransitions(stateBefore, tickAdvanced);
        // P11: 3 new publishers ride on this wrapper (10-publisher set).
        publishSiblingRivalTransitions(stateBefore, tickAdvanced);
        publishInheritedSecretTransitions(stateBefore, tickAdvanced);
        publishBloodFeudTransitions(stateBefore, tickAdvanced);
        publishGlobalEventTransitions(stateBefore, tickAdvanced);
        publishCallingCardTransitions(stateBefore, tickAdvanced);
        publishDynastyPerkAwards(stateBefore, tickAdvanced);
        return outcome;
      },
      assignTutor: (childCharacterId: CharacterId, tutorCharacterId: CharacterId) => {
        const stateBefore = get();
        if (stateBefore.houses.get(PLAYER_HOUSE_ID)?.exiled === true) {
          return { ok: false, reason: { kind: "PlayerExiled" as const } };
        }
        if (hasActivePlayerElopement(stateBefore)) {
          return { ok: false, reason: { kind: "ElopementInProgress" as const } };
        }
        const result = applyAssignTutorPure(stateBefore, childCharacterId, tutorCharacterId);
        if (!result.ok) return { ok: false, reason: result.reason };
        set((draft) => {
          overwriteFromGameState(draft, result.nextState);
        });
        familyBus.publish({
          kind: "TutorAssigned",
          childId: childCharacterId,
          tutorId: tutorCharacterId,
          reassignmentCount: result.reassignmentCount,
          tick: stateBefore.tick,
        });
        return { ok: true, reassignmentCount: result.reassignmentCount };
      },
      chooseTutorBonusTrait: (childCharacterId: CharacterId, chosenTraitId: TraitId) => {
        const stateBefore = get();
        if (stateBefore.houses.get(PLAYER_HOUSE_ID)?.exiled === true) {
          return { ok: false, reason: { kind: "PlayerExiled" as const } };
        }
        if (hasActivePlayerElopement(stateBefore)) {
          return { ok: false, reason: { kind: "ElopementInProgress" as const } };
        }
        const result = applyChooseTutorBonusTraitPure(stateBefore, childCharacterId, chosenTraitId);
        if (!result.ok) return { ok: false, reason: result.reason };
        set((draft) => {
          overwriteFromGameState(draft, result.nextState);
        });
        familyBus.publish({
          kind: "TutorTraitGranted",
          childId: childCharacterId,
          traitId: chosenTraitId,
          tick: stateBefore.tick,
        });
        // P23: mid-life reclassify (item D) — if the bonus trait changed the
        // child's archetype, direct-publish with the contextual trigger.
        if (result.archetypeChanged !== null) {
          familyBus.publish({
            kind: "ArchetypeReclassified",
            characterId: childCharacterId,
            from: result.archetypeChanged.from,
            to: result.archetypeChanged.to,
            trigger: "TraitAcquisition",
            tick: stateBefore.tick,
          });
        }
        return { ok: true };
      },
      // P23: arrange a pre-adulthood betrothal. Free action; modal-state gates
      // mirror assignTutor. Direct-publishes BetrothalArranged.
      arrangeBetrothal: (partyAId: CharacterId, partyBId: CharacterId) => {
        const stateBefore = get();
        if (stateBefore.houses.get(PLAYER_HOUSE_ID)?.exiled === true) {
          return { ok: false, reason: { kind: "PlayerExiled" as const } };
        }
        if (hasActivePlayerElopement(stateBefore)) {
          return { ok: false, reason: { kind: "ElopementInProgress" as const } };
        }
        const result = applyArrangeBetrothalPure(stateBefore, partyAId, partyBId);
        if (!result.ok) return { ok: false, reason: result.reason };
        set((draft) => {
          overwriteFromGameState(draft, result.nextState);
        });
        const b = result.nextState.betrothals.get(result.betrothalId);
        familyBus.publish({
          kind: "BetrothalArranged",
          betrothalId: result.betrothalId,
          partyAId: b?.partyAId ?? partyAId,
          partyBId: b?.partyBId ?? partyBId,
          tick: stateBefore.tick,
        });
        return { ok: true, betrothalId: result.betrothalId };
      },
      // P23: break a Pending betrothal. Free action; modal-state gates.
      // Direct-publishes BetrothalBroken (so the tick-advance diff helper, which
      // sees an already-Broken before/after on the next tick, won't double-fire).
      breakBetrothal: (betrothalId: BetrothalId) => {
        const stateBefore = get();
        if (stateBefore.houses.get(PLAYER_HOUSE_ID)?.exiled === true) {
          return { ok: false, reason: { kind: "PlayerExiled" as const } };
        }
        if (hasActivePlayerElopement(stateBefore)) {
          return { ok: false, reason: { kind: "ElopementInProgress" as const } };
        }
        const result = applyBreakBetrothalPure(stateBefore, betrothalId);
        if (!result.ok) return { ok: false, reason: result.reason };
        set((draft) => {
          overwriteFromGameState(draft, result.nextState);
        });
        familyBus.publish({ kind: "BetrothalBroken", betrothalId, tick: stateBefore.tick });
        return { ok: true };
      },
      // P24a (C3, Q25): Abandonment / Divorce. Free action — no tick advance.
      // Modal-state gated; the pure rule owns marriage gates + effects. Reuses
      // MarriageDissolved (deceasedSpouseId: null marks the non-death dissolution).
      abandonMarriage: (marriageId: MarriageId) => {
        const stateBefore = get();
        if (stateBefore.houses.get(PLAYER_HOUSE_ID)?.exiled === true) {
          return { ok: false, reason: { kind: "PlayerExiled" as const } };
        }
        if (hasActivePlayerElopement(stateBefore)) {
          return { ok: false, reason: { kind: "ElopementInProgress" as const } };
        }
        const result = applyAbandonMarriagePure(stateBefore, marriageId);
        if (!result.ok) return { ok: false, reason: result.reason };
        set((draft) => {
          overwriteFromGameState(draft, result.nextState);
        });
        familyBus.publish({
          kind: "MarriageDissolved",
          marriageId,
          deceasedSpouseId: null,
          survivingSpouseId: result.survivingSpouseId,
          tick: stateBefore.tick,
        });
        return { ok: true };
      },
      // P8: demand-satisfaction → duel. Free action (no tick advance). Looks
      // up the grievance on the PLAYER house (only player demands satisfaction
      // at v1) cross-filtered by perpetratorHouseId. Validates all rejection
      // gates first, then deducts reputation, creates the Duel entity, calls
      // resolveDuel synchronously, writes the post-resolve state back, and
      // fires publishers.
      demandSatisfaction: (perpetratorHouseId: HouseId, grievanceId: GrievanceId) => {
        const before = get();
        // P9 Q4 — ElopementInProgress at the ABSOLUTE TOP (before grievance
        // lookup). Sprint blocks the wrapper regardless of grievance state.
        if (hasActivePlayerElopement(before)) {
          return { ok: false, reason: { kind: "ElopementInProgress" as const } };
        }
        // Validation reads from `before` — no set yet.
        const victimHouse = before.houses.get(PLAYER_HOUSE_ID);
        if (victimHouse === undefined) {
          return { ok: false, reason: { kind: "GrievanceNotFound" as const } };
        }
        const grievance = victimHouse.grievances.find(
          (g) => g.id === grievanceId && g.perpetratorHouseId === perpetratorHouseId,
        );
        if (grievance === undefined) {
          return { ok: false, reason: { kind: "GrievanceNotFound" as const } };
        }
        if (grievance.resolved) {
          return { ok: false, reason: { kind: "GrievanceAlreadyResolved" as const } };
        }
        if (grievance.defendantCharacterId === null) {
          return { ok: false, reason: { kind: "LegacyGrievanceUnactionable" as const } };
        }
        if (victimHouse.exiled) {
          return { ok: false, reason: { kind: "PlayerExiled" as const } };
        }
        const perpHouse = before.houses.get(perpetratorHouseId);
        if (perpHouse === undefined) {
          return { ok: false, reason: { kind: "GrievanceNotFound" as const } };
        }
        if (perpHouse.exiled) {
          return { ok: false, reason: { kind: "DefenderExiled" as const } };
        }
        const challenger = before.characters.get(victimHouse.headOfHouseCharacterId);
        const defender = before.characters.get(grievance.defendantCharacterId);
        if (challenger === undefined || !challenger.alive) {
          return { ok: false, reason: { kind: "ChallengerDead" as const } };
        }
        if (defender === undefined || !defender.alive) {
          return { ok: false, reason: { kind: "DefenderDead" as const } };
        }

        // Deduct reputation + construct Duel entity. Atomic per CLAUDE.md.
        const newHouses = new Map(before.houses);
        newHouses.set(PLAYER_HOUSE_ID, {
          ...victimHouse,
          reputation: clamp(
            victimHouse.reputation + DUEL_DEMAND_SATISFACTION_REPUTATION_COST,
            0,
            100,
          ),
        });
        const preResolveState: GameState = { ...before, houses: newHouses };
        const duelId = makeDuelId(preResolveState, challenger.id, defender.id);
        const newDuels = new Map(preResolveState.duels);
        const initialDuel = {
          id: duelId,
          challengerCharacterId: challenger.id,
          defenderCharacterId: defender.id,
          grievanceId,
          initiatedAtTick: preResolveState.tick,
          status: "Active" as const,
          resolvedAtTick: null,
          outcome: null,
          loserCasualty: "Unharmed" as const,
          exchangesElapsed: 0,
        };
        newDuels.set(duelId, initialDuel);
        const preResolveStateWithDuel: GameState = { ...preResolveState, duels: newDuels };

        // Run the resolver synchronously. Uses challenger's house RNG.
        const challengerRng = preResolveStateWithDuel.rng.get(PLAYER_HOUSE_ID);
        if (challengerRng === undefined) {
          return { ok: false, reason: { kind: "GrievanceNotFound" as const } };
        }
        const {
          state: postResolveState,
          finalDuel,
          rngState: postRng,
        } = resolveDuel(preResolveStateWithDuel, duelId, challengerRng);
        const newRng = new Map(postResolveState.rng);
        newRng.set(PLAYER_HOUSE_ID, postRng);
        const after: GameState = { ...postResolveState, rng: newRng };

        set((draft) => {
          overwriteFromGameState(draft, after);
        });

        // Publishers AFTER set — event-bus discipline per P3 contract.
        duelBus.publish({
          kind: "DuelResolved",
          tick: after.tick,
          duelId,
          outcome: finalDuel.outcome ?? "Stalemate",
          loserCasualty: finalDuel.loserCasualty,
          exchangesElapsed: finalDuel.exchangesElapsed,
        });
        if (finalDuel.outcome !== "Stalemate") {
          duelBus.publish({
            kind: "GrievanceResolved",
            tick: after.tick,
            grievanceId,
            perpetratorHouseId,
          });
        }
        if (finalDuel.loserCasualty === "Killed") {
          publishCharacterDeaths(before, after);
          publishWhisperTransitions(before, after);
          publishMarriageTransitions(before, after);
          publishBetrothalTransitions(before, after);
          publishTemptationLatchTransitions(before, after);
        }
        return {
          ok: true,
          duelId,
          outcome: finalDuel.outcome ?? "Stalemate",
        };
      },
      // ── P9/P24a: Elopement sprint actions (interactive, keyed by ElopementId) ─
      // Free actions — no tick advance. Operate on a specific PLAYER-controlled
      // sprint. Each direct-publishes ElopementProgressed (still running) or
      // routes through publishElopementTransitions (resolved) on the elopementBus.
      // Terminal detection keys off the sprint's `resolved` flag (sprints persist
      // in the Map; they are NOT removed on resolution).
      elopementPush: (id) => {
        const before = get();
        const result = applyElopementPushPure(before, id);
        if ("ok" in result) {
          return result; // rejection
        }
        const after = result;
        set((state) => {
          overwriteFromGameState(state, after);
        });
        const sprint = after.elopements.get(id);
        if (sprint?.resolved === true) {
          publishElopementTransitions(before, after);
        } else if (sprint !== undefined) {
          elopementBus.publish({
            kind: "ElopementProgressed",
            tick: after.tick,
            schemeId: sprint.schemeId,
            action: "Push",
            playerTilePosition: sprint.playerTilePosition,
            fatherTilePosition: sprint.fatherTilePosition,
            freshHorsesUsedCount: sprint.freshHorsesUsedCount,
          });
        }
        return { ok: true };
      },
      elopementFreshHorses: (id) => {
        const before = get();
        const result = applyElopementFreshHorsesPure(before, id);
        if ("ok" in result) {
          return result; // rejection
        }
        const after = result;
        set((state) => {
          overwriteFromGameState(state, after);
        });
        const sprint = after.elopements.get(id);
        if (sprint?.resolved === true) {
          publishElopementTransitions(before, after);
        } else if (sprint !== undefined) {
          elopementBus.publish({
            kind: "ElopementProgressed",
            tick: after.tick,
            schemeId: sprint.schemeId,
            action: "FreshHorses",
            playerTilePosition: sprint.playerTilePosition,
            fatherTilePosition: sprint.fatherTilePosition,
            freshHorsesUsedCount: sprint.freshHorsesUsedCount,
          });
        }
        return { ok: true };
      },
      elopementSurrender: (id) => {
        const before = get();
        const sprint = before.elopements.get(id);
        if (sprint === undefined || sprint.resolved) {
          return { ok: false, reason: { kind: "NoActiveSprint" as const } };
        }
        const after = applyElopementSurrenderPure(before, id);
        set((state) => {
          overwriteFromGameState(state, after);
        });
        // Surrender always terminates; publish ElopementResolved via diff helper.
        publishElopementTransitions(before, after);
        return { ok: true };
      },
      setElopementAbandonOnWin: (id, abandonOnWin) => {
        const before = get();
        const after = setElopementAbandonOnWin(before, id, abandonOnWin);
        set((state) => {
          overwriteFromGameState(state, after);
        });
      },
      // P10 artifact actions — all FREE ACTIONS. Modal-state gates first;
      // then pure-rule dispatch; then overwriteFromGameState.
      equipArtifact: (characterId, artifactInstanceId) => {
        const stateBefore = get();
        if (stateBefore.houses.get(PLAYER_HOUSE_ID)?.exiled === true) {
          return { ok: false, reason: { kind: "PlayerExiled" as const } };
        }
        if (hasActivePlayerElopement(stateBefore)) {
          return { ok: false, reason: { kind: "ElopementInProgress" as const } };
        }
        const result = applyEquipArtifactPure(stateBefore, characterId, artifactInstanceId);
        if (!result.ok) return { ok: false, reason: result.reason };
        set((state) => {
          overwriteFromGameState(state, result.state);
        });
        // P18: first-equip is the "encounter" that triggers backstory
        // generation. Fire-and-forget + flag-gated inside ensureFlavor, so this
        // is inert in tests/replay. Derive def fields from the freshly-equipped
        // instance (none are in scope at the wrapper signature).
        const equipped = result.state.artifactInstances.get(artifactInstanceId);
        if (equipped !== undefined) {
          const def = resolveArtifactDefinition(result.state, equipped.definitionId);
          if (def !== undefined) {
            ensureFlavor(`artifact:${equipped.definitionId}` as FlavorContentId, {
              kind: "ArtifactBackstory",
              definitionId: equipped.definitionId,
              displayName: def.displayName,
              family: def.family,
            });
          }
        }
        return { ok: true };
      },
      recordFlavorText: (entry) => {
        // No-op if already present (honors "produced at most once" even if a
        // race slips past ensureFlavor's check). Immer handles the Map mutation.
        set((state) => {
          if (state.flavorText.has(entry.id)) return;
          state.flavorText.set(entry.id, entry);
        });
      },
      revealNpcBio: (characterId) => {
        // UI-triggered (the "Who is this?" expander). Fire-and-forget; flag-
        // gated + idempotent inside ensureFlavor. No tick, no mutation here.
        // P22: the player-house gate was lifted so player-family members can
        // also reveal a bio (FamilyTreeTab expander). The NpcBio prompt's
        // society-gossip framing is mildly off for one's own kin but acceptable
        // (flavor is gameplay-inert prose); FlavorContentKind "NpcBio" unchanged.
        const character = get().characters.get(characterId);
        if (character === undefined) return;
        ensureFlavor(`bio:${characterId}` as FlavorContentId, {
          kind: "NpcBio",
          character,
        });
      },
      unequipArtifact: (characterId, artifactInstanceId) => {
        const stateBefore = get();
        if (stateBefore.houses.get(PLAYER_HOUSE_ID)?.exiled === true) {
          return { ok: false, reason: { kind: "PlayerExiled" as const } };
        }
        if (hasActivePlayerElopement(stateBefore)) {
          return { ok: false, reason: { kind: "ElopementInProgress" as const } };
        }
        const result = applyUnequipArtifactPure(stateBefore, characterId, artifactInstanceId);
        if (!result.ok) return { ok: false, reason: result.reason };
        set((state) => {
          overwriteFromGameState(state, result.state);
        });
        return { ok: true };
      },
      commissionForgery: (forgerCharacterId, definitionId) => {
        const stateBefore = get();
        if (stateBefore.houses.get(PLAYER_HOUSE_ID)?.exiled === true) {
          return { ok: false, reason: { kind: "PlayerExiled" as const } };
        }
        if (hasActivePlayerElopement(stateBefore)) {
          return { ok: false, reason: { kind: "ElopementInProgress" as const } };
        }
        const result = applyCommissionForgeryPure(stateBefore, forgerCharacterId, definitionId);
        if (!result.ok) return { ok: false, reason: result.reason };
        set((state) => {
          overwriteFromGameState(state, result.state);
        });
        // Direct-publish ForgeryCreated — the diff helper doesn't cover free-
        // action mints (only tick-phase transitions).
        artifactBus.publish({
          kind: "ForgeryCreated",
          tick: stateBefore.tick,
          forgeryId: result.forgeryId,
          forgerCharacterId,
        });
        return { ok: true, forgeryId: result.forgeryId };
      },
      thwartTheft: (thiefAttemptId) => {
        const stateBefore = get();
        if (stateBefore.houses.get(PLAYER_HOUSE_ID)?.exiled === true) {
          return { ok: false, reason: { kind: "PlayerExiled" as const } };
        }
        if (hasActivePlayerElopement(stateBefore)) {
          return { ok: false, reason: { kind: "ElopementInProgress" as const } };
        }
        const result = applyThwartTheftPure(stateBefore, thiefAttemptId);
        if (!result.ok) return { ok: false, reason: result.reason };
        set((state) => {
          overwriteFromGameState(state, result.state);
        });
        // Direct-publish TheftResolved — outcome surfaces to UI immediately.
        artifactBus.publish({
          kind: "TheftResolved",
          tick: stateBefore.tick,
          thiefAttemptId,
          outcome: result.outcome,
        });
        return { ok: true, outcome: result.outcome };
      },
      // P13: free action — no tick advance, no 11-publisher set. Direct-
      // publishes CourierResearchUnlocked on success. Modal-state gates
      // (PlayerExiled / ElopementInProgress) + era + already-researched +
      // wealth gates live in applyResearchFastCouriers.
      researchFastCouriers: () => {
        const stateBefore = get();
        const result = applyResearchFastCouriers(stateBefore);
        if (!result.ok) return { ok: false, reason: result.reason };
        set((state) => {
          overwriteFromGameState(state, result.nextState);
        });
        globalEventBus.publish({
          kind: "CourierResearchUnlocked",
          tick: stateBefore.tick,
          houseId: PLAYER_HOUSE_ID,
        });
        return { ok: true };
      },
      reconcileSibling: (siblingCharacterId: CharacterId) => {
        const before = get();
        const { nextState, outcome } = applyReconciliationAttempt(before, siblingCharacterId);
        if (!outcome.ok) {
          return { ok: false, reason: outcome.reason };
        }
        const after = advanceTickPure(nextState);
        set((state) => {
          overwriteFromGameState(state, after);
        });
        // 10-publisher set ride.
        publishCharacterDeaths(before, after);
        publishSchemeTransitions(before, after);
        publishWhisperTransitions(before, after);
        publishMarriageTransitions(before, after);
        publishBetrothalTransitions(before, after);
        publishTemptationLatchTransitions(before, after);
        publishElopementTransitions(before, after);
        publishArtifactTransitions(before, after);
        const reconciledKeys =
          outcome.kind === "Success"
            ? new Set([`reconciled:${siblingCharacterId}`])
            : new Set<string>();
        publishSiblingRivalTransitions(before, after, reconciledKeys);
        publishInheritedSecretTransitions(before, after);
        publishBloodFeudTransitions(before, after);
        publishGlobalEventTransitions(before, after);
        publishCallingCardTransitions(before, after);
        publishDynastyPerkAwards(before, after);
        if (outcome.kind === "Success") {
          siblingRivalBus.publish({
            kind: "SiblingRivalReconciled",
            tick: after.tick,
            characterId: siblingCharacterId,
            via: "Player",
          });
        }
        return { ok: true };
      },
      // ── P12 Hyde Park Promenade actions ───────────────────────────────
      enterPromenade: () => {
        const stateBefore = get();
        // Pure-rule gate runs first. Returns typed rejection unions for
        // PlayerExiled / ElopementInProgress / WrongLocation.
        const check = canEnterPromenade(stateBefore);
        if (!check.ok) {
          locationBus.publish({
            kind: "PromenadeEntryRejected",
            tick: stateBefore.tick,
            houseId: PLAYER_HOUSE_ID,
            reason: check.reason,
          });
          return { ok: false, reason: check.reason };
        }
        // P12 cross-mode mutual exclusion (gates BOTH Ballroom AND Promenade
        // sessions). The orchestrator throws as defense-in-depth, but the
        // store-action layer returns a typed rejection here.
        if (conversationOrchestrator.currentSessionId() !== null) {
          const reason: PromenadeEntryRejection = { kind: "SessionAlreadyOpen" };
          locationBus.publish({
            kind: "PromenadeEntryRejected",
            tick: stateBefore.tick,
            houseId: PLAYER_HOUSE_ID,
            reason,
          });
          return { ok: false, reason };
        }
        // Pick the partner (1 player-RNG draw on non-empty pool, 0 on empty).
        const picked = pickPromenadePartner(stateBefore);
        if (picked.partnerId === null) {
          const reason: PromenadeEntryRejection = { kind: "NoEligiblePartner" };
          locationBus.publish({
            kind: "PromenadeEntryRejected",
            tick: stateBefore.tick,
            houseId: PLAYER_HOUSE_ID,
            reason,
          });
          return { ok: false, reason };
        }
        // Commit the new RNG map to GameState BEFORE opening the session
        // so any later sendPromenadeMessage call reads consistent state.rng.
        set((draft) => {
          overwriteFromGameState(draft, picked.nextState);
        });
        const sessionId = conversationOrchestrator.beginPromenadeSession(
          get().tick,
          picked.partnerId,
        );
        conversationBus.publish({
          kind: "PromenadeEntered",
          tick: stateBefore.tick,
          houseId: PLAYER_HOUSE_ID,
          sessionId,
          partnerCharacterId: picked.partnerId,
        });
        return { ok: true, sessionId, partnerCharacterId: picked.partnerId };
      },
      exitPromenade: () => {
        // Defensive — UI should never invoke this against a non-Promenade
        // session, but the dispatch path can race a load (replaceState
        // clears the session, then UI calls exit before re-render). No-op.
        if (conversationOrchestrator.currentMode() !== "Promenade") return;
        const sessionId = conversationOrchestrator.currentSessionId() as PromenadeSessionId;
        const partnerCharacterId = conversationOrchestrator.currentPromenadePartner();
        // Abort any in-flight per-turn request BEFORE the tick advance.
        conversationOrchestrator.abortCurrent();
        const stateBefore = get();
        // P26 (H5): close the deliberate P12 modal-gate divergence. If exile or
        // an elopement mounted during the session (via a parallel store action
        // in the in-flight window), close it WITHOUT advancing the tick or
        // firing publishers — elopement suspends time; the commit-on-leave
        // 1-tick cost is not charged to a modal-aborted session. Per-turn
        // history/affection writes already landed; skipping the tick is safe.
        if (
          stateBefore.houses.get(PLAYER_HOUSE_ID)?.exiled === true ||
          hasActivePlayerElopement(stateBefore)
        ) {
          conversationOrchestrator.endSession();
          conversationBus.publish({
            kind: "PromenadeExited",
            tick: stateBefore.tick,
            houseId: PLAYER_HOUSE_ID,
            sessionId,
            partnerCharacterId,
          });
          return;
        }
        // The 1-tick cost per spec line 446 is the contract. History +
        // affection mutations from sendPromenadeMessage already landed
        // per-turn; the tick advance is the only commit on exit.
        const afterTick = advanceTickPure(stateBefore);
        set((draft) => {
          overwriteFromGameState(draft, afterTick);
        });
        conversationOrchestrator.endSession();
        conversationBus.publish({
          kind: "PromenadeExited",
          tick: afterTick.tick,
          houseId: PLAYER_HOUSE_ID,
          sessionId,
          partnerCharacterId,
        });
        // 14-publisher set per CLAUDE.md (matches travel/requestAudience/...).
        publishCharacterDeaths(stateBefore, afterTick);
        publishSchemeTransitions(stateBefore, afterTick);
        publishWhisperTransitions(stateBefore, afterTick);
        publishMarriageTransitions(stateBefore, afterTick);
        publishBetrothalTransitions(stateBefore, afterTick);
        publishTemptationLatchTransitions(stateBefore, afterTick);
        publishElopementTransitions(stateBefore, afterTick);
        publishArtifactTransitions(stateBefore, afterTick);
        publishSiblingRivalTransitions(stateBefore, afterTick);
        publishInheritedSecretTransitions(stateBefore, afterTick);
        publishBloodFeudTransitions(stateBefore, afterTick);
        publishGlobalEventTransitions(stateBefore, afterTick);
        publishCallingCardTransitions(stateBefore, afterTick);
        publishDynastyPerkAwards(stateBefore, afterTick);
      },
      sendPromenadeMessage: async (input: PromenadeMessageInput) => {
        const stateBefore = get();
        if (
          conversationOrchestrator.currentSessionId() === null ||
          conversationOrchestrator.currentMode() !== "Promenade"
        ) {
          return { ok: false, reason: { reason: "cancelled" } as ConversationFailure };
        }
        const partnerId = conversationOrchestrator.currentPromenadePartner();
        if (partnerId === null) {
          return { ok: false, reason: { reason: "cancelled" } as ConversationFailure };
        }
        const target = stateBefore.characters.get(partnerId);
        const playerHead = stateBefore.houses.get(PLAYER_HOUSE_ID);
        if (target === undefined || !target.alive || playerHead === undefined) {
          return { ok: false, reason: { reason: "cancelled" } as ConversationFailure };
        }
        const pairKey = makePairKey(PLAYER_HOUSE_ID, target.id);
        const history = stateBefore.conversationHistory.get(pairKey) ?? [];

        // P12: 1-on-1 scene. Persona prompt sees only the partner.
        // Wire-format type is mutable array; we declare a fresh empty one.
        const otherCharactersInScene: Character[] = [];

        // Marriage state snapshot — same shape as sendBallroomMessage.
        let targetMarriage: MarriageRecord | null = null;
        let spouse: Character | null = null;
        if (target.marriageId !== null) {
          const m = stateBefore.marriages.get(target.marriageId);
          if (m !== undefined) {
            targetMarriage = m;
            if (!m.dissolved) {
              const spouseId = m.spouseAId === target.id ? m.spouseBId : m.spouseAId;
              spouse = stateBefore.characters.get(spouseId) ?? null;
            }
          }
        }

        // P17: semantic-memory hits (inert/[] when disabled or on failure).
        const semanticContext = await retrieveSemanticHits(target.id, input.freeformMessage);

        const request = {
          targetCharacterId: target.id,
          playerHouseId: PLAYER_HOUSE_ID,
          freeformMessage: input.freeformMessage,
          history,
          otherCharactersInScene,
          characterStateSnapshot: {
            target: {
              ...target,
              traits: getEffectiveTraits(stateBefore, target.id),
              equippedArtifactIds: [...target.equippedArtifactIds],
            },
            targetMarriage,
            spouse,
          },
          mode: "Promenade" as const,
          semanticContext,
          keyMoment: computeKeyMoment(stateBefore, target.id),
        };

        // Pin-priority resolver. UI always pins a promenade tactic.
        const outcome = await conversationOrchestrator.send(request, input.pinnedTactic);
        if (outcome.kind === "Failed") {
          return { ok: false, reason: outcome.failure };
        }
        // Read mount-equip predicates at resolve time (defense-in-depth
        // against state drift between request build and post-await).
        const stateAtResolve = get();
        // P26 (H5): close the P12 divergence — drop the exchange (no history/
        // affection write) if exile/elopement mounted mid-flight.
        if (
          stateAtResolve.houses.get(PLAYER_HOUSE_ID)?.exiled === true ||
          hasActivePlayerElopement(stateAtResolve)
        ) {
          return { ok: false, reason: { reason: "cancelled" } as ConversationFailure };
        }
        const playerMount = playerHeadEquipsMountFamily(stateAtResolve);
        const partnerAtResolve = stateAtResolve.characters.get(target.id);
        const targetMount =
          partnerAtResolve !== undefined &&
          characterEquipsMountFamily(stateAtResolve, partnerAtResolve.equippedArtifactIds);

        // Narrow the LLM's classification to a PromenadeTactic. Pin-priority
        // guarantees the result is in-set; the narrowing helper makes the
        // contract visible AND throws on out-of-set (defense-in-depth).
        const promenadeTactic = narrowToPromenadeTactic(outcome.response.classifiedTactic);
        const promenadeOutcome = resolvePromenadeCombat({
          tactic: promenadeTactic,
          stance: input.stance,
          qualityMultiplier: outcome.response.qualityMultiplier,
          targetHasMountFamilyEquipped: targetMount,
          playerHasMountFamilyEquipped: playerMount,
          targetMood: target.mood,
          targetTraits: getEffectiveTraits(stateAtResolve, target.id),
        });

        // Commit history + affection. Tick is NOT advanced here — only on
        // exitPromenade.
        set((draft) => {
          overwriteFromGameState(
            draft,
            appendPromenadeExchange(
              stateAtResolve,
              target.id,
              { text: input.freeformMessage, classifiedTactic: promenadeTactic },
              { text: outcome.response.dialogue },
              promenadeOutcome.affectionDelta,
              stateAtResolve.tick,
            ),
          );
        });

        return { ok: true, outcome: outcome.response };
      },
      abortPromenadeRequest: () => {
        if (conversationOrchestrator.currentMode() !== "Promenade") return;
        conversationOrchestrator.abortCurrent();
      },
      // ── P26 NPC-initiated calling cards ─────────────────────────────────
      acceptCallingCard: (cardId: CallingCardId) => {
        const before = get();
        if (before.houses.get(PLAYER_HOUSE_ID)?.exiled === true) {
          return { ok: false, reason: { kind: "PlayerExiled" as const } };
        }
        if (hasActivePlayerElopement(before)) {
          return { ok: false, reason: { kind: "ElopementInProgress" as const } };
        }
        if (conversationOrchestrator.currentSessionId() !== null) {
          return { ok: false, reason: { kind: "SessionAlreadyOpen" as const } };
        }
        const card = before.callingCards.get(cardId);
        if (card === undefined || card.status !== "Pending") {
          return { ok: false, reason: { kind: "CardNotPending" as const } };
        }
        const caller = before.characters.get(card.callerCharacterId);
        if (caller === undefined || !caller.alive) {
          return { ok: false, reason: { kind: "CallerDead" as const } };
        }
        set((draft) => {
          const c = draft.callingCards.get(cardId);
          if (c !== undefined) draft.callingCards.set(cardId, { ...c, status: "Accepted" });
        });
        const sessionId = conversationOrchestrator.beginVisitSession(
          get().tick,
          card.callerCharacterId,
        );
        conversationBus.publish({
          kind: "CallingCardAccepted",
          tick: before.tick,
          cardId,
          callerCharacterId: card.callerCharacterId,
          sessionId,
        });
        conversationBus.publish({
          kind: "VisitEntered",
          tick: before.tick,
          houseId: PLAYER_HOUSE_ID,
          sessionId,
          callerCharacterId: card.callerCharacterId,
        });
        // P26: NPC speaks first — fire-and-forget opener round-trip.
        void fireNpcOpener(get, card.callerCharacterId, sessionId, "Visit");
        return { ok: true, sessionId };
      },
      declineCallingCard: (cardId: CallingCardId) => {
        const before = get();
        if (before.houses.get(PLAYER_HOUSE_ID)?.exiled === true) {
          return { ok: false, reason: { kind: "PlayerExiled" as const } };
        }
        if (hasActivePlayerElopement(before)) {
          return { ok: false, reason: { kind: "ElopementInProgress" as const } };
        }
        const card = before.callingCards.get(cardId);
        if (card === undefined || card.status !== "Pending") {
          return { ok: false, reason: { kind: "CardNotPending" as const } };
        }
        const pairKey = makePairKey(PLAYER_HOUSE_ID, card.callerCharacterId);
        set((draft) => {
          const c = draft.callingCards.get(cardId);
          if (c !== undefined) draft.callingCards.set(cardId, { ...c, status: "Declined" });
          const prev = draft.affectionMap.get(pairKey) ?? 0;
          draft.affectionMap.set(
            pairKey,
            clamp(prev - CALLING_CARD_DECLINE_AFFECTION_PENALTY, 0, 100),
          );
        });
        conversationBus.publish({
          kind: "CallingCardDeclined",
          tick: before.tick,
          cardId,
          callerCharacterId: card.callerCharacterId,
        });
        return { ok: true };
      },
      exitVisit: () => {
        if (conversationOrchestrator.currentMode() !== "Visit") return;
        const sessionId = conversationOrchestrator.currentSessionId() as VisitSessionId;
        const callerCharacterId = conversationOrchestrator.currentVisitCaller();
        conversationOrchestrator.abortCurrent();
        const stateBefore = get();
        // P26 (H5): post-await modal-gate — if exile/elopement mounted during
        // the session, close it WITHOUT advancing the tick (elopement suspends
        // time; the commit-on-leave 1-tick cost is not charged to a modal-
        // aborted session). The Visit history/affection writes already landed
        // per-turn; skipping the tick + publishers is safe.
        if (
          stateBefore.houses.get(PLAYER_HOUSE_ID)?.exiled === true ||
          hasActivePlayerElopement(stateBefore)
        ) {
          conversationOrchestrator.endSession();
          conversationBus.publish({
            kind: "VisitExited",
            tick: stateBefore.tick,
            houseId: PLAYER_HOUSE_ID,
            sessionId,
            callerCharacterId,
          });
          return;
        }
        const afterTick = advanceTickPure(stateBefore);
        set((draft) => {
          overwriteFromGameState(draft, afterTick);
        });
        conversationOrchestrator.endSession();
        conversationBus.publish({
          kind: "VisitExited",
          tick: afterTick.tick,
          houseId: PLAYER_HOUSE_ID,
          sessionId,
          callerCharacterId,
        });
        // 14-publisher set (commit-on-leave, matches exitPromenade).
        publishCharacterDeaths(stateBefore, afterTick);
        publishSchemeTransitions(stateBefore, afterTick);
        publishWhisperTransitions(stateBefore, afterTick);
        publishMarriageTransitions(stateBefore, afterTick);
        publishBetrothalTransitions(stateBefore, afterTick);
        publishTemptationLatchTransitions(stateBefore, afterTick);
        publishElopementTransitions(stateBefore, afterTick);
        publishArtifactTransitions(stateBefore, afterTick);
        publishSiblingRivalTransitions(stateBefore, afterTick);
        publishInheritedSecretTransitions(stateBefore, afterTick);
        publishBloodFeudTransitions(stateBefore, afterTick);
        publishGlobalEventTransitions(stateBefore, afterTick);
        publishCallingCardTransitions(stateBefore, afterTick);
        publishDynastyPerkAwards(stateBefore, afterTick);
      },
      sendVisitMessage: async (input: PromenadeMessageInput) => {
        const stateBefore = get();
        if (
          conversationOrchestrator.currentSessionId() === null ||
          conversationOrchestrator.currentMode() !== "Visit"
        ) {
          return { ok: false, reason: { reason: "cancelled" } as ConversationFailure };
        }
        const callerId = conversationOrchestrator.currentVisitCaller();
        if (callerId === null) {
          return { ok: false, reason: { reason: "cancelled" } as ConversationFailure };
        }
        const target = stateBefore.characters.get(callerId);
        const playerHead = stateBefore.houses.get(PLAYER_HOUSE_ID);
        if (target === undefined || !target.alive || playerHead === undefined) {
          return { ok: false, reason: { reason: "cancelled" } as ConversationFailure };
        }
        const pairKey = makePairKey(PLAYER_HOUSE_ID, target.id);
        const history = stateBefore.conversationHistory.get(pairKey) ?? [];
        const otherCharactersInScene: Character[] = [];
        let targetMarriage: MarriageRecord | null = null;
        let spouse: Character | null = null;
        if (target.marriageId !== null) {
          const m = stateBefore.marriages.get(target.marriageId);
          if (m !== undefined) {
            targetMarriage = m;
            if (!m.dissolved) {
              const spouseId = m.spouseAId === target.id ? m.spouseBId : m.spouseAId;
              spouse = stateBefore.characters.get(spouseId) ?? null;
            }
          }
        }
        const semanticContext = await retrieveSemanticHits(target.id, input.freeformMessage);
        const request = {
          targetCharacterId: target.id,
          playerHouseId: PLAYER_HOUSE_ID,
          freeformMessage: input.freeformMessage,
          history,
          otherCharactersInScene,
          characterStateSnapshot: {
            target: {
              ...target,
              traits: getEffectiveTraits(stateBefore, target.id),
              equippedArtifactIds: [...target.equippedArtifactIds],
            },
            targetMarriage,
            spouse,
          },
          mode: "Visit" as const,
          semanticContext,
          keyMoment: computeKeyMoment(stateBefore, target.id),
        };
        const outcome = await conversationOrchestrator.send(request, input.pinnedTactic);
        if (outcome.kind === "Failed") {
          return { ok: false, reason: outcome.failure };
        }
        const stateAtResolve = get();
        // P26 (H5): post-await modal-gate short-circuit — drop the exchange
        // (no history/affection write) if exile/elopement mounted mid-flight.
        if (
          stateAtResolve.houses.get(PLAYER_HOUSE_ID)?.exiled === true ||
          hasActivePlayerElopement(stateAtResolve)
        ) {
          return { ok: false, reason: { reason: "cancelled" } as ConversationFailure };
        }
        const playerMount = playerHeadEquipsMountFamily(stateAtResolve);
        const partnerAtResolve = stateAtResolve.characters.get(target.id);
        const targetMount =
          partnerAtResolve !== undefined &&
          characterEquipsMountFamily(stateAtResolve, partnerAtResolve.equippedArtifactIds);
        const promenadeTactic = narrowToPromenadeTactic(outcome.response.classifiedTactic);
        const promenadeOutcome = resolvePromenadeCombat({
          tactic: promenadeTactic,
          stance: input.stance,
          qualityMultiplier: outcome.response.qualityMultiplier,
          targetHasMountFamilyEquipped: targetMount,
          playerHasMountFamilyEquipped: playerMount,
          targetMood: target.mood,
          targetTraits: getEffectiveTraits(stateAtResolve, target.id),
        });
        set((draft) => {
          overwriteFromGameState(
            draft,
            appendPromenadeExchange(
              stateAtResolve,
              target.id,
              { text: input.freeformMessage, classifiedTactic: promenadeTactic },
              { text: outcome.response.dialogue },
              promenadeOutcome.affectionDelta,
              stateAtResolve.tick,
            ),
          );
        });
        return { ok: true, outcome: outcome.response };
      },
      abortVisitRequest: () => {
        if (conversationOrchestrator.currentMode() !== "Visit") return;
        conversationOrchestrator.abortCurrent();
      },
      recordNpcOpener: (sessionId, targetCharacterId, text) => {
        // Staleness guard (CLAUDE.md rule #7): if the player exited the ballroom/
        // Visit (or opened a different session) while the opener was in flight,
        // drop it — do NOT append a stale orphan exchange.
        if (conversationOrchestrator.currentSessionId() !== sessionId) return;
        const trimmed = text.trim();
        if (trimmed === "") return;
        const pairKey = makePairKey(PLAYER_HOUSE_ID, targetCharacterId);
        set((state) => {
          const hist = state.conversationHistory.get(pairKey) ?? [];
          const opener: Exchange = {
            speaker: "other",
            text: trimmed,
            classifiedTactic: null,
            tick: state.tick,
          };
          state.conversationHistory.set(
            pairKey,
            [...hist, opener].slice(-CONVERSATION_HISTORY_LIMIT_PER_PAIR),
          );
        });
      },
    })),
  );
  // P17: bind the post-mutation state accessor for the semantic-index
  // subscribers (their read path resolves passage text from event ids). Inert
  // until enableSemanticMemory() is called from src/main.tsx.
  bindSemanticIndexStore(() => store.getState());
  // P18: bind the store accessor for the flavor subscribers + ensureFlavor.
  // Accessor returns the full StoreState (incl. recordFlavorText). Inert until
  // enableFlavorContent() is called from src/main.tsx.
  bindFlavorStore(() => store.getState());
  return store;
}

// Project the store's combined state back to a pure GameState (drops actions).
// Used by save() and the determinism harness. Schema↔projection↔selector
// triple-sync is enforced by schema-projection-selector-extension.test.ts —
// every GameStateSchema field must appear here.
export function selectGameState(state: StoreState): GameState {
  return {
    tick: state.tick,
    rng: state.rng,
    houses: state.houses,
    characters: state.characters,
    marriages: state.marriages,
    campaignName: state.campaignName,
    era: state.era,
    // P4 additions — schema↔projection↔selector triple-sync.
    conversationHistory: state.conversationHistory,
    affectionMap: state.affectionMap,
    // P5 addition. Grievances ride inside houses; DO NOT add a top-level
    // `state.grievances` field — the trip-wire enforces top-level key
    // equality but won't catch a misplaced top-level addition because
    // grievances belong on the House entity per spec §4 line 541.
    schemes: state.schemes,
    // P6 additions. Exiled rides inside houses (per-house terminal flag);
    // whispers/couriers/staff are top-level Maps mirrored across the four
    // schema↔projection↔selector↔overwriteFromGameState surfaces.
    whispers: state.whispers,
    couriers: state.couriers,
    staff: state.staff,
    // P7 additions — schema↔projection↔selector↔overwriteFromGameState quad-
    // sync. Forgetting these on this surface silently breaks save() (the
    // selector returns a partial GameState whose Zod parse against the V8
    // schema would fail).
    proposalsLog: state.proposalsLog,
    tutorAssignmentsLog: state.tutorAssignmentsLog,
    pendingTutorTraitChoices: state.pendingTutorTraitChoices,
    // P8 additions — quad-sync (schema/projection/selector/overwriteFromGameState).
    // Forgetting these breaks save() (returns a partial GameState whose Zod
    // parse against SaveV9Schema fails).
    patronesses: state.patronesses,
    rivalActors: state.rivalActors,
    factionTensions: state.factionTensions,
    duels: state.duels,
    // P9 addition — quint-sync 3rd surface.
    elopements: state.elopements,
    // P10 additions — three new top-level Maps. Quad-sync 3rd surface.
    artifactInstances: state.artifactInstances,
    forgeries: state.forgeries,
    thiefAttempts: state.thiefAttempts,
    // P24b addition — procedural artifact definitions. Quint-sync 3rd surface.
    proceduralArtifactDefinitions: state.proceduralArtifactDefinitions,
    // P13 addition — global events Map. Quint-sync 3rd surface.
    globalEvents: state.globalEvents,
    // P18 addition — generated flavor content. Quint-sync 3rd surface.
    flavorText: state.flavorText,
    // P23 addition — betrothal registry. Quad-sync 3rd surface (selector).
    betrothals: state.betrothals,
    // P26 addition — calling-card registry. Quint-sync 3rd surface (selector).
    callingCards: state.callingCards,
  };
}
