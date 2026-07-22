// Post-parse resolver tests. Pin-overrides semantic per spec §3 line 70.

import { describe, expect, it } from "vitest";
import {
  type ConversationResponseRaw,
  ConversationResponseSchema,
  narrowResponse,
  resolveMoodHint,
  resolveTactic,
} from "./types";

describe("resolveTactic — pin always overrides", () => {
  it("pin wins over a valid model classification", () => {
    // Spec §3 line 70: "A pinned explicit intent overrides any
    // classification the language model produces."
    expect(resolveTactic("Flattery", "SlyGossip")).toBe("SlyGossip");
    expect(resolveTactic("WittyBanter", "DeepEmpathy")).toBe("DeepEmpathy");
  });

  it("pin wins over an invalid model classification", () => {
    expect(resolveTactic("nonsense", "Flattery")).toBe("Flattery");
  });

  it("no pin + valid model classification → model wins", () => {
    expect(resolveTactic("Flattery", null)).toBe("Flattery");
    expect(resolveTactic("SlyGossip", null)).toBe("SlyGossip");
  });

  it("no pin + invalid model classification → Flattery default", () => {
    expect(resolveTactic("nonsense", null)).toBe("Flattery");
    expect(resolveTactic("", null)).toBe("Flattery");
  });
});

describe("resolveMoodHint — drop-if-invalid", () => {
  it("undefined input → null", () => {
    expect(resolveMoodHint(undefined)).toBe(null);
  });

  it("valid enum value → returned as Mood", () => {
    expect(resolveMoodHint("Receptive")).toBe("Receptive");
    expect(resolveMoodHint("Grieving")).toBe("Grieving");
  });

  it("invalid value → null (drop, never throw)", () => {
    expect(resolveMoodHint("nonsense")).toBe(null);
    expect(resolveMoodHint("")).toBe(null);
  });
});

describe("narrowResponse — clamps qualityMultiplier + applies resolvers", () => {
  const baseRaw: ConversationResponseRaw = {
    dialogue: "Hello.",
    classifiedTactic: "Flattery",
    qualityMultiplier: 1.0,
    moodHint: undefined,
    toolCalls: [],
  };

  it("clamps qualityMultiplier above the ceiling (1.5)", () => {
    const out = narrowResponse({ ...baseRaw, qualityMultiplier: 2.7 }, null);
    expect(out.qualityMultiplier).toBe(1.5);
  });

  it("clamps qualityMultiplier below the floor (0.5)", () => {
    const out = narrowResponse({ ...baseRaw, qualityMultiplier: 0.1 }, null);
    expect(out.qualityMultiplier).toBe(0.5);
  });

  it("respects pin over model classification (regression for line-70 fix)", () => {
    const out = narrowResponse({ ...baseRaw, classifiedTactic: "Flattery" }, "SlyGossip");
    expect(out.classifiedTactic).toBe("SlyGossip");
  });

  it("moodHint = undefined → null", () => {
    const out = narrowResponse(baseRaw, null);
    expect(out.moodHint).toBe(null);
  });

  it("moodHint = valid Mood → kept", () => {
    const out = narrowResponse({ ...baseRaw, moodHint: "Defensive" }, null);
    expect(out.moodHint).toBe("Defensive");
  });
});

// ── P26 (G6): generateGrievance toolCall union ────────────────────────────
describe("ConversationResponseSchema toolCalls union (G6)", () => {
  it("parses a generateWhisper toolCall", () => {
    const parsed = ConversationResponseSchema.parse({
      dialogue: "Indeed.",
      classifiedTactic: "Flattery",
      qualityMultiplier: 1.0,
      toolCalls: [{ name: "generateWhisper", args: { subjectCharacterId: "npc-2", text: "psst" } }],
    });
    expect(parsed.toolCalls[0]?.name).toBe("generateWhisper");
  });

  it("parses a generateGrievance toolCall", () => {
    const parsed = ConversationResponseSchema.parse({
      dialogue: "How dare you.",
      classifiedTactic: "SlyGossip",
      qualityMultiplier: 1.0,
      toolCalls: [{ name: "generateGrievance", args: { severity: "a grave insult" } }],
    });
    expect(parsed.toolCalls[0]?.name).toBe("generateGrievance");
  });

  it("parses a generateGrievance toolCall with no args (severity optional)", () => {
    const parsed = ConversationResponseSchema.parse({
      dialogue: "How dare you.",
      classifiedTactic: "SlyGossip",
      qualityMultiplier: 1.0,
      toolCalls: [{ name: "generateGrievance", args: {} }],
    });
    expect(parsed.toolCalls[0]?.name).toBe("generateGrievance");
  });
});

describe("GRIEVANCE_SOURCES (G6)", () => {
  it("includes 'Conversation'", async () => {
    const { GRIEVANCE_SOURCES } = await import("../game/constants");
    expect(GRIEVANCE_SOURCES).toContain("Conversation");
  });
});
