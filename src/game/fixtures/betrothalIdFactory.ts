// Deterministic BetrothalId factory. Format:
//   `${lex-min(a, b)}:${lex-max(a, b)}:${tick}:${index}`
// where `index` counts existing betrothals with the same `(partyA, partyB,
// tick)` tuple — robust to a future re-arrange between the same pair. Lex-sort
// matches the partyAId/partyBId invariant on BetrothalSchema (partyAId is the
// lex-smaller of the pair), mirroring makeMarriageId.
//
// Plan: plans/phases/23-marriage-family-depth.md item B.

import type { GameState } from "../entities";
import type { BetrothalId, CharacterId } from "../rng";

export function makeBetrothalId(state: GameState, a: CharacterId, b: CharacterId): BetrothalId {
  const [lex0, lex1] = a < b ? [a, b] : [b, a];
  let index = 0;
  for (const x of state.betrothals.values()) {
    if (x.partyAId === lex0 && x.partyBId === lex1 && x.arrangedAtTick === state.tick) {
      index += 1;
    }
  }
  return `${lex0}:${lex1}:${state.tick}:${index}` as BetrothalId;
}
