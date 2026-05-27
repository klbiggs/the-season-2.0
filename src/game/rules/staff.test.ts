// P6: staff rule layer tests. Covers loyalty drift (wealth<0 + Greedy
// faster), bribery roll (Greedy + sub-threshold + assignment !== Bribed),
// per-cadence output (Snoop / BribeDriver / InterceptMail / BribedByRival),
// the lastOutputTick foot-gun fix (reset to acc.tick on bribery flip), and
// tryAssignStaff / trySpymasterMailIntercept player actions.

import { describe, expect, it } from "vitest";
import {
  makeCharacter,
  makeCharactersMap,
  makeHouse,
  makeHousesMap,
} from "../__test-utils__/factories";
import type {
  Character,
  CourierPayload,
  GameState,
  MarriageRecord,
  StaffMember,
  Whisper,
} from "../entities";
import { buildBaselineStaffMap } from "../fixtures/staff";
import type {
  CharacterId,
  CourierPayloadId,
  HouseId,
  MarriageId,
  RngState,
  StaffId,
  WhisperId,
} from "../rng";
import { INDEPENDENT_HOUSE_ID, PLAYER_HOUSE_ID } from "../rng";
import { applyStaffOutputsPhase, tryAssignStaff, trySpymasterMailIntercept } from "./staff";

function makeState(overrides: Partial<GameState>): GameState {
  return {
    tick: 0,
    rng: new Map<HouseId, RngState>([[PLAYER_HOUSE_ID, { seed: "test-seed", callCount: 0 }]]),
    houses: new Map(),
    characters: new Map<CharacterId, Character>(),
    marriages: new Map<MarriageId, MarriageRecord>(),
    campaignName: "test-campaign",
    era: "Earlier",
    conversationHistory: new Map(),
    affectionMap: new Map(),
    schemes: new Map(),
    whispers: new Map<WhisperId, Whisper>(),
    couriers: new Map<CourierPayloadId, CourierPayload>(),
    staff: new Map<StaffId, StaffMember>(),
    proposalsLog: new Map(),
    tutorAssignmentsLog: new Map(),
    pendingTutorTraitChoices: new Map(),
    // P8 defaults
    patronesses: new Map(),
    rivalActors: new Map(),
    factionTensions: new Map(),
    duels: new Map(),
    elopements: new Map(),
    artifactInstances: new Map(),
    forgeries: new Map(),
    thiefAttempts: new Map(),
    globalEvents: new Map(),
    flavorText: new Map(),
    betrothals: new Map(),
    ...overrides,
  };
}

function makeStaff(overrides: Partial<StaffMember> = {}): StaffMember {
  return {
    id: "staff-a" as StaffId,
    houseId: PLAYER_HOUSE_ID,
    name: "Test Staff",
    isGreedy: false,
    loyalty: 80,
    upkeepPerTick: 1,
    assignment: "None",
    lastOutputTick: null,
    bribedAtTick: null,
    ...overrides,
  };
}

describe("applyStaffOutputsPhase loyalty drift", () => {
  it("drifts -1/tick for non-Greedy when wealth<0", () => {
    const player = makeHouse({ id: PLAYER_HOUSE_ID, wealth: -50 });
    const s = makeStaff({ isGreedy: false, loyalty: 80 });
    const state = makeState({
      houses: makeHousesMap([player]),
      staff: new Map([[s.id, s]]),
    });
    const next = applyStaffOutputsPhase(state);
    expect(next.staff.get(s.id)?.loyalty).toBe(79);
  });

  it("drifts -2/tick for Greedy when wealth<0", () => {
    const player = makeHouse({ id: PLAYER_HOUSE_ID, wealth: -50 });
    const s = makeStaff({ isGreedy: true, loyalty: 80 });
    const state = makeState({
      houses: makeHousesMap([player]),
      staff: new Map([[s.id, s]]),
    });
    const next = applyStaffOutputsPhase(state);
    expect(next.staff.get(s.id)?.loyalty).toBe(78);
  });

  it("does NOT drift when wealth >= 0", () => {
    const player = makeHouse({ id: PLAYER_HOUSE_ID, wealth: 0 });
    const s = makeStaff({ isGreedy: true, loyalty: 80 });
    const state = makeState({
      houses: makeHousesMap([player]),
      staff: new Map([[s.id, s]]),
    });
    const next = applyStaffOutputsPhase(state);
    expect(next.staff.get(s.id)?.loyalty).toBe(80);
  });
});

