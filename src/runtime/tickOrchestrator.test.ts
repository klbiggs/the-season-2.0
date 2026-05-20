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
});
