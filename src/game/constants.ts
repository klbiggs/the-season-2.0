// All numeric tunings live here. Subsequent phases append. Per CLAUDE.md
// non-negotiable §10: designer constants in one canonical location each.

import type { Archetype } from "./fixtures/archetypes";
import type { ArtifactFamily } from "./fixtures/artifacts";
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

// Spec §3 "Marriage, Conception & Inheritance": affection threshold for
// proposal eligibility. Cited at P4 only as the clamp ceiling reference.
export const AFFECTION_PROPOSAL_THRESHOLD = 80;

// Spec §3 "Duel Resolution": starting composure for every character. P4
// uses it as the maxComposure default.
export const COMPOSURE_DEFAULT = 100;

// Spec §3 / §4: tactic and stance registries. Single source of truth.
// P12: widened to 5 — "ComplimentMount" is a promenade-only tactic. The
// ballroom UI does NOT surface it, but the type union admits it because
// state.conversationHistory's `Exchange.classifiedTactic` is shared across
// both modes (single ExchangeSchema enum at src/game/conversation/types.ts).
// See plans/phases/12-promenade.md "TACTICS widening (...)".
export const TACTICS = [
  "Flattery",
  "WittyBanter",
  "SlyGossip",
  "DeepEmpathy",
  "ComplimentMount",
] as const;
export type Tactic = (typeof TACTICS)[number];

// Module-load assertion mirroring SCHEME_KINDS at line 295. Bumping TACTICS
// length without revisiting the persist/schema enum cascade silently breaks
// save round-trips for the conversationHistory Exchange records.
if (TACTICS.length !== 5) {
  throw new Error(
    `TACTICS length changed (${TACTICS.length} !== 5) without phase plan + (where needed) save-version bump`,
  );
}

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
  // P26 (H4): ComplimentMount is now a ballroom tactic (was promenade-only at
  // P12). A Receptive target warms to a compliment on their horse/carriage.
  ["ComplimentMount", "Receptive"],
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
  // P26 (H4): Rustic warms to horse/mount talk.
  ["Rustic" as TraitId, ["DeepEmpathy", "ComplimentMount"]],
  // P26 (H4): the Vain love their finery flattered.
  ["Vain" as TraitId, ["Flattery", "ComplimentMount"]],
  // P26 (H4): the Frivolous enjoy light mount chatter.
  ["Frivolous" as TraitId, ["WittyBanter", "ComplimentMount"]],
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
  // P26 (H4): the Bold admire a fine mount handled well.
  ["Bold" as TraitId, ["WittyBanter", "ComplimentMount"]],
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
  // P26 (H4): the Reserved recoil from showy mount-praise.
  ["Reserved" as TraitId, ["Flattery", "ComplimentMount"]],
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
  // P26 (H4): the Ascetic disdain conspicuous horseflesh.
  ["Ascetic" as TraitId, ["Flattery", "ComplimentMount"]],
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
// P7.5: GEMINI_KEY_SHAPE_REGEX (formerly BYOK_KEY_SHAPE_REGEX) was deleted
// from this file — the key is server-only now and the regex lives in
// server/env.ts as a local constant. No client-side consumer remains.

// Gemini context-cache constants. Consumer split is intentional:
//   - PERSONA_CACHE_TTL_SECONDS: STRING "3600s" — the Gemini wire format
//     passed to `ai.caches.create({ ttl: ... })`.
//   - PERSONA_CACHE_TTL_MS: NUMBER 3600000 — the server-local
//     `Date.now() - createdAt < TTL_MS` expiry check in
//     server/personaCache.ts. The two MUST agree (60 minutes); don't
//     "unify" by computing one from the other — Gemini's wire format is
//     a string and arithmetic on it would be NaN.
export const PERSONA_CACHE_TTL_SECONDS = "3600s" as const;
export const PERSONA_CACHE_TTL_MS = 3_600_000;
// Prefix for the human-readable displayName of each persona cache.
export const PERSONA_CACHE_DISPLAY_NAME_PREFIX = "season-persona-" as const;

// ── P17: Semantic Memory (Embedding Retrieval) ───────────────────────────
// Gemini embedding model, PINNED (spec §5 "not a 'latest' alias") so vectors
// stay comparable across save/load; a change is detectable via the model id
// stored in the vector-index sidecar metadata (discard-on-mismatch). Reuses
// GEMINI_API_KEY via the localhost proxy — no separate credential. The model
// id is consumed by server/embeddings.ts (the embed handler) AND by the
// sidecar metadata pin; keep both in lockstep with this constant.
export const EMBEDDING_MODEL = "gemini-embedding-001" as const;
// outputDimensionality passed to embedContent. gemini-embedding-001 defaults
// to 3072 and truncates from the end; reduced vectors are NOT pre-normalized,
// so src/llm/embeddings.ts L2-normalizes after receiving values (cosine = dot
// product). 768 keeps the sidecar compact (768 × 4 B ≈ 3 KB/vector).
export const EMBEDDING_DIMENSIONS = 768;
// Sidecar entry-count cap with FIFO eviction by tick (spec §8 line 687). The
// fixed-dim vector makes this cap the byte bound: ~3.6 KB/entry × 500 ≈ 1.8 MB
// per slot — large but bounded. Raise only with that product re-checked.
// P26 (G4): raised 500 → 1500. Cross-house retrieval now indexes ALL houses'
// whispers/schemes/grievances/successions, but the player-anchored retrieve
// filter surfaces only a subset — a flat 500-entry FIFO would let non-
// retrievable cross-house bulk evict useful player-perspective memory in a
// mature campaign (25+ society NPCs). ~5.5 MB/slot, under the bounded-save NFR.
export const VECTOR_INDEX_MAX_ENTRIES = 1500;
// P26 (G5): re-embed batch size when the embedding model/dimensions change —
// the sourceTexts are re-embedded in chunks (replacing the P17 silent discard).
export const EMBED_REEMBED_BATCH_SIZE = 32;
// Retrieval: top-K hits above the cosine threshold added to the prompt.
export const SEMANTIC_RETRIEVAL_TOP_K = 4;
export const SEMANTIC_SIMILARITY_THRESHOLD = 0.55;
// Client-side retrieval embed timeout. SMALLER than LLM_TIMEOUT_MS and ADDITIVE
// to the user-perceived wait (retrieval is awaited before the conversation
// round-trip) — keep it short; on timeout retrieval degrades to recency-only.
export const EMBED_RETRIEVAL_TIMEOUT_MS = 5_000;
// Server-side embed composite-AbortController budget (embeddings are fast).
export const EMBED_SERVER_TIMEOUT_MS = 8_000;

// ── P18: LLM Flavor Content ───────────────────────────────────────────────
// Generate-once / persist-once flavor prose (artifact backstories, NPC bios,
// per-generation scandal columns). Cheap creative prose — Flash, not the Pro
// first-meeting model. Pinned concrete id, not a `latest` alias.
export const FLAVOR_MODEL = "gemini-3.5-flash" as const;
// SAFETY CEILING, not the length control — length is steered by the prompt
// (server/prompts/flavor.ts caps sentences/words) so the model finishes
// naturally (finishReason STOP) instead of getting cut off at the wall
// (finishReason MAX_TOKENS). Set generously above any 2-4 sentence output.
// Flavor thinking is DISABLED server-side (thinkingBudget: 0), so the whole
// budget feeds visible prose rather than being eaten by thinking tokens —
// without that, a tight cap truncates mid-sentence.
export const FLAVOR_OUTPUT_TOKEN_BUDGET = 512;
// Fire-and-forget generation never blocks the tick or a conversation, so the
// budget is generous. Client AbortSignal.timeout vs server composite controller.
export const FLAVOR_REQUEST_TIMEOUT_MS = 14_000;
export const FLAVOR_SERVER_TIMEOUT_MS = 12_000;

// ── P5: Schemes & Multi-Tick Operations ──────────────────────────────────

