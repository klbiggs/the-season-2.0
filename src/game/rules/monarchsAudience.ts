// Monarch's audience action (spec §3 "Monarch's-Audience Resolution"). Pure
// validator + pure resolver. Outcome keyed off PRE-COST reputation; cost
// (-50 wealth, -10 reputation) paid only on partial/full success;
// lastAudienceTick set only on partial/full (denial paths cost nothing and
// don't lock the cooldown).
//
// §7 edge case: hostility drop on FullSuccess fires here, BEFORE the
// rival-action phase (always last in the orchestrator). At P3 patronesses
// and rivals are stub no-op loops; P8 fills in real effects.

import {
  MONARCH_AUDIENCE_COOLDOWN_TICKS,
  MONARCH_AUDIENCE_FULL_SUCCESS_THRESHOLD,
  MONARCH_AUDIENCE_PARTIAL_SCANDAL_DELTA,
  MONARCH_AUDIENCE_PATRONESS_BONUS,
  MONARCH_AUDIENCE_REPUTATION_COST,
  MONARCH_AUDIENCE_REPUTATION_THRESHOLD,
  MONARCH_AUDIENCE_RIVAL_HOSTILITY_DROP,
  MONARCH_AUDIENCE_WEALTH_COST,
} from "../constants";
import type { GameState } from "../entities";
import type { LocationId } from "../fixtures/locations";
import type { HouseId } from "../rng";
import { getHouseOrThrow } from "../util/lookups";

export type AudienceRejection =
  | { kind: "WrongLocation"; current: LocationId }
  | { kind: "InsufficientReputation"; reputation: number; required: number }
  | { kind: "CooldownActive"; lastAttemptTick: number; ticksUntilAvailable: number }
  // P6: exile-gate variant. requestAudience returns
  // { outcome: { kind: "Denied", reason: { kind: "PlayerExiled" } } }
  // when the player house is exiled (Scandal Sheet attribution endgame).
  | { kind: "PlayerExiled" };

export type AudienceOutcome =
  | { kind: "Denied"; reason: AudienceRejection }
  | { kind: "Partial"; preCostReputation: number }
  | { kind: "FullSuccess"; preCostReputation: number };

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function canRequestAudience(
  state: GameState,
  houseId: HouseId,
): { ok: true } | { ok: false; reason: AudienceRejection } {
  const house = getHouseOrThrow(state, houseId);
  if (house.currentLocation !== "Capital") {
    return { ok: false, reason: { kind: "WrongLocation", current: house.currentLocation } };
  }
  if (house.reputation < MONARCH_AUDIENCE_REPUTATION_THRESHOLD) {
    return {
      ok: false,
      reason: {
        kind: "InsufficientReputation",
        reputation: house.reputation,
        required: MONARCH_AUDIENCE_REPUTATION_THRESHOLD,
      },
    };
  }
  if (house.lastAudienceTick !== null) {
    const elapsed = state.tick - house.lastAudienceTick;
    if (elapsed < MONARCH_AUDIENCE_COOLDOWN_TICKS) {
      return {
        ok: false,
        reason: {
          kind: "CooldownActive",
          lastAttemptTick: house.lastAudienceTick,
          ticksUntilAvailable: MONARCH_AUDIENCE_COOLDOWN_TICKS - elapsed,
        },
      };
    }
  }
  return { ok: true };
}

export function applyAudience(
  state: GameState,
  houseId: HouseId,
): { state: GameState; outcome: AudienceOutcome } {
  const check = canRequestAudience(state, houseId);
  if (!check.ok) {
    return { state, outcome: { kind: "Denied", reason: check.reason } };
  }
  const house = getHouseOrThrow(state, houseId);
  const preCostReputation = house.reputation;
  const isFullSuccess = preCostReputation >= MONARCH_AUDIENCE_FULL_SUCCESS_THRESHOLD;

  // Cost paid only on partial/full (both branches deduct the same).
  const wealth = house.wealth - MONARCH_AUDIENCE_WEALTH_COST;
  const reputation = clamp(house.reputation - MONARCH_AUDIENCE_REPUTATION_COST, 0, 100);
  let scandal = house.scandal;

  if (isFullSuccess) {
    // Scandal wiped to zero.
    scandal = 0;
  } else {
    scandal = clamp(scandal + MONARCH_AUDIENCE_PARTIAL_SCANDAL_DELTA, 0, 100);
  }

  const houses = new Map(state.houses);
  houses.set(houseId, {
    ...house,
    wealth,
    reputation,
    scandal,
    lastAudienceTick: state.tick,
  });

  // P8: full-success rewards — rival hostility drop + patroness favor bonus.
  // MONARCH_AUDIENCE_RIVAL_HOSTILITY_DROP is a POSITIVE magnitude (constants.ts:89);
  // the patch SUBTRACTS the magnitude to actually drop hostility. Order:
  // player record written above first, then rival hostility (writes into the
  // same `houses` Map clone), then patronesses (separate clone allocated only
  // on the FullSuccess branch to save allocations on Partial outcomes).
  let patronesses = state.patronesses;
  if (isFullSuccess) {
    for (const [rid] of state.rivalActors) {
      const rh = houses.get(rid);
      if (rh === undefined) continue;
      houses.set(rid, {
        ...rh,
        hostility: clamp(rh.hostility - MONARCH_AUDIENCE_RIVAL_HOSTILITY_DROP, 0, 100),
      });
    }
    patronesses = new Map(state.patronesses);
    for (const [pid, p] of state.patronesses) {
      patronesses.set(pid, {
        ...p,
        favor: clamp(p.favor + MONARCH_AUDIENCE_PATRONESS_BONUS, 0, 100),
      });
    }
  }

  const outcome: AudienceOutcome = isFullSuccess
    ? { kind: "FullSuccess", preCostReputation }
    : { kind: "Partial", preCostReputation };

  return { state: { ...state, houses, patronesses }, outcome };
}
