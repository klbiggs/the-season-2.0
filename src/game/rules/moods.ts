// Mood drift step per spec §3 "Mood Transitions". 15% reroll per active
// non-locked character per tick from a weighted pool (Receptive 4 / Defensive
// 2 / Distracted 2 / Jealous 1). Grieving is narrative-only and never rolled.
// Locked characters skip BOTH the roll AND the draw — non-negotiable; a
// regression that draws-and-discards on locked characters silently shifts
// every other character's downstream draw by one.
//
// O(n log n) per-phase lex-sort cost (per house). At P1 negligible; revisit at
// P8 when character counts grow.

import { FAUX_PAS_LOCK_DURATION_IN_TICKS, MOOD_REROLL_PROBABILITY } from "../constants";
import type { GameState, House } from "../entities";
import { MOOD_POOL, MOOD_POOL_TOTAL_WEIGHT, type Mood } from "../fixtures/moods";
import { type RngState, drawInt, drawNext, getOrThrow } from "../rng";

// Pure helper. If currentTick < lockUntilTick, returns currentMood unchanged
// and DOES NOT advance rngState.callCount. Otherwise: 1 draw for the gate, +1
// draw on a hit for the pick.
export function rollMoodDrift(
  currentMood: Mood,
  rngState: RngState,
  currentTick: number,
  lockUntilTick: number,
): { mood: Mood; rngState: RngState } {
  if (currentTick < lockUntilTick) {
    return { mood: currentMood, rngState };
  }
  // Gate.
  const { next: gate, rngState: postGate } = drawNext(rngState);
  if (gate >= MOOD_REROLL_PROBABILITY) {
    return { mood: currentMood, rngState: postGate };
  }
  // Hit — single drawInt over MOOD_POOL_TOTAL_WEIGHT, then linear scan through
  // cumulative weights. Do NOT use pickItem(rngState, expandedPool); same
  // distribution, different draw count → replay-breaker.
  // CRITICAL: drawInt must chain off postGate, not rngState, or both draws
  // come from the same callCount position.
  const { next: pick, rngState: postPick } = drawInt(postGate, MOOD_POOL_TOTAL_WEIGHT);
  let acc = 0;
  for (const entry of MOOD_POOL) {
    acc += entry.weight;
    if (pick < acc) {
      return { mood: entry.mood, rngState: postPick };
    }
  }
  // Unreachable given pick ∈ [0, totalWeight); fallback to current mood.
  return { mood: currentMood, rngState: postPick };
}

// 5-tick lock per spec §3 "locks it for five ticks". P1 ships and unit-tests
// the helper; P4 conversation rules wire the faux-pas firing.
export function applyFauxPasLock(currentTick: number): number {
  return currentTick + FAUX_PAS_LOCK_DURATION_IN_TICKS;
}

// Phase entry. Houses-then-characters lex iteration. Single RngState
// write-back per house.
export function applyMoodDriftPhase(state: GameState): GameState {
  const sortedHouseIds = [...state.houses.keys()].sort();
  const rng = new Map(state.rng);
  const characters = new Map(state.characters);

  for (const houseId of sortedHouseIds) {
    let rngState = getOrThrow(state.rng, houseId);
    // Predicate: alive === true && currentTick >= moodLockUntilTick. Do NOT
    // filter on marriageId/role/archetype — would wrongly skip the seeded head
    // (marriageId: null) and make the replay harness consume zero draws.
    const charsInHouse = [...state.characters.values()].filter(
      (c) => c.houseId === houseId && c.alive,
    );
    const sortedCharIds = charsInHouse.map((c) => c.id).sort();
    for (const charId of sortedCharIds) {
      const char = characters.get(charId);
      if (char === undefined) continue;
      const { mood: nextMood, rngState: postRoll } = rollMoodDrift(
        char.mood,
        rngState,
        state.tick,
        char.moodLockUntilTick,
      );
      rngState = postRoll;
      if (nextMood !== char.mood) {
        characters.set(charId, { ...char, mood: nextMood });
      }
    }
    rng.set(houseId, rngState);
  }

  return { ...state, rng, characters };
}

// `House` re-exported for code that walks the house Map types; keeps the file
// self-documenting about its dependency surface.
export type { House };
