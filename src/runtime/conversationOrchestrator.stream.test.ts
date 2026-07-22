// P26 (G1) two-phase streamed send. Covers the compose (streamed prose +
// classify metadata), the single-fallback-to-send policy, the no-retry-on-
// cancel policy, the stream-leg sub-budget inside the outer 15s budget, and
// the post-await staleness bail.
//
// Seam: ConversationOrchestrator holds `private readonly client = new
// LlmClient()` with no injection point, so the legs are stubbed on
// LlmClient.prototype.

import { afterEach, describe, expect, it, vi } from "vitest";
import { makeCharacter } from "../game/__test-utils__/factories";
import { LLM_TIMEOUT_MS, STREAM_LEG_TIMEOUT_MS } from "../game/constants";
import type { CharacterId, HouseId } from "../game/rng";
import { LlmClient } from "../llm/client";
import { CancelledError, NetworkError, SchemaError } from "../llm/errors";
import type {
  ClassifyResponseRaw,
  ConversationResponseRaw,
  ProxyConversationRequest,
} from "../llm/types";
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
      targetMarriage: null,
      spouse: null,
    },
    mode: "Ballroom",
    semanticContext: [],
    keyMoment: null,
  };
};

const classifyResult = (overrides: Partial<ClassifyResponseRaw> = {}): ClassifyResponseRaw => ({
  classifiedTactic: "SlyGossip",
  qualityMultiplier: 1.2,
  moodHint: "Jealous",
  toolCalls: [],
  ...overrides,
});

const sendResult = (overrides: Partial<ConversationResponseRaw> = {}): ConversationResponseRaw => ({
  dialogue: "FALLBACK PROSE",
  classifiedTactic: "DeepEmpathy",
  qualityMultiplier: 0.9,
  toolCalls: [],
  ...overrides,
});

// Stream stub that never settles on its own — it rejects with CancelledError
// the moment the composed signal aborts, mirroring client.sendStream's
// AbortError → CancelledError mapping.
function pendingStreamUntilAbort(capture: (signal: AbortSignal) => void) {
  return (_request: ProxyConversationRequest, signal: AbortSignal): Promise<string> => {
    capture(signal);
    return new Promise<string>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new CancelledError()));
    });
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  conversationOrchestrator.endSession();
});