// Six scheme kinds per spec §3 "Schemes" line 79. Treason Framing (7th) is
// reserved for P10 — adding it requires a SAVE_VERSION bump (see assertion
// below). Order matters: SchemeKindSchema = z.enum(SCHEME_KINDS) serializes
// by string value (not by index), but the enum cardinality is part of the
// hash projection via Scheme entity.
export const SCHEME_KINDS = [
  "Courting",
  "Sabotage",
  "Seduction",
  "Chaperone",
  "Smuggling",
  "Assassination",
  "TreasonFraming",
] as const;
export type SchemeKind = (typeof SCHEME_KINDS)[number];

// Module-load assertion: P10 shipped the Treason Framing addition with
// save-version bump v10→v11. Future 8th kind requires another bump + migration.
if (SCHEME_KINDS.length !== 7) {
  throw new Error(
    `SCHEME_KINDS length changed (${SCHEME_KINDS.length} !== 7) without save-version bump — bump SAVE_VERSION_CURRENT and add migration`,
  );
}

export const SCHEME_STATUSES = ["Active", "Completed", "Cancelled", "Failed"] as const;
export type SchemeStatus = (typeof SCHEME_STATUSES)[number];

export const SCHEME_FAILURE_REASONS = ["TargetDied", "Discovered", "EraFlipped"] as const;
export type SchemeFailureReasonKind = (typeof SCHEME_FAILURE_REASONS)[number];

// P11 widens GRIEVANCE_SOURCES with "BloodFeud" — the casus belli minted alongside
// each BloodFeud entity at inherited-secret surfacing (plans/phases/11-sibling-rivals-secrets.md).
// P26 (G6): "Conversation" is the generateGrievance-tool source. The minted
// grievance is player-perpetrated and held by a non-rival society house, so it
// is DUEL-INERT at v1.5 (demandSatisfaction actions only player-held grievances,
// and society houses never autonomously demand satisfaction) — same inert state
// as a player-perpetrated FauxPas grievance. Its live value is the record + the
// G4 semantic-index entry + a latent casus belli for a future phase.
export const GRIEVANCE_SOURCES = ["Sabotage", "FauxPas", "BloodFeud", "Conversation"] as const;
export type GrievanceSource = (typeof GRIEVANCE_SOURCES)[number];

// Spec §3 "Scheme Costs, Durations & Requirements" — pinned per the spec
// table. Iterating this record by SchemeKind guarantees the resolver covers
// every kind.
export const SCHEME_TUNING: Readonly<
  Record<SchemeKind, { wealthCost: number; durationTicks: number }>
> = {
  Courting: { wealthCost: 10, durationTicks: 5 },
  Sabotage: { wealthCost: 15, durationTicks: 3 },
  Seduction: { wealthCost: 25, durationTicks: 7 },
  Chaperone: { wealthCost: 5, durationTicks: 1 },
  Smuggling: { wealthCost: 20, durationTicks: 4 },
  Assassination: { wealthCost: 50, durationTicks: 6 },
  TreasonFraming: { wealthCost: 40, durationTicks: 5 },
};

// Spec §3 schemes table: completion effect deltas (per-scheme constants;
// the resolver applies clamping at every mutation site per CLAUDE.md
// non-negotiable §6).
export const COURTING_AFFECTION_DELTA = 40;
export const SABOTAGE_COMPOSURE_DELTA = -30;
export const ASSASSINATION_SCANDAL_DELTA = 25;

// P24a (C1, Q6): multi-tick Seduction-discovery suspicion (supersedes the
// retired one-shot SEDUCTION_DISCOVERY_PROBABILITY / SEDUCTION_AFFECTION_DELTA_ON_SUCCESS).
// Affection accrues per tick of flight and the per-tick discovery probability
// ramps with accumulated affection. Tuned so a ~7-tick Seduction accrues ~80
// affection and integrates to ~0.2 total discovery probability — matching the
// old one-shot model. Designer-tunable.
export const SEDUCTION_AFFECTION_PER_TICK = 12;
export const SEDUCTION_AFFECTION_CEILING = 80;
export const SEDUCTION_SUSPICION_BASE = 0.0;
export const SEDUCTION_SUSPICION_SLOPE = 0.0006; // probability per accumulated-affection point
export const SEDUCTION_SUSPICION_CEILING = 0.1; // per-tick cap

// P24a (C6): a scheme completion that drops a target's composure below this
// threshold locks the target Defensive for SCHEME_COMPLETION_MOOD_LOCK_TICKS
// (reuses the moodLockUntilTick field; applied in resolveSabotage as a pure
// Map clone, NOT the store-layer faux-pas write).
export const SCHEME_COMPLETION_MOOD_LOCK_COMPOSURE_THRESHOLD = 20;
export const SCHEME_COMPLETION_MOOD_LOCK_TICKS = 5;

// Spec §2 line 227 canonical reading: Spymaster for Chaperone; Bohemian
// Rake for Assassination/Forgery; Country Exile as deniable proxy. Empty
// arrays mean "no archetype prereq". Checked in tryStartScheme via
// `acceptable.includes(c.archetype)` — NEVER ARCHETYPES.includes(c.archetype)
// (the latter admits the "None" sentinel which is not the intent).
export const SCHEME_PREREQUISITES: Readonly<Record<SchemeKind, readonly Archetype[]>> = {
  Courting: [],
  Sabotage: [],
  Seduction: [],
  Chaperone: ["Spymaster"],
  Smuggling: [],
  Assassination: ["BohemianRake", "CountryExile"],
  // BohemianRake only — narrower than Assassination's pair because Treason Framing
  // consumes an unsurfaced forgery, and only BohemianRake can commission one (spec §3 line 180).
  // Allowing CountryExile to start TreasonFraming without being able to forge would deadlock
  // CountryExile-only player houses.
  TreasonFraming: ["BohemianRake"],
};

// Spec §3 line 357: Smuggling requires the Earlier (wartime) era at start.
// All other kinds are era-agnostic.
export const SCHEME_ERA_REQUIREMENTS: Readonly<Record<SchemeKind, "Earlier" | "Later" | null>> = {
  Courting: null,
  Sabotage: null,
  Seduction: null,
  Chaperone: null,
  Smuggling: "Earlier",
  Assassination: null,
  TreasonFraming: null,
};

// Spec §3 "Era Progression": fixed tick threshold. Designer-tunable per-build
// constant. NOT in hashableState — lives in constants.ts, not on GameState.
// P13 may revise the value without a save-version bump; replay-harness
// fixtures rebuild against the live value at test-run time. Placeholder 200
// ≈ 10 in-game years at ~20 ticks/year.
export const ERA_TRANSITION_TICK = 200 as const;

// ── P6: Whispers, Espionage & Staff ──────────────────────────────────────

// Enum constants for the new P6 entities + their state machines. Each enum
// is guarded by a module-load assertion below — additions require a save-
// version bump (the enum values participate in the hash projection via
// Whisper.status, CourierPayload.status, etc.).

export const WHISPER_STATUSES = ["Unverified", "Verified", "Weaponized", "Dismissed"] as const;
export type WhisperStatus = (typeof WHISPER_STATUSES)[number];

export const WEAPONIZATION_BRANCHES = ["Blackmail", "ScandalSheet", "AccidentalSlip"] as const;
export type WeaponizationBranch = (typeof WEAPONIZATION_BRANCHES)[number];

export const STAFF_ASSIGNMENTS = [
  "Snoop",
  "BribeDriver",
  "InterceptMail",
  "None",
  "BribedByRival",
] as const;
export type StaffAssignment = (typeof STAFF_ASSIGNMENTS)[number];

export const COURIER_STATUSES = ["InFlight", "Delivered", "Intercepted", "Cancelled"] as const;

export const COURIER_PAYLOAD_TYPES = ["Whisper"] as const; // "Letter" reserved for P11

export const COURIER_DIRECTIONS = ["Inbound", "Outbound"] as const;

