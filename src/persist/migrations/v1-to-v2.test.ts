import { describe, expect, it } from "vitest";
import { hashState } from "../../game/hash";
import { REPLAY_SEEDS } from "../../game/rng.seeds";
import { SaveV1Schema, fromSaveV2 } from "../schema";
import { migrate_v1_to_v2 } from "./v1-to-v2";

describe("migrate_v1_to_v2 — determinism", () => {
  // Schema-rooted fixture prevents literal-vs-schema drift.
  const baseSaveV1 = SaveV1Schema.parse({
    version: 1,
    tick: 0,
    rng: [["player", { seed: "alpha", callCount: 0 }]],
  });

  it.each(REPLAY_SEEDS)("same seed %s → same hash across runs", (seed) => {
    const save = SaveV1Schema.parse({
      version: 1,
      tick: 0,
      rng: [["player", { seed, callCount: 0 }]],
    });
    const h1 = hashState(fromSaveV2(migrate_v1_to_v2(save)));
    const h2 = hashState(fromSaveV2(migrate_v1_to_v2(save)));
    expect(h1).toBe(h2);
  });

  it("base fixture produces a stable hash across 5 runs", () => {
    const h = hashState(fromSaveV2(migrate_v1_to_v2(baseSaveV1)));
    for (let i = 0; i < 4; i += 1) {
      expect(hashState(fromSaveV2(migrate_v1_to_v2(baseSaveV1)))).toBe(h);
    }
  });
});