describe("conversationOrchestrator.sendStreamed — two-phase compose", () => {
  it("forwards stream deltas to the caller and composes streamed prose with classify metadata", async () => {
    vi.spyOn(LlmClient.prototype, "sendStream").mockImplementation(
      async (_request, _signal, onDelta) => {
        onDelta("Good ");
        onDelta("day, my lord.");
        return "Good day, my lord.";
      },
    );
    const classifySpy = vi
      .spyOn(LlmClient.prototype, "classify")
      .mockResolvedValue(classifyResult());
    const sendSpy = vi.spyOn(LlmClient.prototype, "send").mockResolvedValue(sendResult());

    const deltas: string[] = [];
    const request = baseRequest();
    const outcome = await conversationOrchestrator.sendStreamed(request, null, (t) =>
      deltas.push(t),
    );

    expect(deltas).toEqual(["Good ", "day, my lord."]);
    expect(outcome.kind).toBe("Resolved");
    if (outcome.kind !== "Resolved") return;
    // Dialogue comes from the STREAM leg; everything else from CLASSIFY.
    expect(outcome.response.dialogue).toBe("Good day, my lord.");
    expect(outcome.response.classifiedTactic).toBe("SlyGossip");
    expect(outcome.response.moodHint).toBe("Jealous");
    expect(outcome.response.qualityMultiplier).toBe(1.2);
    // Happy path must not touch the single-shot path at all.
    expect(sendSpy).not.toHaveBeenCalled();

    // The classify leg is handed the streamed text (not the player's message)
    // so it grades the exchange it is meant to grade.
    const classifyArg = classifySpy.mock.calls[0]?.[0];
    expect(classifyArg?.dialogue).toBe("Good day, my lord.");
    expect(classifyArg?.freeformMessage).toBe(request.freeformMessage);
    expect(classifyArg?.targetCharacterId).toBe(request.targetCharacterId);
    expect(classifyArg?.mode).toBe("Ballroom");

    // The two DERIVED fields (everything above is passthrough). targetPersonaLine
    // is the C4 mitigation: two-phase moved the toolCalls surface off the
    // persona-cached call, so the classifier would otherwise grade a whisper or
    // grievance with no idea who it is about. Dropping either transform is
    // invisible without these.
    expect(classifyArg?.targetPersonaLine).toContain(request.characterStateSnapshot.target.name);
    expect(classifyArg?.targetPersonaLine).toContain(request.characterStateSnapshot.target.mood);
    expect(classifyArg?.sceneCharacters).toEqual(
      request.otherCharactersInScene.map((c) => ({ id: c.id, name: c.name })),
    );
  });

  it("passes the classify leg's toolCalls through the compose", async () => {
    // G6/whisper generation rides this field, and two-phase is exactly what
    // moved it onto the classify leg — a dropped passthrough silently disables
    // whisper + grievance ingest with no other symptom.
    const toolCall = { name: "generateWhisper" as const, args: { text: "a barbed rumour" } };
    vi.spyOn(LlmClient.prototype, "sendStream").mockResolvedValue("Prose.");
    vi.spyOn(LlmClient.prototype, "classify").mockResolvedValue(
      classifyResult({ toolCalls: [toolCall] } as Partial<ClassifyResponseRaw>),
    );

    const outcome = await conversationOrchestrator.sendStreamed(baseRequest(), null, () => {});

    expect(outcome.kind).toBe("Resolved");
    if (outcome.kind !== "Resolved") return;
    expect(outcome.response.toolCalls).toEqual([toolCall]);
  });

  it("applies the pinned intent over the classify leg's tactic", async () => {
    vi.spyOn(LlmClient.prototype, "sendStream").mockResolvedValue("Prose.");
    vi.spyOn(LlmClient.prototype, "classify").mockResolvedValue(
      classifyResult({ classifiedTactic: "SlyGossip" }),
    );
    const sendSpy = vi.spyOn(LlmClient.prototype, "send").mockResolvedValue(sendResult());

    const outcome = await conversationOrchestrator.sendStreamed(
      baseRequest(),
      "Flattery",
      () => {},
    );

    expect(outcome.kind).toBe("Resolved");
    if (outcome.kind !== "Resolved") return;
    expect(outcome.response.classifiedTactic).toBe("Flattery");
    // Without these two, a regression that made the streamed path always throw
    // and fall back to send() would still yield "Flattery" (resolveTactic
    // returns the pin unconditionally) — the test would pass while proving
    // nothing about the STREAMED compose.
    expect(outcome.response.dialogue).toBe("Prose.");
    expect(sendSpy).not.toHaveBeenCalled();
  });
});

