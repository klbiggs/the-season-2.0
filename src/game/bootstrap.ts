// Single source of truth for starting-family construction. Called by both
// createInitialState (fresh-state path) and migrate_v1_to_v2 (legacy save
// upgrade path). The parity invariant — `hashState(createInitialState(seed))
// === hashState(fromSaveV2(migrate_v1_to_v2(saveV1WithSeed)))` when
// SaveV1.callCount = 0 — depends on this helper being the byte-identical
// shared bootstrap math.
//
// P4: returns PLURAL arrays { rngState, houses, characters } so both the
// player house AND the Independent house's 5 baseline NPCs can be seeded
// in one call. Both arrays are in deterministic order: houses[0] is the
// player house, houses[1] is Independent. characters[0] is the player
// head, characters[1..5] are the 5 NPCs in BASELINE_NPCS order.
// migrate_v1_to_v2 filters to player-only (V2 saves predate Independent);
// createInitialState includes both.
//
// NPC deathAges are CONSTANTS from the BASELINE_NPCS fixture — ZERO RNG
// draws for NPC construction. The bootstrap draw budget stays at 1
// (player head's deathAge only), unchanged from P3.

import { HAPPINESS_INITIAL, LIFESPAN_RANGE } from "./constants";
import type { Character, House, RivalActorState, StaffMember } from "./entities";
import { hashCharIdToGender } from "./fixtures/hashCharIdToGender";
import { STARTING_HEAD_CHARACTER_ID, STARTING_HEAD_NAME } from "./fixtures/names";
import { BASELINE_NPCS, buildBaselineNpcCharacter, buildIndependentHouse } from "./fixtures/npcs";
import {
  RIVAL_HOUSES_FIXTURE,
  buildRivalActorState,
  buildRivalCharacter,
  buildRivalHouse,
  buildRivalRngState,
} from "./fixtures/rivals";
import { BASELINE_STAFF, buildBaselineStaffMember } from "./fixtures/staff";
import { type FactionId, type HouseId, type RngState, drawInt } from "./rng";
import { PLAYER_HOUSE_ID } from "./rng";

export function seedStartingFamily(
  rngState: RngState,
  campaignSeed: string,
): {
  rngState: RngState;
  houses: ReadonlyArray<House>;
  characters: ReadonlyArray<Character>;
  staff: ReadonlyArray<StaffMember>;
  // P8 additions — bootstrap also seeds rival actors + per-rival RNG entries.
  // The migration path produces byte-identical structures via the V8→V9 seeder.
  rivalActors: ReadonlyArray<RivalActorState>;
  rivalRngEntries: ReadonlyArray<[HouseId, RngState]>;
} {
  // Roll deathAge ∈ [70, 95] inclusive via drawInt(_, 26) + 70.
  // This is the ONLY draw consumed by this helper (NPC deathAges are
  // constants from the fixture). callCount advances by 1.
  const range = LIFESPAN_RANGE[1] - LIFESPAN_RANGE[0] + 1; // = 26
  const { next: deathOffset, rngState: postDeathRoll } = drawInt(rngState, range);
  const deathAge = deathOffset + LIFESPAN_RANGE[0];

  const playerCharacter: Character = {
    id: STARTING_HEAD_CHARACTER_ID,
    houseId: PLAYER_HOUSE_ID,
    name: STARTING_HEAD_NAME,
    birthTick: 0, // campaign-start head
    age: 25,
    deathAge,
    alive: true,
    diedAtTick: null,
    mood: "Receptive",
    moodLockUntilTick: 0,
    role: "HeadOfHouse",
    archetype: "None",
    traits: [],
    marriageId: null,
    composure: 100,
    maxComposure: 100,
    // P7 defaults. Gender derived from FNV-1a hash (same source-of-truth as
    // legacy-lift path) so v1→v8 chain hash parity holds. parentCharacterIds
    // is null for the campaign-start head (pre-history parents).
    happiness: HAPPINESS_INITIAL,
    temptationHookUnlocked: false,
    assignedTutorCharacterId: null,
    tutorBonusTraitGranted: false,
    dullSpouseExposureStartTick: null,
    parentCharacterIds: null,
    gender: hashCharIdToGender(STARTING_HEAD_CHARACTER_ID),
  };

  const playerHouse: House = {
    id: PLAYER_HOUSE_ID,
    wealth: 100,
    reputation: 50,
    scandal: 0,
    headOfHouseCharacterId: STARTING_HEAD_CHARACTER_ID,
    generation: 0,
    ancestorSummary: [],
    heirless: false,
    // P3 additions — defaults match migrate_v3_to_v4's lift values so a
    // fresh-state + serialized-to-v4 hash equals a migrated-v3-to-v4 hash.
    currentLocation: "Capital",
    consecutiveTicksAtCurrentLocation: 0,
    lastAudienceTick: null,
    wardrobeLastRefreshTick: null,
    blockadeBypassEarned: false,
    // P5: empty grievance list at fresh state. Symmetric with the V6 lift
    // (defaultHouseV4Fields/defaultHouseV6Fields both default this to []).
    grievances: [],
    // P6: not exiled at fresh state. Symmetric with defaultHouseV*Fields
    // helpers in schema.ts.
    exiled: false,
    // P8: player house is on the Crown faction; hostility 0 (load-bearing
    // only on rival entries — predicate reads House.hostility for rivals).
    hostility: 0,
    factionId: "faction-crown" as FactionId,
  };

  // P4: Independent house + 5 NPCs. Built from constants — no RNG draws.
  const independentHouse = buildIndependentHouse();
  const npcs = BASELINE_NPCS.map(buildBaselineNpcCharacter);
  // P6: 4 baseline household staff. Built from constants — no RNG draws.
  // Draw budget preserved: only the player deathAge draw above consumes RNG.
  const staff = BASELINE_STAFF.map(buildBaselineStaffMember);

  // P8: 3 rival houses + 9 rival-associated characters + 3 per-rival RNG
  // entries + 3 RivalActorState entries. Built from constants — no RNG draws.
  // Per-rival seed = `${campaignSeed}|${houseId}` (string-concat, engine-stable).
  const rivalHouses: House[] = [];
  const rivalCharacters: Character[] = [];
  const rivalActors: RivalActorState[] = [];
  const rivalRngEntries: [HouseId, RngState][] = [];
  for (const seed of RIVAL_HOUSES_FIXTURE) {
    rivalHouses.push(buildRivalHouse(seed));
    // Head is adult (age 35); associated chars are adults (age 30).
    rivalCharacters.push(buildRivalCharacter(seed.headSeed, seed.houseId, "HeadOfHouse", 35));
    rivalCharacters.push(
      buildRivalCharacter(seed.associatedSeeds[0], seed.houseId, "Dependent", 30),
    );
    rivalCharacters.push(
      buildRivalCharacter(seed.associatedSeeds[1], seed.houseId, "Dependent", 30),
    );
    rivalActors.push(buildRivalActorState(seed));
    rivalRngEntries.push([seed.houseId, buildRivalRngState(campaignSeed, seed.houseId)]);
  }

  return {
    rngState: postDeathRoll,
    houses: [playerHouse, independentHouse, ...rivalHouses],
    characters: [playerCharacter, ...npcs, ...rivalCharacters],
    staff,
    rivalActors,
    rivalRngEntries,
  };
}
