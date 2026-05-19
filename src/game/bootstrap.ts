// Single source of truth for starting-family construction. Called by both
// createInitialState (fresh-state path) and migrate_v1_to_v2 (legacy save
// upgrade path). The parity invariant — `hashState(createInitialState(seed))
// === hashState(fromSaveV2(migrate_v1_to_v2(saveV1WithSeed)))` when
// SaveV1.callCount = 0 — depends on this helper being the byte-identical
// shared bootstrap math.
//
// Both call sites invoke seedStartingFamily as a bare call with NO surrounding
// setup — no pre-call rngState modifications, no post-call adjustments to the
// returned house/character.

import { LIFESPAN_RANGE } from "./constants";
import type { Character, House } from "./entities";
import { STARTING_HEAD_CHARACTER_ID, STARTING_HEAD_NAME } from "./fixtures/names";
import { type RngState, drawInt } from "./rng";
import { PLAYER_HOUSE_ID } from "./rng";

export function seedStartingFamily(rngState: RngState): {
  rngState: RngState;
  house: House;
  character: Character;
} {
  // Roll deathAge ∈ [70, 95] inclusive via drawInt(_, 26) + 70.
  // This is the ONLY draw consumed by this helper. callCount advances by 1.
  const range = LIFESPAN_RANGE[1] - LIFESPAN_RANGE[0] + 1; // = 26
  const { next: deathOffset, rngState: postDeathRoll } = drawInt(rngState, range);
  const deathAge = deathOffset + LIFESPAN_RANGE[0];

  const character: Character = {
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
  };

  const house: House = {
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
  };

  return { rngState: postDeathRoll, house, character };
}
