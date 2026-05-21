// Tick orchestrator. Fixed phase order per spec §3 "Tick-Driven Time
// Advancement":
//   1. time advance (tick += 1)
//   2. economy (bankruptcy-tier deltas)
//   3. location effects (P3: per-tick deltas + trait acquisition rolls)
//   4. courier + verification + staff (P6: drain arriving couriers, verify
//      Unverified whispers, roll staff loyalty drift + bribery + cadence)
//   5. scheme resolution (P5)
//   6. global-event roll (P1 stub; events ship in P13)
//   7. mood drift (15% reroll per active non-locked character)
//   8. rival-house action roll (P1 stub; rivals ship in P8 — ALWAYS last)
//
// Each phase is a pure (GameState) => GameState function. The orchestrator
// composes via left-fold over a frozen ordered array. The stubs are real
// no-op exports — not inline lambdas — so later phases substitute by editing
// this import list, not by mutating a magic registry.
//
// `runYearPass` lives in ./yearPass.ts as a separate composer (not part of
// the tick phase chain). Year-pass and tick-advance are distinct triggers.

import { applyCourierAndStaffPhase } from "../game/rules/courier";
import { applyEconomyPhase } from "../game/rules/economy";
import { applyHappinessPhase } from "../game/rules/happiness";
import { applyLocationEffectsPhase } from "../game/rules/locationEffects";
import { applyMoodDriftPhase } from "../game/rules/moods";
import { applyPatronessErosionPhase } from "../game/rules/patronesses";
import { applyRivalActionPhase } from "../game/rules/rivals";
import { applySchemeResolutionPhase } from "../game/rules/schemes";
import type { GameState } from "../game/store";

function identityPhase(state: GameState): GameState {
  return state;
}

function advanceTickPhase(state: GameState): GameState {
  return { ...state, tick: state.tick + 1 };
}

// Exported at P3 so phaseOrderTracker.ts (test-only) can construct values of
// this type for the runOrchestratorWithPhases injection seam.
export type TickPhase = (state: GameState) => GameState;

// P8: PHASES grows 9→10. applyPatronessErosionPhase inserts at slot 9
// (between happiness drift and rival action — no PRNG draw, uses tick %
// size round-robin). applyRivalActionPhase REPLACES the slot-9 P1 identity
// stub (now slot 10, ALWAYS last per CLAUDE.md "Rivals always run last").
const PHASES: readonly TickPhase[] = [
  advanceTickPhase, // 1. time advance
  applyEconomyPhase, // 2. economy
  applyLocationEffectsPhase, // 3. location effects (NEW at P3)
  applyCourierAndStaffPhase, // 4. courier + verify + staff (NEW at P6)
  applySchemeResolutionPhase, // 5. scheme resolution (P5)
  identityPhase, // 6. global-event roll (P1 stub)
  applyMoodDriftPhase, // 7. mood drift
  applyHappinessPhase, // 8. happiness drift (NEW at P7)
  applyPatronessErosionPhase, // 9. patroness erosion (NEW at P8)
  applyRivalActionPhase, // 10. rival-house action roll (NEW at P8 — ALWAYS last)
] as const;

export function advanceTickPure(state: GameState): GameState {
  return PHASES.reduce<GameState>((acc, phase) => phase(acc), state);
}

// Test-only: runs the same reduce-over-phases composition as advanceTickPure,
// but with a caller-supplied phases array. Production callers MUST use
// advanceTickPure (which reads the module-private PHASES constant); this
// export is for ordering tests that need to override or instrument the phase
// list (e.g., the §7 audience-before-rival ordering test in
// monarchsAudience.test.ts via phaseOrderTracker).
//
// Why not export `PHASES` directly: the CLAUDE.md "frozen PHASES" non-
// negotiable says the array is the determinism contract; exporting it would
// let a future consumer mutate the iteration order at runtime. Exporting a
// function that consumes a caller-supplied array preserves the contract.
export function runOrchestratorWithPhases(
  state: GameState,
  phases: readonly TickPhase[],
): GameState {
  return phases.reduce<GameState>((acc, phase) => phase(acc), state);
}
