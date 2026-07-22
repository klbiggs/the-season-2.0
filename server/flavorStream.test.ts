// Server flavor-stream tests (P26 G1). Covers SSE framing, the trimmed terminal
// `done`, the all-empty-generation in-band error (a "done" with empty text would
// persist an empty passage instead of triggering the client's fallback), and the
// pre-stream vs mid-stream failure split.
//
// Mock pattern mirrors server/flavor.test.ts.

import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateStreamImpl = vi.fn();
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContentStream: generateStreamImpl };
  },
}));

import { FLAVOR_MODEL, FLAVOR_OUTPUT_TOKEN_BUDGET } from "../src/game/constants";
import { handleFlavorStream } from "./flavorStream";

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

const ARTIFACT_BODY = {
  context: {
    kind: "ArtifactBackstory",
    definitionId: "sapphires",
    displayName: "The Ashford Sapphires",
    family: "sapphires",
  },
};

beforeEach(() => {
  vi.stubEnv("GEMINI_API_KEY", "AIza-test-key-1234567890");
  generateStreamImpl.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("handleFlavorStream — SSE framing", () => {
  it("emits a delta per chunk then a done frame with the trimmed full text", async () => {
    generateStreamImpl.mockResolvedValue(streamOf([{ text: "  A storied" }, { text: " gem.  " }]));
    const r = makeRes();

    await handleFlavorStream(makeReq(ARTIFACT_BODY), r.res);

    expect(r.status()).toBe(200);
    expect(r.writes()[0]).toBe('data: {"kind":"delta","text":"  A storied"}\n\n');
    // Deltas stay raw; only the terminal aggregate is trimmed.
    expect(r.frames()).toEqual([
      { kind: "delta", text: "  A storied" },
      { kind: "delta", text: " gem.  " },
      { kind: "done", text: "A storied gem." },
    ]);
    expect(r.ended()).toBe(true);
  });

  it("skips empty and absent chunk text without emitting a frame for it", async () => {
    generateStreamImpl.mockResolvedValue(
      streamOf([{ text: "A" }, { text: "" }, {}, { text: "B" }]),
    );
    const r = makeRes();

    await handleFlavorStream(makeReq(ARTIFACT_BODY), r.res);

    expect(r.frames()).toEqual([
      { kind: "delta", text: "A" },
      { kind: "delta", text: "B" },
      { kind: "done", text: "AB" },
    ]);
  });

  it("emits an in-band error rather than a done frame when the generation is all whitespace", async () => {
    generateStreamImpl.mockResolvedValue(streamOf([{ text: " " }, { text: "\n" }]));
    const r = makeRes();

    await handleFlavorStream(makeReq(ARTIFACT_BODY), r.res);

    // A done-with-empty-text would persist an empty passage under the "produced
    // at most once" contract instead of letting the client fall back.
    expect(r.frames().some((f) => f.kind === "done")).toBe(false);
    expect(r.frames().at(-1)).toEqual({ kind: "error", reason: "internal" });
    expect(r.ended()).toBe(true);
  });
});

describe("handleFlavorStream — failure split", () => {
  it("rejects a malformed body with JSON 422 and never calls the SDK", async () => {
    const r = makeRes();

    // Missing the discriminated-union `kind`.
    await handleFlavorStream(makeReq({ context: { definitionId: "sapphires" } }), r.res);

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

    await handleFlavorStream(makeReq(ARTIFACT_BODY), r.res);

    expect(r.status()).toBe(408);
    expect(r.json()).toEqual({ kind: "timeout" });
    expect(r.writes()).toEqual([]);
  });

  it("maps a PRE-stream network error to JSON 502", async () => {
    generateStreamImpl.mockRejectedValue(new Error("fetch failed: ECONNREFUSED"));
    const r = makeRes();

    await handleFlavorStream(makeReq(ARTIFACT_BODY), r.res);

    expect(r.status()).toBe(502);
    expect(r.json()).toEqual({ kind: "network" });
  });

  it("signals a MID-stream failure in-band and does not writeHead a second time", async () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    generateStreamImpl.mockResolvedValue(streamThenThrow([{ text: "A storied" }], abort));
    const r = makeRes();

    await handleFlavorStream(makeReq(ARTIFACT_BODY), r.res);

    expect(r.writeHeadCount()).toBe(1);
    expect(r.status()).toBe(200);
    expect(r.frames()).toEqual([
      { kind: "delta", text: "A storied" },
      { kind: "error", reason: "timeout" },
    ]);
    expect(r.ended()).toBe(true);
  });
});

describe("handleFlavorStream — generation config", () => {
  it("disables thinking and caps output at the flavor budget on the flavor model", async () => {
    generateStreamImpl.mockResolvedValue(streamOf([{ text: "A gem." }]));
    const r = makeRes();

    await handleFlavorStream(makeReq(ARTIFACT_BODY), r.res);

    const call = generateStreamImpl.mock.calls[0]?.[0] as {
      model: string;
      contents: string;
      config: Record<string, unknown>;
    };
    expect(call.model).toBe(FLAVOR_MODEL);
    // Thinking tokens are deducted from maxOutputTokens — leaving thinking on
    // truncates the passage mid-sentence.
    expect(call.config.thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(call.config.maxOutputTokens).toBe(FLAVOR_OUTPUT_TOKEN_BUDGET);
    expect(call.contents).toContain("The Ashford Sapphires");
  });
});
