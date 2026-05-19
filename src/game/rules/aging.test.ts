import { describe, expect, it } from "vitest";
import { makeCharacter, makeCharactersMap } from "../__test-utils__/factories";
import type { Character, GameState, MarriageRecord } from "../entities";
import type { CharacterId, HouseId, MarriageId, RngState } from "../rng";
import { applyAgingStep } from "./aging";

function makeState(overrides: Partial<GameState>): GameState {
  return {
    tick: 0,
    rng: new Map<HouseId, RngState>(),
    houses: new Map(),
    characters: new Map<CharacterId, Character>(),
    marriages: new Map<MarriageId, MarriageRecord>(),
    campaignName: "test-campaign",
    era: "Earlier",
    ...overrides,
  };
}

describe("applyAgingStep", () => {
  it("increments age by 1 for living characters", () => {
    const c = makeCharacter({ id: "c1" as CharacterId, age: 25, deathAge: 90 });
    const state = makeState({ characters: makeCharactersMap([c]) });
    const next = applyAgingStep(state);
    expect(next.characters.get(c.id)?.age).toBe(26);
    expect(next.characters.get(c.id)?.alive).toBe(true);
  });
  it("marks death when age >= deathAge after increment (>= not ===)", () => {
    const c = makeCharacter({ id: "c1" as CharacterId, age: 94, deathAge: 95 });
    const state = makeState({ tick: 70, characters: makeCharactersMap([c]) });
    const next = applyAgingStep(state);
    const updated = next.characters.get(c.id);
    expect(updated?.age).toBe(95);
    expect(updated?.alive).toBe(false);
    expect(updated?.diedAtTick).toBe(70);
  });
  it("skips already-dead characters (no age increment)", () => {
    const c = makeCharacter({ id: "c1" as CharacterId, age: 80, alive: false, diedAtTick: 50 });
    const state = makeState({ characters: makeCharactersMap([c]) });
    const next = applyAgingStep(state);
    expect(next.characters.get(c.id)?.age).toBe(80);
    expect(next.characters.get(c.id)?.diedAtTick).toBe(50);
  });
  it("no PRNG draws consumed (callCount unchanged)", () => {
    const c = makeCharacter({ id: "c1" as CharacterId });
    const state = makeState({ characters: makeCharactersMap([c]) });
    const next = applyAgingStep(state);
    // rng map is unchanged
    expect(next.rng).toBe(state.rng);
  });
});
