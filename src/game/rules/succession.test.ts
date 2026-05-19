import { describe, expect, it } from "vitest";
import { runYearPassPure } from "../../runtime/yearPass";
import {
  makeCharacter,
  makeCharactersMap,
  makeHouse,
  makeHousesMap,
} from "../__test-utils__/factories";
import type { Character, GameState, MarriageRecord } from "../entities";
import {
  type CharacterId,
  type HouseId,
  type MarriageId,
  type RngState,
  createRngState,
} from "../rng";
import { PLAYER_HOUSE_ID } from "../rng.seeds";

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

describe("synthetic-state succession — heirless edge case", () => {
  it("age=94, deathAge=95, tick=70 → head dies, heirless, ancestor summary appended", () => {
    const head = makeCharacter({
      id: "player-head" as CharacterId,
      name: "Player I",
      age: 94,
      deathAge: 95,
      birthTick: -24, // consistent with age=94, tick=70: born 94 ticks before tick=70
      role: "HeadOfHouse",
    });
    const house = makeHouse({
      id: PLAYER_HOUSE_ID,
      headOfHouseCharacterId: head.id,
    });
    const state = makeState({
      tick: 70,
      houses: makeHousesMap([house]),
      characters: makeCharactersMap([head]),
    });
    const next = runYearPassPure(state);
    const updatedHead = next.characters.get(head.id);
    const updatedHouse = next.houses.get(house.id);
    expect(updatedHead?.alive).toBe(false);
    expect(updatedHead?.diedAtTick).toBe(70);
    expect(updatedHead?.age).toBe(95);
    expect(updatedHouse?.heirless).toBe(true);
    expect(updatedHouse?.ancestorSummary).toHaveLength(1);
    expect(updatedHouse?.ancestorSummary[0]).toBe("G0: Player I (b. -24, d. 70)");
  });
});

describe("succession — idempotence gate on heirless flag", () => {
  it("subsequent year-pass on a heirless house does not duplicate ancestor summary", () => {
    const head = makeCharacter({
      id: "player-head" as CharacterId,
      name: "Player I",
      age: 94,
      deathAge: 95,
      birthTick: -24,
      role: "HeadOfHouse",
    });
    const house = makeHouse({
      id: PLAYER_HOUSE_ID,
      headOfHouseCharacterId: head.id,
    });
    const state = makeState({
      tick: 70,
      houses: makeHousesMap([house]),
      characters: makeCharactersMap([head]),
    });
    const after1 = runYearPassPure(state);
    const after2 = runYearPassPure(after1);
    expect(after2.houses.get(house.id)?.ancestorSummary).toHaveLength(1); // not 2
  });
});
