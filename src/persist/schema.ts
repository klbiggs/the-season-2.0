import { z } from "zod";
import { ConversationPairKeySchema, ExchangeSchema } from "../game/conversation/types";
import {
  type Character,
  CharacterSchema,
  type GameState,
  type Grievance,
  type House,
  HouseSchema,
  MarriageRecordSchema,
  SchemeSchema,
} from "../game/entities";
import {
  BASELINE_NPCS,
  buildBaselineNpcCharacter,
  buildIndependentHouse,
} from "../game/fixtures/npcs";
import {
  CharacterIdSchema,
  HouseIdSchema,
  INDEPENDENT_HOUSE_ID,
  MarriageIdSchema,
  RngStateSchema,
  SchemeIdSchema,
  createRngState,
  deserializeRegistry,
  serializeRegistry,
} from "../game/rng";
import { PLAYER_HOUSE_ID } from "../game/rng";
import { DEFAULT_CAMPAIGN_NAME } from "../game/store";

// Live save-format version. P5 bumps to 6 with `schemes` top-level GameState
// field, `grievances` array on House, and the SchemeSchema + GrievanceSchema
// entity additions. Legacy toSaveV1..V5 retain their literal `version: N`
// writes; only toSaveV6 references SAVE_VERSION_CURRENT.
export const SAVE_VERSION_CURRENT = 6 as const;

// ── HousePreV4 (legacy on-disk House shape for V1/V2/V3 saves) ────────────
// Omits the 5 P3-added fields (currentLocation, etc.) AND the P5 grievances
// field. Used by SaveV2Schema + SaveV3Schema at the houses tuple position.
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

// P5: widen body to also default `grievances: []` so output is V6-compatible
// after HouseSchema gains the grievances field. Function name retained.
function defaultHouseV4Fields(h: HousePreV4): House {
  return {
    ...h,
    currentLocation: "Capital",
    consecutiveTicksAtCurrentLocation: 0,
    lastAudienceTick: null,
    wardrobeLastRefreshTick: null,
    blockadeBypassEarned: false,
    grievances: [], // NEW at P5
  };
}

function liftLegacyHouses(
  serialized: ReadonlyArray<readonly [string, HousePreV4]>,
): GameState["houses"] {
  const out: GameState["houses"] = new Map();
  for (const [, h] of serialized) {
    out.set(h.id, defaultHouseV4Fields(h));
  }
  return out;
}

// ── HousePreV6 (P5): legacy on-disk House shape for V4/V5 saves ───────────
// V4/V5 houses contain the 5 P3 fields but predate grievances. HousePreV6
// = HouseSchema.omit({ grievances: true }). Used by SaveV4Schema + SaveV5Schema.
const HousePreV6Schema = HouseSchema.omit({ grievances: true });
type HousePreV6 = z.infer<typeof HousePreV6Schema>;

function defaultHouseV6Fields(h: HousePreV6): House {
  return { ...h, grievances: [] };
}

function liftLegacyHousesFromV6Pre(
  serialized: ReadonlyArray<readonly [string, HousePreV6]>,
): GameState["houses"] {
  const out: GameState["houses"] = new Map();
  for (const [, h] of serialized) {
    out.set(h.id, defaultHouseV6Fields(h));
  }
  return out;
}

// ── Strip helpers for legacy emitters (P5) ────────────────────────────────
// After P5 widens HouseSchema with `grievances`, toSaveV2/V3/V4/V5 must
// strip the field (and the P3 fields for V2/V3) so the legacy save records
// parse against their pre-V6 schemas. Symmetric inverse of the lift helpers.
function stripGrievancesForLegacyEmit(
  entries: ReadonlyArray<readonly [string, House]>,
): Array<[string, HousePreV6]> {
  return entries.map(([id, h]) => {
    const { grievances: _g, ...rest } = h;
    return [id, rest as HousePreV6];
  });
}

function stripV6FieldsForLegacyEmit(
  entries: ReadonlyArray<readonly [string, House]>,
): Array<[string, HousePreV4]> {
  return entries.map(([id, h]) => {
    const {
      grievances: _g,
      currentLocation: _cl,
      consecutiveTicksAtCurrentLocation: _cttcl,
      lastAudienceTick: _lat,
      wardrobeLastRefreshTick: _wlrt,
      blockadeBypassEarned: _bbe,
      ...rest
    } = h;
    return [id, rest as HousePreV4];
  });
}

// ── CharacterPreV5 (P4): legacy on-disk Character shape for V2/V3/V4 saves
// without P4's composure/maxComposure. Derived via Zod's .omit() so future
// Character field additions automatically narrow the legacy alias.
const CharacterPreV5Schema = CharacterSchema.omit({
  composure: true,
  maxComposure: true,
});
type CharacterPreV5 = z.infer<typeof CharacterPreV5Schema>;

