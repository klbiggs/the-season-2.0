// Combat resolver tests. Pure rule — no state, no PRNG.
//
// Spec §3 "Conversation Combat Math" + "Stance Modifiers".

import { describe, expect, it } from "vitest";
import type { TraitId } from "../rng";
import { resolveCombat } from "./combat";

describe("resolveCombat", () => {
  describe("override branches", () => {
    it("Flattery vs Defensive → InstantFail with -20 composure + fauxPas", () => {
      const out = resolveCombat({
        tactic: "Flattery",
        stance: "Mingle",
        qualityMultiplier: 1.0,
        targetMood: "Defensive",
        targetTraits: [],
        isAgainstPinnedTarget: false,
        targetHasMountFamilyEquipped: false,
      });
      expect(out.kind).toBe("InstantFail");
      expect(out.affectionDelta).toBe(0);
      expect(out.composureDelta).toBe(-20);
      if (out.kind === "InstantFail") expect(out.fauxPas).toBe(true);
    });

    it("WittyBanter vs Distracted → ZeroYield (no faux-pas, no composure damage)", () => {
      const out = resolveCombat({
        tactic: "WittyBanter",
        stance: "Mingle",
        qualityMultiplier: 1.0,
        targetMood: "Distracted",
        targetTraits: [],
        isAgainstPinnedTarget: false,
        targetHasMountFamilyEquipped: false,
      });
      expect(out.kind).toBe("ZeroYield");
      expect(out.affectionDelta).toBe(0);
      expect(out.composureDelta).toBe(0);
    });

    it("override fires even when synergy traits are present", () => {
      // Flattery vs Defensive: short-circuits before bonus-trait accumulation.
      const out = resolveCombat({
        tactic: "Flattery",
        stance: "TargetedPursuit",
        qualityMultiplier: 1.5,
        targetMood: "Defensive",
        targetTraits: ["Charming" as TraitId],
        isAgainstPinnedTarget: true,
        targetHasMountFamilyEquipped: false,
      });
      expect(out.kind).toBe("InstantFail");
    });
  });

  describe("Normal branch: affection math", () => {
    it("Base only: Base(10) × Mingle(1.0) × qm(1.0) = 10", () => {
      const out = resolveCombat({
        tactic: "Flattery",
        stance: "Mingle",
        qualityMultiplier: 1.0,
        targetMood: "Jealous",
        targetTraits: [],
        isAgainstPinnedTarget: false,
        targetHasMountFamilyEquipped: false,
      });
      expect(out.kind).toBe("Normal");
      if (out.kind === "Normal") {
        expect(out.affectionDelta).toBe(10);
        expect(out.synergy).toBe(false);
      }
    });

    it("Bonus mood adds +15: (10 + 15) × 1.0 × 1.0 = 25, synergy=true", () => {
      // Flattery's bonus mood is Receptive.
      const out = resolveCombat({
        tactic: "Flattery",
        stance: "Mingle",
        qualityMultiplier: 1.0,
        targetMood: "Receptive",
        targetTraits: [],
        isAgainstPinnedTarget: false,
        targetHasMountFamilyEquipped: false,
      });
      expect(out.kind).toBe("Normal");
      if (out.kind === "Normal") {
        expect(out.affectionDelta).toBe(25);
        expect(out.synergy).toBe(true);
      }
    });

    it("Bonus trait adds +15 per match: (10 + 15) × 1.0 × 1.0 = 25, synergy=true", () => {
      // Charming bonuses Flattery.
      const out = resolveCombat({
        tactic: "Flattery",
        stance: "Mingle",
        qualityMultiplier: 1.0,
        targetMood: "Jealous",
        targetTraits: ["Charming" as TraitId],
        isAgainstPinnedTarget: false,
        targetHasMountFamilyEquipped: false,
      });
      expect(out.kind).toBe("Normal");
      if (out.kind === "Normal") {
        expect(out.affectionDelta).toBe(25);
        expect(out.synergy).toBe(true);
      }
    });

    it("Multiple bonus traits stack: (10 + 15 + 15) × 1.0 × 1.0 = 40", () => {
      const out = resolveCombat({
        tactic: "Flattery",
        stance: "Mingle",
        qualityMultiplier: 1.0,
        targetMood: "Jealous",
        targetTraits: ["Charming" as TraitId, "Sophisticated" as TraitId],
        isAgainstPinnedTarget: false,
        targetHasMountFamilyEquipped: false,
      });
      expect(out.kind).toBe("Normal");
      if (out.kind === "Normal") expect(out.affectionDelta).toBe(40);
    });

    it("Wallflower halves affection: 10 × 0.5 × 1.0 = 5", () => {
      const out = resolveCombat({
        tactic: "Flattery",
        stance: "Wallflower",
        qualityMultiplier: 1.0,
        targetMood: "Jealous",
        targetTraits: [],
        isAgainstPinnedTarget: true, // irrelevant for Wallflower
        targetHasMountFamilyEquipped: false,
      });
      expect(out.kind).toBe("Normal");
      if (out.kind === "Normal") expect(out.affectionDelta).toBe(5);
    });

    it("TargetedPursuit ×1.25 only against pinned target: 10 × 1.25 = 13 (rounded)", () => {
      const out = resolveCombat({
        tactic: "Flattery",
        stance: "TargetedPursuit",
        qualityMultiplier: 1.0,
        targetMood: "Jealous",
        targetTraits: [],
        isAgainstPinnedTarget: true,
        targetHasMountFamilyEquipped: false,
      });
      expect(out.kind).toBe("Normal");
      if (out.kind === "Normal") expect(out.affectionDelta).toBe(13); // Math.round(12.5) = 13
    });

    it("TargetedPursuit reverts to baseline against non-pinned target", () => {
      const out = resolveCombat({
        tactic: "Flattery",
        stance: "TargetedPursuit",
        qualityMultiplier: 1.0,
        targetMood: "Jealous",
        targetTraits: [],
        isAgainstPinnedTarget: false,
        targetHasMountFamilyEquipped: false,
      });
      expect(out.kind).toBe("Normal");
      if (out.kind === "Normal") expect(out.affectionDelta).toBe(10);
    });

    it("Quality multiplier scales linearly on affection: 10 × 0.5 = 5", () => {
      const out = resolveCombat({
        tactic: "Flattery",
        stance: "Mingle",
        qualityMultiplier: 0.5,
        targetMood: "Jealous",
        targetTraits: [],
        isAgainstPinnedTarget: false,
        targetHasMountFamilyEquipped: false,
      });
      expect(out.kind).toBe("Normal");
      if (out.kind === "Normal") expect(out.affectionDelta).toBe(5);
    });
  });

  describe("Normal branch: composure math (NOT modulated by quality)", () => {
    it("No penalty traits → 0 composure delta", () => {
      const out = resolveCombat({
        tactic: "Flattery",
        stance: "Mingle",
        qualityMultiplier: 1.5,
        targetMood: "Receptive",
        targetTraits: [],
        isAgainstPinnedTarget: false,
        targetHasMountFamilyEquipped: false,
      });
      if (out.kind === "Normal") expect(out.composureDelta).toBe(0);
    });

    it("Single penalty trait → -10 composure (NOT modulated by quality)", () => {
      // Dull penalizes Flattery.
      const out = resolveCombat({
        tactic: "Flattery",
        stance: "Mingle",
        qualityMultiplier: 1.5, // would scale affection but NOT composure
        targetMood: "Jealous",
        targetTraits: ["Dull" as TraitId],
        isAgainstPinnedTarget: false,
        targetHasMountFamilyEquipped: false,
      });
      if (out.kind === "Normal") expect(out.composureDelta).toBe(-10);
    });

    it("Multiple penalty traits stack: -20", () => {
      // Dull AND Reclusive both penalize Flattery.
      const out = resolveCombat({
        tactic: "Flattery",
        stance: "Mingle",
        qualityMultiplier: 1.0,
        targetMood: "Jealous",
        targetTraits: ["Dull" as TraitId, "Reclusive" as TraitId],
        isAgainstPinnedTarget: false,
        targetHasMountFamilyEquipped: false,
      });
      if (out.kind === "Normal") expect(out.composureDelta).toBe(-20);
    });
  });

  describe("synergy flag", () => {
    it("synergy=true when bonusCount > 0 even if affection clamps post-mod", () => {
      const out = resolveCombat({
        tactic: "Flattery",
        stance: "Wallflower",
        qualityMultiplier: 0.5, // halves
        targetMood: "Jealous",
        targetTraits: ["Charming" as TraitId],
        isAgainstPinnedTarget: false,
        targetHasMountFamilyEquipped: false,
      });
      if (out.kind === "Normal") expect(out.synergy).toBe(true);
    });

    it("synergy=true when moodMatches even without bonus traits", () => {
      const out = resolveCombat({
        tactic: "Flattery",
        stance: "Mingle",
        qualityMultiplier: 1.0,
        targetMood: "Receptive",
        targetTraits: [],
        isAgainstPinnedTarget: false,
        targetHasMountFamilyEquipped: false,
      });
      if (out.kind === "Normal") expect(out.synergy).toBe(true);
    });

    it("synergy=false when neither bonus traits nor mood match", () => {
      const out = resolveCombat({
        tactic: "Flattery",
        stance: "Mingle",
        qualityMultiplier: 1.0,
        targetMood: "Jealous",
        targetTraits: ["Dull" as TraitId], // penalty for Flattery
        isAgainstPinnedTarget: false,
        targetHasMountFamilyEquipped: false,
      });
      if (out.kind === "Normal") expect(out.synergy).toBe(false);
    });
  });
});

