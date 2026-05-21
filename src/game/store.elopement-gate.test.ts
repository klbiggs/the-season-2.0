// P9 — ElopementInProgress gate matrix.
//
// Per the Q4 verdict + CLAUDE.md "Modal-state rule-layer gate principle",
// every player-elected mutation wrapper gates on state.elopement !== null.
// This matrix verifies the gate fires across all 17 wrappers.
//
// Setup discipline: each test seeds a synthetic non-null state.elopement via
// useStore.setState (bypassing the load path's invariants — there is no
// production path that constructs this state cleanly because the Q4 gate
// prevents any wrapper from running while sprint is active). The test
// configuration is invariant-violated by design (per the SaveV10 hand-craft
// loophole note in the P9 plan) — the gate's job is to reject regardless.

import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { elopementBus } from "../runtime/events/elopement";
import type { ElopementSprintState } from "./entities";
import type { CharacterId, GrievanceId, HouseId, SchemeId, StaffId, WhisperId } from "./rng";
import { createStore } from "./store";

const SYNTH_SPRINT: ElopementSprintState = {
  schemeId: "synth-scheme" as SchemeId,
  elopingCharacterId: "synth-eloper" as CharacterId,
  targetCharacterId: "synth-target" as CharacterId,
  playerTilePosition: 3,
  fatherTilePosition: 1,
  freshHorsesUsedCount: 0,
  startedAtTick: 0,
};

function setupWithActiveSprint() {
  const store = createStore({ seed: "elopement-gate-test" });
  // Direct partial-update bypassing load-path invariants while keeping all
  // other state fresh. (Production code never constructs this configuration
  // because the Q4 gate intercepts; the test deliberately fabricates it.)
  store.setState({ elopement: SYNTH_SPRINT });
  return store;
}

describe("Elopement gate — typed-rejection wrappers", () => {
  it("travel returns ElopementInProgress", () => {
    const store = setupWithActiveSprint();
    const result = store.getState().travel("Capital");
    expect(result).toEqual({ ok: false, reason: { kind: "ElopementInProgress" } });
  });

  it("escapeBankruptcy returns ElopementInProgress", () => {
    const store = setupWithActiveSprint();
    const result = store.getState().escapeBankruptcy();
    expect(result).toEqual({ ok: false, reason: { kind: "ElopementInProgress" } });
  });

  it("refreshWardrobe returns ElopementInProgress", () => {
    const store = setupWithActiveSprint();
    const result = store.getState().refreshWardrobe();
    expect(result).toEqual({ ok: false, reason: { kind: "ElopementInProgress" } });
  });

  it("startScheme returns ElopementInProgress", () => {
    const store = setupWithActiveSprint();
    const result = store.getState().startScheme({
      kind: "Courting",
      targetCharacterId: "synth-target" as CharacterId,
    });
    expect(result).toEqual({ ok: false, reason: { kind: "ElopementInProgress" } });
  });

  it("cancelScheme returns ElopementInProgress", () => {
    const store = setupWithActiveSprint();
    const result = store.getState().cancelScheme("any-scheme" as SchemeId);
    expect(result).toEqual({ ok: false, reason: { kind: "ElopementInProgress" } });
  });

  it("weaponizeWhisper returns ElopementInProgress", () => {
    const store = setupWithActiveSprint();
    const result = store.getState().weaponizeWhisper("any-w" as WhisperId, "Blackmail");
    expect(result).toEqual({ ok: false, reason: { kind: "ElopementInProgress" } });
  });

  it("dismissWhisper returns ElopementInProgress", () => {
    const store = setupWithActiveSprint();
    const result = store.getState().dismissWhisper("any-w" as WhisperId);
    expect(result).toEqual({ ok: false, reason: { kind: "ElopementInProgress" } });
  });

  it("assignStaff returns ElopementInProgress", () => {
    const store = setupWithActiveSprint();
    const result = store.getState().assignStaff("any-s" as StaffId, "Snoop");
    expect(result).toEqual({ ok: false, reason: { kind: "ElopementInProgress" } });
  });

  it("spymasterIntercept returns ElopementInProgress", () => {
    const store = setupWithActiveSprint();
    const result = store.getState().spymasterIntercept();
    expect(result).toEqual({ ok: false, reason: { kind: "ElopementInProgress" } });
  });

  it("assignTutor returns ElopementInProgress", () => {
    const store = setupWithActiveSprint();
    const result = store.getState().assignTutor(
      "child" as CharacterId,
      "tutor" as CharacterId,
    );
    expect(result).toEqual({ ok: false, reason: { kind: "ElopementInProgress" } });
  });

  it("chooseTutorBonusTrait returns ElopementInProgress", () => {
    const store = setupWithActiveSprint();
    const result = store.getState().chooseTutorBonusTrait(
      "child" as CharacterId,
      "Witty" as never,
    );
    expect(result).toEqual({ ok: false, reason: { kind: "ElopementInProgress" } });
  });

  it("demandSatisfaction returns ElopementInProgress", () => {
    const store = setupWithActiveSprint();
    const result = store
      .getState()
      .demandSatisfaction("rival-house" as HouseId, "g1" as GrievanceId);
    expect(result).toEqual({ ok: false, reason: { kind: "ElopementInProgress" } });
  });
});

