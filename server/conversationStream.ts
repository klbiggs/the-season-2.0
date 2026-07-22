// POST /api/llm/conversation/stream (P26 G1, Q15 two-phase call #1).
//
// Streams the NPC's dialogue PROSE over SSE. Deliberately carries NO tools /
// toolConfig — the forced-function `respond` shape cannot be streamed token by
// token, so two-phase splits it: this leg emits prose, and the separate
// /api/llm/classify leg labels the exchange. Persona grounding + buildContents
// are IDENTICAL to handleConversation (same cache, same section ordering), so
// the streamed voice matches the single-shot path exactly.
//
// SSE framing: `data: {"kind":"delta","text":...}` per chunk, terminal
// `data: {"kind":"done","text":<full>}`, or `data: {"kind":"error","reason":...}`.
// The per-route try/catch in server/index.ts only covers PRE-stream failures
// (`if (!res.headersSent)`); once headers are sent we must emit an SSE error
// frame and end the response ourselves.
//
// Same 13s composite budget as handleConversation (covers caches.create +
// generateContentStream).

import type { IncomingMessage, ServerResponse } from "node:http";
import { GoogleGenAI } from "@google/genai";
import {
  LLM_OUTPUT_TOKEN_BUDGET,
  MODEL_DEFAULT,
  STREAM_THINKING_OUTPUT_TOKEN_BUDGET,
} from "../src/game/constants";
import { ProxyConversationRequestSchema } from "../src/llm/types";
import { buildContents } from "./conversation";
import { validateEnv } from "./env";
import { getOrCreatePersonaCache } from "./personaCache";
import { buildPersonaPrompt } from "./prompts/persona";
import { routeModel } from "./routing";

const SERVER_TIMEOUT_MS = 13_000;

export async function handleConversationStream(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = await readJson(req);
  const parsed = ProxyConversationRequestSchema.safeParse(body);
  if (!parsed.success) {
    // Pre-stream failure → ordinary JSON 422 (headers not yet sent).
    res.writeHead(422, { "content-type": "application/json" });
    res.end(JSON.stringify({ kind: "schema", issues: parsed.error.issues }));
    return;
  }
  const env = validateEnv();
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const request = parsed.data;
  const model = routeModel(request.history, request.keyMoment);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SERVER_TIMEOUT_MS);
  try {
    const cacheName = await getOrCreatePersonaCache(
      ai,
      request.characterStateSnapshot,
      model,
      controller.signal,
    );
    const cachingConfig =
      cacheName !== null
        ? { cachedContent: cacheName }
        : { systemInstruction: buildPersonaPrompt(request.characterStateSnapshot) };
    // The single-shot path gets this discipline for free: `respond`'s
    // `dialogue` FIELD implicitly excludes narration. Streaming plain prose
    // does not, and the model drifts into asterisked stage direction
    // ("*she laughs*"), so state the constraint explicitly here.
    const contents = `${buildContents(request)}\n\n[Reply with spoken words ONLY — no narration, no stage direction, no asterisks. One or two sentences.]`;

    // Thinking-off is a FLASH-ONLY option: `gemini-3.1-pro-preview` rejects
    // `thinkingBudget: 0` outright ("This model only works in thinking mode",
    // HTTP 400) — so the flavor endpoint's blanket thinkingBudget-0 precedent
    // does NOT transfer to a Pro-routed call. Disable thinking only on Flash
    // (where thinking tokens would otherwise eat maxOutputTokens and delay the
    // first token); let Pro think.
    const isFlash = model === MODEL_DEFAULT;
    const thinkingConfig = isFlash ? { thinkingConfig: { thinkingBudget: 0 } } : {};
    // Thinking tokens are deducted from maxOutputTokens (P18 lesson), so a
    // thinking-mode (Pro) leg needs a much larger ceiling or the visible prose
    // truncates mid-sentence. Flash has thinking disabled → normal budget.
    const maxOutputTokens = isFlash ? LLM_OUTPUT_TOKEN_BUDGET : STREAM_THINKING_OUTPUT_TOKEN_BUDGET;

    const stream = await ai.models.generateContentStream({
      model,
      contents,
      config: {
        ...cachingConfig,
        ...thinkingConfig,
        maxOutputTokens,
        abortSignal: controller.signal,
      },
    });

    // Headers go out on the first successful SDK handshake, not before — a
    // pre-stream throw above still yields a clean JSON error.
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    let full = "";
    for await (const chunk of stream) {
      const text = chunk.text ?? "";
      if (text === "") continue;
      full += text;
      writeEvent(res, { kind: "delta", text });
    }
    writeEvent(res, { kind: "done", text: full });
    res.end();
  } catch (err) {
    console.error("[server] conversation-stream failure:", err);
    const reason = mapSdkErrorToKind(err);
    if (res.headersSent) {
      // Mid-stream failure — the client is reading SSE frames, so signal in-band.
      writeEvent(res, { kind: "error", reason });
      res.end();
      return;
    }
    res.writeHead(mapSdkErrorToHttpStatus(err), { "content-type": "application/json" });
    res.end(JSON.stringify({ kind: reason }));
  } finally {
    clearTimeout(timer);
  }
}

function writeEvent(res: ServerResponse, event: Record<string, unknown>): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

// Local copies of the tiny helpers (self-contained per the existing handlers).
function mapSdkErrorToHttpStatus(err: unknown): number {
  if (err instanceof Error) {
    if (err.name === "AbortError") return 408;
    if (
      err.message.includes("fetch") ||
      err.message.includes("network") ||
      err.message.includes("ECONNREFUSED")
    ) {
      return 502;
    }
  }
  return 500;
}

function mapSdkErrorToKind(err: unknown): "timeout" | "network" | "internal" {
  if (err instanceof Error && err.name === "AbortError") return "timeout";
  if (
    err instanceof Error &&
    (err.message.includes("fetch") ||
      err.message.includes("network") ||
      err.message.includes("ECONNREFUSED"))
  ) {
    return "network";
  }
  return "internal";
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf-8");
        resolve(raw === "" ? null : JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}
