import { afterEach, describe, expect, it, vi } from "vitest";
import { cosineSimilarity, embedTexts, l2normalize } from "./embeddings";
import { CancelledError, NetworkError, SchemaError } from "./errors";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("l2normalize", () => {
  it("scales a vector to unit length", () => {
    const out = l2normalize([3, 4]);
    expect(out[0]).toBeCloseTo(0.6, 6);
    expect(out[1]).toBeCloseTo(0.8, 6);
    const norm = Math.sqrt((out[0] ?? 0) ** 2 + (out[1] ?? 0) ** 2);
    expect(norm).toBeCloseTo(1, 6);
  });

  it("returns zeros for a zero vector (no division by zero)", () => {
    const out = l2normalize([0, 0, 0]);
    expect([...out]).toEqual([0, 0, 0]);
  });
});

describe("cosineSimilarity", () => {
  it("is 1 for identical normalized vectors", () => {
    const v = l2normalize([3, 4]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 6);
  });

  it("is 0 for orthogonal vectors", () => {
    expect(cosineSimilarity(l2normalize([1, 0]), l2normalize([0, 1]))).toBeCloseTo(0, 6);
  });

  it("guards a length mismatch (uses the shorter length)", () => {
    expect(() => cosineSimilarity(l2normalize([1, 0, 0]), l2normalize([1, 0]))).not.toThrow();
  });
});

describe("embedTexts (via the global fetch stub)", () => {
  it("returns one L2-normalized vector per input text", async () => {
    const vecs = await embedTexts(["hello", "world"], "RETRIEVAL_QUERY", AbortSignal.timeout(5000));
    expect(vecs).toHaveLength(2);
    for (const v of vecs) {
      let sumSq = 0;
      for (const x of v) sumSq += x * x;
      expect(Math.sqrt(sumSq)).toBeCloseTo(1, 5);
    }
  });

  it("maps a 408 to CancelledError", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(null, { status: 408 }));
    await expect(
      embedTexts(["x"], "RETRIEVAL_QUERY", AbortSignal.timeout(5000)),
    ).rejects.toBeInstanceOf(CancelledError);
  });

  it("maps a 5xx to NetworkError", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(null, { status: 502 }));
    await expect(
      embedTexts(["x"], "RETRIEVAL_QUERY", AbortSignal.timeout(5000)),
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it("maps a 422 to SchemaError", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ issues: [{ path: "texts", message: "bad" }] }), {
        status: 422,
      }),
    );
    await expect(
      embedTexts(["x"], "RETRIEVAL_QUERY", AbortSignal.timeout(5000)),
    ).rejects.toBeInstanceOf(SchemaError);
  });

  it("wraps a fetch rejection as NetworkError", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("network down"));
    await expect(
      embedTexts(["x"], "RETRIEVAL_QUERY", AbortSignal.timeout(5000)),
    ).rejects.toBeInstanceOf(NetworkError);
  });
});
