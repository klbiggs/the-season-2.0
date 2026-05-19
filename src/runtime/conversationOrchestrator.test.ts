// Conversation orchestrator tests — happy path + session methods.
// Uses the default __mocks__/@google/genai mock (deterministic hash-derived
// responses). The four SDK-failure-path tests (timeout/network/schema/
// cancelled via abort during in-flight) are exercised by integration tests
// elsewhere; the orchestrator's catch-and-map logic is straightforward
// (type-based instanceof checks), and the typed-error classes carry their
// own `reason` discriminator.

import { vi } from "vitest";
vi.mock("@google/genai");

import { afterEach, describe, expect, it } from "vitest";
import { makeCharacter } from "../game/__test-utils__/factories";
import type { Character } from "../game/entities";
import type { CharacterId, HouseId } from "../game/rng";
import type { ConversationRequest } from "../llm/types";
import { conversationOrchestrator } from "./conversationOrchestrator";

const baseRequest = (): ConversationRequest => ({
  targetCharacterId: "npc-test" as CharacterId,
  playerHouseId: "player" as HouseId,
  pinnedIntent: null,
  freeformMessage: "Hello.",
  history: [],
  persona: "You are a test NPC.",
  cacheName: null,
  model: "gemini-3.5-flash",
});

const target = (): Character => makeCharacter({ id: "npc-test" as CharacterId });

afterEach(() => {
  conversationOrchestrator.endSession();
  conversationOrchestrator.abortCurrent();
});

describe("conversationOrchestrator.send (happy path via deterministic mock)", () => {
  it("returns Resolved with narrowed ConversationResponse", async () => {
    const result = await conversationOrchestrator.send(baseRequest(), "AIza-test-key", target());
    expect(result.kind).toBe("Resolved");
    if (result.kind === "Resolved") {
      expect(result.response.dialogue.length).toBeGreaterThan(0);
      expect(["Flattery", "WittyBanter", "SlyGossip", "DeepEmpathy"]).toContain(
        result.response.classifiedTactic,
      );
      // qualityMultiplier clamped to [0.5, 1.5]
      expect(result.response.qualityMultiplier).toBeGreaterThanOrEqual(0.5);
      expect(result.response.qualityMultiplier).toBeLessThanOrEqual(1.5);
    }
  });

  it("missing-key failure: empty apiKey rejects before SDK is touched", async () => {
    const result = await conversationOrchestrator.send(baseRequest(), "", target());
    expect(result.kind).toBe("Failed");
    if (result.kind === "Failed") expect(result.failure.reason).toBe("missing-key");
  });

  it("missing-key failure: malformed apiKey (no AIza prefix) rejects", async () => {
    const result = await conversationOrchestrator.send(baseRequest(), "garbage", target());
    expect(result.kind).toBe("Failed");
    if (result.kind === "Failed") expect(result.failure.reason).toBe("missing-key");
  });

  it("produces deterministic responses for identical requests (replay-harness contract)", async () => {
    const req = baseRequest();
    const r1 = await conversationOrchestrator.send(req, "AIza-test-key", target());
    const r2 = await conversationOrchestrator.send(req, "AIza-test-key", target());
    if (r1.kind === "Resolved" && r2.kind === "Resolved") {
      expect(r1.response.dialogue).toBe(r2.response.dialogue);
      expect(r1.response.classifiedTactic).toBe(r2.response.classifiedTactic);
      expect(r1.response.qualityMultiplier).toBe(r2.response.qualityMultiplier);
    } else {
      expect.fail("expected both calls to Resolve");
    }
  });
});

describe("conversationOrchestrator session methods", () => {
  it("beginSession returns tick-derived BallSessionId; endSession clears", () => {
    const id1 = conversationOrchestrator.beginSession(7);
    expect(id1).toBe("ball-7");
    expect(conversationOrchestrator.currentSessionId()).toBe("ball-7");
    expect(conversationOrchestrator.endSession()).toBe("ball-7");
    expect(conversationOrchestrator.currentSessionId()).toBe(null);
  });

  it("re-entering within the same tick is idempotent", () => {
    const id1 = conversationOrchestrator.beginSession(10);
    const id2 = conversationOrchestrator.beginSession(10);
    expect(id1).toBe(id2);
    conversationOrchestrator.endSession();
  });

  it("beginSession at a different tick replaces the existing session", () => {
    const id1 = conversationOrchestrator.beginSession(10);
    const id2 = conversationOrchestrator.beginSession(11);
    expect(id1).toBe("ball-10");
    expect(id2).toBe("ball-11");
    expect(conversationOrchestrator.currentSessionId()).toBe("ball-11");
    conversationOrchestrator.endSession();
  });
});

describe("conversationOrchestrator.abortCurrent", () => {
  it("is a no-op when no request is in flight", () => {
    // Just shouldn't throw.
    conversationOrchestrator.abortCurrent();
    expect(true).toBe(true);
  });
});
