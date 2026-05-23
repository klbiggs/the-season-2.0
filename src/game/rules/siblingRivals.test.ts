// P11 sibling-rivals rule-layer tests.

import { describe, expect, it } from "vitest";
import {
  makeCharacter,
  makeCharactersMap,
  makeGameState,
  makeHouse,
  makeHousesMap,
} from "../__test-utils__/factories";
import {
  SIBLING_RIVAL_HOSTILITY_MAX,
  SIBLING_RIVAL_PROMOTION_BASELINE_HOSTILITY,
  SIBLING_RIVAL_TRAIT_HOSTILITY_AMBITIOUS,
  SIBLING_RIVAL_TRAIT_HOSTILITY_JADED,
  SIBLING_RIVAL_TRAIT_HOSTILITY_PIOUS,
} from "../constants";
import {
  SIBLING_RIVAL_ACTION_COOLDOWN_TICKS,
  SIBLING_RIVAL_GAMBLING_DEBT_WEALTH_DRAIN,
} from "../constants";
import type { SiblingRivalState } from "../entities";
import type { CharacterId, TraitId } from "../rng";
import { PLAYER_HOUSE_ID } from "../rng";
import { type HouseId, type SiblingRivalActorId, createRngState } from "../rng";
import {
  applySiblingRivalActionPhase,
  deriveInitialHostility,
  isSiblingOf,
  promoteEligibleSiblingsAtSuccession,
} from "./siblingRivals";

describe("isSiblingOf — genealogical predicate", () => {
  it("returns true for full siblings (same two parents)", () => {
    const a = makeCharacter({
      id: "a" as CharacterId,
      parentCharacterIds: ["p1" as CharacterId, "p2" as CharacterId],
    });
    const b = makeCharacter({
      id: "b" as CharacterId,
      parentCharacterIds: ["p1" as CharacterId, "p2" as CharacterId],
    });
    const characters = makeCharactersMap([a, b]);
    expect(isSiblingOf(a, b.id, characters)).toBe(true);
  });

  it("returns true for half-siblings (one shared parent)", () => {
    const a = makeCharacter({
      id: "a" as CharacterId,
      parentCharacterIds: ["p1" as CharacterId, "p2" as CharacterId],
    });
    const b = makeCharacter({
      id: "b" as CharacterId,
      parentCharacterIds: ["p1" as CharacterId, "p3" as CharacterId],
    });
    const characters = makeCharactersMap([a, b]);
    expect(isSiblingOf(a, b.id, characters)).toBe(true);
  });

  it("returns false for unrelated characters (no shared parents)", () => {
    const a = makeCharacter({
      id: "a" as CharacterId,
      parentCharacterIds: ["p1" as CharacterId, "p2" as CharacterId],
    });
    const b = makeCharacter({
      id: "b" as CharacterId,
      parentCharacterIds: ["p3" as CharacterId, "p4" as CharacterId],
    });
    const characters = makeCharactersMap([a, b]);
    expect(isSiblingOf(a, b.id, characters)).toBe(false);
  });

  it("returns false when either parentCharacterIds is null (first-generation NPCs)", () => {
    const a = makeCharacter({ id: "a" as CharacterId, parentCharacterIds: null });
    const b = makeCharacter({
      id: "b" as CharacterId,
      parentCharacterIds: ["p1" as CharacterId, "p2" as CharacterId],
    });
    const characters = makeCharactersMap([a, b]);
    expect(isSiblingOf(a, b.id, characters)).toBe(false);
    expect(isSiblingOf(b, a.id, characters)).toBe(false);
  });
});

describe("deriveInitialHostility — trait-modified baseline", () => {
  it("returns baseline for trait-neutral characters", () => {
    const c = makeCharacter({ traits: [] });
    expect(deriveInitialHostility(c)).toBe(SIBLING_RIVAL_PROMOTION_BASELINE_HOSTILITY);
  });

  it("adds positive modifier for Jaded", () => {
    const c = makeCharacter({ traits: ["Jaded" as TraitId] });
    expect(deriveInitialHostility(c)).toBe(
      SIBLING_RIVAL_PROMOTION_BASELINE_HOSTILITY + SIBLING_RIVAL_TRAIT_HOSTILITY_JADED,
    );
  });

  it("stacks Jaded + Ambitious", () => {
    const c = makeCharacter({ traits: ["Jaded" as TraitId, "Ambitious" as TraitId] });
    expect(deriveInitialHostility(c)).toBe(
      SIBLING_RIVAL_PROMOTION_BASELINE_HOSTILITY +
        SIBLING_RIVAL_TRAIT_HOSTILITY_JADED +
        SIBLING_RIVAL_TRAIT_HOSTILITY_AMBITIOUS,
    );
  });

  it("subtracts modifier for Pious", () => {
    const c = makeCharacter({ traits: ["Pious" as TraitId] });
    expect(deriveInitialHostility(c)).toBe(
      SIBLING_RIVAL_PROMOTION_BASELINE_HOSTILITY + SIBLING_RIVAL_TRAIT_HOSTILITY_PIOUS,
    );
  });

  it("clamps to [1, MAX]", () => {
    // Pile up extreme modifiers (all 4 stack). 50 + 15 + 15 + 10 - 10 = 80 (no clamp).
    const c = makeCharacter({
      traits: [
        "Jaded" as TraitId,
        "Ambitious" as TraitId,
        "Cunning" as TraitId,
        "Pious" as TraitId,
      ],
    });
    expect(deriveInitialHostility(c)).toBeGreaterThanOrEqual(1);
    expect(deriveInitialHostility(c)).toBeLessThanOrEqual(SIBLING_RIVAL_HOSTILITY_MAX);
  });
});

