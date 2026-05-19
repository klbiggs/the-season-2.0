// All numeric tunings live here. Subsequent phases append. Per CLAUDE.md
// non-negotiable §10: designer constants in one canonical location each.

import type { LocationId } from "./fixtures/locations";
import type { Mood } from "./fixtures/moods";
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

// ── P4: Conversation combat + LLM + ballroom tunings ─────────────────────

// Spec §3 "Conversation Combat Math" — formula is Base + (bonusTraitCount ×
// BonusValue) + (moodMatches ? BonusValue : 0); composure delta is
// penaltyTraitCount × PenaltyValue, NOT modulated by quality multiplier.
export const COMBAT_BASE_AFFECTION = 10;
export const COMBAT_BONUS_VALUE = 15;
export const COMBAT_PENALTY_VALUE = -10;
// Spec §3 "Flattery vs Defensive instant-fail": 0 affection, -20 composure,
// faux-pas flag.
export const FLATTERY_VS_DEFENSIVE_COMPOSURE_DELTA = -20;

// Spec §3 "Language-Model Quality Modulation": clamp range. Modulates
// affection only — never composure (structural damage is phrasing-
// independent).
export const QUALITY_MULTIPLIER_FLOOR = 0.5;
export const QUALITY_MULTIPLIER_CEIL = 1.5;

// Spec §3 "Stance Modifiers". Wallflower halves all affection; Mingle is
// baseline; TargetedPursuit ×1.25 against pinned target only.
export const STANCE_WALLFLOWER_AFFECTION_MULT = 0.5;
export const STANCE_MINGLE_AFFECTION_MULT = 1.0;
export const STANCE_TARGETED_PURSUIT_AFFECTION_MULT = 1.25;
// Doubled composure damage when sabotaged (P5 Sabotage consumes this).
export const STANCE_TARGETED_PURSUIT_SABOTAGE_COMPOSURE_MULT = 2.0;

// Spec §3 "Marriage, Conception & Inheritance": affection threshold for
// proposal eligibility. Cited at P4 only as the clamp ceiling reference.
export const AFFECTION_PROPOSAL_THRESHOLD = 80;

// Spec §3 "Duel Resolution": starting composure for every character. P4
// uses it as the maxComposure default.
export const COMPOSURE_DEFAULT = 100;

// Spec §3 / §4: tactic and stance registries. Single source of truth.
export const TACTICS = ["Flattery", "WittyBanter", "SlyGossip", "DeepEmpathy"] as const;
export type Tactic = (typeof TACTICS)[number];

export const STANCES = ["Wallflower", "Mingle", "TargetedPursuit"] as const;
export type Stance = (typeof STANCES)[number];

// Tactic → bonus mood map. Each tactic has one bonus mood per spec §3's
// conversation math; designer-picked mappings consistent with Regency-flavor
// archetypes.
export const TACTIC_BONUS_MOOD: ReadonlyMap<Tactic, Mood> = new Map<Tactic, Mood>([
  ["Flattery", "Receptive"],
  ["WittyBanter", "Receptive"],
  ["SlyGossip", "Jealous"],
  ["DeepEmpathy", "Grieving"],
]);

// Tactic ↔ trait bonus/penalty maps. Designer baseline; playtest may shift
// individual entries within the v1 window. The mapping table is documented
// in plans/phases/04-ballroom-llm.md "Tactic↔trait bonus/penalty maps".
export const CONVERSATION_TRAIT_BONUSES: ReadonlyMap<TraitId, ReadonlyArray<Tactic>> = new Map<
  TraitId,
  ReadonlyArray<Tactic>
>([
  ["Cunning" as TraitId, ["SlyGossip"]],
  ["Observant" as TraitId, ["SlyGossip"]],
  ["Charming" as TraitId, ["Flattery", "WittyBanter"]],
  ["Witty" as TraitId, ["WittyBanter"]],
  ["Empathetic" as TraitId, ["DeepEmpathy"]],
  ["Intellectual" as TraitId, ["WittyBanter"]],
  ["Sophisticated" as TraitId, ["Flattery", "WittyBanter"]],
  ["Polyglot" as TraitId, ["WittyBanter"]],
  ["Rustic" as TraitId, ["DeepEmpathy"]],
  ["Vain" as TraitId, ["Flattery"]],
  ["Frivolous" as TraitId, ["WittyBanter"]],
  ["Romantic" as TraitId, ["Flattery", "DeepEmpathy"]],
  ["Jaded" as TraitId, ["SlyGossip"]],
  ["Melancholic" as TraitId, ["DeepEmpathy"]],
  // Dull has no bonus tactic
  ["Greedy" as TraitId, ["SlyGossip"]],
  ["Devout" as TraitId, ["DeepEmpathy"]],
  ["Pious" as TraitId, ["DeepEmpathy"]],
  ["Brash" as TraitId, ["WittyBanter"]],
  // Reserved has no bonus tactic
  ["Ambitious" as TraitId, ["Flattery"]],
  ["ImpoverishedNobility" as TraitId, ["Flattery"]],
  ["Generous" as TraitId, ["DeepEmpathy"]],
  // Suspicious has no bonus tactic
  ["Loyal" as TraitId, ["DeepEmpathy"]],
  ["Treacherous" as TraitId, ["SlyGossip"]],
  ["Bold" as TraitId, ["WittyBanter"]],
  // Cautious has no bonus tactic
  ["Eloquent" as TraitId, ["Flattery", "WittyBanter"]],
  // Reclusive has no bonus tactic
  ["Hedonistic" as TraitId, ["Flattery"]],
  ["Ascetic" as TraitId, ["DeepEmpathy"]],
]);

