import { enableMapSet } from "immer";
import { type StoreApi, type UseBoundStore, create } from "zustand";
import { immer } from "zustand/middleware/immer";
import {
  CONVERSATION_HISTORY_LIMIT_PER_PAIR,
  FAUX_PAS_LOCK_DURATION_IN_TICKS,
  type Stance,
  type Tactic,
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
  type GameState,
  GameStateSchema,
  type Grievance,
  type House,
  HouseSchema,
  type MarriageRecord,
  MarriageRecordSchema,
  type Scheme,
} from "./entities";
import type { LocationId } from "./fixtures/locations";
import {
  type BallSessionId,
  type CharacterId,
  type GrievanceId,
  type HouseId,
  INDEPENDENT_HOUSE_ID,
  type MarriageId,
  PLAYER_HOUSE_ID,
  type RngState,
  type SchemeId,
  createRngState,
} from "./rng";
import { applyBankruptcyEscape, canEscapeBankruptcy } from "./rules/bankruptcyEscape";
import type { EscapeRejection } from "./rules/bankruptcyEscape";
import { resolveCombat } from "./rules/combat";
import { type AudienceOutcome, applyAudience } from "./rules/monarchsAudience";
import {
  type CancelSchemeRejection,
  type StartSchemeInput,
  type StartSchemeRejection,
  cancelScheme as cancelSchemePure,
  tryStartScheme,
} from "./rules/schemes";
import { applyTravel, canTravel } from "./rules/travel";
import type { TravelRejection } from "./rules/travel";
import { applyWardrobeRefresh, canRefreshWardrobe } from "./rules/wardrobeRefresh";
import type { WardrobeRejection } from "./rules/wardrobeRefresh";
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
import { seedStartingFamily } from "./bootstrap";

export function createInitialState(
  seed: string,
  campaignName: string = DEFAULT_CAMPAIGN_NAME,
): GameState {
  const playerRng = createRngState(seed);
  const seeded = seedStartingFamily(playerRng);
  const rng = new Map<HouseId, RngState>();
  rng.set(PLAYER_HOUSE_ID, seeded.rngState);
  // P4: Independent's RNG state is deterministically derived from the
  // player seed. Required because applyMoodDriftPhase iterates every house
  // and calls getOrThrow(state.rng, houseId). Same derivation in
  // seedIndependentIntoLegacyState so fresh-state and migration paths
  // produce byte-identical Independent RNG.
  rng.set(INDEPENDENT_HOUSE_ID, createRngState(`${seed}|independent`));
  const houses = new Map<HouseId, House>();
  for (const h of seeded.houses) houses.set(h.id, h);
  const characters = new Map<CharacterId, Character>();
  for (const c of seeded.characters) characters.set(c.id, c);
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
  // the orchestrator. sendBallroomMessage threads the BYOK API key in from
  // the React caller (read via useContext(KeyContext)). All four return
  // typed discriminated unions for UI prose rendering.
  enterBallroom: () =>
    | { ok: true; sessionId: BallSessionId }
    | { ok: false; reason: BallEntryRejection };
  exitBallroom: (playerComposureAtExit: number) => void;
  sendBallroomMessage: (
    input: BallroomMessageInput,
    apiKey: string,
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
};

export type StoreState = GameState & StoreActions;

export type SeasonStore = UseBoundStore<StoreApi<StoreState>>;

import { buildPersonaPrompt } from "../llm/prompts/persona";
import { routeModel } from "../llm/routing";
import type { ConversationResponse } from "../llm/types";
import { conversationOrchestrator } from "../runtime/conversationOrchestrator";
import { conversationBus, publishCharacterDeaths } from "../runtime/events/conversation";
import type { BallEntryRejection } from "../runtime/events/conversation";
import { locationBus } from "../runtime/events/location";
import { publishSchemeTransitions, schemeBus } from "../runtime/events/scheme";
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
        const before = get();
        const after = advanceTickPure(before);
        set((state) => {
          overwriteFromGameState(state, after);
        });
        publishCharacterDeaths(before, after);
        publishSchemeTransitions(before, after);
      },
      runYearPass: () => {
        const before = get();
        const after = runYearPassPure(before);
        set((state) => {
          overwriteFromGameState(state, after);
        });
        // P5: extracted to publishCharacterDeaths shared helper. The pre-P5
        // inline TargetCharacterDied loop is REPLACED — keeping both would
        // double-publish for every death. heir-promotion safety is preserved
        // (helper reads playerHeadIdBefore from `before`).
        publishCharacterDeaths(before, after);
        // NO publishSchemeTransitions: runYearPassPure never mutates
        // state.schemes or house.grievances (verified yearPass.ts composes
        // aging + succession + conception, none of which touch those surfaces).
      },
      replaceState: (next: GameState) =>
        set((state) => {
          overwriteFromGameState(state, next);
        }),
      travel: (to: LocationId) => {
        const stateBefore = get();
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
        return { ok: true };
      },
      requestAudience: () => {
        const stateBefore = get();
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
        return { outcome };
      },
      escapeBankruptcy: () => {
        const stateBefore = get();
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
        return { ok: true };
      },
      refreshWardrobe: () => {
        const stateBefore = get();
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
        return { ok: true };
      },
      // ── P4 ballroom actions ───────────────────────────────────────────
      enterBallroom: () => {
        const stateBefore = get();
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
        const sessionId = conversationOrchestrator.beginSession(stateBefore.tick);
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
      sendBallroomMessage: async (input, apiKey) => {
        const stateBefore = get();
        // Defensive — UI should never reach this without an open session.
        if (conversationOrchestrator.currentSessionId() === null) {
          return { ok: false, reason: { reason: "cancelled" } };
        }
        if (!apiKey) {
          return { ok: false, reason: { reason: "missing-key" } };
        }
        const target = stateBefore.characters.get(input.targetCharacterId);
        const playerHead = stateBefore.houses.get(PLAYER_HOUSE_ID);
        if (target === undefined || !target.alive || playerHead === undefined) {
          return { ok: false, reason: { reason: "cancelled" } };
        }
        const pairKey = makePairKey(PLAYER_HOUSE_ID, target.id);
        const history = stateBefore.conversationHistory.get(pairKey) ?? [];
        const request = {
          targetCharacterId: target.id,
          playerHouseId: PLAYER_HOUSE_ID,
          pinnedIntent: input.pinnedTactic,
          freeformMessage: input.freeformMessage,
          history,
          persona: buildPersonaPrompt(target),
          cacheName: null,
          model: routeModel(history),
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

        const result = await conversationOrchestrator.send(request, apiKey, target);
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
  };
}
