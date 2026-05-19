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
import { DEFAULT_CAMPAIGN_NAME } from "../game/store";

// Live save-format version. Bumped to 3 at P2 with the campaignName addition.
// Legacy toSaveV1/toSaveV2 functions retain their literal `version: N` writes;
// only toSaveV3 references SAVE_VERSION_CURRENT.
export const SAVE_VERSION_CURRENT = 3 as const;

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
// P2: campaignName defaults to DEFAULT_CAMPAIGN_NAME on lift — SaveV1 has no
// such field by construction; defaulting at the lift boundary is analogous to
// migrate_v2_to_v3 defaulting it during the migration step. This keeps
// existing parity tests (which compare lifted-V1 hash vs fresh hash) green.
export function fromSaveV1(save: SaveV1): GameState {
  const tuples = save.rng.map(([id, rngState]) => [id, rngState] as const);
  return {
    tick: save.tick,
    rng: deserializeRegistry(tuples) as GameState["rng"],
    houses: new Map(),
    characters: new Map(),
    marriages: new Map(),
    campaignName: DEFAULT_CAMPAIGN_NAME,
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

// Legacy bridge: writes `version: 2` literally (SaveV2Schema requires
// z.literal(2)). Used by tests + migration runner internals; not on the
// live save path post-P2.
export function toSaveV2(state: GameState): SaveV2 {
  return SaveV2Schema.parse({
    version: 2,
    tick: state.tick,
    rng: serializeRegistry(state.rng),
    houses: serializeRegistry(state.houses),
    characters: serializeRegistry(state.characters),
    marriages: serializeRegistry(state.marriages),
  });
}

// P2: campaignName defaults to DEFAULT_CAMPAIGN_NAME on lift. SaveV2 has no
// such field; defaulting at the lift boundary preserves the v1→v2 parity
// test unchanged (the lifted-V1→V2 hash equals fresh hash via symmetric
// defaulting on both sides of the comparison).
export function fromSaveV2(save: SaveV2): GameState {
  return {
    tick: save.tick,
    rng: deserializeRegistry(save.rng) as GameState["rng"],
    houses: deserializeRegistry(save.houses) as GameState["houses"],
    characters: deserializeRegistry(save.characters) as GameState["characters"],
    marriages: deserializeRegistry(save.marriages) as GameState["marriages"],
    campaignName: DEFAULT_CAMPAIGN_NAME,
  };
}

// ── SaveV3 (P2, live save format) ─────────────────────────────────────────
// Adds campaignName: string. The migration runner's per-step output Zod parse
// validates this shape after each step in the chain v1 → v2 → v3.

export const SaveV3Schema = z.object({
  version: z.literal(3),
  tick: z.number().int().nonnegative(),
  rng: z.array(z.tuple([HouseIdSchema, RngStateSchema])),
  houses: z.array(z.tuple([HouseIdSchema, HouseSchema])),
  characters: z.array(z.tuple([CharacterIdSchema, CharacterSchema])),
  marriages: z.array(z.tuple([MarriageIdSchema, MarriageRecordSchema])),
  campaignName: z.string(),
});
export type SaveV3 = z.infer<typeof SaveV3Schema>;

export function toSaveV3(state: GameState): SaveV3 {
  return SaveV3Schema.parse({
    version: SAVE_VERSION_CURRENT,
    tick: state.tick,
    rng: serializeRegistry(state.rng),
    houses: serializeRegistry(state.houses),
    characters: serializeRegistry(state.characters),
    marriages: serializeRegistry(state.marriages),
    campaignName: state.campaignName,
  });
}

export function fromSaveV3(save: SaveV3): GameState {
  return {
    tick: save.tick,
    rng: deserializeRegistry(save.rng) as GameState["rng"],
    houses: deserializeRegistry(save.houses) as GameState["houses"],
    characters: deserializeRegistry(save.characters) as GameState["characters"],
    marriages: deserializeRegistry(save.marriages) as GameState["marriages"],
    campaignName: save.campaignName,
  };
}