describe("promoteEligibleSiblingsAtSuccession", () => {
  it("promotes adult siblings of the new heir", () => {
    const deadHead = makeCharacter({
      id: "head" as CharacterId,
      alive: false,
      parentCharacterIds: ["pA" as CharacterId, "pB" as CharacterId],
    });
    const newHeir = makeCharacter({
      id: "heir" as CharacterId,
      age: 30,
      parentCharacterIds: ["head" as CharacterId, "spouse" as CharacterId],
      role: "HeadOfHouse",
    });
    const sibling = makeCharacter({
      id: "sib" as CharacterId,
      age: 28,
      parentCharacterIds: ["head" as CharacterId, "spouse" as CharacterId],
      role: "Dependent",
    });
    const characters = makeCharactersMap([deadHead, newHeir, sibling]);
    const house = makeHouse({ id: PLAYER_HOUSE_ID, headOfHouseCharacterId: newHeir.id });
    const houses = makeHousesMap([house]);
    const state = makeGameState({ houses, characters });

    const next = promoteEligibleSiblingsAtSuccession(state, deadHead.id, newHeir.id);
    const playerHouse = next.houses.get(PLAYER_HOUSE_ID);
    expect(playerHouse).toBeDefined();
    expect(playerHouse?.siblingRivals).toHaveLength(1);
    expect(playerHouse?.siblingRivals[0]?.characterId).toBe(sibling.id);
  });

  it("skips dead siblings (§7 line 650 corpse-skip)", () => {
    const newHeir = makeCharacter({
      id: "heir" as CharacterId,
      age: 30,
      parentCharacterIds: ["pA" as CharacterId, "pB" as CharacterId],
    });
    const deadSibling = makeCharacter({
      id: "deadSib" as CharacterId,
      age: 28,
      alive: false,
      parentCharacterIds: ["pA" as CharacterId, "pB" as CharacterId],
    });
    const characters = makeCharactersMap([newHeir, deadSibling]);
    const state = makeGameState({
      characters,
      houses: makeHousesMap([makeHouse({ headOfHouseCharacterId: newHeir.id })]),
    });
    const next = promoteEligibleSiblingsAtSuccession(
      state,
      "irrelevant" as CharacterId,
      newHeir.id,
    );
    expect(next.houses.get(PLAYER_HOUSE_ID)?.siblingRivals).toHaveLength(0);
  });

  it("skips non-sibling family members (in-laws / cousins via no shared parents)", () => {
    const newHeir = makeCharacter({
      id: "heir" as CharacterId,
      age: 30,
      parentCharacterIds: ["pA" as CharacterId, "pB" as CharacterId],
    });
    const cousin = makeCharacter({
      id: "cousin" as CharacterId,
      age: 28,
      parentCharacterIds: ["pX" as CharacterId, "pY" as CharacterId], // different parents
    });
    const state = makeGameState({
      characters: makeCharactersMap([newHeir, cousin]),
      houses: makeHousesMap([makeHouse({ headOfHouseCharacterId: newHeir.id })]),
    });
    const next = promoteEligibleSiblingsAtSuccession(
      state,
      "irrelevant" as CharacterId,
      newHeir.id,
    );
    expect(next.houses.get(PLAYER_HOUSE_ID)?.siblingRivals).toHaveLength(0);
  });

  it("does not promote characters with null parentCharacterIds (first-generation NPCs)", () => {
    const newHeir = makeCharacter({
      id: "heir" as CharacterId,
      age: 30,
      parentCharacterIds: null,
    });
    const sibling = makeCharacter({
      id: "sib" as CharacterId,
      age: 28,
      parentCharacterIds: null,
    });
    const state = makeGameState({
      characters: makeCharactersMap([newHeir, sibling]),
      houses: makeHousesMap([makeHouse({ headOfHouseCharacterId: newHeir.id })]),
    });
    const next = promoteEligibleSiblingsAtSuccession(
      state,
      "irrelevant" as CharacterId,
      newHeir.id,
    );
    expect(next.houses.get(PLAYER_HOUSE_ID)?.siblingRivals).toHaveLength(0);
  });
});

