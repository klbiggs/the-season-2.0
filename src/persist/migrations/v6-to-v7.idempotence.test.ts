// Idempotence assertion for migrate_v6_to_v7 using assertMigrationIdempotent
// from P2's __test-utils__/idempotence.ts. Pattern mirrors
// v4-to-v5.idempotence.test.ts.
//
// Load-bearing claim: applying migrate_v6_to_v7 twice produces identical
// output. The seedWhispersCouriersStaff helper's size-check branch
// (state.staff.size === 0 → seed baseline; otherwise preserve) is what
// makes the second pass a no-op when the first pass produced non-empty staff.

import { describe, it } from "vitest";
import { DEFAULT_CAMPAIGN_NAME, createInitialState } from "../../game/store";
import { type SaveV6, toSaveV6 } from "../schema";
import { assertMigrationIdempotent } from "./__test-utils__/idempotence";
import { migrate_v6_to_v7 } from "./v6-to-v7";

function buildV6Fixture(seed: string): SaveV6 {
  // Build a fresh V7-shape state then serialize back to V6 (toSaveV6 strips
  // exiled). The whispers/couriers/staff fields are dropped by toSaveV6
  // (SaveV6Schema has no slots for them), so the V6 record is a clean
  // legacy fixture suitable for re-migration.
  const fresh = createInitialState(seed, DEFAULT_CAMPAIGN_NAME);
  return toSaveV6(fresh);
}

describe("migrate_v6_to_v7 idempotence", () => {
  it("twice-applied migration produces identical output (no PRNG draws)", () => {
    assertMigrationIdempotent(migrate_v6_to_v7, buildV6Fixture("alpha"));
  });
});
