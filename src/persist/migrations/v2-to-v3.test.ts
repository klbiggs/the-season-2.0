import { describe, expect, it } from "vitest";
import { DEFAULT_CAMPAIGN_NAME } from "../../game/store";
import { createStore, selectGameState } from "../../game/store";
import { SaveV2Schema, SaveV3Schema, toSaveV2 } from "../schema";
import { assertMigrationIdempotent } from "./__test-utils__/idempotence";
import { migrate_v2_to_v3 } from "./v2-to-v3";

function makeSaveV2() {
  // Use the live createInitialState + toSaveV2 to build a realistic SaveV2
  // fixture, then drop the campaignName-relevant fields (SaveV2 has no
  // such field, so this is naturally absent).
  const sut = createStore({ seed: "alpha" });
  return toSaveV2(selectGameState(sut.getState()));
}

describe("migrate_v2_to_v3", () => {
  it("(a) adds campaignName: DEFAULT_CAMPAIGN_NAME", () => {
    const v2 = makeSaveV2();
    const v3 = migrate_v2_to_v3(v2);
    expect(v3.campaignName).toBe(DEFAULT_CAMPAIGN_NAME);
  });

  it("(a2) bumps version to 3", () => {
    const v3 = migrate_v2_to_v3(makeSaveV2());
    expect(v3.version).toBe(3);
  });

  it("(b) is structurally pure (input not mutated)", () => {
    const v2 = makeSaveV2();
    const before = SaveV2Schema.parse(v2);
    migrate_v2_to_v3(v2);
    expect(v2).toEqual(before);
  });

  it("(c) is idempotent", () => {
    assertMigrationIdempotent(migrate_v2_to_v3, makeSaveV2());
  });

  it("(d) output passes SaveV3Schema.parse", () => {
    const v3 = migrate_v2_to_v3(makeSaveV2());
    expect(() => SaveV3Schema.parse(v3)).not.toThrow();
  });

  it("(e) consumes zero RNG draws (input.rng === output.rng-by-equality)", () => {
    const v2 = makeSaveV2();
    const v3 = migrate_v2_to_v3(v2);
    // Each [HouseId, RngState] tuple should be deeply equal — the migration
    // doesn't roll any draws.
    expect(v3.rng).toEqual(v2.rng);
    // callCount specifically must not advance.
    for (let i = 0; i < v2.rng.length; i++) {
      const v2Entry = v2.rng[i];
      const v3Entry = v3.rng[i];
      if (v2Entry === undefined || v3Entry === undefined) continue;
      expect(v3Entry[1].callCount).toBe(v2Entry[1].callCount);
    }
  });
});
