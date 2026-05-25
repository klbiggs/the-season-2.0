// Deterministic mock replacing @google/genai in test environments. The
// response for a given request is a pure function of the request's hash:
// identical requests always produce identical responses. This makes the
// LLM layer compatible with the 30-run replay-harness determinism contract.
//
// Vitest's __mocks__ auto-discovery for npm packages uses the project-root
// __mocks__/ directory (Context7-verified). A bare vi.mock("@google/genai")
// in a test file activates this default mock.
//
// Per-test factory overrides via vi.mock("@google/genai", () => ({...}))
// shadow this default for that file's scope only.

import { EMBEDDING_DIMENSIONS } from "../../src/game/constants";
import { canonicalJSON } from "../../src/game/hash";

const tactics = ["Flattery", "WittyBanter", "SlyGossip", "DeepEmpathy"] as const;
const moods = ["Receptive", "Defensive", "Distracted", "Jealous", "Grieving"] as const;
const dialogues = [
  "A measured response, in character.",
  "Indeed, the season grows more eventful by the week.",
  "One must always be careful what one says in such company.",
  "I find your candor refreshing.",
];

export class GoogleGenAI {
  constructor(_opts: unknown) {}
  models = {
    generateContent: async (params: unknown) => {
      const requestHash = createHashFromString(canonicalJSON(params));
      return deterministicResponseFromHash(requestHash);
    },
    generateContentStream: async () => {
      throw new Error("Stream API is not used at P4 — bare vi.mock should not hit this branch.");
    },
    // P17: deterministic embeddings. Returns one EMBEDDING_DIMENSIONS-length
    // vector per input text, derived from the text hash so identical inputs
    // produce identical vectors (replay-harness-compatible). Shape mirrors the
    // real SDK: response.embeddings[i].values.
    embedContent: async (params: { contents: string[] | string }) => {
      const texts = Array.isArray(params.contents) ? params.contents : [params.contents];
      return { embeddings: texts.map((t) => ({ values: deterministicEmbedding(t) })) };
    },
  };
  caches = {
    create: async (params: { config?: { displayName?: string } } = {}) => {
      // Deterministic cache name derived from displayName.
      const name = `mock-cache-${params.config?.displayName ?? "untitled"}`;
      return { name };
    },
  };
}

export const FunctionCallingConfigMode = {
  AUTO: "AUTO",
  ANY: "ANY",
  NONE: "NONE",
  MODE_UNSPECIFIED: "MODE_UNSPECIFIED",
  VALIDATED: "VALIDATED",
} as const;

// Type-only re-exports (no runtime values needed for tests).
export type FunctionDeclaration = {
  name: string;
  description?: string;
  parametersJsonSchema?: unknown;
};

export type GenerateContentResponse = ReturnType<typeof deterministicResponseFromHash>;

function deterministicResponseFromHash(hash: string): {
  functionCalls: Array<{ name: string; args: Record<string, unknown> }>;
  usageMetadata: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    cachedContentTokenCount?: number;
  };
} {
  // Hex-derived selection — deterministic given the input hash.
  const tacticIdx = Number.parseInt(hash[0] ?? "0", 16) % 4;
  const qualityNudge = Number.parseInt(hash[1] ?? "0", 16) / 15; // 0..1
  const moodIdx = Number.parseInt(hash[2] ?? "0", 16) % 5;
  const dialogueIdx = Number.parseInt(hash[3] ?? "0", 16) % 4;
  return {
    functionCalls: [
      {
        name: "respond",
        args: {
          dialogue: dialogues[dialogueIdx],
          classifiedTactic: tactics[tacticIdx],
          qualityMultiplier: 0.5 + qualityNudge, // in [0.5, 1.5]
          moodHint: moods[moodIdx],
          toolCalls: [],
        },
      },
    ],
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
  };
}

function createHashFromString(input: string): string {
  // FNV-1a-like fold. Pure, deterministic, sufficient for mock purposes.
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h = ((h ^ input.charCodeAt(i)) * 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// P17: deterministic EMBEDDING_DIMENSIONS-length vector seeded by the text
// hash (LCG fill in [-1, 1]). Stable per text → stable cosine for tests.
function deterministicEmbedding(text: string): number[] {
  let seed = Number.parseInt(createHashFromString(text), 16) >>> 0;
  const out: number[] = new Array(EMBEDDING_DIMENSIONS);
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    out[i] = (seed / 0xffffffff) * 2 - 1;
  }
  return out;
}
