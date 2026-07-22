// P25 R4 — player diplomacy free actions.

import { describe, expect, it } from "vitest";
import { makeElopementSprint, makeHouse, makeHousesMap } from "../__test-utils__/factories";
import {
  DECLARE_WAR_HOSTILITY_BUMP,
  DECLARE_WAR_SCANDAL_COST,
  DECLARE_WAR_TENSION_BUMP,
  FACTION_TENSION_CAP,
  OLIVE_BRANCH_HOSTILITY_DROP,
  OLIVE_BRANCH_WEALTH_COST,
  WITHDRAW_GRIEVANCE_HOSTILITY_DROP,
} from "../constants";
import type { Character, GameState, Grievance, MarriageRecord } from "../entities";
import { PLAYER_FACTION_ID, makeFactionPairKey } from "../fixtures/factions";
import type { CharacterId, FactionId, GrievanceId, HouseId, MarriageId, RngState } from "../rng";
import { PLAYER_HOUSE_ID } from "../rng.seeds";
import { applyDeclareWar, applyExtendOliveBranch, applyWithdrawGrievance } from "./grievances";

const RIVAL = "rival-ashford" as HouseId;
const RIVAL_FACTION = "faction-court" as FactionId;

function makeState(overrides: Partial<GameState>): GameState {
  return {
    tick: 10,
    rng: new Map<HouseId, RngState>(),
    houses: new Map(),
    characters: new Map<CharacterId, Character>(),
    marriages: new Map<MarriageId, MarriageRecord>(),
    campaignName: "test",
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
    patronesses: new Map(),
    rivalActors: new Map(),
    factionTensions: new Map(),
    duels: new Map(),
    elopements: new Map(),
    artifactInstances: new Map(),
    forgeries: new Map(),
    thiefAttempts: new Map(),
    proceduralArtifactDefinitions: new Map(),
    globalEvents: new Map(),
    flavorText: new Map(),
    betrothals: new Map(),
    callingCards: new Map(),
    ...overrides,
  };
}

function playerGrievance(overrides: Partial<Grievance> = {}): Grievance {
  return {
    id: "g1" as GrievanceId,
    perpetratorHouseId: RIVAL,
    defendantCharacterId: null,
    source: "Sabotage",
    schemeId: null,
    recordedAtTick: 5,
    resolved: false,
    ...overrides,
  };
}

function baseState(overrides: Partial<GameState> = {}): GameState {
  return makeState({
    houses: makeHousesMap([
      makeHouse({ id: PLAYER_HOUSE_ID, wealth: 100, scandal: 0 }),
      makeHouse({ id: RIVAL, hostility: 50, factionId: RIVAL_FACTION }),
    ]),
    ...overrides,
  });
}

describe("applyWithdrawGrievance", () => {
  it("flips the grievance resolved + drops the perpetrator rival's hostility", () => {
    const state = baseState({
      houses: makeHousesMap([
        makeHouse({ id: PLAYER_HOUSE_ID, grievances: [playerGrievance()] }),
        makeHouse({ id: RIVAL, hostility: 50, factionId: RIVAL_FACTION }),
      ]),
    });
    const r = applyWithdrawGrievance(state, "g1" as GrievanceId);
    if (!r.ok) throw new Error(`unexpected: ${r.reason.kind}`);
    expect(r.nextState.houses.get(PLAYER_HOUSE_ID)?.grievances[0]?.resolved).toBe(true);
    expect(r.nextState.houses.get(RIVAL)?.hostility).toBe(50 + WITHDRAW_GRIEVANCE_HOSTILITY_DROP);
  });

  it("rejects GrievanceNotFound + GrievanceAlreadyResolved", () => {
    const missing = applyWithdrawGrievance(baseState(), "nope" as GrievanceId);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason.kind).toBe("GrievanceNotFound");
    const resolvedState = makeState({
      houses: makeHousesMap([
        makeHouse({ id: PLAYER_HOUSE_ID, grievances: [playerGrievance({ resolved: true })] }),
        makeHouse({ id: RIVAL, factionId: RIVAL_FACTION }),
      ]),
    });
    const already = applyWithdrawGrievance(resolvedState, "g1" as GrievanceId);
    expect(already.ok).toBe(false);
    if (!already.ok) expect(already.reason.kind).toBe("GrievanceAlreadyResolved");
  });

  it("rejects PlayerExiled", () => {
    const state = makeState({
      houses: makeHousesMap([
        makeHouse({ id: PLAYER_HOUSE_ID, exiled: true, grievances: [playerGrievance()] }),
        makeHouse({ id: RIVAL, factionId: RIVAL_FACTION }),
      ]),
    });
    const r = applyWithdrawGrievance(state, "g1" as GrievanceId);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.kind).toBe("PlayerExiled");
  });
});