// ── P26 (H4): ComplimentMount as a ballroom tactic ────────────────────────
describe("resolveCombat — ComplimentMount ballroom tactic (H4)", () => {
  it("mountless target → ZeroYield (nothing to compliment; no trait/mood bonus)", () => {
    const out = resolveCombat({
      tactic: "ComplimentMount",
      stance: "Mingle",
      qualityMultiplier: 1.5,
      targetMood: "Receptive", // would be a mood-synergy hit if not gated
      targetTraits: ["Vain" as TraitId], // would be a trait-synergy hit if not gated
      isAgainstPinnedTarget: false,
      targetHasMountFamilyEquipped: false,
    });
    expect(out.kind).toBe("ZeroYield");
    expect(out.affectionDelta).toBe(0);
    expect(out.synergy).toBe(false);
  });

  it("mount-owning target → Normal with mood synergy (Receptive)", () => {
    // base 10 + mood-match bonus 15 = 25, × Mingle 1.0 × quality 1.0 = 25.
    const out = resolveCombat({
      tactic: "ComplimentMount",
      stance: "Mingle",
      qualityMultiplier: 1.0,
      targetMood: "Receptive",
      targetTraits: [],
      isAgainstPinnedTarget: false,
      targetHasMountFamilyEquipped: true,
    });
    expect(out.kind).toBe("Normal");
    if (out.kind === "Normal") {
      expect(out.synergy).toBe(true);
      expect(out.affectionDelta).toBe(25);
    }
  });

  it("mount-owning Vain target → trait synergy stacks with mood", () => {
    // base 10 + trait-bonus 15 (Vain) + mood-match 15 (Receptive) = 40.
    const out = resolveCombat({
      tactic: "ComplimentMount",
      stance: "Mingle",
      qualityMultiplier: 1.0,
      targetMood: "Receptive",
      targetTraits: ["Vain" as TraitId],
      isAgainstPinnedTarget: false,
      targetHasMountFamilyEquipped: true,
    });
    expect(out.kind).toBe("Normal");
    if (out.kind === "Normal") {
      expect(out.affectionDelta).toBe(40);
      expect(out.synergy).toBe(true);
    }
  });

  it("mount-owning Reserved target → ComplimentMount penalty (composure hit)", () => {
    const out = resolveCombat({
      tactic: "ComplimentMount",
      stance: "Mingle",
      qualityMultiplier: 1.0,
      targetMood: "Distracted", // no mood synergy
      targetTraits: ["Reserved" as TraitId], // ComplimentMount penalty
      isAgainstPinnedTarget: false,
      targetHasMountFamilyEquipped: true,
    });
    expect(out.kind).toBe("Normal");
    if (out.kind === "Normal") {
      expect(out.composureDelta).toBe(-10); // one penalty trait × -10
    }
  });
});
