import { z } from "zod";
import {
  CharacterSchema,
  type GameState,
  HouseSchema,
  MarriageRecordSchema,
} from "../game/entities";
import {
  CharacterIdSchema,
  HouseIdSchema,
  MarriageIdSchema,
  RngStateSchema,
  deserializeRegistry,
  serializeRegistry,
} from "../game/rng";

// Live save-format version. Renamed from SAVE_VERSION → SAVE_VERSION_CURRENT
// at P1 so existing P0 toSaveV1 callers retain a `version: 1` literal while
// new toSaveV2 callers reference SAVE_VERSION_CURRENT.
export const SAVE_VERSION_CURRENT = 2 as const;

// ── SaveV1 (legacy, P0 shape — kept for the migration runner) ─────────────

export const SaveV1Schema = z.object({
  version: z.literal(1),
  tick: z.number().int().nonnegative(),
  rng: z.array(z.tuple([z.string(), RngStateSchema])),
});
export type SaveV1 = z.infer<typeof SaveV1Schema>;

// Sync prep per §8 NFR. P1: not used by the live save path (toSaveV2 is); kept
// only for the migration runner's internal use. Writes `version: 1` literally
// since SaveV1Schema requires `z.literal(1)`.
export function toSaveV1(state: GameState): SaveV1 {
  const serialized = serializeRegistry(state.rng);
  return SaveV1Schema.parse({
    version: 1,
    tick: state.tick,
    rng: serialized,
  });
}

// P1-compat: fills the new P1 collections with empty Maps so the GameState
// contract is satisfied. The migration path overlays a seeded family.
export function fromSaveV1(save: SaveV1): GameState {
  const tuples = save.rng.map(([id, rngState]) => [id, rngState] as const);
  return {
    tick: save.tick,
    rng: deserializeRegistry(tuples) as GameState["rng"],
    houses: new Map(),
    characters: new Map(),
    marriages: new Map(),
  };
}

// ── SaveV2 (P1, live save format) ─────────────────────────────────────────

export const SaveV2Schema = z.object({
  // z.literal(2) makes the `SaveV1 | SaveV2` union properly discriminable for
  // load() to narrow via `raw.version === SAVE_VERSION_CURRENT` without an
  // explicit `as` cast.
  version: z.literal(2),
  tick: z.number().int().nonnegative(),
  rng: z.array(z.tuple([HouseIdSchema, RngStateSchema])),
  houses: z.array(z.tuple([HouseIdSchema, HouseSchema])),
  characters: z.array(z.tuple([CharacterIdSchema, CharacterSchema])),
  marriages: z.array(z.tuple([MarriageIdSchema, MarriageRecordSchema])),
});
export type SaveV2 = z.infer<typeof SaveV2Schema>;

export function toSaveV2(state: GameState): SaveV2 {
  return SaveV2Schema.parse({
    version: SAVE_VERSION_CURRENT,
    tick: state.tick,
    rng: serializeRegistry(state.rng),
    houses: serializeRegistry(state.houses),
    characters: serializeRegistry(state.characters),
    marriages: serializeRegistry(state.marriages),
  });
}

export function fromSaveV2(save: SaveV2): GameState {
  return {
    tick: save.tick,
    rng: deserializeRegistry(save.rng) as GameState["rng"],
    houses: deserializeRegistry(save.houses) as GameState["houses"],
    characters: deserializeRegistry(save.characters) as GameState["characters"],
    marriages: deserializeRegistry(save.marriages) as GameState["marriages"],
  };
}
