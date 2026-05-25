// POST /api/llm/flavor handler. Thin relay over ai.models.generateContent
// using the EXISTING GEMINI_API_KEY (no separate credential — reuses the
// conversation key). Mirrors server/embeddings.ts: parse → validateEnv →
// composite-budget AbortController → SDK call → map errors to HTTP status.
//
// Single-shot plain prose: NO persona caching, NO function-calling, NO tools.
// The server builds the per-kind prompt (server/prompts/flavor.ts) and reads
// response.text. Used for generate-once / persist-once flavor content
// (artifact backstories, NPC bios, scandal columns); generation is fire-and-
// forget on the client, so failures degrade to the designer stub.

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

export async function handleFlavor(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson(req);
  const parsed = FlavorRequestSchema.safeParse(body);
  if (!parsed.success) {
    respondJson(res, 422, { kind: "schema", issues: parsed.error.issues });
    return;
  }
  const env = validateEnv();
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const { systemInstruction, userPrompt } = buildFlavorPrompt(parsed.data.context);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FLAVOR_SERVER_TIMEOUT_MS);
  try {
    const response = await ai.models.generateContent({
      model: FLAVOR_MODEL,
      contents: userPrompt,
      config: {
        systemInstruction,
        // Disable thinking: flavor is creative prose with no reasoning step, and
        // on Gemini 2.5/3.x flash models thinking tokens are deducted from
        // maxOutputTokens — leaving a tight cap to truncate the visible prose
        // mid-sentence. thinkingBudget 0 = DISABLED (frees the whole budget;
        // also faster + cheaper). maxOutputTokens is then a generous safety
        // ceiling, not the length control (the prompt caps length).
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: FLAVOR_OUTPUT_TOKEN_BUDGET,
        abortSignal: controller.signal,
      },
    });
    const text = response.text?.trim() ?? "";
    if (text === "") {
      respondJson(res, 422, {
        kind: "schema",
        issues: [{ path: "text", message: "empty flavor generation" }],
      });
      return;
    }
    respondJson(res, 200, { text });
  } catch (err) {
    respondJson(res, mapSdkErrorToHttpStatus(err), { kind: mapSdkErrorToKind(err) });
  } finally {
    clearTimeout(timer);
  }
}

// Local copies of the conversation/embed handlers' tiny helpers — kept self-
// contained rather than sharing a module, matching the existing handlers.
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
