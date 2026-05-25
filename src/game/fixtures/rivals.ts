// P8: canonical 3 rival houses per spec §3 line 130 "Three canonical rival
// houses". Each ships with a full House entity (seeded into state.houses), a
// RivalActorState (seeded into state.rivalActors), AND 3 associated characters
// (head + 2 family members) seeded into state.characters. Bootstrap and
// migration paths use the same fixture data to guarantee parity.
//
// Trait picks audited against TRAITS_ALL in src/game/fixtures/traits.ts — every
// trait id used here is verified present in the live registry. No invented
// traits.
//
// Per-rival RNG seed format: `${campaignSeed}|${rivalHouseId}` (string-concat,
// not arithmetic — engine-stable across V8 minor versions).

import { HAPPINESS_INITIAL } from "../constants";
import type { Character, House, RivalActorState } from "../entities";
import {
  type CharacterId,
  type FactionId,
  type HouseId,
  type RngState,
  type TraitId,
  createRngState,
} from "../rng";

export type RivalCharacterSeed = {
  characterId: CharacterId;
  name: string;
  gender: "Female" | "Male";
  deathAge: number;
  traits: readonly TraitId[];
};

export type RivalHouseSeed = {
  houseId: HouseId;
  displayName: string;
  factionId: FactionId;
  startingReputation: number;
  startingHostility: number;
  startingWealth: number;
  headSeed: RivalCharacterSeed;
  associatedSeeds: readonly [RivalCharacterSeed, RivalCharacterSeed];
};

export const RIVAL_HOUSES_FIXTURE: readonly [RivalHouseSeed, RivalHouseSeed, RivalHouseSeed] = [
  {
    houseId: "rival-ashford" as HouseId,
    displayName: "House Ashford",
    factionId: "faction-court" as FactionId,
    startingReputation: 60,
    startingHostility: 10,
    startingWealth: 200,
    headSeed: {
      characterId: "rival-ashford-head" as CharacterId,
      name: "Lord Ashford",
      gender: "Male",
      deathAge: 82,
      traits: ["Cunning" as TraitId, "Sophisticated" as TraitId],
    },
    associatedSeeds: [
      {
        characterId: "rival-ashford-a1" as CharacterId,
        name: "Lady Ashford",
        gender: "Female",
        deathAge: 78,
        traits: ["Vain" as TraitId, "Observant" as TraitId],
      },
      {
        characterId: "rival-ashford-a2" as CharacterId,
        name: "Charles Ashford",
        gender: "Male",
        deathAge: 75,
        traits: ["Brash" as TraitId],
      },
    ],
  },
  {
    houseId: "rival-beaumont" as HouseId,
    displayName: "House Beaumont",
    factionId: "faction-ton" as FactionId,
    startingReputation: 55,
    startingHostility: 15,
    startingWealth: 180,
    headSeed: {
      characterId: "rival-beaumont-head" as CharacterId,
      name: "Lord Beaumont",
      gender: "Male",
      deathAge: 77,
      traits: ["Frivolous" as TraitId, "Jaded" as TraitId],
    },
    associatedSeeds: [
      {
        characterId: "rival-beaumont-a1" as CharacterId,
        name: "Lady Beaumont",
        gender: "Female",
        deathAge: 80,
        traits: ["Romantic" as TraitId],
      },
      {
        characterId: "rival-beaumont-a2" as CharacterId,
        name: "Penelope Beaumont",
        gender: "Female",
        deathAge: 85,
        traits: ["Vain" as TraitId, "Frivolous" as TraitId],
      },
    ],
  },
  {
    houseId: "rival-cavendish" as HouseId,
    displayName: "House Cavendish",
    factionId: "faction-country" as FactionId,
    startingReputation: 50,
    startingHostility: 20,
    startingWealth: 150,
    headSeed: {
      characterId: "rival-cavendish-head" as CharacterId,
      name: "Lord Cavendish",
      gender: "Male",
      deathAge: 74,
      traits: ["Rustic" as TraitId, "ImpoverishedNobility" as TraitId],
    },
    associatedSeeds: [
      {
        characterId: "rival-cavendish-a1" as CharacterId,
        name: "Lady Cavendish",
        gender: "Female",
        deathAge: 81,
        traits: ["Melancholic" as TraitId],
      },
      {
        characterId: "rival-cavendish-a2" as CharacterId,
        name: "Edmund Cavendish",
        gender: "Male",
        deathAge: 76,
        traits: ["Intellectual" as TraitId, "Observant" as TraitId],
      },
    ],
  },
];

if (RIVAL_HOUSES_FIXTURE.length !== 3) {
  throw new Error("Spec §3 line 130 requires exactly 3 canonical rivals");
}

