import { enableMapSet } from "immer";
import { type StoreApi, type UseBoundStore, create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { artifactBus, publishArtifactTransitions } from "../runtime/events/artifacts";
import {
  ACCIDENTAL_SLIP_DRIP_PER_CONVERSATION,
  CONVERSATION_HISTORY_LIMIT_PER_PAIR,
  DUEL_DEMAND_SATISFACTION_REPUTATION_COST,
  FAUX_PAS_LOCK_DURATION_IN_TICKS,
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
  type Character,
  CharacterSchema,
  type CourierPayload,
  type Duel,
  type GameState,
  GameStateSchema,
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
import { makeDuelId } from "./fixtures/duelIdFactory";
import { FACTION_PAIRS } from "./fixtures/factions";
import type { LocationId } from "./fixtures/locations";
import { PATRONESSES_FIXTURE } from "./fixtures/patronesses";
import {
  type ArtifactInstanceId,
  type BallSessionId,
  type CharacterId,
  type CourierPayloadId,
  type DuelId,
  type FactionPairKey,
  type ForgeryId,
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
  type SpymasterInterceptRejection,
  tryAssignStaff,
  trySpymasterMailIntercept,
} from "./rules/staff";
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

// P2: default campaign name written into every new save and used by
// migrate_v2_to_v3 + fromSaveV1/fromSaveV2 default-on-lift. Lives here
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
import { bootstrapPlayerArtifactsForInit, seedStartingFamily } from "./bootstrap";

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
  // and calls getOrThrow(state.rng, houseId). Same derivation in
  // seedIndependentIntoLegacyState so fresh-state and migration paths
  // produce byte-identical Independent RNG.
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
    elopement: null,
    // P10: starting artifact inventory (3 instances, 2 equipped on the player
    // head). Forgeries and thiefAttempts start empty — these grow at runtime
    // via commissionForgery / applyThiefNoticePhase.
    artifactInstances,
    forgeries: new Map(),
    thiefAttempts: new Map(),
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
    | { ok: true; sessionId: BallSessionId }
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
  // P9 elopement sprint actions. Free actions — no tick advance. The only
  // mutations allowed while state.elopement !== null. push/freshHorses mutate
  // tile positions; surrender always loses.
  elopementPush: () => { ok: true } | { ok: false; reason: ElopementActionRejection };
  elopementFreshHorses: () => { ok: true } | { ok: false; reason: ElopementFreshHorsesRejection };
  elopementSurrender: () => { ok: true } | { ok: false; reason: ElopementActionRejection };
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
    definitionId: string,
  ) => { ok: true; forgeryId: ForgeryId } | { ok: false; reason: CommissionRejection };
  thwartTheft: (
    thiefAttemptId: ThiefAttemptId,
  ) => { ok: true; outcome: "Thwarted" | "Stolen" } | { ok: false; reason: ThwartRejection };
};

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

// P7 imports.
// P9 elopement imports.
import {
  type ElopementActionRejection,
  type ElopementFreshHorsesRejection,
  applyElopementFreshHorsesPure,
  applyElopementPushPure,
  applyElopementSurrenderPure,
} from "../game/rules/elopement";
import { type ProposalOutcome, applyProposalPure } from "../game/rules/proposal";
import {
  type AssignTutorRejection,
  type ChooseTutorBonusTraitRejection,
  applyAssignTutorPure,
  applyChooseTutorBonusTraitPure,
} from "../game/rules/tutor";
import type { ConversationResponse } from "../llm/types";
import { conversationOrchestrator } from "../runtime/conversationOrchestrator";
import { conversationBus, publishCharacterDeaths } from "../runtime/events/conversation";
import type { BallEntryRejection } from "../runtime/events/conversation";
import { duelBus } from "../runtime/events/duels";
import { elopementBus, publishElopementTransitions } from "../runtime/events/elopement";
import {
  familyBus,
  publishArchetypeReclassificationsFromSuccession,
  publishChildMaturationTransitions,
  publishMarriageTransitions,
  publishTemptationLatchTransitions,
} from "../runtime/events/family";
import { locationBus } from "../runtime/events/location";
import { publishSchemeTransitions, schemeBus } from "../runtime/events/scheme";
import { publishWhisperTransitions, whisperBus } from "../runtime/events/whispers";
// Re-import here at the bottom of the file (cycle-avoidance pattern) — the
// runtime layer imports rules layer, which is OK after store.ts symbols
// have been declared above.
import { advanceTickPure } from "../runtime/tickOrchestrator";
import { runYearPassPure } from "../runtime/yearPass";

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
  // tick-advancing action silently CLEARS state.elopement.
  draft.elopement = next.elopement;
  // P10 additions — three new top-level Maps. Same "OFTEN-FORGOTTEN fourth
  // surface" trap; without these, every tick-advancing action silently clears
  // the artifact/forgery/thief-attempt registries.
  draft.artifactInstances = next.artifactInstances;
  draft.forgeries = next.forgeries;
  draft.thiefAttempts = next.thiefAttempts;
}

