// Client flavor-wrapper tests: success (via the global fetch stub) + HTTP-status
// → typed-failure mapping (408 CancelledError / 5xx NetworkError / 422 SchemaError
// / fetch rejection NetworkError). Mirrors src/llm/embeddings.test.ts.

import { afterEach, describe, expect, it, vi } from "vitest";
import { CancelledError, NetworkError, SchemaError } from "./errors";
import { fetchFlavorText } from "./flavor";
import type { FlavorContext } from "./types";

const CONTEXT: FlavorContext = {
  kind: "ArtifactBackstory",
  definitionId: "sapphires",
  displayName: "The Carrington Sapphires",
  family: "sapphires",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchFlavorText (via the global fetch stub)", () => {
  it("returns the generated text on success", async () => {
    const text = await fetchFlavorText(CONTEXT, AbortSignal.timeout(5000));
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
  });

  it("maps a 408 to CancelledError", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(null, { status: 408 }));
    await expect(fetchFlavorText(CONTEXT, AbortSignal.timeout(5000))).rejects.toBeInstanceOf(
      CancelledError,
    );
  });

  it("maps a 5xx to NetworkError", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(null, { status: 502 }));
    await expect(fetchFlavorText(CONTEXT, AbortSignal.timeout(5000))).rejects.toBeInstanceOf(
      NetworkError,
    );
  });

  it("maps a 422 to SchemaError", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ issues: [{ path: "text", message: "bad" }] }), { status: 422 }),
    );
    await expect(fetchFlavorText(CONTEXT, AbortSignal.timeout(5000))).rejects.toBeInstanceOf(
      SchemaError,
    );
  });

  it("maps a malformed 200 body (missing text) to SchemaError", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ notText: 1 }), { status: 200 }),
    );
    await expect(fetchFlavorText(CONTEXT, AbortSignal.timeout(5000))).rejects.toBeInstanceOf(
      SchemaError,
    );
  });

  it("wraps a fetch rejection as NetworkError", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("network down"));
    await expect(fetchFlavorText(CONTEXT, AbortSignal.timeout(5000))).rejects.toBeInstanceOf(
      NetworkError,
    );
  });
});
