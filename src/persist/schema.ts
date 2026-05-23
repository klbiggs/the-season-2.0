import { z } from "zod";
import { bootstrapPlayerArtifactsForMigration } from "../game/bootstrap";
import { ConversationPairKeySchema, ExchangeSchema } from "../game/conversation/types";
import {
  ArtifactInstanceSchema,
  type Character,
  CharacterSchema,
  CourierPayloadSchema,
  DuelSchema,
  ElopementSprintStateSchema,
  ForgeryRecordSchema,
  type GameState,
  type Grievance,
  type House,
  HouseSchema,
  MarriageRecordSchema,
  PatronessRecordSchema,
  PendingTutorTraitChoiceSchema,
  ProposalLogEntrySchema,
  RivalActorStateSchema,
  SchemeSchema,
  StaffMemberSchema,
  ThiefAttemptSchema,
  TutorAssignmentLogEntrySchema,
  WhisperSchema,
} from "../game/entities";
import { FACTION_PAIRS } from "../game/fixtures/factions";
import { hashCharIdToGender } from "../game/fixtures/hashCharIdToGender";
import {
  BASELINE_NPCS,
  buildBaselineNpcCharacter,
  buildIndependentHouse,
} from "../game/fixtures/npcs";
import { PATRONESSES_FIXTURE } from "../game/fixtures/patronesses";
import {
  RIVAL_CHARACTER_IDS_SET,
  RIVAL_HOUSES_FIXTURE,
  RIVAL_HOUSE_IDS_SET,
  buildRivalActorState,
  buildRivalCharacter,
  buildRivalHouse,
  buildRivalRngState,
} from "../game/fixtures/rivals";
import { buildBaselineStaffMap } from "../game/fixtures/staff";
import {
  ArtifactInstanceIdSchema,
  CharacterIdSchema,
  CourierPayloadIdSchema,
  DuelIdSchema,
  FactionPairKeySchema,
  ForgeryIdSchema,
  HouseIdSchema,
  INDEPENDENT_HOUSE_ID,
  MarriageIdSchema,
  PatronessIdSchema,
  RngStateSchema,
  SchemeIdSchema,
  StaffIdSchema,
  ThiefAttemptIdSchema,
  WhisperIdSchema,
  createRngState,
  deserializeRegistry,
  serializeRegistry,
} from "../game/rng";
import { PLAYER_HOUSE_ID } from "../game/rng";
import { DEFAULT_CAMPAIGN_NAME } from "../game/store";

// Live save-format version. P10 bumps to 11 with 3 new top-level Maps
// (artifactInstances, forgeries, thiefAttempts) + 1 new Character field
// (equippedArtifactIds: z.array(...).default([])) + 1 new SchemeKind
// (TreasonFraming). Legacy toSaveV1..V10 retain their literal `version: N`
// writes; only toSaveV11 references SAVE_VERSION_CURRENT.
export const SAVE_VERSION_CURRENT = 11 as const;

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

