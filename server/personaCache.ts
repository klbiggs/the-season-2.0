// In-memory per-process persona cache. Lifetime = server process lifetime
// (no Redis, no disk persistence in v1). Restarting dev:server wipes it;
// next call per (target, model, version) tuple pays the 1-3s
// caches.create latency again. Documented tradeoff vs prior browser-side
// module-singleton cache.

import type { GoogleGenAI } from "@google/genai";
import {
  PERSONA_CACHE_DISPLAY_NAME_PREFIX,
  PERSONA_CACHE_TTL_MS,
  PERSONA_CACHE_TTL_SECONDS,
  PERSONA_CACHE_VERSION,
} from "../src/game/constants";
import type { CharacterStateSnapshot, Model } from "../src/llm/types";
import { buildPersonaPrompt } from "./prompts/persona";

type CacheEntry = { name: string; createdAt: number };

const cache = new Map<string, CacheEntry>();

export async function getOrCreatePersonaCache(
  ai: GoogleGenAI,
  snapshot: CharacterStateSnapshot,
  model: Model,
  abortSignal: AbortSignal,
): Promise<string | null> {
  const key = `${snapshot.target.id}|${model}|${PERSONA_CACHE_VERSION}`;
  const hit = cache.get(key);
  if (hit !== undefined && Date.now() - hit.createdAt < PERSONA_CACHE_TTL_MS) {
    return hit.name;
  }
  try {
    const result = await ai.caches.create({
      model,
      config: {
        systemInstruction: buildPersonaPrompt(snapshot),
        ttl: PERSONA_CACHE_TTL_SECONDS,
        displayName: `${PERSONA_CACHE_DISPLAY_NAME_PREFIX}${snapshot.target.id}-${PERSONA_CACHE_VERSION}`,
        abortSignal,
      },
    });
    const name = result.name;
    if (name === undefined) return null;
    cache.set(key, { name, createdAt: Date.now() });
    return name;
  } catch (cause) {
    // AbortError → re-throw (the handler catches it and maps to 408).
    if (cause instanceof Error && cause.name === "AbortError") throw cause;
    // All other errors (network blip, quota, unsupported model) swallow
    // and return null. The handler falls back to passing systemInstruction
    // directly on this turn — observationally identical to a first-meeting
    // prompt, slower (no cache hit) but functionally correct.
    console.warn("[personaCache] caches.create failed, falling back to systemInstruction:", cause);
    return null;
  }
}

export function invalidateForTarget(targetCharacterId: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(`${targetCharacterId}|`)) cache.delete(key);
  }
}
