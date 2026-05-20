// LlmClient wraps the Gemini SDK. BYOK — the apiKey is passed per-instance
// (the orchestrator constructs a fresh client per request so a key change
// between sends takes effect immediately).
//
// Plan: plans/phases/04-ballroom-llm.md "src/llm/client.ts".

import {
  FunctionCallingConfigMode,
  type GenerateContentResponse,
  GoogleGenAI,
} from "@google/genai";
import { BYOK_KEY_SHAPE_REGEX, LLM_OUTPUT_TOKEN_BUDGET } from "../game/constants";
import {
  CancelledError,
  MissingKeyError,
  NetworkError,
  SchemaError,
  zodIssuesFrom,
} from "./errors";
import { GENERATE_WHISPER_TOOL, RESPOND_TOOL } from "./tools";
import {
  type ConversationRequest,
  type ConversationResponseRaw,
  ConversationResponseSchema,
} from "./types";

export class LlmClient {
  // Public so the orchestrator can pass the underlying GoogleGenAI instance
  // to PersonaCacheRegistry.getOrCreatePersonaCache. Read-only — external
  // callers cannot reassign.
  public readonly ai: GoogleGenAI;

  constructor(apiKey: string) {
    if (!isValidKeyShape(apiKey)) throw new MissingKeyError();
    // The Gemini SDK's GoogleGenAI client is browser-safe by default for
    // the Gemini Developer API path (apiKey-based) — no explicit
    // "allow browser" opt-in needed. The key is held in-memory only.
    this.ai = new GoogleGenAI({ apiKey });
  }

  async respond(req: ConversationRequest, abort: AbortSignal): Promise<ConversationResponseRaw> {
    // Mutually exclusive per Gemini SDK contract: pass cachedContent OR
    // systemInstruction, never both.
    const cachingConfig =
      req.cacheName !== null
        ? { cachedContent: req.cacheName }
        : { systemInstruction: req.persona };

    let response: GenerateContentResponse;
    try {
      response = await this.ai.models.generateContent({
        model: req.model,
        contents: buildContents(req),
        config: {
          ...cachingConfig,
          tools: [{ functionDeclarations: [RESPOND_TOOL, GENERATE_WHISPER_TOOL] }],
          toolConfig: {
            functionCallingConfig: {
              mode: FunctionCallingConfigMode.ANY,
              allowedFunctionNames: ["respond"],
            },
          },
          maxOutputTokens: LLM_OUTPUT_TOKEN_BUDGET,
          abortSignal: abort,
        },
      });
    } catch (cause) {
      // AbortError → CancelledError (neutral). The orchestrator's
      // timedOut flag distinguishes timeout from user-cancel.
      if (cause instanceof DOMException && cause.name === "AbortError") {
        throw new CancelledError();
      }
      throw new NetworkError(cause);
    }

    // Forced function call returns exactly one functionCall (allowedFunctionNames
    // restricts to "respond"). Validate via Zod.
    const calls = response.functionCalls;
    const call = calls?.[0];
    if (call === undefined || call.name !== "respond") {
      throw new SchemaError([{ path: "functionCalls[0]", message: "missing respond call" }]);
    }
    try {
      return ConversationResponseSchema.parse(call.args);
    } catch (cause) {
      throw new SchemaError(zodIssuesFrom(cause));
    }
  }
}

export function isValidKeyShape(key: string): boolean {
  return BYOK_KEY_SHAPE_REGEX.test(key);
}

// Build the dynamic contents string passed to generateContent. Canonical
// format pinned for determinism — the mock SDK hashes this string.
//   <exchanges joined by "\n">\n<player freeform message>
// where each exchange is:
//   - speaker "house-head" → `Player: <text>`
//   - speaker "other"      → `NPC: <text>`
// Empty history → just the freeform message with no preceding newline.
function buildContents(req: ConversationRequest): string {
  const transcript = req.history
    .map((ex) => (ex.speaker === "house-head" ? `Player: ${ex.text}` : `NPC: ${ex.text}`))
    .join("\n");
  return transcript === "" ? req.freeformMessage : `${transcript}\n${req.freeformMessage}`;
}
