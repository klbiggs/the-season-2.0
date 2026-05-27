// P24a (C3) — abandonMarriage pure-rule tests.

import { describe, expect, it } from "vitest";
import { makeCharacter, makeGameState, makeHouse, makeMarriage } from "../__test-utils__/factories";
import { ABANDONMENT_RIVAL_HOSTILITY_BUMP, ABANDONMENT_SCANDAL } from "../constants";
import { RIVAL_HOUSES_FIXTURE } from "../fixtures/rivals";
import type { CharacterId, HouseId, MarriageId } from "../rng";
import { PLAYER_HOUSE_ID } from "../rng";
import { applyAbandonMarriagePure } from "./abandonMarriage";

const M_ID = "m-abandon" as MarriageId;
const PLAYER_SPOUSE = "player-spouse" as CharacterId;
const OTHER_SPOUSE = "other-spouse" as CharacterId;
const [firstRivalHouse] = RIVAL_HOUSES_FIXTURE;
if (firstRivalHouse === undefined) throw new Error("RIVAL_HOUSES_FIXTURE must be non-empty");
const RIVAL_HOUSE_ID = firstRivalHouse.houseId;

function setup(
  opts: { otherHouseId?: HouseId; otherHostility?: number; playerScandal?: number } = {},
) {
  const otherHouseId = opts.otherHouseId ?? ("independent" as HouseId);
  const playerSpouse = makeCharacter({
    id: PLAYER_SPOUSE,
    houseId: PLAYER_HOUSE_ID,
    role: "Spouse",
    gender: "Female",
    marriageId: M_ID,
  });
  const otherSpouse = makeCharacter({
    id: OTHER_SPOUSE,
    houseId: otherHouseId,
    role: "Spouse",
    marriageId: M_ID,
  });
  const houses = new Map<HouseId, ReturnType<typeof makeHouse>>([
    [PLAYER_HOUSE_ID, makeHouse({ id: PLAYER_HOUSE_ID, scandal: opts.playerScandal ?? 0 })],
  ]);
  if (otherHouseId !== PLAYER_HOUSE_ID) {
    houses.set(otherHouseId, makeHouse({ id: otherHouseId, hostility: opts.otherHostility ?? 0 }));
  }
  return makeGameState({
    tick: 10,
    characters: new Map([
      [PLAYER_SPOUSE, playerSpouse],
      [OTHER_SPOUSE, otherSpouse],
    ]),
    marriages: new Map([
      [M_ID, makeMarriage({ id: M_ID, spouseAId: PLAYER_SPOUSE, spouseBId: OTHER_SPOUSE })],
    ]),
    houses,
  });
}

describe("applyAbandonMarriagePure", () => {
  it("dissolves the marriage (viaAbandonment), nulls both marriageIds, applies scandal", () => {
    const result = applyAbandonMarriagePure(setup({ playerScandal: 5 }), M_ID);
    if (!result.ok) throw new Error("expected ok");
    const marriage = result.nextState.marriages.get(M_ID);
    expect(marriage?.dissolved).toBe(true);
    expect(marriage?.viaAbandonment).toBe(true);
    expect(marriage?.dissolvedAtTick).toBe(10);
    expect(result.nextState.characters.get(PLAYER_SPOUSE)?.marriageId).toBeNull();
    expect(result.nextState.characters.get(OTHER_SPOUSE)?.marriageId).toBeNull();
    expect(result.nextState.houses.get(PLAYER_HOUSE_ID)?.scandal).toBe(5 + ABANDONMENT_SCANDAL);
  });

  it("recomputes the surviving player-house spouse's role (Spouse → Spinster for Female)", () => {
    const result = applyAbandonMarriagePure(setup(), M_ID);
    if (!result.ok) throw new Error("expected ok");
    expect(result.nextState.characters.get(PLAYER_SPOUSE)?.role).toBe("Spinster");
  });

  it("bumps a rival house's hostility when the abandoned spouse is a rival", () => {
    const result = applyAbandonMarriagePure(
      setup({ otherHouseId: RIVAL_HOUSE_ID, otherHostility: 20 }),
      M_ID,
    );
    if (!result.ok) throw new Error("expected ok");
    expect(result.nextState.houses.get(RIVAL_HOUSE_ID)?.hostility).toBe(
      20 + ABANDONMENT_RIVAL_HOSTILITY_BUMP,
    );
  });

  it("rejects MarriageNotFound", () => {
    const result = applyAbandonMarriagePure(setup(), "no-such" as MarriageId);
    expect(result).toEqual({ ok: false, reason: { kind: "MarriageNotFound" } });
  });

  it("rejects MarriageAlreadyDissolved", () => {
    const state = setup();
    const m = state.marriages.get(M_ID);
    if (m === undefined) throw new Error("unreachable");
    const dissolved = new Map(state.marriages);
    dissolved.set(M_ID, { ...m, dissolved: true });
    const result = applyAbandonMarriagePure({ ...state, marriages: dissolved }, M_ID);
    expect(result).toEqual({ ok: false, reason: { kind: "MarriageAlreadyDissolved" } });
  });

  it("rejects NotPlayerMarriage when neither spouse is in the player house", () => {
    const base = setup();
    const ps = base.characters.get(PLAYER_SPOUSE);
    if (ps === undefined) throw new Error("unreachable");
    const chars = new Map(base.characters);
    chars.set(PLAYER_SPOUSE, { ...ps, houseId: "independent" as HouseId });
    const result = applyAbandonMarriagePure({ ...base, characters: chars }, M_ID);
    expect(result).toEqual({ ok: false, reason: { kind: "NotPlayerMarriage" } });
  });
});
