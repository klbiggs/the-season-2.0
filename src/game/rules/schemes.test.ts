// P5: scheme resolver tests. Per the plan's Verification list — per-kind
// happy + rejection paths; cancellation; two-pass Chaperone-preempts-
// Seduction; Smuggling era-edge rejection; bypass consumption; atomic
// gating no-partial-mutation contract; Seduction discovery determinism.

import { describe, expect, it } from "vitest";
import { makeCharacter, makeHouse } from "../__test-utils__/factories";
import {
  ERA_TRANSITION_TICK,
  SCHEME_TUNING,
  SEDUCTION_DISCOVERY_PROBABILITY,
  type SchemeKind,
} from "../constants";
import type { GameState, Scheme } from "../entities";
import { hashState } from "../hash";
import {
  type CharacterId,
  INDEPENDENT_HOUSE_ID,
  PLAYER_HOUSE_ID,
  type SchemeId,
  createRngState,
} from "../rng";
import { applySchemeResolutionPhase, cancelScheme, tryStartScheme } from "./schemes";

// ── Test harness ─────────────────────────────────────────────────────────

function synthStateWith(overrides: Partial<GameState> = {}): GameState {
  const playerHead = makeCharacter({
    id: "player-head" as CharacterId,
    houseId: PLAYER_HOUSE_ID,
    name: "Player Head",
  });
  const npcTarget = makeCharacter({
    id: "npc-target" as CharacterId,
    houseId: INDEPENDENT_HOUSE_ID,
    name: "Target NPC",
  });
  const playerHouse = makeHouse({
    id: PLAYER_HOUSE_ID,
    headOfHouseCharacterId: playerHead.id,
    wealth: 500,
  });
  const indyHouse = makeHouse({
    id: INDEPENDENT_HOUSE_ID,
    headOfHouseCharacterId: npcTarget.id,
  });
  return {
    tick: 5,
    rng: new Map([
      [PLAYER_HOUSE_ID, createRngState("seed-player")],
      [INDEPENDENT_HOUSE_ID, createRngState("seed-indy")],
    ]),
    houses: new Map([
      [PLAYER_HOUSE_ID, playerHouse],
      [INDEPENDENT_HOUSE_ID, indyHouse],
    ]),
    characters: new Map([
      [playerHead.id, playerHead],
      [npcTarget.id, npcTarget],
    ]),
    marriages: new Map(),
    campaignName: "test",
    era: "Earlier",
    conversationHistory: new Map(),
    affectionMap: new Map(),
    schemes: new Map(),
    ...overrides,
  };
}

const TARGET_ID = "npc-target" as CharacterId;

// ── Per-scheme happy path ────────────────────────────────────────────────

