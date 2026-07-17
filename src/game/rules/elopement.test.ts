// P9/P24a — pure resolver tests for elopement rules.
//
// Validates the rule entry points (Push, FreshHorses, Surrender,
// resolveElopementTerminal) plus the helper used by the discovery branch.
// P24a: sprints live in a Map keyed by ElopementId; the interactive actions take
// the sprint id; terminal resolution flips the sprint's `resolved` flag (the
// sprint PERSISTS in the Map — terminal is NOT detected via map-absence).

import { describe, expect, it } from "vitest";
import { advanceTickPure } from "../../runtime/tickOrchestrator";
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
import type { ElopementSprintState, GameState } from "../entities";
import { hashState } from "../hash";
import type { CharacterId, ElopementId, HouseId, MarriageId, SchemeId, TraitId } from "../rng";
import { INDEPENDENT_HOUSE_ID, PLAYER_HOUSE_ID, createRngState } from "../rng";
import { DEFAULT_CAMPAIGN_NAME, createInitialState } from "../store";
import {
  applyElopementAutoResolvePhase,
  applyElopementFreshHorsesPure,
  applyElopementPushPure,
  applyElopementSurrenderPure,
  isAvailableForRemarriage,
  resolveElopementTerminal,
} from "./elopement";

const ELOPING_ID = "player-head" as CharacterId;
const TARGET_ID = "target-1" as CharacterId;
const SCHEME_ID = "scheme-1" as SchemeId;
const SPRINT_ID = "elopement:scheme-1:0" as ElopementId;

function makeSprint(overrides: Partial<ElopementSprintState> = {}): ElopementSprintState {
  return {
    id: SPRINT_ID,
    schemeId: SCHEME_ID,
    elopingCharacterId: ELOPING_ID,
    targetCharacterId: TARGET_ID,
    initiatorHouseId: PLAYER_HOUSE_ID,
    pursuerHouseId: PLAYER_HOUSE_ID,
    isPlayerControlled: true,
    playerTilePosition: ELOPEMENT_PLAYER_START_TILE,
    fatherTilePosition: ELOPEMENT_FATHER_START_TILE,
    freshHorsesUsedCount: 0,
    abandonOnWin: false,
    resolved: false,
    outcome: null,
    resolvedAtTick: null,
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
    elopements: new Map([[SPRINT_ID, makeSprint(opts.sprint)]]),
  });
}

describe("applyElopementPushPure", () => {
  it("advances both tokens by ELOPEMENT_PUSH_*_ADVANCE and drains composure", () => {
    const state = makeSprintState({});
    const result = applyElopementPushPure(state, SPRINT_ID);
    if ("ok" in result) throw new Error("expected GameState, got rejection");
    const sprint = result.elopements.get(SPRINT_ID);
    expect(sprint?.playerTilePosition).toBe(
      ELOPEMENT_PLAYER_START_TILE + ELOPEMENT_PUSH_PLAYER_ADVANCE,
    );
    expect(sprint?.fatherTilePosition).toBe(
      ELOPEMENT_FATHER_START_TILE + ELOPEMENT_PUSH_FATHER_ADVANCE,
    );
    const newEloping = result.characters.get(ELOPING_ID);
    expect(newEloping?.composure).toBe(100 - ELOPEMENT_PUSH_COMPOSURE_COST);
  });

  it("rejects when no active sprint", () => {
    const state = makeGameState({ elopements: new Map() });
    const result = applyElopementPushPure(state, SPRINT_ID);
    expect(result).toEqual({ ok: false, reason: { kind: "NoActiveSprint" } });
  });

  it("resolves Won when player reaches tile 7", () => {
    const state = makeSprintState({
      sprint: { playerTilePosition: ELOPEMENT_TRACK_LENGTH - 1 },
    });
    const result = applyElopementPushPure(state, SPRINT_ID);
    if ("ok" in result) throw new Error("expected resolved state");
    const sprint = result.elopements.get(SPRINT_ID);
    expect(sprint?.resolved).toBe(true);
    expect(sprint?.outcome).toBe("Won");
    const repBefore = state.houses.get(PLAYER_HOUSE_ID)?.reputation ?? 0;
    expect(result.houses.get(PLAYER_HOUSE_ID)?.reputation).toBe(Math.floor(repBefore / 2));
  });

  it("resolves Lost when father reaches tile 7", () => {
    const state = makeSprintState({
      sprint: { fatherTilePosition: ELOPEMENT_TRACK_LENGTH - 1, playerTilePosition: 3 },
    });
    const result = applyElopementPushPure(state, SPRINT_ID);
    if ("ok" in result) throw new Error("expected resolved state");
    const sprint = result.elopements.get(SPRINT_ID);
    expect(sprint?.resolved).toBe(true);
    expect(sprint?.outcome).toBe("Lost");
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
    const result = applyElopementPushPure({ ...state, characters: newChars }, SPRINT_ID);
    if ("ok" in result) throw new Error("expected resolved state");
    expect(result.elopements.get(SPRINT_ID)?.resolved).toBe(true);
    expect(result.houses.get(PLAYER_HOUSE_ID)?.scandal).toBe(ELOPEMENT_LOSS_SCANDAL_DELTA);
  });
});

