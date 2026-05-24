import { describe, expect, it } from "vitest";
import { makeGameState, makeHouse } from "../__test-utils__/factories";
import { PLAYER_HOUSE_ID } from "../rng";
import { transitTicks } from "./courier";

const STATE_NO_RESEARCH = makeGameState({
  houses: new Map([[PLAYER_HOUSE_ID, makeHouse({ courierResearchEarned: false })]]),
});
const STATE_WITH_RESEARCH = makeGameState({
  houses: new Map([[PLAYER_HOUSE_ID, makeHouse({ courierResearchEarned: true })]]),
});

describe("transitTicks (P13: signature widened to (state, originator, from, to))", () => {
  it("returns 0 for same-location pair", () => {
    expect(transitTicks(STATE_NO_RESEARCH, PLAYER_HOUSE_ID, "Capital", "Capital")).toBe(0);
  });
  it("is symmetric", () => {
    expect(transitTicks(STATE_NO_RESEARCH, PLAYER_HOUSE_ID, "Capital", "Country")).toBe(
      transitTicks(STATE_NO_RESEARCH, PLAYER_HOUSE_ID, "Country", "Capital"),
    );
  });
  it("returns the canonical pair's value (baseline, no research)", () => {
    // Capital → Country pair is registered as 2 ticks.
    expect(transitTicks(STATE_NO_RESEARCH, PLAYER_HOUSE_ID, "Capital", "Country")).toBe(2);
    expect(transitTicks(STATE_NO_RESEARCH, PLAYER_HOUSE_ID, "CanalCity", "RenaissanceCity")).toBe(
      3,
    );
  });
  it("halves transit (floor 1) when originator has courierResearchEarned: true", () => {
    // 2-tick baseline → ceil(2 * 0.5) = 1.
    expect(transitTicks(STATE_WITH_RESEARCH, PLAYER_HOUSE_ID, "Capital", "Country")).toBe(1);
    // 3-tick baseline → ceil(3 * 0.5) = 2.
    expect(transitTicks(STATE_WITH_RESEARCH, PLAYER_HOUSE_ID, "CanalCity", "RenaissanceCity")).toBe(
      2,
    );
  });
  it("research flag is per-originator-house — researched player vs unresearched independent", () => {
    // STATE_WITH_RESEARCH only sets the flag on the player house. Independent
    // (or any other house missing from the Map) gets baseline transit.
    expect(transitTicks(STATE_WITH_RESEARCH, PLAYER_HOUSE_ID, "Capital", "Country")).toBe(1);
    // Querying a house that isn't in state.houses falls back to baseline.
    expect(transitTicks(STATE_WITH_RESEARCH, "ghost-house" as never, "Capital", "Country")).toBe(2);
  });
});
