// Test-utility factories. Build P1-shape entities with sensible defaults so
// tests override only the fields they care about. Boundary classification:
// game-other (folder fallback for src/game). Imports are exclusively from
// test files (which are in boundaries/ignore), so the import-site escapes
// the boundary check.

import type { Character, House, MarriageRecord } from "../entities";
import type { CharacterId, HouseId, MarriageId } from "../rng";
import { PLAYER_HOUSE_ID } from "../rng.seeds";

export function makeCharacter(overrides: Partial<Character> = {}): Character {
  return {
    id: "test-char" as CharacterId,
    houseId: PLAYER_HOUSE_ID,
    name: "Test Character",
    birthTick: 0,
    age: 25,
    deathAge: 90,
    alive: true,
    diedAtTick: null,
    mood: "Receptive",
    moodLockUntilTick: 0,
    role: "Dependent",
    archetype: "None",
    traits: [],
    marriageId: null,
    // P4 defaults
    composure: 100,
    maxComposure: 100,
    ...overrides,
  };
}

export function makeHouse(overrides: Partial<House> = {}): House {
  return {
    id: PLAYER_HOUSE_ID,
    wealth: 100,
    reputation: 50,
    scandal: 0,
    headOfHouseCharacterId: "test-char" as CharacterId,
    generation: 0,
    ancestorSummary: [],
    heirless: false,
    // P3 defaults — match bootstrap.ts + migrate_v3_to_v4 lift defaults.
    currentLocation: "Capital",
    consecutiveTicksAtCurrentLocation: 0,
    lastAudienceTick: null,
    wardrobeLastRefreshTick: null,
    blockadeBypassEarned: false,
    // P5 default — empty grievance list.
    grievances: [],
    ...overrides,
  };
}

export function makeMarriage(overrides: Partial<MarriageRecord> = {}): MarriageRecord {
  return {
    id: "m-test-0001" as MarriageId,
    spouseAId: "spouse-a" as CharacterId,
    spouseBId: "spouse-b" as CharacterId,
    marriedAtTick: 0,
    dissolved: false,
    dissolvedAtTick: null,
    ...overrides,
  };
}

// Helper: construct a Map<HouseId, House> from individual House records.
export function makeHousesMap(houses: House[]): Map<HouseId, House> {
  return new Map(houses.map((h) => [h.id, h]));
}

export function makeCharactersMap(chars: Character[]): Map<CharacterId, Character> {
  return new Map(chars.map((c) => [c.id, c]));
}

export function makeMarriagesMap(marriages: MarriageRecord[]): Map<MarriageId, MarriageRecord> {
  return new Map(marriages.map((m) => [m.id, m]));
}
