// Conversation orchestrator tests — happy path + session methods.
// P7.5: client tests use the global `fetch` stub registered in
// vitest.setup.ts; the @google/genai SDK is no longer reachable from the
// browser tree. MissingKeyError tests deleted with the BYOK relocation.

import { afterEach, describe, expect, it } from "vitest";
import { makeCharacter } from "../game/__test-utils__/factories";
import type { CharacterId, HouseId } from "../game/rng";
import type { ProxyConversationRequest } from "../llm/types";
import { conversationOrchestrator } from "./conversationOrchestrator";

const baseRequest = (): ProxyConversationRequest => {
  const target = makeCharacter({ id: "npc-test" as CharacterId });
  return {
    targetCharacterId: target.id,
    playerHouseId: "player" as HouseId,
    freeformMessage: "Hello.",
    history: [],
    otherCharactersInScene: [],
    characterStateSnapshot: {
      target,
      otherCharactersInScene: [],
      targetMarriage: null,
      spouse: null,
    },
    mode: "Ballroom",
    semanticContext: [],
  };
};

afterEach(() => {
  conversationOrchestrator.endSession();
  conversationOrchestrator.abortCurrent();
});

describe("conversationOrchestrator.send (happy path via deterministic fetch stub)", () => {
  it("returns Resolved with narrowed ConversationResponse", async () => {
    const result = await conversationOrchestrator.send(baseRequest(), null);
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

  it("produces deterministic responses for identical requests (replay-harness contract)", async () => {
    const req = baseRequest();
    const r1 = await conversationOrchestrator.send(req, null);
    const r2 = await conversationOrchestrator.send(req, null);
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
