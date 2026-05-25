// buildContents section-ordering tests (P17). The semantic-memory section
// rides on per-turn `contents` (NOT systemInstruction — cache mutual-exclusion),
// ordered [Setting:] mode-frame → [Relevant past events:] → transcript → message.

import { describe, expect, it } from "vitest";
import { buildContents } from "./conversation";

describe("buildContents — semanticContext rendering", () => {
  it("omits the section when semanticContext is empty", () => {
    const out = buildContents({
      history: [],
      freeformMessage: "Hello.",
      mode: "Ballroom",
      semanticContext: [],
    });
    expect(out).not.toContain("[Relevant past events:]");
    expect(out).toBe("Hello.");
  });

  it("renders the section before the transcript when non-empty", () => {
    const out = buildContents({
      history: [{ speaker: "house-head", text: "Earlier line." }],
      freeformMessage: "Now.",
      mode: "Ballroom",
      semanticContext: ["a duel thirty ticks ago", "a barbed exchange last Season"],
    });
    expect(out).toContain("[Relevant past events:]");
    expect(out).toContain("- a duel thirty ticks ago");
    // Section precedes the transcript line.
    expect(out.indexOf("[Relevant past events:]")).toBeLessThan(
      out.indexOf("Player: Earlier line."),
    );
  });

  it("orders [Setting:] mode-frame before [Relevant past events:] in Promenade mode", () => {
    const out = buildContents({
      history: [],
      freeformMessage: "Lovely day.",
      mode: "Promenade",
      semanticContext: ["a prior promenade"],
    });
    const settingIdx = out.indexOf("[Setting:");
    const semanticIdx = out.indexOf("[Relevant past events:]");
    expect(settingIdx).toBeGreaterThanOrEqual(0);
    expect(semanticIdx).toBeGreaterThan(settingIdx);
  });
});
