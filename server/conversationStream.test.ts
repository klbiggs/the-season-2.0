// Server conversation-stream tests (P26 G1). Covers SSE framing (delta per
// non-empty chunk + terminal done), the pre-stream vs mid-stream failure split
// (JSON status vs in-band error frame), and the Flash-only thinking-off gate —
// `gemini-3.1-pro-preview` returns HTTP 400 when sent `thinkingBudget: 0`, so
// the Pro-routed leg must omit thinkingConfig entirely.
//
// Mock pattern mirrors server/flavor.test.ts: mutable impls captured in module
// scope + a stubbed GEMINI_API_KEY.

import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateStreamImpl = vi.fn();
const cachesCreateImpl = vi.fn();
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContentStream: generateStreamImpl };
    caches = { create: cachesCreateImpl };
  },
}));

import {
  LLM_OUTPUT_TOKEN_BUDGET,
  MODEL_DEFAULT,
  MODEL_FIRST_MEETING,
  STREAM_THINKING_OUTPUT_TOKEN_BUDGET,
} from "../src/game/constants";
import type { CharacterId } from "../src/llm/types";
import { makeCharacter } from "../src/llm/types";
import { handleConversationStream } from "./conversationStream";

function makeReq(body: unknown): IncomingMessage {
  const raw = body === undefined ? "" : JSON.stringify(body);
  return Readable.from([Buffer.from(raw, "utf-8")]) as unknown as IncomingMessage;
}

type FakeRes = {
  res: ServerResponse;
  status: () => number;
  json: () => unknown;
  writes: () => string[];
  frames: () => Array<Record<string, unknown>>;
  ended: () => boolean;
  writeHeadCount: () => number;
};

function makeRes(): FakeRes {
  let status = 0;
  let body = "";
  let ended = false;
  let writeHeadCount = 0;
  const writes: string[] = [];
  const impl = {
    headersSent: false,
    writeHead(s: number) {
      writeHeadCount += 1;
      status = s;
      impl.headersSent = true;
      return impl;
    },
    write(chunk: string) {
      writes.push(chunk);
      return true;
    },
    end(chunk?: string) {
      ended = true;
      if (typeof chunk === "string") body += chunk;
    },
  };
  return {
    res: impl as unknown as ServerResponse,
    status: () => status,
    json: () => (body === "" ? null : JSON.parse(body)),
    writes: () => writes,
    frames: () => writes.map((w) => JSON.parse(w.slice("data: ".length, -2))),
    ended: () => ended,
    writeHeadCount: () => writeHeadCount,
  };
}

function streamOf(chunks: ReadonlyArray<{ text?: string }>): AsyncIterable<{ text?: string }> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  };
}

function streamThenThrow(
  chunks: ReadonlyArray<{ text?: string }>,
  err: unknown,
): AsyncIterable<{ text?: string }> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
      throw err;
    },
  };
}

const HISTORY_ENTRY = {
  speaker: "house-head" as const,
  text: "We met at the Wentworth ball.",
  classifiedTactic: null,
  tick: 3,
};

function makeBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    targetCharacterId: "npc-ashford",
    playerHouseId: "player",
    freeformMessage: "Good evening, Miss Ashford.",
    // Non-empty history + null keyMoment → Flash (routeModel).
    history: [HISTORY_ENTRY],
    otherCharactersInScene: [],
    characterStateSnapshot: {
      target: makeCharacter({ id: "npc-ashford" as CharacterId, name: "Miss Ashford" }),
      targetMarriage: null,
      spouse: null,
    },
    mode: "Ballroom",
    semanticContext: [],
    keyMoment: null,
    ...overrides,
  };
}

function streamCallConfig(): Record<string, unknown> {
  const call = generateStreamImpl.mock.calls[0]?.[0] as {
    model: string;
    contents: string;
    config: Record<string, unknown>;
  };
  return call.config;
}

function streamCallModel(): string {
  return (generateStreamImpl.mock.calls[0]?.[0] as { model: string }).model;
}

