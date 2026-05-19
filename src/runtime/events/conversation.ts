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
import type { LocationId } from "../../game/fixtures/locations";
import type { Mood } from "../../game/fixtures/moods";
import type { BallSessionId, CharacterId, HouseId } from "../../game/rng";
import { EventBus } from "./bus";

import type { ConversationFailure } from "../../game/conversation/types";
export type { ConversationFailure };

// Discriminated union returned by enterBallroom when validation fails.
// P4 only has the WrongLocation variant; P8 will add PatronessVeto.
export type BallEntryRejection = { kind: "WrongLocation"; current: LocationId };

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
    };

export const conversationBus = new EventBus<ConversationEvent>();
