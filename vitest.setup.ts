// Vitest setup file — registers a deterministic global `fetch` stub for
// CLIENT tests. Server tests opt into `vi.mock("@google/genai")` (the SDK
// mock at __mocks__/@google/genai.ts) instead.
//
// Route table:
//   POST /api/llm/conversation       → deterministic ConversationResponseRaw
//   POST /api/llm/embed              → deterministic embeddings
//   POST /api/llm/flavor             → deterministic { text }
//   POST /api/llm/persona/invalidate → 204 No Content
//   anything else                    → throws (defensive catch for drift)
//
// The response shape mirrors the deleted client.ts/SDK boundary: identical
// requests produce identical responses, derived from a canonicalJSON hash
// of the wire body. Replay-harness determinism is unaffected (the harness
// doesn't invoke sendBallroomMessage), but client-side conversation tests
// inherit this stub via vitest.config.ts's setupFiles entry.

import { vi } from "vitest";
import { EMBEDDING_DIMENSIONS } from "./src/game/constants";
import { canonicalJSON } from "./src/game/hash";

const tactics = ["Flattery", "WittyBanter", "SlyGossip", "DeepEmpathy"] as const;
const moods = ["Receptive", "Defensive", "Distracted", "Jealous", "Grieving"] as const;
const dialogues = [
  "A measured response, in character.",
  "Indeed, the season grows more eventful by the week.",
  "One must always be careful what one says in such company.",
  "I find your candor refreshing.",
];

function createHashFromString(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h = ((h ^ input.charCodeAt(i)) * 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// P17: deterministic EMBEDDING_DIMENSIONS-length embedding per text (LCG seeded
// by the text hash). The proxy response shape the client sees is the extracted
// `{ embeddings: number[][] }` (server already pulled .values out).
function deterministicEmbedding(text: string): number[] {
  let seed = Number.parseInt(createHashFromString(text), 16) >>> 0;
  const out: number[] = new Array(EMBEDDING_DIMENSIONS);
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    out[i] = (seed / 0xffffffff) * 2 - 1;
  }
  return out;
}

function deterministicResponseFromHash(hash: string) {
  const tacticIdx = Number.parseInt(hash[0] ?? "0", 16) % 4;
  const qualityNudge = Number.parseInt(hash[1] ?? "0", 16) / 15;
  const moodIdx = Number.parseInt(hash[2] ?? "0", 16) % 5;
  const dialogueIdx = Number.parseInt(hash[3] ?? "0", 16) % 4;
  return {
    dialogue: dialogues[dialogueIdx],
    classifiedTactic: tactics[tacticIdx],
    qualityMultiplier: 0.5 + qualityNudge,
    moodHint: moods[moodIdx],
    toolCalls: [],
  };
}

vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const urlStr =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : (input as Request).url;
  const path = new URL(urlStr, "http://localhost").pathname;
  const rawBody = typeof init?.body === "string" ? init.body : "";

  if (path === "/api/llm/conversation") {
    const hash = createHashFromString(canonicalJSON(rawBody));
    const response = deterministicResponseFromHash(hash);
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (path === "/api/llm/embed") {
    let texts: string[] = [];
    try {
      const parsed = JSON.parse(rawBody) as { texts?: unknown };
      if (Array.isArray(parsed.texts)) texts = parsed.texts.map((t) => String(t));
    } catch {
      texts = [];
    }
    const embeddings = texts.map(deterministicEmbedding);
    return new Response(JSON.stringify({ embeddings }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (path === "/api/llm/flavor") {
    // P18: deterministic flavor text derived from the request-body hash, so
    // client-side flavor tests are stable. Server tests use the genai mock.
    const hash = createHashFromString(canonicalJSON(rawBody));
    const text = `Flavor passage [${hash}].`;
    return new Response(JSON.stringify({ text }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (path === "/api/llm/persona/invalidate") {
    return new Response(null, { status: 204 });
  }
  throw new Error(
    `vitest.setup.ts: unexpected fetch path ${path} — extend the stub if intentional`,
  );
});