function defaultCharacterV5Fields(c: CharacterPreV5): Character {
  return { ...c, composure: 100, maxComposure: 100 };
}

function liftLegacyCharacters(
  serialized: ReadonlyArray<readonly [string, CharacterPreV5]>,
): GameState["characters"] {
  const out: GameState["characters"] = new Map();
  for (const [, c] of serialized) {
    out.set(c.id, defaultCharacterV5Fields(c));
  }
  return out;
}

// ── seedIndependentIntoLegacyState (P4) ──────────────────────────────────
// Idempotent helper: if state.houses already contains INDEPENDENT_HOUSE_ID,
// returns the input unchanged. Used by migrate_v4_to_v5 AND by the public
// fromSaveVN lifters (which wrap their Bare cores so direct-lift paths
// also seed Independent). Single source of truth for Independent's seeded
// shape via buildIndependentHouse + buildBaselineNpcCharacter from npcs.ts.
//
// playerSeed: the seed-string field of the player's RngState (NOT a
// serialized post-draw form). Must match exactly what createRngState's
// argument was at fresh-state construction so Independent's derived RNG is
// byte-identical across fresh-state and migration paths.
function seedIndependentIntoLegacyState(state: GameState, playerSeed: string): GameState {
  if (state.houses.has(INDEPENDENT_HOUSE_ID)) return state;

  const houses = new Map(state.houses);
  houses.set(INDEPENDENT_HOUSE_ID, buildIndependentHouse());

  const characters = new Map(state.characters);
  for (const npcSeed of BASELINE_NPCS) {
    if (characters.has(npcSeed.id)) continue;
    characters.set(npcSeed.id, buildBaselineNpcCharacter(npcSeed));
  }

  const rng = new Map(state.rng);
  if (!rng.has(INDEPENDENT_HOUSE_ID)) {
    rng.set(INDEPENDENT_HOUSE_ID, createRngState(`${playerSeed}|independent`));
  }

  return { ...state, houses, characters, rng };
}

// ── seedSchemesAndGrievancesIntoLegacyState (P5) ─────────────────────────
// Idempotent helper: defaults state.schemes to an empty Map (preserving any
// already-present schemes) AND defaults each house's grievances array to []
// (preserving any already-populated arrays). Called by the public fromSaveVN
// lifters (V1-V5) after seedIndependentIntoLegacyState so direct-lift paths
// produce V6-shape GameStates.
//
// At the migration runner's V5→V6 step, this helper is the seed-side of the
// bare+wrap composition: migrate_v5_to_v6 = toSaveV6 ∘ seed ∘ fromSaveV5Bare.
//
// Idempotence: a house with `grievances: []` already present is left as-is
// (the helper sets only when the field is undefined or missing). State with
// non-empty grievances arrays preserves those entries unchanged.
function seedSchemesAndGrievancesIntoLegacyState(state: GameState): GameState {
  // In practice every Bare core returns a GameState that already contains
  // `schemes: new Map()` from its own default AND houses with `grievances: []`
  // from liftLegacyHouses* helpers. This wrapper is defense-in-depth for
  // direct-lift paths that bypass the Bare cores (e.g., a manually
  // constructed test fixture). Idempotent: no-op when state is already V6-shape.
  let mutatedAnyHouse = false;
  const houses = new Map(state.houses);
  for (const [id, h] of houses) {
    // Defensive: HouseSchema makes grievances required, but a direct-lift
    // path that bypasses Zod parse may produce houses without the field.
    if ((h as House & { grievances?: Grievance[] }).grievances === undefined) {
      houses.set(id, { ...h, grievances: [] });
      mutatedAnyHouse = true;
    }
  }

  const needsSchemesDefault = (state as GameState & { schemes?: unknown }).schemes === undefined;
  if (!mutatedAnyHouse && !needsSchemesDefault) return state;
  return {
    ...state,
    schemes: needsSchemesDefault ? new Map() : state.schemes,
    houses,
  };
}

// Extracts the player seed from a save's rng tuple-array. Used by every
// public lifter to derive Independent's seed. Find-by-id (NOT positional)
// so the lookup is forward-compatible if rng-array ordering shifts.
function extractPlayerSeed(rng: ReadonlyArray<readonly [string, { seed: string }]>): string {
  const entry = rng.find(([id]) => id === PLAYER_HOUSE_ID);
  if (entry === undefined) {
    throw new Error("lifter: save.rng has no player entry");
  }
  return entry[1].seed;
}

