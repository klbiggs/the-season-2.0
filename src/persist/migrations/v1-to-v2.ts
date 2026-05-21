// Pure idempotent v1 → v2 migration. SaveV1's schema has no character/house
// state by construction, so the migration always seeds a starting family.
//
// Draw-budget pin: deathAge is the ONLY draw consumed (1 total = 1 deathAge
// inside seedStartingFamily for the player head). NPC deathAges at P4 are
// constants from BASELINE_NPCS — zero draws for NPCs.
//
// P4: seedStartingFamily now returns PLURAL arrays { rngState, houses,
// characters } including the Independent house + 5 NPCs. V2 saves PREDATE
// the Independent house, so this migration FILTERS to the player house and
// player character only. Independent is introduced at migrate_v4_to_v5.
//
// Migrating a non-zero-tick SaveV1: the seeded head has `birthTick: 0` and
// `age: 25` regardless of the SaveV1 tick. This elides the original SaveV1's
// elapsed ticks; internally consistent (head's lifespan is 25 → deathAge)
// but narratively decoupled from the legacy save's tick value.

import { seedStartingFamily } from "../../game/bootstrap";
import type { House } from "../../game/entities";
import { PLAYER_HOUSE_ID } from "../../game/rng.seeds";
import type { SaveV1, SaveV2 } from "../schema";

// Strip the 5 P3 House fields when emitting legacy V2 format. Mirrors the
// existing toSaveV2's strip pattern at src/persist/schema.ts.
function stripHouseV4Fields(
  h: House,
): Omit<
  House,
  | "currentLocation"
  | "consecutiveTicksAtCurrentLocation"
  | "lastAudienceTick"
  | "wardrobeLastRefreshTick"
  | "blockadeBypassEarned"
> {
  const {
    currentLocation: _cl,
    consecutiveTicksAtCurrentLocation: _ct,
    lastAudienceTick: _la,
    wardrobeLastRefreshTick: _wr,
    blockadeBypassEarned: _bb,
    ...legacy
  } = h;
  return legacy;
}

export function migrate_v1_to_v2(save: SaveV1): SaveV2 {
  // SaveV1 always has exactly one rng entry (PLAYER_HOUSE_ID) per P0's
  // createInitialState contract. Read it, seed the starting family from that
  // rngState, then assemble the SaveV2 (player-only — Independent is V5+).
  // Step 5 will route SaveV2.characters through CharacterPreV5Schema; at
  // Step 3, SaveV2.characters still carries the live CharacterSchema
  // (including composure/maxComposure), so we emit playerChar directly.
  const firstEntry = save.rng[0];
  if (firstEntry === undefined) {
    throw new Error("migrate_v1_to_v2: SaveV1.rng has no entries");
  }
  const [, legacyRngState] = firstEntry;
  // P8: pass the player seed (= legacy rng seed) as the campaignSeed arg so
  // rival per-house RNG entries are deterministically derived. v1→v2 emits
  // V2-shape state (no rivals on disk), but seedStartingFamily's signature
  // demands the second arg post-P8.
  const seeded = seedStartingFamily(legacyRngState, legacyRngState.seed);
  const playerHouse = seeded.houses.find((h) => h.id === PLAYER_HOUSE_ID);
  const playerChar = seeded.characters.find((c) => c.houseId === PLAYER_HOUSE_ID);
  if (playerHouse === undefined || playerChar === undefined) {
    throw new Error("migrate_v1_to_v2: seedStartingFamily did not produce player house/character");
  }
  return {
    version: 2,
    tick: save.tick,
    rng: [[PLAYER_HOUSE_ID, seeded.rngState]],
    houses: [[playerHouse.id, stripHouseV4Fields(playerHouse)]],
    characters: [[playerChar.id, playerChar]],
    marriages: [],
  };
}
