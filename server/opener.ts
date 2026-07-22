// POST /api/llm/opener handler (P26 Q14 NPC-initiated openers). The NPC authors
// a short opening line when it approaches the player first (ballroom approach or
// accepted calling-card Visit). Reuses the EXISTING GEMINI_API_KEY.
//
// Single-shot plain prose: NO function-calling, NO tools. The character persona
// grounds the voice via systemInstruction (buildPersonaPrompt — same persona the
// conversation endpoint uses); the "you approach first" framing rides the
// per-turn contents (NOT systemInstruction). Generation is fire-and-forget on
// the client, so failures degrade silently (the conversation opens with no
// opener line). thinkingBudget 0 + a small cap keep the line short (the flavor
// endpoint precedent).

import type { IncomingMessage, ServerResponse } from "node:http";
import { GoogleGenAI } from "@google/genai";
import {
  MODEL_DEFAULT,
  OPENER_OUTPUT_TOKEN_BUDGET,
  OPENER_SERVER_TIMEOUT_MS,
} from "../src/game/constants";
import { OpenerRequestSchema } from "../src/llm/types";
import { validateEnv } from "./env";
import { buildPersonaPrompt } from "./prompts/persona";

const BALLROOM_OPENER_FRAMING =
  "[You have approached the player at a society ball and opened the conversation. " +
  "Greet them in-character with a single short line — a remark, a pleasantry, or a " +
  "pointed opening. Do not narrate; speak as the character.]";

const VISIT_OPENER_FRAMING =
  "[You have called on the player at their home and been received. Open the " +
  "conversation in-character with a single short line. Do not narrate; speak as " +
  "the character.]";

export async function handleOpener(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson(req);
  const parsed = OpenerRequestSchema.safeParse(body);
  if (!parsed.success) {
    respondJson(res, 422, { kind: "schema", issues: parsed.error.issues });
    return;
  }
  const env = validateEnv();
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const request = parsed.data;

  const framing =
    request.approachContext === "Ballroom" ? BALLROOM_OPENER_FRAMING : VISIT_OPENER_FRAMING;
  const transcript = request.history
    .map((ex) => (ex.speaker === "house-head" ? `Player: ${ex.text}` : `NPC: ${ex.text}`))
    .join("\n");
  const contents = transcript === "" ? framing : `${transcript}\n${framing}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENER_SERVER_TIMEOUT_MS);
  try {
    const response = await ai.models.generateContent({
      model: MODEL_DEFAULT,
      contents,
      config: {
        systemInstruction: buildPersonaPrompt(request.characterStateSnapshot),
        // Plain prose, no reasoning step — free the whole cap (flavor precedent).
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: OPENER_OUTPUT_TOKEN_BUDGET,
        abortSignal: controller.signal,
      },
    });
    const text = response.text?.trim() ?? "";
    if (text === "") {
      respondJson(res, 422, {
        kind: "schema",
        issues: [{ path: "text", message: "empty opener generation" }],
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
