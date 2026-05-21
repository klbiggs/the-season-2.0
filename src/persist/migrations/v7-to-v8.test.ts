// P7: v7 → v8 migration test. Asserts a SaveV7 fixture migrates to SaveV8
// with the 7 new V8 character fields defaulted per character AND the 3
// new top-level Maps (proposalsLog, tutorAssignmentsLog,
// pendingTutorTraitChoices) defaulted to empty.

import { describe, expect, it } from "vitest";
import { DEFAULT_CAMPAIGN_NAME, createInitialState } from "../../game/store";
import { toSaveV7 } from "../schema";
import { migrate_v7_to_v8 } from "./v7-to-v8";

describe("migrate_v7_to_v8", () => {
  it("produces a SaveV8 with version=8 and 3 new empty top-level Maps", () => {
    const fresh = createInitialState("alpha", DEFAULT_CAMPAIGN_NAME);
    const v7 = toSaveV7(fresh);
    const v8 = migrate_v7_to_v8(v7);
    expect(v8.version).toBe(8);
    expect(v8.proposalsLog).toEqual([]);
    expect(v8.tutorAssignmentsLog).toEqual([]);
    expect(v8.pendingTutorTraitChoices).toEqual([]);
  });

  it("defaults the 7 new V8 character fields on every character", () => {
    const fresh = createInitialState("alpha", DEFAULT_CAMPAIGN_NAME);
    const v7 = toSaveV7(fresh);
    const v8 = migrate_v7_to_v8(v7);
    for (const [, c] of v8.characters) {
      expect(c.happiness).toBe(100);
      expect(c.temptationHookUnlocked).toBe(false);
      expect(c.assignedTutorCharacterId).toBeNull();
      expect(c.tutorBonusTraitGranted).toBe(false);
      expect(c.dullSpouseExposureStartTick).toBeNull();
      expect(c.parentCharacterIds).toBeNull();
      // gender is derived from FNV-1a hash of id; must be one of Female|Male.
      expect(["Female", "Male"]).toContain(c.gender);
    }
  });

  it("preserves all legacy V7 fields verbatim (no draws, no PRNG advance)", () => {
    const fresh = createInitialState("alpha", DEFAULT_CAMPAIGN_NAME);
    const v7 = toSaveV7(fresh);
    const v8 = migrate_v7_to_v8(v7);
    // RNG state preserved (migration consumes ZERO PRNG draws).
    expect(v8.rng).toEqual(v7.rng);
    // tick, era, campaignName, conversationHistory, affectionMap, schemes,
    // whispers, couriers, staff, marriages preserved.
    expect(v8.tick).toBe(v7.tick);
    expect(v8.era).toBe(v7.era);
    expect(v8.campaignName).toBe(v7.campaignName);
    expect(v8.conversationHistory).toEqual(v7.conversationHistory);
    expect(v8.affectionMap).toEqual(v7.affectionMap);
    expect(v8.schemes).toEqual(v7.schemes);
    expect(v8.whispers).toEqual(v7.whispers);
    expect(v8.couriers).toEqual(v7.couriers);
    expect(v8.staff).toEqual(v7.staff);
    expect(v8.marriages).toEqual(v7.marriages);
  });

  it("character count preserved (no orphans created or dropped)", () => {
    const fresh = createInitialState("alpha", DEFAULT_CAMPAIGN_NAME);
    const v7 = toSaveV7(fresh);
    const v8 = migrate_v7_to_v8(v7);
    expect(v8.characters.length).toBe(v7.characters.length);
    // Same set of ids.
    const v7Ids = new Set(v7.characters.map(([id]) => id));
    const v8Ids = new Set(v8.characters.map(([id]) => id));
    expect(v8Ids).toEqual(v7Ids);
  });
});
