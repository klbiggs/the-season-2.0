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

import { LLM_TIMEOUT_MS, STREAM_LEG_TIMEOUT_MS } from "../game/constants";
import type { ConversationFailure } from "../game/conversation/types";
import {
  type BallSessionId,
  type CharacterId,
  type PromenadeSessionId,
  type VisitSessionId,
  makeBallSessionId,
  makePromenadeSessionId,
  makeVisitSessionId,
} from "../game/rng";
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

// P12: cross-mode discriminated union for the in-memory session. Sessions
// never persist (in-memory only) — saves discard sessions on reload.
// `replaceState` defensively calls endSession() to avoid leaving an orphaned
// `currentMode === "Promenade"` after load (which would falsely block the
// cross-mode SessionAlreadyOpen gate on subsequent enterBallroom/enterPromenade).
type SessionState =
  | { mode: "Ballroom"; sessionId: BallSessionId; tickAtEntry: number }
  | {
      mode: "Promenade";
      sessionId: PromenadeSessionId;
      tickAtEntry: number;
      partnerCharacterId: CharacterId;
    }
  // P26: NPC-initiated Visit (drawing-room call). Carries the caller id + the
  // originating card so exitVisit / the VisitExited event can reference them.
  | {
      mode: "Visit";
      sessionId: VisitSessionId;
      tickAtEntry: number;
      callerCharacterId: CharacterId;
    };

class ConversationOrchestrator {
  private currentRequestId = 0;
  private currentUserAbort: AbortController | null = null;
  private currentSession: SessionState | null = null;
  private readonly client = new LlmClient();

  // ── Session methods (called by store actions enterBallroom/exitBallroom) ──

  beginSession(tick: number): BallSessionId {
    // P12/P26: defense-in-depth against cross-mode misuse. Store-action layer
    // gates first via the SessionAlreadyOpen rejection; this throw fires
    // only on test code or future internal refactors that bypass the gate.
    if (this.currentSession !== null && this.currentSession.mode !== "Ballroom") {
      throw new Error(
        `conversationOrchestrator.beginSession: a ${this.currentSession.mode} session is already open`,
      );
    }
    // P4 disallows concurrent sessions. Re-entering within the same tick
    // returns the existing sessionId (idempotent); a new tick replaces.
    if (
      this.currentSession !== null &&
      this.currentSession.mode === "Ballroom" &&
      this.currentSession.tickAtEntry === tick
    ) {
      return this.currentSession.sessionId;
    }
    const sessionId = makeBallSessionId(tick);
    this.currentSession = { mode: "Ballroom", sessionId, tickAtEntry: tick };
    return sessionId;
  }

  // P12: open a Promenade-mode session. Symmetric with beginSession but
  // carries the deterministically-picked partner.
  beginPromenadeSession(tick: number, partnerCharacterId: CharacterId): PromenadeSessionId {
    if (this.currentSession !== null && this.currentSession.mode !== "Promenade") {
      throw new Error(
        `conversationOrchestrator.beginPromenadeSession: a ${this.currentSession.mode} session is already open`,
      );
    }
    if (
      this.currentSession !== null &&
      this.currentSession.mode === "Promenade" &&
      this.currentSession.tickAtEntry === tick &&
      this.currentSession.partnerCharacterId === partnerCharacterId
    ) {
      // Idempotent re-entry — same (tick, partner). Mirrors beginSession's
      // same-tick idempotence so a UI mount effect can't double-open.
      return this.currentSession.sessionId;
    }
    const sessionId = makePromenadeSessionId(tick);
    this.currentSession = {
      mode: "Promenade",
      sessionId,
      tickAtEntry: tick,
      partnerCharacterId,
    };
    return sessionId;
  }

  // P26: open a Visit-mode session (NPC-initiated drawing-room call). Symmetric
  // with beginPromenadeSession but carries the caller (from the accepted card).
  beginVisitSession(tick: number, callerCharacterId: CharacterId): VisitSessionId {
    if (this.currentSession !== null && this.currentSession.mode !== "Visit") {
      throw new Error(
        `conversationOrchestrator.beginVisitSession: a ${this.currentSession.mode} session is already open`,
      );
    }
    if (
      this.currentSession !== null &&
      this.currentSession.mode === "Visit" &&
      this.currentSession.tickAtEntry === tick &&
      this.currentSession.callerCharacterId === callerCharacterId
    ) {
      return this.currentSession.sessionId;
    }
    const sessionId = makeVisitSessionId(tick);
    this.currentSession = { mode: "Visit", sessionId, tickAtEntry: tick, callerCharacterId };
    return sessionId;
  }