// P5/P6: widens body to default `grievances: []` AND `exiled: false` so
// output is V7-compatible after HouseSchema gains both fields. Function
// name retained.
function defaultHouseV4Fields(h: HousePreV4): House {
  return {
    ...h,
    currentLocation: "Capital",
    consecutiveTicksAtCurrentLocation: 0,
    lastAudienceTick: null,
    wardrobeLastRefreshTick: null,
    blockadeBypassEarned: false,
    grievances: [], // NEW at P5
    exiled: false, // NEW at P6
    // P8: defaults for the new House fields. Non-rival houses default to
    // hostility 0 + crown faction (player + Independent share this affiliation).
    hostility: 0,
    factionId: "faction-crown" as import("../game/rng").FactionId,
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

// ── HousePreV6 (P5; P6 extension): legacy on-disk House shape for V4/V5 ──
// V4/V5 houses contain the 5 P3 fields but predate grievances AND exiled.
// HousePreV6 = HouseSchema.omit({ grievances: true, exiled: true }) — P6
// extends the omit to also drop the new `exiled` field so legacy V4/V5
// saves (which never carried exiled) still parse cleanly. Used by
// SaveV4Schema + SaveV5Schema.
const HousePreV6Schema = HouseSchema.omit({ grievances: true, exiled: true });
type HousePreV6 = z.infer<typeof HousePreV6Schema>;

function defaultHouseV6Fields(h: HousePreV6): House {
  return {
    ...h,
    grievances: [],
    exiled: false,
    hostility: 0,
    factionId: "faction-crown" as import("../game/rng").FactionId,
  };
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

// ── HousePreV7 (P6): legacy on-disk House shape for V6 saves ──────────────
// V6 houses contain the 5 P3 fields + grievances but predate exiled.
// HousePreV7 = HouseSchema.omit({ exiled: true }). Used by SaveV6Schema
// (which becomes legacy at P6+). NOT exported — private to lift/migrate.
const HousePreV7Schema = HouseSchema.omit({ exiled: true });
type HousePreV7 = z.infer<typeof HousePreV7Schema>;

function defaultHouseV7Fields(h: HousePreV7): House {
  return {
    ...h,
    exiled: false,
    hostility: 0,
    factionId: "faction-crown" as import("../game/rng").FactionId,
  };
}

function liftLegacyHousesFromV7Pre(
  serialized: ReadonlyArray<readonly [string, HousePreV7]>,
): GameState["houses"] {
  const out: GameState["houses"] = new Map();
  for (const [, h] of serialized) {
    out.set(h.id, defaultHouseV7Fields(h));
  }
  return out;
}

// ── Strip helpers for legacy emitters (P5) ────────────────────────────────
// After P5 widens HouseSchema with `grievances`, toSaveV2/V3/V4/V5 must
// strip the field (and the P3 fields for V2/V3) so the legacy save records
// parse against their pre-V6 schemas. Symmetric inverse of the lift helpers.
// P6 adds stripExiledForLegacyEmit for the only new strip site at P6
// (toSaveV6 — SaveV6 predates the exiled field).
function stripGrievancesForLegacyEmit(
  entries: ReadonlyArray<readonly [string, House]>,
): Array<[string, HousePreV6]> {
  // P8: filter out rival houses — V4/V5 predate rivals; including them with
  // factionId stripped to default would corrupt lifted state (rivals would
  // come back as "faction-crown" instead of their canonical fixture faction).
  return entries
    .filter(([id]) => !RIVAL_HOUSE_IDS_SET.has(id as import("../game/rng").HouseId))
    .map(([id, h]) => {
      // P6 extension: drop exiled too — HousePreV6 (V4/V5 target) predates BOTH
      // grievances and exiled. Without exiled-drop, post-P6 toSaveV4/V5 emit
      // houses-with-exiled which the (now exiled-omitting) HousePreV6Schema
      // rejects on re-parse.
      const { grievances: _g, exiled: _e, ...rest } = h;
      return [id, rest as HousePreV6];
    });
}

function stripV6FieldsForLegacyEmit(
  entries: ReadonlyArray<readonly [string, House]>,
): Array<[string, HousePreV4]> {
  // P8: filter out rival houses — V2/V3 predate rivals; including them in
  // legacy emit would corrupt lifted state (P8 fields stripped, then seeder
  // re-adds with wrong identity).
  return entries
    .filter(([id]) => !RIVAL_HOUSE_IDS_SET.has(id as import("../game/rng").HouseId))
    .map(([id, h]) => {
      const {
        grievances: _g,
        exiled: _e, // P6 extension — HousePreV4 (V2/V3 target) predates exiled too
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

// P6: the only NEW strip site at P6. Used by toSaveV6 — SaveV6 predates
// the exiled field; the post-P6 live HouseSchema includes it, so toSaveV6
// must drop exiled before SaveV6Schema (which now uses HousePreV7Schema =
// HouseSchema.omit({exiled:true})) parses the emit.
function stripExiledForLegacyEmit(
  entries: ReadonlyArray<readonly [string, House]>,
): Array<[string, HousePreV7]> {
  // P8: filter out rival houses — V6 predates rivals.
  return entries
    .filter(([id]) => !RIVAL_HOUSE_IDS_SET.has(id as import("../game/rng").HouseId))
    .map(([id, h]) => {
      const { exiled: _e, ...rest } = h;
      return [id, rest as HousePreV7];
    });
}

// ── CharacterPreV5 (P4): legacy on-disk Character shape for V2/V3/V4 saves
// without P4's composure/maxComposure. P7 EXTENDS the omit list to also drop
// the 7 V8 fields — V2/V3/V4 saves predate ALL of them. The legacy alias is
// now "minimum pre-P4 shape, also pre-V8 fields".
const CharacterPreV5Schema = CharacterSchema.omit({
  composure: true,
  maxComposure: true,
  // P7 additions — V2/V3/V4 saves predate these too.
  happiness: true,
  temptationHookUnlocked: true,
  assignedTutorCharacterId: true,
  tutorBonusTraitGranted: true,
  dullSpouseExposureStartTick: true,
  parentCharacterIds: true,
  gender: true,
  // P10 addition — V2/V3/V4 saves predate equippedArtifactIds. Required omit
  // to prevent the field from passing through legacy save round-trips
  // (otherwise toSaveV{N}.parse leaves equippedArtifactIds on emit and the
  // round-trip contaminates downstream migration chains).
  equippedArtifactIds: true,
});
type CharacterPreV5 = z.infer<typeof CharacterPreV5Schema>;

// P7: CharacterPreV8 alias for V5/V6/V7 saves (composure-present, V8-absent).
// SaveV5/V6/V7 schemas use this alias post-P7 widening of CharacterSchema.
const CharacterPreV8Schema = CharacterSchema.omit({
  happiness: true,
  temptationHookUnlocked: true,
  assignedTutorCharacterId: true,
  tutorBonusTraitGranted: true,
  dullSpouseExposureStartTick: true,
  parentCharacterIds: true,
  gender: true,
  // P10 addition — V5/V6/V7 saves predate equippedArtifactIds.
  equippedArtifactIds: true,
});
type CharacterPreV8 = z.infer<typeof CharacterPreV8Schema>;

function defaultV8CharacterFields(
  id: import("../game/rng").CharacterId,
): Pick<
  Character,
  | "happiness"
  | "temptationHookUnlocked"
  | "assignedTutorCharacterId"
  | "tutorBonusTraitGranted"
  | "dullSpouseExposureStartTick"
  | "parentCharacterIds"
  | "gender"
> {
  return {
    happiness: 100,
    temptationHookUnlocked: false,
    assignedTutorCharacterId: null,
    tutorBonusTraitGranted: false,
    dullSpouseExposureStartTick: null,
    parentCharacterIds: null,
    gender: hashCharIdToGender(id),
  };
}

// P10: strip equippedArtifactIds from character tuples at legacy emit.
// Used by toSaveV8/V9/V10 — these formats use the LIVE CharacterSchema (post-P7
// widening) so equippedArtifactIds would otherwise pass through unfiltered.
// V2/V3/V4 use CharacterPreV5Schema and V5/V6/V7 use CharacterPreV8Schema —
// those schemas have `.omit({ equippedArtifactIds: true })` so Zod's parse
// strips at emit naturally; no helper needed for those.
//
// CRITICAL contamination guard: without this strip, a chain that emits V8
// (or higher legacy) would round-trip the field; on subsequent lift, the
// player head's equippedArtifactIds would have stale ids without matching
// artifactInstances entries, breaking the bootstrap idempotence check.
function stripEquippedArtifactsForLegacyEmit<T extends { equippedArtifactIds: unknown }>(
  characters: ReadonlyArray<readonly [string, T]>,
): Array<[string, Omit<T, "equippedArtifactIds">]> {
  return characters.map(([id, c]) => {
    const { equippedArtifactIds: _e, ...rest } = c;
    return [id, rest] as [string, Omit<T, "equippedArtifactIds">];
  });
}

function defaultCharacterV5Fields(c: CharacterPreV5): Character {
  return {
    ...c,
    composure: 100,
    maxComposure: 100,
    ...defaultV8CharacterFields(c.id),
    // P10: legacy V2/V3/V4 saves predate equippedArtifactIds. Default to [];
    // the load-path's bootstrapPlayerArtifactsForMigration then seeds the
    // player head's starting inventory symmetric with createInitialState.
    equippedArtifactIds: [],
  };
}

function defaultCharacterV8Fields(c: CharacterPreV8): Character {
  return {
    ...c,
    ...defaultV8CharacterFields(c.id),
    // P10: legacy V5/V6/V7 saves predate equippedArtifactIds. Default to [].
    equippedArtifactIds: [],
  };
}

function liftLegacyCharactersFromV8Pre(
  serialized: ReadonlyArray<readonly [string, CharacterPreV8]>,
): GameState["characters"] {
  const out: GameState["characters"] = new Map();
  for (const [, c] of serialized) {
    out.set(c.id, defaultCharacterV8Fields(c));
  }
  return out;
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
export function seedIndependentIntoLegacyState(state: GameState, playerSeed: string): GameState {
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
export function seedSchemesAndGrievancesIntoLegacyState(state: GameState): GameState {
  // In practice every Bare core returns a GameState that already contains
  // `schemes: new Map()` from its own default AND houses with `grievances: []`
  // from liftLegacyHouses* helpers. This wrapper is defense-in-depth for
  // direct-lift paths that bypass the Bare cores (e.g., a manually
  // constructed test fixture). Idempotent: no-op when state is already V6-shape.
  let mutatedAnyHouse = false;
  const houses = new Map(state.houses);
  for (const [id, h] of houses) {
    // Defensive: HouseSchema makes grievances + exiled required, but a
    // direct-lift path that bypasses Zod parse may produce houses without
    // either field. P6 extends the guard with `exiled` symmetrically.
    const hRelaxed = h as House & { grievances?: Grievance[]; exiled?: boolean };
    if (hRelaxed.grievances === undefined || hRelaxed.exiled === undefined) {
      houses.set(id, {
        ...h,
        grievances: hRelaxed.grievances ?? [],
        exiled: hRelaxed.exiled ?? false,
      });
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

// ── seedWhispersCouriersStaffIntoLegacyState (P6) ────────────────────────
// Idempotent helper: defaults state.whispers/.couriers to empty Maps, AND
// seeds state.staff with buildBaselineStaffMap() ONLY when staff is missing
// or empty (preserves runtime-mutated staff state on direct-lift re-entry).
// Also defensively defaults each house's exiled flag to false (the Bare
// cores' lift helpers already do this, but direct-lift paths that bypass
// the Bare core may produce houses without the field).
//
// Called by the public fromSaveVN lifters (V1-V6) after the existing seed
// helpers so direct-lift paths produce V7-shape GameStates. Migration
// runner's V6→V7 step also calls this as the seed-side of bare+wrap.
//
// Idempotence: a state with non-empty staff is preserved unchanged (the
// size-check `state.staff.size === 0` is the load-bearing branch — a
// reassigned/bribed runtime state through the migration runner must NOT
// reset to the baseline four).
export function seedWhispersCouriersStaffIntoLegacyState(state: GameState): GameState {
  const needsWhispersDefault = (state as GameState & { whispers?: unknown }).whispers === undefined;
  const needsCouriersDefault = (state as GameState & { couriers?: unknown }).couriers === undefined;
  const staffRaw = (state as GameState & { staff?: GameState["staff"] }).staff;
  const needsStaffSeed = staffRaw === undefined || staffRaw.size === 0;

  // Houses: defensively default exiled per the same direct-lift discipline
  // as seedSchemesAndGrievancesIntoLegacyState — the helper composes both;
  // the order is seedSchemes... → seedWhispers... so the second pass sees
  // already-defaulted grievances.
  let mutatedAnyHouse = false;
  const houses = new Map(state.houses);
  for (const [id, h] of houses) {
    const hRelaxed = h as House & { exiled?: boolean };
    if (hRelaxed.exiled === undefined) {
      houses.set(id, { ...h, exiled: false });
      mutatedAnyHouse = true;
    }
  }

  if (!needsWhispersDefault && !needsCouriersDefault && !needsStaffSeed && !mutatedAnyHouse) {
    return state;
  }

  return {
    ...state,
    whispers: needsWhispersDefault ? new Map() : state.whispers,
    couriers: needsCouriersDefault ? new Map() : state.couriers,
    staff: needsStaffSeed ? buildBaselineStaffMap() : staffRaw,
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
    whispers: new Map(),
    couriers: new Map(),
    staff: new Map(),
    proposalsLog: new Map(),
    tutorAssignmentsLog: new Map(),
    pendingTutorTraitChoices: new Map(),
    // P8: empty placeholders for the 4 new top-level Maps. Public wrappers
    // compose with seedRivalsAndPatronessesIntoLegacyState to fill them in
    // from RIVAL_HOUSES_FIXTURE + PATRONESSES_FIXTURE + FACTION_PAIRS.
    patronesses: new Map(),
    rivalActors: new Map(),
    factionTensions: new Map(),
    duels: new Map(),
    // P9: elopement field defaults to null on every legacy lift.
    elopement: null,
    artifactInstances: new Map(),
    forgeries: new Map(),
    thiefAttempts: new Map(),
  };
}

// Public wrapper: composes Bare + seedIndependent + seedSchemesAndGrievances.
// The empty-houses output of Bare passes through the per-house grievance
// loop as a no-op; correct because V1 saves have no houses (player is
// seeded by migrate_v1_to_v2; Independent is seeded by seedIndependent here).
export function fromSaveV1(save: SaveV1): GameState {
  const playerSeed = extractPlayerSeed(save.rng);
  const result = seedRivalsAndPatronessesIntoLegacyState(
    seedWhispersCouriersStaffIntoLegacyState(
      seedSchemesAndGrievancesIntoLegacyState(
        seedIndependentIntoLegacyState(fromSaveV1Bare(save), playerSeed),
      ),
    ),
    playerSeed,
  );
  // P9: elopement field defaults to null on every legacy lift (no active
  // sprint can exist in a pre-P9 save format).
  // P10: bootstrap player artifact inventory symmetric with createInitialState.
  return bootstrapPlayerArtifactsForMigration({ ...result, elopement: null });
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
    // P8: skip rival characters — V2 predates rivals; round-tripping them
    // through CharacterPreV5 corrupts gender (lift derives via hashCharIdToGender
    // which may not match fixture-authored gender).
    if (RIVAL_CHARACTER_IDS_SET.has(id as import("../game/rng").CharacterId)) continue;
    const { composure: _co, maxComposure: _mc, ...legacy } = c;
    charsLegacy.push([id, legacy]);
  }
  // P8: also strip rival RNG entries from V2 — they don't have anchoring
  // rival houses on disk and would parse as orphans.
  const rngLegacy = serializeRegistry(state.rng).filter(([id]) => !RIVAL_HOUSE_IDS_SET.has(id));
  return SaveV2Schema.parse({
    version: 2,
    tick: state.tick,
    rng: rngLegacy,
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
    whispers: new Map(),
    couriers: new Map(),
    staff: new Map(),
    proposalsLog: new Map(),
    tutorAssignmentsLog: new Map(),
    pendingTutorTraitChoices: new Map(),
    // P8: empty placeholders for the 4 new top-level Maps. Public wrappers
    // compose with seedRivalsAndPatronessesIntoLegacyState to fill them in
    // from RIVAL_HOUSES_FIXTURE + PATRONESSES_FIXTURE + FACTION_PAIRS.
    patronesses: new Map(),
    rivalActors: new Map(),
    factionTensions: new Map(),
    duels: new Map(),
    // P9: elopement field defaults to null on every legacy lift.
    elopement: null,
    artifactInstances: new Map(),
    forgeries: new Map(),
    thiefAttempts: new Map(),
  };
}

export function fromSaveV2(save: SaveV2): GameState {
  const playerSeed = extractPlayerSeed(save.rng);
  const result = seedRivalsAndPatronessesIntoLegacyState(
    seedWhispersCouriersStaffIntoLegacyState(
      seedSchemesAndGrievancesIntoLegacyState(
        seedIndependentIntoLegacyState(fromSaveV2Bare(save), playerSeed),
      ),
    ),
    playerSeed,
  );
  // P10: bootstrap player artifact inventory symmetric with createInitialState.
  return bootstrapPlayerArtifactsForMigration({ ...result, elopement: null });
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
    if (RIVAL_CHARACTER_IDS_SET.has(id as import("../game/rng").CharacterId)) continue;
    const { composure: _co, maxComposure: _mc, ...legacy } = c;
    charsLegacy.push([id, legacy]);
  }
  const rngLegacy = serializeRegistry(state.rng).filter(([id]) => !RIVAL_HOUSE_IDS_SET.has(id));
  return SaveV3Schema.parse({
    version: 3,
    tick: state.tick,
    rng: rngLegacy,
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
    whispers: new Map(),
    couriers: new Map(),
    staff: new Map(),
    proposalsLog: new Map(),
    tutorAssignmentsLog: new Map(),
    pendingTutorTraitChoices: new Map(),
    // P8: empty placeholders for the 4 new top-level Maps. Public wrappers
    // compose with seedRivalsAndPatronessesIntoLegacyState to fill them in
    // from RIVAL_HOUSES_FIXTURE + PATRONESSES_FIXTURE + FACTION_PAIRS.
    patronesses: new Map(),
    rivalActors: new Map(),
    factionTensions: new Map(),
    duels: new Map(),
    // P9: elopement field defaults to null on every legacy lift.
    elopement: null,
    artifactInstances: new Map(),
    forgeries: new Map(),
    thiefAttempts: new Map(),
  };
}

export function fromSaveV3(save: SaveV3): GameState {
  const playerSeed = extractPlayerSeed(save.rng);
  const result = seedRivalsAndPatronessesIntoLegacyState(
    seedWhispersCouriersStaffIntoLegacyState(
      seedSchemesAndGrievancesIntoLegacyState(
        seedIndependentIntoLegacyState(fromSaveV3Bare(save), playerSeed),
      ),
    ),
    playerSeed,
  );
  // P10: bootstrap player artifact inventory symmetric with createInitialState.
  return bootstrapPlayerArtifactsForMigration({ ...result, elopement: null });
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
    if (RIVAL_CHARACTER_IDS_SET.has(id as import("../game/rng").CharacterId)) continue;
    const { composure: _co, maxComposure: _mc, ...legacy } = c;
    charsLegacy.push([id, legacy]);
  }
  const rngLegacy = serializeRegistry(state.rng).filter(([id]) => !RIVAL_HOUSE_IDS_SET.has(id));
  return SaveV4Schema.parse({
    version: 4,
    tick: state.tick,
    rng: rngLegacy,
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
    whispers: new Map(),
    couriers: new Map(),
    staff: new Map(),
    proposalsLog: new Map(),
    tutorAssignmentsLog: new Map(),
    pendingTutorTraitChoices: new Map(),
    // P8: empty placeholders for the 4 new top-level Maps. Public wrappers
    // compose with seedRivalsAndPatronessesIntoLegacyState to fill them in
    // from RIVAL_HOUSES_FIXTURE + PATRONESSES_FIXTURE + FACTION_PAIRS.
    patronesses: new Map(),
    rivalActors: new Map(),
    factionTensions: new Map(),
    duels: new Map(),
    // P9: elopement field defaults to null on every legacy lift.
    elopement: null,
    artifactInstances: new Map(),
    forgeries: new Map(),
    thiefAttempts: new Map(),
  };
}

export function fromSaveV4(save: SaveV4): GameState {
  const playerSeed = extractPlayerSeed(save.rng);
  const result = seedRivalsAndPatronessesIntoLegacyState(
    seedWhispersCouriersStaffIntoLegacyState(
      seedSchemesAndGrievancesIntoLegacyState(
        seedIndependentIntoLegacyState(fromSaveV4Bare(save), playerSeed),
      ),
    ),
    playerSeed,
  );
  // P10: bootstrap player artifact inventory symmetric with createInitialState.
  return bootstrapPlayerArtifactsForMigration({ ...result, elopement: null });
}

// ── SaveV5 (P4 on-disk format — legacy at P5+) ────────────────────────────
// V5 houses contain the 5 P3 fields but predate grievances → HousePreV6Schema.
// Characters use the LIVE CharacterSchema (composure required at V5).

export const SaveV5Schema = z.object({
  version: z.literal(5),
  tick: z.number().int().nonnegative(),
  rng: z.array(z.tuple([HouseIdSchema, RngStateSchema])),
  houses: z.array(z.tuple([HouseIdSchema, HousePreV6Schema])),
  characters: z.array(z.tuple([CharacterIdSchema, CharacterPreV8Schema])),
  marriages: z.array(z.tuple([MarriageIdSchema, MarriageRecordSchema])),
  campaignName: z.string(),
  era: z.enum(["Earlier", "Later"]),
  conversationHistory: z.array(z.tuple([ConversationPairKeySchema, z.array(ExchangeSchema)])),
  affectionMap: z.array(z.tuple([ConversationPairKeySchema, z.number().int().min(0).max(100)])),
});
export type SaveV5 = z.infer<typeof SaveV5Schema>;

export function toSaveV5(state: GameState): SaveV5 {
  const housesLegacy = stripGrievancesForLegacyEmit(serializeRegistry(state.houses));
  const charsLegacy = serializeRegistry(state.characters).filter(
    ([id]) => !RIVAL_CHARACTER_IDS_SET.has(id),
  );
  const rngLegacy = serializeRegistry(state.rng).filter(([id]) => !RIVAL_HOUSE_IDS_SET.has(id));
  return SaveV5Schema.parse({
    version: 5,
    tick: state.tick,
    rng: rngLegacy,
    houses: housesLegacy,
    characters: charsLegacy,
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
    characters: liftLegacyCharactersFromV8Pre(save.characters),
    marriages: deserializeRegistry(save.marriages) as GameState["marriages"],
    campaignName: save.campaignName,
    era: save.era,
    conversationHistory: deserializeRegistry(
      save.conversationHistory,
    ) as GameState["conversationHistory"],
    affectionMap: deserializeRegistry(save.affectionMap) as GameState["affectionMap"],
    schemes: new Map(),
    whispers: new Map(),
    couriers: new Map(),
    staff: new Map(),
    proposalsLog: new Map(),
    tutorAssignmentsLog: new Map(),
    pendingTutorTraitChoices: new Map(),
    // P8: empty placeholders for the 4 new top-level Maps. Public wrappers
    // compose with seedRivalsAndPatronessesIntoLegacyState to fill them in
    // from RIVAL_HOUSES_FIXTURE + PATRONESSES_FIXTURE + FACTION_PAIRS.
    patronesses: new Map(),
    rivalActors: new Map(),
    factionTensions: new Map(),
    duels: new Map(),
    // P9: elopement field defaults to null on every legacy lift.
    elopement: null,
    artifactInstances: new Map(),
    forgeries: new Map(),
    thiefAttempts: new Map(),
  };
}

export function fromSaveV5(save: SaveV5): GameState {
  // V5 saves already contain Independent by schema; no seedIndependent call.
  const playerSeed = extractPlayerSeed(save.rng);
  const result = seedRivalsAndPatronessesIntoLegacyState(
    seedWhispersCouriersStaffIntoLegacyState(
      seedSchemesAndGrievancesIntoLegacyState(fromSaveV5Bare(save)),
    ),
    playerSeed,
  );
  // P10: bootstrap player artifact inventory symmetric with createInitialState.
  return bootstrapPlayerArtifactsForMigration(result);
}

// ── SaveV6 (P5 on-disk format — legacy at P6+) ────────────────────────────
// V6 houses contain the 5 P3 fields + grievances but predate exiled.
// Houses tuple value swaps from LIVE HouseSchema to HousePreV7Schema
// at P6 (which omits exiled). emitter strips exiled via stripExiledForLegacyEmit;
// reader lifts via liftLegacyHousesFromV7Pre.

export const SaveV6Schema = z.object({
  version: z.literal(6),
  tick: z.number().int().nonnegative(),
  rng: z.array(z.tuple([HouseIdSchema, RngStateSchema])),
  houses: z.array(z.tuple([HouseIdSchema, HousePreV7Schema])),
  characters: z.array(z.tuple([CharacterIdSchema, CharacterPreV8Schema])),
  marriages: z.array(z.tuple([MarriageIdSchema, MarriageRecordSchema])),
  campaignName: z.string(),
  era: z.enum(["Earlier", "Later"]),
  conversationHistory: z.array(z.tuple([ConversationPairKeySchema, z.array(ExchangeSchema)])),
  affectionMap: z.array(z.tuple([ConversationPairKeySchema, z.number().int().min(0).max(100)])),
  schemes: z.array(z.tuple([SchemeIdSchema, SchemeSchema])),
});
export type SaveV6 = z.infer<typeof SaveV6Schema>;

export function toSaveV6(state: GameState): SaveV6 {
  // P6: only NEW strip site at P6 — drops exiled from live House shape
  // before SaveV6Schema (HousePreV7Schema houses) parses the emit.
  const housesLegacy = stripExiledForLegacyEmit(serializeRegistry(state.houses));
  const charsLegacy = serializeRegistry(state.characters).filter(
    ([id]) => !RIVAL_CHARACTER_IDS_SET.has(id),
  );
  const rngLegacy = serializeRegistry(state.rng).filter(([id]) => !RIVAL_HOUSE_IDS_SET.has(id));
  return SaveV6Schema.parse({
    version: 6,
    tick: state.tick,
    rng: rngLegacy,
    houses: housesLegacy,
    characters: charsLegacy,
    marriages: serializeRegistry(state.marriages),
    campaignName: state.campaignName,
    era: state.era,
    conversationHistory: serializeRegistry(state.conversationHistory),
    affectionMap: serializeRegistry(state.affectionMap),
    schemes: serializeRegistry(state.schemes),
  });
}

// Exported (NEW at P6) — migrate_v6_to_v7 imports this Bare core directly
// so the migration runner doesn't double-invoke seedWhispersCouriersStaff.
export function fromSaveV6Bare(save: SaveV6): GameState {
  return {
    tick: save.tick,
    rng: deserializeRegistry(save.rng) as GameState["rng"],
    houses: liftLegacyHousesFromV7Pre(save.houses),
    characters: liftLegacyCharactersFromV8Pre(save.characters),
    marriages: deserializeRegistry(save.marriages) as GameState["marriages"],
    campaignName: save.campaignName,
    era: save.era,
    conversationHistory: deserializeRegistry(
      save.conversationHistory,
    ) as GameState["conversationHistory"],
    affectionMap: deserializeRegistry(save.affectionMap) as GameState["affectionMap"],
    schemes: deserializeRegistry(save.schemes) as GameState["schemes"],
    whispers: new Map(),
    couriers: new Map(),
    staff: new Map(),
    proposalsLog: new Map(),
    tutorAssignmentsLog: new Map(),
    pendingTutorTraitChoices: new Map(),
    // P8: empty placeholders for the 4 new top-level Maps. Public wrappers
    // compose with seedRivalsAndPatronessesIntoLegacyState to fill them in
    // from RIVAL_HOUSES_FIXTURE + PATRONESSES_FIXTURE + FACTION_PAIRS.
    patronesses: new Map(),
    rivalActors: new Map(),
    factionTensions: new Map(),
    duels: new Map(),
    // P9: elopement field defaults to null on every legacy lift.
    elopement: null,
    artifactInstances: new Map(),
    forgeries: new Map(),
    thiefAttempts: new Map(),
  };
}

export function fromSaveV6(save: SaveV6): GameState {
  // V6 saves don't carry whispers/couriers/staff; the seeder produces baseline
  // staff and empty whispers/couriers so the resulting GameState matches a
  // fresh-state hash post-P6.
  const playerSeed = extractPlayerSeed(save.rng);
  // P10: bootstrap player artifact inventory symmetric with createInitialState.
  return bootstrapPlayerArtifactsForMigration(
    seedRivalsAndPatronessesIntoLegacyState(
      seedWhispersCouriersStaffIntoLegacyState(fromSaveV6Bare(save)),
      playerSeed,
    ),
  );
}

// ── SaveV7 (P6 on-disk format — legacy at P7+) ────────────────────────────
// V7 saves predate the 7 V8 character fields + 3 new top-level Maps.
// Characters tuple value uses CharacterPreV8Schema (live shape minus V8
// fields). Houses + Marriages + the other top-level Maps stay LIVE.

export const SaveV7Schema = z.object({
  version: z.literal(7),
  tick: z.number().int().nonnegative(),
  rng: z.array(z.tuple([HouseIdSchema, RngStateSchema])),
  houses: z.array(z.tuple([HouseIdSchema, HouseSchema])),
  characters: z.array(z.tuple([CharacterIdSchema, CharacterPreV8Schema])),
  marriages: z.array(z.tuple([MarriageIdSchema, MarriageRecordSchema])),
  campaignName: z.string(),
  era: z.enum(["Earlier", "Later"]),
  conversationHistory: z.array(z.tuple([ConversationPairKeySchema, z.array(ExchangeSchema)])),
  affectionMap: z.array(z.tuple([ConversationPairKeySchema, z.number().int().min(0).max(100)])),
  schemes: z.array(z.tuple([SchemeIdSchema, SchemeSchema])),
  whispers: z.array(z.tuple([WhisperIdSchema, WhisperSchema])),
  couriers: z.array(z.tuple([CourierPayloadIdSchema, CourierPayloadSchema])),
  staff: z.array(z.tuple([StaffIdSchema, StaffMemberSchema])),
});
export type SaveV7 = z.infer<typeof SaveV7Schema>;

// P7: V7 emitter strips the 7 V8 character fields. The post-P7 live
// CharacterSchema includes them; toSaveV7 must drop them before emit so the
// SaveV7Schema (which uses CharacterPreV8Schema) accepts the parse.
function stripV8CharacterFieldsForLegacyEmit(
  entries: ReadonlyArray<readonly [string, Character]>,
): Array<[string, CharacterPreV8]> {
  return entries.map(([id, c]) => {
    const {
      happiness: _h,
      temptationHookUnlocked: _t,
      assignedTutorCharacterId: _at,
      tutorBonusTraitGranted: _bt,
      dullSpouseExposureStartTick: _ds,
      parentCharacterIds: _p,
      gender: _g,
      ...rest
    } = c;
    return [id, rest as CharacterPreV8];
  });
}

export function toSaveV7(state: GameState): SaveV7 {
  // P8: V7 predates rival houses + characters. Filter both out of the
  // legacy emit so the V9 seeder can re-add them with canonical fixture
  // identity (factionId, gender) on lift.
  const housesLegacy = serializeRegistry(state.houses).filter(
    ([id]) => !RIVAL_HOUSE_IDS_SET.has(id),
  );
  const charsLegacy = stripV8CharacterFieldsForLegacyEmit(
    serializeRegistry(state.characters).filter(([id]) => !RIVAL_CHARACTER_IDS_SET.has(id)),
  );
  const rngLegacy = serializeRegistry(state.rng).filter(([id]) => !RIVAL_HOUSE_IDS_SET.has(id));
  return SaveV7Schema.parse({
    version: 7,
    tick: state.tick,
    rng: rngLegacy,
    houses: housesLegacy,
    characters: charsLegacy,
    marriages: serializeRegistry(state.marriages),
    campaignName: state.campaignName,
    era: state.era,
    conversationHistory: serializeRegistry(state.conversationHistory),
    affectionMap: serializeRegistry(state.affectionMap),
    schemes: serializeRegistry(state.schemes),
    whispers: serializeRegistry(state.whispers),
    couriers: serializeRegistry(state.couriers),
    staff: serializeRegistry(state.staff),
  });
}

// Exported (NEW at P7) — migrate_v7_to_v8 imports this Bare core directly
// so the migration runner doesn't double-invoke the V8 field seeder.
export function fromSaveV7Bare(save: SaveV7): GameState {
  return {
    tick: save.tick,
    rng: deserializeRegistry(save.rng) as GameState["rng"],
    houses: deserializeRegistry(save.houses) as GameState["houses"],
    characters: liftLegacyCharactersFromV8Pre(save.characters),
    marriages: deserializeRegistry(save.marriages) as GameState["marriages"],
    campaignName: save.campaignName,
    era: save.era,
    conversationHistory: deserializeRegistry(
      save.conversationHistory,
    ) as GameState["conversationHistory"],
    affectionMap: deserializeRegistry(save.affectionMap) as GameState["affectionMap"],
    schemes: deserializeRegistry(save.schemes) as GameState["schemes"],
    whispers: deserializeRegistry(save.whispers) as GameState["whispers"],
    couriers: deserializeRegistry(save.couriers) as GameState["couriers"],
    staff: deserializeRegistry(save.staff) as GameState["staff"],
    proposalsLog: new Map(),
    tutorAssignmentsLog: new Map(),
    pendingTutorTraitChoices: new Map(),
    // P8: empty placeholders for the 4 new top-level Maps. Public wrappers
    // compose with seedRivalsAndPatronessesIntoLegacyState to fill them in
    // from RIVAL_HOUSES_FIXTURE + PATRONESSES_FIXTURE + FACTION_PAIRS.
    patronesses: new Map(),
    rivalActors: new Map(),
    factionTensions: new Map(),
    duels: new Map(),
    // P9: elopement field defaults to null on every legacy lift.
    elopement: null,
    artifactInstances: new Map(),
    forgeries: new Map(),
    thiefAttempts: new Map(),
  };
}

export function fromSaveV7(save: SaveV7): GameState {
  // V7 saves predate the 3 new top-level Maps; seeded as empty by the Bare core.
  // V7 already contains Independent NPCs + schemes + grievances + whispers/
  // couriers/staff by schema. P8 adds the V9 seeder for rivals + patronesses.
  // P10: bootstrap player artifact inventory symmetric with createInitialState.
  return bootstrapPlayerArtifactsForMigration(
    seedRivalsAndPatronessesIntoLegacyState(fromSaveV7Bare(save), extractPlayerSeed(save.rng)),
  );
}

// ── SaveV8 (P7, live save format) ─────────────────────────────────────────
// Adds 7 new Character fields (happiness, temptationHookUnlocked,
// assignedTutorCharacterId, tutorBonusTraitGranted, dullSpouseExposureStartTick,
// parentCharacterIds, gender) and 3 new top-level Maps (proposalsLog,
// tutorAssignmentsLog, pendingTutorTraitChoices). Characters tuple uses the
// LIVE CharacterSchema (post-P7 widening).

export const SaveV8Schema = z.object({
  version: z.literal(8),
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
  whispers: z.array(z.tuple([WhisperIdSchema, WhisperSchema])),
  couriers: z.array(z.tuple([CourierPayloadIdSchema, CourierPayloadSchema])),
  staff: z.array(z.tuple([StaffIdSchema, StaffMemberSchema])),
  proposalsLog: z.array(z.tuple([CharacterIdSchema, ProposalLogEntrySchema])),
  tutorAssignmentsLog: z.array(z.tuple([CharacterIdSchema, TutorAssignmentLogEntrySchema])),
  pendingTutorTraitChoices: z.array(z.tuple([CharacterIdSchema, PendingTutorTraitChoiceSchema])),
});
export type SaveV8 = z.infer<typeof SaveV8Schema>;

export function toSaveV8(state: GameState): SaveV8 {
  // P8: SaveV8 is no longer current (V9 is). Emit literal version: 8.
  // V8 predates rivals — filter rival houses/chars/rng out of the legacy emit.
  const housesLegacy = serializeRegistry(state.houses).filter(
    ([id]) => !RIVAL_HOUSE_IDS_SET.has(id),
  );
  const charsLegacy = stripEquippedArtifactsForLegacyEmit(
    serializeRegistry(state.characters).filter(([id]) => !RIVAL_CHARACTER_IDS_SET.has(id)),
  );
  const rngLegacy = serializeRegistry(state.rng).filter(([id]) => !RIVAL_HOUSE_IDS_SET.has(id));
  return SaveV8Schema.parse({
    version: 8,
    tick: state.tick,
    rng: rngLegacy,
    houses: housesLegacy,
    characters: charsLegacy,
    marriages: serializeRegistry(state.marriages),
    campaignName: state.campaignName,
    era: state.era,
    conversationHistory: serializeRegistry(state.conversationHistory),
    affectionMap: serializeRegistry(state.affectionMap),
    schemes: serializeRegistry(state.schemes),
    whispers: serializeRegistry(state.whispers),
    couriers: serializeRegistry(state.couriers),
    staff: serializeRegistry(state.staff),
    proposalsLog: serializeRegistry(state.proposalsLog),
    tutorAssignmentsLog: serializeRegistry(state.tutorAssignmentsLog),
    pendingTutorTraitChoices: serializeRegistry(state.pendingTutorTraitChoices),
  });
}

// Bare V8 deserialize — no rival/patroness seeding. Used by migrate_v8_to_v9
// and by the public fromSaveV8 wrapper.
export function fromSaveV8Bare(save: SaveV8): GameState {
  // Convert Map<HouseId, House> by deserializing the array form. The House
  // entities carry the .default() Zod backfill for hostility/factionId; the
  // grievances within carry the .default(null) backfill for defendantCharacterId.
  const partial: Omit<
    GameState,
    | "patronesses"
    | "rivalActors"
    | "factionTensions"
    | "duels"
    | "elopement"
    | "artifactInstances"
    | "forgeries"
    | "thiefAttempts"
  > = {
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
    whispers: deserializeRegistry(save.whispers) as GameState["whispers"],
    couriers: deserializeRegistry(save.couriers) as GameState["couriers"],
    staff: deserializeRegistry(save.staff) as GameState["staff"],
    proposalsLog: deserializeRegistry(save.proposalsLog) as GameState["proposalsLog"],
    tutorAssignmentsLog: deserializeRegistry(
      save.tutorAssignmentsLog,
    ) as GameState["tutorAssignmentsLog"],
    pendingTutorTraitChoices: deserializeRegistry(
      save.pendingTutorTraitChoices,
    ) as GameState["pendingTutorTraitChoices"],
  };
  // P8: empty placeholders for the 4 new top-level Maps. Public wrapper
  // composes with seedRivalsAndPatronessesIntoLegacyState to populate.
  return {
    ...partial,
    patronesses: new Map(),
    rivalActors: new Map(),
    factionTensions: new Map(),
    duels: new Map(),
    elopement: null,
    artifactInstances: new Map(),
    forgeries: new Map(),
    thiefAttempts: new Map(),
  } as GameState;
}

export function fromSaveV8(save: SaveV8): GameState {
  // V8 is no longer live at P8+. Wrap the Bare core with the V9 seeder so
  // direct-lift consumers (tests + future direct-load paths) produce V9-shape
  // GameStates with rivals/patronesses/factionTensions/duels seeded. The P9
  // elopement field + P10 three Maps default empty.
  const playerSeed = extractPlayerSeed(save.rng);
  const bare = fromSaveV8Bare(save);
  const withP9AndP10: GameState = {
    ...bare,
    patronesses: new Map(),
    rivalActors: new Map(),
    factionTensions: new Map(),
    duels: new Map(),
    elopement: null,
    artifactInstances: new Map(),
    forgeries: new Map(),
    thiefAttempts: new Map(),
  };
  // P10: bootstrap player artifact inventory symmetric with createInitialState.
  return bootstrapPlayerArtifactsForMigration(
    seedRivalsAndPatronessesIntoLegacyState(withP9AndP10, playerSeed),
  );
}

// ── SaveV9 (P8 live format) ───────────────────────────────────────────────
// Adds 2 new House fields (hostility, factionId) + 1 new Grievance field
// (defendantCharacterId, nullable) + 4 new top-level Maps (patronesses,
// rivalActors, factionTensions, duels). Houses + grievances on disk carry
// the new fields explicitly (no .default() backfill at SaveV9 — defaults
// only kick in at parse time for the legacy V8 path).

export const SaveV9Schema = z.object({
  version: z.literal(9),
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
  whispers: z.array(z.tuple([WhisperIdSchema, WhisperSchema])),
  couriers: z.array(z.tuple([CourierPayloadIdSchema, CourierPayloadSchema])),
  staff: z.array(z.tuple([StaffIdSchema, StaffMemberSchema])),
  proposalsLog: z.array(z.tuple([CharacterIdSchema, ProposalLogEntrySchema])),
  tutorAssignmentsLog: z.array(z.tuple([CharacterIdSchema, TutorAssignmentLogEntrySchema])),
  pendingTutorTraitChoices: z.array(z.tuple([CharacterIdSchema, PendingTutorTraitChoiceSchema])),
  // P8 additions.
  patronesses: z.array(z.tuple([PatronessIdSchema, PatronessRecordSchema])),
  rivalActors: z.array(z.tuple([HouseIdSchema, RivalActorStateSchema])),
  factionTensions: z.array(z.tuple([FactionPairKeySchema, z.number().int().min(0).max(100)])),
  duels: z.array(z.tuple([DuelIdSchema, DuelSchema])),
});
export type SaveV9 = z.infer<typeof SaveV9Schema>;

export function toSaveV9(state: GameState): SaveV9 {
  return SaveV9Schema.parse({
    version: 9,
    tick: state.tick,
    rng: serializeRegistry(state.rng),
    houses: serializeRegistry(state.houses),
    characters: stripEquippedArtifactsForLegacyEmit(serializeRegistry(state.characters)),
    marriages: serializeRegistry(state.marriages),
    campaignName: state.campaignName,
    era: state.era,
    conversationHistory: serializeRegistry(state.conversationHistory),
    affectionMap: serializeRegistry(state.affectionMap),
    schemes: serializeRegistry(state.schemes),
    whispers: serializeRegistry(state.whispers),
    couriers: serializeRegistry(state.couriers),
    staff: serializeRegistry(state.staff),
    proposalsLog: serializeRegistry(state.proposalsLog),
    tutorAssignmentsLog: serializeRegistry(state.tutorAssignmentsLog),
    pendingTutorTraitChoices: serializeRegistry(state.pendingTutorTraitChoices),
    patronesses: serializeRegistry(state.patronesses),
    rivalActors: serializeRegistry(state.rivalActors),
    factionTensions: serializeRegistry(state.factionTensions),
    duels: serializeRegistry(state.duels),
  });
}

// P9 split: Bare core does pure deserialization; public wrapper appends
// `elopement: null` (V9 saves predate the field).
export function fromSaveV9Bare(
  save: SaveV9,
): Omit<GameState, "elopement" | "artifactInstances" | "forgeries" | "thiefAttempts"> {
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
    whispers: deserializeRegistry(save.whispers) as GameState["whispers"],
    couriers: deserializeRegistry(save.couriers) as GameState["couriers"],
    staff: deserializeRegistry(save.staff) as GameState["staff"],
    proposalsLog: deserializeRegistry(save.proposalsLog) as GameState["proposalsLog"],
    tutorAssignmentsLog: deserializeRegistry(
      save.tutorAssignmentsLog,
    ) as GameState["tutorAssignmentsLog"],
    pendingTutorTraitChoices: deserializeRegistry(
      save.pendingTutorTraitChoices,
    ) as GameState["pendingTutorTraitChoices"],
    patronesses: deserializeRegistry(save.patronesses) as GameState["patronesses"],
    rivalActors: deserializeRegistry(save.rivalActors) as GameState["rivalActors"],
    factionTensions: deserializeRegistry(save.factionTensions) as GameState["factionTensions"],
    duels: deserializeRegistry(save.duels) as GameState["duels"],
  };
}

export function fromSaveV9(save: SaveV9): GameState {
  // V9 was the live format pre-P9; V10 is live at P9; V11 is live at P10+.
  // Wrap the Bare core with `elopement: null` (V9 saves predate the field)
  // and the three P10 Maps empty (V9 saves predate them too). P10 then
  // bootstraps player starting inventory symmetric with createInitialState.
  return bootstrapPlayerArtifactsForMigration({
    ...fromSaveV9Bare(save),
    elopement: null,
    artifactInstances: new Map(),
    forgeries: new Map(),
    thiefAttempts: new Map(),
  });
}

// ── SaveV10 (P9 live format) ──────────────────────────────────────────────
// Adds 1 new top-level field (elopement: ElopementSprintState | null) +
// 1 new MarriageRecord field (viaElopement: z.boolean().default(false)).
// MarriageRecord widening uses `.default(false)` per P8 House.hostility/
// factionId precedent — no Pre-shape rebuild required for parse-side.

export const SaveV10Schema = z.object({
  version: z.literal(10),
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
  whispers: z.array(z.tuple([WhisperIdSchema, WhisperSchema])),
  couriers: z.array(z.tuple([CourierPayloadIdSchema, CourierPayloadSchema])),
  staff: z.array(z.tuple([StaffIdSchema, StaffMemberSchema])),
  proposalsLog: z.array(z.tuple([CharacterIdSchema, ProposalLogEntrySchema])),
  tutorAssignmentsLog: z.array(z.tuple([CharacterIdSchema, TutorAssignmentLogEntrySchema])),
  pendingTutorTraitChoices: z.array(z.tuple([CharacterIdSchema, PendingTutorTraitChoiceSchema])),
  patronesses: z.array(z.tuple([PatronessIdSchema, PatronessRecordSchema])),
  rivalActors: z.array(z.tuple([HouseIdSchema, RivalActorStateSchema])),
  factionTensions: z.array(z.tuple([FactionPairKeySchema, z.number().int().min(0).max(100)])),
  duels: z.array(z.tuple([DuelIdSchema, DuelSchema])),
  // P9 addition — nullable singleton.
  elopement: ElopementSprintStateSchema.nullable(),
});
export type SaveV10 = z.infer<typeof SaveV10Schema>;

export function toSaveV10(state: GameState): SaveV10 {
  return SaveV10Schema.parse({
    // P10: V10 demoted to legacy; literal 10 (NOT SAVE_VERSION_CURRENT which
    // is now 11). Only toSaveV11 references SAVE_VERSION_CURRENT.
    version: 10,
    tick: state.tick,
    rng: serializeRegistry(state.rng),
    houses: serializeRegistry(state.houses),
    characters: stripEquippedArtifactsForLegacyEmit(serializeRegistry(state.characters)),
    marriages: serializeRegistry(state.marriages),
    campaignName: state.campaignName,
    era: state.era,
    conversationHistory: serializeRegistry(state.conversationHistory),
    affectionMap: serializeRegistry(state.affectionMap),
    schemes: serializeRegistry(state.schemes),
    whispers: serializeRegistry(state.whispers),
    couriers: serializeRegistry(state.couriers),
    staff: serializeRegistry(state.staff),
    proposalsLog: serializeRegistry(state.proposalsLog),
    tutorAssignmentsLog: serializeRegistry(state.tutorAssignmentsLog),
    pendingTutorTraitChoices: serializeRegistry(state.pendingTutorTraitChoices),
    patronesses: serializeRegistry(state.patronesses),
    rivalActors: serializeRegistry(state.rivalActors),
    factionTensions: serializeRegistry(state.factionTensions),
    duels: serializeRegistry(state.duels),
    // P9: nullable singleton serialized as-is (no Map → no serializeRegistry).
    elopement: state.elopement,
  });
}

// P10 split: Bare core does pure deserialization (no inventory seeding);
// public wrapper composes bootstrapPlayerArtifactsForMigration for parity
// with createInitialState. V10 was the live format pre-P10; V11 is live at
// P10+. Bare is used by migrate_v10_to_v11 so the migration runner's own
// bootstrap call is the SINGLE seeding site.
export function fromSaveV10Bare(save: SaveV10): GameState {
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
    whispers: deserializeRegistry(save.whispers) as GameState["whispers"],
    couriers: deserializeRegistry(save.couriers) as GameState["couriers"],
    staff: deserializeRegistry(save.staff) as GameState["staff"],
    proposalsLog: deserializeRegistry(save.proposalsLog) as GameState["proposalsLog"],
    tutorAssignmentsLog: deserializeRegistry(
      save.tutorAssignmentsLog,
    ) as GameState["tutorAssignmentsLog"],
    pendingTutorTraitChoices: deserializeRegistry(
      save.pendingTutorTraitChoices,
    ) as GameState["pendingTutorTraitChoices"],
    patronesses: deserializeRegistry(save.patronesses) as GameState["patronesses"],
    rivalActors: deserializeRegistry(save.rivalActors) as GameState["rivalActors"],
    factionTensions: deserializeRegistry(save.factionTensions) as GameState["factionTensions"],
    duels: deserializeRegistry(save.duels) as GameState["duels"],
    // P9: nullable singleton — direct passthrough.
    elopement: save.elopement,
    // P10: new top-level Maps default empty in Bare; the public wrap composes
    // bootstrapPlayerArtifactsForMigration to seed starting inventory.
    artifactInstances: new Map(),
    forgeries: new Map(),
    thiefAttempts: new Map(),
  };
}

export function fromSaveV10(save: SaveV10): GameState {
  // V10 demoted from live → legacy at P10. Wrap the Bare core with
  // bootstrapPlayerArtifactsForMigration so the load-path produces
  // post-P10 GameStates with starting inventory seeded.
  return bootstrapPlayerArtifactsForMigration(fromSaveV10Bare(save));
}

// ── SaveV11 (P10 live format) ─────────────────────────────────────────────
// Adds 3 new top-level Maps (artifactInstances, forgeries, thiefAttempts) +
// 1 new Character field (equippedArtifactIds: z.array(...).default([])) +
// the 7th SchemeKind (TreasonFraming). The Character widening uses
// `.default([])` per the P8 House.hostility/factionId + P9
// MarriageRecord.viaElopement precedent — no Pre-shape rebuild required.

export const SaveV11Schema = z.object({
  version: z.literal(11),
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
  whispers: z.array(z.tuple([WhisperIdSchema, WhisperSchema])),
  couriers: z.array(z.tuple([CourierPayloadIdSchema, CourierPayloadSchema])),
  staff: z.array(z.tuple([StaffIdSchema, StaffMemberSchema])),
  proposalsLog: z.array(z.tuple([CharacterIdSchema, ProposalLogEntrySchema])),
  tutorAssignmentsLog: z.array(z.tuple([CharacterIdSchema, TutorAssignmentLogEntrySchema])),
  pendingTutorTraitChoices: z.array(z.tuple([CharacterIdSchema, PendingTutorTraitChoiceSchema])),
  patronesses: z.array(z.tuple([PatronessIdSchema, PatronessRecordSchema])),
  rivalActors: z.array(z.tuple([HouseIdSchema, RivalActorStateSchema])),
  factionTensions: z.array(z.tuple([FactionPairKeySchema, z.number().int().min(0).max(100)])),
  duels: z.array(z.tuple([DuelIdSchema, DuelSchema])),
  elopement: ElopementSprintStateSchema.nullable(),
  // P10 additions:
  artifactInstances: z.array(z.tuple([ArtifactInstanceIdSchema, ArtifactInstanceSchema])),
  forgeries: z.array(z.tuple([ForgeryIdSchema, ForgeryRecordSchema])),
  thiefAttempts: z.array(z.tuple([ThiefAttemptIdSchema, ThiefAttemptSchema])),
});
export type SaveV11 = z.infer<typeof SaveV11Schema>;

export function toSaveV11(state: GameState): SaveV11 {
  return SaveV11Schema.parse({
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
    whispers: serializeRegistry(state.whispers),
    couriers: serializeRegistry(state.couriers),
    staff: serializeRegistry(state.staff),
    proposalsLog: serializeRegistry(state.proposalsLog),
    tutorAssignmentsLog: serializeRegistry(state.tutorAssignmentsLog),
    pendingTutorTraitChoices: serializeRegistry(state.pendingTutorTraitChoices),
    patronesses: serializeRegistry(state.patronesses),
    rivalActors: serializeRegistry(state.rivalActors),
    factionTensions: serializeRegistry(state.factionTensions),
    duels: serializeRegistry(state.duels),
    elopement: state.elopement,
    artifactInstances: serializeRegistry(state.artifactInstances),
    forgeries: serializeRegistry(state.forgeries),
    thiefAttempts: serializeRegistry(state.thiefAttempts),
  });
}

// V11 IS the live format — pure deserialization, no Bare/wrap split (the
// split exists only for legacy-demoted formats so the migration runner can
// reuse the Bare half without re-seeding starting inventory).
export function fromSaveV11(save: SaveV11): GameState {
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
    whispers: deserializeRegistry(save.whispers) as GameState["whispers"],
    couriers: deserializeRegistry(save.couriers) as GameState["couriers"],
    staff: deserializeRegistry(save.staff) as GameState["staff"],
    proposalsLog: deserializeRegistry(save.proposalsLog) as GameState["proposalsLog"],
    tutorAssignmentsLog: deserializeRegistry(
      save.tutorAssignmentsLog,
    ) as GameState["tutorAssignmentsLog"],
    pendingTutorTraitChoices: deserializeRegistry(
      save.pendingTutorTraitChoices,
    ) as GameState["pendingTutorTraitChoices"],
    patronesses: deserializeRegistry(save.patronesses) as GameState["patronesses"],
    rivalActors: deserializeRegistry(save.rivalActors) as GameState["rivalActors"],
    factionTensions: deserializeRegistry(save.factionTensions) as GameState["factionTensions"],
    duels: deserializeRegistry(save.duels) as GameState["duels"],
    elopement: save.elopement,
    artifactInstances: deserializeRegistry(
      save.artifactInstances,
    ) as GameState["artifactInstances"],
    forgeries: deserializeRegistry(save.forgeries) as GameState["forgeries"],
    thiefAttempts: deserializeRegistry(save.thiefAttempts) as GameState["thiefAttempts"],
  };
}

// ── seedRivalsAndPatronessesIntoLegacyState (P8) ──────────────────────────
// Idempotent helper: seeds 3 rival houses + 9 rival-associated characters +
// 3 per-rival RNG entries + 5 patronesses + 3 RivalActorState + 6 faction-
// tension entries (all 0) + empty duels Map. Skip if already present. Called
// by the public fromSaveV1..V8 wrappers AND by migrate_v8_to_v9 as the seed
// side of bare+wrap composition.
//
// playerSeed: the campaign seed string (NOT the post-draw form) — required
// for the per-rival RNG seed format `${campaignSeed}|${rivalHouseId}`.
export function seedRivalsAndPatronessesIntoLegacyState(
  state: GameState,
  playerSeed: string,
): GameState {
  // Lazy: only mutate when at least one piece is missing. Idempotent under
  // repeated calls.
  const rng = new Map(state.rng);
  const houses = new Map(state.houses);
  const characters = new Map(state.characters);
  const rivalActors = new Map(state.rivalActors ?? new Map());

  for (const seed of RIVAL_HOUSES_FIXTURE) {
    if (!houses.has(seed.houseId)) {
      houses.set(seed.houseId, buildRivalHouse(seed));
    }
    if (!characters.has(seed.headSeed.characterId)) {
      characters.set(
        seed.headSeed.characterId,
        buildRivalCharacter(seed.headSeed, seed.houseId, "HeadOfHouse", 35),
      );
    }
    for (const s of seed.associatedSeeds) {
      if (!characters.has(s.characterId)) {
        characters.set(s.characterId, buildRivalCharacter(s, seed.houseId, "Dependent", 30));
      }
    }
    if (!rng.has(seed.houseId)) {
      rng.set(seed.houseId, buildRivalRngState(playerSeed, seed.houseId));
    }
    if (!rivalActors.has(seed.houseId)) {
      rivalActors.set(seed.houseId, buildRivalActorState(seed));
    }
  }

  const patronesses = new Map(state.patronesses ?? new Map());
  for (const p of PATRONESSES_FIXTURE) {
    if (!patronesses.has(p.id)) patronesses.set(p.id, p);
  }

  const factionTensions = new Map(state.factionTensions ?? new Map());
  for (const pair of FACTION_PAIRS) {
    if (!factionTensions.has(pair)) factionTensions.set(pair, 0);
  }

  const duels = state.duels ?? new Map();

  return {
    ...state,
    rng,
    houses,
    characters,
    rivalActors,
    patronesses,
    factionTensions,
    duels,
  };
}

// Internal exports for the migration runner + tests
export type { Grievance };