describe("applyStaffOutputsPhase bribery", () => {
  it("rolls PRNG for Greedy + sub-threshold staff", () => {
    const player = makeHouse({ id: PLAYER_HOUSE_ID, wealth: 100 });
    const s = makeStaff({ isGreedy: true, loyalty: 10 });
    const state = makeState({
      houses: makeHousesMap([player]),
      staff: new Map([[s.id, s]]),
    });
    const next = applyStaffOutputsPhase(state);
    expect(next.rng.get(PLAYER_HOUSE_ID)?.callCount).toBe(1);
  });

  it("does NOT roll for non-Greedy", () => {
    const player = makeHouse({ id: PLAYER_HOUSE_ID, wealth: 100 });
    const s = makeStaff({ isGreedy: false, loyalty: 10 });
    const state = makeState({
      houses: makeHousesMap([player]),
      staff: new Map([[s.id, s]]),
    });
    const next = applyStaffOutputsPhase(state);
    expect(next.rng.get(PLAYER_HOUSE_ID)?.callCount).toBe(0);
  });

  it("does NOT roll when loyalty >= threshold", () => {
    const player = makeHouse({ id: PLAYER_HOUSE_ID, wealth: 100 });
    const s = makeStaff({ isGreedy: true, loyalty: 50 });
    const state = makeState({
      houses: makeHousesMap([player]),
      staff: new Map([[s.id, s]]),
    });
    const next = applyStaffOutputsPhase(state);
    expect(next.rng.get(PLAYER_HOUSE_ID)?.callCount).toBe(0);
  });
});

describe("applyStaffOutputsPhase cadence outputs", () => {
  it("Snoop produces a whisper + courier after STAFF_SNOOP_CADENCE_TICKS", () => {
    const player = makeHouse({ id: PLAYER_HOUSE_ID, wealth: 100 });
    const indep = makeHouse({ id: INDEPENDENT_HOUSE_ID });
    const npc = makeCharacter({ id: "npc-a" as CharacterId, houseId: INDEPENDENT_HOUSE_ID });
    const playerHead = makeCharacter({ id: "p-head" as CharacterId, houseId: PLAYER_HOUSE_ID });
    const s = makeStaff({
      assignment: "Snoop",
      lastOutputTick: 0,
    });
    const state = makeState({
      tick: 8, // exactly STAFF_SNOOP_CADENCE_TICKS
      houses: makeHousesMap([{ ...player, headOfHouseCharacterId: playerHead.id }, indep]),
      characters: makeCharactersMap([playerHead, npc]),
      staff: new Map([[s.id, s]]),
    });
    const next = applyStaffOutputsPhase(state);
    expect(next.whispers.size).toBe(1);
    expect(next.couriers.size).toBe(1);
    expect(next.staff.get(s.id)?.lastOutputTick).toBe(8);
  });

  it("None assignment skips step 3 entirely (no lastOutputTick update)", () => {
    const player = makeHouse({ id: PLAYER_HOUSE_ID, wealth: 100 });
    const s = makeStaff({ assignment: "None", lastOutputTick: null });
    const state = makeState({
      tick: 50,
      houses: makeHousesMap([player]),
      staff: new Map([[s.id, s]]),
    });
    const next = applyStaffOutputsPhase(state);
    expect(next.staff.get(s.id)?.lastOutputTick).toBe(null);
    expect(next.whispers.size).toBe(0);
  });
});

