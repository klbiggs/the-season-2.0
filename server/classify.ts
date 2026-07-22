// POST /api/llm/classify (P26 G1, Q15 two-phase call #2).
//
// Non-streaming forced-function-call that labels an exchange whose dialogue was
// already produced by the streamed leg. ALWAYS routed to MODEL_DEFAULT (Flash):
// classification is cheap and deterministic-ish; the Pro budget belongs to the
// streamed prose. NO persona cache — a small static classifier instruction plus
// the client-built `targetPersonaLine` gives the toolCalls surface (whisper /
// grievance) the minimal character context it needs, since two-phase moves
// toolCalls OFF the persona-cached `respond` call.

import type { IncomingMessage, ServerResponse } from "node:http";
import { FunctionCallingConfigMode, GoogleGenAI } from "@google/genai";
import { MODEL_DEFAULT } from "../src/game/constants";
import { ClassifyRequestSchema, ClassifyResponseSchema } from "../src/llm/types";
import { validateEnv } from "./env";
import { CLASSIFY_TOOL } from "./tools";

const SERVER_TIMEOUT_MS = 8_000;

const CLASSIFIER_INSTRUCTION =
  "You classify Regency-era society conversation. Given the player's message and the " +
  "in-character reply it received, label which of the five tactics the PLAYER used and " +
  "rate the phrasing quality of the player's message from 0.5 (clumsy) to 1.5 (deft). " +
  "Optionally suggest the character's resulting mood. Emit a toolCall ONLY when the " +
  "moment genuinely warrants it.";

export async function handleClassify(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson(req);
  const parsed = ClassifyRequestSchema.safeParse(body);
  if (!parsed.success) {
    respondJson(res, 422, { kind: "schema", issues: parsed.error.issues });
    return;
  }
  const env = validateEnv();
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const request = parsed.data;

  const scene =
    request.sceneCharacters.length > 0
      ? `\n[Also present: ${request.sceneCharacters.map((c) => c.name).join(", ")}]`
      : "";
  const contents =
    `[Character: ${request.targetPersonaLine}]` +
    `${scene}\n[Mode: ${request.mode}]\n` +
    `Player said: ${request.freeformMessage}\n` +
    `They replied: ${request.dialogue}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SERVER_TIMEOUT_MS);
  try {
    const response = await ai.models.generateContent({
      model: MODEL_DEFAULT,
      contents,
      config: {
        systemInstruction: CLASSIFIER_INSTRUCTION,
        tools: [{ functionDeclarations: [CLASSIFY_TOOL] }],
        toolConfig: {
          functionCallingConfig: {
            mode: FunctionCallingConfigMode.ANY,
            allowedFunctionNames: ["classify"],
          },
        },
        abortSignal: controller.signal,
      },
    });
    const call = response.functionCalls?.[0];
    if (call === undefined || call.name !== "classify") {
      respondJson(res, 422, {
        kind: "schema",
        issues: [{ path: "functionCalls[0]", message: "missing classify call" }],
      });
      return;
    }
    const validated = ClassifyResponseSchema.safeParse(call.args);
    if (!validated.success) {
      respondJson(res, 422, { kind: "schema", issues: validated.error.issues });
      return;
    }
    respondJson(res, 200, validated.data);
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
