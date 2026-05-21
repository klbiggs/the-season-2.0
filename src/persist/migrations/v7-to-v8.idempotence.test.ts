// Idempotence assertion for migrate_v7_to_v8.
//
// Load-bearing claim: applying migrate_v7_to_v8 twice produces identical
// output. The migration consumes ZERO PRNG draws (gender is derived
// deterministically via hashCharIdToGender, not via per-house RNG); the
// 7 new V8 character field defaults are constants; the 3 new top-level
// Maps default to empty.

import { describe, it } from "vitest";
import { DEFAULT_CAMPAIGN_NAME, createInitialState } from "../../game/store";
import { type SaveV7, toSaveV7 } from "../schema";
import { assertMigrationIdempotent } from "./__test-utils__/idempotence";
import { migrate_v7_to_v8 } from "./v7-to-v8";

function buildV7Fixture(seed: string): SaveV7 {
  // Build a fresh V8-shape state then serialize back to V7. toSaveV7
  // strips the 7 V8 character fields and omits the 3 new top-level Maps
  // (which aren't in SaveV7Schema). The V7 record is a clean legacy
  // fixture suitable for re-migration.
  const fresh = createInitialState(seed, DEFAULT_CAMPAIGN_NAME);
  return toSaveV7(fresh);
}

describe("migrate_v7_to_v8 idempotence", () => {
  it("twice-applied migration produces identical output (no PRNG draws)", () => {
    assertMigrationIdempotent(migrate_v7_to_v8, buildV7Fixture("alpha"));
  });
});
