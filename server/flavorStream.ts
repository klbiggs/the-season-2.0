// POST /api/llm/flavor/stream (P26 G1, flavor half).
//
// Streams a flavor passage over SSE using the SAME per-kind prompt as
// handleFlavor (server/prompts/flavor.ts) — the streamed text and the
// single-shot text are the same generation, only delivered progressively.
// The client falls back to POST /api/llm/flavor on any stream failure, so
// this endpoint is purely a latency-perception improvement.
//
// SSE framing matches server/conversationStream.ts exactly:
//   data: {"kind":"delta","text":...} per chunk
//   data: {"kind":"done","text":<full>} terminal
//   data: {"kind":"error","reason":"timeout"|"network"|"internal"}
// index.ts's per-route catch only covers PRE-stream failures; once headers are
// sent this handler must emit the in-band error frame itself.
//
// Thinking stays disabled here (unlike the conversation stream's Flash-only
// gate): FLAVOR_MODEL is a Flash model, and flavor is creative prose with no
// reasoning step — the same rationale as handleFlavor.

import type { IncomingMessage, ServerResponse } from "node:http";
import { GoogleGenAI } from "@google/genai";
import {
  FLAVOR_MODEL,
  FLAVOR_OUTPUT_TOKEN_BUDGET,
  FLAVOR_SERVER_TIMEOUT_MS,
} from "../src/game/constants";
import { FlavorRequestSchema } from "../src/llm/types";
import { validateEnv } from "./env";
import { buildFlavorPrompt } from "./prompts/flavor";

export async function handleFlavorStream(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson(req);
  const parsed = FlavorRequestSchema.safeParse(body);
  if (!parsed.success) {
    res.writeHead(422, { "content-type": "application/json" });
    res.end(JSON.stringify({ kind: "schema", issues: parsed.error.issues }));
    return;
  }
  const env = validateEnv();
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const { systemInstruction, userPrompt } = buildFlavorPrompt(parsed.data.context);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FLAVOR_SERVER_TIMEOUT_MS);
  try {
    const stream = await ai.models.generateContentStream({
      model: FLAVOR_MODEL,
      contents: userPrompt,
      config: {
        systemInstruction,
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: FLAVOR_OUTPUT_TOKEN_BUDGET,
        abortSignal: controller.signal,
      },
    });

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
    const trimmed = full.trim();
    if (trimmed === "") {
      // An empty generation is a failure, not a passage — signal in-band so
      // the client falls back rather than persisting nothing under a "done".
      writeEvent(res, { kind: "error", reason: "internal" });
      res.end();
      return;
    }
    writeEvent(res, { kind: "done", text: trimmed });
    res.end();
  } catch (err) {
    // Logged here for the same reason as conversationStream: this handler
    // swallows every failure to decide in-band-SSE vs pre-stream JSON, so
    // index.ts's catch never sees it.
    console.error("[server] flavor-stream failure:", err);
    const reason = mapSdkErrorToKind(err);
    if (res.headersSent) {
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
