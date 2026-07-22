// buildPersonaPrompt tests. P25 R6: the rival-house context line renders for a
// rival target (targetHouse non-null), is absent for a society target
// (targetHouse null), and picks its attitude clause by hostility band. Also
// pins PERSONA_CACHE_VERSION — any change to this file's output format MUST bump
// it (LLM-cache discipline, CLAUDE.md).

import { describe, expect, it } from "vitest";
import {
  PERSONA_CACHE_VERSION,
  PERSONA_HOSTILITY_DAGGERS_THRESHOLD,
  RIVAL_HOSTILITY_ACTIVATION_THRESHOLD,
} from "../../src/game/constants";
import type { CharacterStateSnapshot } from "../../src/llm/types";
import { makeCharacter } from "../../src/llm/types";
import { buildPersonaPrompt } from "./persona";

const makeSnapshot = (overrides: Partial<CharacterStateSnapshot> = {}): CharacterStateSnapshot => ({
  target: makeCharacter(),
  otherCharactersInScene: [],
  targetMarriage: null,
  spouse: null,
  targetHouse: null,
  ...overrides,
});

describe("buildPersonaPrompt base structure", () => {
  it("renders the character name, role, mood, and reply instruction", () => {
    const prompt = buildPersonaPrompt(
      makeSnapshot({ target: makeCharacter({ name: "Lady Vexley", mood: "Defensive" }) }),
    );
    expect(prompt).toContain("You are Lady Vexley, a member of London Society.");
    expect(prompt).toContain("Current mood: Defensive.");
    expect(prompt).toContain("Reply in character.");
  });
});

describe("buildPersonaPrompt rival-house line (P25 R6)", () => {
  it("omits the rival line for a society target (targetHouse null)", () => {
    const prompt = buildPersonaPrompt(makeSnapshot({ targetHouse: null }));
    expect(prompt).not.toContain("rival house");
  });

  it("names the house + faction for a rival target", () => {
    const prompt = buildPersonaPrompt(
      makeSnapshot({
        targetHouse: { displayName: "House Ashworth", factionId: "faction-gentry", hostility: 10 },
      }),
    );
    expect(prompt).toContain(
      "You belong to House Ashworth (faction-gentry faction), a rival house",
    );
  });

  it("uses 'cordially wary' below the activation threshold", () => {
    const prompt = buildPersonaPrompt(
      makeSnapshot({
        targetHouse: {
          displayName: "House Ashworth",
          factionId: "faction-gentry",
          hostility: RIVAL_HOSTILITY_ACTIVATION_THRESHOLD - 1,
        },
      }),
    );
    expect(prompt).toContain("cordially wary of the player's house");
    expect(prompt).not.toContain("openly hostile");
    expect(prompt).not.toContain("at daggers drawn");
  });

  it("uses 'openly hostile' at the activation threshold", () => {
    const prompt = buildPersonaPrompt(
      makeSnapshot({
        targetHouse: {
          displayName: "House Ashworth",
          factionId: "faction-gentry",
          hostility: RIVAL_HOSTILITY_ACTIVATION_THRESHOLD,
        },
      }),
    );
    expect(prompt).toContain("openly hostile to the player's house");
    expect(prompt).not.toContain("at daggers drawn");
  });

  it("uses 'at daggers drawn' at the daggers threshold", () => {
    const prompt = buildPersonaPrompt(
      makeSnapshot({
        targetHouse: {
          displayName: "House Ashworth",
          factionId: "faction-gentry",
          hostility: PERSONA_HOSTILITY_DAGGERS_THRESHOLD,
        },
      }),
    );
    expect(prompt).toContain("at daggers drawn with the player's house");
  });
});

describe("PERSONA_CACHE_VERSION", () => {
  it("is pinned at v5 (P25 R6 rival-line format bump)", () => {
    expect(PERSONA_CACHE_VERSION).toBe("v5");
  });
});
