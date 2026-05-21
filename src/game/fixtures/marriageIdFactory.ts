// Deterministic MarriageId factory. Format:
//   `${lex-min(spouseA, spouseB)}:${lex-max(spouseA, spouseB)}:${tick}:${index}`
// where `index` counts existing marriages with the same `(spouseA, spouseB,
// tick)` tuple — at v1 always 0 (a same-tick re-proposal between the same
// pair is blocked by the PlayerAlreadyMarried + TargetAlreadyMarried gates),
// but the index slot keeps the factory robust to future redress flows.
//
// Lex-sort matches the spouseA/spouseB invariant on MarriageRecordSchema
// (entities.ts:113-114): spouseAId is the lex-smaller of the pair.
//
// Plan: plans/phases/07-family-succession.md "makeMarriageId factory".

import type { GameState } from "../entities";
import type { CharacterId, MarriageId } from "../rng";

export function makeMarriageId(state: GameState, a: CharacterId, b: CharacterId): MarriageId {
  const [lex0, lex1] = a < b ? [a, b] : [b, a];
  let index = 0;
  for (const m of state.marriages.values()) {
    if (m.spouseAId === lex0 && m.spouseBId === lex1 && m.marriedAtTick === state.tick) {
      index += 1;
    }
  }
  return `${lex0}:${lex1}:${state.tick}:${index}` as MarriageId;
}
