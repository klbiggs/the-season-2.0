// Client-side embedding wrapper around the localhost proxy at /api/llm/embed.
// Timer-free like client.ts: the caller owns the AbortSignal (retrieval uses
// EMBED_RETRIEVAL_TIMEOUT_MS; indexing is fire-and-forget). Returns L2-normalized
// Float32Array vectors so cosine similarity reduces to a dot product.
//
// Boundary (rule c): imports only constants + llm/types + llm/errors. No
// gameplay state, no persist, no runtime.

import { CancelledError, NetworkError, SchemaError, zodIssuesFrom } from "./errors";
import { type EmbedRequest, EmbedResponseSchema } from "./types";

const EMBED_ENDPOINT = "/api/llm/embed";

// L2-normalize so cosine = dot product. gemini-embedding-001 reduced-dim
// vectors are NOT pre-normalized, so we always normalize regardless of model.
// A zero vector normalizes to zeros (cosine 0 with everything — inert).
export function l2normalize(vec: ReadonlyArray<number>): Float32Array {
  const out = Float32Array.from(vec);
  let sumSq = 0;
  for (const v of out) sumSq += v * v;
  const norm = Math.sqrt(sumSq);
  if (norm === 0) return out;
  for (let i = 0; i < out.length; i += 1) out[i] = (out[i] ?? 0) / norm;
  return out;
}

// Cosine similarity for L2-normalized vectors (= dot product). Guards a length
// mismatch defensively (e.g., a stale-dim vector lingering before discard).
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i += 1) dot += (a[i] ?? 0) * (b[i] ?? 0);
  return dot;
}

// Embeds texts via the proxy, returning one L2-normalized vector per input in
// order. Throws typed llm/errors (CancelledError / NetworkError / SchemaError)
// mirroring client.ts; callers in the semantic-index layer swallow these and
// degrade (indexing drops the passage; retrieval falls back to recency-only).
export async function embedTexts(
  texts: ReadonlyArray<string>,
  taskType: EmbedRequest["taskType"],
  signal: AbortSignal,
): Promise<Float32Array[]> {
  let response: Response;
  try {
    response = await fetch(EMBED_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ texts: [...texts], taskType } satisfies EmbedRequest),
      signal,
    });
  } catch (cause) {
    if (cause instanceof Error && cause.name === "AbortError") throw new CancelledError();
    throw new NetworkError(cause);
  }

  if (response.status === 408) throw new CancelledError();
  if (response.status >= 500) throw new NetworkError(`server ${response.status}`);
  if (response.status === 422) {
    const body = (await response.json().catch(() => null)) as {
      issues?: ReadonlyArray<{ path: string; message: string }>;
    } | null;
    throw new SchemaError(body?.issues ?? [{ path: "(unknown)", message: "embed schema error" }]);
  }
  if (!response.ok) throw new NetworkError(`unexpected status ${response.status}`);

  const body: unknown = await response.json().catch(() => null);
  let parsed: ReturnType<typeof EmbedResponseSchema.parse>;
  try {
    parsed = EmbedResponseSchema.parse(body);
  } catch (cause) {
    throw new SchemaError(zodIssuesFrom(cause));
  }
  return parsed.embeddings.map(l2normalize);
}
