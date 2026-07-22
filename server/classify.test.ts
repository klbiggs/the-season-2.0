// Server classify-handler tests (P26 G1, two-phase call #2). Covers the forced
// function-call contract (allowedFunctionNames pinned to "classify", always
// Flash), args validation → 200/422, and SDK-exception → HTTP-status mapping.
//
// Mock pattern mirrors server/flavor.test.ts. FunctionCallingConfigMode is a
// runtime VALUE import in the handler, so the module mock must export it.

import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateImpl = vi.fn();
vi.mock("@google/genai", () => ({
  FunctionCallingConfigMode: { ANY: "ANY", AUTO: "AUTO", NONE: "NONE" },
  GoogleGenAI: class {
    models = { generateContent: generateImpl };
  },
}));

import { MODEL_DEFAULT } from "../src/game/constants";
import { handleClassify } from "./classify";

function makeReq(body: unknown): IncomingMessage {
  const raw = body === undefined ? "" : JSON.stringify(body);
  return Readable.from([Buffer.from(raw, "utf-8")]) as unknown as IncomingMessage;
}

function makeRes(): { res: ServerResponse; status: () => number; json: () => unknown } {
  let status = 0;
  let body = "";
  const res = {
    headersSent: false,
    writeHead(s: number) {
      status = s;
      return res;
    },
    end(chunk?: string) {
      if (typeof chunk === "string") body += chunk;
    },
  } as unknown as ServerResponse;
  return {
    res,
    status: () => status,
    json: () => (body === "" ? null : JSON.parse(body)),
  };
}

function makeBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    freeformMessage: "You look uncommonly well this evening.",
    dialogue: "You are too kind, sir.",
    targetCharacterId: "npc-ashford",
    targetPersonaLine: "Miss Ashford, a spinster of considerable wit",
    sceneCharacters: [{ id: "npc-bram", name: "Lord Bram" }],
    mode: "Ballroom",
    ...overrides,
  };
}

function callArgs(): { model: string; contents: string; config: Record<string, unknown> } {
  return generateImpl.mock.calls[0]?.[0] as {
    model: string;
    contents: string;
    config: Record<string, unknown>;
  };
}

