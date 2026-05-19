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
import { ArchetypeSchema } from "./fixtures/archetypes";
import { MoodSchema } from "./fixtures/moods";
import { RoleSchema } from "./fixtures/roles";
import {
  CharacterIdSchema,
  HouseIdSchema,
  MarriageIdSchema,
  RngStateSchema,
  TraitIdSchema,
} from "./rng";

export const HouseSchema = z.object({
  id: HouseIdSchema,
  wealth: z.number(),
  reputation: z.number().int().min(0).max(100),
  scandal: z.number().int().min(0).max(100),
  headOfHouseCharacterId: CharacterIdSchema,
  generation: z.number().int().nonnegative(),
  ancestorSummary: z.array(z.string()),
  heirless: z.boolean(),
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
});
export type GameState = z.infer<typeof GameStateSchema>;
