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
  type CharacterId,
  type HouseId,
  PLAYER_HOUSE_ID,
  type PromenadeSessionId,
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
