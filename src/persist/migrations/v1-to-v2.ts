// Pure idempotent v1 → v2 migration. SaveV1's schema has no character/house
// state by construction, so the migration always seeds a starting family.
//
// Draw-budget pin: deathAge is the ONLY draw consumed (5 total = 1 deathAge
// inside seedStartingFamily). All other fields (birthTick=0, age=25, alive,
// mood=Receptive, role=HeadOfHouse, etc.) are literal defaults — no
// randomization. A future "make starting state more varied" change that adds
// draws will silently break the B7 parity invariant.
//
// Migrating a non-zero-tick SaveV1: the seeded head has `birthTick: 0` and
// `age: 25` regardless of the SaveV1 tick. This elides the original SaveV1's
// elapsed ticks; internally consistent (head's lifespan is 25 → deathAge)
// but narratively decoupled from the legacy save's tick value.

import { seedStartingFamily } from "../../game/bootstrap";
import { PLAYER_HOUSE_ID } from "../../game/rng.seeds";
import type { SaveV1, SaveV2 } from "../schema";

export function migrate_v1_to_v2(save: SaveV1): SaveV2 {
  // SaveV1 always has exactly one rng entry (PLAYER_HOUSE_ID) per P0's
  // createInitialState contract. Read it, seed the starting family from that
  // rngState, then assemble the SaveV2.
  const firstEntry = save.rng[0];
  if (firstEntry === undefined) {
    throw new Error("migrate_v1_to_v2: SaveV1.rng has no entries");
  }
  const [, legacyRngState] = firstEntry;
  const seeded = seedStartingFamily(legacyRngState);
  return {
    version: 2,
    tick: save.tick,
    rng: [[PLAYER_HOUSE_ID, seeded.rngState]],
    houses: [[seeded.house.id, seeded.house]],
    characters: [[seeded.character.id, seeded.character]],
    marriages: [],
  };
}
