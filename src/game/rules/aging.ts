// Year-pass aging step. Increments age for living characters in lex
// characterId order; marks death when age >= deathAge after the increment.
// No PRNG draws — death is deterministic from the rolled deathAge.
//
// `>=` (not `===`) is robust against future migrations or trait-modifier paths
// that could momentarily produce age > deathAge.

import type { Character, GameState } from "../entities";

export function applyAgingStep(state: GameState): GameState {
  const sortedCharIds = [...state.characters.keys()].sort();
  const characters = new Map(state.characters);
  for (const charId of sortedCharIds) {
    const char = characters.get(charId);
    if (char === undefined || !char.alive) continue;
    const nextAge = char.age + 1;
    const dies = nextAge >= char.deathAge;
    const updated: Character = {
      ...char,
      age: nextAge,
      alive: !dies,
      diedAtTick: dies ? state.tick : char.diedAtTick,
    };
    characters.set(charId, updated);
  }
  return { ...state, characters };
}