export function createStore({ seed }: { seed: string }): SeasonStore {
  return create<StoreState>()(
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
        if (exileGate.elopement !== null) {
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
        // P9 Q4 — ElopementInProgress gate. Branch-5 of pruneOrphaned-
        // ConversationKeys is therefore unreachable through runYearPass at
        // v1 (a future v1.5+ relaxation would need re-evaluation).
        if (exileGate.elopement !== null) {
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
        publishTemptationLatchTransitions(before, after);
        publishChildMaturationTransitions(before, after);
        publishArchetypeReclassificationsFromSuccession(before, after);
      },
      replaceState: (next: GameState) =>
        set((state) => {
          overwriteFromGameState(state, next);
        }),
      travel: (to: LocationId) => {
        const stateBefore = get();
        if (stateBefore.houses.get(PLAYER_HOUSE_ID)?.exiled === true) {
          return { ok: false, reason: { kind: "PlayerExiled" as const } };
        }
        if (stateBefore.elopement !== null) {
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
        publishTemptationLatchTransitions(stateBefore, afterTick);
        // P9: applySchemeResolutionPhase can mount state.elopement on a
        // discovered Seduction during this wrapper's advanceTickPure chain.
        publishElopementTransitions(stateBefore, afterTick);
        publishArtifactTransitions(stateBefore, afterTick);
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
        if (stateBefore.elopement !== null) {
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
        publishTemptationLatchTransitions(stateBefore, afterTick);
        publishElopementTransitions(stateBefore, afterTick);
        publishArtifactTransitions(stateBefore, afterTick);
        return { outcome };
      },
      escapeBankruptcy: () => {
        const stateBefore = get();
        if (stateBefore.houses.get(PLAYER_HOUSE_ID)?.exiled === true) {
          return { ok: false, reason: { kind: "PlayerExiled" as const } };
        }
        if (stateBefore.elopement !== null) {
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
        publishTemptationLatchTransitions(stateBefore, afterTick);
        // P9: applySchemeResolutionPhase can mount state.elopement on a
        // discovered Seduction during this wrapper's advanceTickPure chain.
        publishElopementTransitions(stateBefore, afterTick);
        publishArtifactTransitions(stateBefore, afterTick);
        return { ok: true };
      },
      refreshWardrobe: () => {
        const stateBefore = get();
        if (stateBefore.houses.get(PLAYER_HOUSE_ID)?.exiled === true) {
          return { ok: false, reason: { kind: "PlayerExiled" as const } };
        }
        if (stateBefore.elopement !== null) {
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
        publishTemptationLatchTransitions(stateBefore, afterTick);
        // P9: applySchemeResolutionPhase can mount state.elopement on a
        // discovered Seduction during this wrapper's advanceTickPure chain.
        publishElopementTransitions(stateBefore, afterTick);
        publishArtifactTransitions(stateBefore, afterTick);
        return { ok: true };
      },
      // ── P4 ballroom actions ───────────────────────────────────────────
      enterBallroom: () => {
        const stateBefore = get();
        if (stateBefore.houses.get(PLAYER_HOUSE_ID)?.exiled === true) {
          return { ok: false, reason: { kind: "PlayerExiled" as const } };
        }
        if (stateBefore.elopement !== null) {
          return { ok: false, reason: { kind: "ElopementInProgress" as const } };
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
        // P10: apply pre-ball composure penalty for out-of-season equipped
        // artifacts BEFORE beginSession. Snapshot semantics: deduction
        // persists; mid-ball equip/unequip does NOT re-trigger.
        const stateAfterPenalty = applyPreBallComposurePenaltyPure(stateBefore);
        if (stateAfterPenalty !== stateBefore) {
          set((draft) => {
            overwriteFromGameState(draft, stateAfterPenalty);
          });
        }
        const sessionId = conversationOrchestrator.beginSession(get().tick);
        conversationBus.publish({
          kind: "BallroomEntered",
          tick: stateBefore.tick,
          houseId: PLAYER_HOUSE_ID,
          sessionId,
        });
        return { ok: true, sessionId };
      },
      exitBallroom: (playerComposureAtExit: number) => {
        const sessionId = conversationOrchestrator.currentSessionId();
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
            otherCharactersInScene,
            targetMarriage,
            spouse,
          },
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
        if (state.elopement !== null) {
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
        if (state.elopement !== null) {
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
        if (before.elopement !== null) {
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
        if (before.elopement !== null) {
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
        if (before.elopement !== null) {
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
      spymasterIntercept: () => {
        const before = get();
        if (before.houses.get(PLAYER_HOUSE_ID)?.exiled === true) {
          return { ok: false, reason: { kind: "PlayerExiled" as const } };
        }
        if (before.elopement !== null) {
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
        if (stateBefore.elopement !== null) {
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
        publishTemptationLatchTransitions(stateBefore, tickAdvanced);
        publishCharacterDeaths(stateBefore, tickAdvanced);
        publishWhisperTransitions(stateBefore, tickAdvanced);
        publishElopementTransitions(stateBefore, tickAdvanced);
        publishArtifactTransitions(stateBefore, tickAdvanced);
        return outcome;
      },
      assignTutor: (childCharacterId: CharacterId, tutorCharacterId: CharacterId) => {
        const stateBefore = get();
        if (stateBefore.houses.get(PLAYER_HOUSE_ID)?.exiled === true) {
          return { ok: false, reason: { kind: "PlayerExiled" as const } };
        }
        if (stateBefore.elopement !== null) {
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
        if (stateBefore.elopement !== null) {
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
        if (before.elopement !== null) {
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
          publishTemptationLatchTransitions(before, after);
        }
        return {
          ok: true,
          duelId,
          outcome: finalDuel.outcome ?? "Stalemate",
        };
      },
      // ── P9: Elopement sprint actions ────────────────────────────────────
      // Free actions — no tick advance. The ONLY mutations allowed while
      // state.elopement !== null. Each direct-publishes ElopementProgressed
      // or ElopementResolved on the elopementBus.
      elopementPush: () => {
        const before = get();
        const result = applyElopementPushPure(before);
        if (!("elopement" in result)) {
          // Rejection path
          return result;
        }
        const after = result;
        set((state) => {
          overwriteFromGameState(state, after);
        });
        // If the sprint resolved (state.elopement nulled), the resolveElopement-
        // Terminal handled the effect — publish ElopementResolved directly.
        if (before.elopement !== null && after.elopement === null) {
          // Re-use the diff helper's publish path to avoid duplication.
          publishElopementTransitions(before, after);
        } else if (after.elopement !== null) {
          elopementBus.publish({
            kind: "ElopementProgressed",
            tick: after.tick,
            schemeId: after.elopement.schemeId,
            action: "Push",
            playerTilePosition: after.elopement.playerTilePosition,
            fatherTilePosition: after.elopement.fatherTilePosition,
            freshHorsesUsedCount: after.elopement.freshHorsesUsedCount,
          });
        }
        return { ok: true };
      },
      elopementFreshHorses: () => {
        const before = get();
        const result = applyElopementFreshHorsesPure(before);
        if (!("elopement" in result)) {
          return result;
        }
        const after = result;
        set((state) => {
          overwriteFromGameState(state, after);
        });
        if (before.elopement !== null && after.elopement === null) {
          publishElopementTransitions(before, after);
        } else if (after.elopement !== null) {
          elopementBus.publish({
            kind: "ElopementProgressed",
            tick: after.tick,
            schemeId: after.elopement.schemeId,
            action: "FreshHorses",
            playerTilePosition: after.elopement.playerTilePosition,
            fatherTilePosition: after.elopement.fatherTilePosition,
            freshHorsesUsedCount: after.elopement.freshHorsesUsedCount,
          });
        }
        return { ok: true };
      },
      elopementSurrender: () => {
        const before = get();
        if (before.elopement === null) {
          return { ok: false, reason: { kind: "NoActiveSprint" as const } };
        }
        const after = applyElopementSurrenderPure(before);
        set((state) => {
          overwriteFromGameState(state, after);
        });
        // Surrender always terminates; publish ElopementResolved via diff helper.
        publishElopementTransitions(before, after);
        return { ok: true };
      },
      // P10 artifact actions — all FREE ACTIONS. Modal-state gates first;
      // then pure-rule dispatch; then overwriteFromGameState.
      equipArtifact: (characterId, artifactInstanceId) => {
        const stateBefore = get();
        if (stateBefore.houses.get(PLAYER_HOUSE_ID)?.exiled === true) {
          return { ok: false, reason: { kind: "PlayerExiled" as const } };
        }
        if (stateBefore.elopement !== null) {
          return { ok: false, reason: { kind: "ElopementInProgress" as const } };
        }
        const result = applyEquipArtifactPure(stateBefore, characterId, artifactInstanceId);
        if (!result.ok) return { ok: false, reason: result.reason };
        set((state) => {
          overwriteFromGameState(state, result.state);
        });
        return { ok: true };
      },
      unequipArtifact: (characterId, artifactInstanceId) => {
        const stateBefore = get();
        if (stateBefore.houses.get(PLAYER_HOUSE_ID)?.exiled === true) {
          return { ok: false, reason: { kind: "PlayerExiled" as const } };
        }
        if (stateBefore.elopement !== null) {
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
        if (stateBefore.elopement !== null) {
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
        if (stateBefore.elopement !== null) {
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
    })),
  );
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
    elopement: state.elopement,
    // P10 additions — three new top-level Maps. Quad-sync 3rd surface.
    artifactInstances: state.artifactInstances,
    forgeries: state.forgeries,
    thiefAttempts: state.thiefAttempts,
  };
}
