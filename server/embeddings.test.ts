// Server embed-handler tests: success, request-schema rejection, count/shape
// mismatch, and SDK-exception → HTTP-status mapping (timeout 408 / network 502).
// Uses a controllable @google/genai mock (mutable embedContent impl) + a stubbed
// GEMINI_API_KEY, mirroring how the conversation handler would be tested.

import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const embedImpl = vi.fn();
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { embedContent: embedImpl };
  },
}));

import { handleEmbed } from "./embeddings";

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

beforeEach(() => {
  vi.stubEnv("GEMINI_API_KEY", "AIza-test-key-1234567890");
  embedImpl.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("handleEmbed", () => {
  it("returns 200 with one vector per input text", async () => {
    embedImpl.mockResolvedValue({
      embeddings: [{ values: [1, 0, 0] }, { values: [0, 1, 0] }],
    });
    const req = makeReq({ texts: ["alpha", "beta"], taskType: "RETRIEVAL_DOCUMENT" });
    const { res, status, json } = makeRes();

    await handleEmbed(req, res);

    expect(status()).toBe(200);
    expect(json()).toEqual({
      embeddings: [
        [1, 0, 0],
        [0, 1, 0],
      ],
    });
  });

  it("rejects a malformed request body with 422 (and never calls the SDK)", async () => {
    const req = makeReq({ texts: [], taskType: "RETRIEVAL_QUERY" }); // min(1) fails
    const { res, status, json } = makeRes();

    await handleEmbed(req, res);

    expect(status()).toBe(422);
    expect((json() as { kind: string }).kind).toBe("schema");
    expect(embedImpl).not.toHaveBeenCalled();
  });

  it("returns 422 when the SDK returns the wrong embedding count", async () => {
    embedImpl.mockResolvedValue({ embeddings: [{ values: [1, 2, 3] }] }); // 1 for 2 inputs
    const req = makeReq({ texts: ["a", "b"], taskType: "RETRIEVAL_DOCUMENT" });
    const { res, status } = makeRes();

    await handleEmbed(req, res);

    expect(status()).toBe(422);
  });

  it("maps an AbortError (timeout) to 408", async () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    embedImpl.mockRejectedValue(abort);
    const req = makeReq({ texts: ["a"], taskType: "RETRIEVAL_QUERY" });
    const { res, status, json } = makeRes();

    await handleEmbed(req, res);

    expect(status()).toBe(408);
    expect((json() as { kind: string }).kind).toBe("timeout");
  });

  it("maps a network error to 502", async () => {
    embedImpl.mockRejectedValue(new Error("fetch failed: ECONNREFUSED"));
    const req = makeReq({ texts: ["a"], taskType: "RETRIEVAL_QUERY" });
    const { res, status, json } = makeRes();

    await handleEmbed(req, res);

    expect(status()).toBe(502);
    expect((json() as { kind: string }).kind).toBe("network");
  });
});
