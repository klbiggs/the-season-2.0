// P26 calling-card tick phase (Q14 NPC-initiated conversations, calling-card
// shape). Pure rule; no UI/persistence/LLM/runtime/event imports. Composed into
// the tick PHASES chain at slot 8 (after applyGlobalEventPhase, before mood
// drift + rivals — RNG-consuming, so it must precede the rival phase).
//
// Determinism: consumes EXACTLY ONE player-rng draw per tick for the trigger
// roll (burn-on-all-outcomes per the P8/P13 cooldown precedent), plus one more
// draw ONLY on a live spawn (roll passes, no Pending card already exists, and
// the adult caller pool is non-empty). The LLM authors only the opener text
// later (via the store action); this phase is pure state.
//
// Plan: plans/phases/26-conversation-llm-depth.md G2 + Implementation ordering.

import {
  ADULTHOOD_AGE_IN_YEARS,
  CALLING_CARD_EXPIRY_TICKS,
  CALLING_CARD_PROBABILITY_BASIS_POINTS,
} from "../constants";
import type { CallingCard, GameState } from "../entities";
import { makeCallingCardId } from "../fixtures/callingCardIdFactory";
import { type CallingCardId, PLAYER_HOUSE_ID, drawInt, drawNext, getOrThrow } from "../rng";
import { eligiblePromenadePartners } from "./promenade";

// Adult, alive, non-player, non-rival caller pool in lex-sorted CharacterId
// order. Reuses eligiblePromenadePartners (character-id rival exclusion) and
// additionally filters to adults — a child leaving a drawing-room card breaks
// the social-call fiction. Married NPCs stay IN the pool deliberately (calls
// are social, not courtship-only). NOTE this diverges from the ballroom-approach
// pool (ballroomRoster, house-class exclusion) by design; see promenade.ts.
function callingCardCallerPool(state: GameState): ReturnType<typeof eligiblePromenadePartners> {
  return eligiblePromenadePartners(state).filter((id) => {
    const c = state.characters.get(id);
    return c !== undefined && c.age >= ADULTHOOD_AGE_IN_YEARS;
  });
}

export function applyCallingCardPhase(state: GameState): GameState {
  // (1) RNG-free expiry sweep: Pending cards past their absolute end-tick flip
  // to Expired (never-delete — status flip only). Lazy-clone on first mutation.
  let cards: Map<CallingCardId, CallingCard> = state.callingCards;
  let mutatedCards = false;
  for (const [id, card] of state.callingCards) {
    if (card.status === "Pending" && state.tick >= card.expiresAtTick) {
      if (!mutatedCards) {
        cards = new Map(state.callingCards);
        mutatedCards = true;
      }
      cards.set(id, { ...card, status: "Expired" });
    }
  }

  // (2) Unconditional trigger draw (burn-on-all-outcomes) on the player stream.
  const playerRng = getOrThrow(state.rng, PLAYER_HOUSE_ID);
  const { next: triggerRoll, rngState: r1 } = drawNext(playerRng);
  const rngAfterTrigger = new Map(state.rng).set(PLAYER_HOUSE_ID, r1);
  const committedCards = mutatedCards ? cards : state.callingCards;

  // No-spawn path: roll failed the threshold. Commit the trigger draw + any
  // expiry mutations and return.
  if (Math.floor(triggerRoll * 10000) >= CALLING_CARD_PROBABILITY_BASIS_POINTS) {
    return { ...state, rng: rngAfterTrigger, callingCards: committedCards };
  }

  // Roll passed. Outcome is DISCARDED (no second draw) when a Pending card
  // already exists (max 1 Pending) or the adult pool is empty. The trigger draw
  // is still committed either way.
  const hasPending = [...cards.values()].some((c) => c.status === "Pending");
  const pool = callingCardCallerPool(state);
  if (hasPending || pool.length === 0) {
    return { ...state, rng: rngAfterTrigger, callingCards: committedCards };
  }

  // Live spawn: second draw picks the caller (lex-sorted pool). Mint a Pending
  // card with an ABSOLUTE end-tick.
  const { next: callerIdx, rngState: r2 } = drawInt(r1, pool.length);
  const callerId = pool[callerIdx];
  if (callerId === undefined) {
    // noUncheckedIndexedAccess defense — drawInt range is [0, pool.length).
    throw new Error(`applyCallingCardPhase: drawInt returned out-of-range index ${callerIdx}`);
  }
  const newCards = mutatedCards ? cards : new Map(state.callingCards);
  const card: CallingCard = {
    id: makeCallingCardId({ ...state, callingCards: newCards }),
    callerCharacterId: callerId,
    issuedAtTick: state.tick,
    expiresAtTick: state.tick + CALLING_CARD_EXPIRY_TICKS,
    status: "Pending",
  };
  newCards.set(card.id, card);
  return {
    ...state,
    rng: new Map(state.rng).set(PLAYER_HOUSE_ID, r2),
    callingCards: newCards,
  };
}
