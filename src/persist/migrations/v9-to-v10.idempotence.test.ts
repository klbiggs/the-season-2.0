// Idempotence assertion for migrate_v9_to_v10.
//
// Load-bearing claim: applying migrate_v9_to_v10 twice produces identical
// output. The migration consumes ZERO PRNG draws (elopement defaults to null;
// MarriageRecord.viaElopement defaults to false via Zod .default).

import { describe, it } from "vitest";
import { DEFAULT_CAMPAIGN_NAME, createInitialState } from "../../game/store";
import { type SaveV9, toSaveV9 } from "../schema";
import { assertMigrationIdempotent } from "./__test-utils__/idempotence";
import { migrate_v9_to_v10 } from "./v9-to-v10";

function buildV9Fixture(seed: string): SaveV9 {
  const fresh = createInitialState(seed, DEFAULT_CAMPAIGN_NAME);
  return toSaveV9(fresh);
}

describe("migrate_v9_to_v10 idempotence", () => {
  it("twice-applied migration produces identical output (no PRNG draws)", () => {
    assertMigrationIdempotent(migrate_v9_to_v10, buildV9Fixture("alpha"));
  });
});
