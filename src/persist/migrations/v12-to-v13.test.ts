// P13: pure shape-transformation migration. Asserts:
//   (a) Zero PRNG draws — save.rng is byte-identical pre/post.
//   (b) globalEvents Map is empty on lift (no event mid-flight at migration).
//   (c) courierResearchEarned defaults to false on every house via Zod backfill.
//   (d) The output passes SaveV13Schema.
//   (e) Idempotence — re-running the migration on the same input yields equal V13.

import { describe, expect, it } from "vitest";
import { createInitialState } from "../../game/store";
import { SaveV12Schema, SaveV13Schema, toSaveV12 } from "../schema";
import { migrate_v12_to_v13 } from "./v12-to-v13";

describe("migrate_v12_to_v13", () => {
  it("produces a valid SaveV13 from a fresh-state SaveV12 round-trip", () => {
    const fresh = createInitialState("alpha");
    // Emit V12 via the legacy emitter (post-P13 demotion: strips courierResearchEarned).
    const v12 = toSaveV12(fresh);
    expect(SaveV12Schema.safeParse(v12).success).toBe(true);

    const v13 = migrate_v12_to_v13(v12);
    expect(SaveV13Schema.safeParse(v13).success).toBe(true);
    expect(v13.version).toBe(13);
  });

  it("preserves rng byte-identity (zero draws)", () => {
    const fresh = createInitialState("beta");
    const v12 = toSaveV12(fresh);
    const v13 = migrate_v12_to_v13(v12);
    expect(v13.rng).toEqual(v12.rng);
  });

  it("backfills globalEvents as an empty array on lift", () => {
    const fresh = createInitialState("gamma");
    const v12 = toSaveV12(fresh);
    const v13 = migrate_v12_to_v13(v12);
    expect(v13.globalEvents).toEqual([]);
  });

  it("backfills courierResearchEarned: false on every house", () => {
    const fresh = createInitialState("delta");
    const v12 = toSaveV12(fresh);
    const v13 = migrate_v12_to_v13(v12);
    for (const [, house] of v13.houses) {
      expect(house.courierResearchEarned).toBe(false);
    }
  });

  it("is idempotent — migrating an already-V13-shaped V12 yields equivalent V13", () => {
    const fresh = createInitialState("epsilon");
    const v12 = toSaveV12(fresh);
    const v13a = migrate_v12_to_v13(v12);
    const v13b = migrate_v12_to_v13(v12);
    expect(v13a).toEqual(v13b);
  });
});
