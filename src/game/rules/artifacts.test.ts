// P10 artifact-loop verification tests. Covers the critical scenarios from
// the converged plan's verification matrix.

import { describe, expect, it } from "vitest";
import { makeCharacter } from "../__test-utils__/factories";
import {
  PRE_BALL_COMPOSURE_PENALTY_PER_OUT_OF_SEASON_ARTIFACT,
  WARDROBE_REFRESH_INTERVAL_TICKS,
} from "../constants";
import type { GameState } from "../entities";
import { ARTIFACT_REGISTRY } from "../fixtures/artifacts";
import { hashState } from "../hash";
import { type CharacterId, type HouseId, PLAYER_HOUSE_ID } from "../rng";
import { DEFAULT_CAMPAIGN_NAME, createInitialState } from "../store";
import {
  applyEquipArtifactPure,
  applyForgerySurfacingPhase,
  applyPreBallComposurePenaltyPure,
  applyThiefNoticePhase,
  applyUnequipArtifactPure,
  effectiveScandalContributionFromArtifacts,
  getEffectiveReputation,
  getEffectiveTraits,
  selectTargetedArtifactInstance,
} from "./artifacts";

// Narrowing helper — throws with a clear message instead of Biome-forbidden
// non-null-assert. Tests use this when "definitely defined" is the test
// precondition (a missing value here means the bootstrap is broken).
function expectDefined<T>(value: T | undefined | null, label: string): T {
  if (value === undefined || value === null) {
    throw new Error(`expected ${label} to be defined`);
  }
  return value;
}

function getPlayerHead(state: GameState) {
  const player = expectDefined(state.houses.get(PLAYER_HOUSE_ID), "player house");
  const head = expectDefined(
    state.characters.get(player.headOfHouseCharacterId),
    "player head character",
  );
  return { player, head };
}