export const CONVERSATION_TRAIT_PENALTIES: ReadonlyMap<TraitId, ReadonlyArray<Tactic>> = new Map<
  TraitId,
  ReadonlyArray<Tactic>
>([
  ["Cunning" as TraitId, ["DeepEmpathy"]],
  // Observant has no penalty tactic
  // Charming has no penalty tactic
  // Witty has no penalty tactic
  ["Empathetic" as TraitId, ["SlyGossip"]],
  ["Intellectual" as TraitId, ["Flattery"]],
  // Sophisticated has no penalty tactic
  // Polyglot has no penalty tactic
  ["Rustic" as TraitId, ["Flattery", "SlyGossip"]],
  ["Vain" as TraitId, ["DeepEmpathy"]],
  ["Frivolous" as TraitId, ["DeepEmpathy"]],
  ["Romantic" as TraitId, ["SlyGossip"]],
  ["Jaded" as TraitId, ["Flattery"]],
  ["Melancholic" as TraitId, ["WittyBanter"]],
  ["Dull" as TraitId, ["Flattery", "WittyBanter"]],
  ["Greedy" as TraitId, ["DeepEmpathy"]],
  ["Devout" as TraitId, ["SlyGossip"]],
  ["Pious" as TraitId, ["Flattery"]],
  ["Brash" as TraitId, ["DeepEmpathy"]],
  ["Reserved" as TraitId, ["Flattery"]],
  ["Ambitious" as TraitId, ["DeepEmpathy"]],
  // ImpoverishedNobility has no penalty tactic
  ["Generous" as TraitId, ["SlyGossip"]],
  ["Suspicious" as TraitId, ["Flattery", "DeepEmpathy"]],
  ["Loyal" as TraitId, ["SlyGossip"]],
  ["Treacherous" as TraitId, ["DeepEmpathy"]],
  // Bold has no penalty tactic
  ["Cautious" as TraitId, ["WittyBanter"]],
  // Eloquent has no penalty tactic
  ["Reclusive" as TraitId, ["Flattery", "WittyBanter"]],
  ["Hedonistic" as TraitId, ["DeepEmpathy"]],
  ["Ascetic" as TraitId, ["Flattery"]],
]);

// Conversation history bounded per pair to 3 most-recent exchanges. Spec
// §3 line 597 "bounded to three most-recent exchanges per (house, target)".
// FIFO eviction at append time, not read time. The 50-KB-per-subsystem NFR
// (spec §8) holds for ~30 NPCs × 3 exchanges × ~500 bytes ≈ 45 KB worst case.
export const CONVERSATION_HISTORY_LIMIT_PER_PAIR = 3;

// Gemini model identifiers. Per Resolved decision #5: first-meeting routes
// to Pro; all other turns route to Flash. Pin Context7-verified at
// implementation time — preview channels may shift.
export const MODEL_DEFAULT = "gemini-3.5-flash" as const;
export const MODEL_FIRST_MEETING = "gemini-3.1-pro-preview" as const;

// LLM request budgets.
// Spec §5 line 599 "15-second budget".
export const LLM_TIMEOUT_MS = 15_000;
// Spec §5 "capped output-token budget" — short in-character replies.
export const LLM_OUTPUT_TOKEN_BUDGET = 600;
// Spec §5 line 601 "under 1500 tokens" — documentation-only at P4
// (buildPersonaPrompt keeps personas <300 tokens; P18 polishes adds a
// runtime check if needed).
export const LLM_SYSTEM_INSTRUCTION_TOKEN_BUDGET = 1500;
// Spec §5 line 621 "validate shape ... no network roundtrip" + CLAUDE.md
// LLM specifics "shape-only". Google API keys start with `AIza` followed
// by 35 chars; the regex intentionally accepts any non-empty suffix.
export const BYOK_KEY_SHAPE_REGEX = /^AIza.+/;

// Gemini context-cache constants.
// 1-hour TTL for per-character persona context caches. Gemini's caching
// is explicit and stateful (vs Anthropic's implicit per-message form).
export const PERSONA_CACHE_TTL_SECONDS = "3600s" as const;
// Prefix for the human-readable displayName of each persona cache.
export const PERSONA_CACHE_DISPLAY_NAME_PREFIX = "season-persona-" as const;