describe("applyExtendOliveBranch", () => {
  it("deducts wealth + cools the rival's hostility", () => {
    const r = applyExtendOliveBranch(baseState(), RIVAL);
    if (!r.ok) throw new Error(`unexpected: ${r.reason.kind}`);
    expect(r.nextState.houses.get(PLAYER_HOUSE_ID)?.wealth).toBe(100 - OLIVE_BRANCH_WEALTH_COST);
    expect(r.nextState.houses.get(RIVAL)?.hostility).toBe(50 + OLIVE_BRANCH_HOSTILITY_DROP);
  });

  it("rejects NotARivalHouse + InsufficientWealth", () => {
    const notRival = applyExtendOliveBranch(baseState(), PLAYER_HOUSE_ID);
    expect(notRival.ok).toBe(false);
    if (!notRival.ok) expect(notRival.reason.kind).toBe("NotARivalHouse");
    const broke = applyExtendOliveBranch(
      baseState({
        houses: makeHousesMap([
          makeHouse({ id: PLAYER_HOUSE_ID, wealth: 1 }),
          makeHouse({ id: RIVAL, factionId: RIVAL_FACTION }),
        ]),
      }),
      RIVAL,
    );
    expect(broke.ok).toBe(false);
    if (!broke.ok) expect(broke.reason.kind).toBe("InsufficientWealth");
  });
});

describe("applyDeclareWar", () => {
  it("raises player scandal + rival hostility + the crown-pair tension (clamped)", () => {
    const r = applyDeclareWar(baseState(), RIVAL);
    if (!r.ok) throw new Error(`unexpected: ${r.reason.kind}`);
    expect(r.nextState.houses.get(PLAYER_HOUSE_ID)?.scandal).toBe(DECLARE_WAR_SCANDAL_COST);
    expect(r.nextState.houses.get(RIVAL)?.hostility).toBe(50 + DECLARE_WAR_HOSTILITY_BUMP);
    const pairKey = makeFactionPairKey(PLAYER_FACTION_ID, RIVAL_FACTION);
    expect(r.nextState.factionTensions.get(pairKey)).toBe(DECLARE_WAR_TENSION_BUMP);
  });

  it("tension bump clamps at FACTION_TENSION_CAP", () => {
    const pairKey = makeFactionPairKey(PLAYER_FACTION_ID, RIVAL_FACTION);
    const r = applyDeclareWar(baseState({ factionTensions: new Map([[pairKey, 95]]) }), RIVAL);
    if (!r.ok) throw new Error("unreachable");
    expect(r.nextState.factionTensions.get(pairKey)).toBe(FACTION_TENSION_CAP);
  });

  it("rejects NotARivalHouse", () => {
    const r = applyDeclareWar(baseState(), PLAYER_HOUSE_ID);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.kind).toBe("NotARivalHouse");
  });
});

// The playerModalGate ElopementInProgress branch (grievances.ts) — an active
// player-controlled elopement sprint suspends all three diplomacy free actions
// (P9 modal-state gate principle). Gate is checked FIRST in each action body,
// so it wins over grievance-lookup / rival-validity checks.
describe("diplomacy actions reject during an active player elopement", () => {
  const withElopement = (overrides = {}) =>
    baseState({
      elopements: new Map([[makeElopementSprint().id, makeElopementSprint()]]),
      houses: makeHousesMap([
        makeHouse({ id: PLAYER_HOUSE_ID, wealth: 100, grievances: [playerGrievance()] }),
        makeHouse({ id: RIVAL, hostility: 50, factionId: RIVAL_FACTION }),
      ]),
      ...overrides,
    });

  it("applyWithdrawGrievance → ElopementInProgress", () => {
    const r = applyWithdrawGrievance(withElopement(), "g1" as GrievanceId);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.kind).toBe("ElopementInProgress");
  });

  it("applyExtendOliveBranch → ElopementInProgress", () => {
    const r = applyExtendOliveBranch(withElopement(), RIVAL);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.kind).toBe("ElopementInProgress");
  });

  it("applyDeclareWar → ElopementInProgress", () => {
    const r = applyDeclareWar(withElopement(), RIVAL);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.kind).toBe("ElopementInProgress");
  });
});
