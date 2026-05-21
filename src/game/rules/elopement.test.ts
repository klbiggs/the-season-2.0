// P9 — pure resolver tests for elopement rules.
//
// Validates the four rule entry points (Push, FreshHorses, Surrender,
// resolveElopementTerminal) plus the helper used by the discovery branch.
// All tests construct synthetic state — branch 5 reachability is unit-only
// at v1 (Q4 gate blocks end-to-end paths).

import { describe, expect, it } from "vitest";
import { makeCharacter, makeGameState, makeHouse, makeMarriage } from "../__test-utils__/factories";
import {
  ELOPEMENT_FATHER_START_TILE,
  ELOPEMENT_FRESH_HORSES_MAX_USES,
  ELOPEMENT_FRESH_HORSES_PLAYER_ADVANCE,
  ELOPEMENT_FRESH_HORSES_WEALTH_COST,
  ELOPEMENT_LOSS_SCANDAL_DELTA,
  ELOPEMENT_PLAYER_START_TILE,
  ELOPEMENT_PUSH_COMPOSURE_COST,
  ELOPEMENT_PUSH_FATHER_ADVANCE,
  ELOPEMENT_PUSH_PLAYER_ADVANCE,
  ELOPEMENT_TRACK_LENGTH,
} from "../constants";
import type { ElopementSprintState } from "../entities";
import type { CharacterId, MarriageId, SchemeId } from "../rng";
import { PLAYER_HOUSE_ID } from "../rng";
import {
  applyElopementFreshHorsesPure,
  applyElopementPushPure,
  applyElopementSurrenderPure,
  isAvailableForRemarriage,
  resolveElopementTerminal,
} from "./elopement";

const ELOPING_ID = "player-head" as CharacterId;
const TARGET_ID = "target-1" as CharacterId;
const SCHEME_ID = "scheme-1" as SchemeId;

function makeSprint(overrides: Partial<ElopementSprintState> = {}): ElopementSprintState {
  return {
    schemeId: SCHEME_ID,
    elopingCharacterId: ELOPING_ID,
    targetCharacterId: TARGET_ID,
    playerTilePosition: ELOPEMENT_PLAYER_START_TILE,
    fatherTilePosition: ELOPEMENT_FATHER_START_TILE,
    freshHorsesUsedCount: 0,
    startedAtTick: 0,
    ...overrides,
  };
}

function makeSprintState(opts: {
  sprint?: Partial<ElopementSprintState>;
  playerWealth?: number;
  playerScandal?: number;
  playerReputation?: number;
  elopingMarriageId?: MarriageId | null;
  targetMarriageId?: MarriageId | null;
}) {
  const eloping = makeCharacter({
    id: ELOPING_ID,
    name: "Eloper",
    role: "HeadOfHouse",
    composure: 100,
    maxComposure: 100,
    marriageId: opts.elopingMarriageId ?? null,
  });
  const target = makeCharacter({
    id: TARGET_ID,
    name: "Target",
    role: "Spinster",
    marriageId: opts.targetMarriageId ?? null,
  });
  const playerHouse = makeHouse({
    id: PLAYER_HOUSE_ID,
    wealth: opts.playerWealth ?? 100,
    scandal: opts.playerScandal ?? 0,
    reputation: opts.playerReputation ?? 60,
    headOfHouseCharacterId: ELOPING_ID,
  });
  return makeGameState({
    tick: 5,
    houses: new Map([[PLAYER_HOUSE_ID, playerHouse]]),
    characters: new Map([
      [ELOPING_ID, eloping],
      [TARGET_ID, target],
    ]),
    elopement: makeSprint(opts.sprint),
  });
}

