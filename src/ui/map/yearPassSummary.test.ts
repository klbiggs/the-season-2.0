import { describe, expect, it } from "vitest";
import { makeCharacter, makeGameState, makeHouse } from "../../game/__test-utils__/factories";
import type { CharacterId } from "../../game/rng.seeds";
import { PLAYER_HOUSE_ID } from "../../game/rng.seeds";
import { formatYearPassSummary, summarizeYearPass } from "./yearPassSummary";

const HEAD = "head" as CharacterId;
const HEIR = "heir" as CharacterId;
const CHILD = "child" as CharacterId;
const SPOUSE = "spouse" as CharacterId;

function baseState() {
  return makeGameState({
    houses: new Map([
      [PLAYER_HOUSE_ID, makeHouse({ headOfHouseCharacterId: HEAD, generation: 1 })],
    ]),
    characters: new Map([
      [HEAD, makeCharacter({ id: HEAD, role: "HeadOfHouse", name: "Lord Head" })],
      [HEIR, makeCharacter({ id: HEIR, role: "Dependent", name: "Young Heir" })],
    ]),
  });
}

describe("summarizeYearPass", () => {
  it("reports a birth when a new player-house character appears", () => {
    const before = baseState();
    const after = makeGameState({
      houses: before.houses,
      characters: new Map([
        ...before.characters,
        [CHILD, makeCharacter({ id: CHILD, role: "Dependent", name: "Newborn" })],
      ]),
    });
    const summary = summarizeYearPass(before, after);
    expect(summary.birthsCount).toBe(1);
    expect(summary.deaths).toEqual([]);
    expect(summary.succession).toBeNull();
    expect(formatYearPassSummary(summary)).toContain("A child was born");
  });

  it("excludes non-player-house newcomers from the birth count", () => {
    const before = baseState();
    const after = makeGameState({
      houses: before.houses,
      characters: new Map([
        ...before.characters,
        [CHILD, makeCharacter({ id: CHILD, houseId: "independent" as never, name: "Society NPC" })],
      ]),
    });
    expect(summarizeYearPass(before, after).birthsCount).toBe(0);
  });

  it("lists a non-head death by name", () => {
    const before = makeGameState({
      houses: new Map([[PLAYER_HOUSE_ID, makeHouse({ headOfHouseCharacterId: HEAD })]]),
      characters: new Map([
        [HEAD, makeCharacter({ id: HEAD, role: "HeadOfHouse", name: "Lord Head" })],
        [SPOUSE, makeCharacter({ id: SPOUSE, role: "Spouse", name: "Lady Spouse", alive: true })],
      ]),
    });
    const after = makeGameState({
      houses: before.houses,
      characters: new Map([
        [HEAD, makeCharacter({ id: HEAD, role: "HeadOfHouse", name: "Lord Head" })],
        [SPOUSE, makeCharacter({ id: SPOUSE, role: "Spouse", name: "Lady Spouse", alive: false })],
      ]),
    });
    const summary = summarizeYearPass(before, after);
    expect(summary.deaths).toEqual(["Lady Spouse"]);
    expect(summary.succession).toBeNull();
  });

  it("reports succession (and excludes the dead head from the deaths list)", () => {
    const before = makeGameState({
      houses: new Map([
        [PLAYER_HOUSE_ID, makeHouse({ headOfHouseCharacterId: HEAD, generation: 1 })],
      ]),
      characters: new Map([
        [HEAD, makeCharacter({ id: HEAD, role: "HeadOfHouse", name: "Old Lord", alive: true })],
        [HEIR, makeCharacter({ id: HEIR, role: "Dependent", name: "New Lord", alive: true })],
      ]),
    });
    const after = makeGameState({
      houses: new Map([
        [PLAYER_HOUSE_ID, makeHouse({ headOfHouseCharacterId: HEIR, generation: 2 })],
      ]),
      characters: new Map([
        [HEAD, makeCharacter({ id: HEAD, role: "HeadOfHouse", name: "Old Lord", alive: false })],
        [HEIR, makeCharacter({ id: HEIR, role: "HeadOfHouse", name: "New Lord", alive: true })],
      ]),
    });
    const summary = summarizeYearPass(before, after);
    expect(summary.succession).toEqual({ generation: 2, newHeadName: "New Lord" });
    expect(summary.deaths).toEqual([]); // dead head is covered by succession, not deaths
    expect(formatYearPassSummary(summary)).toContain("New Lord inherits");
    expect(formatYearPassSummary(summary)).toContain("Generation 2");
  });

  it("returns a quiet-year sentinel when nothing changed", () => {
    const before = baseState();
    const after = baseState();
    const summary = summarizeYearPass(before, after);
    expect(summary).toEqual({ birthsCount: 0, deaths: [], succession: null });
    expect(formatYearPassSummary(summary)).toBe("A year passed quietly.");
  });
});
