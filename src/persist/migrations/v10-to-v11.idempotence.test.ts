// Idempotence assertion for migrate_v10_to_v11.
//
// Load-bearing claim: applying migrate_v10_to_v11 twice produces identical
// output. The migration consumes ZERO PRNG draws — bootstrapPlayerArtifactsForMigration
// is deterministic state-walk-counted; the new top-level Maps default empty;
// the new Character.equippedArtifactIds field defaults via Zod .default([]).

import { describe, it } from "vitest";
import { DEFAULT_CAMPAIGN_NAME, createInitialState } from "../../game/store";
import { type SaveV10, toSaveV10 } from "../schema";
import { assertMigrationIdempotent } from "./__test-utils__/idempotence";
import { migrate_v10_to_v11 } from "./v10-to-v11";

function buildV10Fixture(seed: string): SaveV10 {
  const fresh = createInitialState(seed, DEFAULT_CAMPAIGN_NAME);
  return toSaveV10(fresh);
}

describe("migrate_v10_to_v11 idempotence", () => {
  it("twice-applied migration produces identical output (no PRNG draws)", () => {
    assertMigrationIdempotent(migrate_v10_to_v11, buildV10Fixture("alpha"));
  });
});
