import { z } from "zod";
import { ConversationPairKeySchema, ExchangeSchema } from "../game/conversation/types";
import {
  type Character,
  CharacterSchema,
  type GameState,
  type House,
  HouseSchema,
  MarriageRecordSchema,
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
  createRngState,
  deserializeRegistry,
  serializeRegistry,
} from "../game/rng";
import { PLAYER_HOUSE_ID } from "../game/rng";
import { DEFAULT_CAMPAIGN_NAME } from "../game/store";

// Live save-format version. P4 bumps to 5 with conversationHistory +
// affectionMap top-level GameState fields, composure + maxComposure on
// Character, and the Independent house + 5 NPCs introduced by
// migrate_v4_to_v5. Legacy toSaveV1..V4 retain their literal `version: N`
// writes; only toSaveV5 references SAVE_VERSION_CURRENT.
export const SAVE_VERSION_CURRENT = 5 as const;

// ── HousePreV4 (legacy on-disk House shape for V1/V2/V3 saves) ────────────
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

function liftLegacyHouses(
  serialized: ReadonlyArray<readonly [string, HousePreV4]>,
): GameState["houses"] {
  const out: GameState["houses"] = new Map();
  for (const [, h] of serialized) {
    out.set(h.id, defaultHouseV4Fields(h));
  }
  return out;
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

// Private Bare core — pure deserialization without Independent seeding.
// Used by migrate_v4_to_v5 (via fromSaveV4Bare in particular) and by the
// public fromSaveV1 wrapper.
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
  };
}

// Public wrapper: composes Bare + seedIndependentIntoLegacyState.
export function fromSaveV1(save: SaveV1): GameState {
  return seedIndependentIntoLegacyState(fromSaveV1Bare(save), extractPlayerSeed(save.rng));
}

// ── SaveV2 (P1 on-disk format — legacy at P3+) ────────────────────────────

export const SaveV2Schema = z.object({
  version: z.literal(2),
  tick: z.number().int().nonnegative(),
  rng: z.array(z.tuple([HouseIdSchema, RngStateSchema])),
  houses: z.array(z.tuple([HouseIdSchema, HousePreV4Schema])),
  // P4: V2 saves predate composure; route through CharacterPreV5Schema so
  // legacy saves parse and the lifter applies composure defaults.
  characters: z.array(z.tuple([CharacterIdSchema, CharacterPreV5Schema])),
  marriages: z.array(z.tuple([MarriageIdSchema, MarriageRecordSchema])),
});
export type SaveV2 = z.infer<typeof SaveV2Schema>;

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
  };
}

export function fromSaveV2(save: SaveV2): GameState {
  return seedIndependentIntoLegacyState(fromSaveV2Bare(save), extractPlayerSeed(save.rng));
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
  };
}

export function fromSaveV3(save: SaveV3): GameState {
  return seedIndependentIntoLegacyState(fromSaveV3Bare(save), extractPlayerSeed(save.rng));
}

// ── SaveV4 (P3 on-disk format — legacy at P4+) ────────────────────────────

export const SaveV4Schema = z.object({
  version: z.literal(4),
  tick: z.number().int().nonnegative(),
  rng: z.array(z.tuple([HouseIdSchema, RngStateSchema])),
  houses: z.array(z.tuple([HouseIdSchema, HouseSchema])),
  characters: z.array(z.tuple([CharacterIdSchema, CharacterPreV5Schema])),
  marriages: z.array(z.tuple([MarriageIdSchema, MarriageRecordSchema])),
  campaignName: z.string(),
  era: z.enum(["Earlier", "Later"]),
});
export type SaveV4 = z.infer<typeof SaveV4Schema>;

export function toSaveV4(state: GameState): SaveV4 {
  const charsLegacy: Array<[string, CharacterPreV5]> = [];
  for (const [id, c] of serializeRegistry(state.characters)) {
    const { composure: _co, maxComposure: _mc, ...legacy } = c;
    charsLegacy.push([id, legacy]);
  }
  return SaveV4Schema.parse({
    version: 4,
    tick: state.tick,
    rng: serializeRegistry(state.rng),
    houses: serializeRegistry(state.houses),
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
    houses: deserializeRegistry(save.houses) as GameState["houses"],
    characters: liftLegacyCharacters(save.characters),
    marriages: deserializeRegistry(save.marriages) as GameState["marriages"],
    campaignName: save.campaignName,
    era: save.era,
    conversationHistory: new Map(),
    affectionMap: new Map(),
  };
}

export function fromSaveV4(save: SaveV4): GameState {
  return seedIndependentIntoLegacyState(fromSaveV4Bare(save), extractPlayerSeed(save.rng));
}

// ── SaveV5 (P4, live save format) ─────────────────────────────────────────
// Adds conversationHistory + affectionMap to GameState; adds composure +
// maxComposure to Character; includes the Independent house + 5 NPCs.
// Characters use the LIVE CharacterSchema (composure required).

export const SaveV5Schema = z.object({
  version: z.literal(5),
  tick: z.number().int().nonnegative(),
  rng: z.array(z.tuple([HouseIdSchema, RngStateSchema])),
  houses: z.array(z.tuple([HouseIdSchema, HouseSchema])),
  characters: z.array(z.tuple([CharacterIdSchema, CharacterSchema])),
  marriages: z.array(z.tuple([MarriageIdSchema, MarriageRecordSchema])),
  campaignName: z.string(),
  era: z.enum(["Earlier", "Later"]),
  conversationHistory: z.array(z.tuple([ConversationPairKeySchema, z.array(ExchangeSchema)])),
  affectionMap: z.array(z.tuple([ConversationPairKeySchema, z.number().int().min(0).max(100)])),
});
export type SaveV5 = z.infer<typeof SaveV5Schema>;

export function toSaveV5(state: GameState): SaveV5 {
  return SaveV5Schema.parse({
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
  });
}

export function fromSaveV5(save: SaveV5): GameState {
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
  };
}
