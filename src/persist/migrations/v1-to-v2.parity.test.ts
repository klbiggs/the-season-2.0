// Fresh-state vs migration-path parity invariant (B7).
//   hashState(createInitialState(seed)) === hashState(fromSaveV2(migrate_v1_to_v2(saveV1)))
// Holds ONLY when SaveV1.callCount = 0 (the realistic-non-zero case is
// covered by callcount-passthrough below).
//
// Parity-test seed list: PARITY_SEEDS = [...REPLAY_SEEDS, NEGATIVE_CONTROL_SEED].
// NEGATIVE_CONTROL_SEED is a 6th positive case in THIS test (path-equality),
// distinct from its role in replay-harness.test.ts where it's the
// hash-distinct case.

import { describe, expect, it } from "vitest";
import { hashState } from "../../game/hash";
import { NEGATIVE_CONTROL_SEED, REPLAY_SEEDS } from "../../game/rng.seeds";
import { createInitialState } from "../../game/store";
import { SaveV1Schema, fromSaveV2 } from "../schema";
import { migrate_v1_to_v2 } from "./v1-to-v2";

const PARITY_SEEDS = [...REPLAY_SEEDS, NEGATIVE_CONTROL_SEED] as const;

describe("fresh-state vs migration parity (callCount=0 only)", () => {
  it.each(PARITY_SEEDS)("seed %s: fresh state hash equals migrated state hash", (seed) => {
    const fresh = createInitialState(seed);
    const saveV1 = SaveV1Schema.parse({
      version: 1,
      tick: 0,
      rng: [["player", { seed, callCount: 0 }]],
    });
    const migrated = fromSaveV2(migrate_v1_to_v2(saveV1));
    expect(hashState(fresh)).toBe(hashState(migrated));
  });
});
