// buildPersonaPrompt output format tests. P7 adds marriage-status +
// happiness-state paragraphs inside baseLines; ROLE_LABELS adds 3 new
// entries (Spinster/Exile/Bohemian).
//
// PERSONA_CACHE_VERSION bumped v2 → v3 at P7 — any prose change to
// buildPersonaPrompt's output requires bumping again (CLAUDE.md LLM-cache
// discipline).
//
// Plan: plans/phases/07-family-succession.md "Persona prompt body literal extension".

import { describe, expect, it } from "vitest";
import {
  makeCharacter,
  makeGameState,
  makeMarriage,
  makeMarriagesMap,
} from "../../game/__test-utils__/factories";
import { PERSONA_CACHE_VERSION } from "../../game/constants";
import { ROLES, type Role } from "../../game/fixtures/roles";
import type { CharacterId, MarriageId, TraitId } from "../../game/rng";
import { buildPersonaPrompt } from "./persona";

describe("buildPersonaPrompt — ROLE_LABELS completeness", () => {
  it.each(ROLES)("renders role %s with a non-empty label", (role: Role) => {
    const target = makeCharacter({ id: "t" as CharacterId, role });
    const state = makeGameState();
    const out = buildPersonaPrompt(target, [], state);
    // Every role must produce a "Test Character, <label> of London Society" line.
    expect(out).toMatch(/Test Character, .+ of London Society\./);
  });

  it("emits the canonical label for each P7-added role", () => {
    const cases: Array<[Role, string]> = [
      ["Spinster", "a spinster"],
      ["Exile", "an exile"],
      ["Bohemian", "a bohemian"],
    ];
    for (const [role, label] of cases) {
      const target = makeCharacter({ id: "t" as CharacterId, role });
      const out = buildPersonaPrompt(target, [], makeGameState());
      expect(out).toContain(`Test Character, ${label} of London Society`);
    }
  });

  it("preserves existing 4 labels verbatim (regression — no prose drift)", () => {
    const cases: Array<[Role, string]> = [
      ["HeadOfHouse", "a head"],
      ["Heir", "an heir"],
      ["Dependent", "a member"],
      ["Spouse", "a spouse"],
    ];
    for (const [role, label] of cases) {
      const target = makeCharacter({ id: "t" as CharacterId, role });
      const out = buildPersonaPrompt(target, [], makeGameState());
      expect(out).toContain(`Test Character, ${label} of London Society`);
    }
  });
});

describe("buildPersonaPrompt — marriage status paragraph (P7)", () => {
  it("emits 'unmarried' line when marriageId is null", () => {
    const target = makeCharacter({ id: "t" as CharacterId, marriageId: null });
    const out = buildPersonaPrompt(target, [], makeGameState());
    expect(out).toContain("Marriage status: unmarried.");
  });

  it("emits 'married to <name>' when marriage is active", () => {
    const targetId = "t" as CharacterId;
    const spouseId = "spouse" as CharacterId;
    const marriageId = "m1" as MarriageId;
    const target = makeCharacter({ id: targetId, marriageId });
    const spouse = makeCharacter({ id: spouseId, name: "Lady Spouse" });
    const marriage = makeMarriage({
      id: marriageId,
      spouseAId: targetId < spouseId ? targetId : spouseId,
      spouseBId: targetId < spouseId ? spouseId : targetId,
    });
    const state = makeGameState({
      characters: new Map([
        [targetId, target],
        [spouseId, spouse],
      ]),
      marriages: makeMarriagesMap([marriage]),
    });
    const out = buildPersonaPrompt(target, [], state);
    expect(out).toContain("Marriage status: married to Lady Spouse.");
  });

  it("emits 'widowed' line when marriage is dissolved", () => {
    const targetId = "t" as CharacterId;
    const marriageId = "m1" as MarriageId;
    const target = makeCharacter({ id: targetId, marriageId });
    const marriage = makeMarriage({
      id: marriageId,
      spouseAId: targetId,
      spouseBId: "spouse" as CharacterId,
      dissolved: true,
      dissolvedAtTick: 50,
    });
    const state = makeGameState({
      characters: new Map([[targetId, target]]),
      marriages: makeMarriagesMap([marriage]),
    });
    const out = buildPersonaPrompt(target, [], state);
    expect(out).toContain("Marriage status: widowed.");
  });
});

describe("buildPersonaPrompt — happiness state paragraph (P7)", () => {
  it("emits 'content' at happiness >= 70 (no latch)", () => {
    const target = makeCharacter({
      id: "t" as CharacterId,
      happiness: 80,
      temptationHookUnlocked: false,
    });
    const out = buildPersonaPrompt(target, [], makeGameState());
    expect(out).toContain("Happiness: content.");
  });

  it("emits 'subdued' at happiness 30-69 (no latch)", () => {
    const target = makeCharacter({
      id: "t" as CharacterId,
      happiness: 50,
      temptationHookUnlocked: false,
    });
    const out = buildPersonaPrompt(target, [], makeGameState());
    expect(out).toContain("Happiness: subdued.");
  });

  it("emits 'discontent' at happiness < 30 (no latch)", () => {
    const target = makeCharacter({
      id: "t" as CharacterId,
      happiness: 10,
      temptationHookUnlocked: false,
    });
    const out = buildPersonaPrompt(target, [], makeGameState());
    expect(out).toContain("Happiness: discontent.");
  });

  it("emits 'discontent — has felt the temptation' when latch set (regardless of happiness)", () => {
    const target = makeCharacter({
      id: "t" as CharacterId,
      happiness: 100, // even when restored
      temptationHookUnlocked: true,
    });
    const out = buildPersonaPrompt(target, [], makeGameState());
    expect(out).toContain("Happiness: discontent — has felt the temptation.");
  });
});

describe("buildPersonaPrompt — paragraph ordering invariant (P7)", () => {
  it("emits Marriage and Happiness lines after Archetype, before Reply line", () => {
    const target = makeCharacter({
      id: "t" as CharacterId,
      role: "HeadOfHouse",
      traits: ["Witty" as TraitId],
      marriageId: null,
    });
    const out = buildPersonaPrompt(target, [], makeGameState());
    const archetypeIdx = out.indexOf("Archetype:");
    const marriageIdx = out.indexOf("Marriage status:");
    const happinessIdx = out.indexOf("Happiness:");
    const replyIdx = out.indexOf("Reply in character");
    expect(archetypeIdx).toBeGreaterThan(0);
    expect(marriageIdx).toBeGreaterThan(archetypeIdx);
    expect(happinessIdx).toBeGreaterThan(marriageIdx);
    expect(replyIdx).toBeGreaterThan(happinessIdx);
  });
});

describe("PERSONA_CACHE_VERSION (P7 bump)", () => {
  it("is bumped to v3 (any prose change requires a future bump)", () => {
    expect(PERSONA_CACHE_VERSION).toBe("v3");
  });
});
