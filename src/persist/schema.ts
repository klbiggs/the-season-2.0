import { z } from "zod";
import { type HouseId, RngStateSchema, deserializeRegistry, serializeRegistry } from "../game/rng";
import type { GameState } from "../game/store";

export const SAVE_VERSION = 1;

export const SaveV1Schema = z.object({
  version: z.literal(1),
  tick: z.number().int().nonnegative(),
  rng: z.array(z.tuple([z.string(), RngStateSchema])),
});
export type SaveV1 = z.infer<typeof SaveV1Schema>;

// Sync prep per §8 NFR. Zod-validates on the way out so in-memory state that
// wouldn't deserialize fails loudly before it hits disk.
export function toSaveV1(state: GameState): SaveV1 {
  const serialized = serializeRegistry(state.rng);
  return SaveV1Schema.parse({
    version: SAVE_VERSION,
    tick: state.tick,
    rng: serialized,
  });
}

// Caller is responsible for Zod-validating the incoming save first; load() does
// so in dexie.ts.
export function fromSaveV1(save: SaveV1): GameState {
  const tuples = save.rng.map(([id, rngState]) => [id as HouseId, rngState] as const);
  return {
    tick: save.tick,
    rng: deserializeRegistry(tuples),
  };
}
