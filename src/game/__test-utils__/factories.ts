// Test-utility factories. Build P1-shape entities with sensible defaults so
// tests override only the fields they care about. Boundary classification:
// game-other (folder fallback for src/game). Imports are exclusively from
// test files (which are in boundaries/ignore), so the import-site escapes
// the boundary check.

import type {
  ArtifactInstance,
  Character,
  FlavorContentEntry,
  ForgeryRecord,
  GameState,
  GlobalEvent,
  House,
  MarriageRecord,
  ThiefAttempt,
} from "../entities";
import type {
  ArtifactInstanceId,
  CharacterId,
  FactionId,
  FlavorContentId,
  ForgeryId,
  GlobalEventId,
  HouseId,
  MarriageId,
  RngState,
  ThiefAttemptId,
} from "../rng";
import { PLAYER_HOUSE_ID } from "../rng.seeds";

export function makeGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    tick: 0,
    rng: new Map<HouseId, RngState>(),
    houses: new Map(),
    characters: new Map<CharacterId, Character>(),
    marriages: new Map<MarriageId, MarriageRecord>(),
    campaignName: "test-campaign",
    era: "Earlier",
    conversationHistory: new Map(),
    affectionMap: new Map(),
    schemes: new Map(),
    whispers: new Map(),
    couriers: new Map(),
    staff: new Map(),
    // P7 defaults
    proposalsLog: new Map(),
    tutorAssignmentsLog: new Map(),
    pendingTutorTraitChoices: new Map(),
    // P8 defaults
    patronesses: new Map(),
    rivalActors: new Map(),
    factionTensions: new Map(),
    duels: new Map(),
    // P9 default
    elopement: null,
    // P10 defaults
    artifactInstances: new Map<ArtifactInstanceId, ArtifactInstance>(),
    forgeries: new Map<ForgeryId, ForgeryRecord>(),
    thiefAttempts: new Map<ThiefAttemptId, ThiefAttempt>(),
    // P13 default — empty global events at fresh state.
    globalEvents: new Map<GlobalEventId, GlobalEvent>(),
    // P18 default — empty flavor content at fresh state.
    flavorText: new Map<FlavorContentId, FlavorContentEntry>(),
    ...overrides,
  };
}

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
    // P7 defaults
    happiness: 100,
    temptationHookUnlocked: false,
    assignedTutorCharacterId: null,
    tutorBonusTraitGranted: false,
    dullSpouseExposureStartTick: null,
    parentCharacterIds: null,
    gender: "Female",
    // P10 default
    equippedArtifactIds: [],
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
    // P3 defaults — match bootstrap.ts defaults.
    currentLocation: "Capital",
    consecutiveTicksAtCurrentLocation: 0,
    lastAudienceTick: null,
    wardrobeLastRefreshTick: null,
    blockadeBypassEarned: false,
    // P5 default — empty grievance list.
    grievances: [],
    // P6 default — not exiled at fresh state.
    exiled: false,
    // P8 defaults — crown faction + zero hostility.
    hostility: 0,
    factionId: "faction-crown" as FactionId,
    // P11 defaults — empty ledgers.
    siblingRivals: [],
    inheritedSecrets: [],
    bloodFeuds: [],
    // P13 default — no Later-era research at fresh state.
    courierResearchEarned: false,
    // P15 defaults — no perks / zeroed counters at fresh state (going-forward-only).
    awardedDynastyPerks: [],
    consecutiveHeirsNaturalDeath: 0,
    cumulativeSuccessfulSeductions: 0,
    cumulativeWeaponizedWhispers: 0,
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
    viaElopement: false,
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
