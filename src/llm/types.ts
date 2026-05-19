// LLM-layer canonical types. Defines ConversationRequest /
// ConversationResponse (narrowed) / ConversationResponseRaw (Zod-parsed,
// widened-enum form) plus the post-parse resolver helpers.
//
// Plan: plans/phases/04-ballroom-llm.md "Canonical types table".

import { z } from "zod";
import {
  QUALITY_MULTIPLIER_CEIL,
  QUALITY_MULTIPLIER_FLOOR,
  type Stance,
  type Tactic,
} from "../game/constants";
import type { MODEL_DEFAULT, MODEL_FIRST_MEETING } from "../game/constants";
import type { Mood } from "../game/fixtures/moods";
import { MOODS } from "../game/fixtures/moods";

// Re-export the shared conversation types so llm/** consumers have a single
// import surface. Brand types (CharacterId, HouseId) also re-export so
// llm/** reaches them WITHOUT importing game/rng directly (forbidden by
// the eslint rule).
export {
  ConversationPairKeySchema,
  type ConversationPairKey,
  type Speaker,
  ExchangeSchema,
  type Exchange,
  makePairKey,
  parsePairKey,
  type CharacterId,
  type HouseId,
  type ConversationFailure,
} from "../game/conversation/types";

export type Model = typeof MODEL_DEFAULT | typeof MODEL_FIRST_MEETING;

export type ConversationRequest = {
  targetCharacterId: import("../game/conversation/types").CharacterId;
  playerHouseId: import("../game/conversation/types").HouseId;
  pinnedIntent: Tactic | null;
  freeformMessage: string;
  history: ReadonlyArray<import("../game/conversation/types").Exchange>;
  persona: string;
  // Gemini cache resource name from caches.create; null means cache-miss
  // (or first-call, or registry-create failure) → use persona directly.
  cacheName: string | null;
  model: Model;
};

// Widen-and-validate: enum fields parsed as z.string() so unknown values
// don't trigger SchemaError. Post-parse resolvers (resolveTactic /
// resolveMoodHint) apply the enum check + fallback per spec §7 line 664
// "clamp out-of-range fields defensively rather than erroring."
export const ConversationResponseSchema = z.object({
  dialogue: z.string().min(1),
  classifiedTactic: z.string(),
  qualityMultiplier: z.number(),
  moodHint: z.string().optional(),
  toolCalls: z.array(z.never()).default([]),
});
export type ConversationResponseRaw = z.infer<typeof ConversationResponseSchema>;

// Narrowed form — what the orchestrator returns after resolver application.
export type ConversationResponse = {
  dialogue: string;
  classifiedTactic: Tactic;
  qualityMultiplier: number; // clamped to [0.5, 1.5]
  moodHint: Mood | null;
  toolCalls: never[];
};

const TACTIC_SET = new Set<string>(["Flattery", "WittyBanter", "SlyGossip", "DeepEmpathy"]);

// resolveTactic: PIN ALWAYS OVERRIDES. If pinned is non-null, return pinned
// (regardless of whether received is a valid enum). If pinned is null, use
// received when it's a valid enum, else fall back to "Flattery".
//
// Spec §3 line 70 is the authoritative reading: "A pinned explicit intent
// overrides any classification the language model produces." Line 312's
// "fall back to pinned" wording is the defensive edge case for when the
// model returns garbage AND no pin is set.
//
// Why pin-overrides: the pin is the player's explicit declaration of
// intent. Different tactics route to different bonus/penalty trait maps,
// so the choice of tactic changes the combat math. If the model could
// always win the tactic-choice argument, the pin button would be
// mechanically a no-op in the common case (models return valid enum >99%).
export function resolveTactic(received: string, pinned: Tactic | null): Tactic {
  if (pinned !== null) return pinned;
  if (TACTIC_SET.has(received)) return received as Tactic;
  return "Flattery";
}

const MOOD_SET = new Set<string>(MOODS);

// resolveMoodHint: returns received if valid enum, else null (drop-if-invalid).
// Pure assignment when consumer applies — no PRNG draws.
export function resolveMoodHint(received: string | undefined): Mood | null {
  if (received === undefined) return null;
  if (MOOD_SET.has(received)) return received as Mood;
  return null;
}

// Composes resolveTactic + resolveMoodHint + qualityMultiplier clamp.
// Produces the narrowed ConversationResponse shape consumed by the
// store-action's combat resolution.
export function narrowResponse(
  raw: ConversationResponseRaw,
  pinnedIntent: Tactic | null,
): ConversationResponse {
  const qualityMultiplier = Math.max(
    QUALITY_MULTIPLIER_FLOOR,
    Math.min(QUALITY_MULTIPLIER_CEIL, raw.qualityMultiplier),
  );
  return {
    dialogue: raw.dialogue,
    classifiedTactic: resolveTactic(raw.classifiedTactic, pinnedIntent),
    qualityMultiplier,
    moodHint: resolveMoodHint(raw.moodHint),
    toolCalls: raw.toolCalls as never[],
  };
}

// Re-export so consumers can build BallroomMessageInput shapes without
// importing constants directly.
export type { Stance, Tactic };
