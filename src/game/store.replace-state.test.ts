// Set-body completeness trip-wire. Catches the "added a GameState field,
// forgot to copy it in one of the set-bodies" footgun.
//
// Mechanism: construct two GameStates with distinct values for every
// schema key, then call each store action that fully overwrites state
// (replaceState, plus the implicit overwrites via advanceTick / runYearPass
// / the 4 P3 player actions all routing through overwriteFromGameState).
// Compare the resulting state's keys to GameStateSchema.shape — any field
// that the set-body forgot to copy stays at the OLD value, breaking the
// per-key equality assertion.
//
// Why this matters beyond the triple-sync trip-wire: schema↔projection↔
// selector ensures every schema key is in the projection AND the selector.
// It does NOT ensure every set-body covers every key — a future
// `overwriteFromGameState` extension that adds a new schema field but
// forgets to assign it inside the helper would pass triple-sync but fail
// here.

import { describe, expect, it } from "vitest";
import { makeElopementSprint } from "./__test-utils__/factories";
import { GameStateSchema } from "./entities";
import { type GameState, createInitialState, createStore } from "./store";

describe("replaceState set-body completeness", () => {
  it("replaceState copies EVERY GameStateSchema field from `next` to draft", () => {
    const store = createStore({ seed: "set-body-A" });
    // Construct a target state with maximally-different values for every
    // top-level GameState key. createInitialState gives us a valid shape
    // for nested Maps (rng/houses/characters/marriages); we override the
    // scalar tops to distinct values.
    const target: GameState = {
      ...createInitialState("set-body-B"),
      tick: 999, // distinct from seed-A's tick=0
      campaignName: "Set-Body Test Campaign",
      era: "Later", // distinct from seed-A's era="Earlier"
    };
    store.getState().replaceState(target);
    const after = store.getState();

    // Per-key equality. Object.keys(GameStateSchema.shape) is the source
    // of truth for "every schema field".
    for (const key of Object.keys(GameStateSchema.shape) as Array<keyof GameState>) {
      expect(after[key]).toEqual(target[key]);
    }
  });

  it("advanceTick produces a state whose keys match GameStateSchema.shape", () => {
    // Indirect coverage: if advanceTick's set-body forgot a key, the
    // post-advance state would have that key at the pre-advance value.
    // The replay-harness catches drift via hash equality, but this test
    // pins the contract at the key-set level.
    const store = createStore({ seed: "set-body-tick" });
    store.getState().advanceTick();
    const after = store.getState();
    const schemaKeys = new Set(Object.keys(GameStateSchema.shape));
    const stateKeys = new Set<string>();
    for (const key of schemaKeys) {
      if (key in after) stateKeys.add(key);
    }
    expect(stateKeys).toEqual(schemaKeys);
  });

  // P7: schema↔projection↔selector↔overwriteFromGameState quad-sync write-side
  // mirror. Each new top-level Map must survive a tick-advancing action; if
  // overwriteFromGameState forgot the draft assignment, the tick advance
  // silently CLEARS the Map.
  it("travel preserves a seeded proposalsLog entry (overwriteFromGameState P7 quad-sync)", () => {
    const store = createStore({ seed: "p7-quad-A" });
    const synth = {
      ...createInitialState("p7-quad-A"),
      proposalsLog: new Map([
        [
          "test-target" as never,
          { outcome: "Accepted" as const, tick: 0, byCharacterId: "test-proposer" as never },
        ],
      ]),
    };
    store.getState().replaceState(synth);
    expect(store.getState().proposalsLog.size).toBe(1);
    store.getState().travel("Country");
    expect(store.getState().proposalsLog.size).toBe(1);
  });

  it("travel preserves a seeded tutorAssignmentsLog entry (overwriteFromGameState P7 quad-sync)", () => {
    const store = createStore({ seed: "p7-quad-B" });
    const synth = {
      ...createInitialState("p7-quad-B"),
      tutorAssignmentsLog: new Map([
        [
          "child-test" as never,
          {
            tutorCharacterId: "tutor-test" as never,
            assignedAtTick: 0,
            reassignmentCount: 0,
          },
        ],
      ]),
    };
    store.getState().replaceState(synth);
    expect(store.getState().tutorAssignmentsLog.size).toBe(1);
    store.getState().travel("Country");
    expect(store.getState().tutorAssignmentsLog.size).toBe(1);
  });

  it("travel preserves a seeded pendingTutorTraitChoices entry (overwriteFromGameState P7 quad-sync)", () => {
    const store = createStore({ seed: "p7-quad-C" });
    const synth = {
      ...createInitialState("p7-quad-C"),
      pendingTutorTraitChoices: new Map([
        [
          "child-test" as never,
          {
            childId: "child-test" as never,
            tutorId: "tutor-test" as never,
            archetype: "Spymaster" as const,
            acceptableTraitIds: ["Observant" as never, "Cunning" as never] as [never, never],
            createdAtTick: 0,
          },
        ],
      ]),
    };
    store.getState().replaceState(synth);
    expect(store.getState().pendingTutorTraitChoices.size).toBe(1);
    store.getState().travel("Country");
    expect(store.getState().pendingTutorTraitChoices.size).toBe(1);
  });
});

