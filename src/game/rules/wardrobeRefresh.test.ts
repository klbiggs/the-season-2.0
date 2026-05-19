import { describe, expect, it } from "vitest";
import { synthStateAt } from "../__test-utils__/playerLocationFixtures";
import { WARDROBE_REFRESH_WEALTH_COST } from "../constants";
import { PLAYER_HOUSE_ID } from "../rng";
import { InvalidWardrobeError, applyWardrobeRefresh, canRefreshWardrobe } from "./wardrobeRefresh";

describe("canRefreshWardrobe", () => {
  it("rejects WrongLocation when not at Capital", () => {
    const state = synthStateAt("Country");
    const result = canRefreshWardrobe(state, PLAYER_HOUSE_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.kind).toBe("WrongLocation");
  });

  it("allows at Capital regardless of wealth (spec §7 wardrobe-during-bankruptcy)", () => {
    const state = synthStateAt("Capital", { house: { wealth: 0 } });
    expect(canRefreshWardrobe(state, PLAYER_HOUSE_ID).ok).toBe(true);
  });

  it("allows at Capital even with deeply negative wealth", () => {
    const state = synthStateAt("Capital", { house: { wealth: -1000 } });
    expect(canRefreshWardrobe(state, PLAYER_HOUSE_ID).ok).toBe(true);
  });
});

describe("applyWardrobeRefresh", () => {
  it("deducts WARDROBE_REFRESH_WEALTH_COST and sets wardrobeLastRefreshTick", () => {
    const state = synthStateAt("Capital", {
      house: { wealth: 100 },
      state: { tick: 42 },
    });
    const next = applyWardrobeRefresh(state, PLAYER_HOUSE_ID);
    const house = next.houses.get(PLAYER_HOUSE_ID);
    expect(house?.wealth).toBe(100 - WARDROBE_REFRESH_WEALTH_COST);
    expect(house?.wardrobeLastRefreshTick).toBe(42);
  });

  it("permits going negative (no wealth gate)", () => {
    const state = synthStateAt("Capital", { house: { wealth: 0 } });
    const next = applyWardrobeRefresh(state, PLAYER_HOUSE_ID);
    expect(next.houses.get(PLAYER_HOUSE_ID)?.wealth).toBe(-WARDROBE_REFRESH_WEALTH_COST);
  });

  it("throws InvalidWardrobeError when called against unvalidated state", () => {
    const state = synthStateAt("Country");
    expect(() => applyWardrobeRefresh(state, PLAYER_HOUSE_ID)).toThrow(InvalidWardrobeError);
  });
});