describe("conversationOrchestrator.sendStreamed — single fallback to send()", () => {
  it.each([
    ["NetworkError", () => new NetworkError("boom")],
    ["SchemaError", () => new SchemaError([{ path: "dialogue", message: "bad" }])],
  ])("falls back exactly once when the STREAM leg throws %s", async (_label, makeError) => {
    vi.spyOn(LlmClient.prototype, "sendStream").mockRejectedValue(makeError());
    const classifySpy = vi
      .spyOn(LlmClient.prototype, "classify")
      .mockResolvedValue(classifyResult());
    const sendSpy = vi.spyOn(LlmClient.prototype, "send").mockResolvedValue(sendResult());

    const request = baseRequest();
    const outcome = await conversationOrchestrator.sendStreamed(request, "Flattery", () => {});

    expect(sendSpy).toHaveBeenCalledTimes(1);
    // The fallback must re-issue the ORIGINAL request; counting calls alone
    // would not notice a mangled one. NOTE the layering: the fallback is
    // `this.send(request, pinnedIntent)` on the ORCHESTRATOR, whose own send
    // then calls client.send(request, composedSignal) — so this prototype spy
    // sees the request plus a signal, never the pin.
    expect(sendSpy).toHaveBeenCalledWith(request, expect.any(AbortSignal));
    expect(classifySpy).not.toHaveBeenCalled();
    expect(outcome.kind).toBe("Resolved");
    if (outcome.kind !== "Resolved") return;
    expect(outcome.response.dialogue).toBe("FALLBACK PROSE");
    // The pin must survive the fallback. sendResult() classifies DeepEmpathy,
    // so seeing "Flattery" here is the only proof pinnedIntent was forwarded
    // into the retry rather than dropped on the way.
    expect(outcome.response.classifiedTactic).toBe("Flattery");
  });

  it.each([
    ["NetworkError", () => new NetworkError("boom")],
    ["SchemaError", () => new SchemaError([{ path: "classifiedTactic", message: "bad" }])],
  ])("falls back exactly once when the CLASSIFY leg throws %s", async (_label, makeError) => {
    vi.spyOn(LlmClient.prototype, "sendStream").mockImplementation(
      async (_request, _signal, onDelta) => {
        onDelta("Streamed prose.");
        return "Streamed prose.";
      },
    );
    vi.spyOn(LlmClient.prototype, "classify").mockRejectedValue(makeError());
    const sendSpy = vi.spyOn(LlmClient.prototype, "send").mockResolvedValue(sendResult());

    const deltas: string[] = [];
    const outcome = await conversationOrchestrator.sendStreamed(baseRequest(), null, (t) =>
      deltas.push(t),
    );

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(outcome.kind).toBe("Resolved");
    if (outcome.kind !== "Resolved") return;
    // The discarded stream text must not be half-committed into the outcome:
    // the fallback regenerates the prose wholesale.
    expect(deltas).toEqual(["Streamed prose."]);
    expect(outcome.response.dialogue).toBe("FALLBACK PROSE");
  });

  it("returns a Failure (never a partial Resolved) when the fallback send() also fails", async () => {
    vi.spyOn(LlmClient.prototype, "sendStream").mockResolvedValue("Streamed prose.");
    vi.spyOn(LlmClient.prototype, "classify").mockRejectedValue(new NetworkError("classify down"));
    const sendSpy = vi
      .spyOn(LlmClient.prototype, "send")
      .mockRejectedValue(new NetworkError("proxy down"));

    const outcome = await conversationOrchestrator.sendStreamed(baseRequest(), null, () => {});

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(outcome.kind).toBe("Failed");
    if (outcome.kind !== "Failed") return;
    expect(outcome.failure.reason).toBe("network");
  });

  it("does not fall back a second time when the fallback send() itself schema-fails", async () => {
    vi.spyOn(LlmClient.prototype, "sendStream").mockRejectedValue(new NetworkError("boom"));
    const sendSpy = vi
      .spyOn(LlmClient.prototype, "send")
      .mockRejectedValue(new SchemaError([{ path: "dialogue", message: "bad" }]));

    const outcome = await conversationOrchestrator.sendStreamed(baseRequest(), null, () => {});

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(outcome.kind).toBe("Failed");
    if (outcome.kind !== "Failed") return;
    expect(outcome.failure.reason).toBe("schema");
  });
});

