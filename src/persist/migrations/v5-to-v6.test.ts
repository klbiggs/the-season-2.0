// P5: v5 → v6 migration test. Asserts a SaveV5 fixture migrates to SaveV6
// with empty `schemes` array AND `grievances: []` on every house.

import { describe, expect, it } from "vitest";
import { DEFAULT_CAMPAIGN_NAME } from "../../game/store";
import { createInitialState } from "../../game/store";
import { toSaveV5 } from "../schema";
import { migrate_v5_to_v6 } from "./v5-to-v6";

describe("migrate_v5_to_v6", () => {
  it("produces a SaveV6 with empty schemes and grievances:[] on every house", () => {
    const fresh = createInitialState("alpha", DEFAULT_CAMPAIGN_NAME);
    const v5 = toSaveV5(fresh);
    const v6 = migrate_v5_to_v6(v5);
    expect(v6.version).toBe(6);
    expect(v6.schemes).toEqual([]);
    for (const [, house] of v6.houses) {
      expect(house.grievances).toEqual([]);
    }
  });

  it("is idempotent", () => {
    const fresh = createInitialState("alpha", DEFAULT_CAMPAIGN_NAME);
    const v5 = toSaveV5(fresh);
    const out1 = migrate_v5_to_v6(v5);
    const out2 = migrate_v5_to_v6(v5);
    expect(out1).toEqual(out2);
  });
});