// ── SaveV1 (legacy, P0 shape — kept for the migration runner) ─────────────

export const SaveV1Schema = z.object({
  version: z.literal(1),
  tick: z.number().int().nonnegative(),
  rng: z.array(z.tuple([z.string(), RngStateSchema])),
});
export type SaveV1 = z.infer<typeof SaveV1Schema>;

export function toSaveV1(state: GameState): SaveV1 {
  const serialized = serializeRegistry(state.rng);
  return SaveV1Schema.parse({
    version: 1,
    tick: state.tick,
    rng: serialized,
  });
}

// Private Bare core — pure deserialization without Independent/Schemes seeding.
function fromSaveV1Bare(save: SaveV1): GameState {
  const tuples = save.rng.map(([id, rngState]) => [id, rngState] as const);
  return {
    tick: save.tick,
    rng: deserializeRegistry(tuples) as GameState["rng"],
    houses: new Map(),
    characters: new Map(),
    marriages: new Map(),
    campaignName: DEFAULT_CAMPAIGN_NAME,
    era: "Earlier",
    conversationHistory: new Map(),
    affectionMap: new Map(),
    schemes: new Map(),
  };
}

// Public wrapper: composes Bare + seedIndependent + seedSchemesAndGrievances.
// The empty-houses output of Bare passes through the per-house grievance
// loop as a no-op; correct because V1 saves have no houses (player is
// seeded by migrate_v1_to_v2; Independent is seeded by seedIndependent here).
export function fromSaveV1(save: SaveV1): GameState {
  return seedSchemesAndGrievancesIntoLegacyState(
    seedIndependentIntoLegacyState(fromSaveV1Bare(save), extractPlayerSeed(save.rng)),
  );
}

// ── SaveV2 (P1 on-disk format — legacy at P3+) ────────────────────────────

export const SaveV2Schema = z.object({
  version: z.literal(2),
  tick: z.number().int().nonnegative(),
  rng: z.array(z.tuple([HouseIdSchema, RngStateSchema])),
  houses: z.array(z.tuple([HouseIdSchema, HousePreV4Schema])),
  characters: z.array(z.tuple([CharacterIdSchema, CharacterPreV5Schema])),
  marriages: z.array(z.tuple([MarriageIdSchema, MarriageRecordSchema])),
});
export type SaveV2 = z.infer<typeof SaveV2Schema>;

export function toSaveV2(state: GameState): SaveV2 {
  const housesLegacy = stripV6FieldsForLegacyEmit(serializeRegistry(state.houses));
  const charsLegacy: Array<[string, CharacterPreV5]> = [];
  for (const [id, c] of serializeRegistry(state.characters)) {
    const { composure: _co, maxComposure: _mc, ...legacy } = c;
    charsLegacy.push([id, legacy]);
  }
  return SaveV2Schema.parse({
    version: 2,
    tick: state.tick,
    rng: serializeRegistry(state.rng),
    houses: housesLegacy,
    characters: charsLegacy,
    marriages: serializeRegistry(state.marriages),
  });
}

function fromSaveV2Bare(save: SaveV2): GameState {
  return {
    tick: save.tick,
    rng: deserializeRegistry(save.rng) as GameState["rng"],
    houses: liftLegacyHouses(save.houses),
    characters: liftLegacyCharacters(save.characters),
    marriages: deserializeRegistry(save.marriages) as GameState["marriages"],
    campaignName: DEFAULT_CAMPAIGN_NAME,
    era: "Earlier",
    conversationHistory: new Map(),
    affectionMap: new Map(),
    schemes: new Map(),
  };
}

export function fromSaveV2(save: SaveV2): GameState {
  return seedSchemesAndGrievancesIntoLegacyState(
    seedIndependentIntoLegacyState(fromSaveV2Bare(save), extractPlayerSeed(save.rng)),
  );
}

// ── SaveV3 (P2 on-disk format — legacy at P3+) ────────────────────────────

export const SaveV3Schema = z.object({
  version: z.literal(3),
  tick: z.number().int().nonnegative(),
  rng: z.array(z.tuple([HouseIdSchema, RngStateSchema])),
  houses: z.array(z.tuple([HouseIdSchema, HousePreV4Schema])),
  characters: z.array(z.tuple([CharacterIdSchema, CharacterPreV5Schema])),
  marriages: z.array(z.tuple([MarriageIdSchema, MarriageRecordSchema])),
  campaignName: z.string(),
});
export type SaveV3 = z.infer<typeof SaveV3Schema>;

