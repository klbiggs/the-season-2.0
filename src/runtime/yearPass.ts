// Year-pass composer. Runs the year-pass action atomically per spec §3 ("a
// separate 'pass year' action"). Composes:
//   1. Aging (applyAgingStep)
//   2. Succession (applySuccessionStep)
//   3. Conception (applyConceptionStep)
//
// Order matters:
//   - aging-before-succession: a head whose age+1 === deathAge must be marked
//     alive=false first so the same year-pass's succession can promote.
//   - succession-before-conception: a marriage whose head died this year-pass
//     must have its dissolved flag flipped (succession step 4) before
//     conception's `dissolved === false` filter evaluates.
//   - single-pass: no second-pass cascade re-evaluation. Death + heir-
//     promotion + same-year-pass-death-of-new-heir requires multiple
//     `runYearPass` invocations; within-year-pass cascading is a P1 limitation.
//
// `tick` is read-only across the composition — none of the three sub-steps
// mutate state.tick. The synthetic succession test depends on this.

import { applyAgingStep } from "../game/rules/aging";
import { applyConceptionStep } from "../game/rules/conception";
import { applyMaturationStep } from "../game/rules/maturation";
import { applySuccessionStep } from "../game/rules/succession";
import type { GameState } from "../game/store";

type YearPassStep = (state: GameState) => GameState;

// P7 inserts applyMaturationStep at slot 2 (between aging + succession).
// aging-before-maturation: aging increments age; maturation reads exact-18
// boundary. maturation-before-succession: succession's findAdultChildren now
// returns adult children (via parent edges); a child crossing 18 same year
// as their parent's death should be promotable.
const STEPS: readonly YearPassStep[] = [
  applyAgingStep,
  applyMaturationStep,
  applySuccessionStep,
  applyConceptionStep,
] as const;

export function runYearPassPure(state: GameState): GameState {
  return STEPS.reduce<GameState>((acc, step) => step(acc), state);
}