// Set-of-ids exports for strip helpers and lookup gates. Frozen by Set's
// immutability + module-load init.
export const RIVAL_HOUSE_IDS_SET: ReadonlySet<HouseId> = new Set(
  RIVAL_HOUSES_FIXTURE.map((r) => r.houseId),
);
export const RIVAL_CHARACTER_IDS_SET: ReadonlySet<CharacterId> = new Set(
  RIVAL_HOUSES_FIXTURE.flatMap((r) => [
    r.headSeed.characterId,
    ...r.associatedSeeds.map((s) => s.characterId),
  ]),
);
if (RIVAL_HOUSE_IDS_SET.size !== 3) {
  throw new Error("RIVAL_HOUSE_IDS_SET must have exactly 3 entries (per spec §3 line 130)");
}
if (RIVAL_CHARACTER_IDS_SET.size !== 9) {
  throw new Error("RIVAL_CHARACTER_IDS_SET must have exactly 9 entries (3 heads + 6 associated)");
}
// Per-rival RNG seed separator collision check. The seed format is
// `${campaignSeed}|${rivalHouseId}`; a `|` in either substring would corrupt
// the determinism contract. campaignSeed is opaque (player-supplied); rival
// ids are fixture-controlled so we assert at module load.
for (const id of RIVAL_HOUSE_IDS_SET) {
  if (id.includes("|")) {
    throw new Error(
      `RivalHouseId ${id} contains '|' — per-rival RNG seed format requires no '|' in either substring`,
    );
  }
}

// Build a full 17-field Character from a rival character seed. Used by
// bootstrap (seedStartingFamily).
// `role` and `age` are passed in: head gets HeadOfHouse + age 35; associated
// chars get Dependent + age 30 (rivals at bootstrap are adults). `birthTick: 0`
// matches the baseline NPC precedent (npcs.ts:84) — aging.ts increments
// char.age per year-pass, NEVER recomputing from birthTick.
export function buildRivalCharacter(
  seed: RivalCharacterSeed,
  houseId: HouseId,
  role: "HeadOfHouse" | "Dependent",
  age: number,
): Character {
  return {
    id: seed.characterId,
    houseId,
    name: seed.name,
    birthTick: 0,
    age,
    deathAge: seed.deathAge,
    alive: true,
    diedAtTick: null,
    mood: "Receptive",
    moodLockUntilTick: 0,
    role,
    archetype: "None",
    traits: [...seed.traits],
    marriageId: null,
    composure: 100,
    maxComposure: 100,
    happiness: HAPPINESS_INITIAL,
    temptationHookUnlocked: false,
    assignedTutorCharacterId: null,
    tutorBonusTraitGranted: false,
    dullSpouseExposureStartTick: null,
    parentCharacterIds: null,
    gender: seed.gender,
    equippedArtifactIds: [],
  };
}

// Build the rival House entity. `hostility` and `factionId` are P8 widenings
// on HouseSchema; player + Independent default factionId="faction-crown" with
// hostility 0 (cosmetic per the v1 "rival economy" deferral).
export function buildRivalHouse(seed: RivalHouseSeed): House {
  return {
    id: seed.houseId,
    wealth: seed.startingWealth,
    reputation: seed.startingReputation,
    scandal: 0,
    headOfHouseCharacterId: seed.headSeed.characterId,
    generation: 0,
    ancestorSummary: [],
    heirless: false,
    currentLocation: "Capital",
    consecutiveTicksAtCurrentLocation: 0,
    lastAudienceTick: null,
    wardrobeLastRefreshTick: null,
    blockadeBypassEarned: false,
    grievances: [],
    exiled: false,
    hostility: seed.startingHostility,
    factionId: seed.factionId,
    // P11: rival houses don't carry P11 ledgers (only player house mints these at v1).
    siblingRivals: [],
    inheritedSecrets: [],
    bloodFeuds: [],
    // P13: rival houses never research couriers (player-elected action gated
    // on PLAYER_HOUSE_ID).
    courierResearchEarned: false,
    // P15: dynasty legacies are player-house-only; rivals zeroed (never increment).
    awardedDynastyPerks: [],
    consecutiveHeirsNaturalDeath: 0,
    cumulativeSuccessfulSeductions: 0,
    cumulativeWeaponizedWhispers: 0,
  };
}

// Build the RivalActorState entity (action-loop state — distinct from the
// House entity above). associatedCharacterIds is the 3-tuple [head, a1, a2].
export function buildRivalActorState(seed: RivalHouseSeed): RivalActorState {
  return {
    houseId: seed.houseId,
    factionId: seed.factionId,
    associatedCharacterIds: [
      seed.headSeed.characterId,
      seed.associatedSeeds[0].characterId,
      seed.associatedSeeds[1].characterId,
    ],
    lastActionTick: null,
  };
}

// Build the per-rival RngState entry. Seed format `${campaignSeed}|${houseId}`
// — engine-stable string-concat over arithmetic. Identical formula across
// bootstrap and migration paths.
export function buildRivalRngState(campaignSeed: string, houseId: HouseId): RngState {
  return createRngState(`${campaignSeed}|${houseId}`);
}