beforeEach(() => {
  vi.stubEnv("GEMINI_API_KEY", "AIza-test-key-1234567890");
  generateImpl.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("handleClassify — response validation", () => {
  it("returns 200 with the validated args, applying the toolCalls default", async () => {
    generateImpl.mockResolvedValue({
      functionCalls: [
        { name: "classify", args: { classifiedTactic: "Flattery", qualityMultiplier: 1.2 } },
      ],
    });
    const r = makeRes();

    await handleClassify(makeReq(makeBody()), r.res);

    expect(r.status()).toBe(200);
    expect(r.json()).toEqual({
      classifiedTactic: "Flattery",
      qualityMultiplier: 1.2,
      toolCalls: [],
    });
  });

  it("passes a generateWhisper toolCall through to the client", async () => {
    generateImpl.mockResolvedValue({
      functionCalls: [
        {
          name: "classify",
          args: {
            classifiedTactic: "SlyGossip",
            qualityMultiplier: 1,
            moodHint: "Receptive",
            toolCalls: [
              {
                name: "generateWhisper",
                args: { subjectCharacterId: "npc-bram", text: "He gambles at Boodle's." },
              },
            ],
          },
        },
      ],
    });
    const r = makeRes();

    await handleClassify(makeReq(makeBody()), r.res);

    expect(r.status()).toBe(200);
    expect((r.json() as { toolCalls: unknown[] }).toolCalls).toEqual([
      {
        name: "generateWhisper",
        args: { subjectCharacterId: "npc-bram", text: "He gambles at Boodle's." },
      },
    ]);
  });

  it("returns 422 when the args fail ClassifyResponseSchema", async () => {
    generateImpl.mockResolvedValue({
      functionCalls: [
        { name: "classify", args: { classifiedTactic: "Flattery", qualityMultiplier: "high" } },
      ],
    });
    const r = makeRes();

    await handleClassify(makeReq(makeBody()), r.res);

    expect(r.status()).toBe(422);
    expect((r.json() as { kind: string }).kind).toBe("schema");
  });

  it("returns 422 when the model emits no function call at all", async () => {
    generateImpl.mockResolvedValue({ text: "Flattery, I should say." });
    const r = makeRes();

    await handleClassify(makeReq(makeBody()), r.res);

    expect(r.status()).toBe(422);
    expect((r.json() as { issues: Array<{ message: string }> }).issues[0]?.message).toBe(
      "missing classify call",
    );
  });

  it("returns 422 when the emitted call is not `classify`", async () => {
    generateImpl.mockResolvedValue({
      functionCalls: [{ name: "respond", args: { dialogue: "Indeed." } }],
    });
    const r = makeRes();

    await handleClassify(makeReq(makeBody()), r.res);

    expect(r.status()).toBe(422);
  });
});

describe("handleClassify — request handling", () => {
  it("rejects a malformed body with 422 and never calls the SDK", async () => {
    const r = makeRes();

    // freeformMessage is required (no default).
    await handleClassify(makeReq(makeBody({ freeformMessage: undefined })), r.res);

    expect(r.status()).toBe(422);
    expect((r.json() as { kind: string }).kind).toBe("schema");
    expect(generateImpl).not.toHaveBeenCalled();
  });

  it("forces the classify function on the Flash model", async () => {
    generateImpl.mockResolvedValue({
      functionCalls: [
        { name: "classify", args: { classifiedTactic: "Flattery", qualityMultiplier: 1 } },
      ],
    });
    const r = makeRes();

    await handleClassify(makeReq(makeBody()), r.res);

    // Classification never spends the Pro budget — that belongs to the streamed
    // prose leg.
    expect(callArgs().model).toBe(MODEL_DEFAULT);
    expect(callArgs().config.toolConfig).toEqual({
      functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["classify"] },
    });
    const tools = callArgs().config.tools as Array<{
      functionDeclarations: Array<{ name: string }>;
    }>;
    expect(tools[0]?.functionDeclarations.map((d) => d.name)).toEqual(["classify"]);
  });

  it("labels the player message and the reply distinctly in the prompt", async () => {
    generateImpl.mockResolvedValue({
      functionCalls: [
        { name: "classify", args: { classifiedTactic: "Flattery", qualityMultiplier: 1 } },
      ],
    });
    const r = makeRes();

    await handleClassify(makeReq(makeBody()), r.res);

    // Swapping these two would invert every classification.
    expect(callArgs().contents).toContain("Player said: You look uncommonly well this evening.");
    expect(callArgs().contents).toContain("They replied: You are too kind, sir.");
    expect(callArgs().contents).toContain("[Also present: Lord Bram]");
    // targetPersonaLine is the C4 mitigation: two-phase moved the toolCalls
    // surface (whisper/grievance) off the persona-cached call, so this line is
    // the classifier's ONLY persona grounding. Drop the segment and the
    // classifier grades a whisper with no idea who it concerns — silently.
    expect(callArgs().contents).toContain(
      "[Character: Miss Ashford, a spinster of considerable wit]",
    );
    expect(callArgs().contents).toContain("[Mode: Ballroom]");
    // This leg is deliberately persona-cache-free, so the static classifier
    // instruction is the only thing telling the model what to do.
    expect(String(callArgs().config.systemInstruction).length).toBeGreaterThan(0);
  });

  it("threads the composite-budget abortSignal into the SDK config", async () => {
    // Dropping this line silently disables the server timeout budget.
    generateImpl.mockResolvedValue({
      functionCalls: [
        { name: "classify", args: { classifiedTactic: "Flattery", qualityMultiplier: 1 } },
      ],
    });
    const r = makeRes();

    await handleClassify(makeReq(makeBody()), r.res);

    expect(callArgs().config.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it("omits the scene line when no other characters are present", async () => {
    generateImpl.mockResolvedValue({
      functionCalls: [
        { name: "classify", args: { classifiedTactic: "Flattery", qualityMultiplier: 1 } },
      ],
    });
    const r = makeRes();

    await handleClassify(makeReq(makeBody({ sceneCharacters: [] })), r.res);

    expect(callArgs().contents).not.toContain("[Also present:");
  });
});

describe("handleClassify — SDK error mapping", () => {
  it("maps an AbortError (timeout) to 408", async () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    generateImpl.mockRejectedValue(abort);
    const r = makeRes();

    await handleClassify(makeReq(makeBody()), r.res);

    expect(r.status()).toBe(408);
    expect(r.json()).toEqual({ kind: "timeout" });
  });

  it("maps a network error to 502", async () => {
    generateImpl.mockRejectedValue(new Error("fetch failed: ECONNREFUSED"));
    const r = makeRes();

    await handleClassify(makeReq(makeBody()), r.res);

    expect(r.status()).toBe(502);
    expect(r.json()).toEqual({ kind: "network" });
  });

  it("maps an unrecognized error to 500", async () => {
    generateImpl.mockRejectedValue(new Error("quota exhausted"));
    const r = makeRes();

    await handleClassify(makeReq(makeBody()), r.res);

    expect(r.status()).toBe(500);
    expect(r.json()).toEqual({ kind: "internal" });
  });
});
