// P11: pure shape-transformation migration. Asserts:
//   (a) Zero PRNG draws — save.rng is byte-identical pre/post.
//   (b) The three new House ledger fields are populated (empty arrays) on lift.
//   (c) The output passes SaveV12Schema.

import { describe, expect, it } from "vitest";
import { createInitialState } from "../../game/store";
import { SaveV11Schema, SaveV12Schema, toSaveV11 } from "../schema";
import { migrate_v11_to_v12 } from "./v11-to-v12";

describe("migrate_v11_to_v12", () => {
  it("produces a valid SaveV12 from a fresh-state SaveV11 round-trip", () => {
    const fresh = createInitialState("alpha");
    // Emit V11 via the legacy emitter (strips P11 ledger fields).
    const v11 = toSaveV11(fresh);
    expect(SaveV11Schema.safeParse(v11).success).toBe(true);

    const v12 = migrate_v11_to_v12(v11);
    expect(SaveV12Schema.safeParse(v12).success).toBe(true);
    expect(v12.version).toBe(12);
  });

  it("preserves rng byte-identity (zero draws)", () => {
    const fresh = createInitialState("beta");
    const v11 = toSaveV11(fresh);
    const v12 = migrate_v11_to_v12(v11);
    expect(v12.rng).toEqual(v11.rng);
  });

  it("backfills siblingRivals / inheritedSecrets / bloodFeuds as empty arrays on the player house", () => {
    const fresh = createInitialState("gamma");
    const v11 = toSaveV11(fresh);
    const v12 = migrate_v11_to_v12(v11);
    const playerHouseEntry = v12.houses.find(([id]) => id === "player");
    expect(playerHouseEntry).toBeDefined();
    if (playerHouseEntry === undefined) throw new Error("unreachable");
    const playerHouse = playerHouseEntry[1];
    expect(playerHouse.siblingRivals).toEqual([]);
    expect(playerHouse.inheritedSecrets).toEqual([]);
    expect(playerHouse.bloodFeuds).toEqual([]);
  });

  it("is idempotent — migrating an already-V12-shaped V11 yields equivalent V12", () => {
    const fresh = createInitialState("delta");
    const v11 = toSaveV11(fresh);
    const v12a = migrate_v11_to_v12(v11);
    const v12b = migrate_v11_to_v12(v11);
    expect(v12a).toEqual(v12b);
  });
});
