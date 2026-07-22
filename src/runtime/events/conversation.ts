// Conversation event bus + BallEntryRejection type. Per CLAUDE.md
// non-negotiable §9 (typed event publishers, no god files): partitioned
// per domain. ConversationFailure lives in src/game/conversation/types.ts
// (shared module so the store action can return it without crossing into
// the runtime/events layer); the event module both imports for local use
// AND re-exports for consumer convenience.
//
// Bus-publishing discipline: store actions publish from their set-completed
// body, NOT from inside the orchestrator. The single exception is
// TargetCharacterDied — published from runYearPass's diff-and-publish
// body (Step 8) so PersonaCacheRegistry can invalidate stale entries.
//
// Plan: plans/phases/04-ballroom-llm.md "src/runtime/events/conversation.ts".

import type { Stance, Tactic } from "../../game/constants";
import type { ConversationPairKey } from "../../game/conversation/types";
import type { GameState } from "../../game/entities";
import type { LocationId } from "../../game/fixtures/locations";
import type { Mood } from "../../game/fixtures/moods";
import {
  type BallSessionId,
  type CallingCardId,
  type CharacterId,
  type HouseId,
  PLAYER_HOUSE_ID,
  type PromenadeSessionId,
  type VisitSessionId,
} from "../../game/rng";
import { EventBus } from "./bus";

import type { ConversationFailure } from "../../game/conversation/types";
export type { ConversationFailure };

// Discriminated union returned by enterBallroom when validation fails.
// P4 only has the WrongLocation variant; P8 will add PatronessVeto.
// P12 adds SessionAlreadyOpen — fires when a Promenade session is already
// open. enterPromenade's PromenadeEntryRejection carries the same variant
// (defined in src/game/rules/promenade.ts) for the reciprocal direction.
export type BallEntryRejection =
  | { kind: "WrongLocation"; current: LocationId }
  | { kind: "PlayerExiled" } // P6 exile-gate variant
  | { kind: "ElopementInProgress" } // P9 Q4 — enterBallroom is the upstream gate for sendBallroomMessage
  | { kind: "SessionAlreadyOpen" }; // P12 cross-mode gate

export type ConversationEvent =
  | {
      kind: "ConversationSent";
      tick: number;
      pairKey: ConversationPairKey;
      tactic: Tactic | null;
      stance: Stance;
    }
  | {
      kind: "ConversationResolved";
      tick: number;
      pairKey: ConversationPairKey;
      classifiedTactic: Tactic;
      affectionDelta: number;
      composureDelta: number;
      synergy: boolean;
      moodHint: Mood | null;
    }
  | {
      kind: "ConversationFailed";
      tick: number;
      pairKey: ConversationPairKey;
      failure: ConversationFailure;
    }
  | {
      kind: "FauxPasFired";
      tick: number;
      targetCharacterId: CharacterId;
      lockUntilTick: number;
      wasAlreadyLocked: boolean;
    }
  | {
      kind: "BallroomEntered";
      tick: number;
      houseId: HouseId;
      sessionId: BallSessionId;
    }
  | {
      kind: "BallroomExited";
      tick: number;
      houseId: HouseId;
      sessionId: BallSessionId;
      finalPlayerComposure: number;
    }
  | {
      kind: "TargetCharacterDied";
      tick: number;
      targetCharacterId: CharacterId;
    }
  // P12: promenade session lifecycle events. Reuses conversationBus
  // (no dedicated promenadeBus) matching the BallroomEntered/Exited precedent.
  | {
      kind: "PromenadeEntered";
      tick: number;
      houseId: HouseId;
      sessionId: PromenadeSessionId;
      partnerCharacterId: CharacterId;
    }
  | {
      kind: "PromenadeExited";
      tick: number;
      houseId: HouseId;
      sessionId: PromenadeSessionId;
      // null only on the orchestrator-cleared edge case where the session was
      // ended before exitPromenade reads the partner id.
      partnerCharacterId: CharacterId | null;
    }
  // P26: NPC-initiated calling cards (Q14). CallingCardIssued / CallingCardExpired
  // are diff-published by publishCallingCardTransitions from every tick-advancing
  // wrapper EXCEPT runYearPass (year-pass STEPS has no applyCallingCardPhase).
  | {
      kind: "CallingCardIssued";
      tick: number;
      cardId: CallingCardId;
      callerCharacterId: CharacterId;
    }
  | {
      kind: "CallingCardExpired";
      tick: number;
      cardId: CallingCardId;
    }
  // Accepted/Declined are direct-published by the acceptCallingCard /
  // declineCallingCard free-action wrappers (not diffed).
  | {
      kind: "CallingCardAccepted";
      tick: number;
      cardId: CallingCardId;
      callerCharacterId: CharacterId;
      sessionId: VisitSessionId;
    }
  | {
      kind: "CallingCardDeclined";
      tick: number;
      cardId: CallingCardId;
      callerCharacterId: CharacterId;
    }
  // Visit session lifecycle (drawing-room call opened by accepting a card).
  // Reuses conversationBus, matching the promenade-events precedent.
  | {
      kind: "VisitEntered";
      tick: number;
      houseId: HouseId;
      sessionId: VisitSessionId;
      callerCharacterId: CharacterId;
    }
  | {
      kind: "VisitExited";
      tick: number;
      houseId: HouseId;
      sessionId: VisitSessionId;
      callerCharacterId: CharacterId | null;
    };

