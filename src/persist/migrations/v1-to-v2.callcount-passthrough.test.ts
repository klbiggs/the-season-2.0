// SaveV1 with callCount > 0 → migrated state's player RNG has callCount + 1
// (the migration adds exactly one draw for the seeded head's deathAge).
// AND the migration is hash-stable across 30 runs of the same input.
//
// No parity expectation against fresh-state at callCount > 0 — the legacy
// save's pre-existing draws diverge from a fresh campaign by definition.

import { describe, expect, it } from "vitest";
import { hashState } from "../../game/hash";
import { PLAYER_HOUSE_ID } from "../../game/rng.seeds";
import { SaveV1Schema, fromSaveV2 } from "../schema";
import { migrate_v1_to_v2 } from "./v1-to-v2";

describe("migrate_v1_to_v2 — callCount passthrough at N > 0", () => {
  it("SaveV1 with callCount=42 produces migrated state with callCount=43", () => {
    const save = SaveV1Schema.parse({
      version: 1,
      tick: 100,
      rng: [["player", { seed: "alpha", callCount: 42 }]],
    });
    const migrated = fromSaveV2(migrate_v1_to_v2(save));
    expect(migrated.rng.get(PLAYER_HOUSE_ID)?.callCount).toBe(43);
  });

  it("hash-stable across 30 runs of same callCount=42 input", () => {
    const save = SaveV1Schema.parse({
      version: 1,
      tick: 100,
      rng: [["player", { seed: "alpha", callCount: 42 }]],
    });
    const baseline = hashState(fromSaveV2(migrate_v1_to_v2(save)));
    for (let i = 0; i < 29; i += 1) {
      expect(hashState(fromSaveV2(migrate_v1_to_v2(save)))).toBe(baseline);
    }
  });
});