// Module-load cardinality assertions. Guard against future enum additions
// landing without a save-version bump. Symmetric with P5's SCHEME_KINDS
// guard above.
if (WHISPER_STATUSES.length !== 4) {
  throw new Error(
    `WHISPER_STATUSES length changed (${WHISPER_STATUSES.length} !== 4) without save-version bump — bump SAVE_VERSION_CURRENT and add migration`,
  );
}
if (WEAPONIZATION_BRANCHES.length !== 3) {
  throw new Error(
    `WEAPONIZATION_BRANCHES length changed (${WEAPONIZATION_BRANCHES.length} !== 3) without save-version bump`,
  );
}
if (STAFF_ASSIGNMENTS.length !== 5) {
  throw new Error(
    `STAFF_ASSIGNMENTS length changed (${STAFF_ASSIGNMENTS.length} !== 5) without save-version bump`,
  );
}
if (COURIER_STATUSES.length !== 4) {
  throw new Error(
    `COURIER_STATUSES length changed (${COURIER_STATUSES.length} !== 4) without save-version bump`,
  );
}
if (COURIER_PAYLOAD_TYPES.length !== 1) {
  throw new Error(
    `COURIER_PAYLOAD_TYPES length changed (${COURIER_PAYLOAD_TYPES.length} !== 1) without save-version bump (Letter variant is reserved for P11)`,
  );
}
if (COURIER_DIRECTIONS.length !== 2) {
  throw new Error(
    `COURIER_DIRECTIONS length changed (${COURIER_DIRECTIONS.length} !== 2) without save-version bump`,
  );
}

// Whisper verification cadence. Spec §3 line 519: "after sufficient ticks
// of verification progress past 100". +10 per tick → 10 ticks to verify
// once arrived at destination. Designer-tunable.
export const WHISPER_VERIFICATION_PER_TICK = 10;
export const WHISPER_VERIFICATION_THRESHOLD = 100;

// Three weaponization branches (spec §3 "Whisper Weaponization Branches").

// Blackmail: modest scandal cost + small certain reward.
export const BLACKMAIL_SCANDAL_COST = 10;
export const BLACKMAIL_AFFECTION_BOOST = 20;

// Scandal Sheet: no scandal cost, large reputation damage, 15% self-exile risk.
export const SCANDAL_SHEET_REPUTATION_DROP = 30;
export const SCANDAL_SHEET_ATTRIBUTION_PROBABILITY = 0.15;

// Accidental Slip: drip-feed reputation damage over 5 conversation turns.
export const ACCIDENTAL_SLIP_DURATION_TICKS = 5;
export const ACCIDENTAL_SLIP_DRIP_PER_CONVERSATION = -2;

// Spymaster intercept (P6 rule layer ships; UI disabled until P7's
// classifyArchetype produces real archetypes).
export const SPYMASTER_INTERCEPT_WEALTH_COST = 10;

// Staff espionage tuning (spec §3 "Staff Espionage").
export const STAFF_UPKEEP_DEFAULT = 1;
export const STAFF_LOYALTY_DRIFT_UNDERPAID_PER_TICK = -1;
export const STAFF_LOYALTY_DRIFT_GREEDY_UNDERPAID_PER_TICK = -2;
export const STAFF_BRIBERY_LOYALTY_THRESHOLD = 30;
export const STAFF_BRIBERY_PROBABILITY_BASE = 0.05;

// Per-assignment cadences (ticks between outputs).
export const STAFF_SNOOP_CADENCE_TICKS = 8;
export const STAFF_BRIBE_DRIVER_CADENCE_TICKS = 12;
export const STAFF_INTERCEPT_MAIL_CADENCE_TICKS = 10;
export const STAFF_BRIBED_BY_RIVAL_CADENCE_TICKS = 6;

// ── P24c: Staff network (hire/fire/promote, perk resistance, procedural identity) ──

// I1: hire cost + active-roster cap (active = not dismissed, not promoted).
export const STAFF_HIRE_WEALTH_COST = 40;
export const STAFF_ROSTER_MAX = 8;

// I4: the Whispers dynasty perk's "resistance to rival espionage" half — when the
// player house holds it, the per-tick bribery probability is multiplied by this
// (< 1). Threshold shift only — the draw still fires (RNG stream undisturbed).
export const WHISPERS_PERK_BRIBERY_RESISTANCE_MULTIPLIER = 0.4;

// I1/I4: procedural identity for hired staff. FIXED draw budget per hire so the
// hire-action draw count is part of the determinism contract.
export const STAFF_PROCEDURAL_DRAWS_PER_HIRE = 4; // greedy, upkeep, loyalty, name
export const STAFF_PROCEDURAL_GREEDY_PCT = 40;
export const STAFF_PROCEDURAL_UPKEEP_MIN = 1;
export const STAFF_PROCEDURAL_UPKEEP_MAX = 3;
export const STAFF_PROCEDURAL_LOYALTY_MIN = 45;
export const STAFF_PROCEDURAL_LOYALTY_MAX = 80;

// I2: default adult age for a promoted staffer (before lifespan-modified deathAge).
export const PROMOTED_STAFF_AGE_MIN = 22;
export const PROMOTED_STAFF_AGE_MAX = 40;

if (
  WHISPERS_PERK_BRIBERY_RESISTANCE_MULTIPLIER <= 0 ||
  WHISPERS_PERK_BRIBERY_RESISTANCE_MULTIPLIER >= 1
) {
  throw new Error("WHISPERS_PERK_BRIBERY_RESISTANCE_MULTIPLIER must be in (0, 1)");
}
if (STAFF_PROCEDURAL_UPKEEP_MIN < 1 || STAFF_PROCEDURAL_UPKEEP_MIN > STAFF_PROCEDURAL_UPKEEP_MAX) {
  throw new Error("STAFF_PROCEDURAL_UPKEEP range invalid (min must be >=1 and <= max)");
}
if (
  STAFF_PROCEDURAL_LOYALTY_MIN < 0 ||
  STAFF_PROCEDURAL_LOYALTY_MIN > STAFF_PROCEDURAL_LOYALTY_MAX
) {
  throw new Error("STAFF_PROCEDURAL_LOYALTY range invalid");
}
if (PROMOTED_STAFF_AGE_MIN < 18 || PROMOTED_STAFF_AGE_MIN > PROMOTED_STAFF_AGE_MAX) {
  throw new Error("PROMOTED_STAFF_AGE range invalid");
}

// P6: persona prompt format version bump — invalidates P4/P5 in-memory
// persona caches whose systemInstruction lacks the new "Other characters
// in this scene" section. Hash-irrelevant (lives in code, not state); future
// persona-prompt format changes MUST bump this constant to force cache
// re-creation on deploy.
// P7 bump v2 → v3: buildPersonaPrompt extends baseLines with Marriage status
// + Happiness state paragraphs.
// v4 at P10 — characterStateSnapshot.target.traits now ships the effective-traits
// union (persistent + equipped-artifact grants via getEffectiveTraits).
export const PERSONA_CACHE_VERSION = "v5" as const;

// ── P7: Family, Marriage & Succession ────────────────────────────────────

// Spec §3 "Happiness Drain From Dull-Spouse Marriages" (line 467-469).
export const HAPPINESS_INITIAL = 100;
export const HAPPINESS_TEMPTATION_THRESHOLD = 30;
export const HAPPINESS_DULL_SPOUSE_DRAIN_PER_TICK = -1;

// Spec §3 "Marriage, Conception & Inheritance" (line 333-336). Note that
// AFFECTION_PROPOSAL_THRESHOLD already lives above at constants.ts:133 (P4);
// reused at P7 — NO duplicate constant added under any other name.
export const PROPOSAL_REPUTATION_THRESHOLD = 40;
export const PROPOSAL_ACCEPTANCE_FLOOR = 0.5;
export const PROPOSAL_ACCEPTANCE_CEILING = 0.95;
export const PROPOSAL_REJECTION_SCANDAL_DELTA = 5;

// Proposal consumes one tick (same shape as travel/audience per the pre-tick
// action pattern). Wired via module-load assertion (below) + a Vitest
// assertion in proposal.test.ts: `expect(stateAfter.tick - stateBefore.tick)
// .toBe(PROPOSAL_TICK_COST)`.
export const PROPOSAL_TICK_COST = 1;
if (PROPOSAL_TICK_COST !== 1) {
  throw new Error(
    "PROPOSAL_TICK_COST drift breaks the proposal-tick-budget contract — proposal wraps advanceTickPure which always advances by 1.",
  );
}

