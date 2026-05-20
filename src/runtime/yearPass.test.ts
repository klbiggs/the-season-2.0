import { describe, expect, it } from "vitest";
import {
  makeCharacter,
  makeCharactersMap,
  makeHouse,
  makeHousesMap,
} from "../game/__test-utils__/factories";
import type { Character, GameState, MarriageRecord } from "../game/entities";
import {
  type CharacterId,
  type HouseId,
  type MarriageId,
  type RngState,
  createRngState,
} from "../game/rng";
import { PLAYER_HOUSE_ID } from "../game/rng.seeds";
import { runYearPassPure } from "./yearPass";

function makeState(overrides: Partial<GameState>): GameState {
  return {
    tick: 0,
    rng: new Map<HouseId, RngState>([[PLAYER_HOUSE_ID, createRngState("alpha")]]),
    houses: new Map(),
    characters: new Map<CharacterId, Character>(),
    marriages: new Map<MarriageId, MarriageRecord>(),
    campaignName: "test-campaign",
    era: "Earlier",
    conversationHistory: new Map(),
    affectionMap: new Map(),
    schemes: new Map(),
    ...overrides,
  };
}

describe("runYearPassPure — tick is read-only across composition", () => {
  it("does not increment state.tick", () => {
    const state = makeState({ tick: 50 });
    const next = runYearPassPure(state);
    expect(next.tick).toBe(50);
  });
});

describe("runYearPassPure — internal ordering (aging → succession → conception)", () => {
  it("aging runs first: a head whose age+1 === deathAge dies same year-pass", () => {
    const head = makeCharacter({
      id: "h" as CharacterId,
      age: 89,
      deathAge: 90,
      role: "HeadOfHouse",
    });
    const house = makeHouse({ headOfHouseCharacterId: head.id });
    const state = makeState({
      tick: 50,
      houses: makeHousesMap([house]),
      characters: makeCharactersMap([head]),
    });
    const next = runYearPassPure(state);
    expect(next.characters.get(head.id)?.alive).toBe(false);
    // Succession then runs against the now-dead head and sets heirless.
    expect(next.houses.get(house.id)?.heirless).toBe(true);
  });
});

// P5: locks the rationale for dropping `publishSchemeTransitions(before,
// after)` from the `runYearPass` store-action wrapper. runYearPassPure
// composes aging + succession + conception — none of those steps mutate
// state.schemes or house.grievances. If a future phase extends year-pass
// composition to touch those surfaces, this assertion will catch the
// invariant break and the wrapper must add publishSchemeTransitions.
describe("runYearPassPure — schemes/grievances no-op invariant (P5)", () => {
  it("state.schemes Map identity preserved across year-pass", () => {
    const head = makeCharacter({ id: "h" as CharacterId, age: 30, deathAge: 90 });
    const house = makeHouse({ headOfHouseCharacterId: head.id });
    const state = makeState({
      houses: makeHousesMap([house]),
      characters: makeCharactersMap([head]),
    });
    const next = runYearPassPure(state);
    expect(next.schemes).toBe(state.schemes);
  });

  it("each house's grievances array identity preserved across year-pass", () => {
    const head = makeCharacter({ id: "h" as CharacterId, age: 30, deathAge: 90 });
    const house = makeHouse({ headOfHouseCharacterId: head.id });
    const state = makeState({
      houses: makeHousesMap([house]),
      characters: makeCharactersMap([head]),
    });
    const next = runYearPassPure(state);
    for (const [id, h] of state.houses) {
      expect(next.houses.get(id)?.grievances).toBe(h.grievances);
    }
  });
});
