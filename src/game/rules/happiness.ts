// Per-tick happiness drift step. Inserted at tickOrchestrator PHASES slot 8
// between mood drift (slot 7) and the rival-action stub (slot 9 — always last
// per CLAUDE.md non-negotiable). Drains happiness on Dull-spouse exposure and
// flips the temptation latch (one-way) when happiness crosses below the
// HAPPINESS_TEMPTATION_THRESHOLD.
//
// Determinism budget: ZERO PRNG draws. Pure threshold check + per-character
// arithmetic. Replay-harness call-count assertions unchanged across P7.
//
// Plan: plans/phases/07-family-succession.md "Happiness drift step".

import { HAPPINESS_DULL_SPOUSE_DRAIN_PER_TICK, HAPPINESS_TEMPTATION_THRESHOLD } from "../constants";
import type { Character, GameState } from "../entities";
import type { TraitId } from "../rng";

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function applyHappinessPhase(state: GameState): GameState {
  // Lex-sort iteration per CLAUDE.md "Lex-sort iteration over identifier Maps".
  const sortedCharIds = [...state.characters.keys()].sort();
  let newChars = state.characters;
  let touched = false;

  for (const charId of sortedCharIds) {
    // Reads from state.characters (NOT newChars accumulator) because each
    // character's drain depends only on its OWN dullSpouseExposureStartTick
    // and its spouse's Dull trait — no cross-character iteration dependency.
    // If a future-phase happiness mutation introduces cross-character writes,
    // this read MUST migrate to newChars to observe prior iteration mutations.
    const c = state.characters.get(charId);
    if (c === undefined || !c.alive) continue;

    // Dull-spouse drain gate: exposure tick set AND active marriage AND spouse
    // still alive AND spouse carries Dull. The double-check (exposure tick +
    // live-Dull-spouse) protects against a stale exposure tick that survived
    // orphan-prune.
    let happinessAfter = c.happiness;
    if (c.dullSpouseExposureStartTick !== null && c.marriageId !== null) {
      const marriage = state.marriages.get(c.marriageId);
      if (marriage !== undefined && !marriage.dissolved) {
        const spouseId = marriage.spouseAId === c.id ? marriage.spouseBId : marriage.spouseAId;
        const spouse = state.characters.get(spouseId);
        if (spouse?.alive && spouse.traits.includes("Dull" as TraitId)) {
          happinessAfter = clamp(happinessAfter + HAPPINESS_DULL_SPOUSE_DRAIN_PER_TICK, 0, 100);
        }
      }
    }

    // Temptation latch: one-way flip false → true on first sub-threshold tick.
    // Predicate gates BOTH on happiness < threshold AND a non-null
    // dullSpouseExposureStartTick (so a Dull-spouse-less character whose
    // happiness somehow dropped doesn't get the latch). The latch never
    // re-fires once set — re-checking !latchAfter is the idempotence guard.
    let latchAfter = c.temptationHookUnlocked;
    if (
      !latchAfter &&
      happinessAfter < HAPPINESS_TEMPTATION_THRESHOLD &&
      c.dullSpouseExposureStartTick !== null
    ) {
      latchAfter = true;
    }

    if (happinessAfter !== c.happiness || latchAfter !== c.temptationHookUnlocked) {
      if (!touched) {
        newChars = new Map(state.characters);
        touched = true;
      }
      const updated: Character = {
        ...c,
        happiness: happinessAfter,
        temptationHookUnlocked: latchAfter,
      };
      newChars.set(charId, updated);
    }
  }

  if (!touched) return state;
  return { ...state, characters: newChars };
}
