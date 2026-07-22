// P25 R5 — findGrievanceAcrossHouses (promoted from duel.ts's module-private
// findGrievanceHolderHouseId to the P8-pre-named lookups home).

import { describe, expect, it } from "vitest";
import { makeGameState, makeHouse, makeHousesMap } from "../__test-utils__/factories";
import type { Grievance } from "../entities";
import { type GrievanceId, type HouseId, PLAYER_HOUSE_ID } from "../rng";
import { findGrievanceAcrossHouses } from "./lookups";

const RIVAL = "rival-ashford" as HouseId;

function grievance(id: string): Grievance {
  return {
    id: id as GrievanceId,
    perpetratorHouseId: PLAYER_HOUSE_ID,
    defendantCharacterId: null,
    source: "Sabotage",
    schemeId: null,
    recordedAtTick: 5,
    resolved: false,
  };
}

describe("findGrievanceAcrossHouses", () => {
  it("returns the holder house + grievance when a grievance lives on a non-player house", () => {
    const state = makeGameState({
      houses: makeHousesMap([
        makeHouse({ id: PLAYER_HOUSE_ID }),
        makeHouse({ id: RIVAL, grievances: [grievance("g1")] }),
      ]),
    });
    const found = findGrievanceAcrossHouses(state, "g1" as GrievanceId);
    expect(found?.holderHouseId).toBe(RIVAL);
    expect(found?.grievance.id).toBe("g1");
  });

  it("returns null when no house holds the grievance", () => {
    const state = makeGameState({ houses: makeHousesMap([makeHouse({ id: PLAYER_HOUSE_ID })]) });
    expect(findGrievanceAcrossHouses(state, "missing" as GrievanceId)).toBeNull();
  });
});
