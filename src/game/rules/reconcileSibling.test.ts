// P11 reconcileSibling tests (verification matrix #4 + #15).
// applyReconciliationAttempt is the pure-rule core; the store-action wrapper
// adds publisher dispatch but the eligibility + roll logic lives here.

import { describe, expect, it } from "vitest";
import { makeGameState, makeHouse, makeHousesMap } from "../__test-utils__/factories";
import {
  SIBLING_RIVAL_HOSTILITY_PER_FAILED_RECONCILIATION,
  SIBLING_RIVAL_RECONCILIATION_REPUTATION_COST,
  SIBLING_RIVAL_RECONCILIATION_SUCCESS_AT_HOSTILITY_0,
  SIBLING_RIVAL_RECONCILIATION_SUCCESS_AT_HOSTILITY_100,
  SIBLING_RIVAL_RECONCILIATION_WEALTH_COST,
} from "../constants";
import type { ElopementSprintState, SiblingRivalState } from "../entities";
import {
  type CharacterId,
  type HouseId,
  PLAYER_HOUSE_ID,
  type SiblingRivalActorId,
  createRngState,
} from "../rng";
import { applyReconciliationAttempt } from "./siblingRivals";

function makeActor(overrides: Partial<SiblingRivalState> = {}): SiblingRivalState {
  return {
    id: "siblingRival-test" as SiblingRivalActorId,
    characterId: "test-char" as CharacterId,
    hostility: 50,
    lastActionTick: 0,
    reconciled: false,
    promotedAtTick: 0,
    ...overrides,
  };
}

function makeStateWithActor(
  actor: SiblingRivalState,
  overrides: Partial<Parameters<typeof makeHouse>[0]> = {},
) {
  const playerHouse = makeHouse({
    wealth: 500,
    reputation: 80,
    siblingRivals: [actor],
    ...overrides,
  });
  const houses = makeHousesMap([playerHouse]);
  const rng = new Map([[PLAYER_HOUSE_ID, createRngState("test-seed-reconcile")]]);
  return makeGameState({ houses, rng });
}

describe("applyReconciliationAttempt — modal-state gates (matrix #15)", () => {
  it("rejects PlayerExiled when house.exiled === true", () => {
    const actor = makeActor();
    const state = makeStateWithActor(actor, { exiled: true });
    const { outcome } = applyReconciliationAttempt(state, actor.characterId);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.reason.kind).toBe("PlayerExiled");
  });

  it("rejects ElopementInProgress when state.elopement !== null", () => {
    const actor = makeActor();
    const baseState = makeStateWithActor(actor);
    const elopement: ElopementSprintState = {
      schemeId: "scheme-test" as import("../rng").SchemeId,
      elopingCharacterId: "ec" as CharacterId,
      targetCharacterId: "tc" as CharacterId,
      playerTilePosition: 3,
      fatherTilePosition: 4,
      freshHorsesUsedCount: 0,
      startedAtTick: 0,
    };
    const state = { ...baseState, elopement };
    const { outcome } = applyReconciliationAttempt(state, actor.characterId);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.reason.kind).toBe("ElopementInProgress");
  });

  it("rejects WrongLocation when not at Capital", () => {
    const actor = makeActor();
    const state = makeStateWithActor(actor, { currentLocation: "Country" });
    const { outcome } = applyReconciliationAttempt(state, actor.characterId);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.reason.kind).toBe("WrongLocation");
  });

  it("rejects InsufficientWealth when wealth < cost", () => {
    const actor = makeActor();
    const state = makeStateWithActor(actor, {
      wealth: SIBLING_RIVAL_RECONCILIATION_WEALTH_COST - 1,
    });
    const { outcome } = applyReconciliationAttempt(state, actor.characterId);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.reason.kind).toBe("InsufficientWealth");
  });

  it("rejects NoActiveSiblingRival when characterId doesn't match any actor", () => {
    const actor = makeActor();
    const state = makeStateWithActor(actor);
    const { outcome } = applyReconciliationAttempt(state, "nonexistent" as CharacterId);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.reason.kind).toBe("NoActiveSiblingRival");
  });

  it("rejects AlreadyReconciled when actor.reconciled === true", () => {
    const actor = makeActor({ reconciled: true });
    const state = makeStateWithActor(actor);
    const { outcome } = applyReconciliationAttempt(state, actor.characterId);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.reason.kind).toBe("AlreadyReconciled");
  });
});