describe("tryAssignStaff", () => {
  it("flips assignment; sets lastOutputTick = state.tick", () => {
    const s = makeStaff({ assignment: "None", lastOutputTick: null });
    const state = makeState({ tick: 10, staff: new Map([[s.id, s]]) });
    const result = tryAssignStaff(state, s.id, "Snoop");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.staff.get(s.id)?.assignment).toBe("Snoop");
    expect(result.state.staff.get(s.id)?.lastOutputTick).toBe(10);
  });

  it("rejects when staff is BribedByRival", () => {
    const s = makeStaff({ assignment: "BribedByRival", bribedAtTick: 5 });
    const state = makeState({ staff: new Map([[s.id, s]]) });
    const result = tryAssignStaff(state, s.id, "Snoop");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason.kind).toBe("StaffBribedByRival");
  });

  it("rejects when caller passes BribedByRival as new assignment", () => {
    const s = makeStaff({ assignment: "None" });
    const state = makeState({ staff: new Map([[s.id, s]]) });
    const result = tryAssignStaff(state, s.id, "BribedByRival");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason.kind).toBe("AssignmentInvalid");
  });
});

describe("trySpymasterMailIntercept", () => {
  it("rejects NoLivingSpymaster when no Spymaster archetype in player house", () => {
    const player = makeHouse({ id: PLAYER_HOUSE_ID, wealth: 100 });
    const head = makeCharacter({ id: "head" as CharacterId, houseId: PLAYER_HOUSE_ID });
    const state = makeState({
      houses: makeHousesMap([{ ...player, headOfHouseCharacterId: head.id }]),
      characters: makeCharactersMap([head]),
    });
    const result = trySpymasterMailIntercept(state);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason.kind).toBe("NoLivingSpymaster");
  });

  it("succeeds when a living Spymaster exists AND eligible courier exists", () => {
    const player = makeHouse({ id: PLAYER_HOUSE_ID, wealth: 100 });
    const head = makeCharacter({ id: "head" as CharacterId, houseId: PLAYER_HOUSE_ID });
    const spy = makeCharacter({
      id: "spy" as CharacterId,
      houseId: PLAYER_HOUSE_ID,
      archetype: "Spymaster",
    });
    const c: CourierPayload = {
      id: "courier:rival:0:0" as CourierPayloadId,
      payloadType: "Whisper",
      whisperId: "w-1" as WhisperId,
      originHouseId: "rival" as HouseId,
      destinationHouseId: PLAYER_HOUSE_ID,
      originLocation: "Country",
      destinationLocation: "Capital",
      originTick: 0,
      arrivalTick: 10,
      interceptable: true,
      direction: "Inbound",
      status: "InFlight",
      resolvedAtTick: null,
    };
    const state = makeState({
      tick: 5,
      houses: makeHousesMap([{ ...player, headOfHouseCharacterId: head.id }]),
      characters: makeCharactersMap([head, spy]),
      couriers: new Map([[c.id, c]]),
    });
    const result = trySpymasterMailIntercept(state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.houses.get(PLAYER_HOUSE_ID)?.wealth).toBe(90);
    expect(result.state.couriers.get(c.id)?.status).toBe("Intercepted");
  });
});

describe("buildBaselineStaffMap (fixture parity)", () => {
  it("seeds 4 staff with stable ids", () => {
    const m = buildBaselineStaffMap();
    expect(m.size).toBe(4);
    expect(m.has("staff-mrs-hudson" as StaffId)).toBe(true);
    expect(m.has("staff-thompson" as StaffId)).toBe(true);
    expect(m.has("staff-greer" as StaffId)).toBe(true);
    expect(m.has("staff-pell" as StaffId)).toBe(true);
  });

  it("is byte-identical across calls (single source of truth)", () => {
    const a = buildBaselineStaffMap();
    const b = buildBaselineStaffMap();
    expect([...a.entries()]).toEqual([...b.entries()]);
  });
});