// Spec §3 retroactive P5 baseline (introduced at P7 to anchor the temptation
// discount). Applied at schemes.ts in the Seduction discovery branch BEFORE
// the status flip. Pre-P7 Seduction discoveries did not incur scandal; the
// migration does not retroactively replay scheme resolutions.
export const SEDUCTION_DISCOVERY_SCANDAL = 25;
// Discounted scandal when the aggressor's temptationHookUnlocked === true
// AND the Seduction target is non-spouse (§10 Q23 resolution).
export const TEMPTATION_DISCOUNTED_SCANDAL = 5;

// P24a (C3, Q25): deliberate marriage dissolution (Abandonment/Divorce). Scandal
// to the player house on abandonment; an added hostility bump if the abandoned
// spouse belongs to a rival house (symmetric with the betrothal-break bump).
export const ABANDONMENT_SCANDAL = 30;
export const ABANDONMENT_RIVAL_HOSTILITY_BUMP = 15;

// Spec §3 "Tutor Influence" (line 471-476).
export const TUTOR_REASSIGNMENT_WEALTH_COST = 5;

// ── P23: Marriage, Family & Lifespan Depth ────────────────────────────────

// Trait + gender lifespan modifiers (§10 Q18). Applied ONLY at conception +
// procedural generation (never re-rolls existing characters/fixtures). The base
// roll stays LIFESPAN_RANGE = [70,95]; modifiers + clamp land within the wider
// CharacterSchema.deathAge bound [DEATH_AGE_MIN, DEATH_AGE_MAX]. Keep these two
// literals in sync with the entities.ts deathAge .min()/.max().
export const DEATH_AGE_MIN = 55;
export const DEATH_AGE_MAX = 100;
// Gender skew: women historically outlived men; small symmetric skew (tunable).
export const LIFESPAN_GENDER_SKEW: Readonly<Record<"Female" | "Male", number>> = {
  Female: 2,
  Male: -2,
};
// Per-trait lifespan delta (designer-tunable). Keys are validated against
// TRAITS_ALL by a module-load assertion in src/game/rules/lifespan.ts (kept
// there, not here, to avoid a constants→fixtures/traits import cycle).
export const LIFESPAN_TRAIT_MODIFIERS: ReadonlyMap<TraitId, number> = new Map<TraitId, number>([
  ["Rustic" as TraitId, 5],
  ["Sophisticated" as TraitId, 3],
  ["Intellectual" as TraitId, 2],
  ["Pious" as TraitId, 3],
  ["ImpoverishedNobility" as TraitId, -5],
  ["Dull" as TraitId, -3],
  ["Melancholic" as TraitId, -4],
  ["Hedonistic" as TraitId, -3],
  ["Brash" as TraitId, -2],
]);

// Maturation random-archetype trait pick (§11.2-B). When a maturing character
// classifies to a non-None archetype, this is the per-character probability of
// gaining one random trait from that archetype's pool (independent of tutor).
export const MATURATION_RANDOM_TRAIT_PROBABILITY = 0.25;

// Cross-house rival political-alliance marriage (§10 Q16). No affection gate;
// a wealth dowry + a hostility ceiling + an inverse-hostility acceptance roll.
export const ALLIANCE_DOWRY_WEALTH_COST = 60;
export const ALLIANCE_MAX_HOSTILITY = 60; // cannot ally a rival above this hostility
export const ALLIANCE_HOSTILITY_DROP = 40; // hostility reduction on acceptance (alliance bond)
export const ALLIANCE_ACCEPTANCE_FLOOR = 0.4;
export const ALLIANCE_ACCEPTANCE_CEILING = 0.9;

// Pre-adulthood betrothals (§10 Q17). Auto-honor at adulthood; explicit break
// costs scandal (+ a hostility bump if the jilted party is a rival).
export const BETROTHAL_BREAK_SCANDAL = 10;
export const BETROTHAL_BREAK_RIVAL_HOSTILITY_BUMP = 15;

// Society marriages (§11.2-B). Per-year cap on new society marriages minted by
// applySocietyMarriageStep (each mints a new society house).
export const SOCIETY_MARRIAGES_PER_YEAR = 2;

// ── P8: Rival Houses, Patronesses & Duels ─────────────────────────────────

// Spec §3 "Rival Houses" (lines 400-406).
export const RIVAL_HOSTILITY_ACTIVATION_THRESHOLD = 25;
export const RIVAL_HOSTILITY_DECAY_PER_TICK = -1;
export const RIVAL_ACTION_COOLDOWN_TICKS = 8;

// Spec §3 line 405 — base weights for the 5 rival actions (P24a added Seduction).
// Integer-scaled (×100) in computeEffectiveWeights to avoid IEEE-754 cross-engine
// variance.
export const RIVAL_ACTION_KINDS = [
  "LeakWhisper",
  "PettySabotage",
  "OpenSabotage",
  "RaiseFactionTension",
  "Seduction",
] as const;
export type RivalActionKind = (typeof RIVAL_ACTION_KINDS)[number];

if (RIVAL_ACTION_KINDS.length !== 5) {
  throw new Error(
    "RIVAL_ACTION_KINDS length pinned to 5 — bump save version and update tests if changing",
  );
}

export const RIVAL_ACTION_WEIGHTS: Readonly<Record<RivalActionKind, number>> = {
  LeakWhisper: 3,
  PettySabotage: 2,
  OpenSabotage: 2,
  RaiseFactionTension: 1,
  Seduction: 1,
};

// Module-load assertion: every kind has a positive base weight.
for (const kind of RIVAL_ACTION_KINDS) {
  if (RIVAL_ACTION_WEIGHTS[kind] <= 0) {
    throw new Error(`Rival action ${kind} must have positive weight`);
  }
}

// Integer scaling for the weighted-pick (resolves Cycle-4 B6 + recurring R10).
// Multiplies float-derived weights to integers before sampling. 100 chosen
// over 1000 for resolution-vs-bit-budget tradeoff (1-percentage-point finer
// than playtest can distinguish).
export const RIVAL_WEIGHT_SCALE = 100;
// Per-point of opposing-rival faction tension above 50, the OpenSabotage
// weight grows by SLOPE_SCALED × (tension - 50) in RIVAL_WEIGHT_SCALE units.
// Stored as INTEGER 5 (not float 0.05) for IEEE-754 cross-engine safety.
export const RIVAL_OPEN_SABOTAGE_TENSION_BIAS_SLOPE_SCALED = 5;

// MONARCH_AUDIENCE_RIVAL_HOSTILITY_DROP at line 89 (P3 stub) becomes load-
// bearing at P8 — applyAudience subtracts the magnitude on full-success.

// PettySabotage: drops player reputation. Clamped [0, 100] at the mutation site.
export const PETTY_SABOTAGE_REPUTATION_DELTA = -2;

// Spec §3 "Patroness Favor" (lines 408-415).
export const PATRONESS_FAVOR_EROSION_PER_TICK = -1;
export const PATRONESS_FAVOR_EROSION_DOUBLED_PER_TICK = -2;
export const PATRONESS_FAVOR_EROSION_SCANDAL_THRESHOLD = 50;
export const PATRONESS_FAVOR_EROSION_TENSION_THRESHOLD = 50;
export const PATRONESS_VETO_THRESHOLD = 20;
// MONARCH_AUDIENCE_PATRONESS_BONUS at line 85 (P3 stub) becomes load-bearing
// at P8 — applyAudience adds +5 favor to every patroness on full-success.

// Spec §3 line 406 — faction-tension cap (pairwise).
export const FACTION_TENSION_CAP = 100;
// RaiseFactionTension delta per rival action.
export const FACTION_TENSION_DELTA_PER_RAISE_ACTION = 10;

