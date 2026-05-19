import { z } from "zod";
import {
  CharacterSchema,
  type GameState,
  type House,
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

// Live save-format version. Bumped to 4 at P3 with the era field +
// 5 new House fields (currentLocation, consecutiveTicksAtCurrentLocation,
// lastAudienceTick, wardrobeLastRefreshTick, blockadeBypassEarned).
// Legacy toSaveV1/toSaveV2/toSaveV3 functions retain their literal
// `version: N` writes; only toSaveV4 references SAVE_VERSION_CURRENT.
export const SAVE_VERSION_CURRENT = 4 as const;

// ── HousePreV4 (legacy on-disk House shape for V1/V2/V3 saves) ────────────
// Mirrors HouseSchema as it existed before P3, without the 5 P3-added fields.
// Used by SaveV2Schema and SaveV3Schema so legacy saves parse correctly.
// fromSaveV1/V2/V3 lift these legacy houses to live House via
// defaultHouseV4Fields helper. NOT exported — private to the lift path.
const HousePreV4Schema = z.object({
  id: HouseIdSchema,
  wealth: z.number(),
  reputation: z.number().int().min(0).max(100),
  scandal: z.number().int().min(0).max(100),
  headOfHouseCharacterId: CharacterIdSchema,
  generation: z.number().int().nonnegative(),
  ancestorSummary: z.array(z.string()),
  heirless: z.boolean(),
});
type HousePreV4 = z.infer<typeof HousePreV4Schema>;

// Defaults the 5 P3-added House fields on lift from any legacy save format.
// Symmetric with bootstrap.ts seedStartingFamily defaults so a fresh-state
// hash equals a migrated-v3-to-v4 hash (parity invariant).
function defaultHouseV4Fields(h: HousePreV4): House {
  return {
    ...h,
    currentLocation: "Capital",
    consecutiveTicksAtCurrentLocation: 0,
    lastAudienceTick: null,
    wardrobeLastRefreshTick: null,
    blockadeBypassEarned: false,
  };
}

// Map<HouseId, HousePreV4> deserialized from save-array tuples, then lifted
// element-by-element to Map<HouseId, House>.
function liftLegacyHouses(
  serialized: ReadonlyArray<readonly [string, HousePreV4]>,
): GameState["houses"] {
  const out: GameState["houses"] = new Map();
  for (const [, h] of serialized) {
    out.set(h.id, defaultHouseV4Fields(h));
  }
  return out;
}

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
// P2: campaignName defaults to DEFAULT_CAMPAIGN_NAME on lift.
// P3: era defaults to "Earlier" on lift (matches GameState fresh-state).
export function fromSaveV1(save: SaveV1): GameState {
  const tuples = save.rng.map(([id, rngState]) => [id, rngState] as const);
  return {
    tick: save.tick,
    rng: deserializeRegistry(tuples) as GameState["rng"],
    houses: new Map(),
    characters: new Map(),
    marriages: new Map(),
    campaignName: DEFAULT_CAMPAIGN_NAME,
    era: "Earlier",
  };
}

// ── SaveV2 (P1 on-disk format — legacy at P3) ──────────────────────────────

export const SaveV2Schema = z.object({
  version: z.literal(2),
  tick: z.number().int().nonnegative(),
  rng: z.array(z.tuple([HouseIdSchema, RngStateSchema])),
  // Uses HousePreV4Schema (legacy shape without 5 P3 fields). Lifters
  // apply defaultHouseV4Fields per House on read.
  houses: z.array(z.tuple([HouseIdSchema, HousePreV4Schema])),
  characters: z.array(z.tuple([CharacterIdSchema, CharacterSchema])),
  marriages: z.array(z.tuple([MarriageIdSchema, MarriageRecordSchema])),
});
export type SaveV2 = z.infer<typeof SaveV2Schema>;

// Legacy bridge: writes `version: 2` literally. Used by tests + migration
// runner internals; not on the live save path post-P3.
// Note: when serializing a live state to V2, the 5 P3 House fields are dropped
// silently — that's the legacy-format contract. The reverse trip via fromSaveV2
// re-applies defaults.
export function toSaveV2(state: GameState): SaveV2 {
  const housesLegacy: Array<[string, HousePreV4]> = [];
  for (const [id, h] of serializeRegistry(state.houses)) {
    const {
      currentLocation: _cl,
      consecutiveTicksAtCurrentLocation: _ct,
      lastAudienceTick: _la,
      wardrobeLastRefreshTick: _wr,
      blockadeBypassEarned: _bb,
      ...legacy
    } = h;
    housesLegacy.push([id, legacy]);
  }
  return SaveV2Schema.parse({
    version: 2,
    tick: state.tick,
    rng: serializeRegistry(state.rng),
    houses: housesLegacy,
    characters: serializeRegistry(state.characters),
    marriages: serializeRegistry(state.marriages),
  });
}

// P2: campaignName defaults to DEFAULT_CAMPAIGN_NAME on lift.
// P3: era defaults to "Earlier"; legacy houses lifted via defaultHouseV4Fields.
export function fromSaveV2(save: SaveV2): GameState {
  return {
    tick: save.tick,
    rng: deserializeRegistry(save.rng) as GameState["rng"],
    houses: liftLegacyHouses(save.houses),
    characters: deserializeRegistry(save.characters) as GameState["characters"],
    marriages: deserializeRegistry(save.marriages) as GameState["marriages"],
    campaignName: DEFAULT_CAMPAIGN_NAME,
    era: "Earlier",
  };
}

// ── SaveV3 (P2 on-disk format — legacy at P3) ──────────────────────────────
// Adds campaignName: string. Houses still use HousePreV4Schema (legacy).

export const SaveV3Schema = z.object({
  version: z.literal(3),
  tick: z.number().int().nonnegative(),
  rng: z.array(z.tuple([HouseIdSchema, RngStateSchema])),
  houses: z.array(z.tuple([HouseIdSchema, HousePreV4Schema])),
  characters: z.array(z.tuple([CharacterIdSchema, CharacterSchema])),
  marriages: z.array(z.tuple([MarriageIdSchema, MarriageRecordSchema])),
  campaignName: z.string(),
});
export type SaveV3 = z.infer<typeof SaveV3Schema>;

export function toSaveV3(state: GameState): SaveV3 {
  const housesLegacy: Array<[string, HousePreV4]> = [];
  for (const [id, h] of serializeRegistry(state.houses)) {
    const {
      currentLocation: _cl,
      consecutiveTicksAtCurrentLocation: _ct,
      lastAudienceTick: _la,
      wardrobeLastRefreshTick: _wr,
      blockadeBypassEarned: _bb,
      ...legacy
    } = h;
    housesLegacy.push([id, legacy]);
  }
  return SaveV3Schema.parse({
    version: 3,
    tick: state.tick,
    rng: serializeRegistry(state.rng),
    houses: housesLegacy,
    characters: serializeRegistry(state.characters),
    marriages: serializeRegistry(state.marriages),
    campaignName: state.campaignName,
  });
}

export function fromSaveV3(save: SaveV3): GameState {
  return {
    tick: save.tick,
    rng: deserializeRegistry(save.rng) as GameState["rng"],
    houses: liftLegacyHouses(save.houses),
    characters: deserializeRegistry(save.characters) as GameState["characters"],
    marriages: deserializeRegistry(save.marriages) as GameState["marriages"],
    campaignName: save.campaignName,
    era: "Earlier",
  };
}

// ── SaveV4 (P3, live save format) ─────────────────────────────────────────
// Adds era to GameState and 5 new fields to House. Houses use the live
// HouseSchema (all P3 fields required). toSaveV4 writes `version:
// SAVE_VERSION_CURRENT` (literal `4`).

export const SaveV4Schema = z.object({
  version: z.literal(4),
  tick: z.number().int().nonnegative(),
  rng: z.array(z.tuple([HouseIdSchema, RngStateSchema])),
  houses: z.array(z.tuple([HouseIdSchema, HouseSchema])),
  characters: z.array(z.tuple([CharacterIdSchema, CharacterSchema])),
  marriages: z.array(z.tuple([MarriageIdSchema, MarriageRecordSchema])),
  campaignName: z.string(),
  era: z.enum(["Earlier", "Later"]),
});
export type SaveV4 = z.infer<typeof SaveV4Schema>;

export function toSaveV4(state: GameState): SaveV4 {
  return SaveV4Schema.parse({
    version: SAVE_VERSION_CURRENT,
    tick: state.tick,
    rng: serializeRegistry(state.rng),
    houses: serializeRegistry(state.houses),
    characters: serializeRegistry(state.characters),
    marriages: serializeRegistry(state.marriages),
    campaignName: state.campaignName,
    era: state.era,
  });
}

export function fromSaveV4(save: SaveV4): GameState {
  return {
    tick: save.tick,
    rng: deserializeRegistry(save.rng) as GameState["rng"],
    houses: deserializeRegistry(save.houses) as GameState["houses"],
    characters: deserializeRegistry(save.characters) as GameState["characters"],
    marriages: deserializeRegistry(save.marriages) as GameState["marriages"],
    campaignName: save.campaignName,
    era: save.era,
  };
}