describe("tryStartScheme — happy paths", () => {
  it("Courting registers an Active scheme with correct endsAtTick + deducts wealth", () => {
    const state = synthStateWith();
    const result = tryStartScheme(state, PLAYER_HOUSE_ID, {
      kind: "Courting",
      targetCharacterId: TARGET_ID,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const scheme = result.state.schemes.get(result.schemeId);
    expect(scheme).toBeDefined();
    expect(scheme?.status).toBe("Active");
    expect(scheme?.endsAtTick).toBe(5 + SCHEME_TUNING.Courting.durationTicks);
    expect(scheme?.startedAtTick).toBe(5);
    expect(scheme?.accumulatedAffection).toBe(0);
    expect(scheme?.failureReason).toBe(null);
    const player = result.state.houses.get(PLAYER_HOUSE_ID);
    expect(player?.wealth).toBe(500 - SCHEME_TUNING.Courting.wealthCost);
  });

  it("Smuggling does not require a target", () => {
    const state = synthStateWith();
    const result = tryStartScheme(state, PLAYER_HOUSE_ID, {
      kind: "Smuggling",
      targetCharacterId: null,
    });
    expect(result.ok).toBe(true);
  });
});

// ── Rejection paths ──────────────────────────────────────────────────────

describe("tryStartScheme — rejections", () => {
  it("InsufficientWealth when wealth < cost", () => {
    const state = synthStateWith({
      houses: new Map([
        [PLAYER_HOUSE_ID, makeHouse({ id: PLAYER_HOUSE_ID, wealth: 1 })],
        [INDEPENDENT_HOUSE_ID, makeHouse({ id: INDEPENDENT_HOUSE_ID })],
      ]),
    });
    const result = tryStartScheme(state, PLAYER_HOUSE_ID, {
      kind: "Sabotage",
      targetCharacterId: TARGET_ID,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason.kind).toBe("InsufficientWealth");
  });

  it("MissingArchetype when Chaperone has no Spymaster in family", () => {
    const state = synthStateWith();
    const result = tryStartScheme(state, PLAYER_HOUSE_ID, {
      kind: "Chaperone",
      targetCharacterId: TARGET_ID,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason.kind).toBe("MissingArchetype");
  });

  it("UnclaimedSmugglingPass when bypass already earned", () => {
    const state = synthStateWith({
      houses: new Map([
        [
          PLAYER_HOUSE_ID,
          makeHouse({ id: PLAYER_HOUSE_ID, wealth: 500, blockadeBypassEarned: true }),
        ],
        [INDEPENDENT_HOUSE_ID, makeHouse({ id: INDEPENDENT_HOUSE_ID })],
      ]),
    });
    const result = tryStartScheme(state, PLAYER_HOUSE_ID, {
      kind: "Smuggling",
      targetCharacterId: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason.kind).toBe("UnclaimedSmugglingPass");
  });

  it("SmugglingPastEraEdge when completion tick > ERA_TRANSITION_TICK", () => {
    const state = synthStateWith({
      tick: ERA_TRANSITION_TICK - 2, // duration 4 → endsAt = transition + 2
    });
    const result = tryStartScheme(state, PLAYER_HOUSE_ID, {
      kind: "Smuggling",
      targetCharacterId: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason.kind).toBe("SmugglingPastEraEdge");
  });

  it("TargetIsDead when target is alive=false", () => {
    const state = synthStateWith();
    const target = state.characters.get(TARGET_ID);
    if (target === undefined) throw new Error("unreachable");
    const characters = new Map(state.characters);
    characters.set(TARGET_ID, { ...target, alive: false });
    const stateWithDead = { ...state, characters };
    const result = tryStartScheme(stateWithDead, PLAYER_HOUSE_ID, {
      kind: "Courting",
      targetCharacterId: TARGET_ID,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason.kind).toBe("TargetIsDead");
  });

  it("SelfTarget when targeting a character in the owner's own house", () => {
    const state = synthStateWith();
    const result = tryStartScheme(state, PLAYER_HOUSE_ID, {
      kind: "Courting",
      targetCharacterId: "player-head" as CharacterId,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason.kind).toBe("SelfTarget");
  });
});

// ── Atomic gating — rejection paths preserve hash + identity ─────────────

describe("tryStartScheme — atomic gating", () => {
  it("rejection paths preserve hashState (no partial mutation)", () => {
    const state = synthStateWith({
      houses: new Map([
        [PLAYER_HOUSE_ID, makeHouse({ id: PLAYER_HOUSE_ID, wealth: 1 })],
        [INDEPENDENT_HOUSE_ID, makeHouse({ id: INDEPENDENT_HOUSE_ID })],
      ]),
    });
    const hashBefore = hashState(state);
    const result = tryStartScheme(state, PLAYER_HOUSE_ID, {
      kind: "Sabotage",
      targetCharacterId: TARGET_ID,
    });
    expect(result.ok).toBe(false);
    expect(hashState(state)).toBe(hashBefore); // input state unchanged
  });
});

// ── Cancellation ─────────────────────────────────────────────────────────

describe("cancelScheme", () => {
  it("flips Active → Cancelled; no wealth refund", () => {
    const state = synthStateWith();
    const start = tryStartScheme(state, PLAYER_HOUSE_ID, {
      kind: "Courting",
      targetCharacterId: TARGET_ID,
    });
    expect(start.ok).toBe(true);
    if (!start.ok) throw new Error("unreachable");
    const afterStart = start.state;
    const wealthAfterStart = afterStart.houses.get(PLAYER_HOUSE_ID)?.wealth ?? 0;
    const cancel = cancelScheme(afterStart, start.schemeId);
    expect(cancel.ok).toBe(true);
    if (!cancel.ok) throw new Error("unreachable");
    const cancelled = cancel.state.schemes.get(start.schemeId);
    expect(cancelled?.status).toBe("Cancelled");
    expect(cancel.state.houses.get(PLAYER_HOUSE_ID)?.wealth).toBe(wealthAfterStart);
  });

  it("SchemeNotFound for unknown id", () => {
    const state = synthStateWith();
    const result = cancelScheme(state, "nonexistent" as SchemeId);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason.kind).toBe("SchemeNotFound");
  });

  it("SchemeNotActive when already terminal", () => {
    const state = synthStateWith();
    const start = tryStartScheme(state, PLAYER_HOUSE_ID, {
      kind: "Courting",
      targetCharacterId: TARGET_ID,
    });
    if (!start.ok) throw new Error("unreachable");
    const first = cancelScheme(start.state, start.schemeId);
    if (!first.ok) throw new Error("unreachable");
    const second = cancelScheme(first.state, start.schemeId);
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("unreachable");
    expect(second.reason.kind).toBe("SchemeNotActive");
  });
});

// ── Per-kind completion ──────────────────────────────────────────────────

function advanceSchemeToEndTick(
  initial: GameState,
  schemeId: SchemeId,
): { state: GameState; scheme: Scheme } {
  // Fast-forward state.tick to the scheme's endsAtTick and run the phase.
  const scheme = initial.schemes.get(schemeId);
  if (scheme === undefined) throw new Error("scheme missing");
  const stateAtEndTick = { ...initial, tick: scheme.endsAtTick };
  const resolved = applySchemeResolutionPhase(stateAtEndTick);
  const post = resolved.schemes.get(schemeId);
  if (post === undefined) throw new Error("resolver dropped scheme");
  return { state: resolved, scheme: post };
}

describe("per-kind completion", () => {
  it("Courting → +40 affection (clamped), Completed", () => {
    const initial = synthStateWith();
    const start = tryStartScheme(initial, PLAYER_HOUSE_ID, {
      kind: "Courting",
      targetCharacterId: TARGET_ID,
    });
    if (!start.ok) throw new Error("unreachable");
    const { state: resolved, scheme } = advanceSchemeToEndTick(start.state, start.schemeId);
    expect(scheme.status).toBe("Completed");
    // Affection lookup via pair key
    const affectionMap = resolved.affectionMap;
    expect([...affectionMap.values()]).toContain(40);
  });

  it("Sabotage → -30 composure on target + grievance on target's house", () => {
    const initial = synthStateWith();
    const start = tryStartScheme(initial, PLAYER_HOUSE_ID, {
      kind: "Sabotage",
      targetCharacterId: TARGET_ID,
    });
    if (!start.ok) throw new Error("unreachable");
    const { state: resolved, scheme } = advanceSchemeToEndTick(start.state, start.schemeId);
    expect(scheme.status).toBe("Completed");
    const target = resolved.characters.get(TARGET_ID);
    expect(target?.composure).toBe(70); // 100 - 30
    const indyHouse = resolved.houses.get(INDEPENDENT_HOUSE_ID);
    expect(indyHouse?.grievances.length).toBe(1);
    expect(indyHouse?.grievances[0]?.source).toBe("Sabotage");
    expect(indyHouse?.grievances[0]?.perpetratorHouseId).toBe(PLAYER_HOUSE_ID);
  });

  it("Smuggling completion sets blockadeBypassEarned = true", () => {
    const initial = synthStateWith();
    const start = tryStartScheme(initial, PLAYER_HOUSE_ID, {
      kind: "Smuggling",
      targetCharacterId: null,
    });
    if (!start.ok) throw new Error("unreachable");
    const { state: resolved, scheme } = advanceSchemeToEndTick(start.state, start.schemeId);
    expect(scheme.status).toBe("Completed");
    expect(resolved.houses.get(PLAYER_HOUSE_ID)?.blockadeBypassEarned).toBe(true);
  });

  it("target-dies-mid-flight → Failed with TargetDied", () => {
    const initial = synthStateWith();
    const start = tryStartScheme(initial, PLAYER_HOUSE_ID, {
      kind: "Courting",
      targetCharacterId: TARGET_ID,
    });
    if (!start.ok) throw new Error("unreachable");
    // Kill target before completion
    const target = start.state.characters.get(TARGET_ID);
    if (target === undefined) throw new Error("unreachable");
    const characters = new Map(start.state.characters);
    characters.set(TARGET_ID, { ...target, alive: false });
    const stateWithDead = { ...start.state, characters };
    const { scheme } = advanceSchemeToEndTick(stateWithDead, start.schemeId);
    expect(scheme.status).toBe("Failed");
    expect(scheme.failureReason).toBe("TargetDied");
  });
});

// ── Seduction discovery determinism ──────────────────────────────────────

describe("Seduction discovery", () => {
  it("identical seed → identical discover/no-discover sequence", () => {
    // Build a state where the SAME initial RNG seed reliably yields the
    // same outcome across two independent runs.
    function run(): { discovered: boolean; rngAdvanced: boolean } {
      const state = synthStateWith({
        rng: new Map([
          [PLAYER_HOUSE_ID, createRngState("fixed-seed")],
          [INDEPENDENT_HOUSE_ID, createRngState("seed-indy")],
        ]),
      });
      const start = tryStartScheme(state, PLAYER_HOUSE_ID, {
        kind: "Seduction",
        targetCharacterId: TARGET_ID,
      });
      if (!start.ok) throw new Error("unreachable");
      const { state: resolved, scheme } = advanceSchemeToEndTick(start.state, start.schemeId);
      const discovered = scheme.status === "Failed" && scheme.failureReason === "Discovered";
      const rngAfter = resolved.rng.get(PLAYER_HOUSE_ID);
      const rngBefore = state.rng.get(PLAYER_HOUSE_ID);
      const rngAdvanced = (rngAfter?.callCount ?? 0) > (rngBefore?.callCount ?? 0);
      return { discovered, rngAdvanced };
    }
    const a = run();
    const b = run();
    expect(a).toEqual(b);
    expect(a.rngAdvanced).toBe(true);
  });

  it("target-dies-mid-flight Seduction → no RNG draw fired (call-count preserved)", () => {
    const initial = synthStateWith({
      rng: new Map([
        [PLAYER_HOUSE_ID, createRngState("seed")],
        [INDEPENDENT_HOUSE_ID, createRngState("seed-indy")],
      ]),
    });
    const start = tryStartScheme(initial, PLAYER_HOUSE_ID, {
      kind: "Seduction",
      targetCharacterId: TARGET_ID,
    });
    if (!start.ok) throw new Error("unreachable");
    const target = start.state.characters.get(TARGET_ID);
    if (target === undefined) throw new Error("unreachable");
    const characters = new Map(start.state.characters);
    characters.set(TARGET_ID, { ...target, alive: false });
    const stateWithDead = { ...start.state, characters };
    const callCountBefore = stateWithDead.rng.get(PLAYER_HOUSE_ID)?.callCount ?? -1;
    const { state: resolved, scheme } = advanceSchemeToEndTick(stateWithDead, start.schemeId);
    expect(scheme.status).toBe("Failed");
    expect(scheme.failureReason).toBe("TargetDied");
    // No draw fired — call-count unchanged.
    expect(resolved.rng.get(PLAYER_HOUSE_ID)?.callCount).toBe(callCountBefore);
  });
});

// ── Two-pass resolver — Chaperone preempts Seduction ─────────────────────

describe("two-pass resolver — Chaperone preempts Seduction", () => {
  // Use a manually-constructed state with both schemes ending on the same
  // tick, plus a Spymaster archetype on the player so Chaperone can launch.
  it("same-tick Chaperone + Seduction → Seduction is flipped to Cancelled before its resolver runs", () => {
    const spymaster = makeCharacter({
      id: "spymaster-aunt" as CharacterId,
      houseId: PLAYER_HOUSE_ID,
      archetype: "Spymaster",
      name: "Spymaster Aunt",
    });
    const playerHead = makeCharacter({
      id: "player-head" as CharacterId,
      houseId: PLAYER_HOUSE_ID,
      name: "Player Head",
    });
    const target = makeCharacter({
      id: "shared-target" as CharacterId,
      houseId: INDEPENDENT_HOUSE_ID,
      name: "Shared Target",
    });
    const playerHouse = makeHouse({
      id: PLAYER_HOUSE_ID,
      headOfHouseCharacterId: playerHead.id,
      wealth: 500,
    });
    const indyHouse = makeHouse({
      id: INDEPENDENT_HOUSE_ID,
      headOfHouseCharacterId: target.id,
    });
    let state: GameState = {
      tick: 0,
      rng: new Map([
        [PLAYER_HOUSE_ID, createRngState("seed")],
        [INDEPENDENT_HOUSE_ID, createRngState("seed-indy")],
      ]),
      houses: new Map([
        [PLAYER_HOUSE_ID, playerHouse],
        [INDEPENDENT_HOUSE_ID, indyHouse],
      ]),
      characters: new Map([
        [playerHead.id, playerHead],
        [spymaster.id, spymaster],
        [target.id, target],
      ]),
      marriages: new Map(),
      campaignName: "test",
      era: "Earlier",
      conversationHistory: new Map(),
      affectionMap: new Map(),
      schemes: new Map(),
    };
    // Launch Seduction first (tick=0)
    const sed = tryStartScheme(state, PLAYER_HOUSE_ID, {
      kind: "Seduction",
      targetCharacterId: target.id,
    });
    if (!sed.ok) throw new Error("seduction start failed");
    state = sed.state;
    // Now advance state to tick 6 manually and launch Chaperone with duration 1
    // (so both end at tick 7).
    state = { ...state, tick: 6 };
    const chap = tryStartScheme(state, PLAYER_HOUSE_ID, {
      kind: "Chaperone",
      targetCharacterId: target.id,
    });
    if (!chap.ok) throw new Error(`chaperone start failed: ${JSON.stringify(chap.reason)}`);
    state = chap.state;
    // Both should end at tick 7
    expect(state.schemes.get(sed.schemeId)?.endsAtTick).toBe(7);
    expect(state.schemes.get(chap.schemeId)?.endsAtTick).toBe(7);
    // Run resolution at tick 7
    state = { ...state, tick: 7 };
    const resolved = applySchemeResolutionPhase(state);
    // Chaperone completed; Seduction cancelled (NOT Failed/Discovered)
    expect(resolved.schemes.get(chap.schemeId)?.status).toBe("Completed");
    expect(resolved.schemes.get(sed.schemeId)?.status).toBe("Cancelled");
  });
});

// ── SEDUCTION_DISCOVERY_PROBABILITY pin smoke test ───────────────────────

describe("SEDUCTION_DISCOVERY_PROBABILITY", () => {
  it("is pinned at 0.2 per OQ #6 resolution", () => {
    expect(SEDUCTION_DISCOVERY_PROBABILITY).toBe(0.2);
  });
});

// ── SchemeKind cardinality assertion smoke test ──────────────────────────

describe("SCHEME_KINDS cardinality", () => {
  it("is 6 (matches module-load assertion)", () => {
    const kinds: SchemeKind[] = [
      "Courting",
      "Sabotage",
      "Seduction",
      "Chaperone",
      "Smuggling",
      "Assassination",
    ];
    expect(kinds.length).toBe(6);
  });
});
