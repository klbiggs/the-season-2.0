// v2 → v3 parity invariant: a fresh-state hash equals the hash of a state
// produced by writing fresh state to SaveV2 → migrating to SaveV3 → lifting
// back to GameState. Pattern matches v1-to-v2.parity.test.ts.
//
// Seed list: PARITY_SEEDS = [...REPLAY_SEEDS, NEGATIVE_CONTROL_SEED] — same
// pattern as the v1→v2 parity test.

import { describe, expect, it } from "vitest";
import { hashState } from "../../game/hash";
import { NEGATIVE_CONTROL_SEED, REPLAY_SEEDS } from "../../game/rng.seeds";
import { createInitialState } from "../../game/store";
import { fromSaveV3, toSaveV2 } from "../schema";
import { migrate_v2_to_v3 } from "./v2-to-v3";

const PARITY_SEEDS = [...REPLAY_SEEDS, NEGATIVE_CONTROL_SEED] as const;

describe("v2 → v3 parity (fresh hash equals migrated hash)", () => {
  it.each(PARITY_SEEDS)("seed %s: fresh hash equals migrated hash", (seed) => {
    const fresh = createInitialState(seed);
    const v2 = toSaveV2(fresh);
    const v3 = migrate_v2_to_v3(v2);
    const lifted = fromSaveV3(v3);
    expect(hashState(fresh)).toBe(hashState(lifted));
  });
});
