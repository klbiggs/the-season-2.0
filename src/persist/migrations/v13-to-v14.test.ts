// P15: pure shape-transformation migration. Asserts:
//   (a) The output passes SaveV14Schema.
//   (b) Zero PRNG draws — save.rng is byte-identical pre/post.
//   (c) The 4 new House fields seed empty/0 on every house via lift.
//   (d) Per-house defaults (awardedDynastyPerks=[] + 3 counters=0).
//   (e) Idempotence — re-running the migration on the same input yields equal V14.

import { describe, expect, it } from "vitest";
import { createInitialState } from "../../game/store";
import { SaveV13Schema, SaveV14Schema, toSaveV13 } from "../schema";
import { migrate_v13_to_v14 } from "./v13-to-v14";

describe("migrate_v13_to_v14", () => {
  it("produces a valid SaveV14 from a fresh-state SaveV13 round-trip", () => {
    const fresh = createInitialState("alpha");
    // Emit V13 via the legacy emitter (post-P15 demotion: strips the 4 fields).
    const v13 = toSaveV13(fresh);
    expect(SaveV13Schema.safeParse(v13).success).toBe(true);

    const v14 = migrate_v13_to_v14(v13);
    expect(SaveV14Schema.safeParse(v14).success).toBe(true);
    expect(v14.version).toBe(14);
  });

  it("preserves rng byte-identity (zero draws)", () => {
    const fresh = createInitialState("beta");
    const v13 = toSaveV13(fresh);
    const v14 = migrate_v13_to_v14(v13);
    expect(v14.rng).toEqual(v13.rng);
  });

  it("backfills the 4 dynasty-legacy fields empty/0 on every house", () => {
    const fresh = createInitialState("gamma");
    const v13 = toSaveV13(fresh);
    const v14 = migrate_v13_to_v14(v13);
    for (const [, house] of v14.houses) {
      expect(house.awardedDynastyPerks).toEqual([]);
      expect(house.consecutiveHeirsNaturalDeath).toBe(0);
      expect(house.cumulativeSuccessfulSeductions).toBe(0);
      expect(house.cumulativeWeaponizedWhispers).toBe(0);
    }
  });

  it("is idempotent — migrating an already-V14-shaped V13 yields equivalent V14", () => {
    const fresh = createInitialState("epsilon");
    const v13 = toSaveV13(fresh);
    const v14a = migrate_v13_to_v14(v13);
    const v14b = migrate_v13_to_v14(v13);
    expect(v14a).toEqual(v14b);
  });
});
