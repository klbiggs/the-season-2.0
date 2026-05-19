import { describe, expect, it } from "vitest";
import { transitTicks } from "./courier";

describe("transitTicks", () => {
  it("returns 0 for same-location pair", () => {
    expect(transitTicks("Capital", "Capital")).toBe(0);
  });
  it("is symmetric", () => {
    expect(transitTicks("Capital", "Country")).toBe(transitTicks("Country", "Capital"));
  });
  it("returns the canonical pair's value", () => {
    // Capital → Country pair is registered as 2 ticks.
    expect(transitTicks("Capital", "Country")).toBe(2);
    expect(transitTicks("CanalCity", "RenaissanceCity")).toBe(3);
  });
});
