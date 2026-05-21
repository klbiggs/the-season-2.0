// Wardrobe-refresh action (spec §3 "Wardrobe Decay & Pre-Ball Composure
// Penalty"). At P3 the action writes wardrobeLastRefreshTick; P10 reads it
// to compute the pre-ball composure penalty.
//
// §7 edge case ("Wardrobe refresh during bankruptcy"): NOT gated on wealth.
// Per spec, "the player must be warned but allowed to proceed (player
// agency takes precedence)." The warning is a UI concern; the rule layer
// always permits the action at Capital regardless of wealth.

import { WARDROBE_REFRESH_WEALTH_COST } from "../constants";
import type { GameState } from "../entities";
import type { LocationId } from "../fixtures/locations";
import type { HouseId } from "../rng";
import { getHouseOrThrow } from "../util/lookups";

export type WardrobeRejection =
  | { kind: "WrongLocation"; current: LocationId }
  | { kind: "PlayerExiled" } // P6 exile-gate variant
  | { kind: "ElopementInProgress" }; // P9 Q4

export class InvalidWardrobeError extends Error {
  constructor(reason: WardrobeRejection) {
    super(`applyWardrobeRefresh called against unvalidated state: ${reason.kind}`);
    this.name = "InvalidWardrobeError";
  }
}

export function canRefreshWardrobe(
  state: GameState,
  houseId: HouseId,
): { ok: true } | { ok: false; reason: WardrobeRejection } {
  const house = getHouseOrThrow(state, houseId);
  if (house.currentLocation !== "Capital") {
    return { ok: false, reason: { kind: "WrongLocation", current: house.currentLocation } };
  }
  return { ok: true };
}

export function applyWardrobeRefresh(state: GameState, houseId: HouseId): GameState {
  const check = canRefreshWardrobe(state, houseId);
  if (!check.ok) throw new InvalidWardrobeError(check.reason);
  const house = getHouseOrThrow(state, houseId);
  const houses = new Map(state.houses);
  houses.set(houseId, {
    ...house,
    wealth: house.wealth - WARDROBE_REFRESH_WEALTH_COST,
    wardrobeLastRefreshTick: state.tick,
  });
  return { ...state, houses };
}