describe("Elopement gate — distinct-shape wrappers", () => {
  it("requestAudience returns Denied{ ElopementInProgress }", () => {
    const store = setupWithActiveSprint();
    const result = store.getState().requestAudience();
    expect(result).toEqual({
      outcome: { kind: "Denied", reason: { kind: "ElopementInProgress" } },
    });
  });

  it("proposeMarriage dual-fires: typed-return + ElopementBlocked publish", () => {
    const store = setupWithActiveSprint();
    let publishedAction: string | null = null;
    const unsubscribe = elopementBus.subscribe("ElopementBlocked", (e) => {
      publishedAction = e.attemptedAction;
    });
    const result = store.getState().proposeMarriage("target" as CharacterId);
    unsubscribe();
    expect(result).toEqual({ ok: false, reason: { kind: "ElopementInProgress" } });
    expect(publishedAction).toBe("proposeMarriage");
  });
});

describe("Elopement gate — void-publish wrappers", () => {
  it("advanceTick voids out and publishes ElopementBlocked", () => {
    const store = setupWithActiveSprint();
    const tickBefore = store.getState().tick;
    let publishedAction: string | null = null;
    const unsubscribe = elopementBus.subscribe("ElopementBlocked", (e) => {
      publishedAction = e.attemptedAction;
    });
    store.getState().advanceTick();
    unsubscribe();
    expect(store.getState().tick).toBe(tickBefore); // tick did NOT advance
    expect(publishedAction).toBe("advanceTick");
  });

  it("runYearPass voids out and publishes ElopementBlocked", () => {
    const store = setupWithActiveSprint();
    let publishedAction: string | null = null;
    const unsubscribe = elopementBus.subscribe("ElopementBlocked", (e) => {
      publishedAction = e.attemptedAction;
    });
    store.getState().runYearPass();
    unsubscribe();
    expect(publishedAction).toBe("runYearPass");
  });
});

describe("Elopement gate exemptions", () => {
  it("elopementPush is permitted when sprint is active (gate exemption)", () => {
    const store = setupWithActiveSprint();
    const result = store.getState().elopementPush();
    // The synth-sprint references a character that doesn't exist in fresh
    // state — push fails for that reason, but the gate exemption is what we
    // want to verify: result is NOT ElopementInProgress.
    if (!result.ok) {
      expect(result.reason).not.toEqual({ kind: "ElopementInProgress" });
    }
  });

  it("replaceState is exempt — load-path mirror permits sprint state", () => {
    const store = setupWithActiveSprint();
    // replaceState doesn't have a gate; it carries state through. This is a
    // contract test — we just call it and assert no throw.
    expect(() => {
      store.getState().replaceState({ ...store.getState(), tick: 999 });
    }).not.toThrow();
  });
});
