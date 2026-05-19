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
import { advanceTickPure } from "./tickOrchestrator";

function makeState(overrides: Partial<GameState>): GameState {
  return {
    tick: 0,
    rng: new Map<HouseId, RngState>([[PLAYER_HOUSE_ID, createRngState("alpha")]]),
    houses: new Map(),
    characters: new Map<CharacterId, Character>(),
    marriages: new Map<MarriageId, MarriageRecord>(),
    ...overrides,
  };
}

describe("advanceTickPure — phase-array ordering", () => {
  it("increments tick by exactly 1", () => {
    const next = advanceTickPure(makeState({ tick: 5 }));
    expect(next.tick).toBe(6);
  });
  it("applies economy phase (Hemorrhaging tier deducts wealth)", () => {
    const h = makeHouse({ wealth: -50 });
    const next = advanceTickPure(makeState({ houses: makeHousesMap([h]) }));
    // Hemorrhaging: -2 wealth → -52.
    expect(next.houses.get(h.id)?.wealth).toBe(-52);
  });
  it("applies mood drift phase (consumes draws for unlocked living characters)", () => {
    const c = makeCharacter({
      id: "c" as CharacterId,
      houseId: PLAYER_HOUSE_ID,
      alive: true,
      moodLockUntilTick: 0,
    });
    const state = makeState({
      houses: makeHousesMap([makeHouse()]),
      characters: makeCharactersMap([c]),
    });
    const before = state.rng.get(PLAYER_HOUSE_ID)?.callCount ?? 0;
    const next = advanceTickPure(state);
    const after = next.rng.get(PLAYER_HOUSE_ID)?.callCount ?? 0;
    expect(after).toBeGreaterThan(before);
  });
});
