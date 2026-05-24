// Pure transit-table lookup. Symmetric pair canonicalized via lex-key. The
// table itself lives in fixtures/locations.ts.
//
// P1 shipped only the transit-time lookup; P6 adds the orchestrator-phase
// composer applyCourierAndStaffPhase that drains arriving couriers,
// progresses whisper verification, and runs the staff outputs phase.

import { WHISPERS_PERK_INBOUND_INTERCEPT_PROBABILITY } from "../constants";
import type { GameState } from "../entities";
import { type LocationId, TRANSIT_PAIRS } from "../fixtures/locations";
import { type HouseId, PLAYER_HOUSE_ID, drawNext, getOrThrow } from "../rng";
import { UnknownLocationPairError } from "../util/errors";
import { hasDynastyPerk } from "./dynastyLegacies";
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

// P13: signature widened from (from, to) to (state, originatorHouseId, from, to)
// to read the per-house courierResearchEarned flag. When the originator has
// the Later-era research action applied, transit halves with floor 1.
// Only NEW couriers are halved; in-flight couriers retain their absolute
// arrivalTick per CLAUDE.md non-negotiable §2.
//
// Sole non-test caller is whispers.ts:generateWhisperCourier (verified via
// `grep -n 'transitTicks(' src/`). The function currently hardcodes
// `originHouseId: PLAYER_HOUSE_ID` so at v1 only the player benefits from
// the halving (rivals don't have a UI affordance for the research action).
export function transitTicks(
  state: GameState,
  originatorHouseId: HouseId,
  from: LocationId,
  to: LocationId,
): number {
  if (from === to) return 0;
  const base = TRANSIT_TABLE.get(canonicalKey(from, to));
  if (base === undefined) throw new UnknownLocationPairError(from, to);
  const originator = state.houses.get(originatorHouseId);
  if (originator?.courierResearchEarned) {
    return Math.max(1, Math.ceil(base * 0.5));
  }
  return base;
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
  // P15: the Whispers perk's inbound-intercept step runs BETWEEN verify and
  // drain — after verify (per the ordering rationale above), before drain so an
  // intercepted courier never delivers this tick. Gated: zero draws + input
  // unchanged when the player doesn't hold the perk.
  const afterIntercept = applyWhispersPerkInterceptStep(afterVerify);
  const afterDrain = applyCourierDrainStep(afterIntercept);
  return applyStaffOutputsPhase(afterDrain);
}

// P15: Whispers-perk inbound-intercept (plan D5). Auto-intercepts InFlight
// inbound interceptable couriers destined for the player house whose carried
// whisper's SUBJECT resolves to a player-house character (whispers ABOUT the
// player). The subject clause is load-bearing — without it the intercept would
// also grab the player's own returning intel. One conditional player-RNG draw
// per matching courier (P10 forgery-roll precedent; NOT P13's unconditional
// per-tick draw). Returns input unchanged with ZERO draws when the perk is not
// held. Mirrors trySpymasterMailIntercept's 4-predicate filter + courier-only
// write (the whisper is NOT mutated; an intercepted courier never drains so
// arrivedAtTick stays null naturally).
export function applyWhispersPerkInterceptStep(state: GameState): GameState {
  if (!hasDynastyPerk(state, "Whispers")) return state;
  let rngState = getOrThrow(state.rng, PLAYER_HOUSE_ID);
  let rngMutated = false;
  let mutated = false;
  const newCouriers = new Map(state.couriers);
  const sortedIds = [...newCouriers.keys()].sort();
  for (const id of sortedIds) {
    // biome-ignore lint/style/noNonNullAssertion: id from keys() always present
    const c = newCouriers.get(id)!;
    if (
      c.status !== "InFlight" ||
      c.direction !== "Inbound" ||
      !c.interceptable ||
      c.destinationHouseId !== PLAYER_HOUSE_ID
    ) {
      continue;
    }
    // Subject-resolve two-hop: courier → whisper → subject character → house.
    const subjectId = state.whispers.get(c.whisperId)?.subjectCharacterId;
    if (subjectId === undefined) continue;
    if (state.characters.get(subjectId)?.houseId !== PLAYER_HOUSE_ID) continue;
    // One conditional draw per matching courier.
    const { next, rngState: post } = drawNext(rngState);
    rngState = post;
    rngMutated = true;
    if (next < WHISPERS_PERK_INBOUND_INTERCEPT_PROBABILITY) {
      newCouriers.set(id, { ...c, status: "Intercepted", resolvedAtTick: state.tick });
      mutated = true;
    }
  }
  if (!rngMutated) return state;
  const rng = new Map(state.rng);
  rng.set(PLAYER_HOUSE_ID, rngState);
  return mutated ? { ...state, couriers: newCouriers, rng } : { ...state, rng };
}
