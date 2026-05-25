// Typed error classes for the LLM round-trip. Each carries a literal
// `reason` field that matches the ConversationFailure discriminated union
// (in src/game/conversation/types.ts), so the orchestrator's catch-and-map
// is mechanical. Mirrors src/persist/errors.ts pattern (P2).
//
// Plan: plans/phases/04-ballroom-llm.md "src/llm/errors.ts".
// P7.5: MissingKeyError removed — the browser no longer holds an API key
// (the localhost proxy validates server-side via server/env.ts). Proxy-down
// failures (5xx, ECONNREFUSED) map to NetworkError client-side.

import { z } from "zod";

export class NetworkError extends Error {
  readonly reason = "network" as const;
  constructor(public override readonly cause?: unknown) {
    super("Network or SDK error during conversation request.");
    this.name = "NetworkError";
  }
}

export class SchemaError extends Error {
  readonly reason = "schema" as const;
  constructor(public readonly issues: ReadonlyArray<{ path: string; message: string }>) {
    super("Model response failed schema validation.");
    this.name = "SchemaError";
  }
}

export class CancelledError extends Error {
  readonly reason = "cancelled" as const;
  constructor() {
    super("Conversation request cancelled (user or view exit).");
    this.name = "CancelledError";
  }
}

// Converts a thrown ZodError into the issues array shape SchemaError expects.
// Non-Zod errors surface as a single generic issue. Lives here (not in
// client.ts) so the types module owns the conversion alongside SchemaError.
export function zodIssuesFrom(cause: unknown): Array<{ path: string; message: string }> {
  if (cause instanceof z.ZodError) {
    return cause.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
  }
  return [{ path: "(unknown)", message: cause instanceof Error ? cause.message : String(cause) }];
}
