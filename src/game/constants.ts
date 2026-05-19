// All P1 numeric tunings live here. Subsequent phases append. Per CLAUDE.md
// non-negotiable §10: designer constants in one canonical location each.

import type { BankruptcyTier } from "./rules/economy";

export const ECONOMY_DELTAS: Readonly<
  Record<BankruptcyTier, { wealth: number; reputation: number; scandal: number }>
> = {
  Solvent: { wealth: 0, reputation: 0, scandal: 0 },
  Hemorrhaging: { wealth: -2, reputation: -1, scandal: 0 },
  Embarrassed: { wealth: -3, reputation: -1, scandal: 1 },
  Ruined: { wealth: -5, reputation: -2, scandal: 2 },
};

export const MOOD_REROLL_PROBABILITY = 0.15;

export const FAUX_PAS_LOCK_DURATION_IN_TICKS = 5;

export const YEARS_PER_CONCEPTION_CYCLE = 2;

export const FERTILITY_CEILING_AGE = 40;

export const ADULTHOOD_AGE_IN_YEARS = 18;

export const SUCCESSION_REPUTATION_PENALTY = 20;

// Per-character lifespan rolled uniformly in this inclusive integer range
// (spec §10 Q18 resolution). drawInt(rng, 26) + 70 → [70, 95] inclusive.
export const LIFESPAN_RANGE: readonly [number, number] = [70, 95];

export const TRAIT_NOVELTY_PROBABILITY = 0.3;
