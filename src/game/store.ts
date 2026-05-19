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
import {
  type CharacterId,
  type HouseId,
  type MarriageId,
  type RngState,
  createRngState,
} from "./rng";
import { PLAYER_HOUSE_ID } from "./rng.seeds";

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
  };
}

export type StoreActions = {
  // P1: Advances tick by 1 via the orchestrator's phase chain. P0's discard
  // draw is gone — real per-tick draws come from applyMoodDriftPhase and
  // future-phase rules. callCount still increments via real draws.
  advanceTick: () => void;
  // P1: Year-pass action — runs aging → succession → conception via
  // runYearPassPure. Does NOT advance tick (binding contract).
  runYearPass: () => void;
  // Atomic state swap. Used by <LoadButton /> (with fromSaveV2 output) and
  // <SeedPrompt /> (with createInitialState output). UI never observes a
  // partially-loaded state.
  replaceState: (next: GameState) => void;
};

export type StoreState = GameState & StoreActions;

export type SeasonStore = UseBoundStore<StoreApi<StoreState>>;

// Re-import here at the bottom of the file (cycle-avoidance pattern) — the
// runtime layer imports rules layer, which is OK after store.ts symbols
// have been declared above.
import { advanceTickPure } from "../runtime/tickOrchestrator";
import { runYearPassPure } from "../runtime/yearPass";

export function createStore({ seed }: { seed: string }): SeasonStore {
  return create<StoreState>()(
    immer((set, get) => ({
      ...createInitialState(seed),
      advanceTick: () =>
        set((state) => {
          const next = advanceTickPure(get());
          state.tick = next.tick;
          state.rng = next.rng;
          state.houses = next.houses;
          state.characters = next.characters;
          state.marriages = next.marriages;
          state.campaignName = next.campaignName;
        }),
      runYearPass: () =>
        set((state) => {
          const next = runYearPassPure(get());
          state.tick = next.tick;
          state.rng = next.rng;
          state.houses = next.houses;
          state.characters = next.characters;
          state.marriages = next.marriages;
          state.campaignName = next.campaignName;
        }),
      replaceState: (next: GameState) =>
        set((state) => {
          state.tick = next.tick;
          state.rng = next.rng;
          state.houses = next.houses;
          state.characters = next.characters;
          state.marriages = next.marriages;
          state.campaignName = next.campaignName;
        }),
    })),
  );
}

// Project the store's combined state back to a pure GameState (drops actions).
// Used by save() and the determinism harness.
export function selectGameState(state: StoreState): GameState {
  return {
    tick: state.tick,
    rng: state.rng,
    houses: state.houses,
    characters: state.characters,
    marriages: state.marriages,
    campaignName: state.campaignName,
  };
}