export function toSaveV3(state: GameState): SaveV3 {
  const housesLegacy = stripV6FieldsForLegacyEmit(serializeRegistry(state.houses));
  const charsLegacy: Array<[string, CharacterPreV5]> = [];
  for (const [id, c] of serializeRegistry(state.characters)) {
    const { composure: _co, maxComposure: _mc, ...legacy } = c;
    charsLegacy.push([id, legacy]);
  }
  return SaveV3Schema.parse({
    version: 3,
    tick: state.tick,
    rng: serializeRegistry(state.rng),
    houses: housesLegacy,
    characters: charsLegacy,
    marriages: serializeRegistry(state.marriages),
    campaignName: state.campaignName,
  });
}

function fromSaveV3Bare(save: SaveV3): GameState {
  return {
    tick: save.tick,
    rng: deserializeRegistry(save.rng) as GameState["rng"],
    houses: liftLegacyHouses(save.houses),
    characters: liftLegacyCharacters(save.characters),
    marriages: deserializeRegistry(save.marriages) as GameState["marriages"],
    campaignName: save.campaignName,
    era: "Earlier",
    conversationHistory: new Map(),
    affectionMap: new Map(),
    schemes: new Map(),
  };
}

export function fromSaveV3(save: SaveV3): GameState {
  return seedSchemesAndGrievancesIntoLegacyState(
    seedIndependentIntoLegacyState(fromSaveV3Bare(save), extractPlayerSeed(save.rng)),
  );
}

// ── SaveV4 (P3 on-disk format — legacy at P4+) ────────────────────────────
// V4 houses contain the 5 P3 fields but predate grievances → HousePreV6Schema.

export const SaveV4Schema = z.object({
  version: z.literal(4),
  tick: z.number().int().nonnegative(),
  rng: z.array(z.tuple([HouseIdSchema, RngStateSchema])),
  houses: z.array(z.tuple([HouseIdSchema, HousePreV6Schema])),
  characters: z.array(z.tuple([CharacterIdSchema, CharacterPreV5Schema])),
  marriages: z.array(z.tuple([MarriageIdSchema, MarriageRecordSchema])),
  campaignName: z.string(),
  era: z.enum(["Earlier", "Later"]),
});
export type SaveV4 = z.infer<typeof SaveV4Schema>;

export function toSaveV4(state: GameState): SaveV4 {
  const housesLegacy = stripGrievancesForLegacyEmit(serializeRegistry(state.houses));
  const charsLegacy: Array<[string, CharacterPreV5]> = [];
  for (const [id, c] of serializeRegistry(state.characters)) {
    const { composure: _co, maxComposure: _mc, ...legacy } = c;
    charsLegacy.push([id, legacy]);
  }
  return SaveV4Schema.parse({
    version: 4,
    tick: state.tick,
    rng: serializeRegistry(state.rng),
    houses: housesLegacy,
    characters: charsLegacy,
    marriages: serializeRegistry(state.marriages),
    campaignName: state.campaignName,
    era: state.era,
  });
}

// Exported (NOT just internal) — migrate_v4_to_v5 imports this to deserialize
// V4 without invoking seedIndependentIntoLegacyState twice (idempotence
// would handle it, but the split is cleaner).
export function fromSaveV4Bare(save: SaveV4): GameState {
  return {
    tick: save.tick,
    rng: deserializeRegistry(save.rng) as GameState["rng"],
    houses: liftLegacyHousesFromV6Pre(save.houses),
    characters: liftLegacyCharacters(save.characters),
    marriages: deserializeRegistry(save.marriages) as GameState["marriages"],
    campaignName: save.campaignName,
    era: save.era,
    conversationHistory: new Map(),
    affectionMap: new Map(),
    schemes: new Map(),
  };
}

export function fromSaveV4(save: SaveV4): GameState {
  return seedSchemesAndGrievancesIntoLegacyState(
    seedIndependentIntoLegacyState(fromSaveV4Bare(save), extractPlayerSeed(save.rng)),
  );
}

// ── SaveV5 (P4 on-disk format — legacy at P5+) ────────────────────────────
// V5 houses contain the 5 P3 fields but predate grievances → HousePreV6Schema.
// Characters use the LIVE CharacterSchema (composure required at V5).

export const SaveV5Schema = z.object({
  version: z.literal(5),
  tick: z.number().int().nonnegative(),
  rng: z.array(z.tuple([HouseIdSchema, RngStateSchema])),
  houses: z.array(z.tuple([HouseIdSchema, HousePreV6Schema])),
  characters: z.array(z.tuple([CharacterIdSchema, CharacterSchema])),
  marriages: z.array(z.tuple([MarriageIdSchema, MarriageRecordSchema])),
  campaignName: z.string(),
  era: z.enum(["Earlier", "Later"]),
  conversationHistory: z.array(z.tuple([ConversationPairKeySchema, z.array(ExchangeSchema)])),
  affectionMap: z.array(z.tuple([ConversationPairKeySchema, z.number().int().min(0).max(100)])),
});
export type SaveV5 = z.infer<typeof SaveV5Schema>;

