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
