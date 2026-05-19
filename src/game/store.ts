import { enableMapSet } from "immer";
import { type StoreApi, type UseBoundStore, create } from "zustand";
import { immer } from "zustand/middleware/immer";
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
  type CharacterId,
  type HouseId,
  type MarriageId,
  PLAYER_HOUSE_ID,
  type RngState,
  createRngState,
} from "./rng";
import { applyBankruptcyEscape, canEscapeBankruptcy } from "./rules/bankruptcyEscape";
import type { EscapeRejection } from "./rules/bankruptcyEscape";
import { type AudienceOutcome, applyAudience } from "./rules/monarchsAudience";
import { applyTravel, canTravel } from "./rules/travel";
import type { TravelRejection } from "./rules/travel";
import { applyWardrobeRefresh, canRefreshWardrobe } from "./rules/wardrobeRefresh";
import type { WardrobeRejection } from "./rules/wardrobeRefresh";
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
  const houses = new Map<HouseId, House>();
  houses.set(seeded.house.id, seeded.house);
  const characters = new Map<CharacterId, Character>();
  characters.set(seeded.character.id, seeded.character);
  return {
    tick: 0,
    rng,
    houses,
    characters,
    marriages: new Map<MarriageId, MarriageRecord>(),
    campaignName,
    era: "Earlier",
  };
}

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
};

export type StoreState = GameState & StoreActions;

export type SeasonStore = UseBoundStore<StoreApi<StoreState>>;

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
}

export function createStore({ seed }: { seed: string }): SeasonStore {
  return create<StoreState>()(
    immer((set, get) => ({
      ...createInitialState(seed),
      advanceTick: () =>
        set((state) => {
          overwriteFromGameState(state, advanceTickPure(get()));
        }),
      runYearPass: () =>
        set((state) => {
          overwriteFromGameState(state, runYearPassPure(get()));
        }),
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
  };
}