beforeEach(() => {
  vi.stubEnv("GEMINI_API_KEY", "AIza-test-key-1234567890");
  generateStreamImpl.mockReset();
  cachesCreateImpl.mockReset();
  // No `name` → getOrCreatePersonaCache returns null → systemInstruction
  // fallback, and nothing lands in the module-level persona cache.
  cachesCreateImpl.mockResolvedValue({});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("handleConversationStream — SSE framing", () => {
  it("emits one delta per chunk then a done frame carrying the full concatenation", async () => {
    generateStreamImpl.mockResolvedValue(streamOf([{ text: "Good " }, { text: "evening." }]));
    const r = makeRes();

    await handleConversationStream(makeReq(makeBody()), r.res);

    expect(r.status()).toBe(200);
    expect(r.writes()[0]).toBe('data: {"kind":"delta","text":"Good "}\n\n');
    expect(r.frames()).toEqual([
      { kind: "delta", text: "Good " },
      { kind: "delta", text: "evening." },
      { kind: "done", text: "Good evening." },
    ]);
    expect(r.ended()).toBe(true);
  });

  it("skips empty and absent chunk text without emitting a frame for it", async () => {
    generateStreamImpl.mockResolvedValue(
      streamOf([{ text: "A" }, { text: "" }, {}, { text: "B" }]),
    );
    const r = makeRes();

    await handleConversationStream(makeReq(makeBody()), r.res);

    expect(r.frames()).toEqual([
      { kind: "delta", text: "A" },
      { kind: "delta", text: "B" },
      { kind: "done", text: "AB" },
    ]);
  });
});

describe("handleConversationStream — failure split", () => {
  it("rejects a malformed body with JSON 422 and never calls the SDK", async () => {
    const r = makeRes();

    // characterStateSnapshot.target is required by CharacterStateSnapshotSchema.
    await handleConversationStream(makeReq(makeBody({ characterStateSnapshot: {} })), r.res);

    expect(r.status()).toBe(422);
    expect((r.json() as { kind: string }).kind).toBe("schema");
    expect(generateStreamImpl).not.toHaveBeenCalled();
    expect(r.writes()).toEqual([]);
  });

  it("maps a PRE-stream AbortError to JSON 408 with no SSE frame", async () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    generateStreamImpl.mockRejectedValue(abort);
    const r = makeRes();

    await handleConversationStream(makeReq(makeBody()), r.res);

    expect(r.status()).toBe(408);
    expect(r.json()).toEqual({ kind: "timeout" });
    expect(r.writes()).toEqual([]);
  });

  it("maps a PRE-stream network error to JSON 502", async () => {
    generateStreamImpl.mockRejectedValue(new Error("fetch failed: ECONNREFUSED"));
    const r = makeRes();

    await handleConversationStream(makeReq(makeBody()), r.res);

    expect(r.status()).toBe(502);
    expect(r.json()).toEqual({ kind: "network" });
  });

  it("maps an unrecognized PRE-stream error to JSON 500", async () => {
    generateStreamImpl.mockRejectedValue(new Error("quota exhausted"));
    const r = makeRes();

    await handleConversationStream(makeReq(makeBody()), r.res);

    expect(r.status()).toBe(500);
    expect(r.json()).toEqual({ kind: "internal" });
  });

  it("signals a MID-stream failure in-band and does not writeHead a second time", async () => {
    generateStreamImpl.mockResolvedValue(
      streamThenThrow([{ text: "Good " }], new Error("network reset mid-stream")),
    );
    const r = makeRes();

    await handleConversationStream(makeReq(makeBody()), r.res);

    expect(r.writeHeadCount()).toBe(1);
    expect(r.status()).toBe(200);
    expect(r.frames()).toEqual([
      { kind: "delta", text: "Good " },
      { kind: "error", reason: "network" },
    ]);
    // No terminal done frame — the client must not treat a truncated stream as
    // a complete reply.
    expect(r.frames().some((f) => f.kind === "done")).toBe(false);
    expect(r.ended()).toBe(true);
  });
});

describe("handleConversationStream — model routing and thinking config", () => {
  it("disables thinking and uses the normal token budget on the Flash default model", async () => {
    generateStreamImpl.mockResolvedValue(streamOf([{ text: "x" }]));
    const r = makeRes();

    await handleConversationStream(makeReq(makeBody()), r.res);

    expect(streamCallModel()).toBe(MODEL_DEFAULT);
    expect(streamCallConfig().thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(streamCallConfig().maxOutputTokens).toBe(LLM_OUTPUT_TOKEN_BUDGET);
  });

  it("sends NO tools and NO toolConfig on the streamed leg", async () => {
    // The entire reason two-phase exists: a forced function call cannot stream
    // token by token, so the prose leg must be tool-free and the classify leg
    // carries the forced call. Copy-pasting server/conversation.ts's RESPOND_TOOL
    // + FunctionCallingConfigMode.ANY back into this handler would yield ZERO
    // prose deltas in production while every other test here stayed green (the
    // mocked stream fabricates chunks regardless of config).
    generateStreamImpl.mockResolvedValue(streamOf([{ text: "x" }]));
    const r = makeRes();

    await handleConversationStream(makeReq(makeBody()), r.res);

    expect(streamCallConfig()).not.toHaveProperty("tools");
    expect(streamCallConfig()).not.toHaveProperty("toolConfig");
  });

  it("threads the composite-budget abortSignal into the SDK config", async () => {
    // Dropping this one line silently disables the 13s server budget — the very
    // thing the 408 mapping exists to report.
    generateStreamImpl.mockResolvedValue(streamOf([{ text: "x" }]));
    const r = makeRes();

    await handleConversationStream(makeReq(makeBody()), r.res);

    expect(streamCallConfig().abortSignal).toBeInstanceOf(AbortSignal);
  });

  it("omits thinkingConfig entirely on the Pro first-meeting model (Pro 400s on thinkingBudget 0)", async () => {
    generateStreamImpl.mockResolvedValue(streamOf([{ text: "x" }]));
    const r = makeRes();

    // Empty history → first meeting → MODEL_FIRST_MEETING.
    await handleConversationStream(makeReq(makeBody({ history: [] })), r.res);

    expect(streamCallModel()).toBe(MODEL_FIRST_MEETING);
    expect(streamCallConfig()).not.toHaveProperty("thinkingConfig");
    expect(streamCallConfig().maxOutputTokens).toBe(STREAM_THINKING_OUTPUT_TOKEN_BUDGET);
  });

  it("routes a keyMoment to Pro even with non-empty history", async () => {
    generateStreamImpl.mockResolvedValue(streamOf([{ text: "x" }]));
    const r = makeRes();

    await handleConversationStream(makeReq(makeBody({ keyMoment: "duel" })), r.res);

    expect(streamCallModel()).toBe(MODEL_FIRST_MEETING);
    expect(streamCallConfig()).not.toHaveProperty("thinkingConfig");
  });
});

describe("handleConversationStream — persona grounding", () => {
  it("falls back to systemInstruction when no persona cache is available", async () => {
    generateStreamImpl.mockResolvedValue(streamOf([{ text: "x" }]));
    const r = makeRes();

    await handleConversationStream(makeReq(makeBody()), r.res);

    expect(streamCallConfig()).not.toHaveProperty("cachedContent");
    expect(typeof streamCallConfig().systemInstruction).toBe("string");
    expect(streamCallConfig().systemInstruction).toContain("Miss Ashford");
  });

  it("passes cachedContent WITHOUT systemInstruction when the persona cache resolves", async () => {
    cachesCreateImpl.mockResolvedValue({ name: "cachedContents/abc123" });
    generateStreamImpl.mockResolvedValue(streamOf([{ text: "x" }]));
    const r = makeRes();

    // Distinct target id: the persona cache is a module-level Map that outlives
    // the test, so this entry must not shadow the other tests' character.
    const target = makeCharacter({ id: "npc-cached" as CharacterId, name: "Lady Cached" });
    await handleConversationStream(
      makeReq(
        makeBody({
          targetCharacterId: "npc-cached",
          characterStateSnapshot: { target, targetMarriage: null, spouse: null },
        }),
      ),
      r.res,
    );

    // cachedContent and systemInstruction are mutually exclusive per the Gemini
    // SDK contract; sending both is rejected.
    expect(streamCallConfig().cachedContent).toBe("cachedContents/abc123");
    expect(streamCallConfig()).not.toHaveProperty("systemInstruction");
  });

  it("sends the player's message plus the spoken-words-only guard as contents", async () => {
    generateStreamImpl.mockResolvedValue(streamOf([{ text: "x" }]));
    const r = makeRes();

    await handleConversationStream(makeReq(makeBody()), r.res);

    const contents = (generateStreamImpl.mock.calls[0]?.[0] as { contents: string }).contents;
    expect(contents).toContain("Good evening, Miss Ashford.");
    expect(contents).toContain("We met at the Wentworth ball.");
    // The forced-function path excluded narration implicitly; streamed prose
    // needs the constraint stated or the model emits asterisked stage direction.
    expect(contents).toContain("no narration");
  });
});
