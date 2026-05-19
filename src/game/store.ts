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
  type House,
  HouseSchema,
  type MarriageRecord,
  MarriageRecordSchema,
} from "./entities";
import type { LocationId } from "./fixtures/locations";
import {
  type BallSessionId,
  type CharacterId,
  type HouseId,
  INDEPENDENT_HOUSE_ID,
  type MarriageId,
  PLAYER_HOUSE_ID,
  type RngState,
  createRngState,
} from "./rng";
import { applyBankruptcyEscape, canEscapeBankruptcy } from "./rules/bankruptcyEscape";
import type { EscapeRejection } from "./rules/bankruptcyEscape";
import { resolveCombat } from "./rules/combat";
import { type AudienceOutcome, applyAudience } from "./rules/monarchsAudience";
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
};

export type StoreState = GameState & StoreActions;

export type SeasonStore = UseBoundStore<StoreApi<StoreState>>;

import { buildPersonaPrompt } from "../llm/prompts/persona";
import { routeModel } from "../llm/routing";
import type { ConversationResponse } from "../llm/types";
import { conversationOrchestrator } from "../runtime/conversationOrchestrator";
import { conversationBus } from "../runtime/events/conversation";
import type { BallEntryRejection } from "../runtime/events/conversation";
import { locationBus } from "../runtime/events/location";
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
}

export function createStore({ seed }: { seed: string }): SeasonStore {
  return create<StoreState>()(
    immer((set, get) => ({
      ...createInitialState(seed),
      advanceTick: () =>
        set((state) => {
          overwriteFromGameState(state, advanceTickPure(get()));
        }),
      runYearPass: () => {
        const before = get();
        const after = runYearPassPure(before);
        set((state) => {
          overwriteFromGameState(state, after);
        });
        // P4: detect newly-dead NPCs and publish TargetCharacterDied so
        // PersonaCacheRegistry can invalidate stale entries. Use
        // BEFORE.houses to capture the dying player head's ID (after
        // succession ran inside runYearPassPure, AFTER's player head is
        // already the heir). Excluding the player head ensures heir
        // promotion doesn't fire the event (heir inherits via stable
        // playerHouseId half of the pair key).
        const playerHeadIdBefore = before.houses.get(PLAYER_HOUSE_ID)?.headOfHouseCharacterId;
        for (const [id, c] of after.characters) {
          const wasAlive = before.characters.get(id)?.alive ?? false;
          if (wasAlive && !c.alive && id !== playerHeadIdBefore) {
            conversationBus.publish({
              kind: "TargetCharacterDied",
              tick: after.tick,
              targetCharacterId: id,
            });
          }
        }
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
        }
        return { ok: true, outcome: response };
      },
      abortBallroomRequest: () => {
        conversationOrchestrator.abortCurrent();
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
  };
}
