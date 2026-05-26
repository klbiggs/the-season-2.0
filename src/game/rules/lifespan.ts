// P23: trait + gender lifespan modifiers (§10 Q18). Pure, RNG-free finalizer
// applied to a base deathAge roll. Used by conception (newborns) and procedural
// generation (society NPCs) — NEVER re-applied to existing characters/fixtures.
//
// The base roll stays LIFESPAN_RANGE = [70,95] (a single drawInt at the call
// site); this helper adds the deterministic gender skew + per-trait deltas and
// clamps into the widened CharacterSchema.deathAge bound [DEATH_AGE_MIN,
// DEATH_AGE_MAX]. No PRNG draw — gender + traits are known by the call site.
//
// Plan: plans/phases/23-marriage-family-depth.md item C.

import {
  DEATH_AGE_MAX,
  DEATH_AGE_MIN,
  LIFESPAN_GENDER_SKEW,
  LIFESPAN_TRAIT_MODIFIERS,
} from "../constants";
import { TRAITS_ALL } from "../fixtures/traits";
import type { TraitId } from "../rng";
import { clamp } from "../util/clamp";

// Module-load validity assertion (kept here, not in constants.ts, to avoid a
// constants→fixtures/traits import cycle). Every modifier key must be a real
// trait id — a typo (e.g. "Hedonist" vs "Hedonistic") fails fast at boot.
const TRAIT_ID_SET = new Set<string>(TRAITS_ALL);
for (const traitId of LIFESPAN_TRAIT_MODIFIERS.keys()) {
  if (!TRAIT_ID_SET.has(traitId)) {
    throw new Error(
      `LIFESPAN_TRAIT_MODIFIERS key "${traitId}" is not a valid trait id (not in TRAITS_ALL)`,
    );
  }
}

export function applyLifespanModifiers(
  baseDeathAge: number,
  gender: "Female" | "Male",
  traits: readonly TraitId[],
): number {
  let total = baseDeathAge + LIFESPAN_GENDER_SKEW[gender];
  for (const t of traits) {
    total += LIFESPAN_TRAIT_MODIFIERS.get(t) ?? 0;
  }
  return clamp(total, DEATH_AGE_MIN, DEATH_AGE_MAX);
}
