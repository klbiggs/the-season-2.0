// Year-pass aging step. Increments age for living characters in lex
// characterId order; marks death when age >= deathAge after the increment.
// No PRNG draws — death is deterministic from the rolled deathAge.
//
// `>=` (not `===`) is robust against future migrations or trait-modifier paths
// that could momentarily produce age > deathAge.
//
// P4 + P5: conversation-history + affection-map orphan-prune is extracted
// into pruneOrphanedConversationKeys (below) so both year-pass deaths (from
// applyAgingStep) and tick-phase deaths (from P5's Assassination resolver)
// share a single source of truth for the cascade.

import { parsePairKey } from "../conversation/types";
import type { Character, GameState } from "../entities";
import type { CharacterId } from "../rng";

// === VERBATIM MIGRATION of the heir-promotion safety block from
// applyAgingStep's top-of-function comment (aging.ts:8-14 pre-P5). The
// invariant moves with the body; the original 7-line comment is preserved
// word-for-word so future maintainers reading the helper see the same
// rationale that drove the original P4 design: ===
//
// P4: extended with conversation-history + affection-map orphan-prune. When
// an NPC dies (alive: true → false in this step), entries in
// state.conversationHistory and state.affectionMap keyed on that NPC's
// character ID are removed. Heir-promotion safety: the prune filters by
// parsePairKey(key).characterId (the TARGET half), NOT by houseId — so
// when the PLAYER head dies, conversation history and affection are
// preserved (heir inherits both via the pair-key's stable houseId half).
//
// === END VERBATIM MIGRATION. P5 additions below (NOT in the original): ===
//
// Pure rule; never mutates inputs. Future "simplifications" of the filter
// shape break heir succession — this comment block is load-bearing.
//
// P5: ALSO called from src/game/rules/schemes.ts on Assassination completion
// (the first tick-phase death path). The helper is identical between the two
// callers; the only difference is whether `newlyDeadCharIds` arrives from the
// year-pass aging loop or from a single Assassination kill.
export function pruneOrphanedConversationKeys(
  state: GameState,
  newlyDeadCharIds: ReadonlySet<CharacterId>,
): GameState {
  if (newlyDeadCharIds.size === 0) return state;
  const histFiltered = new Map(state.conversationHistory);
  for (const key of histFiltered.keys()) {
    if (newlyDeadCharIds.has(parsePairKey(key).characterId)) histFiltered.delete(key);
  }
  const affFiltered = new Map(state.affectionMap);
  for (const key of affFiltered.keys()) {
    if (newlyDeadCharIds.has(parsePairKey(key).characterId)) affFiltered.delete(key);
  }
  return { ...state, conversationHistory: histFiltered, affectionMap: affFiltered };
}

export function applyAgingStep(state: GameState): GameState {
  const sortedCharIds = [...state.characters.keys()].sort();
  const characters = new Map(state.characters);
  // P5: narrowed to ReadonlySet<CharacterId> (was Set<string>). state.characters
  // is Map<CharacterId, Character>, so its .keys() yields CharacterId values
  // already — the narrowed Set typechecks without `as CharacterId` casts.
  const newlyDead = new Set<CharacterId>();
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

  // Delegate orphan-prune to the shared helper. Passing { ...state, characters }
  // forwards the already-aged characters Map; the helper owns the
  // conversationHistory/affectionMap synthesis and returns the full new state.
  return pruneOrphanedConversationKeys({ ...state, characters }, newlyDead);
}