describe("conversationOrchestrator.sendStreamed — cancel/timeout never retry", () => {
  it("user abortCurrent() during the stream leg yields reason 'cancelled' and no fallback", async () => {
    let streamSignal: AbortSignal | null = null;
    vi.spyOn(LlmClient.prototype, "sendStream").mockImplementation(
      pendingStreamUntilAbort((s) => {
        streamSignal = s;
      }),
    );
    const sendSpy = vi.spyOn(LlmClient.prototype, "send").mockResolvedValue(sendResult());
    const classifySpy = vi
      .spyOn(LlmClient.prototype, "classify")
      .mockResolvedValue(classifyResult());

    const pending = conversationOrchestrator.sendStreamed(baseRequest(), null, () => {});
    expect(streamSignal).not.toBeNull();
    conversationOrchestrator.abortCurrent();
    const outcome = await pending;

    expect(outcome.kind).toBe("Failed");
    if (outcome.kind !== "Failed") return;
    expect(outcome.failure.reason).toBe("cancelled");
    // Budget policy: a cancel spends the budget — no retry of either leg.
    expect(sendSpy).not.toHaveBeenCalled();
    expect(classifySpy).not.toHaveBeenCalled();
  });

  it("caps the stream leg at STREAM_LEG_TIMEOUT_MS while the outer budget is still live", async () => {
    expect(STREAM_LEG_TIMEOUT_MS).toBeLessThan(LLM_TIMEOUT_MS);
    vi.useFakeTimers();

    let streamSignal: AbortSignal | undefined;
    vi.spyOn(LlmClient.prototype, "sendStream").mockImplementation(
      pendingStreamUntilAbort((s) => {
        streamSignal = s;
      }),
    );
    const sendSpy = vi.spyOn(LlmClient.prototype, "send").mockResolvedValue(sendResult());

    const pending = conversationOrchestrator.sendStreamed(baseRequest(), null, () => {});

    await vi.advanceTimersByTimeAsync(STREAM_LEG_TIMEOUT_MS - 1);
    expect(streamSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(streamSignal?.aborted).toBe(true);

    const outcome = await pending;
    expect(outcome.kind).toBe("Failed");
    if (outcome.kind !== "Failed") return;
    // A stall is the SERVER's fault, so it must read as 'timeout', never
    // 'cancelled' — the latter tells the player they aborted something they
    // did not. Plan 26 line 28 makes the inner cap a timeout path. Regression
    // guard: the inner cap sets `timedOut` itself; only the outer 15s timer
    // did so originally, which surfaced an 11s stall as 'cancelled'.
    expect(outcome.failure.reason).toBe("timeout");
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("leaves the classify leg running past the stream-leg cap and times out at the outer budget", async () => {
    vi.useFakeTimers();

    vi.spyOn(LlmClient.prototype, "sendStream").mockResolvedValue("Streamed prose.");
    let classifySignal: AbortSignal | undefined;
    vi.spyOn(LlmClient.prototype, "classify").mockImplementation(
      (_request, signal): Promise<ClassifyResponseRaw> => {
        classifySignal = signal;
        return new Promise<ClassifyResponseRaw>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new CancelledError()));
        });
      },
    );
    const sendSpy = vi.spyOn(LlmClient.prototype, "send").mockResolvedValue(sendResult());

    const pending = conversationOrchestrator.sendStreamed(baseRequest(), null, () => {});

    // Let the stream leg settle so its `finally` runs, then assert the TIMER,
    // not the classify signal: classify is handed `outerSignal`, which the
    // stream-leg controller never feeds into, so `classifySignal.aborted ===
    // false` holds whether or not the timer was cleared and would catch
    // nothing. Exactly one timer (the outer 15s budget) may remain — a leaked
    // stream-leg timer makes this 2 and would flip `timedOut` early,
    // mislabelling a later cancel as a timeout.
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(STREAM_LEG_TIMEOUT_MS + 1);
    expect(classifySignal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(LLM_TIMEOUT_MS - STREAM_LEG_TIMEOUT_MS);
    expect(classifySignal?.aborted).toBe(true);

    const outcome = await pending;
    expect(outcome.kind).toBe("Failed");
    if (outcome.kind !== "Failed") return;
    expect(outcome.failure.reason).toBe("timeout");
    expect(sendSpy).not.toHaveBeenCalled();
  });
});

describe("conversationOrchestrator.sendStreamed — request staleness", () => {
  it("resolves Failed 'cancelled' without committing when a later request supersedes it", async () => {
    let releaseStream: ((text: string) => void) | null = null;
    vi.spyOn(LlmClient.prototype, "sendStream").mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          releaseStream = resolve;
        }),
    );
    vi.spyOn(LlmClient.prototype, "classify").mockResolvedValue(classifyResult());
    vi.spyOn(LlmClient.prototype, "send").mockResolvedValue(sendResult());

    const stale = conversationOrchestrator.sendStreamed(baseRequest(), null, () => {});
    // A second request bumps currentRequestId while the first is mid-flight.
    const fresh = await conversationOrchestrator.send(baseRequest(), null);
    expect(fresh.kind).toBe("Resolved");

    (releaseStream as unknown as (text: string) => void)("Stale prose.");
    const outcome = await stale;

    expect(outcome.kind).toBe("Failed");
    if (outcome.kind !== "Failed") return;
    expect(outcome.failure.reason).toBe("cancelled");
  });
});
