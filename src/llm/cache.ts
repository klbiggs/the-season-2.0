// Per-target context-cache lifecycle. Gemini's caching is stateful, so the
// registry maps (targetCharacterId, modelName) → CachedContent.name (the
// server-issued resource handle). The orchestrator (NOT the store action)
// calls getOrCreatePersonaCache(ai, target, model, abort) before each
// generateContent; the cacheName threads into the ConversationRequest, and
// the client branches on cacheName vs systemInstruction (mutually exclusive).
//
// Plan: plans/phases/04-ballroom-llm.md "src/llm/cache.ts".

import type { GoogleGenAI } from "@google/genai";
import { PERSONA_CACHE_DISPLAY_NAME_PREFIX, PERSONA_CACHE_TTL_SECONDS } from "../game/constants";
import type { Character } from "../game/entities";
import { CancelledError } from "./errors";
import { buildPersonaPrompt } from "./prompts/persona";
import type { CharacterId, Model } from "./types";

type CacheKey = `${CharacterId}|${Model}`;

export class PersonaCacheRegistry {
  private readonly cache = new Map<CacheKey, string>();

  async getOrCreatePersonaCache(
    ai: GoogleGenAI,
    target: Character,
    model: Model,
    abort: AbortSignal,
  ): Promise<string | null> {
    const key = `${target.id}|${model}` as CacheKey;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    try {
      const result = await ai.caches.create({
        model,
        config: {
          systemInstruction: buildPersonaPrompt(target),
          ttl: PERSONA_CACHE_TTL_SECONDS,
          displayName: `${PERSONA_CACHE_DISPLAY_NAME_PREFIX}${target.id}`,
          abortSignal: abort,
        },
      });
      const name = result.name;
      if (name === undefined) return null;
      this.cache.set(key, name);
      return name;
    } catch (cause) {
      // AbortError → re-throw as CancelledError (typed LlmError) so the
      // orchestrator's instanceof CancelledError branch handles it
      // correctly. Re-throwing a raw DOMException would fall through to
      // {reason:"network"} which is wrong banner prose.
      if (cause instanceof DOMException && cause.name === "AbortError") {
        throw new CancelledError();
      }
      // All other errors (network, unsupported model, quota) fall through
      // to null so the client falls back to passing systemInstruction
      // directly on this turn. Observationally identical to a first-meeting
      // prompt — slower (no cache hit) but functionally correct.
      return null;
    }
  }

  invalidateForTarget(targetId: CharacterId): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${targetId}|`)) this.cache.delete(key);
    }
  }

  // Called when the user rotates the BYOK API key. The cache names belong
  // to the old key's project; clearing the local registry forces a fresh
  // create on the next conversation.
  clear(): void {
    this.cache.clear();
  }
}

// Module-level singleton — all consumers (orchestrator + KeyContext.setKey
// callback) reach the same registry instance.
export const personaCacheRegistry = new PersonaCacheRegistry();
