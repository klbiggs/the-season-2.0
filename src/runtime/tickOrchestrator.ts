// Tick orchestrator. Fixed phase order per spec §3 "Tick-Driven Time
// Advancement":
//   1. time advance (tick += 1)
//   2. economy (bankruptcy-tier deltas)
//   3. courier draining (P1 stub; no payloads exist)
//   4. scheme resolution (P1 stub; schemes ship in P5)
//   5. global-event roll (P1 stub; events ship in P13)
//   6. mood drift (15% reroll per active non-locked character)
//   7. rival-house action roll (P1 stub; rivals ship in P8)
//
// Each phase is a pure (GameState) => GameState function. The orchestrator
// composes via left-fold over a frozen ordered array. The stubs are real
// no-op exports — not inline lambdas — so later phases substitute by editing
// this import list, not by mutating a magic registry.
//
// `runYearPass` lives in ./yearPass.ts as a separate composer (not part of
// the tick phase chain). Year-pass and tick-advance are distinct triggers.

import { applyEconomyPhase } from "../game/rules/economy";
import { applyMoodDriftPhase } from "../game/rules/moods";
import type { GameState } from "../game/store";

function identityPhase(state: GameState): GameState {
  return state;
}

function advanceTickPhase(state: GameState): GameState {
  return { ...state, tick: state.tick + 1 };
}

type TickPhase = (state: GameState) => GameState;

const PHASES: readonly TickPhase[] = [
  advanceTickPhase, // 1. time advance
  applyEconomyPhase, // 2. economy
  identityPhase, // 3. courier draining (P1 stub)
  identityPhase, // 4. scheme resolution (P1 stub)
  identityPhase, // 5. global-event roll (P1 stub)
  applyMoodDriftPhase, // 6. mood drift
  identityPhase, // 7. rival-house action roll (P1 stub — ALWAYS last)
] as const;

export function advanceTickPure(state: GameState): GameState {
  return PHASES.reduce<GameState>((acc, phase) => phase(acc), state);
}
