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
  GRIEVANCE_SOURCES,
  SCHEME_FAILURE_REASONS,
  SCHEME_KINDS,
  SCHEME_STATUSES,
} from "./constants";
import { ConversationPairKeySchema, ExchangeSchema } from "./conversation/types";
import { ArchetypeSchema } from "./fixtures/archetypes";
import { LocationIdSchema } from "./fixtures/locations";
import { MoodSchema } from "./fixtures/moods";
import { RoleSchema } from "./fixtures/roles";
import {
  CharacterIdSchema,
  GrievanceIdSchema,
  HouseIdSchema,
  MarriageIdSchema,
  RngStateSchema,
  SchemeIdSchema,
  TraitIdSchema,
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
});
export type GameState = z.infer<typeof GameStateSchema>;
