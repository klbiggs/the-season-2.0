// Travel action: pure validator + pure mutator. The orchestrator/store
// wrapper composes canTravel → applyTravel → advanceTickPure (the
// pre-tick action pattern, CLAUDE.md P3 convention).
//
// Travel itself has no wealth cost; the cost is the consumed tick. The
// destination's LOCATION_DELTAS apply during the post-travel tick (first-
// tick-at-destination semantics).

import type { GameState } from "../entities";
import type { LocationId } from "../fixtures/locations";
import type { HouseId } from "../rng";
import { getHouseOrThrow } from "../util/lookups";

export type TravelRejection =
  | { kind: "SameLocation"; current: LocationId }
  | { kind: "EraBlockaded"; era: "Earlier"; target: LocationId }
  | { kind: "PlayerExiled" }; // P6 exile-gate variant — store wrapper rejects

export class InvalidTravelError extends Error {
  constructor(reason: TravelRejection) {
    super(`applyTravel called against unvalidated state: ${reason.kind}`);
    this.name = "InvalidTravelError";
  }
}

export function canTravel(
  state: GameState,
  houseId: HouseId,
  to: LocationId,
): { ok: true } | { ok: false; reason: TravelRejection } {
  const house = getHouseOrThrow(state, houseId);
  if (house.currentLocation === to) {
    return { ok: false, reason: { kind: "SameLocation", current: house.currentLocation } };
  }
  // ForeignCapital is era-gated during the Earlier (wartime) era unless the
  // house has earned a Smuggling bypass (P5 sets blockadeBypassEarned; at P3
  // it's always false, so ForeignCapital is always blockaded at P3).
  if (to === "ForeignCapital" && state.era === "Earlier" && !house.blockadeBypassEarned) {
    return { ok: false, reason: { kind: "EraBlockaded", era: "Earlier", target: to } };
  }
  return { ok: true };
}

export function applyTravel(state: GameState, houseId: HouseId, to: LocationId): GameState {
  const check = canTravel(state, houseId, to);
  if (!check.ok) throw new InvalidTravelError(check.reason);
  const house = getHouseOrThrow(state, houseId);
  // P5: consume the blockade-bypass flag when traveling to ForeignCapital in
  // the Earlier era with the flag set. Spec lines 357 + 360: "one-shot"
  // bypass + "cannot start if previous Smuggling pass is still unclaimed" —
  // the "unclaimed" framing implies the flag is consumed at the claim point
  // (traveling to ForeignCapital). In the Later era the flag is irrelevant
  // (blockade no longer active); the flag stays put.
  const shouldConsumeBypass =
    to === "ForeignCapital" && state.era === "Earlier" && house.blockadeBypassEarned;
  const houses = new Map(state.houses);
  houses.set(houseId, {
    ...house,
    currentLocation: to,
    // Reset on every travel — destination is a new location, counter starts
    // over. The post-travel tick's location-effects phase increments to 1.
    consecutiveTicksAtCurrentLocation: 0,
    blockadeBypassEarned: shouldConsumeBypass ? false : house.blockadeBypassEarned,
  });
  return { ...state, houses };
}
