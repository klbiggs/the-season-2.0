// Conversation orchestrator. Owns:
//   - per-request user-abort + timeout AbortControllers (composed via
//     AbortSignal.any and passed to client.send)
//   - currentRequestId monotonic counter (post-await stale-check)
//   - currentSession (ballroom session state — beginSession/endSession/
//     currentSessionId methods)
//   - subscription registration: TargetCharacterDied → POST
//     /api/llm/persona/invalidate (module-load subscription;
//     fire-and-forget; replaces the in-browser personaCacheRegistry
//     invalidation that pre-P7.5 lived here)
//
// Bus-publishing discipline: orchestrator RETURNS ConversationOutcome to
// the caller (store action); the store action publishes events. The
// orchestrator only subscribes (for cache invalidation), never publishes.
//
// P7.5: client.ts is timer-free. The orchestrator owns the timeout
// AbortController AND the user-exit AbortController, composes them via
// AbortSignal.any, and passes the composed signal to client.send. The
// `timedOut` flag distinguishes timeout-vs-cancel for the catch-and-map.

import { LLM_TIMEOUT_MS } from "../game/constants";
import type { ConversationFailure } from "../game/conversation/types";
import { type BallSessionId, makeBallSessionId } from "../game/rng";
import { LlmClient } from "../llm/client";
import { CancelledError, NetworkError, SchemaError } from "../llm/errors";
import {
  type ConversationResponse,
  type ProxyConversationRequest,
  type Tactic,
  narrowResponse,
} from "../llm/types";
import { conversationBus } from "./events/conversation";

export type ConversationOutcome =
  | { kind: "Resolved"; response: ConversationResponse }
  | { kind: "Failed"; failure: ConversationFailure };

class ConversationOrchestrator {
  private currentRequestId = 0;
  private currentUserAbort: AbortController | null = null;
  private currentSession: { sessionId: BallSessionId; tickAtEntry: number } | null = null;
  private readonly client = new LlmClient();

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
    if (this.currentUserAbort !== null) this.currentUserAbort.abort();
  }

  async send(
    request: ProxyConversationRequest,
    pinnedIntent: Tactic | null,
  ): Promise<ConversationOutcome> {
    // Bump request ID; capture locally. Post-await mutations bail when a
    // later send() has superseded this one.
    const requestId = ++this.currentRequestId;

    // Two abort sources, both orchestrator-internal:
    //   - userAbortController: toggled by abortCurrent() (user exits the
    //     ballroom mid-fetch).
    //   - timeoutController: fired by the setTimeout below at 15s.
    // Compose via AbortSignal.any; client.ts receives a single composed
    // signal and stays timer-free.
    const userAbortController = new AbortController();
    const timeoutController = new AbortController();
    this.currentUserAbort = userAbortController;

    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      timeoutController.abort();
    }, LLM_TIMEOUT_MS);

    const composedSignal = AbortSignal.any([userAbortController.signal, timeoutController.signal]);

    try {
      const raw = await this.client.send(request, composedSignal);

      clearTimeout(timeoutHandle);
      this.currentUserAbort = null;

      // Stale-check: a later send() may have bumped the counter.
      if (requestId !== this.currentRequestId) {
        return { kind: "Failed", failure: { reason: "cancelled" } };
      }
      return { kind: "Resolved", response: narrowResponse(raw, pinnedIntent) };
    } catch (err) {
      clearTimeout(timeoutHandle);
      this.currentUserAbort = null;

      if (requestId !== this.currentRequestId) {
        return { kind: "Failed", failure: { reason: "cancelled" } };
      }
      // Map typed errors → ConversationFailure reasons.
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

// Module-load subscription: POST to /api/llm/persona/invalidate when an
// NPC dies. Replaces the pre-P7.5 in-browser
// personaCacheRegistry.invalidateForTarget call — the cache now lives
// server-side. Fire-and-forget; 50-min TTL bounds staleness on failure.
// `typeof fetch === 'function'` guard + `.catch(() => {})` survive
// non-browser test envs without a registered fetch stub.
conversationBus.subscribe("TargetCharacterDied", (event) => {
  if (typeof fetch !== "function") return;
  void fetch("/api/llm/persona/invalidate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ targetCharacterId: event.targetCharacterId }),
  }).catch(() => {
    /* fire-and-forget */
  });
});
