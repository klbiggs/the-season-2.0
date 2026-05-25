// Server flavor-handler tests: success, request-schema rejection, empty-text
// rejection, and SDK-exception → HTTP-status mapping (timeout 408 / network 502).
// Uses a controllable @google/genai mock (mutable generateContent impl) + a
// stubbed GEMINI_API_KEY, mirroring server/embeddings.test.ts.

import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateImpl = vi.fn();
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: generateImpl };
  },
}));

import { handleFlavor } from "./flavor";

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

const ARTIFACT_CONTEXT = {
  context: {
    kind: "ArtifactBackstory",
    definitionId: "sapphires",
    displayName: "Sapphires",
    family: "sapphires",
  },
};

beforeEach(() => {
  vi.stubEnv("GEMINI_API_KEY", "AIza-test-key-1234567890");
  generateImpl.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("handleFlavor", () => {
  it("returns 200 with the generated text", async () => {
    generateImpl.mockResolvedValue({ text: "A storied heirloom." });
    const { res, status, json } = makeRes();

    await handleFlavor(makeReq(ARTIFACT_CONTEXT), res);

    expect(status()).toBe(200);
    expect(json()).toEqual({ text: "A storied heirloom." });
  });

  it("rejects a malformed request body with 422 (and never calls the SDK)", async () => {
    const { res, status, json } = makeRes();

    // Missing the discriminated-union `kind`.
    await handleFlavor(makeReq({ context: { definitionId: "x" } }), res);

    expect(status()).toBe(422);
    expect((json() as { kind: string }).kind).toBe("schema");
    expect(generateImpl).not.toHaveBeenCalled();
  });

  it("returns 422 when the model yields empty text", async () => {
    generateImpl.mockResolvedValue({ text: "   " });
    const { res, status } = makeRes();

    await handleFlavor(makeReq(ARTIFACT_CONTEXT), res);

    expect(status()).toBe(422);
  });

  it("maps an AbortError (timeout) to 408", async () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    generateImpl.mockRejectedValue(abort);
    const { res, status, json } = makeRes();

    await handleFlavor(makeReq(ARTIFACT_CONTEXT), res);

    expect(status()).toBe(408);
    expect((json() as { kind: string }).kind).toBe("timeout");
  });

  it("maps a network error to 502", async () => {
    generateImpl.mockRejectedValue(new Error("fetch failed: ECONNREFUSED"));
    const { res, status, json } = makeRes();

    await handleFlavor(makeReq(ARTIFACT_CONTEXT), res);

    expect(status()).toBe(502);
    expect((json() as { kind: string }).kind).toBe("network");
  });
});
