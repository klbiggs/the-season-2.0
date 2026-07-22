// P26: deterministic CallingCardId factory. Format `card-<i>` where `i` is the
// current registry size. Cards are NEVER deleted (status flips only), so
// state.callingCards.size is monotonic and the id is stable and collision-free.
// Draw-free (no RNG consumption) — mirrors the makeStaffId state-walk factory.
//
// Plan: plans/phases/26-conversation-llm-depth.md G2.

import type { GameState } from "../entities";
import type { CallingCardId } from "../rng";

export function makeCallingCardId(state: GameState): CallingCardId {
  return `card-${state.callingCards.size}` as CallingCardId;
}
