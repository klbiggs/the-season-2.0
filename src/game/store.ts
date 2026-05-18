import { enableMapSet } from "immer";
import { z } from "zod";
import { type StoreApi, type UseBoundStore, create } from "zustand";
import { immer } from "zustand/middleware/immer";
import {
  type HouseId,
  type RngState,
  RngStateSchema,
  createRngState,
  drawNext,
  getOrThrow,
} from "./rng";
import { PLAYER_HOUSE_ID } from "./rng.seeds";

// Immer needs explicit opt-in for Map/Set mutation tracking.
enableMapSet();

// Zod schema is the single source of truth for GameState. The TypeScript type
// is derived from it; adding a field to GameState requires extending this
// schema, which then forces a corresponding extension to `hashableState` (see
// hashable-state-extension.test.ts).
export const GameStateSchema = z.object({
  tick: z.number().int().nonnegative(),
  rng: z.map(
    z.string().transform((s) => s as HouseId),
    RngStateSchema,
  ),
});
export type GameState = z.infer<typeof GameStateSchema>;

export function createInitialState(seed: string): GameState {
  const rng = new Map<HouseId, RngState>();
  rng.set(PLAYER_HOUSE_ID, createRngState(seed));
  return { tick: 0, rng };
}

export type StoreActions = {
  // Advances tick by 1 and discards one player-house RNG draw. The discarded
  // draw moves callCount; callCount is what flows through the hash, so the P1
  // transition (removing the discard once real per-tick rule draws land) does
  // NOT change the hash invariant.
  advanceTick: () => void;
  // Atomic state swap. Used by <LoadButton /> (with fromSaveV1 output) and
  // <SeedPrompt /> (with createInitialState output). UI never observes a
  // partially-loaded state.
  replaceState: (next: GameState) => void;
};

export type StoreState = GameState & StoreActions;

export type SeasonStore = UseBoundStore<StoreApi<StoreState>>;

export function createStore({ seed }: { seed: string }): SeasonStore {
  return create<StoreState>()(
    immer((set) => ({
      ...createInitialState(seed),
      advanceTick: () =>
        set((state) => {
          const player = getOrThrow(state.rng, PLAYER_HOUSE_ID);
          const { rngState } = drawNext(player);
          state.rng.set(PLAYER_HOUSE_ID, rngState);
          state.tick += 1;
        }),
      replaceState: (next: GameState) =>
        set((state) => {
          state.tick = next.tick;
          state.rng = next.rng;
        }),
    })),
  );
}

// Project the store's combined state back to a pure GameState (drops actions).
// Used by save() and the determinism harness.
export function selectGameState(state: StoreState): GameState {
  return { tick: state.tick, rng: state.rng };
}
