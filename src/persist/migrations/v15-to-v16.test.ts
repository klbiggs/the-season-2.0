// P18: pure shape-transformation migration. Asserts:
//   (a) The output passes SaveV16Schema.
//   (b) Zero PRNG draws — save.rng is byte-identical pre/post.
//   (c) flavorText backfills to an empty array (V15 saves predate the field).
//   (d) Idempotence — re-running on the same input yields equal V16.

import { describe, expect, it } from "vitest";
import { createInitialState } from "../../game/store";
import { SaveV15Schema, SaveV16Schema, toSaveV15 } from "../schema";
import { migrate_v15_to_v16 } from "./v15-to-v16";

describe("migrate_v15_to_v16", () => {
  it("produces a valid SaveV16 from a fresh-state SaveV15 round-trip", () => {
    const fresh = createInitialState("alpha");
    const v15 = toSaveV15(fresh);
    expect(SaveV15Schema.safeParse(v15).success).toBe(true);

    const v16 = migrate_v15_to_v16(v15);
    expect(SaveV16Schema.safeParse(v16).success).toBe(true);
    expect(v16.version).toBe(16);
  });

  it("preserves rng byte-identity (zero draws)", () => {
    const fresh = createInitialState("beta");
    const v15 = toSaveV15(fresh);
    const v16 = migrate_v15_to_v16(v15);
    expect(v16.rng).toEqual(v15.rng);
  });

  it("backfills flavorText to an empty array", () => {
    const fresh = createInitialState("gamma");
    const v15 = toSaveV15(fresh);
    const v16 = migrate_v15_to_v16(v15);
    expect(v16.flavorText).toEqual([]);
  });

  it("is idempotent", () => {
    const fresh = createInitialState("epsilon");
    const v15 = toSaveV15(fresh);
    expect(migrate_v15_to_v16(v15)).toEqual(migrate_v15_to_v16(v15));
  });
});