describe("applyElopementPushPure", () => {
  it("advances both tokens by ELOPEMENT_PUSH_*_ADVANCE and drains composure", () => {
    const state = makeSprintState({});
    const result = applyElopementPushPure(state);
    if ("ok" in result) throw new Error("expected GameState, got rejection");
    expect(result.elopement?.playerTilePosition).toBe(
      ELOPEMENT_PLAYER_START_TILE + ELOPEMENT_PUSH_PLAYER_ADVANCE,
    );
    expect(result.elopement?.fatherTilePosition).toBe(
      ELOPEMENT_FATHER_START_TILE + ELOPEMENT_PUSH_FATHER_ADVANCE,
    );
    const newEloping = result.characters.get(ELOPING_ID);
    expect(newEloping?.composure).toBe(100 - ELOPEMENT_PUSH_COMPOSURE_COST);
  });

  it("rejects when no active sprint", () => {
    const state = makeGameState({ elopement: null });
    const result = applyElopementPushPure(state);
    expect(result).toEqual({ ok: false, reason: { kind: "NoActiveSprint" } });
  });

  it("resolves Won when player reaches tile 7", () => {
    const state = makeSprintState({
      sprint: { playerTilePosition: ELOPEMENT_TRACK_LENGTH - 1 },
    });
    const result = applyElopementPushPure(state);
    if ("ok" in result) throw new Error("expected resolved state");
    expect(result.elopement).toBeNull();
    const repBefore = state.houses.get(PLAYER_HOUSE_ID)?.reputation ?? 0;
    expect(result.houses.get(PLAYER_HOUSE_ID)?.reputation).toBe(Math.floor(repBefore / 2));
  });

  it("resolves Lost when father reaches tile 7", () => {
    const state = makeSprintState({
      sprint: { fatherTilePosition: ELOPEMENT_TRACK_LENGTH - 1, playerTilePosition: 3 },
    });
    const result = applyElopementPushPure(state);
    if ("ok" in result) throw new Error("expected resolved state");
    expect(result.elopement).toBeNull();
    expect(result.houses.get(PLAYER_HOUSE_ID)?.scandal).toBe(ELOPEMENT_LOSS_SCANDAL_DELTA);
  });

  it("resolves Lost when composure depletes to 0", () => {
    const state = makeSprintState({
      sprint: { playerTilePosition: 3, fatherTilePosition: 1 },
    });
    // Pre-set composure so the push drops to 0.
    const newChars = new Map(state.characters);
    const eloping = newChars.get(ELOPING_ID);
    if (eloping !== undefined) {
      newChars.set(ELOPING_ID, { ...eloping, composure: ELOPEMENT_PUSH_COMPOSURE_COST });
    }
    const result = applyElopementPushPure({ ...state, characters: newChars });
    if ("ok" in result) throw new Error("expected resolved state");
    expect(result.elopement).toBeNull();
    expect(result.houses.get(PLAYER_HOUSE_ID)?.scandal).toBe(ELOPEMENT_LOSS_SCANDAL_DELTA);
  });
});

describe("applyElopementFreshHorsesPure", () => {
  it("advances player tile by ELOPEMENT_FRESH_HORSES_PLAYER_ADVANCE and deducts wealth", () => {
    const state = makeSprintState({ playerWealth: 100 });
    const result = applyElopementFreshHorsesPure(state);
    if ("ok" in result) throw new Error("expected GameState");
    expect(result.elopement?.playerTilePosition).toBe(
      ELOPEMENT_PLAYER_START_TILE + ELOPEMENT_FRESH_HORSES_PLAYER_ADVANCE,
    );
    expect(result.elopement?.freshHorsesUsedCount).toBe(1);
    expect(result.houses.get(PLAYER_HOUSE_ID)?.wealth).toBe(
      100 - ELOPEMENT_FRESH_HORSES_WEALTH_COST,
    );
  });

  it("rejects when no sprint active", () => {
    const state = makeGameState({ elopement: null });
    const result = applyElopementFreshHorsesPure(state);
    expect(result).toEqual({ ok: false, reason: { kind: "NoActiveSprint" } });
  });

  it("rejects when fresh-horses uses are exhausted", () => {
    const state = makeSprintState({
      sprint: { freshHorsesUsedCount: ELOPEMENT_FRESH_HORSES_MAX_USES },
    });
    const result = applyElopementFreshHorsesPure(state);
    expect(result).toEqual({ ok: false, reason: { kind: "FreshHorsesExhausted" } });
  });

  it("rejects when wealth is insufficient", () => {
    const state = makeSprintState({ playerWealth: 0 });
    const result = applyElopementFreshHorsesPure(state);
    if ("ok" in result === false || result.ok !== false) {
      throw new Error("expected rejection");
    }
    expect(result.reason).toEqual({
      kind: "InsufficientWealth",
      have: 0,
      need: ELOPEMENT_FRESH_HORSES_WEALTH_COST,
    });
  });
});

describe("applyElopementSurrenderPure", () => {
  it("forces father to finish line and resolves Lost with +50 scandal", () => {
    const state = makeSprintState({ playerScandal: 0 });
    const result = applyElopementSurrenderPure(state);
    expect(result.elopement).toBeNull();
    expect(result.houses.get(PLAYER_HOUSE_ID)?.scandal).toBe(ELOPEMENT_LOSS_SCANDAL_DELTA);
  });

  it("throws if no active sprint (UI must gate)", () => {
    const state = makeGameState({ elopement: null });
    expect(() => applyElopementSurrenderPure(state)).toThrow();
  });
});