// Spec §3 "Duel Resolution" (lines 364-370 + line 532).
export const DUEL_INITIAL_COMPOSURE = 100;
export const DUEL_MAX_EXCHANGES = 12;
if (DUEL_MAX_EXCHANGES !== 12) {
  throw new Error("Spec §3 line 368 pins 12-exchange cap");
}
// Composure restored to this value on the Wounded branch (narrative only).
export const DUEL_WOUNDED_COMPOSURE_RESTORATION = 25;
// 50/50 killed-vs-wounded roll on decisive loss. drawNext returns [0, 1);
// roll < 0.5 → "Killed"; roll >= 0.5 → "Wounded".
export const DUEL_KILLED_VS_WOUNDED_PROBABILITY = 0.5;
// Per-exchange parry probability (resolves the spec's 12-exchange-vs-base-
// power-25 math gap). roll < 0.5 → parried (zero damage); roll >= 0.5 → full
// -50 composure damage. Test-mode overrides forceParryEveryExchange /
// forceNoParryEveryExchange bypass the draw.
export const DUEL_PARRY_PROBABILITY = 0.5;
// Reputation cost for issuing a duel challenge (the "demand satisfaction"
// action). Designer-tunable; pinned to keep the action from being free-clickable.
export const DUEL_DEMAND_SATISFACTION_REPUTATION_COST = -5;

// ── P9: Elopement sprint tunings (spec §3 lines 84-90 + 372-379) ──────────

export const ELOPEMENT_TRACK_LENGTH = 7;
export const ELOPEMENT_PLAYER_START_TILE = 2;
export const ELOPEMENT_FATHER_START_TILE = 0;
export const ELOPEMENT_PUSH_PLAYER_ADVANCE = 1;
export const ELOPEMENT_PUSH_FATHER_ADVANCE = 1;
export const ELOPEMENT_PUSH_COMPOSURE_COST = 5;
export const ELOPEMENT_FRESH_HORSES_PLAYER_ADVANCE = 2;
export const ELOPEMENT_FRESH_HORSES_WEALTH_COST = 10;
export const ELOPEMENT_FRESH_HORSES_MAX_USES = 3;
export const ELOPEMENT_LOSS_SCANDAL_DELTA = 50;

// P24a (C4): per-tick chance a non-player AUTO-resolving sprint "uses fresh
// horses" (eloper tile +ELOPEMENT_FRESH_HORSES_PLAYER_ADVANCE) while uses
// remain. Player sprints stay interactive; this only drives applyElopementAutoResolvePhase.
export const ELOPEMENT_AUTO_FRESH_HORSES_PROBABILITY = 0.25;

// P24a (C5): pursuit-speed trait modifiers. Eloper traits speed the eloping
// tile; pursuer (the target's house head) traits speed the father tile. Applied
// in BOTH the interactive Push/FreshHorses advances and the auto-resolve phase.
// Trait-id validity is asserted at module load in the consumer
// (src/game/rules/elopement.ts), matching the LIFESPAN_TRAIT_MODIFIERS pattern.
export const PURSUIT_SPEED_ELOPER_TRAIT_MODIFIERS: ReadonlyMap<TraitId, number> = new Map<
  TraitId,
  number
>([
  ["Bold" as TraitId, 1],
  ["Brash" as TraitId, 1],
  ["Hedonistic" as TraitId, 1],
]);
export const PURSUIT_SPEED_PURSUER_TRAIT_MODIFIERS: ReadonlyMap<TraitId, number> = new Map<
  TraitId,
  number
>([
  ["Cunning" as TraitId, 1],
  ["Suspicious" as TraitId, 1],
  ["Ambitious" as TraitId, 1],
]);

if (ELOPEMENT_PLAYER_START_TILE >= ELOPEMENT_TRACK_LENGTH) {
  throw new Error(
    "ELOPEMENT_PLAYER_START_TILE >= ELOPEMENT_TRACK_LENGTH: player would start at/past finish line",
  );
}
if (ELOPEMENT_FATHER_START_TILE >= ELOPEMENT_PLAYER_START_TILE) {
  throw new Error(
    "ELOPEMENT_FATHER_START_TILE >= ELOPEMENT_PLAYER_START_TILE: father would start ahead of or alongside the player",
  );
}

// ── P10: Artifacts, Wardrobe, Forgery & Theft ────────────────────────────

// Wardrobe decay (§10 Q10 resolution: global tick). Out-of-season ⇔
// tick - lastRefreshTick > WARDROBE_REFRESH_INTERVAL_TICKS. ≈ 2 in-game years.
export const WARDROBE_REFRESH_INTERVAL_TICKS = 40;
export const PRE_BALL_COMPOSURE_PENALTY_PER_OUT_OF_SEASON_ARTIFACT = 5;

// Forgery surfacing (§3 line 433 "sub-percent"). Stored as basis points
// × 10000 for engine-stable integer comparison (P6 staff-bribery precedent).
export const FORGERY_SURFACING_PROBABILITY_BASIS_POINTS = 30; // 0.30% per tick per unsurfaced forgery
export const FORGERY_SURFACING_VAIN_MOOD_LOCK_DURATION_TICKS = 15;
export const FORGERY_SURFACING_VAIN_AFFECTION_DELTA = -10;

// Thief notice (§3 line 439).
export const THIEF_NOTICE_REPUTATION_THRESHOLD = 70;
export const VALUABLE_ARTIFACT_THRESHOLD = 6;
export const THIEF_NOTICE_PROBABILITY_BASIS_POINTS = 100; // 1% per tick when both gates pass

// Thwart (§3 line 441).
export const THWART_WEALTH_COST = 15;
export const THWART_SUCCESS_PROBABILITY_BASIS_POINTS = 8500; // 85%

// Treason Framing (§3 line 188).
export const TREASON_FRAMING_RIVAL_REPUTATION_DELTA = -25;
export const TREASON_FRAMING_RIVAL_HOSTILITY_DELTA = 20;

if (VALUABLE_ARTIFACT_THRESHOLD < 1) {
  throw new Error(
    "VALUABLE_ARTIFACT_THRESHOLD < 1: every artifact would qualify as valuable, thief notice gate trivial",
  );
}
if (FORGERY_SURFACING_PROBABILITY_BASIS_POINTS >= 10000) {
  throw new Error(
    "FORGERY_SURFACING_PROBABILITY_BASIS_POINTS >= 10000: every forgery would surface in one tick",
  );
}
if (FORGERY_SURFACING_PROBABILITY_BASIS_POINTS <= 0) {
  throw new Error(
    "FORGERY_SURFACING_PROBABILITY_BASIS_POINTS <= 0: surfacing impossible, forgery loop inert",
  );
}
if (PRE_BALL_COMPOSURE_PENALTY_PER_OUT_OF_SEASON_ARTIFACT < 0) {
  throw new Error(
    "PRE_BALL_COMPOSURE_PENALTY_PER_OUT_OF_SEASON_ARTIFACT < 0: bonus instead of penalty",
  );
}

// ── P24b: Procedural Artifacts, Per-Family Wardrobe Decay, Observant Detection ──

// E1: procedural artifact DEFINITIONS generated once at bootstrap from the
// transient `${campaignSeed}|procedural-artifacts` sub-stream. FIXED draw budget
// per def (family, displayName, repBonus, scandalRisk, traitGrant, forgeable,
// forgeCost) so the draw count is part of the determinism contract.
export const PROCEDURAL_ARTIFACT_DEF_COUNT = 12;
export const PROCEDURAL_ARTIFACT_DRAWS_PER_DEF = 7;
export const PROCEDURAL_ARTIFACT_REP_MIN = 2;
export const PROCEDURAL_ARTIFACT_REP_MAX = 9;
export const PROCEDURAL_ARTIFACT_SCANDAL_MAX = 2; // drawn in [0, MAX]
export const PROCEDURAL_ARTIFACT_FORGEABLE_PCT = 50; // % of procedural defs flagged forgeable
export const PROCEDURAL_ARTIFACT_FORGE_COST_MIN = 10;
export const PROCEDURAL_ARTIFACT_FORGE_COST_MAX = 45;
// 0-1 benign conversation-bonus trait granted while equipped. The generator
// draws an index into [none, ...pool]; index 0 ⇒ no grant.
export const PROCEDURAL_ARTIFACT_TRAIT_POOL: readonly TraitId[] = [
  "Charming" as TraitId,
  "Sophisticated" as TraitId,
  "Eloquent" as TraitId,
];

