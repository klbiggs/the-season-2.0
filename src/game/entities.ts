// In-memory entity shapes for Character / House / MarriageRecord. Separated
// from store.ts so the rule layer can import them without crossing the
// game-rules → game-store boundary (spec §8 forbids game-rules from depending
// on the store; entity TYPES don't carry that concern).
//
// The Zod schemas here describe the in-memory shape. The save-format schemas
// (in src/persist/schema.ts at SaveV2) reference these via type, but the
// save shape uses serialized Array<[Id, Entity]> tuples — bridged by
// serializeRegistry / deserializeRegistry.

import { z } from "zod";
import {
  COURIER_DIRECTIONS,
  COURIER_PAYLOAD_TYPES,
  COURIER_STATUSES,
  GRIEVANCE_SOURCES,
  SCHEME_FAILURE_REASONS,
  SCHEME_KINDS,
  SCHEME_STATUSES,
  STAFF_ASSIGNMENTS,
  WEAPONIZATION_BRANCHES,
  WHISPER_STATUSES,
} from "./constants";
import { ConversationPairKeySchema, ExchangeSchema } from "./conversation/types";
import { ArchetypeSchema } from "./fixtures/archetypes";
import { LocationIdSchema } from "./fixtures/locations";
import { MoodSchema } from "./fixtures/moods";
import { RoleSchema } from "./fixtures/roles";
import {
  CharacterIdSchema,
  CourierPayloadIdSchema,
  GrievanceIdSchema,
  HouseIdSchema,
  MarriageIdSchema,
  RngStateSchema,
  SchemeIdSchema,
  StaffIdSchema,
  TraitIdSchema,
  WhisperIdSchema,
} from "./rng";

// P5: Grievance entity. Stored on House.grievances array (the house is the
// VICTIM; the perpetrator is referenced by perpetratorHouseId). Spec §4
// line 541 ("social grievances") + §3 line 122 (Sabotage + public faux-pas
// record formal grievances). Insertion order is hash-relevant via
// serializeRegistry's Map-key-only sort — `grievances` arrays serialize
// in-place; UI render-time sort by GrievanceId is a separate concern.
export const GrievanceSchema = z.object({
  id: GrievanceIdSchema,
  perpetratorHouseId: HouseIdSchema,
  source: z.enum(GRIEVANCE_SOURCES),
  schemeId: SchemeIdSchema.nullable(), // non-null when source === "Sabotage"
  recordedAtTick: z.number().int().nonnegative(),
  resolved: z.boolean(), // P8 ships duel resolution that flips this
});
export type Grievance = z.infer<typeof GrievanceSchema>;

export const HouseSchema = z.object({
  id: HouseIdSchema,
  wealth: z.number(),
  reputation: z.number().int().min(0).max(100),
  scandal: z.number().int().min(0).max(100),
  headOfHouseCharacterId: CharacterIdSchema,
  generation: z.number().int().nonnegative(),
  ancestorSummary: z.array(z.string()),
  heirless: z.boolean(),
  // P3 additions:
  currentLocation: LocationIdSchema,
  consecutiveTicksAtCurrentLocation: z.number().int().nonnegative(),
  lastAudienceTick: z.number().int().nullable(),
  wardrobeLastRefreshTick: z.number().int().nullable(),
  blockadeBypassEarned: z.boolean(),
  // P5 addition: list of grievances this house HOLDS against others (the
  // house is the VICTIM, perpetrator referenced by perpetratorHouseId).
  // Hash-relevant in insertion order; never reorder on save.
  grievances: z.array(GrievanceSchema),
  // P6 addition: terminal-state flag set by the Scandal Sheet attribution
  // endgame (spec §3 line 462). Default false on fresh state and every
  // legacy lift. When true, the campaign is "out of bounds" — the rule-layer
  // exile gate rejects all player-elected mutation actions.
  exiled: z.boolean(),
});
export type House = z.infer<typeof HouseSchema>;

