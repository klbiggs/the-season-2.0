// Client-side NPC-opener wrapper around the localhost proxy at /api/llm/opener
// (P26 Q14). Timer-free like flavor.ts: the caller owns the AbortSignal (the
// store fires it with OPENER_TIMEOUT_MS). Fire-and-forget — the store swallows
// the typed errors and the conversation simply opens with no opener line.
//
// Boundary (rule c): imports only llm/types + llm/errors.

import { CancelledError, NetworkError, SchemaError, zodIssuesFrom } from "./errors";
import { type OpenerRequest, OpenerResponseSchema } from "./types";

const OPENER_ENDPOINT = "/api/llm/opener";

export async function fetchOpener(request: OpenerRequest, signal: AbortSignal): Promise<string> {
  let response: Response;
  try {
    response = await fetch(OPENER_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request satisfies OpenerRequest),
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
    throw new SchemaError(body?.issues ?? [{ path: "(unknown)", message: "opener schema error" }]);
  }
  if (!response.ok) throw new NetworkError(`unexpected status ${response.status}`);

  const body: unknown = await response.json().catch(() => null);
  let parsed: ReturnType<typeof OpenerResponseSchema.parse>;
  try {
    parsed = OpenerResponseSchema.parse(body);
  } catch (cause) {
    throw new SchemaError(zodIssuesFrom(cause));
  }
  return parsed.text;
}
