// Bankruptcy escape valve (spec §3 "Economy & Bankruptcy"): liquidate
// heirlooms at the rural estate while wealth is negative. Applies
// +50 wealth and +5 scandal. Pure validator + pure mutator.

import { BANKRUPTCY_ESCAPE_SCANDAL_COST, BANKRUPTCY_ESCAPE_WEALTH_GAIN } from "../constants";
import type { GameState } from "../entities";
import type { LocationId } from "../fixtures/locations";
import type { HouseId } from "../rng";
import { getHouseOrThrow } from "../util/lookups";

export type EscapeRejection =
  | { kind: "WrongLocation"; current: LocationId }
  | { kind: "NotInsolvent"; wealth: number }
  | { kind: "PlayerExiled" }; // P6 exile-gate variant

export class InvalidEscapeError extends Error {
  constructor(reason: EscapeRejection) {
    super(`applyBankruptcyEscape called against unvalidated state: ${reason.kind}`);
    this.name = "InvalidEscapeError";
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function canEscapeBankruptcy(
  state: GameState,
  houseId: HouseId,
): { ok: true } | { ok: false; reason: EscapeRejection } {
  const house = getHouseOrThrow(state, houseId);
  if (house.currentLocation !== "Country") {
    return { ok: false, reason: { kind: "WrongLocation", current: house.currentLocation } };
  }
  if (house.wealth >= 0) {
    return { ok: false, reason: { kind: "NotInsolvent", wealth: house.wealth } };
  }
  return { ok: true };
}

export function applyBankruptcyEscape(state: GameState, houseId: HouseId): GameState {
  const check = canEscapeBankruptcy(state, houseId);
  if (!check.ok) throw new InvalidEscapeError(check.reason);
  const house = getHouseOrThrow(state, houseId);
  const houses = new Map(state.houses);
  houses.set(houseId, {
    ...house,
    wealth: house.wealth + BANKRUPTCY_ESCAPE_WEALTH_GAIN,
    scandal: clamp(house.scandal + BANKRUPTCY_ESCAPE_SCANDAL_COST, 0, 100),
  });
  return { ...state, houses };
}
