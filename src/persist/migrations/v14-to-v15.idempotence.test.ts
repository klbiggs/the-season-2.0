// Idempotence assertion for migrate_v14_to_v15 using assertMigrationIdempotent.
// The society generator is deterministic (transient `${seed}|procedural-npcs`
// stream), so two independent applications produce identical SaveV15 output.

import { describe, it } from "vitest";
import { DEFAULT_CAMPAIGN_NAME, createInitialState } from "../../game/store";
import { type SaveV14, toSaveV14 } from "../schema";
import { assertMigrationIdempotent } from "./__test-utils__/idempotence";
import { migrate_v14_to_v15 } from "./v14-to-v15";

function buildV14Fixture(seed: string): SaveV14 {
  // toSaveV14 is a legacy emitter at P16 — it filters out the proc-npc society,
  // yielding a valid pre-P16 V14 shape (no society on disk).
  return toSaveV14(createInitialState(seed, DEFAULT_CAMPAIGN_NAME));
}

describe("migrate_v14_to_v15 idempotence", () => {
  it("twice-applied migration produces identical output (deterministic society generation)", () => {
    assertMigrationIdempotent(migrate_v14_to_v15, buildV14Fixture("alpha"));
  });
});
