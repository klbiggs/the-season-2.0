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
  type TraitId,
  createRngState,
} from "../rng";
import { PLAYER_HOUSE_ID } from "../rng.seeds";
import { findAdultChildren } from "./succession";

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
    whispers: new Map(),
    couriers: new Map(),
    staff: new Map(),
    proposalsLog: new Map(),
    tutorAssignmentsLog: new Map(),
    pendingTutorTraitChoices: new Map(),
    // P8 defaults
    patronesses: new Map(),
    rivalActors: new Map(),
    factionTensions: new Map(),
    duels: new Map(),
    elopement: null,
    artifactInstances: new Map(),
    forgeries: new Map(),
    thiefAttempts: new Map(),
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

describe("findAdultChildren — P7 real body (parent-edge traversal)", () => {
  it("returns empty when no children have parent edge to deadHead", () => {
    const head = makeCharacter({ id: "head" as CharacterId, alive: false });
    const stranger = makeCharacter({
      id: "stranger" as CharacterId,
      age: 30,
      parentCharacterIds: null,
    });
    const state = makeState({ characters: makeCharactersMap([head, stranger]) });
    const result = findAdultChildren(state, head.id);
    expect(result).toEqual([]);
  });

  it("returns adult children whose parentCharacterIds includes deadHeadId", () => {
    const head = makeCharacter({ id: "head" as CharacterId, alive: false });
    const spouse = "spouse" as CharacterId;
    const adultChild = makeCharacter({
      id: "child1" as CharacterId,
      age: 25,
      alive: true,
      parentCharacterIds: [head.id, spouse],
    });
    const minorChild = makeCharacter({
      id: "child2" as CharacterId,
      age: 10,
      alive: true,
      parentCharacterIds: [head.id, spouse],
    });
    const state = makeState({
      characters: makeCharactersMap([head, adultChild, minorChild]),
    });
    const result = findAdultChildren(state, head.id);
    expect(result.map((c) => c.id)).toEqual(["child1"]);
  });

  it("filters out dead children", () => {
    const head = makeCharacter({ id: "head" as CharacterId, alive: false });
    const spouse = "spouse" as CharacterId;
    const deadChild = makeCharacter({
      id: "child1" as CharacterId,
      age: 25,
      alive: false,
      parentCharacterIds: [head.id, spouse],
    });
    const state = makeState({ characters: makeCharactersMap([head, deadChild]) });
    expect(findAdultChildren(state, head.id)).toEqual([]);
  });

  it("returns lex-sorted by character id when multiple adults qualify", () => {
    const head = makeCharacter({ id: "head" as CharacterId, alive: false });
    const spouse = "spouse" as CharacterId;
    const zCharlie = makeCharacter({
      id: "z-charlie" as CharacterId,
      age: 25,
      parentCharacterIds: [head.id, spouse],
    });
    const aAlice = makeCharacter({
      id: "a-alice" as CharacterId,
      age: 25,
      parentCharacterIds: [head.id, spouse],
    });
    const mMick = makeCharacter({
      id: "m-mick" as CharacterId,
      age: 25,
      parentCharacterIds: [head.id, spouse],
    });
    const state = makeState({
      characters: makeCharactersMap([head, zCharlie, aAlice, mMick]),
    });
    const result = findAdultChildren(state, head.id);
    expect(result.map((c) => c.id)).toEqual(["a-alice", "m-mick", "z-charlie"]);
  });
});

describe("succession — widened archetype recompute (P7)", () => {
  it("recomputes archetype for every surviving family-house character (not just heir)", () => {
    // Setup: head dies; surviving siblings + spinster sibling whose traits
    // qualify for Spymaster archetype.
    const head = makeCharacter({
      id: "head" as CharacterId,
      age: 94,
      deathAge: 95,
      role: "HeadOfHouse",
    });
    const spinster = makeCharacter({
      id: "sister" as CharacterId,
      age: 40,
      role: "Spinster",
      traits: ["Cunning" as TraitId],
      gender: "Female",
      marriageId: null,
      archetype: "None", // pre-recompute
    });
    const dependent = makeCharacter({
      id: "brother" as CharacterId,
      age: 30,
      role: "Dependent",
      archetype: "None",
    });
    const house = makeHouse({
      id: PLAYER_HOUSE_ID,
      headOfHouseCharacterId: head.id,
    });
    const state = makeState({
      tick: 70,
      houses: makeHousesMap([house]),
      characters: makeCharactersMap([head, spinster, dependent]),
    });
    const next = runYearPassPure(state);
    // spinster gets Spymaster classification post-succession recompute.
    expect(next.characters.get(spinster.id)?.archetype).toBe("Spymaster");
    // dependent (no qualifying traits) stays None.
    expect(next.characters.get(dependent.id)?.archetype).toBe("None");
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
