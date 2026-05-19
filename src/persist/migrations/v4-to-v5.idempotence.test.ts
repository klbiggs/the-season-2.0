// Idempotence assertion for migrate_v4_to_v5 using assertMigrationIdempotent
// from P2's __test-utils__/idempotence.ts. Pattern mirrors
// v2-to-v3.idempotence.test.ts.

import { describe, it } from "vitest";
import { BASELINE_NPCS } from "../../game/fixtures/npcs";
import { INDEPENDENT_HOUSE_ID } from "../../game/rng";
import { DEFAULT_CAMPAIGN_NAME, createInitialState } from "../../game/store";
import { type SaveV4, toSaveV4 } from "../schema";
import { assertMigrationIdempotent } from "./__test-utils__/idempotence";
import { migrate_v4_to_v5 } from "./v4-to-v5";

function buildV4Fixture(seed: string): SaveV4 {
  const fresh = createInitialState(seed, DEFAULT_CAMPAIGN_NAME);
  const strippedHouses = new Map(fresh.houses);
  strippedHouses.delete(INDEPENDENT_HOUSE_ID);
  const strippedRng = new Map(fresh.rng);
  strippedRng.delete(INDEPENDENT_HOUSE_ID);
  const strippedCharacters = new Map(fresh.characters);
  for (const npc of BASELINE_NPCS) strippedCharacters.delete(npc.id);
  return toSaveV4({
    ...fresh,
    houses: strippedHouses,
    characters: strippedCharacters,
    rng: strippedRng,
  });
}

describe("migrate_v4_to_v5 idempotence", () => {
  it("twice-applied migration produces identical output (no PRNG draws)", () => {
    assertMigrationIdempotent(migrate_v4_to_v5, buildV4Fixture("alpha"));
  });
});
