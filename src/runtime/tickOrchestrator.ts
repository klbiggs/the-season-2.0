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

import { applyForgerySurfacingPhase, applyThiefNoticePhase } from "../game/rules/artifacts";
import { applyCallingCardPhase } from "../game/rules/callingCards";
import { applyCourierAndStaffPhase } from "../game/rules/courier";
import { evaluateDynastyPerks } from "../game/rules/dynastyLegacies";
import { applyEconomyPhase } from "../game/rules/economy";
import { applyElopementAutoResolvePhase } from "../game/rules/elopement";
import { applyGlobalEventPhase } from "../game/rules/globalEvents";
import { applyHappinessPhase } from "../game/rules/happiness";
import { applyInheritedSecretSurfacingPhase } from "../game/rules/inheritedSecrets";
import { applyLocationEffectsPhase } from "../game/rules/locationEffects";
import { applyMoodDriftPhase } from "../game/rules/moods";
import { applyPatronessErosionPhase } from "../game/rules/patronesses";
import { applyRivalActionPhase } from "../game/rules/rivals";
import { applySchemeResolutionPhase } from "../game/rules/schemes";
import { applySiblingRivalActionPhase } from "../game/rules/siblingRivals";
import type { GameState } from "../game/store";

function advanceTickPhase(state: GameState): GameState {
  return { ...state, tick: state.tick + 1 };
}

// Exported at P3 so phaseOrderTracker.ts (test-only) can construct values of
// this type for the runOrchestratorWithPhases injection seam.
export type TickPhase = (state: GameState) => GameState;

// P13: identityPhase stub at slot 6 replaced with applyGlobalEventPhase
// (era flip + WarEffort/MarketCrash/MonarchsMood per-tick effects + expiry +
// 5%/tick trigger roll).
// P15: evaluateDynastyPerks appended as the terminal slot, AFTER the rival
// phase. "Rivals always run last" is refined to "last among RNG-CONSUMING
// phases" (CLAUDE.md amendment): evaluateDynastyPerks is RNG-free (a pure
// milestone read + award-list push), so following the rival phase cannot
// perturb the seeded draw stream.
// P24a: applyElopementAutoResolvePhase inserted at slot 6 (after scheme
// resolution — discovered Seductions mount sprints there; auto-resolve advances
// EXISTING non-player sprints). It is RNG-CONSUMING (one draw per unresolved
// non-player sprint per tick on the initiator-house stream) so it sits BEFORE
// the rival phase; its slot is fixed relative to mood drift which also draws
// per-house — the order is the determinism contract.
// P26: applyCallingCardPhase inserted at slot 8 (immediately AFTER
// applyGlobalEventPhase, before mood drift + rivals). PHASES count is 17. It is
// RNG-CONSUMING (one unconditional player-stream trigger draw per tick, plus
// one caller-pick draw on a live spawn) so it precedes the rival phase; its
// fixed position relative to the global-event roll (also a player-stream draw)
// is the determinism contract.
const PHASES: readonly TickPhase[] = [
  advanceTickPhase, // 1. time advance
  applyEconomyPhase, // 2. economy
  applyLocationEffectsPhase, // 3. location effects (NEW at P3)
  applyCourierAndStaffPhase, // 4. courier + verify + staff (NEW at P6)
  applySchemeResolutionPhase, // 5. scheme resolution (P5)
  applyElopementAutoResolvePhase, // 6. elopement auto-resolve — non-player sprints (NEW at P24a)
  applyGlobalEventPhase, // 7. global-event roll + era transition (NEW at P13; replaced P1 identityPhase stub)
  applyCallingCardPhase, // 8. calling-card roll — NPC-initiated (NEW at P26)
  applyMoodDriftPhase, // 9. mood drift
  applyHappinessPhase, // 10. happiness drift (NEW at P7)
  applyPatronessErosionPhase, // 11. patroness erosion (NEW at P8)
  applyForgerySurfacingPhase, // 12. forgery surfacing roll (NEW at P10)
  applyThiefNoticePhase, // 13. thief notice + auto-resolve (NEW at P10)
  applySiblingRivalActionPhase, // 14. sibling-rival action roll (NEW at P11)
  applyInheritedSecretSurfacingPhase, // 15. inherited-secret surfacing + blood-feud decay (NEW at P11)
  applyRivalActionPhase, // 16. rival-house action roll (NEW at P8 — last among RNG-consuming phases)
  evaluateDynastyPerks, // 17. dynasty-perk evaluation (NEW at P15 — RNG-free, so permitted after rivals)
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
