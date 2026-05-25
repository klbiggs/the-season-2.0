// Client-side flavor-generation wrapper around the localhost proxy at
// /api/llm/flavor. Timer-free like client.ts/embeddings.ts: the caller owns
// the AbortSignal (flavorOrchestrator uses FLAVOR_REQUEST_TIMEOUT_MS).
// Generation is fire-and-forget — the orchestrator swallows the typed errors
// and degrades to the designer stub (nothing persisted; retries next encounter).
//
// Boundary (rule c): imports only llm/types + llm/errors. No gameplay state,
// no persist, no runtime.

import { CancelledError, NetworkError, SchemaError, zodIssuesFrom } from "./errors";
import { type FlavorContext, type FlavorRequest, FlavorResponseSchema } from "./types";

const FLAVOR_ENDPOINT = "/api/llm/flavor";

// Generates one flavor passage for the given context via the proxy. Throws
// typed llm/errors (CancelledError / NetworkError / SchemaError) mirroring
// client.ts / embeddings.ts; the flavorOrchestrator catches these and drops
// the generation (stub keeps showing).
export async function fetchFlavorText(
  context: FlavorContext,
  signal: AbortSignal,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(FLAVOR_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ context } satisfies FlavorRequest),
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
    throw new SchemaError(body?.issues ?? [{ path: "(unknown)", message: "flavor schema error" }]);
  }
  if (!response.ok) throw new NetworkError(`unexpected status ${response.status}`);

  const body: unknown = await response.json().catch(() => null);
  let parsed: ReturnType<typeof FlavorResponseSchema.parse>;
  try {
    parsed = FlavorResponseSchema.parse(body);
  } catch (cause) {
    throw new SchemaError(zodIssuesFrom(cause));
  }
  return parsed.text;
}