describe("resolveElopementTerminal", () => {
  it("Won applies reputation halve and mints viaElopement marriage when both unmarried", () => {
    const state = makeSprintState({
      sprint: { playerTilePosition: ELOPEMENT_TRACK_LENGTH },
      playerReputation: 60,
    });
    const result = resolveElopementTerminal(state, "Won");
    expect(result.elopement).toBeNull();
    expect(result.houses.get(PLAYER_HOUSE_ID)?.reputation).toBe(30);
    // Marriage minted with viaElopement: true.
    expect(result.marriages.size).toBe(1);
    const minted = [...result.marriages.values()][0];
    expect(minted?.viaElopement).toBe(true);
    expect(minted?.dissolved).toBe(false);
  });

  it("Won applies rep-halve but skips marriage when target is already in an active marriage", () => {
    const marriageId = "existing-m" as MarriageId;
    const targetMarriage = makeMarriage({
      id: marriageId,
      spouseAId: TARGET_ID,
      spouseBId: "other-spouse" as CharacterId,
      dissolved: false,
    });
    const state = makeSprintState({
      sprint: { playerTilePosition: ELOPEMENT_TRACK_LENGTH },
      targetMarriageId: marriageId,
      playerReputation: 80,
    });
    // Patch the marriages map.
    const stateWithMarriage = {
      ...state,
      marriages: new Map([[marriageId, targetMarriage]]),
    };
    const result = resolveElopementTerminal(stateWithMarriage, "Won");
    expect(result.elopement).toBeNull();
    expect(result.houses.get(PLAYER_HOUSE_ID)?.reputation).toBe(40);
    // No new marriage minted — only the existing one remains.
    expect(result.marriages.size).toBe(1);
    expect([...result.marriages.values()][0]?.viaElopement).toBe(false);
  });

  it("Won permits remarriage of a widow (existing marriage dissolved)", () => {
    const dissolvedId = "dissolved-m" as MarriageId;
    const dissolvedMarriage = makeMarriage({
      id: dissolvedId,
      spouseAId: TARGET_ID,
      spouseBId: "deceased-spouse" as CharacterId,
      dissolved: true,
      dissolvedAtTick: 1,
    });
    const state = makeSprintState({
      sprint: { playerTilePosition: ELOPEMENT_TRACK_LENGTH },
      targetMarriageId: dissolvedId,
      playerReputation: 50,
    });
    const stateWithDissolvedMarriage = {
      ...state,
      marriages: new Map([[dissolvedId, dissolvedMarriage]]),
    };
    const result = resolveElopementTerminal(stateWithDissolvedMarriage, "Won");
    // Two marriages: the original dissolved + the new viaElopement.
    expect(result.marriages.size).toBe(2);
    const viaElopement = [...result.marriages.values()].find((m) => m.viaElopement);
    expect(viaElopement).toBeDefined();
  });

  it("Lost applies +50 scandal and clears elopement state", () => {
    const state = makeSprintState({ playerScandal: 10 });
    const result = resolveElopementTerminal(state, "Lost");
    expect(result.elopement).toBeNull();
    expect(result.houses.get(PLAYER_HOUSE_ID)?.scandal).toBe(10 + ELOPEMENT_LOSS_SCANDAL_DELTA);
  });

  it("Lost clamps scandal at 100", () => {
    const state = makeSprintState({ playerScandal: 80 });
    const result = resolveElopementTerminal(state, "Lost");
    expect(result.houses.get(PLAYER_HOUSE_ID)?.scandal).toBe(100);
  });
});

describe("isAvailableForRemarriage", () => {
  it("returns true when marriageId is null", () => {
    const state = makeGameState({});
    const char = makeCharacter({ marriageId: null });
    expect(isAvailableForRemarriage(char, state)).toBe(true);
  });

  it("returns true when the referenced marriage is dissolved", () => {
    const marriageId = "m1" as MarriageId;
    const state = makeGameState({
      marriages: new Map([[marriageId, makeMarriage({ id: marriageId, dissolved: true })]]),
    });
    const char = makeCharacter({ marriageId });
    expect(isAvailableForRemarriage(char, state)).toBe(true);
  });

  it("returns false when the referenced marriage is active", () => {
    const marriageId = "m1" as MarriageId;
    const state = makeGameState({
      marriages: new Map([[marriageId, makeMarriage({ id: marriageId, dissolved: false })]]),
    });
    const char = makeCharacter({ marriageId });
    expect(isAvailableForRemarriage(char, state)).toBe(false);
  });
});