  endSession(): BallSessionId | PromenadeSessionId | VisitSessionId | null {
    const id = this.currentSession?.sessionId ?? null;
    this.currentSession = null;
    return id;
  }

  currentSessionId(): BallSessionId | PromenadeSessionId | VisitSessionId | null {
    return this.currentSession?.sessionId ?? null;
  }

  // P12/P26: which mode is the current session in (or null if no session).
  currentMode(): "Ballroom" | "Promenade" | "Visit" | null {
    return this.currentSession?.mode ?? null;
  }

  // P12: partner id for the current Promenade session (or null if not in
  // Promenade mode). Used by sendPromenadeMessage to read the partner at
  // send time + by exitPromenade for the PromenadeExited event payload.
  currentPromenadePartner(): CharacterId | null {
    return this.currentSession?.mode === "Promenade"
      ? this.currentSession.partnerCharacterId
      : null;
  }

  // P26: caller id for the current Visit session (or null if not in Visit mode).
  // Used by sendVisitMessage to read the caller at send time + by exitVisit for
  // the VisitExited event payload.
  currentVisitCaller(): CharacterId | null {
    return this.currentSession?.mode === "Visit" ? this.currentSession.callerCharacterId : null;
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

  // P26 (G1, Q15): two-phase streamed send. Call #1 streams the dialogue prose
  // (onDelta per chunk); call #2 classifies the exchange. Both legs share ONE
  // 15s outer budget, with the stream leg additionally capped at
  // STREAM_LEG_TIMEOUT_MS so a Pro-routed stream can't starve classify.
  //
  // Failure policy: a NetworkError/SchemaError from EITHER leg falls back ONCE
  // to the single-shot send() (the prose is regenerated — the streamed text is
  // discarded, so no half-committed exchange). Timeout and user-cancel do NOT
  // retry (the 15s budget is already spent).
  async sendStreamed(
    request: ProxyConversationRequest,
    pinnedIntent: Tactic | null,
    onDelta: (text: string) => void,
  ): Promise<ConversationOutcome> {
    const requestId = ++this.currentRequestId;

    const userAbortController = new AbortController();
    const timeoutController = new AbortController();
    this.currentUserAbort = userAbortController;

    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      timeoutController.abort();
    }, LLM_TIMEOUT_MS);
    const outerSignal = AbortSignal.any([userAbortController.signal, timeoutController.signal]);

    try {
      // Stream leg — its own inner cap composed with the outer budget.
      const streamLegController = new AbortController();
      const streamLegTimer = setTimeout(() => streamLegController.abort(), STREAM_LEG_TIMEOUT_MS);
      let dialogue: string;
      try {
        dialogue = await this.client.sendStream(
          request,
          AbortSignal.any([outerSignal, streamLegController.signal]),
          onDelta,
        );
      } finally {
        clearTimeout(streamLegTimer);
      }

      // Classify leg — compact persona line keeps the toolCalls surface grounded.
      const target = request.characterStateSnapshot.target;
      const classified = await this.client.classify(
        {
          freeformMessage: request.freeformMessage,
          dialogue,
          targetCharacterId: request.targetCharacterId,
          targetPersonaLine: `${target.name}, mood ${target.mood}, traits ${target.traits.slice(0, 3).join("/") || "none"}`,
          sceneCharacters: request.otherCharactersInScene.map((c) => ({
            id: c.id,
            name: c.name,
          })),
          mode: request.mode,
        },
        outerSignal,
      );

      clearTimeout(timeoutHandle);
      this.currentUserAbort = null;
      if (requestId !== this.currentRequestId) {
        return { kind: "Failed", failure: { reason: "cancelled" } };
      }
      return {
        kind: "Resolved",
        response: narrowResponse({ dialogue, ...classified }, pinnedIntent),
      };
    } catch (err) {
      clearTimeout(timeoutHandle);
      this.currentUserAbort = null;

      if (requestId !== this.currentRequestId) {
        return { kind: "Failed", failure: { reason: "cancelled" } };
      }
      // Timeout / user-cancel → no retry (budget spent).
      if (err instanceof CancelledError) {
        return { kind: "Failed", failure: { reason: timedOut ? "timeout" : "cancelled" } };
      }
      // Network/schema fault on either leg → ONE fallback to the single-shot
      // path. Its own fresh budget; the discarded stream text never committed.
      if (err instanceof NetworkError || err instanceof SchemaError) {
        return this.send(request, pinnedIntent);
      }
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
