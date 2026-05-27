import { describe, expect, it } from "vitest";
import {
  makeCharacter,
  makeCharactersMap,
  makeHouse,
  makeHousesMap,
} from "../game/__test-utils__/factories";
import type { Character, GameState, MarriageRecord } from "../game/entities";
import {
  type CharacterId,
  type HouseId,
  type MarriageId,
  type RngState,
  createRngState,
} from "../game/rng";
import { PLAYER_HOUSE_ID } from "../game/rng.seeds";
import { createPhaseOrderTracker } from "./__test-utils__/phaseOrderTracker";
import { advanceTickPure, runOrchestratorWithPhases } from "./tickOrchestrator";

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
    elopements: new Map(),
    artifactInstances: new Map(),
    forgeries: new Map(),
    thiefAttempts: new Map(),
    proceduralArtifactDefinitions: new Map(),
    globalEvents: new Map(),
    flavorText: new Map(),
    betrothals: new Map(),
    ...overrides,
  };
}

describe("advanceTickPure — phase-array ordering", () => {
  it("increments tick by exactly 1", () => {
    const next = advanceTickPure(makeState({ tick: 5 }));
    expect(next.tick).toBe(6);
  });
  it("applies economy phase (Hemorrhaging tier deducts wealth)", () => {
    const h = makeHouse({ wealth: -50 });
    const next = advanceTickPure(makeState({ houses: makeHousesMap([h]) }));
    // Hemorrhaging: -2 wealth → -52.
    expect(next.houses.get(h.id)?.wealth).toBe(-52);
  });
  it("applies mood drift phase (consumes draws for unlocked living characters)", () => {
    const c = makeCharacter({
      id: "c" as CharacterId,
      houseId: PLAYER_HOUSE_ID,
      alive: true,
      moodLockUntilTick: 0,
    });
    const state = makeState({
      houses: makeHousesMap([makeHouse()]),
      characters: makeCharactersMap([c]),
    });
    const before = state.rng.get(PLAYER_HOUSE_ID)?.callCount ?? 0;
    const next = advanceTickPure(state);
    const after = next.rng.get(PLAYER_HOUSE_ID)?.callCount ?? 0;
    expect(after).toBeGreaterThan(before);
  });

  // P3: location-effects phase must fire AFTER economy and BEFORE
  // courier-draining (which is still a stub). Use runOrchestratorWithPhases
  // + phaseOrderTracker to assert the call order directly — the same
  // pattern P8 will inherit for the §7 audience-before-rival test when
  // real rival-action effects ship.
  it("location-effects phase fires after economy and before courier-draining", () => {
    const tracker = createPhaseOrderTracker();
    const phases = [
      tracker.trackedPhase("advance-tick"),
      tracker.trackedPhase("economy"),
      tracker.trackedPhase("location-effects"),
      tracker.trackedPhase("courier-draining"),
      tracker.trackedPhase("scheme-resolution"),
      tracker.trackedPhase("global-event-roll"),
      tracker.trackedPhase("mood-drift"),
      tracker.trackedPhase("rival-action"),
    ];
    runOrchestratorWithPhases(makeState({}), phases);
    expect(tracker.trace).toEqual([
      "advance-tick",
      "economy",
      "location-effects",
      "courier-draining",
      "scheme-resolution",
      "global-event-roll",
      "mood-drift",
      "rival-action",
    ]);
    // Specifically pin the two adjacencies that the plan calls out: economy
    // → location-effects (so bankruptcy-tier classification uses pre-effects
    // wealth) and location-effects → courier-draining (P6 will lean on this).
    const economyIdx = tracker.trace.indexOf("economy");
    const locIdx = tracker.trace.indexOf("location-effects");
    const courierIdx = tracker.trace.indexOf("courier-draining");
    expect(locIdx).toBe(economyIdx + 1);
    expect(courierIdx).toBe(locIdx + 1);
  });

  // P7: happiness drift phase inserts at slot 8 (between mood-drift and
  // rival-action stub). "Rivals always run last" contract preserved.
  it("happiness-drift phase fires after mood-drift and before rival-action (slot 8 of 9)", () => {
    const tracker = createPhaseOrderTracker();
    const phases = [
      tracker.trackedPhase("advance-tick"),
      tracker.trackedPhase("economy"),
      tracker.trackedPhase("location-effects"),
      tracker.trackedPhase("courier-draining"),
      tracker.trackedPhase("scheme-resolution"),
      tracker.trackedPhase("global-event-roll"),
      tracker.trackedPhase("mood-drift"),
      tracker.trackedPhase("happiness-drift"),
      tracker.trackedPhase("rival-action"),
      // P15: RNG-free dynasty-perk evaluation appended after rivals (terminal).
      tracker.trackedPhase("dynasty-perk-evaluation"),
    ];
    runOrchestratorWithPhases(makeState({}), phases);
    expect(tracker.trace).toHaveLength(10);
    // Slot 8 happiness sits between mood-drift (slot 7) and rival-action.
    const moodIdx = tracker.trace.indexOf("mood-drift");
    const happinessIdx = tracker.trace.indexOf("happiness-drift");
    const rivalIdx = tracker.trace.indexOf("rival-action");
    const perkIdx = tracker.trace.indexOf("dynasty-perk-evaluation");
    expect(happinessIdx).toBe(moodIdx + 1);
    expect(rivalIdx).toBe(happinessIdx + 1);
    // P15: rival-action is the last RNG-CONSUMING phase (second-to-last overall);
    // the RNG-free dynasty-perk evaluation is the sole phase permitted after it.
    expect(rivalIdx).toBe(tracker.trace.length - 2);
    expect(perkIdx).toBe(tracker.trace.length - 1);
  });
});
