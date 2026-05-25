// POST /api/llm/embed handler. Thin relay over ai.models.embedContent using
// the EXISTING GEMINI_API_KEY (no separate credential — P17 reuses the
// conversation key). Mirrors server/conversation.ts: parse → validateEnv →
// composite-budget AbortController → SDK call → map errors to HTTP status.
//
// Returns raw (un-normalized) float vectors in input order; the client
// (src/llm/embeddings.ts) L2-normalizes before storing/querying so cosine
// reduces to a dot product. taskType (RETRIEVAL_DOCUMENT / RETRIEVAL_QUERY)
// is a per-call quality hint, NOT a model alias — pinning stays on
// EMBEDDING_MODEL.

import type { IncomingMessage, ServerResponse } from "node:http";
import { GoogleGenAI } from "@google/genai";
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  EMBED_SERVER_TIMEOUT_MS,
} from "../src/game/constants";
import { EmbedRequestSchema } from "../src/llm/types";
import { validateEnv } from "./env";

export async function handleEmbed(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson(req);
  const parsed = EmbedRequestSchema.safeParse(body);
  if (!parsed.success) {
    respondJson(res, 422, { kind: "schema", issues: parsed.error.issues });
    return;
  }
  const env = validateEnv();
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const { texts, taskType } = parsed.data;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EMBED_SERVER_TIMEOUT_MS);
  try {
    const response = await ai.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: texts,
      config: {
        outputDimensionality: EMBEDDING_DIMENSIONS,
        taskType,
        abortSignal: controller.signal,
      },
    });
    const embeddings = (response.embeddings ?? []).map((e) => e.values ?? []);
    if (embeddings.length !== texts.length || embeddings.some((v) => v.length === 0)) {
      respondJson(res, 422, {
        kind: "schema",
        issues: [{ path: "embeddings", message: "embedding count/shape mismatch" }],
      });
      return;
    }
    respondJson(res, 200, { embeddings });
  } catch (err) {
    respondJson(res, mapSdkErrorToHttpStatus(err), { kind: mapSdkErrorToKind(err) });
  } finally {
    clearTimeout(timer);
  }
}

// Local copies of the conversation handler's tiny helpers — kept self-contained
// rather than sharing a module, matching server/conversation.ts's own private
// readJson/respondJson and error-mapping (the two handlers stay independent).
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

function mapSdkErrorToKind(err: unknown): string {
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

function respondJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
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