describe("applyElopementFreshHorsesPure", () => {
  it("advances player tile by ELOPEMENT_FRESH_HORSES_PLAYER_ADVANCE and deducts wealth", () => {
    const state = makeSprintState({ playerWealth: 100 });
    const result = applyElopementFreshHorsesPure(state, SPRINT_ID);
    if ("ok" in result) throw new Error("expected GameState");
    const sprint = result.elopements.get(SPRINT_ID);
    expect(sprint?.playerTilePosition).toBe(
      ELOPEMENT_PLAYER_START_TILE + ELOPEMENT_FRESH_HORSES_PLAYER_ADVANCE,
    );
    expect(sprint?.freshHorsesUsedCount).toBe(1);
    expect(result.houses.get(PLAYER_HOUSE_ID)?.wealth).toBe(
      100 - ELOPEMENT_FRESH_HORSES_WEALTH_COST,
    );
  });

  it("rejects when no sprint active", () => {
    const state = makeGameState({ elopements: new Map() });
    const result = applyElopementFreshHorsesPure(state, SPRINT_ID);
    expect(result).toEqual({ ok: false, reason: { kind: "NoActiveSprint" } });
  });

  it("rejects when fresh-horses uses are exhausted", () => {
    const state = makeSprintState({
      sprint: { freshHorsesUsedCount: ELOPEMENT_FRESH_HORSES_MAX_USES },
    });
    const result = applyElopementFreshHorsesPure(state, SPRINT_ID);
    expect(result).toEqual({ ok: false, reason: { kind: "FreshHorsesExhausted" } });
  });

  it("rejects when wealth is insufficient", () => {
    const state = makeSprintState({ playerWealth: 0 });
    const result = applyElopementFreshHorsesPure(state, SPRINT_ID);
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
    const result = applyElopementSurrenderPure(state, SPRINT_ID);
    const sprint = result.elopements.get(SPRINT_ID);
    expect(sprint?.resolved).toBe(true);
    expect(sprint?.outcome).toBe("Lost");
    expect(result.houses.get(PLAYER_HOUSE_ID)?.scandal).toBe(ELOPEMENT_LOSS_SCANDAL_DELTA);
  });

  it("throws if no active sprint (UI must gate)", () => {
    const state = makeGameState({ elopements: new Map() });
    expect(() => applyElopementSurrenderPure(state, SPRINT_ID)).toThrow();
  });
});

