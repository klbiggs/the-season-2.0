import { describe, expect, it } from "vitest";
import type { FactionId } from "../../game/rng.seeds";
import { factionColor } from "../socialWeb/colors";
import { monogramLetter, monogramStyle } from "./monogram";

describe("monogramStyle (P22)", () => {
  it("is deterministic per id (same id → same background)", () => {
    const a = monogramStyle("proc-npc-7");
    const b = monogramStyle("proc-npc-7");
    expect(a.backgroundColor).toBe(b.backgroundColor);
  });

  it("yields different backgrounds for different ids", () => {
    expect(monogramStyle("proc-npc-1").backgroundColor).not.toBe(
      monogramStyle("proc-npc-2").backgroundColor,
    );
  });

  it("produces an in-range HSL background", () => {
    const { backgroundColor } = monogramStyle("any-id");
    expect(backgroundColor).toMatch(/^hsl\(\d{1,3}, 52%, 82%\)$/);
  });

  it("rings with the faction color (or the neutral fallback when none)", () => {
    const crown = "faction-crown" as FactionId;
    expect(monogramStyle("x", crown).ringColor).toBe(factionColor(crown));
    expect(monogramStyle("x").ringColor).toBe(factionColor(undefined));
  });
});

describe("monogramLetter", () => {
  it("returns the uppercased first character", () => {
    expect(monogramLetter("arabella")).toBe("A");
    expect(monogramLetter("Mr. Tobias")).toBe("M");
  });
});
