// applyHappinessPhase tests — drift over multi-tick, one-way latch
// persistence, Dull-spouse-death halts drift.
//
// Plan: plans/phases/07-family-succession.md "Happiness drift step".

import { describe, expect, it } from "vitest";
import {
  makeCharacter,
  makeCharactersMap,
  makeGameState,
  makeMarriage,
  makeMarriagesMap,
} from "../__test-utils__/factories";
import { HAPPINESS_TEMPTATION_THRESHOLD } from "../constants";
import type { GameState } from "../entities";
import type { CharacterId, MarriageId, TraitId } from "../rng";
import { applyHappinessPhase } from "./happiness";

function makeDullSpouseMarriageState(opts: { tick: number; happiness: number }): GameState {
  const playerId = "player-head" as CharacterId;
  const dullSpouseId = "spouse-dull" as CharacterId;
  const marriageId = "m-test" as MarriageId;
  const player = makeCharacter({
    id: playerId,
    happiness: opts.happiness,
    marriageId,
    dullSpouseExposureStartTick: 0,
  });
  const dullSpouse = makeCharacter({
    id: dullSpouseId,
    traits: ["Dull" as TraitId],
    marriageId,
  });
  const marriage = makeMarriage({
    id: marriageId,
    spouseAId: playerId < dullSpouseId ? playerId : dullSpouseId,
    spouseBId: playerId < dullSpouseId ? dullSpouseId : playerId,
    marriedAtTick: 0,
  });
  return makeGameState({
    tick: opts.tick,
    characters: makeCharactersMap([player, dullSpouse]),
    marriages: makeMarriagesMap([marriage]),
  });
}

describe("applyHappinessPhase — Dull-spouse drift", () => {
  it("drains happiness by -1/tick when spouse carries Dull", () => {
    const state = makeDullSpouseMarriageState({ tick: 1, happiness: 100 });
    const after = applyHappinessPhase(state);
    expect(after.characters.get("player-head" as CharacterId)?.happiness).toBe(99);
  });

  it("does NOT drain happiness when spouse lacks Dull", () => {
    const state = makeDullSpouseMarriageState({ tick: 1, happiness: 100 });
    // Remove Dull from the spouse.
    const spouseId = "spouse-dull" as CharacterId;
    const newChars = new Map(state.characters);
    const spouse = state.characters.get(spouseId);
    if (spouse === undefined) throw new Error("test setup");
    newChars.set(spouseId, { ...spouse, traits: [] });
    const after = applyHappinessPhase({ ...state, characters: newChars });
    expect(after.characters.get("player-head" as CharacterId)?.happiness).toBe(100);
  });

  it("does NOT drain when dullSpouseExposureStartTick is null", () => {
    const state = makeDullSpouseMarriageState({ tick: 1, happiness: 100 });
    const newChars = new Map(state.characters);
    const player = state.characters.get("player-head" as CharacterId);
    if (player === undefined) throw new Error("test setup");
    newChars.set("player-head" as CharacterId, {
      ...player,
      dullSpouseExposureStartTick: null,
    });
    const after = applyHappinessPhase({ ...state, characters: newChars });
    expect(after.characters.get("player-head" as CharacterId)?.happiness).toBe(100);
  });
});

describe("applyHappinessPhase — temptation latch", () => {
  it("flips temptationHookUnlocked at tick 71 (happiness crosses 30 → 29 from 100 with -1/tick)", () => {
    // Simulate by jumping happiness directly to 29 (instead of advancing 71 ticks).
    const state = makeDullSpouseMarriageState({ tick: 71, happiness: 30 });
    const after = applyHappinessPhase(state);
    // After step: happiness becomes 29 (< 30 threshold), latch flips.
    expect(after.characters.get("player-head" as CharacterId)?.happiness).toBe(29);
    expect(after.characters.get("player-head" as CharacterId)?.temptationHookUnlocked).toBe(true);
  });

  it("does NOT flip latch when happiness exactly equals threshold (strict <)", () => {
    // At happiness=31 (above threshold), drift makes it 30 (still NOT < 30).
    const state = makeDullSpouseMarriageState({ tick: 70, happiness: 31 });
    const after = applyHappinessPhase(state);
    expect(after.characters.get("player-head" as CharacterId)?.happiness).toBe(30);
    expect(after.characters.get("player-head" as CharacterId)?.temptationHookUnlocked).toBe(false);
  });

  it("latch persists once set (one-way; happiness restored doesn't unset)", () => {
    const state = makeDullSpouseMarriageState({ tick: 100, happiness: 100 });
    // Force latch on directly.
    const newChars = new Map(state.characters);
    const player = state.characters.get("player-head" as CharacterId);
    if (player === undefined) throw new Error("test setup");
    newChars.set("player-head" as CharacterId, {
      ...player,
      temptationHookUnlocked: true,
    });
    const after = applyHappinessPhase({ ...state, characters: newChars });
    expect(after.characters.get("player-head" as CharacterId)?.temptationHookUnlocked).toBe(true);
  });
});

describe("applyHappinessPhase — determinism + zero draws", () => {
  it("does not advance RNG callCount", () => {
    const state = makeDullSpouseMarriageState({ tick: 1, happiness: 100 });
    const after = applyHappinessPhase(state);
    expect(after.rng).toBe(state.rng);
  });

  it("returns state unchanged if no characters drift (preserves Map reference)", () => {
    const state = makeGameState({ tick: 1 });
    const after = applyHappinessPhase(state);
    expect(after).toBe(state);
  });

  it("threshold constant matches expected v1 tuning", () => {
    expect(HAPPINESS_TEMPTATION_THRESHOLD).toBe(30);
  });
});
