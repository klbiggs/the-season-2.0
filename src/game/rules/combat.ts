// Pure conversation combat resolver. Computes affection + composure deltas
// from a tactic + stance + target's mood/traits + LLM quality multiplier.
// Two override branches (Flattery vs Defensive instant-fail, WittyBanter
// vs Distracted zero-yield) short-circuit before any modulation.
//
// Spec §3 "Conversation Combat Math" + "Stance Modifiers" + "Language-
// Model Quality Modulation".
// Plan: plans/phases/04-ballroom-llm.md "src/game/rules/combat.ts".
//
// Determinism: NO PRNG draws, NO state reads. Pure function of the input
// struct. Same inputs always produce same outputs.

import {
  COMBAT_BASE_AFFECTION,
  COMBAT_BONUS_VALUE,
  COMBAT_PENALTY_VALUE,
  CONVERSATION_TRAIT_BONUSES,
  CONVERSATION_TRAIT_PENALTIES,
  FLATTERY_VS_DEFENSIVE_COMPOSURE_DELTA,
  STANCE_MINGLE_AFFECTION_MULT,
  STANCE_TARGETED_PURSUIT_AFFECTION_MULT,
  STANCE_WALLFLOWER_AFFECTION_MULT,
  type Stance,
  TACTIC_BONUS_MOOD,
  type Tactic,
} from "../constants";
import type { Mood } from "../fixtures/moods";
import type { TraitId } from "../rng";

export type CombatInput = {
  tactic: Tactic;
  stance: Stance;
  qualityMultiplier: number; // clamped to [0.5, 1.5] by the LLM layer
  targetMood: Mood;
  targetTraits: ReadonlyArray<TraitId>;
  // For TargetedPursuit's "explicitly selected target" branch.
  isAgainstPinnedTarget: boolean;
  // P26 (H4): gates the ComplimentMount ballroom tactic. A ComplimentMount
  // against a target with no mount-family artifact is a ZeroYield (nothing to
  // compliment) — parallels the promenade 0-base degrade.
  targetHasMountFamilyEquipped: boolean;
};

export type CombatOutcome =
  | {
      kind: "Normal";
      affectionDelta: number;
      composureDelta: number;
      synergy: boolean;
    }
  | {
      kind: "InstantFail";
      affectionDelta: 0;
      composureDelta: number;
      fauxPas: true;
      synergy: false;
    }
  | { kind: "ZeroYield"; affectionDelta: 0; composureDelta: 0; synergy: false };

export function resolveCombat(input: CombatInput): CombatOutcome {
  // ── Override branches (spec §3) ─────────────────────────────────────────
  // Flattery vs Defensive: instant-fail.
  if (input.tactic === "Flattery" && input.targetMood === "Defensive") {
    return {
      kind: "InstantFail",
      affectionDelta: 0,
      composureDelta: FLATTERY_VS_DEFENSIVE_COMPOSURE_DELTA,
      fauxPas: true,
      synergy: false,
    };
  }
  // WittyBanter vs Distracted: zero-yield (no faux-pas).
  if (input.tactic === "WittyBanter" && input.targetMood === "Distracted") {
    return { kind: "ZeroYield", affectionDelta: 0, composureDelta: 0, synergy: false };
  }
  // P26 (H4): ComplimentMount against a target with no mount-family artifact —
  // there is nothing to compliment, so zero-yield (parallels the promenade
  // 0-base degrade). Gated BEFORE synergy so a mountless target never accrues
  // ComplimentMount trait/mood bonuses.
  if (input.tactic === "ComplimentMount" && !input.targetHasMountFamilyEquipped) {
    return { kind: "ZeroYield", affectionDelta: 0, composureDelta: 0, synergy: false };
  }

  // ── Trait/mood synergy gather ───────────────────────────────────────────
  const bonusCount = input.targetTraits.filter((t) =>
    CONVERSATION_TRAIT_BONUSES.get(t)?.includes(input.tactic),
  ).length;
  const penaltyCount = input.targetTraits.filter((t) =>
    CONVERSATION_TRAIT_PENALTIES.get(t)?.includes(input.tactic),
  ).length;
  const moodMatches = TACTIC_BONUS_MOOD.get(input.tactic) === input.targetMood;

  // Synergy keys on any positive contribution (spec §3 line 299) — NOT on
  // post-modulation affection sign.
  const synergy = bonusCount > 0 || moodMatches;

  // ── Affection delta ─────────────────────────────────────────────────────
  const baseAffection =
    COMBAT_BASE_AFFECTION +
    bonusCount * COMBAT_BONUS_VALUE +
    (moodMatches ? COMBAT_BONUS_VALUE : 0);
  const stancedAffection =
    baseAffection * stanceAffectionMultiplier(input.stance, input.isAgainstPinnedTarget);
  const finalAffection = Math.round(stancedAffection * input.qualityMultiplier);

  // ── Composure delta (NOT modulated by quality) ──────────────────────────
  // Spec §3 line 310: "structural damage is phrasing-independent."
  // Normalize -0 to 0 (0 * negative produces -0 in JS) for hash stability.
  const composureDelta = penaltyCount === 0 ? 0 : penaltyCount * COMBAT_PENALTY_VALUE;

  return { kind: "Normal", affectionDelta: finalAffection, composureDelta, synergy };
}

function stanceAffectionMultiplier(stance: Stance, isAgainstPinnedTarget: boolean): number {
  switch (stance) {
    case "Wallflower":
      // Applies to every conversation under the stance (spec §3 line 304).
      return STANCE_WALLFLOWER_AFFECTION_MULT;
    case "Mingle":
      return STANCE_MINGLE_AFFECTION_MULT;
    case "TargetedPursuit":
      return isAgainstPinnedTarget
        ? STANCE_TARGETED_PURSUIT_AFFECTION_MULT
        : STANCE_MINGLE_AFFECTION_MULT;
  }
}
