// Idempotence assertion for migrate_v15_to_v16 using assertMigrationIdempotent.
// The migration is a pure shape transformation (flavorText backfills empty), so
// two independent applications produce identical SaveV16 output.

import { describe, it } from "vitest";
import { createInitialState } from "../../game/store";
import { type SaveV15, toSaveV15 } from "../schema";
import { assertMigrationIdempotent } from "./__test-utils__/idempotence";
import { migrate_v15_to_v16 } from "./v15-to-v16";

function buildV15Fixture(seed: string): SaveV15 {
  return toSaveV15(createInitialState(seed));
}

describe("migrate_v15_to_v16 idempotence", () => {
  it("twice-applied migration produces identical output", () => {
    assertMigrationIdempotent(migrate_v15_to_v16, buildV15Fixture("alpha"));
  });
});
