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
  type ClassifyRequest,
  type ClassifyResponseRaw,
  ClassifyResponseSchema,
  type ConversationResponseRaw,
  ConversationResponseSchema,
  type ProxyConversationRequest,
  StreamEventSchema,
} from "./types";

const CONVERSATION_ENDPOINT = "/api/llm/conversation";
const CONVERSATION_STREAM_ENDPOINT = "/api/llm/conversation/stream";
const CLASSIFY_ENDPOINT = "/api/llm/classify";

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

  // P26 (G1) call #1: stream the dialogue prose. Invokes `onDelta` per token
  // chunk and resolves with the full text. Timer-free (the orchestrator owns
  // the budget). Throws the same typed errors as send().
  async sendStream(
    request: ProxyConversationRequest,
    composedSignal: AbortSignal,
    onDelta: (text: string) => void,
  ): Promise<string> {
    let response: Response;
    try {
      response = await fetch(CONVERSATION_STREAM_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
        signal: composedSignal,
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
      throw new SchemaError(
        body?.issues ?? [{ path: "(unknown)", message: "stream schema error" }],
      );
    }
    if (!response.ok) throw new NetworkError(`unexpected status ${response.status}`);
    if (response.body === null) throw new NetworkError("stream body missing");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";

    // Returns the terminal text when a `done` frame is seen, else null.
    const drainFrames = (flushTail: boolean): string | null => {
      const frames = buffer.split("\n\n");
      // Mid-stream the trailing element is an incomplete frame — keep it
      // buffered. On flush (reader exhausted) it IS complete, so process it:
      // otherwise the terminal `done` frame can be dropped and the reply
      // silently truncates to whatever deltas happened to land on a boundary.
      buffer = flushTail ? "" : (frames.pop() ?? "");
      for (const frame of frames) {
        const line = frame.trim();
        if (!line.startsWith("data:")) continue;
        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(line.slice("data:".length).trim());
        } catch {
          continue; // partial/garbled frame — skip
        }
        const parsed = StreamEventSchema.safeParse(parsedJson);
        if (!parsed.success) continue;
        const event = parsed.data;
        if (event.kind === "delta") {
          full += event.text;
          onDelta(event.text);
        } else if (event.kind === "done") {
          return event.text === "" ? full : event.text;
        } else {
          if (event.reason === "timeout") throw new CancelledError();
          throw new NetworkError(`stream ${event.reason}`);
        }
      }
      return null;
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const terminal = drainFrames(false);
        if (terminal !== null) return terminal;
      }
      // Reader exhausted — flush any complete frame still buffered.
      const terminal = drainFrames(true);
      if (terminal !== null) return terminal;
    } catch (cause) {
      if (cause instanceof CancelledError || cause instanceof NetworkError) throw cause;
      if (cause instanceof Error && cause.name === "AbortError") throw new CancelledError();
      throw new NetworkError(cause);
    }
    // Stream ended without a terminal `done` frame — treat whatever arrived as
    // the reply if non-empty, else a network fault.
    if (full === "") throw new NetworkError("stream ended with no content");
    return full;
  }

  // P26 (G1) call #2: classify the exchange (non-streaming forced function).
  async classify(
    request: ClassifyRequest,
    composedSignal: AbortSignal,
  ): Promise<ClassifyResponseRaw> {
    let response: Response;
    try {
      response = await fetch(CLASSIFY_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
        signal: composedSignal,
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
      throw new SchemaError(
        body?.issues ?? [{ path: "(unknown)", message: "classify schema error" }],
      );
    }
    if (!response.ok) throw new NetworkError(`unexpected status ${response.status}`);

    const body: unknown = await response.json().catch(() => null);
    try {
      return ClassifyResponseSchema.parse(body);
    } catch (cause) {
      throw new SchemaError(zodIssuesFrom(cause));
    }
  }
}