// E2: per-artifact-family wardrobe-refresh interval (§10 Q10). The pre-ball
// penalty reads the per-instance family's interval here; WARDROBE_REFRESH_INTERVAL_TICKS
// stays the fallback for any family absent from this table. Jewels/portraits/deeds
// are timeless (slow decay); carriages/mounts are fashion-bound (fast decay).
export const WARDROBE_REFRESH_INTERVAL_BY_FAMILY: Readonly<Record<ArtifactFamily, number>> = {
  sapphires: 60,
  tiara: 60,
  "ancestral-portrait": 80,
  "family-deed": 80,
  snuffbox: 40,
  phaeton: 25,
  mount: 25,
};

// E3: Observant-trait PRIVATE forgery detection (§10 Q11). A quieter parallel to
// the Vain public cascade — does NOT flip `surfaced`, smaller affection penalty.
export const OBSERVANT_FORGERY_DETECTION_PROBABILITY_BASIS_POINTS = 200; // 2%/tick per (Observant NPC × unsurfaced forgery)
export const OBSERVANT_FORGERY_AFFECTION_PENALTY = -4; // smaller than the Vain -10

// E6: non-player artifact seeding at bootstrap. Rival + society houses own
// equipped procedural instances (drawn from a transient sub-stream, discarded).
// One equipped instance per eligible owner: each rival house head + the first
// SOCIETY_ARTIFACT_HOLDER_COUNT society NPCs (lex by id).
export const SOCIETY_ARTIFACT_HOLDER_COUNT = 4;
export const NON_PLAYER_FORGED_INSTANCE_PCT = 40; // % of forgeable seeded instances flagged forged (→ E3/surfacing targets)

if (PROCEDURAL_ARTIFACT_REP_MIN > PROCEDURAL_ARTIFACT_REP_MAX) {
  throw new Error("PROCEDURAL_ARTIFACT_REP_MIN > PROCEDURAL_ARTIFACT_REP_MAX");
}
if (PROCEDURAL_ARTIFACT_FORGE_COST_MIN <= 0) {
  throw new Error(
    "PROCEDURAL_ARTIFACT_FORGE_COST_MIN <= 0: violates ArtifactDefinition forgeable⇒cost>0 coherence",
  );
}
if (PROCEDURAL_ARTIFACT_FORGE_COST_MIN > PROCEDURAL_ARTIFACT_FORGE_COST_MAX) {
  throw new Error("PROCEDURAL_ARTIFACT_FORGE_COST_MIN > PROCEDURAL_ARTIFACT_FORGE_COST_MAX");
}
if (OBSERVANT_FORGERY_AFFECTION_PENALTY >= 0) {
  throw new Error("OBSERVANT_FORGERY_AFFECTION_PENALTY >= 0: bonus instead of penalty");
}
if (
  OBSERVANT_FORGERY_DETECTION_PROBABILITY_BASIS_POINTS <= 0 ||
  OBSERVANT_FORGERY_DETECTION_PROBABILITY_BASIS_POINTS >= 10000
) {
  throw new Error("OBSERVANT_FORGERY_DETECTION_PROBABILITY_BASIS_POINTS out of (0, 10000)");
}

// ============================================================================
// P11 — Sibling Rivals & Inherited Secrets / Blood Feuds
// plans/phases/11-sibling-rivals-secrets.md
// ============================================================================

// --- Sibling-Rival promotion + action loop (spec §3 lines 480-485) ---

/** Initial hostility baseline at promotion (proxy for spec §3 line 480 "affection-delta"
 *  formula; the original formula is non-derivable because affectionMap is house-keyed,
 *  not character-keyed). Trait modifiers below produce the per-sibling differentiation. */
export const SIBLING_RIVAL_PROMOTION_BASELINE_HOSTILITY = 50;

/** Per-trait hostility modifiers applied at promotion. Clamped to [1, MAX] after summation. */
export const SIBLING_RIVAL_TRAIT_HOSTILITY_JADED = 15;
export const SIBLING_RIVAL_TRAIT_HOSTILITY_AMBITIOUS = 15;
export const SIBLING_RIVAL_TRAIT_HOSTILITY_CUNNING = 10;
export const SIBLING_RIVAL_TRAIT_HOSTILITY_PIOUS = -10;

/** Per-action hostility decay (spec §3 line 483 "−2 per action"). */
export const SIBLING_RIVAL_HOSTILITY_PER_ACTION = -2;

/** Failed-reconciliation hostility delta (spec §3 line 483 "+5 on failed reconciliation"). */
export const SIBLING_RIVAL_HOSTILITY_PER_FAILED_RECONCILIATION = 5;

/** Action cooldown (spec §3 line 481): rivals act only when currentTick − lastActionTick ≥ this. */
export const SIBLING_RIVAL_ACTION_COOLDOWN_TICKS = 5;

/** Reconciliation costs (spec §3 line 485 "−50 wealth, −10 reputation per attempt"). */
export const SIBLING_RIVAL_RECONCILIATION_WEALTH_COST = 50;
export const SIBLING_RIVAL_RECONCILIATION_REPUTATION_COST = 10;

/** Reconciliation success-probability slope endpoints (spec §3 line 485 "inverse hostility").
 *  P(success) = AT_0 + (hostility / 100) × (AT_100 − AT_0). 0.9 at hostility 0 down to 0.1 at 100. */
export const SIBLING_RIVAL_RECONCILIATION_SUCCESS_AT_HOSTILITY_0 = 0.9;
export const SIBLING_RIVAL_RECONCILIATION_SUCCESS_AT_HOSTILITY_100 = 0.1;

/** Hostility cap (spec §3 line 483 "clamped [0, 100]"). */
export const SIBLING_RIVAL_HOSTILITY_MAX = 100;
export const SIBLING_RIVAL_HOSTILITY_MIN = 0;

/** Action-pool weights (spec §3 line 482, ordered heaviest → lightest).
 *  Sum = 100; "no action" branch never fires (every cooldown-eligible tick rolls an action). */
export const SIBLING_RIVAL_ACTION_WEIGHTS = {
  GamblingDebt: 40,
  LeakSecret: 30,
  PettySabotage: 20,
  AutoSabotageScheme: 10,
} as const;
export type SiblingRivalActionKind = keyof typeof SIBLING_RIVAL_ACTION_WEIGHTS;

/** GamblingDebt action effect: wealth drain per fire. */
export const SIBLING_RIVAL_GAMBLING_DEBT_WEALTH_DRAIN = 15;

/** PettySabotage action effect: reputation drain per fire. */
export const SIBLING_RIVAL_PETTY_SABOTAGE_REPUTATION_DRAIN = 2;

// --- Inherited-Secrets ledger (spec §3 lines 498-503; §8 line 685) ---

/** Ledger bound per §8 line 685. Twelve spans ~3 generations of typical play. */
export const MAX_INHERITED_SECRETS = 12;

/** Per-tick surfacing probability per active (unsurfaced) inherited-secret (spec §3 line 501).
 *  Basis points format (P10 precedent): 50 / 10000 = 0.5%. */
export const INHERITED_SECRET_SURFACING_PROBABILITY_BASIS_POINTS = 50;

/** Hostility threshold for "hostile rival" picker eligibility (spec §3 line 501; §7 line 655). */
export const BLOOD_FEUD_RIVAL_HOSTILITY_THRESHOLD = 40;

/** Affection penalty per rival-associate at feud surfacing (spec §3 line 502 "large affection delta").
 *  Magnitude is multiplied by associate count and applied to the single (rivalHouseId, playerHead)
 *  affectionMap key, since affection is house-keyed (not per-character). */
export const BLOOD_FEUD_AFFECTION_PENALTY_PER_ASSOCIATE = 20;

/** Generational-decay resolution: feud auto-resolves N ticks after surfacing if not duel-resolved earlier. */
export const BLOOD_FEUD_DECAY_TICKS_MAX = 50;

// --- Module-load assertions ---

