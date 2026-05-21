// LlmClient — typed fetch wrapper around the localhost proxy at
// /api/llm/conversation. ~50 LOC. Timer-free: the orchestrator owns the
// 15s timeout AbortController + user-abort composition via AbortSignal.any
// and passes the composed signal in. client.ts just fetches and validates.
//
// P7.5: replaces the pre-relocation @google/genai-based client. No SDK
// import; no apiKey arg; no GoogleGenAI field. The SDK call composition
// (buildContents + tools + toolConfig + abortSignal threading) moved to
// server/conversation.ts.

import { CancelledError, NetworkError, SchemaError, zodIssuesFrom } from "./errors";
import {
  type ConversationResponseRaw,
  ConversationResponseSchema,
  type ProxyConversationRequest,
} from "./types";

const CONVERSATION_ENDPOINT = "/api/llm/conversation";

export class LlmClient {
  async send(
    request: ProxyConversationRequest,
    composedSignal: AbortSignal,
  ): Promise<ConversationResponseRaw> {
    let response: Response;
    try {
      response = await fetch(CONVERSATION_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
        signal: composedSignal,
      });
    } catch (cause) {
      // AbortError → CancelledError (neutral). The orchestrator's
      // timedOut flag distinguishes timeout from user-cancel.
      if (cause instanceof DOMException && cause.name === "AbortError") {
        throw new CancelledError();
      }
      if (cause instanceof Error && cause.name === "AbortError") {
        throw new CancelledError();
      }
      throw new NetworkError(cause);
    }

    if (response.status === 408) throw new CancelledError(); // server-side timeout
    if (response.status >= 500) throw new NetworkError(`server ${response.status}`);
    if (response.status === 422) {
      const body = (await response.json().catch(() => null)) as {
        issues?: ReadonlyArray<{ path: string; message: string }>;
      } | null;
      throw new SchemaError(body?.issues ?? [{ path: "(unknown)", message: "schema error" }]);
    }
    if (!response.ok) throw new NetworkError(`unexpected status ${response.status}`);

    const body: unknown = await response.json().catch(() => null);
    try {
      return ConversationResponseSchema.parse(body);
    } catch (cause) {
      throw new SchemaError(zodIssuesFrom(cause));
    }
  }
}
