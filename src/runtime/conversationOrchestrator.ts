// Conversation orchestrator. Owns:
//   - per-request AbortController (timeout via setTimeout + abort())
//   - currentRequestId monotonic counter (post-await stale-check)
//   - currentSession (ballroom session state — beginSession/endSession/
//     currentSessionId methods)
//   - subscription registration: TargetCharacterDied → personaCacheRegistry
//     invalidation (module-load subscription)
//
// Bus-publishing discipline: orchestrator RETURNS ConversationOutcome to the
// caller (store action); the store action publishes events from its
// set-completed body. The orchestrator only subscribes (for cache
// invalidation), never publishes.
//
// Plan: plans/phases/04-ballroom-llm.md "src/runtime/conversationOrchestrator.ts".

import { LLM_TIMEOUT_MS } from "../game/constants";
import type { ConversationFailure } from "../game/conversation/types";
import type { Character } from "../game/entities";
import { type BallSessionId, makeBallSessionId } from "../game/rng";
import { personaCacheRegistry } from "../llm/cache";
import { LlmClient } from "../llm/client";
import { CancelledError, MissingKeyError, NetworkError, SchemaError } from "../llm/errors";
import { type ConversationRequest, type ConversationResponse, narrowResponse } from "../llm/types";
import { conversationBus } from "./events/conversation";

export type ConversationOutcome =
  | { kind: "Resolved"; response: ConversationResponse }
  | { kind: "Failed"; failure: ConversationFailure };

class ConversationOrchestrator {
  private currentRequestId = 0;
  private currentAbort: AbortController | null = null;
  private currentSession: { sessionId: BallSessionId; tickAtEntry: number } | null = null;

  // ── Session methods (called by store actions enterBallroom/exitBallroom) ──

  beginSession(tick: number): BallSessionId {
    // P4 disallows concurrent sessions. Re-entering within the same tick
    // returns the existing sessionId (idempotent); a new tick replaces.
    if (this.currentSession !== null && this.currentSession.tickAtEntry === tick) {
      return this.currentSession.sessionId;
    }
    const sessionId = makeBallSessionId(tick);
    this.currentSession = { sessionId, tickAtEntry: tick };
    return sessionId;
  }

  endSession(): BallSessionId | null {
    const id = this.currentSession?.sessionId ?? null;
    this.currentSession = null;
    return id;
  }

  currentSessionId(): BallSessionId | null {
    return this.currentSession?.sessionId ?? null;
  }

  // ── Request lifecycle ────────────────────────────────────────────────────

  abortCurrent(): void {
    if (this.currentAbort !== null) this.currentAbort.abort();
  }

  async send(
    request: ConversationRequest,
    apiKey: string,
    target: Character,
  ): Promise<ConversationOutcome> {
    // Bump request ID; capture locally. Post-await mutations bail when a
    // later send() has superseded this one.
    const requestId = ++this.currentRequestId;

    const abortController = new AbortController();
    this.currentAbort = abortController;

    // Per-request timeout. Flag distinguishes timeout-abort from user-abort;
    // the client always throws CancelledError on abort — only the
    // orchestrator knows why.
    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      abortController.abort();
    }, LLM_TIMEOUT_MS);

    try {
      // Fresh per-request LlmClient — a key change between sends takes
      // effect on the next call without orchestrator re-init.
      const client = new LlmClient(apiKey); // may throw MissingKeyError

      const cacheName = await personaCacheRegistry.getOrCreatePersonaCache(
        client.ai,
        target,
        request.model,
        abortController.signal,
        request.otherCharactersInScene,
      );
      const requestWithCache: ConversationRequest = { ...request, cacheName };

      const raw = await client.respond(requestWithCache, abortController.signal);

      clearTimeout(timeoutHandle);
      this.currentAbort = null;

      // Stale-check: a later send() may have bumped the counter.
      if (requestId !== this.currentRequestId) {
        return { kind: "Failed", failure: { reason: "cancelled" } };
      }
      return { kind: "Resolved", response: narrowResponse(raw, request.pinnedIntent) };
    } catch (err) {
      clearTimeout(timeoutHandle);
      this.currentAbort = null;

      if (requestId !== this.currentRequestId) {
        return { kind: "Failed", failure: { reason: "cancelled" } };
      }
      // Map typed errors → ConversationFailure reasons.
      if (err instanceof MissingKeyError) {
        return { kind: "Failed", failure: { reason: "missing-key" } };
      }
      if (err instanceof SchemaError) {
        return { kind: "Failed", failure: { reason: "schema", issues: err.issues } };
      }
      if (err instanceof CancelledError) {
        return { kind: "Failed", failure: { reason: timedOut ? "timeout" : "cancelled" } };
      }
      if (err instanceof NetworkError) {
        return { kind: "Failed", failure: { reason: "network" } };
      }
      // Defensive — any unanticipated error type.
      return { kind: "Failed", failure: { reason: "network" } };
    }
  }
}

export const conversationOrchestrator = new ConversationOrchestrator();

// Module-load subscription: invalidate persona cache entries when an NPC
// dies. Published from runYearPass's diff-and-publish body (Step 8).
conversationBus.subscribe("TargetCharacterDied", (event) => {
  personaCacheRegistry.invalidateForTarget(event.targetCharacterId);
});