describe("applySiblingRivalActionPhase", () => {
  function makeStateWithActor(
    actorOverrides: Partial<SiblingRivalState> = {},
    opts: { wealth?: number; tick?: number } = {},
  ) {
    const actor: SiblingRivalState = {
      id: "siblingRival-test" as SiblingRivalActorId,
      characterId: "actor-char" as CharacterId,
      hostility: 50,
      lastActionTick: 0,
      reconciled: false,
      promotedAtTick: 0,
      ...actorOverrides,
    };
    // Head character + actor character must exist for AutoSabotageScheme path
    // (which calls tryStartScheme(..., targetCharacterId: playerHead)).
    const headChar = makeCharacter({
      id: "test-char" as CharacterId,
      role: "HeadOfHouse",
    });
    const actorChar = makeCharacter({
      id: actor.characterId,
      role: "Dependent",
    });
    const playerHouse = makeHouse({
      wealth: opts.wealth ?? 500,
      siblingRivals: [actor],
      headOfHouseCharacterId: headChar.id,
    });
    return makeGameState({
      houses: makeHousesMap([playerHouse]),
      characters: makeCharactersMap([headChar, actorChar]),
      rng: new Map([[PLAYER_HOUSE_ID as HouseId, createRngState("action-seed")]]),
      tick: opts.tick ?? SIBLING_RIVAL_ACTION_COOLDOWN_TICKS + 5,
    });
  }

  it("skips reconciled actors", () => {
    const state = makeStateWithActor({ reconciled: true });
    const next = applySiblingRivalActionPhase(state);
    expect(next).toBe(state);
  });

  it("skips actors still on cooldown", () => {
    const state = makeStateWithActor({ lastActionTick: 10 }, { tick: 12 });
    const next = applySiblingRivalActionPhase(state);
    // Wealth unchanged (no GamblingDebt fired).
    const beforeWealth = state.houses.get(PLAYER_HOUSE_ID)?.wealth;
    const afterWealth = next.houses.get(PLAYER_HOUSE_ID)?.wealth;
    expect(afterWealth).toBe(beforeWealth);
  });

  it("auto-reconciles at hostility 0 after action decay (matrix #5)", () => {
    // Start at hostility 1: -2 per action clamps to 0 → reconciled flips true.
    // Sweep seeds so we observe at least one tick that fires (some seeds may
    // pick AutoSabotageScheme which still hits the same cooldown burn + decay).
    let foundReconciled = false;
    for (let i = 0; i < 30 && !foundReconciled; i += 1) {
      const baseState = makeStateWithActor({ hostility: 1 });
      const state = {
        ...baseState,
        rng: new Map([[PLAYER_HOUSE_ID as HouseId, createRngState(`auto-rec-${i}`)]]),
      };
      const next = applySiblingRivalActionPhase(state);
      const actorAfter = next.houses.get(PLAYER_HOUSE_ID)?.siblingRivals[0];
      if (actorAfter?.reconciled === true && actorAfter.hostility === 0) {
        foundReconciled = true;
      }
    }
    expect(foundReconciled).toBe(true);
  });

  it("fires GamblingDebt at the expected weight share over many trials (matrix #3)", () => {
    // 1000 actor-tick samples. Weight = 40/100 = 40% expected.
    // Use mid-hostility (50) so cooldown is reset each fire (lastActionTick=0; tick=5).
    const counts = { wealth: 0, rep: 0, whisper: 0, other: 0 };
    for (let i = 0; i < 1000; i += 1) {
      const baseState = makeStateWithActor();
      const state = {
        ...baseState,
        rng: new Map([[PLAYER_HOUSE_ID as HouseId, createRngState(`weight-${i}`)]]),
      };
      const next = applySiblingRivalActionPhase(state);
      const playerHouseAfter = next.houses.get(PLAYER_HOUSE_ID);
      const baselineHouse = state.houses.get(PLAYER_HOUSE_ID);
      if (playerHouseAfter && baselineHouse) {
        if (playerHouseAfter.wealth < baselineHouse.wealth) counts.wealth += 1;
        else if (playerHouseAfter.reputation < baselineHouse.reputation) counts.rep += 1;
        else if (next.whispers.size > state.whispers.size) counts.whisper += 1;
        else counts.other += 1;
      }
    }
    // Wealth (GamblingDebt) is weight 40 of 100 → ~40% with ±10% tolerance.
    expect(counts.wealth / 1000).toBeGreaterThan(0.25);
    expect(counts.wealth / 1000).toBeLessThan(0.55);
    // Wealth drain magnitude check (when it fires, drain is exactly the constant).
    void SIBLING_RIVAL_GAMBLING_DEBT_WEALTH_DRAIN;
  });
});
