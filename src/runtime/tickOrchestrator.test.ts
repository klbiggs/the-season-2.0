import { describe, expect, it } from "vitest";
import {
  makeCharacter,
  makeCharactersMap,
  makeHouse,
  makeHousesMap,
} from "../game/__test-utils__/factories";
import { CALLING_CARD_EXPIRY_TICKS } from "../game/constants";
import type { Character, GameState, MarriageRecord } from "../game/entities";
import {
  type CharacterId,
  type HouseId,
  type MarriageId,
  type RngState,
  createRngState,
} from "../game/rng";
import { INDEPENDENT_HOUSE_ID, PLAYER_HOUSE_ID } from "../game/rng.seeds";
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
    callingCards: new Map(),
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
  it("happiness-drift phase fires after mood-drift and before rival-action (slot 10 of 17)", () => {
    const tracker = createPhaseOrderTracker();
    const phases = [
      tracker.trackedPhase("advance-tick"),
      tracker.trackedPhase("economy"),
      tracker.trackedPhase("location-effects"),
      tracker.trackedPhase("courier-draining"),
      tracker.trackedPhase("scheme-resolution"),
      tracker.trackedPhase("global-event-roll"),
      // P26: calling-card roll inserted immediately after the global-event roll.
      tracker.trackedPhase("calling-card"),
      tracker.trackedPhase("mood-drift"),
      tracker.trackedPhase("happiness-drift"),
      tracker.trackedPhase("rival-action"),
      // P15: RNG-free dynasty-perk evaluation appended after rivals (terminal).
      tracker.trackedPhase("dynasty-perk-evaluation"),
    ];
    runOrchestratorWithPhases(makeState({}), phases);
    expect(tracker.trace).toHaveLength(11);
    // Slot 10 happiness sits between mood-drift (slot 9) and rival-action.
    const globalEventIdx = tracker.trace.indexOf("global-event-roll");
    const callingCardIdx = tracker.trace.indexOf("calling-card");
    const moodIdx = tracker.trace.indexOf("mood-drift");
    const happinessIdx = tracker.trace.indexOf("happiness-drift");
    const rivalIdx = tracker.trace.indexOf("rival-action");
    const perkIdx = tracker.trace.indexOf("dynasty-perk-evaluation");
    // P26: calling-card sits between the global-event roll and mood drift —
    // both are player-stream draws, so the relative order is the determinism
    // contract.
    expect(callingCardIdx).toBe(globalEventIdx + 1);
    expect(moodIdx).toBe(callingCardIdx + 1);
    expect(happinessIdx).toBe(moodIdx + 1);
    expect(rivalIdx).toBe(happinessIdx + 1);
    // P15: rival-action is the last RNG-CONSUMING phase (second-to-last overall);
    // the RNG-free dynasty-perk evaluation is the sole phase permitted after it.
    expect(rivalIdx).toBe(tracker.trace.length - 2);
    expect(perkIdx).toBe(tracker.trace.length - 1);
  });
});

// The ordering test above runs a SUBSTITUTED phase array, so it can never prove
// the real (module-private) PHASES contains the calling-card phase. This drives
// advanceTickPure — the only reader of PHASES — and asserts a card actually
// mints. applyCallingCardPhase is the sole writer of state.callingCards, so
// dropping it from the chain fails this outright.
describe("advanceTickPure — calling-card phase is wired into the real PHASES chain", () => {
  function stateWithCallerPool(seed: string): GameState {
    // Caller pool = adult, alive, non-player, non-rival characters. Society
    // (Independent) NPCs qualify; the player head does not.
    const head = makeCharacter({ id: "test-char" as CharacterId, houseId: PLAYER_HOUSE_ID });
    const npcs = Array.from({ length: 6 }, (_, i) =>
      makeCharacter({
        id: `npc-${i}` as CharacterId,
        houseId: INDEPENDENT_HOUSE_ID,
        age: 25,
        alive: true,
      }),
    );
    return makeState({
      rng: new Map<HouseId, RngState>([[PLAYER_HOUSE_ID, createRngState(seed)]]),
      houses: makeHousesMap([makeHouse()]),
      characters: makeCharactersMap([head, ...npcs]),
    });
  }

  it("mints and later expires calling cards when driven through advanceTickPure", () => {
    let state = stateWithCallerPool("orchestrator-calling-card");
    for (let i = 0; i < 300; i += 1) {
      state = advanceTickPure(state);
    }
    const cards = [...state.callingCards.values()];
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      // Caller came from the eligible pool (never the player head).
      expect(card.callerCharacterId.startsWith("npc-")).toBe(true);
      // Absolute end-tick, per the one-canonical-clock rule.
      expect(card.expiresAtTick).toBe(card.issuedAtTick + CALLING_CARD_EXPIRY_TICKS);
    }
    // The expiry sweep runs inside the live chain too, so long-past cards are
    // no longer Pending.
    expect(cards.some((c) => c.status === "Expired")).toBe(true);
  });
});
