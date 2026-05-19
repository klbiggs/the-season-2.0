import { describe, expect, it } from "vitest";
import { synthStateAt } from "../__test-utils__/playerLocationFixtures";
import { PLAYER_HOUSE_ID } from "../rng";
import { InvalidTravelError, applyTravel, canTravel } from "./travel";

describe("canTravel — rejection paths", () => {
  it("rejects SameLocation", () => {
    const state = synthStateAt("Capital");
    const result = canTravel(state, PLAYER_HOUSE_ID, "Capital");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.kind).toBe("SameLocation");
  });

  it("rejects EraBlockaded for ForeignCapital in Earlier era without bypass", () => {
    const state = synthStateAt("Capital");
    const result = canTravel(state, PLAYER_HOUSE_ID, "ForeignCapital");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.kind).toBe("EraBlockaded");
  });

  it("allows ForeignCapital when blockadeBypassEarned is true", () => {
    const state = synthStateAt("Capital", { house: { blockadeBypassEarned: true } });
    const result = canTravel(state, PLAYER_HOUSE_ID, "ForeignCapital");
    expect(result.ok).toBe(true);
  });

  it("allows ForeignCapital in Later era", () => {
    const state = synthStateAt("Capital", { state: { era: "Later" } });
    const result = canTravel(state, PLAYER_HOUSE_ID, "ForeignCapital");
    expect(result.ok).toBe(true);
  });

  it("allows travel to any non-current, non-blockaded location", () => {
    const state = synthStateAt("Capital");
    expect(canTravel(state, PLAYER_HOUSE_ID, "Country").ok).toBe(true);
    expect(canTravel(state, PLAYER_HOUSE_ID, "CanalCity").ok).toBe(true);
  });
});

describe("applyTravel", () => {
  it("changes currentLocation and resets the consecutive-tick counter", () => {
    const state = synthStateAt("Capital", {
      house: { consecutiveTicksAtCurrentLocation: 7 },
    });
    const next = applyTravel(state, PLAYER_HOUSE_ID, "Country");
    const house = next.houses.get(PLAYER_HOUSE_ID);
    expect(house?.currentLocation).toBe("Country");
    expect(house?.consecutiveTicksAtCurrentLocation).toBe(0);
  });

  it("throws InvalidTravelError when called against unvalidated state", () => {
    const state = synthStateAt("Capital");
    expect(() => applyTravel(state, PLAYER_HOUSE_ID, "Capital")).toThrow(InvalidTravelError);
  });

  it("does not advance the tick (orchestrator owns tick advance)", () => {
    const state = synthStateAt("Capital", { state: { tick: 42 } });
    const next = applyTravel(state, PLAYER_HOUSE_ID, "Country");
    expect(next.tick).toBe(42);
  });
});
