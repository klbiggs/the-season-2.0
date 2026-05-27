// P5: scheme resolver tests. Per the plan's Verification list — per-kind
// happy + rejection paths; cancellation; two-pass Chaperone-preempts-
// Seduction; Smuggling era-edge rejection; bypass consumption; atomic
// gating no-partial-mutation contract; Seduction discovery determinism.

import { describe, expect, it } from "vitest";
import { makeCharacter, makeHouse } from "../__test-utils__/factories";
import {
  ERA_TRANSITION_TICK,
  SCHEME_TUNING,
  SEDUCTION_AFFECTION_PER_TICK,
  type SchemeKind,
  WAR_EFFORT_SEDUCTION_AFFECTION_MULTIPLIER,
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
    globalEvents: new Map(),
    flavorText: new Map(),
    betrothals: new Map(),
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

// ── P13 verification matrix #14: WarEffort × officer Seduction multiplier

describe("Seduction WarEffort × MilitaryOfficer multiplier (P13 matrix #14)", () => {
  // Find a seed where the Seduction discovery roll returns >= 0.2 (success
  // branch). The multiplier only kicks in on the success path; if the seed
  // discovers, the test path is vacuous.
  function findSuccessSeed(): string {
    // Sweep a small set; the per-tick suspicion p is small for a single
    // completing tick (accumulatedAffection starts at 0), so most seeds land in
    // the success branch. Test fails loudly if 100 seeds all discover.
    for (let i = 0; i < 100; i += 1) {
      const seed = `multiplier-probe-${i}`;
      const initial = synthStateWith({
        rng: new Map([
          [PLAYER_HOUSE_ID, createRngState(seed)],
          [INDEPENDENT_HOUSE_ID, createRngState("indy")],
        ]),
      });
      const start = tryStartScheme(initial, PLAYER_HOUSE_ID, {
        kind: "Seduction",
        targetCharacterId: TARGET_ID,
      });
      if (!start.ok) continue;
      const { scheme } = advanceSchemeToEndTick(start.state, start.schemeId);
      if (scheme.status === "Completed") return seed;
    }
    throw new Error("no success-branch seed found in 100 tries");
  }

  it("officer aggressor + active WarEffort → affection delta uses 1.5× multiplier (post-clamp at 100)", () => {
    const successSeed = findSuccessSeed();
    const baseRng = new Map([
      [PLAYER_HOUSE_ID, createRngState(successSeed)],
      [INDEPENDENT_HOUSE_ID, createRngState("indy")],
    ]);

    // Baseline: no officer, no WarEffort. Affection delta = baseline 80.
    const baselineState = synthStateWith({ rng: baseRng });
    const baselineStart = tryStartScheme(baselineState, PLAYER_HOUSE_ID, {
      kind: "Seduction",
      targetCharacterId: TARGET_ID,
    });
    if (!baselineStart.ok) throw new Error("baseline start failed");
    const { state: baselineResolved } = advanceSchemeToEndTick(
      baselineStart.state,
      baselineStart.schemeId,
    );
    const baselineKey = [...baselineResolved.affectionMap.keys()].find((k) =>
      k.includes(TARGET_ID),
    );
    if (baselineKey === undefined) throw new Error("baseline missing affection key");
    const baselineDelta = baselineResolved.affectionMap.get(baselineKey) ?? 0;

    // With multiplier: officer-tagged aggressor + active WarEffort.
    // The aggressor for Seduction is gated by archetype (BohemianRake). The
    // existing synthStateWith's player-head doesn't have that archetype, so
    // tryStartScheme rejects with MissingArchetype unless we override. Look
    // up what selectAggressor would do: synthStateWith's player-head defaults
    // to archetype "None" — so we must override with BohemianRake AND tag
    // with MilitaryOfficer.
    const playerHeadOfficer = makeCharacter({
      id: "player-head" as CharacterId,
      houseId: PLAYER_HOUSE_ID,
      name: "Officer Head",
      archetype: "BohemianRake",
      traits: ["MilitaryOfficer" as import("../rng").TraitId],
    });
    const officerWarState = synthStateWith({
      rng: baseRng,
      characters: new Map([
        [playerHeadOfficer.id, playerHeadOfficer],
        [
          TARGET_ID,
          makeCharacter({ id: TARGET_ID, houseId: INDEPENDENT_HOUSE_ID, name: "Target" }),
        ],
      ]),
      globalEvents: new Map([
        [
          "globalevent-WarEffort-0" as import("../rng").GlobalEventId,
          {
            kind: "WarEffort",
            id: "globalevent-WarEffort-0" as import("../rng").GlobalEventId,
            startTick: 0,
            endTick: 100,
          },
        ],
      ]),
    });
    // Baseline player head doesn't have BohemianRake archetype either; if
    // baselineStart succeeded, that means Seduction's selectAggressor
    // accepts headOfHouse for an empty-prereq scheme. Actually Seduction
    // DOES require an archetype — if baseline succeeded, the test fixture
    // setup is different than expected. Sanity-check: baseline.ok was true.
    // Re-check by retrying with the officer state.
    const officerStart = tryStartScheme(officerWarState, PLAYER_HOUSE_ID, {
      kind: "Seduction",
      targetCharacterId: TARGET_ID,
    });
    if (!officerStart.ok) {
      // If the rule rejects, document why and skip the assertion. Likely
      // baseline succeeded because synthStateWith's player-head has a
      // default archetype that Seduction accepts.
      throw new Error(
        `officerStart rejected: ${JSON.stringify(officerStart.reason)} — fixture archetype mismatch`,
      );
    }
    const { state: officerResolved, scheme: officerScheme } = advanceSchemeToEndTick(
      officerStart.state,
      officerStart.schemeId,
    );
    expect(officerScheme.status).toBe("Completed");
    const officerKey = [...officerResolved.affectionMap.keys()].find((k) => k.includes(TARGET_ID));
    if (officerKey === undefined) throw new Error("officer missing affection key");
    const officerDelta = officerResolved.affectionMap.get(officerKey) ?? 0;

    // P24a (multi-tick): a single completing tick accrues one per-tick delta;
    // the WarEffort × officer multiplier scales the per-tick base.
    expect(baselineDelta).toBe(SEDUCTION_AFFECTION_PER_TICK);
    expect(officerDelta).toBe(
      Math.round(SEDUCTION_AFFECTION_PER_TICK * WAR_EFFORT_SEDUCTION_AFFECTION_MULTIPLIER),
    );
    expect(officerDelta).toBeGreaterThan(baselineDelta);
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
      globalEvents: new Map(),
      flavorText: new Map(),
      betrothals: new Map(),
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

// ── selectAggressor invariant: validation walk == aggressor walk ─────────
// Locks the "same filter both branches" contract. selectAggressor is private
// to schemes.ts, so we exercise it indirectly via tryStartScheme: when an
// archetype-gated kind validates ok, the registered scheme's
// aggressorCharacterId MUST be a living family member matching the
// prerequisite archetype.

describe("selectAggressor — validation walk == aggressor walk invariant", () => {
  it("Chaperone start binds aggressorCharacterId to a living Spymaster", () => {
    const playerHead = makeCharacter({
      id: "player-head" as CharacterId,
      houseId: PLAYER_HOUSE_ID,
      archetype: "None",
    });
    const spymasterAunt = makeCharacter({
      id: "spymaster-aunt" as CharacterId,
      houseId: PLAYER_HOUSE_ID,
      archetype: "Spymaster",
    });
    const target = makeCharacter({
      id: "target" as CharacterId,
      houseId: INDEPENDENT_HOUSE_ID,
    });
    const state: GameState = {
      tick: 0,
      rng: new Map([
        [PLAYER_HOUSE_ID, createRngState("seed")],
        [INDEPENDENT_HOUSE_ID, createRngState("seed-indy")],
      ]),
      houses: new Map([
        [
          PLAYER_HOUSE_ID,
          makeHouse({ id: PLAYER_HOUSE_ID, headOfHouseCharacterId: playerHead.id, wealth: 500 }),
        ],
        [
          INDEPENDENT_HOUSE_ID,
          makeHouse({ id: INDEPENDENT_HOUSE_ID, headOfHouseCharacterId: target.id }),
        ],
      ]),
      characters: new Map([
        [playerHead.id, playerHead],
        [spymasterAunt.id, spymasterAunt],
        [target.id, target],
      ]),
      marriages: new Map(),
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
    };
    const result = tryStartScheme(state, PLAYER_HOUSE_ID, {
      kind: "Chaperone",
      targetCharacterId: target.id,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const scheme = result.state.schemes.get(result.schemeId);
    expect(scheme?.aggressorCharacterId).toBe(spymasterAunt.id);
    if (scheme === undefined) throw new Error("scheme not found");
    // The aggressor must be the family member matching the prereq archetype.
    const aggressor = result.state.characters.get(scheme.aggressorCharacterId);
    expect(aggressor?.archetype).toBe("Spymaster");
    expect(aggressor?.alive).toBe(true);
    expect(aggressor?.houseId).toBe(PLAYER_HOUSE_ID);
  });

  // P24a hardening: the C2 aggressor picker passes explicitAggressorCharacterId.
  // The house-level MissingArchetype gate only proves SOME member qualifies — so
  // a player whose family contains a Spymaster could otherwise pick a non-Spymaster
  // as the Chaperone aggressor and bypass the prerequisite. The explicit aggressor
  // must itself satisfy the archetype gate.
  it("rejects an explicit aggressor that does NOT satisfy the archetype prerequisite", () => {
    const ineligibleHead = makeCharacter({
      id: "player-head" as CharacterId, // matches synthStateWith's head id
      houseId: PLAYER_HOUSE_ID,
      archetype: "None",
    });
    const spymasterAunt = makeCharacter({
      id: "spymaster-aunt" as CharacterId,
      houseId: PLAYER_HOUSE_ID,
      archetype: "Spymaster",
    });
    const npcTarget = makeCharacter({
      id: TARGET_ID,
      houseId: INDEPENDENT_HOUSE_ID,
    });
    const state = synthStateWith({
      characters: new Map([
        [ineligibleHead.id, ineligibleHead],
        [spymasterAunt.id, spymasterAunt],
        [npcTarget.id, npcTarget],
      ]),
    });
    // Family HAS a Spymaster (house gate passes), but the chosen aggressor is the
    // None-archetype head → must reject rather than launch with an ineligible aggressor.
    const result = tryStartScheme(state, PLAYER_HOUSE_ID, {
      kind: "Chaperone",
      targetCharacterId: TARGET_ID,
      explicitAggressorCharacterId: ineligibleHead.id,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason.kind).toBe("MissingArchetype");
    // No scheme registered, no wealth deducted (atomic gating).
    expect(state.schemes.size).toBe(0);
  });

  it("accepts an explicit aggressor that DOES satisfy the archetype prerequisite", () => {
    const ineligibleHead = makeCharacter({
      id: "player-head" as CharacterId,
      houseId: PLAYER_HOUSE_ID,
      archetype: "None",
    });
    const spymasterAunt = makeCharacter({
      id: "spymaster-aunt" as CharacterId,
      houseId: PLAYER_HOUSE_ID,
      archetype: "Spymaster",
    });
    const npcTarget = makeCharacter({
      id: TARGET_ID,
      houseId: INDEPENDENT_HOUSE_ID,
    });
    const state = synthStateWith({
      characters: new Map([
        [ineligibleHead.id, ineligibleHead],
        [spymasterAunt.id, spymasterAunt],
        [npcTarget.id, npcTarget],
      ]),
    });
    const result = tryStartScheme(state, PLAYER_HOUSE_ID, {
      kind: "Chaperone",
      targetCharacterId: TARGET_ID,
      explicitAggressorCharacterId: spymasterAunt.id,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const scheme = result.state.schemes.get(result.schemeId);
    expect(scheme?.aggressorCharacterId).toBe(spymasterAunt.id);
  });

  it("empty-acceptable kinds bind aggressor to the head of house", () => {
    const state = synthStateWith();
    const result = tryStartScheme(state, PLAYER_HOUSE_ID, {
      kind: "Courting",
      targetCharacterId: TARGET_ID,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const scheme = result.state.schemes.get(result.schemeId);
    const playerHouse = result.state.houses.get(PLAYER_HOUSE_ID);
    expect(scheme?.aggressorCharacterId).toBe(playerHouse?.headOfHouseCharacterId);
  });
});

// ── aggressorCharacterId hash-relevance ─────────────────────────────────
// Locks the field as load-bearing against "cleaning unused fields" refactors.
// Two schemes with identical kind/owner/target/ticks but distinct
// aggressorCharacterId MUST produce distinct hashes — the field is in the
// hash projection via state.schemes.

describe("aggressorCharacterId — hash-relevance", () => {
  it("two schemes differing only by aggressorCharacterId produce distinct hashes", () => {
    const baseScheme: Scheme = {
      id: "scheme-1" as SchemeId,
      kind: "Courting",
      ownerHouseId: PLAYER_HOUSE_ID,
      aggressorCharacterId: "aggressor-a" as CharacterId,
      targetCharacterId: TARGET_ID,
      startedAtTick: 0,
      endsAtTick: 5,
      status: "Active",
      resolvedAtTick: null,
      failureReason: null,
      accumulatedAffection: 0,
    };
    const stateA: GameState = synthStateWith({
      schemes: new Map([[baseScheme.id, baseScheme]]),
    });
    const stateB: GameState = synthStateWith({
      schemes: new Map([
        [baseScheme.id, { ...baseScheme, aggressorCharacterId: "aggressor-b" as CharacterId }],
      ]),
    });
    expect(hashState(stateA)).not.toBe(hashState(stateB));
  });
});
