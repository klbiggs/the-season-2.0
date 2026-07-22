import { describe, expect, it } from "vitest";
import { makeCharacter, makeGameState, makeHouse } from "../__test-utils__/factories";
import { AFFECTION_PROPOSAL_THRESHOLD } from "../constants";
import { makePairKey } from "../conversation/types";
import type { Grievance, Scheme } from "../entities";
import { type CharacterId, type GrievanceId, PLAYER_HOUSE_ID, type SchemeId } from "../rng";
import { INDEPENDENT_HOUSE_ID } from "../rng.seeds";
import { computeKeyMoment } from "./keyMoments";

const TARGET_ID = "km-target" as CharacterId;
const PLAYER_HEAD = "km-player-head" as CharacterId;

function baseState(overrides?: {
  affection?: number;
  targetMarried?: boolean;
  grievances?: Grievance[];
  schemes?: Scheme[];
}) {
  const target = makeCharacter({
    id: TARGET_ID,
    houseId: INDEPENDENT_HOUSE_ID,
    alive: true,
    age: 30,
    marriageId: overrides?.targetMarried ? ("m-1" as never) : null,
  });
  const playerHead = makeCharacter({ id: PLAYER_HEAD, houseId: PLAYER_HOUSE_ID, alive: true });
  const affectionMap = new Map<ReturnType<typeof makePairKey>, number>();
  if (overrides?.affection !== undefined) {
    affectionMap.set(makePairKey(PLAYER_HOUSE_ID, TARGET_ID), overrides.affection);
  }
  return makeGameState({
    characters: new Map([
      [TARGET_ID, target],
      [PLAYER_HEAD, playerHead],
    ]),
    houses: new Map([
      [PLAYER_HOUSE_ID, makeHouse({ id: PLAYER_HOUSE_ID, headOfHouseCharacterId: PLAYER_HEAD })],
      [
        INDEPENDENT_HOUSE_ID,
        makeHouse({ id: INDEPENDENT_HOUSE_ID, grievances: overrides?.grievances ?? [] }),
      ],
    ]),
    affectionMap,
    schemes: new Map((overrides?.schemes ?? []).map((s) => [s.id, s])),
  });
}

describe("computeKeyMoment", () => {
  it("returns null with low affection, no grievance, no scheme", () => {
    expect(computeKeyMoment(baseState({ affection: 10 }), TARGET_ID)).toBeNull();
  });

  it("returns 'proposal' at/above the affection threshold for an available target", () => {
    const state = baseState({ affection: AFFECTION_PROPOSAL_THRESHOLD });
    expect(computeKeyMoment(state, TARGET_ID)).toBe("proposal");
  });

  it("does NOT return 'proposal' when the target is already married", () => {
    const state = baseState({ affection: AFFECTION_PROPOSAL_THRESHOLD, targetMarried: true });
    expect(computeKeyMoment(state, TARGET_ID)).not.toBe("proposal");
  });

  it("returns 'duel' when an unresolved grievance links the houses (target-perpetrated)", () => {
    const grievance: Grievance = {
      id: "g-1" as GrievanceId,
      perpetratorHouseId: PLAYER_HOUSE_ID,
      defendantCharacterId: null,
      source: "Sabotage",
      schemeId: null,
      recordedAtTick: 0,
      resolved: false,
    };
    const state = baseState({ affection: 10, grievances: [grievance] });
    expect(computeKeyMoment(state, TARGET_ID)).toBe("duel");
  });

  it("returns 'scheme' when an Active player scheme targets the character", () => {
    const scheme: Scheme = {
      id: "s-1" as SchemeId,
      kind: "Sabotage",
      ownerHouseId: PLAYER_HOUSE_ID,
      aggressorCharacterId: PLAYER_HEAD,
      targetCharacterId: TARGET_ID,
      startedAtTick: 0,
      endsAtTick: 10,
      status: "Active",
      resolvedAtTick: null,
      failureReason: null,
      accumulatedAffection: 0,
    };
    const state = baseState({ affection: 10, schemes: [scheme] });
    expect(computeKeyMoment(state, TARGET_ID)).toBe("scheme");
  });

  it("prioritizes proposal over duel over scheme", () => {
    const grievance: Grievance = {
      id: "g-1" as GrievanceId,
      perpetratorHouseId: PLAYER_HOUSE_ID,
      defendantCharacterId: null,
      source: "Sabotage",
      schemeId: null,
      recordedAtTick: 0,
      resolved: false,
    };
    const state = baseState({ affection: AFFECTION_PROPOSAL_THRESHOLD, grievances: [grievance] });
    expect(computeKeyMoment(state, TARGET_ID)).toBe("proposal");
  });
});
