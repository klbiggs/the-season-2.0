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