export const CharacterSchema = z.object({
  id: CharacterIdSchema,
  houseId: HouseIdSchema,
  name: z.string(),
  // birthTick is z.number().int() WITHOUT .nonnegative() — synthetic test
  // fixtures construct mid-life states with negative birthTick.
  birthTick: z.number().int(),
  age: z.number().int().nonnegative(),
  deathAge: z.number().int().min(70).max(95),
  alive: z.boolean(),
  diedAtTick: z.number().int().nullable(),
  mood: MoodSchema,
  moodLockUntilTick: z.number().int().nonnegative(),
  role: RoleSchema,
  archetype: ArchetypeSchema,
  traits: z.array(TraitIdSchema),
  marriageId: MarriageIdSchema.nullable(),
  // P4 additions: per-character composure. Clamped [0, maxComposure] at
  // every mutation site (CLAUDE.md non-negotiable §6). Defaults to 100;
  // maxComposure is reserved as a per-character ceiling (later phases
  // may grant trait-based bumps).
  composure: z.number().int(),
  maxComposure: z.number().int().positive(),
});
export type Character = z.infer<typeof CharacterSchema>;

export const MarriageRecordSchema = z.object({
  id: MarriageIdSchema,
  spouseAId: CharacterIdSchema, // lex-smaller of the two at marriage creation
  spouseBId: CharacterIdSchema, // lex-larger of the two at marriage creation
  marriedAtTick: z.number().int().nonnegative(),
  dissolved: z.boolean(),
  dissolvedAtTick: z.number().int().nullable(),
});
export type MarriageRecord = z.infer<typeof MarriageRecordSchema>;

// P5: Scheme entity. Spec §4 line 543 + §6 line 567 — references BOTH the
// aggressor character AND the aggressor's owning house. accumulatedAffection
// is hash-relevant but dead data at v1 (one-shot discovery per OQ #6
// resolution); reserved for v1.5 multi-tick suspicion mechanic.
// failureReason is the diff-helper's discriminator for Seduction's two
// Failed paths (Discovered vs TargetDied).
export const SchemeSchema = z.object({
  id: SchemeIdSchema,
  kind: z.enum(SCHEME_KINDS),
  ownerHouseId: HouseIdSchema, // aggressor's house — owns the scheme (§6 line 567)
  aggressorCharacterId: CharacterIdSchema, // §4 line 543 + §6 line 567
  targetCharacterId: CharacterIdSchema.nullable(), // null for Smuggling only
  startedAtTick: z.number().int().nonnegative(),
  endsAtTick: z.number().int().nonnegative(), // ABSOLUTE end-tick (CLAUDE.md §2)
  status: z.enum(SCHEME_STATUSES),
  resolvedAtTick: z.number().int().nonnegative().nullable(),
  failureReason: z.enum(SCHEME_FAILURE_REASONS).nullable(),
  accumulatedAffection: z.number().int().nonnegative(), // v1: always 0; v1.5 future-suspicion
});
export type Scheme = z.infer<typeof SchemeSchema>;

// P6: Whisper entity. Spec §4 line 542. `status` is the canonical state
// machine; `weaponizedAs` discriminates which weaponization branch the
// player chose; `scandalSheetAttribution` is the attribution-roll outcome
// (null until weaponized as ScandalSheet); `accidentalSlipDripsRemaining`
// is the per-conversation drip counter (0 unless weaponized as
// AccidentalSlip). `llmGenerated` distinguishes deterministic synergy
// whispers from LLM-additive whispers — hash-relevant for replay debug.
export const WhisperSchema = z.object({
  id: WhisperIdSchema,
  text: z.string(),
  originatingTick: z.number().int().nonnegative(),
  sourceCharacterId: CharacterIdSchema,
  subjectCharacterId: CharacterIdSchema,
  destinationHouseId: HouseIdSchema,
  arrivedAtTick: z.number().int().nonnegative().nullable(),
  verificationProgress: z.number().int().min(0).max(100),
  status: z.enum(WHISPER_STATUSES),
  weaponizedAs: z.enum(WEAPONIZATION_BRANCHES).nullable(),
  weaponizedAtTick: z.number().int().nonnegative().nullable(),
  scandalSheetAttribution: z.boolean().nullable(),
  accidentalSlipDripsRemaining: z.number().int().min(0),
  llmGenerated: z.boolean(),
});
export type Whisper = z.infer<typeof WhisperSchema>;