if (Object.values(SIBLING_RIVAL_ACTION_WEIGHTS).some((w) => w <= 0)) {
  throw new Error("SIBLING_RIVAL_ACTION_WEIGHTS: every weight must be positive");
}
{
  const sumWeights = Object.values(SIBLING_RIVAL_ACTION_WEIGHTS).reduce((a, b) => a + b, 0);
  if (sumWeights !== 100) {
    throw new Error(
      `SIBLING_RIVAL_ACTION_WEIGHTS sum ${sumWeights} !== 100: scaled-weight picker assumes total = 100`,
    );
  }
}
if (
  SIBLING_RIVAL_PROMOTION_BASELINE_HOSTILITY <= 0 ||
  SIBLING_RIVAL_PROMOTION_BASELINE_HOSTILITY > SIBLING_RIVAL_HOSTILITY_MAX
) {
  throw new Error(
    "SIBLING_RIVAL_PROMOTION_BASELINE_HOSTILITY out of (0, MAX]: promotion baseline must be a positive hostility",
  );
}
if (SIBLING_RIVAL_ACTION_COOLDOWN_TICKS <= 0) {
  throw new Error("SIBLING_RIVAL_ACTION_COOLDOWN_TICKS must be positive");
}
if (MAX_INHERITED_SECRETS <= 0) {
  throw new Error("MAX_INHERITED_SECRETS must be positive");
}
if (
  INHERITED_SECRET_SURFACING_PROBABILITY_BASIS_POINTS <= 0 ||
  INHERITED_SECRET_SURFACING_PROBABILITY_BASIS_POINTS >= 10000
) {
  throw new Error(
    "INHERITED_SECRET_SURFACING_PROBABILITY_BASIS_POINTS out of (0, 10000): surfacing roll would be impossible or guaranteed",
  );
}
if (BLOOD_FEUD_RIVAL_HOSTILITY_THRESHOLD < 0 || BLOOD_FEUD_RIVAL_HOSTILITY_THRESHOLD > 100) {
  throw new Error("BLOOD_FEUD_RIVAL_HOSTILITY_THRESHOLD out of [0, 100]");
}
if (BLOOD_FEUD_AFFECTION_PENALTY_PER_ASSOCIATE <= 0) {
  throw new Error("BLOOD_FEUD_AFFECTION_PENALTY_PER_ASSOCIATE must be positive");
}
if (BLOOD_FEUD_DECAY_TICKS_MAX <= 0) {
  throw new Error("BLOOD_FEUD_DECAY_TICKS_MAX must be positive");
}

// ── Hyde Park Promenade (P12) ─────────────────────────────────────────────
// Spec §3 "Hyde Park Daytime Promenade" (lines 192-198) + "Hyde Park
// Promenade" (lines 444-450). Pure designer constants; tune via playtest.
// The three base-tactic affection values are deliberately mid-range —
// promenade is the "low-risk" daytime alternative, so deltas are smaller
// than the ballroom's typical +20-40 synergy outcome. The mount bonus
// stacks per-action (not per-session) so a mount-owning player gets
// consistent value across a multi-turn visit.
export const PROMENADE_BASE_AFFECTION_WITTY_BANTER = 8;
export const PROMENADE_BASE_AFFECTION_DEEP_EMPATHY = 8;
export const PROMENADE_BASE_AFFECTION_COMPLIMENT_MOUNT = 12; // gated on target mount-family ownership
export const PROMENADE_PLAYER_MOUNT_MINGLE_BONUS = 5; // per-action; player head equips a mount-family artifact

// ── Conversation / LLM / Memory depth (P26) ───────────────────────────────
// NPC-initiated conversations (Q14). Trigger rolls consume the gameplay PRNG;
// the LLM only authors the opener text (determinism boundary intact).
// Calling-card per-tick roll: 3%/tick (rarer than the P13 global-event 5%/tick
// because a card persists CALLING_CARD_EXPIRY_TICKS before expiring).
export const CALLING_CARD_PROBABILITY_BASIS_POINTS = 300;
// Absolute-end-tick offset: a Pending card expires this many ticks after issue.
export const CALLING_CARD_EXPIRY_TICKS = 5;
// Flat affection penalty applied to the (player, caller) pair on decline.
export const CALLING_CARD_DECLINE_AFFECTION_PENALTY = 5;
// Ballroom-approach per-entry roll: 25% (flavorful, not constant). Fires ONLY
// on a NEW session (gated on currentSessionId() === null before beginSession).
export const BALLROOM_APPROACH_PROBABILITY_BASIS_POINTS = 2500;
// Opener round-trip (NPC speaks first). Client fire-and-forget timeout + server
// composite budget + a small output cap (the opener is one short line).
export const OPENER_TIMEOUT_MS = 10_000;
export const OPENER_SERVER_TIMEOUT_MS = 8_000;
export const OPENER_OUTPUT_TOKEN_BUDGET = 200;

// ── Global Events & Era (P13) ─────────────────────────────────────────────
// Spec §3 "Global Events" (lines 386-392) + "Era Progression" (lines 394-398)
// + §7 line 658 "Cultural-pivot Monarch's Mood against no-artifact house"
// (negative-surge-branch suppression pin). Pure designer constants; tune via
// playtest. The 5%/tick trigger is the spec line 388 value verbatim. WarEffort
// and MarketCrash duration deltas track spec line 389 verbatim. WarEffort
// officer-death and MonarchsMood favored-family surge values are NEW tuning
// (spec only specifies "small per-tick chance of dying" + "fixed per-tick
// reputation surge" — concrete numbers ship per the P13 design decisions).

export const GLOBAL_EVENT_TRIGGER_PROBABILITY_BASIS_POINTS = 500; // 5%/tick; spec line 388
// Probability stored as basis points (× 10000) per CLAUDE.md P6 pin —
// engine-stable integer comparison via Math.floor(roll * 10000) < threshold.

// WarEffort (spec line 389-390: 10 ticks, +1 reputation, -2 wealth per tick)
export const WAR_EFFORT_DURATION_TICKS = 10;
export const WAR_EFFORT_REPUTATION_PER_TICK = 1; // applied to EVERY house
export const WAR_EFFORT_WEALTH_PER_TICK = -2; // applied to EVERY house
export const WAR_EFFORT_OFFICER_DEATH_PROBABILITY_BASIS_POINTS = 100;
// ↑ 1%/tick per MilitaryOfficer character. Across a 10-tick WarEffort,
// expected death rate per officer ≈ 9.6% (1 - 0.99^10). At v1 cohort
// sizes (0 officers per the wired-but-inert design), this is dormant.
// Death follows the canonical pruneOrphanedConversationKeys cascade.
export const WAR_EFFORT_SEDUCTION_AFFECTION_MULTIPLIER = 1.5;
// ↑ P24a: multiplies the PER-TICK Seduction affection accrual
// (SEDUCTION_AFFECTION_PER_TICK) for MilitaryOfficer aggressors only, while a
// WarEffort is active. The suspicion-roll probability is NOT modified —
// positive-outcome buff only.

// MarketCrash (spec line 389: 5 ticks, -3 wealth per tick)
export const MARKET_CRASH_DURATION_TICKS = 5;
export const MARKET_CRASH_WEALTH_PER_TICK = -3; // applied to EVERY house

// MonarchsMood (spec line 389 + 391: 5 ticks; favored-family rolled at start)
export const MONARCHS_MOOD_DURATION_TICKS = 5;
export const MONARCHS_MOOD_FAVORED_FAMILY_REPUTATION_SURGE_PER_TICK = 2;
// ↑ Per-tick rep surge for houses with ≥1 equipped artifact whose family
// matches the event's favoredFamily.
export const MONARCHS_MOOD_SNUB_SCANDAL_PER_TICK = 1;
// ↑ Per-tick scandal hit for houses WITHOUT a matching equipped artifact.
// Spec §7 line 658 pin: no-match branch is +1 scandal ONLY; the cultural-
// surge branch must NOT fire negatively (no scandal doubling, no penalty
// stacking).

// Later-era courier research (spec line 397-398)
export const COURIER_RESEARCH_WEALTH_COST = 30;
// ↑ One-shot wealth cost to unlock fast couriers. Halves NEW courier transit
// times only; in-flight couriers retain their absolute arrivalTick.

if (
  GLOBAL_EVENT_TRIGGER_PROBABILITY_BASIS_POINTS <= 0 ||
  GLOBAL_EVENT_TRIGGER_PROBABILITY_BASIS_POINTS > 10000
) {
  throw new Error("GLOBAL_EVENT_TRIGGER_PROBABILITY_BASIS_POINTS must be in (0, 10000]");
}
if (WAR_EFFORT_DURATION_TICKS <= 0) throw new Error("WAR_EFFORT_DURATION_TICKS must be positive");
if (MARKET_CRASH_DURATION_TICKS <= 0)
  throw new Error("MARKET_CRASH_DURATION_TICKS must be positive");
