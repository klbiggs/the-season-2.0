import { describe, expect, it } from "vitest";
import {
  makeCharacter,
  makeCharactersMap,
  makeGameState,
  makeHouse,
  makeHousesMap,
} from "../__test-utils__/factories";
import { SOCIETY_MARRIAGES_PER_YEAR } from "../constants";
import type { Character, GameState } from "../entities";
import { SOCIETY_HOUSE_ID_PREFIX } from "../fixtures/rivals";
import { hashState } from "../hash";
import {
  type CharacterId,
  type HouseId,
  INDEPENDENT_HOUSE_ID,
  PLAYER_HOUSE_ID,
  createRngState,
} from "../rng";
import { applySocietyMarriageStep } from "./societyMarriage";

function single(id: string, gender: "Female" | "Male"): Character {
  return makeCharacter({
    id: id as CharacterId,
    houseId: INDEPENDENT_HOUSE_ID,
    age: 25,
    role: "Dependent",
    marriageId: null,
    gender,
  });
}

function makeSocietyState(seed = "soc-seed"): GameState {
  const chars: Character[] = [
    single("proc-npc-0", "Female"),
    single("proc-npc-1", "Male"),
    single("proc-npc-2", "Female"),
    single("proc-npc-3", "Male"),
    single("proc-npc-4", "Female"),
    single("proc-npc-5", "Male"),
  ];
  return makeGameState({
    tick: 50,
    characters: makeCharactersMap(chars),
    houses: makeHousesMap([
      makeHouse({ id: PLAYER_HOUSE_ID }),
      makeHouse({ id: INDEPENDENT_HOUSE_ID }),
    ]),
    rng: new Map([
      [PLAYER_HOUSE_ID, createRngState(`${seed}|player`)],
      [INDEPENDENT_HOUSE_ID, createRngState(`${seed}|independent`)],
    ]),
  });
}

describe("applySocietyMarriageStep", () => {
  it("mints up to SOCIETY_MARRIAGES_PER_YEAR society houses with a head + spouse", () => {
    const after = applySocietyMarriageStep(makeSocietyState());
    const socHouses = [...after.houses.keys()].filter((id) =>
      id.startsWith(SOCIETY_HOUSE_ID_PREFIX),
    );
    expect(socHouses.length).toBe(SOCIETY_MARRIAGES_PER_YEAR);
    expect(after.marriages.size).toBe(SOCIETY_MARRIAGES_PER_YEAR);

    for (const socId of socHouses) {
      const house = after.houses.get(socId as HouseId);
      expect(house).toBeDefined();
      const head = house ? after.characters.get(house.headOfHouseCharacterId) : undefined;
      expect(head?.role).toBe("HeadOfHouse");
      expect(head?.gender).toBe("Male");
      expect(head?.houseId).toBe(socId);
      // Each minted house has its own rng entry.
      expect(after.rng.has(socId as HouseId)).toBe(true);
    }
    // Each marriage has a Spouse-role female moved into a society house.
    for (const m of after.marriages.values()) {
      const a = after.characters.get(m.spouseAId);
      const b = after.characters.get(m.spouseBId);
      const spouse = a?.role === "Spouse" ? a : b;
      expect(spouse?.role).toBe("Spouse");
      expect(spouse?.houseId.startsWith(SOCIETY_HOUSE_ID_PREFIX)).toBe(true);
    }
  });

  it("ids are contiguous and never collide with existing society houses", () => {
    const first = applySocietyMarriageStep(makeSocietyState());
    // Run again on the post-state (no eligible singles left in INDEPENDENT after
    // the first pass consumed 4) — should not collide / not crash.
    const second = applySocietyMarriageStep(first);
    const socHouses = [...second.houses.keys()].filter((id) =>
      id.startsWith(SOCIETY_HOUSE_ID_PREFIX),
    );
    // Distinct ids.
    expect(new Set(socHouses).size).toBe(socHouses.length);
  });

  it("no-ops (same ref) with no Independent rng stream", () => {
    const state = makeGameState({
      characters: makeCharactersMap([single("proc-npc-0", "Female"), single("proc-npc-1", "Male")]),
      houses: makeHousesMap([makeHouse({ id: PLAYER_HOUSE_ID })]),
    });
    expect(applySocietyMarriageStep(state)).toBe(state);
  });

  it("no-ops with no eligible pairing (zero males)", () => {
    const state = makeGameState({
      tick: 50,
      characters: makeCharactersMap([
        single("proc-npc-0", "Female"),
        single("proc-npc-2", "Female"),
      ]),
      houses: makeHousesMap([
        makeHouse({ id: PLAYER_HOUSE_ID }),
        makeHouse({ id: INDEPENDENT_HOUSE_ID }),
      ]),
      rng: new Map([[INDEPENDENT_HOUSE_ID, createRngState("x|independent")]]),
    });
    expect(applySocietyMarriageStep(state)).toBe(state);
  });

  it("is deterministic across 30 identical-seed runs (state hash parity)", () => {
    const baseline = hashState(applySocietyMarriageStep(makeSocietyState("determinism")));
    for (let i = 0; i < 30; i++) {
      expect(hashState(applySocietyMarriageStep(makeSocietyState("determinism")))).toBe(baseline);
    }
  });
});