export const conversationBus = new EventBus<ConversationEvent>();

// ── publishCharacterDeaths (P5 extraction) ────────────────────────────────
// Walks before/after character maps; for each character whose `alive` flipped
// from true to false (and is NOT the player's pre-tick head-of-house),
// publishes TargetCharacterDied on conversationBus. Called from:
//   - runYearPass store action (replacing the previously-inlined loop)
//   - every tick-advancing store action (advanceTick / travel / requestAudience
//     / escapeBankruptcy / refreshWardrobe) — at P5 the only tick-phase death
//     path is the Assassination resolver; the helper's heir-promotion guard
//     is trivially-satisfied for tick paths because tick-advancing actions
//     don't run succession.
//
// Heir-promotion safety: read playerHeadIdBefore from BEFORE so heir promotion
// (which flips the old head's alive=false during runYearPass's succession step)
// does NOT fire a stale TargetCharacterDied for the inherited identity.
export function publishCharacterDeaths(before: GameState, after: GameState): void {
  const playerHeadIdBefore = before.houses.get(PLAYER_HOUSE_ID)?.headOfHouseCharacterId;
  for (const [id, c] of after.characters) {
    const wasAlive = before.characters.get(id)?.alive ?? false;
    if (wasAlive && !c.alive && id !== playerHeadIdBefore) {
      conversationBus.publish({
        kind: "TargetCharacterDied",
        tick: after.tick,
        targetCharacterId: id,
      });
    }
  }
}

// ── publishCallingCardTransitions (P26) ───────────────────────────────────
// Diffs before/after callingCards. Emits CallingCardIssued for each card newly
// present-and-Pending in `after`, and CallingCardExpired for each card whose
// status flipped Pending → Expired (applyCallingCardPhase's expiry sweep).
// Rides every tick-advancing store wrapper EXCEPT runYearPass (year-pass STEPS
// has no applyCallingCardPhase, so the diff would emit zero events) — the
// P26 14/14/12 publisher set. Accepted/Declined are direct-published by their
// own wrappers, not diffed here.
export function publishCallingCardTransitions(before: GameState, after: GameState): void {
  for (const [id, card] of after.callingCards) {
    const prior = before.callingCards.get(id);
    if (prior === undefined && card.status === "Pending") {
      conversationBus.publish({
        kind: "CallingCardIssued",
        tick: after.tick,
        cardId: id,
        callerCharacterId: card.callerCharacterId,
      });
    } else if (prior?.status === "Pending" && card.status === "Expired") {
      conversationBus.publish({ kind: "CallingCardExpired", tick: after.tick, cardId: id });
    }
  }
}
