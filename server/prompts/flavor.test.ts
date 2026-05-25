// buildFlavorPrompt tests: each kind produces a distinct, period-voiced prompt;
// the scandal kind renders eventSummaries (and a quiet-season fallback).

import { describe, expect, it } from "vitest";
import type { TraitId } from "../../src/game/rng";
import { makeCharacter } from "../../src/llm/types";
import { buildFlavorPrompt } from "./flavor";

describe("buildFlavorPrompt", () => {
  it("shares one period-voice system instruction across kinds", () => {
    const a = buildFlavorPrompt({
      kind: "ArtifactBackstory",
      definitionId: "sapphires",
      displayName: "The Carrington Sapphires",
      family: "sapphires",
    });
    const b = buildFlavorPrompt({ kind: "NpcBio", character: makeCharacter() });
    expect(a.systemInstruction).toBe(b.systemInstruction);
    expect(a.systemInstruction).toContain("Regency");
  });

  it("ArtifactBackstory prompt names the artifact + family", () => {
    const { userPrompt } = buildFlavorPrompt({
      kind: "ArtifactBackstory",
      definitionId: "tiara",
      displayName: "The Marlborough Tiara",
      family: "tiara",
    });
    expect(userPrompt).toContain("The Marlborough Tiara");
    expect(userPrompt).toContain("tiara");
  });

  it("NpcBio prompt names the character + traits", () => {
    const character = makeCharacter({
      name: "Lady Vexley",
      traits: ["Witty", "Vain"] as TraitId[],
    });
    const { userPrompt } = buildFlavorPrompt({ kind: "NpcBio", character });
    expect(userPrompt).toContain("Lady Vexley");
    expect(userPrompt).toContain("Witty");
  });

  it("ScandalColumn prompt renders the event summaries", () => {
    const { userPrompt } = buildFlavorPrompt({
      kind: "ScandalColumn",
      generationCount: 2,
      eventSummaries: ["a duel at dawn", "a scandalous elopement"],
    });
    expect(userPrompt).toContain("generation 2");
    expect(userPrompt).toContain("a duel at dawn");
    expect(userPrompt).toContain("a scandalous elopement");
  });

  it("ScandalColumn prompt has a quiet-season fallback when there are no events", () => {
    const { userPrompt } = buildFlavorPrompt({
      kind: "ScandalColumn",
      generationCount: 0,
      eventSummaries: [],
    });
    expect(userPrompt.toLowerCase()).toContain("quiet season");
  });
});
