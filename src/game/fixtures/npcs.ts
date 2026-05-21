// Baseline NPC registry — 5 society NPCs seeded at campaign start, all
// belonging to INDEPENDENT_HOUSE_ID. Lord Blackwood is Independent's
// head-of-house; the other four are dependents.
//
// All fields are pre-assigned constants — ZERO RNG draws involved in NPC
// construction. This property keeps fresh-state (createInitialState) and
// migration (migrate_v4_to_v5 + lifters) paths producing byte-identical
// NPCs across the bootstrap-vs-migration boundary.
//
// Plan: plans/phases/04-ballroom-llm.md "NPC pool: INDEPENDENT_HOUSE_ID +
// 5 baseline society NPCs".

import { HAPPINESS_INITIAL } from "../constants";
import type { Character, House } from "../entities";
import { type CharacterId, INDEPENDENT_HOUSE_ID, type TraitId } from "../rng";
import { hashCharIdToGender } from "./hashCharIdToGender";
import type { Mood } from "./moods";
import type { Role } from "./roles";

export type BaselineNpcSeed = {
  id: CharacterId;
  name: string;
  role: Role;
  traitPicks: readonly TraitId[];
  startingMood: Mood;
  deathAge: number;
};

export const BASELINE_NPC_HEAD_ID = "npc-blackwood" as CharacterId;

export const BASELINE_NPCS: ReadonlyArray<BaselineNpcSeed> = [
  {
    id: "npc-aldridge" as CharacterId,
    name: "Lady Aldridge",
    role: "Dependent",
    traitPicks: ["Witty" as TraitId, "Sophisticated" as TraitId],
    startingMood: "Receptive",
    deathAge: 88,
  },
  {
    id: BASELINE_NPC_HEAD_ID,
    name: "Lord Blackwood",
    role: "HeadOfHouse",
    traitPicks: ["Cunning" as TraitId, "Reserved" as TraitId],
    startingMood: "Receptive",
    deathAge: 76,
  },
  {
    id: "npc-carrington" as CharacterId,
    name: "Miss Carrington",
    role: "Dependent",
    traitPicks: ["Romantic" as TraitId, "Frivolous" as TraitId],
    startingMood: "Receptive",
    deathAge: 92,
  },
  {
    id: "npc-dunmore" as CharacterId,
    name: "Mr. Dunmore",
    role: "Dependent",
    traitPicks: ["Empathetic" as TraitId, "Generous" as TraitId],
    startingMood: "Receptive",
    deathAge: 81,
  },
  {
    id: "npc-ellsworth" as CharacterId,
    name: "Lady Ellsworth",
    role: "Dependent",
    traitPicks: ["Bold" as TraitId, "Brash" as TraitId],
    startingMood: "Receptive",
    deathAge: 73,
  },
];

// Builders called by BOTH seedStartingFamily (fresh-state path) AND
// seedIndependentIntoLegacyState (migration/lifter path) so there is a
// single source of truth — no constants duplication between bootstrap.ts
// and schema.ts. v4-to-v5.test.ts asserts byte-identical Independent
// construction across both paths.
export function buildBaselineNpcCharacter(seed: BaselineNpcSeed): Character {
  return {
    id: seed.id,
    houseId: INDEPENDENT_HOUSE_ID,
    name: seed.name,
    birthTick: 0, // same generation as player; no aging skew at start
    age: 25, // mirrors player head age
    deathAge: seed.deathAge, // CONSTANT from fixture — no RNG draw
    alive: true,
    diedAtTick: null,
    mood: seed.startingMood,
    moodLockUntilTick: 0,
    role: seed.role,
    archetype: "None",
    traits: [...seed.traitPicks], // copy from fixture, not reference
    marriageId: null,
    composure: 100,
    maxComposure: 100,
    // P7 defaults. Gender derived from FNV-1a hash — same source-of-truth as
    // the legacy-lift path's seedV8FieldsIntoLegacyState; the v1→v8 chain test
    // hash parity assertion depends on these two paths agreeing.
    happiness: HAPPINESS_INITIAL,
    temptationHookUnlocked: false,
    assignedTutorCharacterId: null,
    tutorBonusTraitGranted: false,
    dullSpouseExposureStartTick: null,
    parentCharacterIds: null,
    gender: hashCharIdToGender(seed.id),
  };
}

export function buildIndependentHouse(): House {
  return {
    id: INDEPENDENT_HOUSE_ID,
    wealth: 0,
    reputation: 50,
    scandal: 0,
    headOfHouseCharacterId: BASELINE_NPC_HEAD_ID,
    generation: 0,
    ancestorSummary: [],
    heirless: false,
    currentLocation: "Capital",
    consecutiveTicksAtCurrentLocation: 0,
    lastAudienceTick: null,
    wardrobeLastRefreshTick: null,
    blockadeBypassEarned: false,
    // P5: empty grievance list at fresh state.
    grievances: [],
    // P6: not exiled at fresh state.
    exiled: false,
  };
}
