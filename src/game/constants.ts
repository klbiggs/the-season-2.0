// All numeric tunings live here. Subsequent phases append. Per CLAUDE.md
// non-negotiable §10: designer constants in one canonical location each.

import type { LocationId } from "./fixtures/locations";
import type { TraitId } from "./rng";
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

// ── P3: Location-bound tunings ────────────────────────────────────────────

// Per-tick deltas applied by applyLocationEffectsPhase to the player house.
// Provisional v1 tuning — playtest at P3-end. Rural earns wealth; capital
// builds reputation; continental options trade wealth for reputation
// (cultured) or earn risky scandal (seduction cities, foreign capital).
export const LOCATION_DELTAS: Readonly<
  Record<LocationId, { wealth: number; reputation: number; scandal: number }>
> = {
  Capital: { wealth: 0, reputation: 1, scandal: 0 },
  Country: { wealth: 1, reputation: 0, scandal: 0 },
  FinishingCapitalCultured: { wealth: -2, reputation: 1, scandal: 0 },
  FinishingCapitalPolitical: { wealth: -2, reputation: 1, scandal: 0 },
  CanalCity: { wealth: 0, reputation: 0, scandal: 1 },
  RenaissanceCity: { wealth: 0, reputation: 0, scandal: 1 },
  ForeignCapital: { wealth: 2, reputation: 0, scandal: 1 },
};

// Consecutive ticks at Country required to grant the "Rustic" trait.
export const RUSTIC_TRAIT_TICKS_AT_RURAL_ESTATE = 5;

// Spec §3 "Location-Bound Trait Acquisition": 20% per tick.
export const FINISHING_SCHOOL_TRAIT_PROBABILITY = 0.2;

// Additional per-tick wealth cost while pursuing a finishing-school trait
// (stops once trait is acquired). Stacks with LOCATION_DELTAS for that
// location during pursuit. -3 here + -2 from LOCATION_DELTAS = -5/tick.
export const FINISHING_SCHOOL_WEALTH_DRAIN_PER_TICK = -3;

// Which trait each finishing-school location grants. ReadonlyMap so consumers
// branch on .get(...) === undefined to detect non-school locations.
export const FINISHING_SCHOOL_TRAIT_MAP: ReadonlyMap<LocationId, TraitId> = new Map<
  LocationId,
  TraitId
>([
  ["FinishingCapitalCultured", "Sophisticated" as TraitId],
  ["FinishingCapitalPolitical", "Polyglot" as TraitId],
]);

// Spec §3 "Monarch's-Audience Resolution".
export const MONARCH_AUDIENCE_COOLDOWN_TICKS = 30;
export const MONARCH_AUDIENCE_REPUTATION_THRESHOLD = 30;
export const MONARCH_AUDIENCE_FULL_SUCCESS_THRESHOLD = 50;
export const MONARCH_AUDIENCE_WEALTH_COST = 50;
export const MONARCH_AUDIENCE_REPUTATION_COST = 10;
export const MONARCH_AUDIENCE_PARTIAL_SCANDAL_DELTA = 10;
// Stub at P3 — patronesses ship in P8. Audience action's `+5 to all
// patronesses` is an empty loop at P3.
export const MONARCH_AUDIENCE_PATRONESS_BONUS = 5;
// Stub at P3 — rivals ship in P8. Audience action's `-5 rival hostility`
// is an empty loop at P3 but the ordering contract (audience-before-rival)
// is wired correctly.
export const MONARCH_AUDIENCE_RIVAL_HOSTILITY_DROP = 5;

// Spec §3 "Economy & Bankruptcy": escape-valve at Country while wealth < 0.
export const BANKRUPTCY_ESCAPE_WEALTH_GAIN = 50;
export const BANKRUPTCY_ESCAPE_SCANDAL_COST = 5;

// Spec §3 "Location-Bound Trait Acquisition & Risk Asymmetry": seduction
// cities apply a higher probability multiplier to scandal-bearing inbound
// couriers. Consumed at the courier-flow layer at P6; unused at P3.
export const SEDUCTION_CITY_SCANDAL_PROBABILITY_MULTIPLIER = 2.0;

// Spec §3 "Wardrobe Decay & Pre-Ball Composure Penalty": refresh action
// at Capital. P3 writes wardrobeLastRefreshTick; P10 reads it to compute
// the pre-ball composure penalty.
export const WARDROBE_REFRESH_WEALTH_COST = 20;
