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
// configuration is invariant-violated by design (per the hand-craft
// loophole note in the P9 plan) — the gate's job is to reject regardless.

import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { type ElopementEvent, elopementBus } from "../runtime/events/elopement";
import type { ElopementSprintState } from "./entities";
import type {
  CharacterId,
  ElopementId,
  GrievanceId,
  HouseId,
  SchemeId,
  StaffId,
  WhisperId,
} from "./rng";
import { createStore } from "./store";

const SYNTH_SPRINT: ElopementSprintState = {
  id: "elopement:synth-scheme:0" as ElopementId,
  schemeId: "synth-scheme" as SchemeId,
  elopingCharacterId: "synth-eloper" as CharacterId,
  targetCharacterId: "synth-target" as CharacterId,
  initiatorHouseId: "player" as HouseId,
  pursuerHouseId: "player" as HouseId,
  isPlayerControlled: true,
  playerTilePosition: 3,
  fatherTilePosition: 1,
  freshHorsesUsedCount: 0,
  abandonOnWin: false,
  resolved: false,
  outcome: null,
  resolvedAtTick: null,
  startedAtTick: 0,
};

function setupWithActiveSprint() {
  const store = createStore({ seed: "elopement-gate-test" });
  // Direct partial-update bypassing load-path invariants while keeping all
  // other state fresh. (Production code never constructs this configuration
  // because the Q4 gate intercepts; the test deliberately fabricates it.)
  store.setState({ elopements: new Map([[SYNTH_SPRINT.id, SYNTH_SPRINT]]) });
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
    const result = store.getState().assignTutor("child" as CharacterId, "tutor" as CharacterId);
    expect(result).toEqual({ ok: false, reason: { kind: "ElopementInProgress" } });
  });

  it("chooseTutorBonusTrait returns ElopementInProgress", () => {
    const store = setupWithActiveSprint();
    const result = store.getState().chooseTutorBonusTrait("child" as CharacterId, "Witty" as never);
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
    const result = store.getState().elopementPush(SYNTH_SPRINT.id);
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

// ── P24a close-out: runYearPass elopement-publisher ride ──────────────────
//
// Non-player sprints do NOT gate runYearPass (hasActivePlayerElopement checks
// player-controlled only), so an aging-step death of a sprint participant
// resolves the sprint via death-cascade Branch 5 DURING year-pass. The wrapper
// must ride publishElopementTransitions to surface that ElopementResolved.
describe("runYearPass elopement-publisher ride", () => {
  it("publishes ElopementResolved when a year-pass death resolves a non-player sprint", () => {
    const store = createStore({ seed: "elopement-yearpass-ride" });
    const s = store.getState();
    // Force the rival head to die on this year-pass (age reaches deathAge).
    const eloper = s.characters.get("rival-ashford-head" as CharacterId);
    if (eloper === undefined) throw new Error("rival-ashford-head missing from bootstrap");
    const chars = new Map(s.characters);
    chars.set(eloper.id, { ...eloper, age: eloper.deathAge - 1 });
    const sprint: ElopementSprintState = {
      ...SYNTH_SPRINT,
      id: "elopement:yearpass-ride:0" as ElopementId,
      schemeId: "yearpass-ride" as SchemeId,
      elopingCharacterId: eloper.id,
      targetCharacterId: "proc-npc-0" as CharacterId,
      initiatorHouseId: "rival-ashford" as HouseId,
      pursuerHouseId: "independent" as HouseId,
      isPlayerControlled: false,
    };
    store.setState({ characters: chars, elopements: new Map([[sprint.id, sprint]]) });

    const events: ElopementEvent[] = [];
    const unsubscribe = elopementBus.subscribe("ElopementResolved", (e) => events.push(e));
    // Also proves the gate: a non-player sprint does NOT block runYearPass.
    store.getState().runYearPass();
    unsubscribe();

    const resolved = store.getState().elopements.get(sprint.id);
    expect(resolved?.resolved).toBe(true);
    expect(resolved?.outcome).toBe("Lost");
    expect(events).toHaveLength(1);
    const event = events[0];
    if (event?.kind !== "ElopementResolved") throw new Error("expected ElopementResolved");
    expect(event.outcome).toBe("Lost");
  });
});

// ── P24a close-out: staff-lifecycle wrappers join the gate matrix (P24c) ───
describe("Elopement gate — staff lifecycle wrappers", () => {
  it("hireStaff returns ElopementInProgress", () => {
    const store = setupWithActiveSprint();
    const result = store.getState().hireStaff();
    expect(result).toEqual({ ok: false, reason: { kind: "ElopementInProgress" } });
  });

  it("fireStaff returns ElopementInProgress", () => {
    const store = setupWithActiveSprint();
    const result = store.getState().fireStaff("staff-mrs-hudson" as StaffId);
    expect(result).toEqual({ ok: false, reason: { kind: "ElopementInProgress" } });
  });

  it("promoteStaff returns ElopementInProgress", () => {
    const store = setupWithActiveSprint();
    const result = store.getState().promoteStaff("staff-mrs-hudson" as StaffId);
    expect(result).toEqual({ ok: false, reason: { kind: "ElopementInProgress" } });
  });
});

// ── P24a close-out: non-player sprints do NOT suspend time (C4) ────────────
describe("Elopement gate — non-player sprints do not block", () => {
  const NON_PLAYER_SPRINT: ElopementSprintState = {
    ...SYNTH_SPRINT,
    id: "elopement:rival-scheme:0" as ElopementId,
    schemeId: "rival-scheme" as SchemeId,
    initiatorHouseId: "rival-ashford" as HouseId,
    pursuerHouseId: "independent" as HouseId,
    isPlayerControlled: false,
  };

  function setupWithNonPlayerSprint() {
    const store = createStore({ seed: "elopement-gate-nonplayer" });
    store.setState({
      elopements: new Map([[NON_PLAYER_SPRINT.id, NON_PLAYER_SPRINT]]),
    });
    return store;
  }

  it("advanceTick advances the clock with an unresolved non-player sprint present", () => {
    const store = setupWithNonPlayerSprint();
    const tickBefore = store.getState().tick;
    store.getState().advanceTick();
    expect(store.getState().tick).toBe(tickBefore + 1);
  });

  it("travel is not ElopementInProgress-blocked by a non-player sprint", () => {
    const store = setupWithNonPlayerSprint();
    const result = store.getState().travel("Country");
    if (!result.ok) {
      expect(result.reason).not.toEqual({ kind: "ElopementInProgress" });
    }
  });

  it("startScheme is not ElopementInProgress-blocked by a non-player sprint", () => {
    const store = setupWithNonPlayerSprint();
    const result = store.getState().startScheme({
      kind: "Courting",
      targetCharacterId: "proc-npc-0" as CharacterId,
    });
    if (!result.ok) {
      expect(result.reason).not.toEqual({ kind: "ElopementInProgress" });
    }
  });
});