describe("P10 artifact rules", () => {
  describe("createInitialState bootstrap", () => {
    it("seeds 3 starting artifacts on fresh state", () => {
      const state = createInitialState("alpha", DEFAULT_CAMPAIGN_NAME);
      expect(state.artifactInstances.size).toBe(3);
    });
    it("player head has 2 equipped artifacts (sapphires + mount) at bootstrap", () => {
      const state = createInitialState("alpha", DEFAULT_CAMPAIGN_NAME);
      const { head } = getPlayerHead(state);
      expect(head.equippedArtifactIds.length).toBe(2);
    });
    it("all 3 starting instances reference valid ARTIFACT_REGISTRY definitions", () => {
      const state = createInitialState("alpha", DEFAULT_CAMPAIGN_NAME);
      for (const inst of state.artifactInstances.values()) {
        expect(ARTIFACT_REGISTRY.has(inst.definitionId)).toBe(true);
      }
    });
    it("starting artifact lastRefreshTick === 0 (in-season at bootstrap)", () => {
      const state = createInitialState("alpha", DEFAULT_CAMPAIGN_NAME);
      for (const inst of state.artifactInstances.values()) {
        expect(inst.lastRefreshTick).toBe(0);
      }
    });
  });

  describe("replay determinism — same seed produces identical hash", () => {
    it("30 iterations of createInitialState produce identical hash", () => {
      const seed = "determinism-A";
      const baseline = hashState(createInitialState(seed, DEFAULT_CAMPAIGN_NAME));
      for (let i = 0; i < 30; i++) {
        const replay = hashState(createInitialState(seed, DEFAULT_CAMPAIGN_NAME));
        expect(replay).toBe(baseline);
      }
    });
  });

  describe("getEffectiveReputation projection", () => {
    it("sums equipped artifact reputation bonuses", () => {
      const state = createInitialState("alpha", DEFAULT_CAMPAIGN_NAME);
      const { player } = getPlayerHead(state);
      const base = player.reputation;
      const effective = getEffectiveReputation(state, PLAYER_HOUSE_ID);
      // sapphires=8, mount=3 → +11 over base.
      expect(effective).toBe(Math.min(100, base + 8 + 3));
    });
  });

  describe("getEffectiveTraits projection", () => {
    it("returns base traits when no equipped artifact grants traits", () => {
      const state = createInitialState("alpha", DEFAULT_CAMPAIGN_NAME);
      const { head } = getPlayerHead(state);
      const effective = getEffectiveTraits(state, head.id);
      expect(effective).toEqual(head.traits);
    });
  });

  describe("applyEquipArtifactPure", () => {
    it("rejects when artifact not owned by character", () => {
      const state = createInitialState("alpha", DEFAULT_CAMPAIGN_NAME);
      // Build a synthetic NPC and try to equip player's snuffbox to it.
      const npcId = "test-npc" as CharacterId;
      const npc = makeCharacter({ id: npcId, houseId: "test-house" as HouseId });
      const newChars = new Map(state.characters);
      newChars.set(npcId, npc);
      const snuffbox = expectDefined(
        [...state.artifactInstances.values()].find((i) => i.definitionId === "snuffbox"),
        "snuffbox starter instance",
      );
      const result = applyEquipArtifactPure({ ...state, characters: newChars }, npcId, snuffbox.id);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason.kind).toBe("NotOwnedByCharacter");
    });
    it("equips snuffbox onto player head and removes it via unequip", () => {
      const state = createInitialState("alpha", DEFAULT_CAMPAIGN_NAME);
      const { head } = getPlayerHead(state);
      const snuffbox = expectDefined(
        [...state.artifactInstances.values()].find((i) => i.definitionId === "snuffbox"),
        "snuffbox starter instance",
      );
      const equipped = applyEquipArtifactPure(state, head.id, snuffbox.id);
      expect(equipped.ok).toBe(true);
      if (!equipped.ok) return;
      const headAfter = expectDefined(equipped.state.characters.get(head.id), "head after equip");
      expect(headAfter.equippedArtifactIds.includes(snuffbox.id)).toBe(true);
      const unequipped = applyUnequipArtifactPure(equipped.state, head.id, snuffbox.id);
      expect(unequipped.ok).toBe(true);
      if (!unequipped.ok) return;
      const headFinal = expectDefined(
        unequipped.state.characters.get(head.id),
        "head after unequip",
      );
      expect(headFinal.equippedArtifactIds.includes(snuffbox.id)).toBe(false);
    });
  });

  describe("applyForgerySurfacingPhase", () => {
    it("no-op when state.forgeries is empty AND consumes ZERO RNG draws", () => {
      const state = createInitialState("alpha", DEFAULT_CAMPAIGN_NAME);
      const rngBefore = expectDefined(state.rng.get(PLAYER_HOUSE_ID), "player rng");
      const after = applyForgerySurfacingPhase(state);
      const rngAfter = expectDefined(after.rng.get(PLAYER_HOUSE_ID), "player rng after");
      expect(rngAfter.callCount).toBe(rngBefore.callCount);
      expect(after.forgeries.size).toBe(0);
    });
  });

  describe("applyThiefNoticePhase", () => {
    it("no-op when reputation below threshold AND consumes ZERO RNG draws", () => {
      const state = createInitialState("alpha", DEFAULT_CAMPAIGN_NAME);
      // Bootstrap reputation is 50 + 11 effective = 61, below 70 threshold.
      const rngBefore = expectDefined(state.rng.get(PLAYER_HOUSE_ID), "player rng");
      const after = applyThiefNoticePhase(state);
      const rngAfter = expectDefined(after.rng.get(PLAYER_HOUSE_ID), "player rng after");
      expect(rngAfter.callCount).toBe(rngBefore.callCount);
      expect(after.thiefAttempts.size).toBe(0);
    });
  });

  describe("applyPreBallComposurePenaltyPure", () => {
    it("returns state unchanged when no equipped artifact is out-of-season", () => {
      const state = createInitialState("alpha", DEFAULT_CAMPAIGN_NAME);
      const after = applyPreBallComposurePenaltyPure(state);
      expect(after).toBe(state); // structural-sharing short-circuit
    });
    it("deducts composure when equipped artifacts are out-of-season", () => {
      const state = createInitialState("alpha", DEFAULT_CAMPAIGN_NAME);
      // Set tick past the refresh interval to force out-of-season.
      const ticksPast = WARDROBE_REFRESH_INTERVAL_TICKS + 5;
      const after = applyPreBallComposurePenaltyPure({ ...state, tick: ticksPast });
      const { player, head: headBefore } = getPlayerHead(state);
      const headAfter = expectDefined(
        after.characters.get(player.headOfHouseCharacterId),
        "head after penalty",
      );
      // 2 equipped out-of-season artifacts × penalty per.
      const expectedDeduction = 2 * PRE_BALL_COMPOSURE_PENALTY_PER_OUT_OF_SEASON_ARTIFACT;
      expect(headBefore.composure - headAfter.composure).toBe(expectedDeduction);
    });
  });

  describe("selectTargetedArtifactInstance", () => {
    it("returns the valuable equipped sapphires at bootstrap (mount=3 not valuable; sapphires=8 is)", () => {
      const state = createInitialState("alpha", DEFAULT_CAMPAIGN_NAME);
      // sapphires has reputationBonusWhileEquipped=8 (valuable >= 6).
      // mount has 3 (not valuable). sapphires is equipped at bootstrap.
      const picked = selectTargetedArtifactInstance(state);
      const pickedInst = expectDefined(picked, "selectTargetedArtifactInstance result");
      expect(pickedInst.definitionId).toBe("sapphires");
    });
  });

  describe("effectiveScandalContributionFromArtifacts", () => {
    it("sums scandal-risk-while-worn across player-equipped artifacts", () => {
      const state = createInitialState("alpha", DEFAULT_CAMPAIGN_NAME);
      // sapphires=1, mount=0 → total 1 (snuffbox is unequipped at bootstrap).
      const total = effectiveScandalContributionFromArtifacts(state);
      expect(total).toBe(1);
    });
  });
});