// P6: CourierPayload entity. Spec §4 line 545. `whisperId` is REQUIRED at
// v1 (only "Whisper" payloadType ships); `direction` is stored explicitly
// so P8 multi-house routing can filter without deriving; `interceptable`
// gates the Spymaster + InterceptMail filter. `arrivalTick` is absolute
// per CLAUDE.md non-negotiable #2.
export const CourierPayloadSchema = z.object({
  id: CourierPayloadIdSchema,
  payloadType: z.enum(COURIER_PAYLOAD_TYPES),
  whisperId: WhisperIdSchema,
  originHouseId: HouseIdSchema,
  destinationHouseId: HouseIdSchema,
  originLocation: LocationIdSchema,
  destinationLocation: LocationIdSchema,
  originTick: z.number().int().nonnegative(),
  arrivalTick: z.number().int().nonnegative(),
  interceptable: z.boolean(),
  direction: z.enum(COURIER_DIRECTIONS),
  status: z.enum(COURIER_STATUSES),
  resolvedAtTick: z.number().int().nonnegative().nullable(),
});
export type CourierPayload = z.infer<typeof CourierPayloadSchema>;

// P6: StaffMember entity. Spec §4 line 558. Staff are a separate entity type
// from Character — no mood, no traits array, no aging. `isGreedy` is the
// only trait that matters at v1 (bribery-risk multiplier per spec §3 line
// 204). `lastOutputTick: null` means "never produced"; set to state.tick
// after first cadence fire OR first reassignment.
export const StaffMemberSchema = z.object({
  id: StaffIdSchema,
  houseId: HouseIdSchema,
  name: z.string(),
  isGreedy: z.boolean(),
  loyalty: z.number().int().min(0).max(100),
  upkeepPerTick: z.number().int().positive(),
  assignment: z.enum(STAFF_ASSIGNMENTS),
  lastOutputTick: z.number().int().nullable(),
  bribedAtTick: z.number().int().nonnegative().nullable(),
});
export type StaffMember = z.infer<typeof StaffMemberSchema>;

// GameState lives here (not in store.ts) so the rule layer can import it.
// store.ts re-exports GameState/GameStateSchema for P0-era callers.
//
// In-memory uses `z.map(...)`; the save-format schema (SaveV2) uses
// `z.array(z.tuple(...))`. The two forms are bridged by serializeRegistry /
// deserializeRegistry. Never copy the array shape into GameStateSchema.
export const GameStateSchema = z.object({
  tick: z.number().int().nonnegative(),
  rng: z.map(HouseIdSchema, RngStateSchema),
  houses: z.map(HouseIdSchema, HouseSchema),
  characters: z.map(CharacterIdSchema, CharacterSchema),
  marriages: z.map(MarriageIdSchema, MarriageRecordSchema),
  campaignName: z.string(),
  // P3: read-only at this phase, hard-locked to "Earlier". P13 ships the
  // transition mechanism.
  era: z.enum(["Earlier", "Later"]),
  // P4 additions: conversation history + affection map, both keyed on
  // ConversationPairKey = `${HouseId}|${CharacterId}`. Shared key shape
  // lets the orphan-prune cascade in aging.ts walk both collections in
  // a single filter pass on NPC death.
  conversationHistory: z.map(ConversationPairKeySchema, z.array(ExchangeSchema)),
  affectionMap: z.map(ConversationPairKeySchema, z.number().int().min(0).max(100)),
  // P5: scheme registry. In-memory `z.map(K, V)` so rules can call
  // `state.schemes.get(schemeId)`; save-format `SaveV6Schema` uses
  // `z.array(z.tuple([SchemeIdSchema, SchemeSchema]))`; bridged by
  // serializeRegistry / deserializeRegistry. Grievances ride INSIDE
  // House.grievances — NEVER top-level (the schema↔projection↔selector
  // trip-wire only enforces top-level key equality; a misguided top-level
  // state.grievances addition wouldn't be caught).
  schemes: z.map(SchemeIdSchema, SchemeSchema),
  // P6: whisper / courier / staff registries. Same in-memory z.map / save-
  // format z.array(z.tuple) bridge as schemes. Whispers and couriers grow
  // monotonically across a campaign (never deleted; status flips only).
  // Staff seeded at campaign start (4 baseline members) and durable for
  // the campaign's lifetime; no runtime hire affordance at v1.
  whispers: z.map(WhisperIdSchema, WhisperSchema),
  couriers: z.map(CourierPayloadIdSchema, CourierPayloadSchema),
  staff: z.map(StaffIdSchema, StaffMemberSchema),
});
export type GameState = z.infer<typeof GameStateSchema>;