if (MONARCHS_MOOD_DURATION_TICKS <= 0)
  throw new Error("MONARCHS_MOOD_DURATION_TICKS must be positive");
if (COURIER_RESEARCH_WEALTH_COST <= 0)
  throw new Error("COURIER_RESEARCH_WEALTH_COST must be positive");

// ============================================================================
// P15 — Dynasty Legacies & Renown Perks
// plans/phases/15-dynasty-legacies.md  (spec §3 lines 507-510, §7 line 656)
// ============================================================================

// Perk enum (spec §4 line 560 "perk enum"). Drives DynastyPerkAwardSchema +
// the Ledger Dynasty-tab labels. Player-house-only; awarded at most once per kind.
export const DYNASTY_PERK_KINDS = ["Patronage", "Seduction", "Whispers"] as const;
export type DynastyPerkKind = (typeof DYNASTY_PERK_KINDS)[number];
// Cardinality guard (mirrors TACTICS.length). Adding a 4th perk requires a
// save-version bump (the enum is serialized inside House.awardedDynastyPerks).
if (DYNASTY_PERK_KINDS.length !== 3) {
  throw new Error(
    `DYNASTY_PERK_KINDS length changed (${DYNASTY_PERK_KINDS.length} !== 3) without phase plan + save-version bump`,
  );
}

// --- Triggers (spec §3 lines 507-509) ---
/** Patronage: 3 consecutive heirs surviving to natural death (not duel/assassination). */
export const PATRONAGE_PERK_CONSECUTIVE_NATURAL_DEATHS = 3;
/** Seduction: 4 cumulative successful Seduction completions across all generations. */
export const SEDUCTION_PERK_CUMULATIVE_SUCCESSES = 4;
/** Whispers: cumulative fixed total of whispers reaching Weaponized (plan D6 — "fixed total"). */
export const WHISPERS_PERK_CUMULATIVE_WEAPONIZED = 5;

// --- Effects (spec §3 line 510) ---
/** Patronage: multiplies the positive Country-location wealth yield (plan D2). */
export const PATRONAGE_PERK_RURAL_ESTATE_MULTIPLIER = 5.0;
/** Patronage: flat extra wealth/tick added on top of the multiplied yield while
 *  resident at Country with the perk (plan D2 — makes a 3-generation milestone
 *  reward economically meaningful, not the marginal +1/tick of a bare 2x of yield:1). */
export const PATRONAGE_PERK_RURAL_ESTATE_FLAT_BONUS = 3;
/** Seduction: fixed positive base added to the success affection delta. */
export const SEDUCTION_PERK_AFFECTION_BASE_BONUS = 15;
/** Seduction: halves discovery-scandal (applied to the already-selected delta). */
export const SEDUCTION_PERK_DISCOVERY_SCANDAL_MULTIPLIER = 0.5;
/** Whispers: doubles the per-tick verification increment for player-sourced whispers. */
export const WHISPERS_PERK_VERIFICATION_MULTIPLIER = 2.0;
/** Whispers: per-courier auto-intercept probability on inbound whispers about the player house. */
export const WHISPERS_PERK_INBOUND_INTERCEPT_PROBABILITY = 0.15;

// --- Module-load assertions ---
if (PATRONAGE_PERK_CONSECUTIVE_NATURAL_DEATHS <= 0)
  throw new Error("PATRONAGE_PERK_CONSECUTIVE_NATURAL_DEATHS must be positive");
if (SEDUCTION_PERK_CUMULATIVE_SUCCESSES <= 0)
  throw new Error("SEDUCTION_PERK_CUMULATIVE_SUCCESSES must be positive");
if (WHISPERS_PERK_CUMULATIVE_WEAPONIZED <= 0)
  throw new Error("WHISPERS_PERK_CUMULATIVE_WEAPONIZED must be positive");
if (PATRONAGE_PERK_RURAL_ESTATE_MULTIPLIER <= 1)
  throw new Error("PATRONAGE_PERK_RURAL_ESTATE_MULTIPLIER must be > 1");
if (PATRONAGE_PERK_RURAL_ESTATE_FLAT_BONUS <= 0)
  throw new Error("PATRONAGE_PERK_RURAL_ESTATE_FLAT_BONUS must be positive");
if (
  SEDUCTION_PERK_DISCOVERY_SCANDAL_MULTIPLIER <= 0 ||
  SEDUCTION_PERK_DISCOVERY_SCANDAL_MULTIPLIER >= 1
) {
  throw new Error("SEDUCTION_PERK_DISCOVERY_SCANDAL_MULTIPLIER must be in (0, 1)");
}
if (WHISPERS_PERK_VERIFICATION_MULTIPLIER <= 1)
  throw new Error("WHISPERS_PERK_VERIFICATION_MULTIPLIER must be > 1");
if (
  WHISPERS_PERK_INBOUND_INTERCEPT_PROBABILITY <= 0 ||
  WHISPERS_PERK_INBOUND_INTERCEPT_PROBABILITY >= 1
) {
  throw new Error("WHISPERS_PERK_INBOUND_INTERCEPT_PROBABILITY must be in (0, 1)");
}

// ─── P16: Procedural NPC generation ──────────────────────────────────────
// Society-batch size seeded at campaign start into INDEPENDENT_HOUSE_ID, and
// the adult age band for generated society NPCs. Age max stays < LIFESPAN_RANGE
// minimum (70) so a generated NPC's drawn deathAge always exceeds its age.
export const PROCEDURAL_NPC_COUNT = 20;
export const PROCEDURAL_NPC_MIN_AGE = 20;
export const PROCEDURAL_NPC_MAX_AGE = 55;
// Fixed pooled-trait draws per generated NPC (beyond each profile's guaranteed
// traits). Part of the fixed 8-draw-per-NPC determinism budget.
export const PROCEDURAL_NPC_TRAIT_DRAWS = 2;
// Weighted generation-profile distribution (keys align to PROCEDURAL_PROFILES
// in src/game/fixtures/proceduralProfiles.ts; the integer cumulative-sum pick
// requires the weights to sum to exactly 100).
export const PROCEDURAL_PROFILE_WEIGHTS = {
  None: 40,
  BohemianRake: 20,
  Tutor: 15,
  Spymaster: 15,
  CountryExile: 10,
} as const;

// P22: ongoing society replenishment (year-pass step). Each year-pass tops the
// alive `proc-npc-` cohort back toward PROCEDURAL_NPC_COUNT, capped at this many
// new arrivals per pass (so a plague year doesn't flood the ton in one step).
export const SOCIETY_MAX_ARRIVALS_PER_YEAR = 3;

if (PROCEDURAL_NPC_COUNT <= 0) throw new Error("PROCEDURAL_NPC_COUNT must be positive");
if (PROCEDURAL_NPC_MIN_AGE < ADULTHOOD_AGE_IN_YEARS)
  throw new Error(
    "PROCEDURAL_NPC_MIN_AGE must be >= ADULTHOOD_AGE_IN_YEARS (society NPCs are adults)",
  );
if (PROCEDURAL_NPC_MAX_AGE < PROCEDURAL_NPC_MIN_AGE)
  throw new Error("PROCEDURAL_NPC_MAX_AGE must be >= PROCEDURAL_NPC_MIN_AGE");
if (PROCEDURAL_NPC_MAX_AGE >= LIFESPAN_RANGE[0])
  throw new Error(
    "PROCEDURAL_NPC_MAX_AGE must be < LIFESPAN_RANGE[0] so deathAge always exceeds age",
  );
{
  let _sum = 0;
  for (const w of Object.values(PROCEDURAL_PROFILE_WEIGHTS)) _sum += w;
  if (_sum !== 100)
    throw new Error(
      `PROCEDURAL_PROFILE_WEIGHTS must sum to 100 (got ${_sum}) for the integer cumulative-sum pick`,
    );
}
