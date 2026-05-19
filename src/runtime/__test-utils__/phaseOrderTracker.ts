// Test-only phase-order tracker. Used by monarchsAudience.test.ts (and
// future tests) to assert that orchestrator phases fire in the expected
// order, via runOrchestratorWithPhases.
//
// Lives under src/runtime/__test-utils__/ (NOT src/game/rules/__test-utils__/)
// because the tracker imports TickPhase from runtime-tick-orchestrator; the
// game-rules element disallows that import. runtime → runtime-tick-orchestrator
// is default-allow.

import type { GameState } from "../../game/store";
import type { TickPhase } from "../tickOrchestrator";

export type PhaseOrderTracker = {
  trace: string[];
  // Returns a phase that pushes `label` to trace and returns state unchanged.
  trackedPhase(label: string): TickPhase;
};

export function createPhaseOrderTracker(): PhaseOrderTracker {
  const trace: string[] = [];
  return {
    trace,
    trackedPhase(label: string): TickPhase {
      return (state: GameState): GameState => {
        trace.push(label);
        return state;
      };
    },
  };
}
