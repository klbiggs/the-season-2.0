// Year-pass aging step. Increments age for living characters in lex
// characterId order; marks death when age >= deathAge after the increment.
// No PRNG draws — death is deterministic from the rolled deathAge.
//
// `>=` (not `===`) is robust against future migrations or trait-modifier paths
// that could momentarily produce age > deathAge.
//
// P4: extended with conversation-history + affection-map orphan-prune. When
// an NPC dies (alive: true → false in this step), entries in
// state.conversationHistory and state.affectionMap keyed on that NPC's
// character ID are removed. Heir-promotion safety: the prune filters by
// parsePairKey(key).characterId (the TARGET half), NOT by houseId — so
// when the PLAYER head dies, conversation history and affection are
// preserved (heir inherits both via the pair-key's stable houseId half).

import { parsePairKey } from "../conversation/types";
import type { Character, GameState } from "../entities";

export function applyAgingStep(state: GameState): GameState {
  const sortedCharIds = [...state.characters.keys()].sort();
  const characters = new Map(state.characters);
  const newlyDead = new Set<string>();
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
    if (dies) newlyDead.add(charId);
  }

  // P4: orphan-prune of conversation history + affection map keyed on
  // newly-dead NPCs. Filter by the TARGET-character half of the pair key.
  // Pure rule discipline: return new Maps; never mutate inputs.
  let conversationHistory = state.conversationHistory;
  let affectionMap = state.affectionMap;
  if (newlyDead.size > 0) {
    const histFiltered = new Map(state.conversationHistory);
    for (const key of histFiltered.keys()) {
      if (newlyDead.has(parsePairKey(key).characterId)) histFiltered.delete(key);
    }
    const affFiltered = new Map(state.affectionMap);
    for (const key of affFiltered.keys()) {
      if (newlyDead.has(parsePairKey(key).characterId)) affFiltered.delete(key);
    }
    conversationHistory = histFiltered;
    affectionMap = affFiltered;
  }

  return { ...state, characters, conversationHistory, affectionMap };
}
