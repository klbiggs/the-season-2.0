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

import type { CharacterId, HouseId } from "../game/rng";
import { applyAgingStep } from "../game/rules/aging";
import { applyConceptionStep } from "../game/rules/conception";
import { evaluateDynastyPerks } from "../game/rules/dynastyLegacies";
import { applyMaturationStep } from "../game/rules/maturation";
import { buildSiblingRivalPromotionStep } from "../game/rules/siblingRivals";
import { applySocietyReplenishmentStep } from "../game/rules/societyReplenishment";
import { applySuccessionStep } from "../game/rules/succession";
import type { GameState } from "../game/store";

type YearPassStep = (state: GameState) => GameState;

// P11: STEPS grows 4→5. applySiblingRivalPromotionStep inserts at slot 4
// (between succession and conception). The step is built per-call via a
// closure factory that captures the pre-succession head ids, so the promotion
// body can identify "who was the dead head" after succession overwrites
// house.headOfHouseCharacterId.
//
// Order constraints:
//   - aging-before-maturation: aging increments age; maturation reads exact-18 boundary.
//   - maturation-before-succession: children crossing 18 in the same year as
//     parent's death become promotable.
//   - succession-before-promotion (NEW at P11): promotion needs the new heir id
//     (post-succession house.headOfHouseCharacterId).
//   - promotion-before-conception (NEW at P11): no actual ordering dependency,
//     but slot 4 keeps STEPS append-only per CLAUDE.md.
//   - replenishment-after-aging (NEW at P22): a society NPC who died this pass
//     (aging marks alive=false) must lower the floor count the SAME pass.
//     Placed at the penultimate slot — it consumes RNG (state.rng[independent]),
//     so it must precede the RNG-free evaluateDynastyPerks terminal step.

export function runYearPassPure(state: GameState): GameState {
  // P11: capture per-house head ids BEFORE STEPS run. The promotion step
  // closes over this snapshot to identify dead-head vs new-heir.
  const preSuccessionHeads: ReadonlyMap<HouseId, CharacterId> = new Map(
    [...state.houses].map(([id, h]) => [id, h.headOfHouseCharacterId]),
  );
  const STEPS: readonly YearPassStep[] = [
    applyAgingStep,
    applyMaturationStep,
    applySuccessionStep,
    buildSiblingRivalPromotionStep(preSuccessionHeads),
    applyConceptionStep,
    // P22 slot 6: top up the procedural society cohort (RNG-consuming; uses the
    // Independent rng stream). Must precede the RNG-free terminal eval below.
    applySocietyReplenishmentStep,
    // P15 terminal slot: dynasty-perk evaluation against fully post-succession
    // state (§7 "succession-driven perks must compute against post-succession
    // state"). RNG-free; same function as PHASES slot 15 (one function, two
    // terminal slots), so it may follow the RNG-consuming replenishment step.
    evaluateDynastyPerks,
  ];
  return STEPS.reduce<GameState>((acc, step) => step(acc), state);
}