export function toSaveV5(state: GameState): SaveV5 {
  const housesLegacy = stripGrievancesForLegacyEmit(serializeRegistry(state.houses));
  return SaveV5Schema.parse({
    version: 5,
    tick: state.tick,
    rng: serializeRegistry(state.rng),
    houses: housesLegacy,
    characters: serializeRegistry(state.characters),
    marriages: serializeRegistry(state.marriages),
    campaignName: state.campaignName,
    era: state.era,
    conversationHistory: serializeRegistry(state.conversationHistory),
    affectionMap: serializeRegistry(state.affectionMap),
  });
}

// Exported (NEW at P5) — migrate_v5_to_v6 imports this to deserialize V5
// without invoking seedSchemesAndGrievancesIntoLegacyState twice.
export function fromSaveV5Bare(save: SaveV5): GameState {
  return {
    tick: save.tick,
    rng: deserializeRegistry(save.rng) as GameState["rng"],
    houses: liftLegacyHousesFromV6Pre(save.houses),
    characters: deserializeRegistry(save.characters) as GameState["characters"],
    marriages: deserializeRegistry(save.marriages) as GameState["marriages"],
    campaignName: save.campaignName,
    era: save.era,
    conversationHistory: deserializeRegistry(
      save.conversationHistory,
    ) as GameState["conversationHistory"],
    affectionMap: deserializeRegistry(save.affectionMap) as GameState["affectionMap"],
    schemes: new Map(),
  };
}

export function fromSaveV5(save: SaveV5): GameState {
  // V5 saves already contain Independent by schema; no seedIndependent call.
  return seedSchemesAndGrievancesIntoLegacyState(fromSaveV5Bare(save));
}

// ── SaveV6 (P5, live save format) ─────────────────────────────────────────
// Adds `schemes` top-level Map (as tuple-array) and `grievances` on every
// House. Houses use the LIVE HouseSchema (grievances required at V6).

export const SaveV6Schema = z.object({
  version: z.literal(6),
  tick: z.number().int().nonnegative(),
  rng: z.array(z.tuple([HouseIdSchema, RngStateSchema])),
  houses: z.array(z.tuple([HouseIdSchema, HouseSchema])),
  characters: z.array(z.tuple([CharacterIdSchema, CharacterSchema])),
  marriages: z.array(z.tuple([MarriageIdSchema, MarriageRecordSchema])),
  campaignName: z.string(),
  era: z.enum(["Earlier", "Later"]),
  conversationHistory: z.array(z.tuple([ConversationPairKeySchema, z.array(ExchangeSchema)])),
  affectionMap: z.array(z.tuple([ConversationPairKeySchema, z.number().int().min(0).max(100)])),
  schemes: z.array(z.tuple([SchemeIdSchema, SchemeSchema])),
});
export type SaveV6 = z.infer<typeof SaveV6Schema>;

export function toSaveV6(state: GameState): SaveV6 {
  return SaveV6Schema.parse({
    version: SAVE_VERSION_CURRENT,
    tick: state.tick,
    rng: serializeRegistry(state.rng),
    houses: serializeRegistry(state.houses),
    characters: serializeRegistry(state.characters),
    marriages: serializeRegistry(state.marriages),
    campaignName: state.campaignName,
    era: state.era,
    conversationHistory: serializeRegistry(state.conversationHistory),
    affectionMap: serializeRegistry(state.affectionMap),
    schemes: serializeRegistry(state.schemes),
  });
}

export function fromSaveV6(save: SaveV6): GameState {
  return {
    tick: save.tick,
    rng: deserializeRegistry(save.rng) as GameState["rng"],
    houses: deserializeRegistry(save.houses) as GameState["houses"],
    characters: deserializeRegistry(save.characters) as GameState["characters"],
    marriages: deserializeRegistry(save.marriages) as GameState["marriages"],
    campaignName: save.campaignName,
    era: save.era,
    conversationHistory: deserializeRegistry(
      save.conversationHistory,
    ) as GameState["conversationHistory"],
    affectionMap: deserializeRegistry(save.affectionMap) as GameState["affectionMap"],
    schemes: deserializeRegistry(save.schemes) as GameState["schemes"],
  };
}

// Internal exports for the migration runner + tests
export type { Grievance };
