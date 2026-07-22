import { describe, expect, it } from "vitest";
import { MODEL_DEFAULT, MODEL_FIRST_MEETING } from "../src/game/constants";
import type { Exchange } from "../src/llm/types";
import { routeModel } from "./routing";

const HISTORY: Exchange[] = [
  { speaker: "house-head", text: "Hello.", classifiedTactic: "Flattery", tick: 1 },
];

describe("routeModel", () => {
  it("routes to Pro on an empty history (first meeting)", () => {
    expect(routeModel([])).toBe(MODEL_FIRST_MEETING);
  });

  it("routes to Flash on a non-empty history with no key moment", () => {
    expect(routeModel(HISTORY)).toBe(MODEL_DEFAULT);
    expect(routeModel(HISTORY, null)).toBe(MODEL_DEFAULT);
  });

  it("P26 (G3): routes to Pro on a key moment even with non-empty history", () => {
    expect(routeModel(HISTORY, "proposal")).toBe(MODEL_FIRST_MEETING);
    expect(routeModel(HISTORY, "duel")).toBe(MODEL_FIRST_MEETING);
    expect(routeModel(HISTORY, "scheme")).toBe(MODEL_FIRST_MEETING);
    expect(routeModel(HISTORY, "audience")).toBe(MODEL_FIRST_MEETING);
  });
});
