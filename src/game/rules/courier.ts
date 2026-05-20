// Pure transit-table lookup. Symmetric pair canonicalized via lex-key. The
// table itself lives in fixtures/locations.ts.
//
// P1 shipped only the transit-time lookup; P6 adds the orchestrator-phase
// composer applyCourierAndStaffPhase that drains arriving couriers,
// progresses whisper verification, and runs the staff outputs phase.

import type { GameState } from "../entities";
import { type LocationId, TRANSIT_PAIRS } from "../fixtures/locations";
import { UnknownLocationPairError } from "../util/errors";
import { applyStaffOutputsPhase } from "./staff";
import { applyCourierDrainStep, applyWhisperVerificationPhase } from "./whispers";

function canonicalKey(a: LocationId, b: LocationId): string {
  return a <= b ? `${a}|${b}` : `${b}|${a}`;
}

const TRANSIT_TABLE: ReadonlyMap<string, number> = (() => {
  const m = new Map<string, number>();
  for (const [a, b, ticks] of TRANSIT_PAIRS) {
    m.set(canonicalKey(a, b), ticks);
  }
  return m;
})();

export function transitTicks(from: LocationId, to: LocationId): number {
  if (from === to) return 0;
  const ticks = TRANSIT_TABLE.get(canonicalKey(from, to));
  if (ticks === undefined) throw new UnknownLocationPairError(from, to);
  return ticks;
}

// P6: orchestrator phase at PHASES slot 4 (replaces P1 identityPhase stub).
// Composes three sub-steps in fixed order:
//   (1) verify-progress: increment Unverified whispers that have arrived.
//   (2) courier drain: flip arriving InFlight couriers to Delivered AND
//       set their carried whispers' arrivedAtTick to state.tick.
//   (3) staff outputs: loyalty drift, bribery roll (Greedy + sub-threshold
//       only), per-cadence outputs per assignment.
//
// Inner ordering rationale (load-bearing):
//   - Verify FIRST so the new payloads we drain THIS tick don't get
//     verification credit on the tick they arrive (semantically wrong —
//     verification is "time spent at the player's home", not "ticks since
//     origination").
//   - Drain SECOND so newly-arrived whispers populate the ledger before
//     staff might generate new ones.
//   - Staff THIRD so cadence outputs read the post-drain whispers Map.
export function applyCourierAndStaffPhase(state: GameState): GameState {
  const afterVerify = applyWhisperVerificationPhase(state);
  const afterDrain = applyCourierDrainStep(afterVerify);
  return applyStaffOutputsPhase(afterDrain);
}
