import { describe, expect, it } from "vitest";
import { LORE_CORPUS } from "./lore";

describe("LORE_CORPUS", () => {
  it("is non-empty", () => {
    expect(LORE_CORPUS.length).toBeGreaterThan(0);
  });

  it("has unique ids", () => {
    const ids = LORE_CORPUS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has non-empty text for every passage", () => {
    for (const passage of LORE_CORPUS) {
      expect(passage.text.trim().length).toBeGreaterThan(0);
    }
  });
});
