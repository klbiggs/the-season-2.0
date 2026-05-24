// Per-tick location effects for the player house (spec §3 "Strategy Map" +
// "Location-Bound Trait Acquisition"). Pure: takes GameState, returns new
// GameState via hand-rolled shallow Map clone (CLAUDE.md §1).
//
// Phase ordering: runs AFTER economy, BEFORE courier-draining. See
// runtime/tickOrchestrator.ts PHASES array.
//
// Draw budget per call: 0 (no finishing-school OR trait already acquired)
// or 1 (finishing-school location, trait not yet acquired). Advances the
// player house's RngState via state.rng.get(PLAYER_HOUSE_ID).
//
// At P3 only the player house has currentLocation tracking; rivals (P8)
// will set sensible defaults but do NOT accrue location effects. The phase
// hard-codes against PLAYER_HOUSE_ID rather than iterating all houses.

import {
  FINISHING_SCHOOL_TRAIT_MAP,
  FINISHING_SCHOOL_TRAIT_PROBABILITY,
  FINISHING_SCHOOL_WEALTH_DRAIN_PER_TICK,
  LOCATION_DELTAS,
  PATRONAGE_PERK_RURAL_ESTATE_FLAT_BONUS,
  PATRONAGE_PERK_RURAL_ESTATE_MULTIPLIER,
  RUSTIC_TRAIT_TICKS_AT_RURAL_ESTATE,
} from "../constants";
import type { GameState } from "../entities";
import type { LocationId } from "../fixtures/locations";
import { PLAYER_HOUSE_ID, type RngState, type TraitId, drawNext } from "../rng";
import { hasDynastyPerk } from "./dynastyLegacies";

const RUSTIC_TRAIT_ID = "Rustic" as TraitId;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function getLocationDelta(loc: LocationId): {
  wealth: number;
  reputation: number;
  scandal: number;
} {
  return LOCATION_DELTAS[loc];
}

export function applyLocationEffectsPhase(state: GameState): GameState {
  // Skip cleanly if the player house or its head character isn't present
  // in this state. In production both always exist (boot invariant); the
  // skip tolerates synthetic-state tests that don't seed them (e.g., the
  // existing tickOrchestrator phase-ordering tests).
  const house = state.houses.get(PLAYER_HOUSE_ID);
  if (house === undefined) return state;
  const head = state.characters.get(house.headOfHouseCharacterId);
  if (head === undefined) return state;
  const delta = LOCATION_DELTAS[house.currentLocation];

  // P15: the Patronage perk boosts the positive Country-location wealth yield
  // (plan D2 — "events hosted at the rural estate" maps to the rural-estate
  // wealth yield). Only while resident at Country, only when the perk is held,
  // only on a positive delta. RNG-free; clamps below unchanged.
  const wealthDelta =
    house.currentLocation === "Country" && delta.wealth > 0 && hasDynastyPerk(state, "Patronage")
      ? Math.round(delta.wealth * PATRONAGE_PERK_RURAL_ESTATE_MULTIPLIER) +
        PATRONAGE_PERK_RURAL_ESTATE_FLAT_BONUS
      : delta.wealth;
  let wealth = house.wealth + wealthDelta;
  const reputation = clamp(house.reputation + delta.reputation, 0, 100);
  const scandal = clamp(house.scandal + delta.scandal, 0, 100);
  const consecutiveTicks = house.consecutiveTicksAtCurrentLocation + 1;
  let traits = head.traits;
  let nextRngState: RngState | null = null;

  // Rustic-trait acquisition at Country after RUSTIC_TRAIT_TICKS_AT_RURAL_ESTATE
  // consecutive ticks. Deterministic — no draw.
  if (
    house.currentLocation === "Country" &&
    consecutiveTicks >= RUSTIC_TRAIT_TICKS_AT_RURAL_ESTATE &&
    !head.traits.includes(RUSTIC_TRAIT_ID)
  ) {
    traits = [...head.traits, RUSTIC_TRAIT_ID];
  }

  // Finishing-school trait roll: apply drain + 20% chance per tick. Stops
  // (no drain, no draw) once the trait is acquired.
  const schoolTrait = FINISHING_SCHOOL_TRAIT_MAP.get(house.currentLocation);
  if (schoolTrait !== undefined && !head.traits.includes(schoolTrait)) {
    wealth += FINISHING_SCHOOL_WEALTH_DRAIN_PER_TICK;
    const rngState = state.rng.get(PLAYER_HOUSE_ID);
    if (rngState === undefined) {
      // Programmer error: player house must have an RNG entry. The save/load
      // path round-trips this invariant; a missing entry is unrecoverable.
      throw new Error(`RNG missing for PLAYER_HOUSE_ID at location ${house.currentLocation}`);
    }
    const { next, rngState: post } = drawNext(rngState);
    nextRngState = post;
    if (next < FINISHING_SCHOOL_TRAIT_PROBABILITY) {
      // Append once. If the head already has the trait, the outer guard
      // already filtered this branch — so no idempotence check needed here.
      traits = [...head.traits, schoolTrait];
    }
  }

  const characters = new Map(state.characters);
  if (traits !== head.traits) {
    characters.set(head.id, { ...head, traits });
  }

  const houses = new Map(state.houses);
  houses.set(PLAYER_HOUSE_ID, {
    ...house,
    wealth,
    reputation,
    scandal,
    consecutiveTicksAtCurrentLocation: consecutiveTicks,
  });

  const rng = new Map(state.rng);
  if (nextRngState !== null) {
    rng.set(PLAYER_HOUSE_ID, nextRngState);
  }

  return { ...state, houses, characters, rng };
}
