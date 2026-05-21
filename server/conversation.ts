// POST /api/llm/conversation handler. Owns the SDK call composition that
// previously lived at src/llm/client.ts:41-90 — same FunctionDeclaration
// shape (RESPOND_TOOL + GENERATE_WHISPER_TOOL), same forced
// FunctionCallingConfigMode.ANY with allowedFunctionNames=["respond"],
// same buildContents logic.
//
// Single 13s composite-budget AbortController covers BOTH caches.create
// and generateContent. First-meeting paths (Pro model + cache-create) can
// plausibly exceed 13s — accepted v1 behavior; client retries hit the
// populated cache on second send.

import type { IncomingMessage, ServerResponse } from "node:http";
import { FunctionCallingConfigMode, GoogleGenAI } from "@google/genai";
import { LLM_OUTPUT_TOKEN_BUDGET } from "../src/game/constants";
import { ConversationResponseSchema, ProxyConversationRequestSchema } from "../src/llm/types";
import { validateEnv } from "./env";
import { getOrCreatePersonaCache } from "./personaCache";
import { buildPersonaPrompt } from "./prompts/persona";
import { routeModel } from "./routing";
import { GENERATE_WHISPER_TOOL, RESPOND_TOOL } from "./tools";

const SERVER_TIMEOUT_MS = 13_000;

export async function handleConversation(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson(req);
  const parsed = ProxyConversationRequestSchema.safeParse(body);
  if (!parsed.success) {
    respondJson(res, 422, { kind: "schema", issues: parsed.error.issues });
    return;
  }
  const env = validateEnv();
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const request = parsed.data;
  const model = routeModel(request.history);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SERVER_TIMEOUT_MS);
  try {
    const cacheName = await getOrCreatePersonaCache(
      ai,
      request.characterStateSnapshot,
      model,
      controller.signal,
    );
    // Mutually exclusive per Gemini SDK contract: cachedContent OR
    // systemInstruction, never both. Cache-miss / create-failure → null →
    // fall back to passing systemInstruction directly this turn.
    const cachingConfig =
      cacheName !== null
        ? { cachedContent: cacheName }
        : { systemInstruction: buildPersonaPrompt(request.characterStateSnapshot) };
    const contents = buildContents(request);

    const response = await ai.models.generateContent({
      model,
      contents,
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
        abortSignal: controller.signal,
      },
    });

    const call = response.functionCalls?.[0];
    if (call === undefined || call.name !== "respond") {
      respondJson(res, 422, {
        kind: "schema",
        issues: [{ path: "functionCalls[0]", message: "missing respond call" }],
      });
      return;
    }
    const validated = ConversationResponseSchema.safeParse(call.args);
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

function buildContents(req: {
  history: ReadonlyArray<{ speaker: "house-head" | "other"; text: string }>;
  freeformMessage: string;
}): string {
  const transcript = req.history
    .map((ex) => (ex.speaker === "house-head" ? `Player: ${ex.text}` : `NPC: ${ex.text}`))
    .join("\n");
  return transcript === "" ? req.freeformMessage : `${transcript}\n${req.freeformMessage}`;
}

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