describe("resolveElopementTerminal", () => {
  it("Won applies reputation halve and mints viaElopement marriage when both unmarried", () => {
    const state = makeSprintState({
      sprint: { playerTilePosition: ELOPEMENT_TRACK_LENGTH },
      playerReputation: 60,
    });
    const result = resolveElopementTerminal(state, SPRINT_ID, "Won");
    expect(result.elopements.get(SPRINT_ID)?.resolved).toBe(true);
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
    const result = resolveElopementTerminal(stateWithMarriage, SPRINT_ID, "Won");
    expect(result.elopements.get(SPRINT_ID)?.resolved).toBe(true);
    expect(result.houses.get(PLAYER_HOUSE_ID)?.reputation).toBe(40);
    // No new marriage minted — only the existing one remains (abandonOnWin not set).
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
    const result = resolveElopementTerminal(stateWithDissolvedMarriage, SPRINT_ID, "Won");
    // Two marriages: the original dissolved + the new viaElopement.
    expect(result.marriages.size).toBe(2);
    const viaElopement = [...result.marriages.values()].find((m) => m.viaElopement);
    expect(viaElopement).toBeDefined();
  });

  it("Lost applies +50 scandal and resolves the sprint", () => {
    const state = makeSprintState({ playerScandal: 10 });
    const result = resolveElopementTerminal(state, SPRINT_ID, "Lost");
    expect(result.elopements.get(SPRINT_ID)?.resolved).toBe(true);
    expect(result.houses.get(PLAYER_HOUSE_ID)?.scandal).toBe(10 + ELOPEMENT_LOSS_SCANDAL_DELTA);
  });

  it("Lost clamps scandal at 100", () => {
    const state = makeSprintState({ playerScandal: 80 });
    const result = resolveElopementTerminal(state, SPRINT_ID, "Lost");
    expect(result.houses.get(PLAYER_HOUSE_ID)?.scandal).toBe(100);
  });

  it("Won with abandonOnWin dissolves the prior marriage then mints the elopement marriage", () => {
    const marriageId = "existing-m" as MarriageId;
    const targetMarriage = makeMarriage({
      id: marriageId,
      spouseAId: TARGET_ID,
      spouseBId: "other-spouse" as CharacterId,
      dissolved: false,
    });
    const state = makeSprintState({
      sprint: { playerTilePosition: ELOPEMENT_TRACK_LENGTH, abandonOnWin: true },
      targetMarriageId: marriageId,
      playerReputation: 60,
    });
    const stateWithMarriage = { ...state, marriages: new Map([[marriageId, targetMarriage]]) };
    const result = resolveElopementTerminal(stateWithMarriage, SPRINT_ID, "Won");
    // The prior marriage is dissolved (viaAbandonment) and a new viaElopement one minted.
    const prior = result.marriages.get(marriageId);
    expect(prior?.dissolved).toBe(true);
    expect(prior?.viaAbandonment).toBe(true);
    const viaElopement = [...result.marriages.values()].find((m) => m.viaElopement);
    expect(viaElopement).toBeDefined();
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

// ── P24a close-out: dedicated auto-resolve determinism (verification C4) ──
//
// The 30-run replay harness covers determinism broadly, but a fresh campaign
// only mounts a non-player sprint when a rival Seduction fires AND its
// multi-tick discovery lands — not guaranteed inside a short window. This
// suite FORCES a rival-initiated sprint into bootstrap state (synthetic
// hand-craft per the store.elopement-gate.test.ts precedent) and drives the
// full tick chain through applyElopementAutoResolvePhase to terminal.
describe("applyElopementAutoResolvePhase — forced non-player sprint determinism", () => {
  const AUTO_SPRINT_ID = "elopement:auto-test:0" as ElopementId;

  function runCampaign(): GameState {
    let s = createInitialState("auto-resolve-determinism", DEFAULT_CAMPAIGN_NAME);
    const sprint: ElopementSprintState = {
      id: AUTO_SPRINT_ID,
      schemeId: "auto-test" as SchemeId,
      elopingCharacterId: "rival-ashford-a2" as CharacterId,
      targetCharacterId: "proc-npc-0" as CharacterId,
      initiatorHouseId: "rival-ashford" as HouseId,
      pursuerHouseId: INDEPENDENT_HOUSE_ID,
      isPlayerControlled: false,
      playerTilePosition: 0,
      fatherTilePosition: 0,
      freshHorsesUsedCount: 0,
      abandonOnWin: false,
      resolved: false,
      outcome: null,
      resolvedAtTick: null,
      startedAtTick: 0,
    };
    s = { ...s, elopements: new Map([[sprint.id, sprint]]) };
    for (let t = 0; t < 15; t++) s = advanceTickPure(s);
    return s;
  }

  it("auto-resolves a rival-initiated sprint to terminal without suspending time", () => {
    const state = runCampaign();
    const sprint = state.elopements.get(AUTO_SPRINT_ID);
    expect(sprint?.resolved).toBe(true);
    expect(sprint?.outcome === "Won" || sprint?.outcome === "Lost").toBe(true);
    expect(sprint?.resolvedAtTick).not.toBeNull();
    // Non-player sprints never suspend the tick clock.
    expect(state.tick).toBe(15);
  });

  it("produces identical hashes across 30 runs", () => {
    const baseline = hashState(runCampaign());
    for (let iter = 0; iter < 30; iter++) {
      expect(hashState(runCampaign())).toBe(baseline);
    }
  });
});

// ── P24a C5: pursuit-speed trait modifiers on sprint advances ─────────────
//
// Eloper-side traits (PURSUIT_SPEED_ELOPER_TRAIT_MODIFIERS) speed the eloping
// tile; pursuer-side traits on the PURSUER house's head speed the father tile.
// A distinct pursuer house is required here — makeSprintState points
// pursuerHouseId at the player house whose head IS the eloper, which would
// conflate the two bonus lookups.
describe("pursuit-speed trait modifiers (P24a C5)", () => {
  const PURSUER_HOUSE_ID = "pursuer-house" as HouseId;
  const FATHER_ID = "father-1" as CharacterId;

  function makeTraitSprintState(opts: {
    eloperTraits?: TraitId[];
    pursuerHeadTraits?: TraitId[];
    sprint?: Partial<ElopementSprintState>;
  }): GameState {
    const eloping = makeCharacter({
      id: ELOPING_ID,
      name: "Eloper",
      role: "HeadOfHouse",
      composure: 100,
      maxComposure: 100,
      traits: opts.eloperTraits ?? [],
    });
    const target = makeCharacter({
      id: TARGET_ID,
      name: "Target",
      role: "Spinster",
      houseId: PURSUER_HOUSE_ID,
    });
    const father = makeCharacter({
      id: FATHER_ID,
      name: "Father",
      role: "HeadOfHouse",
      houseId: PURSUER_HOUSE_ID,
      traits: opts.pursuerHeadTraits ?? [],
    });
    return makeGameState({
      tick: 5,
      houses: new Map([
        [PLAYER_HOUSE_ID, makeHouse({ id: PLAYER_HOUSE_ID, headOfHouseCharacterId: ELOPING_ID })],
        [PURSUER_HOUSE_ID, makeHouse({ id: PURSUER_HOUSE_ID, headOfHouseCharacterId: FATHER_ID })],
      ]),
      characters: new Map([
        [ELOPING_ID, eloping],
        [TARGET_ID, target],
        [FATHER_ID, father],
      ]),
      elopements: new Map([
        [SPRINT_ID, makeSprint({ pursuerHouseId: PURSUER_HOUSE_ID, ...opts.sprint })],
      ]),
    });
  }

  it("Push advances eloper tile by base+1 with an eloper-boost trait and father tile by base+1 with a pursuer-boost trait", () => {
    const state = makeTraitSprintState({
      eloperTraits: ["Bold" as TraitId],
      pursuerHeadTraits: ["Cunning" as TraitId],
    });
    const result = applyElopementPushPure(state, SPRINT_ID);
    if ("ok" in result) throw new Error("expected GameState, got rejection");
    const sprint = result.elopements.get(SPRINT_ID);
    expect(sprint?.playerTilePosition).toBe(
      ELOPEMENT_PLAYER_START_TILE + ELOPEMENT_PUSH_PLAYER_ADVANCE + 1,
    );
    expect(sprint?.fatherTilePosition).toBe(
      ELOPEMENT_FATHER_START_TILE + ELOPEMENT_PUSH_FATHER_ADVANCE + 1,
    );
    expect(sprint?.resolved).toBe(false);
  });

  it("Push advances both tiles by exactly the base amounts when both parties are traitless (control)", () => {
    const state = makeTraitSprintState({});
    const result = applyElopementPushPure(state, SPRINT_ID);
    if ("ok" in result) throw new Error("expected GameState, got rejection");
    const sprint = result.elopements.get(SPRINT_ID);
    expect(sprint?.playerTilePosition).toBe(
      ELOPEMENT_PLAYER_START_TILE + ELOPEMENT_PUSH_PLAYER_ADVANCE,
    );
    expect(sprint?.fatherTilePosition).toBe(
      ELOPEMENT_FATHER_START_TILE + ELOPEMENT_PUSH_FATHER_ADVANCE,
    );
  });

  it("Push does not cross-apply tables: pursuer-side traits on the eloper add nothing", () => {
    const state = makeTraitSprintState({
      eloperTraits: ["Cunning" as TraitId, "Suspicious" as TraitId],
    });
    const result = applyElopementPushPure(state, SPRINT_ID);
    if ("ok" in result) throw new Error("expected GameState, got rejection");
    const sprint = result.elopements.get(SPRINT_ID);
    expect(sprint?.playerTilePosition).toBe(
      ELOPEMENT_PLAYER_START_TILE + ELOPEMENT_PUSH_PLAYER_ADVANCE,
    );
    expect(sprint?.fatherTilePosition).toBe(
      ELOPEMENT_FATHER_START_TILE + ELOPEMENT_PUSH_FATHER_ADVANCE,
    );
  });

  it("Fresh Horses adds the eloper bonus to the player tile and leaves the father tile untouched", () => {
    const state = makeTraitSprintState({
      eloperTraits: ["Brash" as TraitId],
      pursuerHeadTraits: ["Ambitious" as TraitId],
    });
    const result = applyElopementFreshHorsesPure(state, SPRINT_ID);
    if ("ok" in result) throw new Error("expected GameState, got rejection");
    const sprint = result.elopements.get(SPRINT_ID);
    expect(sprint?.playerTilePosition).toBe(
      ELOPEMENT_PLAYER_START_TILE + ELOPEMENT_FRESH_HORSES_PLAYER_ADVANCE + 1,
    );
    expect(sprint?.fatherTilePosition).toBe(ELOPEMENT_FATHER_START_TILE);
  });

  it("applyElopementAutoResolvePhase applies both trait bonuses to a non-player sprint", () => {
    const INITIATOR_HOUSE_ID = "rival-init" as HouseId;
    // freshHorsesUsedCount at max suppresses the auto-fresh-horses branch, so
    // the advance is exactly Push-base + bonuses regardless of the draw value.
    const base = makeTraitSprintState({
      eloperTraits: ["Hedonistic" as TraitId],
      pursuerHeadTraits: ["Suspicious" as TraitId],
      sprint: {
        initiatorHouseId: INITIATOR_HOUSE_ID,
        isPlayerControlled: false,
        freshHorsesUsedCount: ELOPEMENT_FRESH_HORSES_MAX_USES,
        playerTilePosition: 1,
        fatherTilePosition: 0,
      },
    });
    const state: GameState = {
      ...base,
      rng: new Map([[INITIATOR_HOUSE_ID, createRngState("c5-auto-resolve")]]),
    };
    const result = applyElopementAutoResolvePhase(state);
    const sprint = result.elopements.get(SPRINT_ID);
    expect(sprint?.playerTilePosition).toBe(1 + ELOPEMENT_PUSH_PLAYER_ADVANCE + 1);
    expect(sprint?.fatherTilePosition).toBe(0 + ELOPEMENT_PUSH_FATHER_ADVANCE + 1);
    expect(sprint?.freshHorsesUsedCount).toBe(ELOPEMENT_FRESH_HORSES_MAX_USES);
    expect(sprint?.resolved).toBe(false);
    expect(result.rng.get(INITIATOR_HOUSE_ID)?.callCount).toBe(1);
  });

  it("applyElopementAutoResolvePhase advances a traitless non-player sprint by exactly the Push bases (control)", () => {
    const INITIATOR_HOUSE_ID = "rival-init" as HouseId;
    const base = makeTraitSprintState({
      sprint: {
        initiatorHouseId: INITIATOR_HOUSE_ID,
        isPlayerControlled: false,
        freshHorsesUsedCount: ELOPEMENT_FRESH_HORSES_MAX_USES,
        playerTilePosition: 1,
        fatherTilePosition: 0,
      },
    });
    const state: GameState = {
      ...base,
      rng: new Map([[INITIATOR_HOUSE_ID, createRngState("c5-auto-resolve")]]),
    };
    const result = applyElopementAutoResolvePhase(state);
    const sprint = result.elopements.get(SPRINT_ID);
    expect(sprint?.playerTilePosition).toBe(1 + ELOPEMENT_PUSH_PLAYER_ADVANCE);
    expect(sprint?.fatherTilePosition).toBe(0 + ELOPEMENT_PUSH_FATHER_ADVANCE);
  });
});