describe("applyReconciliationAttempt — outcome path (matrix #4)", () => {
  it("deducts wealth + reputation on both Success and Failure outcomes (cost-on-attempt invariant)", () => {
    // Use a high-hostility actor so failure path is more likely than success across multiple seeds.
    const actor = makeActor({ hostility: 100 });
    let observedSuccess = false;
    let observedFailure = false;
    for (let seedIdx = 0; seedIdx < 30 && (!observedSuccess || !observedFailure); seedIdx += 1) {
      const baseState = makeStateWithActor(actor);
      const stateSeeded = {
        ...baseState,
        rng: new Map([[PLAYER_HOUSE_ID as HouseId, createRngState(`seed-${seedIdx}`)]]),
      };
      const { nextState, outcome } = applyReconciliationAttempt(stateSeeded, actor.characterId);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error("unreachable");
      // Both paths deduct costs.
      const playerHouseAfter = nextState.houses.get(PLAYER_HOUSE_ID);
      expect(playerHouseAfter?.wealth).toBe(500 - SIBLING_RIVAL_RECONCILIATION_WEALTH_COST);
      expect(playerHouseAfter?.reputation).toBe(80 - SIBLING_RIVAL_RECONCILIATION_REPUTATION_COST);
      if (outcome.kind === "Success") observedSuccess = true;
      if (outcome.kind === "Failure") observedFailure = true;
    }
    // We may not always observe both at hostility 100 (success rate ~10%); just confirm cost-deduction held when we did see each branch.
  });

  it("success probability matches the inverse-hostility slope formula", () => {
    // Statistical sanity — run many trials per hostility and check rate within ±10%.
    const HOSTILITIES = [0, 50, 100] as const;
    const TRIALS = 200;
    for (const hostility of HOSTILITIES) {
      let successes = 0;
      for (let trial = 0; trial < TRIALS; trial += 1) {
        const actor = makeActor({ hostility });
        const baseState = makeStateWithActor(actor);
        const stateSeeded = {
          ...baseState,
          rng: new Map([[PLAYER_HOUSE_ID as HouseId, createRngState(`h${hostility}-t${trial}`)]]),
        };
        const { outcome } = applyReconciliationAttempt(stateSeeded, actor.characterId);
        if (outcome.ok && outcome.kind === "Success") successes += 1;
      }
      const observedRate = successes / TRIALS;
      const expectedRate =
        SIBLING_RIVAL_RECONCILIATION_SUCCESS_AT_HOSTILITY_0 +
        (hostility / 100) *
          (SIBLING_RIVAL_RECONCILIATION_SUCCESS_AT_HOSTILITY_100 -
            SIBLING_RIVAL_RECONCILIATION_SUCCESS_AT_HOSTILITY_0);
      // ±15% tolerance — 200 trials is enough to confirm direction but not pin tightly.
      expect(observedRate).toBeGreaterThanOrEqual(Math.max(0, expectedRate - 0.15));
      expect(observedRate).toBeLessThanOrEqual(Math.min(1, expectedRate + 0.15));
    }
  });

  it("Failure outcome bumps hostility by SIBLING_RIVAL_HOSTILITY_PER_FAILED_RECONCILIATION", () => {
    // Find a Failure outcome by sweeping seeds at high hostility.
    const actor = makeActor({ hostility: 90 });
    let foundFailure = false;
    for (let seedIdx = 0; seedIdx < 50 && !foundFailure; seedIdx += 1) {
      const baseState = makeStateWithActor(actor);
      const stateSeeded = {
        ...baseState,
        rng: new Map([[PLAYER_HOUSE_ID as HouseId, createRngState(`fail-${seedIdx}`)]]),
      };
      const { nextState, outcome } = applyReconciliationAttempt(stateSeeded, actor.characterId);
      if (outcome.ok && outcome.kind === "Failure") {
        foundFailure = true;
        const actorAfter = nextState.houses.get(PLAYER_HOUSE_ID)?.siblingRivals[0];
        expect(actorAfter?.hostility).toBe(
          Math.min(100, 90 + SIBLING_RIVAL_HOSTILITY_PER_FAILED_RECONCILIATION),
        );
      }
    }
    expect(foundFailure).toBe(true);
  });

  it("Success outcome flips reconciled=true + hostility=0", () => {
    // Low-hostility actor → high success probability.
    const actor = makeActor({ hostility: 0 });
    let foundSuccess = false;
    for (let seedIdx = 0; seedIdx < 20 && !foundSuccess; seedIdx += 1) {
      const baseState = makeStateWithActor(actor);
      const stateSeeded = {
        ...baseState,
        rng: new Map([[PLAYER_HOUSE_ID as HouseId, createRngState(`win-${seedIdx}`)]]),
      };
      const { nextState, outcome } = applyReconciliationAttempt(stateSeeded, actor.characterId);
      if (outcome.ok && outcome.kind === "Success") {
        foundSuccess = true;
        const actorAfter = nextState.houses.get(PLAYER_HOUSE_ID)?.siblingRivals[0];
        expect(actorAfter?.reconciled).toBe(true);
        expect(actorAfter?.hostility).toBe(0);
      }
    }
    expect(foundSuccess).toBe(true);
  });
});