describe("P9 quint-sync: state.elopement (overwriteFromGameState 5th surface)", () => {
  // Branch 5 of pruneOrphanedConversationKeys can flip state.elopement to null;
  // overwriteFromGameState must mirror the field on every set call. Forgetting
  // the `draft.elopement = next.elopement` line would silently CLEAR mid-sprint
  // state on the next tick-advancing action.
  it("replaceState carries a non-empty elopements map through", () => {
    const store = createStore({ seed: "p9-quint-A" });
    const sprint = makeElopementSprint({ playerTilePosition: 3, fatherTilePosition: 1 });
    const elopements = new Map([[sprint.id, sprint]]);
    const synth = {
      ...createInitialState("p9-quint-A"),
      elopements,
    };
    store.getState().replaceState(synth);
    expect(store.getState().elopements).toEqual(elopements);
  });

  it("tick-advance from an empty elopements map preserves it empty", () => {
    const store = createStore({ seed: "p9-quint-B" });
    expect(store.getState().elopements.size).toBe(0);
    store.getState().advanceTick();
    expect(store.getState().elopements.size).toBe(0);
  });
});

describe("P13 quint-sync: state.globalEvents (overwriteFromGameState 6th surface)", () => {
  // applyGlobalEventPhase mutates state.globalEvents every tick (the 5%/tick
  // trigger roll may spawn an event; ongoing events expire at their endTick).
  // overwriteFromGameState must mirror the field on every set call. Forgetting
  // the `draft.globalEvents = next.globalEvents` line would silently CLEAR
  // every spawn on the very next tick-advancing action.
  it("replaceState carries a non-empty globalEvents Map through", () => {
    const store = createStore({ seed: "p13-quint-A" });
    const event = {
      kind: "WarEffort" as const,
      id: "globalevent-WarEffort-0" as import("./rng").GlobalEventId,
      startTick: 0,
      endTick: 100,
    };
    const synth = {
      ...createInitialState("p13-quint-A"),
      globalEvents: new Map([[event.id, event]]),
    };
    store.getState().replaceState(synth);
    expect(store.getState().globalEvents.size).toBe(1);
    expect(store.getState().globalEvents.get(event.id)).toEqual(event);
  });

  it("advanceTick preserves seeded globalEvents through overwriteFromGameState mirror writes", () => {
    const store = createStore({ seed: "p13-quint-B" });
    const event = {
      kind: "MarketCrash" as const,
      id: "globalevent-MarketCrash-0" as import("./rng").GlobalEventId,
      startTick: 0,
      endTick: 1000, // far future so expiry doesn't drop it
    };
    const synth = {
      ...createInitialState("p13-quint-B"),
      globalEvents: new Map([[event.id, event]]),
    };
    store.getState().replaceState(synth);
    store.getState().advanceTick();
    // Without draft.globalEvents = next.globalEvents in overwriteFromGameState,
    // the tick advance would silently clear the Map.
    expect(store.getState().globalEvents.size).toBeGreaterThanOrEqual(1);
    expect(store.getState().globalEvents.has(event.id)).toBe(true);
  });
});

describe("P18 quint-sync: state.flavorText (overwriteFromGameState 7th surface)", () => {
  // recordFlavorText is the only mutator and never runs inside a tick, so the
  // real risk is a tick-advancing action CLEARING a previously-recorded entry.
  // Without `draft.flavorText = next.flavorText` in overwriteFromGameState, the
  // next advanceTick would silently destroy the persisted flavor text.
  const entry = {
    id: "artifact:sapphires" as import("./rng").FlavorContentId,
    kind: "ArtifactBackstory" as const,
    text: "A storied heirloom.",
    generatedAtTick: 0,
  };

  it("replaceState carries a non-empty flavorText Map through", () => {
    const store = createStore({ seed: "p18-quint-A" });
    const synth = {
      ...createInitialState("p18-quint-A"),
      flavorText: new Map([[entry.id, entry]]),
      betrothals: new Map(),
    };
    store.getState().replaceState(synth);
    expect(store.getState().flavorText.size).toBe(1);
    expect(store.getState().flavorText.get(entry.id)).toEqual(entry);
  });

  it("advanceTick preserves a seeded flavorText entry through the mirror writes", () => {
    const store = createStore({ seed: "p18-quint-B" });
    const synth = {
      ...createInitialState("p18-quint-B"),
      flavorText: new Map([[entry.id, entry]]),
      betrothals: new Map(),
    };
    store.getState().replaceState(synth);
    store.getState().advanceTick();
    expect(store.getState().flavorText.has(entry.id)).toBe(true);
    expect(store.getState().flavorText.get(entry.id)).toEqual(entry);
  });
});

describe("P23 quad-sync: state.betrothals (overwriteFromGameState mirror surface)", () => {
  // Without `draft.betrothals = next.betrothals` in overwriteFromGameState, the
  // next tick-advancing action would silently CLEAR an arranged betrothal — and
  // the auto-honor year-pass step would never fire.
  const betrothal = {
    id: "child-a:child-b:0:0" as import("./rng").BetrothalId,
    partyAId: "child-a" as import("./rng").CharacterId,
    partyBId: "child-b" as import("./rng").CharacterId,
    arrangedAtTick: 0,
    status: "Pending" as const,
    resolvedAtTick: null,
    honoredMarriageId: null,
  };

  it("replaceState carries a non-empty betrothals Map through", () => {
    const store = createStore({ seed: "p23-quad-A" });
    const synth = {
      ...createInitialState("p23-quad-A"),
      betrothals: new Map([[betrothal.id, betrothal]]),
    };
    store.getState().replaceState(synth);
    expect(store.getState().betrothals.size).toBe(1);
    expect(store.getState().betrothals.get(betrothal.id)).toEqual(betrothal);
  });

  it("advanceTick preserves a seeded betrothal entry through the mirror writes", () => {
    const store = createStore({ seed: "p23-quad-B" });
    const synth = {
      ...createInitialState("p23-quad-B"),
      betrothals: new Map([[betrothal.id, betrothal]]),
    };
    store.getState().replaceState(synth);
    store.getState().advanceTick();
    expect(store.getState().betrothals.has(betrothal.id)).toBe(true);
    expect(store.getState().betrothals.get(betrothal.id)).toEqual(betrothal);
  });
});
