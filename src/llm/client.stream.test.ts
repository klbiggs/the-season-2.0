// P26 (G1): two-phase streaming client tests — SSE frame parsing (including the
// trailing-frame flush that a real browser run caught truncating replies),
// in-band error frames, and the classify leg's status mapping.

import { afterEach, describe, expect, it, vi } from "vitest";
import { LlmClient } from "./client";
import { CancelledError, NetworkError, SchemaError } from "./errors";
import type { ClassifyRequest, ProxyConversationRequest } from "./types";

const client = new LlmClient();

const REQUEST = {
  targetCharacterId: "npc-1",
  playerHouseId: "player",
  freeformMessage: "Hello.",
  history: [],
  otherCharactersInScene: [],
  characterStateSnapshot: { target: {}, targetMarriage: null, spouse: null },
  mode: "Ballroom",
  semanticContext: [],
  keyMoment: null,
} as unknown as ProxyConversationRequest;

const CLASSIFY_REQUEST = {
  freeformMessage: "Hello.",
  dialogue: "Good evening.",
  targetCharacterId: "npc-1",
  targetPersonaLine: "Lady Test, mood Receptive, traits none",
  sceneCharacters: [],
  mode: "Ballroom",
} as unknown as ClassifyRequest;

// Build an SSE Response whose body streams the given raw chunks verbatim.
function sseResponse(chunks: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const frame = (o: unknown): string => `data: ${JSON.stringify(o)}\n\n`;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LlmClient.sendStream", () => {
  it("emits each delta and resolves with the terminal done text", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      sseResponse([
        frame({ kind: "delta", text: "Good " }),
        frame({ kind: "delta", text: "evening." }),
        frame({ kind: "done", text: "Good evening." }),
      ]),
    );
    const deltas: string[] = [];
    const full = await client.sendStream(REQUEST, AbortSignal.timeout(5000), (t) => deltas.push(t));
    expect(deltas).toEqual(["Good ", "evening."]);
    expect(full).toBe("Good evening.");
  });

  it("flushes a terminal frame that arrives in the FINAL chunk without a trailing blank line", async () => {
    // Regression: the first implementation dropped whatever remained buffered
    // when the reader finished, truncating the reply mid-sentence (observed in
    // a live browser run). The done frame here has no trailing "\n\n" split
    // before the stream closes.
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      sseResponse([
        frame({ kind: "delta", text: "One hears tales" }),
        `data: ${JSON.stringify({ kind: "done", text: "One hears tales about his Grace." })}`,
      ]),
    );
    const full = await client.sendStream(REQUEST, AbortSignal.timeout(5000), () => {});
    expect(full).toBe("One hears tales about his Grace.");
  });

  it("splits correctly when one network chunk carries several frames", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      sseResponse([
        frame({ kind: "delta", text: "a" }) + frame({ kind: "delta", text: "b" }),
        frame({ kind: "done", text: "ab" }),
      ]),
    );
    const deltas: string[] = [];
    const full = await client.sendStream(REQUEST, AbortSignal.timeout(5000), (t) => deltas.push(t));
    expect(deltas).toEqual(["a", "b"]);
    expect(full).toBe("ab");
  });

  it("maps an in-band error frame with reason=timeout to CancelledError", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      sseResponse([
        frame({ kind: "delta", text: "partial" }),
        frame({ kind: "error", reason: "timeout" }),
      ]),
    );
    await expect(
      client.sendStream(REQUEST, AbortSignal.timeout(5000), () => {}),
    ).rejects.toBeInstanceOf(CancelledError);
  });

  it("maps an in-band error frame with reason=network to NetworkError", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      sseResponse([frame({ kind: "error", reason: "network" })]),
    );
    await expect(
      client.sendStream(REQUEST, AbortSignal.timeout(5000), () => {}),
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it("maps a pre-stream 500 to NetworkError", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(null, { status: 500 }));
    await expect(
      client.sendStream(REQUEST, AbortSignal.timeout(5000), () => {}),
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it("throws NetworkError when the stream closes with no content", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(sseResponse([]));
    await expect(
      client.sendStream(REQUEST, AbortSignal.timeout(5000), () => {}),
    ).rejects.toBeInstanceOf(NetworkError);
  });
});

describe("LlmClient.classify", () => {
  it("returns the parsed classification", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ classifiedTactic: "Flattery", qualityMultiplier: 1.2, toolCalls: [] }),
        { status: 200 },
      ),
    );
    const out = await client.classify(CLASSIFY_REQUEST, AbortSignal.timeout(5000));
    expect(out.classifiedTactic).toBe("Flattery");
    expect(out.qualityMultiplier).toBe(1.2);
  });

  it("maps 422 to SchemaError and 408 to CancelledError", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ issues: [] }), { status: 422 }),
    );
    await expect(
      client.classify(CLASSIFY_REQUEST, AbortSignal.timeout(5000)),
    ).rejects.toBeInstanceOf(SchemaError);

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(null, { status: 408 }));
    await expect(
      client.classify(CLASSIFY_REQUEST, AbortSignal.timeout(5000)),
    ).rejects.toBeInstanceOf(CancelledError);
  });
});
