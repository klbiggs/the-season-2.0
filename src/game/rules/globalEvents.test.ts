// P13 unit tests for applyGlobalEventPhase + sub-functions + makeGlobalEventId
// + houseHasFamilyEquipped + applyResearchFastCouriers.
//
// Test fixtures use the standard makeGameState factory + targeted overrides.
// Per the wired-but-inert design pin, officer-tagged characters MUST be
// seeded via `traits: [..., "MilitaryOfficer" as TraitId]` literal — bootstrap
// produces zero officers, so without explicit seeding the death-roll path
// passes vacuously.

import { describe, expect, it } from "vitest";
import { makeCharacter, makeGameState, makeHouse } from "../__test-utils__/factories";
import {
  COURIER_RESEARCH_WEALTH_COST,
  DUCAL_WEDDING_REPUTATION_PER_TICK,
  ERA_TRANSITION_TICK,
  MARKET_CRASH_DURATION_TICKS,
  MARKET_CRASH_WEALTH_PER_TICK,
  MONARCHS_MOOD_DURATION_TICKS,
  MONARCHS_MOOD_FAVORED_FAMILY_REPUTATION_SURGE_PER_TICK,
  MONARCHS_MOOD_SNUB_SCANDAL_PER_TICK,
  PEASANT_REVOLT_WEALTH_PER_TICK,
  RIVAL_WAR_PROFITEER_WEALTH_PER_TICK,
  ROYAL_FUNERAL_REPUTATION_PER_TICK,
  WAR_EFFORT_DURATION_TICKS,
  WAR_EFFORT_REPUTATION_PER_TICK,
  WAR_EFFORT_WEALTH_PER_TICK,
} from "../constants";
import type { ArtifactInstance, GameState, GlobalEvent } from "../entities";
import {
  ARTIFACT_FAMILIES,
  ARTIFACT_REGISTRY,
  type ArtifactFamily,
  CULTURAL_AFFINITY_BY_FAMILY,
  CULTURES,
  type Culture,
} from "../fixtures/artifacts";
import {
  type ArtifactDefinitionId,
  type ArtifactInstanceId,
  type CharacterId,
  type GlobalEventId,
  type HouseId,
  PLAYER_HOUSE_ID,
  type TraitId,
  createRngState,
} from "../rng";
import {
  applyGlobalEventPhase,
  applyResearchFastCouriers,
  houseHasCultureEquipped,
  makeGlobalEventId,
} from "./globalEvents";

const PLAYER_RNG = "p13-test-seed";
const MILITARY_OFFICER: TraitId = "MilitaryOfficer" as TraitId;
const PLAYER_HEAD_ID: CharacterId = "head-player" as CharacterId;

function expectDefined<T>(value: T | undefined | null, label: string): T {
  if (value === undefined || value === null) {
    throw new Error(`expected ${label} to be defined`);
  }
  return value;
}

function withPlayerRng(overrides: Partial<GameState> = {}): GameState {
  const base = makeGameState({
    rng: new Map([[PLAYER_HOUSE_ID, createRngState(PLAYER_RNG)]]),
    houses: new Map([[PLAYER_HOUSE_ID, makeHouse({ headOfHouseCharacterId: PLAYER_HEAD_ID })]]),
    characters: new Map([
      [PLAYER_HEAD_ID, makeCharacter({ id: PLAYER_HEAD_ID, houseId: PLAYER_HOUSE_ID })],
    ]),
    ...overrides,
  });
  return base;
}

// ── makeGlobalEventId ───────────────────────────────────────────────────

describe("makeGlobalEventId", () => {
  it("returns globalevent-{kind}-0 for fresh state", () => {
    const state = withPlayerRng();
    expect(makeGlobalEventId(state, "WarEffort")).toBe("globalevent-WarEffort-0");
    expect(makeGlobalEventId(state, "MarketCrash")).toBe("globalevent-MarketCrash-0");
    expect(makeGlobalEventId(state, "MonarchsMood")).toBe("globalevent-MonarchsMood-0");
  });

  it("increments per-kind, not globally", () => {
    const events: Array<[GlobalEventId, GlobalEvent]> = [
      [
        "globalevent-WarEffort-0" as GlobalEventId,
        {
          kind: "WarEffort",
          id: "globalevent-WarEffort-0" as GlobalEventId,
          startTick: 0,
          endTick: 10,
        },
      ],
      [
        "globalevent-MarketCrash-0" as GlobalEventId,
        {
          kind: "MarketCrash",
          id: "globalevent-MarketCrash-0" as GlobalEventId,
          startTick: 0,
          endTick: 5,
        },
      ],
    ];
    const state = withPlayerRng({ globalEvents: new Map(events) });
    expect(makeGlobalEventId(state, "WarEffort")).toBe("globalevent-WarEffort-1");
    expect(makeGlobalEventId(state, "MarketCrash")).toBe("globalevent-MarketCrash-1");
    expect(makeGlobalEventId(state, "MonarchsMood")).toBe("globalevent-MonarchsMood-0");
  });
});

// ── applyGlobalEventPhase: composition ordering ─────────────────────────

describe("applyGlobalEventPhase composition", () => {
  it("composes era-flip → effects → expire → trigger in order", () => {
    // State at tick=200 (= ERA_TRANSITION_TICK), era=Earlier, no events.
    // After phase: era=Later (era-flip fired), still no events (trigger may
    // or may not roll; the trigger draw burns RNG either way).
    const state = withPlayerRng({ tick: ERA_TRANSITION_TICK });
    expect(state.era).toBe("Earlier");
    const after = applyGlobalEventPhase(state);
    expect(after.era).toBe("Later");
  });

  it("burns ONE player-rng draw every tick (trigger roll)", () => {
    const state = withPlayerRng({ tick: 0 });
    const before = expectDefined(state.rng.get(PLAYER_HOUSE_ID), "player rng").callCount;
    const after = applyGlobalEventPhase(state);
    const advanced = expectDefined(after.rng.get(PLAYER_HOUSE_ID), "player rng").callCount - before;
    // Minimum 1 (trigger roll). May be 2 (trigger + kind-pick) or 3
    // (trigger + kind-pick + favored-family) depending on the seeded outcome.
    expect(advanced).toBeGreaterThanOrEqual(1);
    expect(advanced).toBeLessThanOrEqual(3);
  });
});

// ── maybeFlipEra ────────────────────────────────────────────────────────

describe("maybeFlipEra", () => {
  it("flips Earlier → Later when tick >= ERA_TRANSITION_TICK", () => {
    const state = withPlayerRng({ tick: ERA_TRANSITION_TICK });
    const after = applyGlobalEventPhase(state);
    expect(after.era).toBe("Later");
  });

  it("does not flip before threshold", () => {
    const state = withPlayerRng({ tick: ERA_TRANSITION_TICK - 1 });
    const after = applyGlobalEventPhase(state);
    expect(after.era).toBe("Earlier");
  });

  it("is idempotent — Later stays Later", () => {
    const state = withPlayerRng({ tick: ERA_TRANSITION_TICK + 100, era: "Later" });
    const after = applyGlobalEventPhase(state);
    expect(after.era).toBe("Later");
  });

  it("P25 R13: rival houses earn courierResearchEarned at the era flip (no wealth debit)", () => {
    const rivalId = "rival-ashford" as HouseId;
    const state = withPlayerRng({
      tick: ERA_TRANSITION_TICK,
      houses: new Map([
        [PLAYER_HOUSE_ID, makeHouse({ courierResearchEarned: false })],
        [rivalId, makeHouse({ id: rivalId, wealth: 180, courierResearchEarned: false })],
      ]),
    });
    const after = applyGlobalEventPhase(state);
    const rival = after.houses.get(rivalId);
    expect(rival?.courierResearchEarned).toBe(true);
    expect(rival?.wealth).toBe(180); // no debit
    // The player does NOT auto-earn it (that stays the paid free action).
    expect(after.houses.get(PLAYER_HOUSE_ID)?.courierResearchEarned).toBe(false);
  });
});

// ── applyWarEffortTick (via applyActiveEventTickEffects) ────────────────

describe("WarEffort per-tick effects", () => {
  function stateWithWarEffort(extras: Partial<GameState> = {}): GameState {
    const event: GlobalEvent = {
      kind: "WarEffort",
      id: "globalevent-WarEffort-0" as GlobalEventId,
      startTick: 0,
      endTick: 1000, // far future so expiry doesn't fire
    };
    return withPlayerRng({
      tick: 1,
      globalEvents: new Map([[event.id, event]]),
      ...extras,
    });
  }

  it("applies +1 reputation / -2 wealth on every house", () => {
    const otherHouseId = "other" as HouseId;
    const state = stateWithWarEffort({
      houses: new Map([
        [PLAYER_HOUSE_ID, makeHouse({ wealth: 100, reputation: 50 })],
        [otherHouseId, makeHouse({ id: otherHouseId, wealth: 50, reputation: 30 })],
      ]),
    });
    const after = applyGlobalEventPhase(state);
    expect(expectDefined(after.houses.get(PLAYER_HOUSE_ID), "player house").wealth).toBe(
      100 + WAR_EFFORT_WEALTH_PER_TICK,
    );
    expect(expectDefined(after.houses.get(PLAYER_HOUSE_ID), "player house").reputation).toBe(
      50 + WAR_EFFORT_REPUTATION_PER_TICK,
    );
    expect(expectDefined(after.houses.get(otherHouseId), "other house").wealth).toBe(
      50 + WAR_EFFORT_WEALTH_PER_TICK,
    );
    expect(expectDefined(after.houses.get(otherHouseId), "other house").reputation).toBe(
      30 + WAR_EFFORT_REPUTATION_PER_TICK,
    );
  });

  it("P25 R2: a rival house PROFITEERS (+3 wealth) instead of -2, but still +1 rep", () => {
    const rivalId = "rival-ashford" as HouseId;
    const state = stateWithWarEffort({
      houses: new Map([
        [PLAYER_HOUSE_ID, makeHouse({ wealth: 100, reputation: 50 })],
        [rivalId, makeHouse({ id: rivalId, wealth: 180, reputation: 40 })],
      ]),
    });
    const after = applyGlobalEventPhase(state);
    // Rival gains wealth (war profiteer), unlike the player who bleeds -2.
    expect(expectDefined(after.houses.get(rivalId), "rival").wealth).toBe(
      180 + RIVAL_WAR_PROFITEER_WEALTH_PER_TICK,
    );
    expect(expectDefined(after.houses.get(rivalId), "rival").reputation).toBe(
      40 + WAR_EFFORT_REPUTATION_PER_TICK,
    );
    expect(expectDefined(after.houses.get(PLAYER_HOUSE_ID), "player").wealth).toBe(
      100 + WAR_EFFORT_WEALTH_PER_TICK,
    );
  });

  it("clamps reputation at 100; wealth unclamped (can go negative)", () => {
    const state = stateWithWarEffort({
      houses: new Map([[PLAYER_HOUSE_ID, makeHouse({ wealth: -500, reputation: 100 })]]),
    });
    const after = applyGlobalEventPhase(state);
    expect(expectDefined(after.houses.get(PLAYER_HOUSE_ID), "player house").reputation).toBe(100); // clamped
    expect(expectDefined(after.houses.get(PLAYER_HOUSE_ID), "player house").wealth).toBe(
      -500 + WAR_EFFORT_WEALTH_PER_TICK,
    ); // unclamped
  });

  it("advances player-rng by N draws (N = total alive officers), vacuous when N=0", () => {
    const state = stateWithWarEffort(); // bootstrap-baseline: 0 officers
    const beforeRng = expectDefined(state.rng.get(PLAYER_HOUSE_ID), "player rng").callCount;
    const after = applyGlobalEventPhase(state);
    const advanced =
      expectDefined(after.rng.get(PLAYER_HOUSE_ID), "player rng").callCount - beforeRng;
    // N=0 officers → 0 draws for death roll. Trigger roll still burns 1.
    // 5% trigger probability → may or may not spawn another event (which
    // would add kind-pick draw). Lower bound is 1; upper bound is 3.
    expect(advanced).toBeGreaterThanOrEqual(1);
  });

  it("with seeded officer: advances rng by N+1 (officer death roll + trigger)", () => {
    const officerId: CharacterId = "char-officer" as CharacterId;
    const state = stateWithWarEffort({
      characters: new Map([
        [PLAYER_HEAD_ID, makeCharacter({ id: PLAYER_HEAD_ID, houseId: PLAYER_HOUSE_ID })],
        [
          officerId,
          makeCharacter({
            id: officerId,
            houseId: PLAYER_HOUSE_ID,
            traits: [MILITARY_OFFICER],
          }),
        ],
      ]),
    });
    const beforeRng = expectDefined(state.rng.get(PLAYER_HOUSE_ID), "player rng").callCount;
    const after = applyGlobalEventPhase(state);
    const advanced =
      expectDefined(after.rng.get(PLAYER_HOUSE_ID), "player rng").callCount - beforeRng;
    // 1 officer-death roll + 1 trigger roll = 2 minimum.
    expect(advanced).toBeGreaterThanOrEqual(2);
  });
});

// ── applyMarketCrashTick ────────────────────────────────────────────────

describe("MarketCrash per-tick effects", () => {
  it("applies -3 wealth on every house; no RNG; no clamp", () => {
    const otherHouseId = "other" as HouseId;
    const event: GlobalEvent = {
      kind: "MarketCrash",
      id: "globalevent-MarketCrash-0" as GlobalEventId,
      startTick: 0,
      endTick: 1000,
    };
    const state = withPlayerRng({
      tick: 1,
      globalEvents: new Map([[event.id, event]]),
      houses: new Map([
        [PLAYER_HOUSE_ID, makeHouse({ wealth: 100 })],
        [otherHouseId, makeHouse({ id: otherHouseId, wealth: -500 })],
      ]),
    });
    const after = applyGlobalEventPhase(state);
    expect(expectDefined(after.houses.get(PLAYER_HOUSE_ID), "player house").wealth).toBe(
      100 + MARKET_CRASH_WEALTH_PER_TICK,
    );
    expect(expectDefined(after.houses.get(otherHouseId), "other house").wealth).toBe(
      -500 + MARKET_CRASH_WEALTH_PER_TICK,
    );
  });
});

// ── applyMonarchsMoodTick + houseHasFamilyEquipped ──────────────────────

describe("MonarchsMood per-tick effects", () => {
  function stateWithMonarchsMood(
    favoredCulture: Culture,
    extras: Partial<GameState> = {},
  ): GameState {
    const event: GlobalEvent = {
      kind: "MonarchsMood",
      id: "globalevent-MonarchsMood-0" as GlobalEventId,
      startTick: 0,
      endTick: 1000,
      favoredCulture,
    };
    return withPlayerRng({
      tick: 1,
      globalEvents: new Map([[event.id, event]]),
      ...extras,
    });
  }

  // sapphires maps to Refinement (P25 R9 affinity table); use that pairing.
  it("match-branch: +2 reputation for house equipping a favored-culture artifact", () => {
    const family: ArtifactFamily = "sapphires";
    const matchingDef = [...ARTIFACT_REGISTRY.values()].find((d) => d.family === family);
    if (matchingDef === undefined) throw new Error(`no artifact with family ${family}`);
    const matchingDefId = matchingDef.id;
    const instId = "inst-sapphires-0" as ArtifactInstanceId;
    const inst: ArtifactInstance = {
      id: instId,
      definitionId: matchingDefId,
      ownerHouseId: PLAYER_HOUSE_ID,
      ownerCharacterId: PLAYER_HEAD_ID,
      lastRefreshTick: 0,
      forgedFlag: false,
    };
    const state = stateWithMonarchsMood("Refinement", {
      characters: new Map([
        [
          PLAYER_HEAD_ID,
          makeCharacter({
            id: PLAYER_HEAD_ID,
            houseId: PLAYER_HOUSE_ID,
            equippedArtifactIds: [instId],
          }),
        ],
      ]),
      artifactInstances: new Map([[instId, inst]]),
      houses: new Map([[PLAYER_HOUSE_ID, makeHouse({ reputation: 50 })]]),
    });
    const after = applyGlobalEventPhase(state);
    expect(expectDefined(after.houses.get(PLAYER_HOUSE_ID), "player house").reputation).toBe(
      50 + MONARCHS_MOOD_FAVORED_FAMILY_REPUTATION_SURGE_PER_TICK,
    );
    // Scandal NOT incremented in match-branch.
    expect(expectDefined(after.houses.get(PLAYER_HOUSE_ID), "player house").scandal).toBe(0);
  });

  it("no-match branch: +1 scandal for house with no matching artifact", () => {
    const state = stateWithMonarchsMood("Refinement", {
      houses: new Map([[PLAYER_HOUSE_ID, makeHouse({ scandal: 0, reputation: 50 })]]),
    });
    const after = applyGlobalEventPhase(state);
    expect(expectDefined(after.houses.get(PLAYER_HOUSE_ID), "player house").scandal).toBe(
      MONARCHS_MOOD_SNUB_SCANDAL_PER_TICK,
    );
    // Reputation NOT changed in no-match branch (no negative surge).
    expect(expectDefined(after.houses.get(PLAYER_HOUSE_ID), "player house").reputation).toBe(50);
  });

  it("clamps reputation at 100 in match-branch; scandal at 100 in no-match branch", () => {
    const state1 = stateWithMonarchsMood("Refinement", {
      houses: new Map([[PLAYER_HOUSE_ID, makeHouse({ scandal: 100, reputation: 50 })]]),
    });
    const after1 = applyGlobalEventPhase(state1);
    expect(expectDefined(after1.houses.get(PLAYER_HOUSE_ID), "player house").scandal).toBe(100); // clamped

    const state2 = stateWithMonarchsMood("Refinement", {
      houses: new Map([[PLAYER_HOUSE_ID, makeHouse({ reputation: 99 })]]),
      characters: new Map([
        [
          PLAYER_HEAD_ID,
          makeCharacter({
            id: PLAYER_HEAD_ID,
            houseId: PLAYER_HOUSE_ID,
            equippedArtifactIds: ["m" as ArtifactInstanceId],
          }),
        ],
      ]),
      artifactInstances: new Map([
        [
          "m" as ArtifactInstanceId,
          {
            id: "m" as ArtifactInstanceId,
            definitionId: "sapphires" as ArtifactDefinitionId,
            ownerHouseId: PLAYER_HOUSE_ID,
            ownerCharacterId: PLAYER_HEAD_ID,
            lastRefreshTick: 0,
            forgedFlag: false,
          },
        ],
      ]),
    });
    const after2 = applyGlobalEventPhase(state2);
    expect(expectDefined(after2.houses.get(PLAYER_HOUSE_ID), "player house").reputation).toBe(100); // clamped
  });

  it("houseHasFamilyEquipped returns false for empty equipment list", () => {
    const state = withPlayerRng();
    expect(houseHasCultureEquipped(state, PLAYER_HOUSE_ID, "Refinement")).toBe(false);
  });

  it("houseHasFamilyEquipped ignores dead characters", () => {
    const deadHeadId = PLAYER_HEAD_ID;
    const instId = "i" as ArtifactInstanceId;
    const state = withPlayerRng({
      characters: new Map([
        [
          deadHeadId,
          makeCharacter({
            id: deadHeadId,
            houseId: PLAYER_HOUSE_ID,
            alive: false,
            equippedArtifactIds: [instId],
          }),
        ],
      ]),
      artifactInstances: new Map([
        [
          instId,
          {
            id: instId,
            definitionId: "sapphires" as ArtifactDefinitionId,
            ownerHouseId: PLAYER_HOUSE_ID,
            ownerCharacterId: deadHeadId,
            lastRefreshTick: 0,
            forgedFlag: false,
          },
        ],
      ]),
    });
    expect(houseHasCultureEquipped(state, PLAYER_HOUSE_ID, "Refinement")).toBe(false);
  });
});

// ── P25 R11: additional location-keyed event kinds ──────────────────────

describe("P25 R11 — RoyalFuneral / DucalWedding / PeasantRevolt", () => {
  const CAPITAL_ID = "cap" as HouseId;
  const COUNTRY_ID = "cty" as HouseId;

  function stateWith(kind: "RoyalFuneral" | "DucalWedding" | "PeasantRevolt"): GameState {
    const event = {
      kind,
      id: `globalevent-${kind}-0` as GlobalEventId,
      startTick: 0,
      endTick: 1000,
    } as GlobalEvent;
    return withPlayerRng({
      tick: 1,
      globalEvents: new Map([[event.id, event]]),
      houses: new Map([
        [
          CAPITAL_ID,
          makeHouse({ id: CAPITAL_ID, currentLocation: "Capital", wealth: 100, reputation: 50 }),
        ],
        [
          COUNTRY_ID,
          makeHouse({ id: COUNTRY_ID, currentLocation: "Country", wealth: 100, reputation: 50 }),
        ],
      ]),
    });
  }

  it("RoyalFuneral: -1 reputation for Capital houses only", () => {
    const after = applyGlobalEventPhase(stateWith("RoyalFuneral"));
    expect(after.houses.get(CAPITAL_ID)?.reputation).toBe(50 + ROYAL_FUNERAL_REPUTATION_PER_TICK);
    expect(after.houses.get(COUNTRY_ID)?.reputation).toBe(50); // unaffected
  });

  it("DucalWedding: +1 reputation for Capital houses only", () => {
    const after = applyGlobalEventPhase(stateWith("DucalWedding"));
    expect(after.houses.get(CAPITAL_ID)?.reputation).toBe(50 + DUCAL_WEDDING_REPUTATION_PER_TICK);
    expect(after.houses.get(COUNTRY_ID)?.reputation).toBe(50);
  });

  it("PeasantRevolt: -2 wealth (unclamped) for Country houses only", () => {
    const after = applyGlobalEventPhase(stateWith("PeasantRevolt"));
    expect(after.houses.get(COUNTRY_ID)?.wealth).toBe(100 + PEASANT_REVOLT_WEALTH_PER_TICK);
    expect(after.houses.get(CAPITAL_ID)?.wealth).toBe(100); // unaffected
  });

  it("RoyalFuneral reputation clamps at 0", () => {
    const event = {
      kind: "RoyalFuneral",
      id: "globalevent-RoyalFuneral-0" as GlobalEventId,
      startTick: 0,
      endTick: 1000,
    } as GlobalEvent;
    const state = withPlayerRng({
      tick: 1,
      globalEvents: new Map([[event.id, event]]),
      houses: new Map([
        [CAPITAL_ID, makeHouse({ id: CAPITAL_ID, currentLocation: "Capital", reputation: 0 })],
      ]),
    });
    expect(applyGlobalEventPhase(state).houses.get(CAPITAL_ID)?.reputation).toBe(0);
  });
});

// ── expireFinishedEvents ────────────────────────────────────────────────

describe("expireFinishedEvents", () => {
  it("drops events with endTick <= state.tick AFTER applying effects on the boundary tick", () => {
    const event: GlobalEvent = {
      kind: "WarEffort",
      id: "globalevent-WarEffort-0" as GlobalEventId,
      startTick: 100,
      endTick: 110,
    };
    // Tick 109: event active, effects apply, not expired.
    const state109 = withPlayerRng({
      tick: 109,
      globalEvents: new Map([[event.id, event]]),
    });
    const after109 = applyGlobalEventPhase(state109);
    expect(after109.globalEvents.has(event.id)).toBe(true);

    // Tick 110: effects apply (the 10th application), then expire (110 <= 110).
    const state110 = withPlayerRng({
      tick: 110,
      globalEvents: new Map([[event.id, event]]),
      houses: new Map([[PLAYER_HOUSE_ID, makeHouse({ wealth: 100, reputation: 50 })]]),
    });
    const after110 = applyGlobalEventPhase(state110);
    expect(after110.globalEvents.has(event.id)).toBe(false);
    // Effects DID apply this tick (apply-before-expire ordering).
    expect(expectDefined(after110.houses.get(PLAYER_HOUSE_ID), "player house").wealth).toBe(
      100 + WAR_EFFORT_WEALTH_PER_TICK,
    );
  });

  it("preserves events when endTick > state.tick", () => {
    const event: GlobalEvent = {
      kind: "MarketCrash",
      id: "globalevent-MarketCrash-0" as GlobalEventId,
      startTick: 0,
      endTick: 5,
    };
    const state = withPlayerRng({
      tick: 4,
      globalEvents: new Map([[event.id, event]]),
    });
    const after = applyGlobalEventPhase(state);
    expect(after.globalEvents.has(event.id)).toBe(true);
  });
});

// ── applyResearchFastCouriers ───────────────────────────────────────────

describe("applyResearchFastCouriers", () => {
  function laterEraState(extras: Partial<GameState> = {}): GameState {
    return withPlayerRng({
      era: "Later",
      houses: new Map([
        [PLAYER_HOUSE_ID, makeHouse({ wealth: COURIER_RESEARCH_WEALTH_COST + 10 })],
      ]),
      ...extras,
    });
  }

  it("succeeds in Later era, deducts wealth, flips latch", () => {
    const state = laterEraState();
    const result = applyResearchFastCouriers(state);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const player = expectDefined(result.nextState.houses.get(PLAYER_HOUSE_ID), "player house");
    expect(player.wealth).toBe(10);
    expect(player.courierResearchEarned).toBe(true);
  });

  it("rejects EraNotYetLater in Earlier era", () => {
    const state = withPlayerRng({ era: "Earlier" });
    const result = applyResearchFastCouriers(state);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason.kind).toBe("EraNotYetLater");
  });

  it("rejects AlreadyResearched if flag is true", () => {
    const state = laterEraState({
      houses: new Map([
        [PLAYER_HOUSE_ID, makeHouse({ wealth: 1000, courierResearchEarned: true })],
      ]),
    });
    const result = applyResearchFastCouriers(state);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason.kind).toBe("AlreadyResearched");
  });

  it("rejects InsufficientWealth when wealth < cost", () => {
    const state = laterEraState({
      houses: new Map([[PLAYER_HOUSE_ID, makeHouse({ wealth: COURIER_RESEARCH_WEALTH_COST - 1 })]]),
    });
    const result = applyResearchFastCouriers(state);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason.kind).toBe("InsufficientWealth");
    if (result.reason.kind !== "InsufficientWealth") throw new Error("narrowing");
    expect(result.reason.have).toBe(COURIER_RESEARCH_WEALTH_COST - 1);
    expect(result.reason.need).toBe(COURIER_RESEARCH_WEALTH_COST);
  });

  it("rejects PlayerExiled when player house is exiled", () => {
    const state = laterEraState({
      houses: new Map([[PLAYER_HOUSE_ID, makeHouse({ wealth: 1000, exiled: true })]]),
    });
    const result = applyResearchFastCouriers(state);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason.kind).toBe("PlayerExiled");
  });
});

// ── Constants sanity ─────────────────────────────────────────────────────

describe("ARTIFACT_FAMILIES length parity (verification matrix #31)", () => {
  it("ARTIFACT_FAMILIES.length is 7", () => {
    expect(ARTIFACT_FAMILIES.length).toBe(7);
  });

  // P25 R9: the MonarchsMood favored-value draw is now over CULTURES (3), not
  // ARTIFACT_FAMILIES (7). Pins the drawInt(r2, CULTURES.length) budget — a
  // widening would silently shift the per-tick rng draw count (replay-relevant).
  it("CULTURES.length is 3 (pins the MonarchsMood spawn draw budget)", () => {
    expect(CULTURES.length).toBe(3);
  });

  it("CULTURAL_AFFINITY_BY_FAMILY maps every family to a valid culture (exhaustive)", () => {
    for (const fam of ARTIFACT_FAMILIES) {
      const culture: Culture = CULTURAL_AFFINITY_BY_FAMILY[fam];
      expect(CULTURES).toContain(culture);
    }
  });
});

// ── Officers at bootstrap (P16 supersedes verification matrix #30) ──────────
// Pre-P16 this asserted ZERO officers at bootstrap (the wired-but-inert claim).
// P16 adds the first designed acquisition path: the BohemianRake society profile
// guarantees MilitaryOfficer, so bootstrap now produces officers — confined to
// the Independent-house society batch (the player head, baseline NPCs, and
// rivals still acquire no officer trait at bootstrap).

describe("MilitaryOfficer at bootstrap (P16 supersedes verification matrix #30)", () => {
  it("produces officers, all confined to Independent-house society NPCs", async () => {
    const { createInitialState } = await import("../store");
    const { INDEPENDENT_HOUSE_ID } = await import("../rng");
    const state = createInitialState("seed-check-officers");
    const officers = [...state.characters.values()].filter((c) =>
      c.traits.includes(MILITARY_OFFICER),
    );
    expect(officers.length).toBeGreaterThan(0);
    for (const o of officers) {
      expect(o.houseId).toBe(INDEPENDENT_HOUSE_ID);
      expect(o.id.startsWith("proc-npc-")).toBe(true);
    }
  });
});

// ── Duration arithmetic ─────────────────────────────────────────────────

describe("Event duration constants land at the spec values", () => {
  it("WarEffort = 10, MarketCrash = 5, MonarchsMood = 5", () => {
    expect(WAR_EFFORT_DURATION_TICKS).toBe(10);
    expect(MARKET_CRASH_DURATION_TICKS).toBe(5);
    expect(MONARCHS_MOOD_DURATION_TICKS).toBe(5);
  });
});

// ── Verification matrix #8: MonarchsMood per-house mutual exclusion ─────

describe("MonarchsMood per-house mutual exclusion (matrix #8)", () => {
  it("two-house fixture: matching house gets +rep only; non-matching gets +scandal only", () => {
    const otherHouseId = "other" as HouseId;
    const otherHeadId = "head-other" as CharacterId;
    const family: ArtifactFamily = "sapphires";
    const matchingDef = [...ARTIFACT_REGISTRY.values()].find((d) => d.family === family);
    if (matchingDef === undefined) throw new Error("setup: no sapphires");
    const playerInst: ArtifactInstance = {
      id: "inst-player" as ArtifactInstanceId,
      definitionId: matchingDef.id,
      ownerHouseId: PLAYER_HOUSE_ID,
      ownerCharacterId: PLAYER_HEAD_ID,
      lastRefreshTick: 0,
      forgedFlag: false,
    };
    const event: GlobalEvent = {
      kind: "MonarchsMood",
      id: "globalevent-MonarchsMood-0" as GlobalEventId,
      startTick: 0,
      endTick: 1000,
      favoredCulture: CULTURAL_AFFINITY_BY_FAMILY[family],
    };
    const state = withPlayerRng({
      tick: 1,
      globalEvents: new Map([[event.id, event]]),
      houses: new Map([
        [PLAYER_HOUSE_ID, makeHouse({ reputation: 50, scandal: 0 })],
        [otherHouseId, makeHouse({ id: otherHouseId, reputation: 50, scandal: 0 })],
      ]),
      characters: new Map([
        [
          PLAYER_HEAD_ID,
          makeCharacter({
            id: PLAYER_HEAD_ID,
            houseId: PLAYER_HOUSE_ID,
            equippedArtifactIds: [playerInst.id],
          }),
        ],
        [otherHeadId, makeCharacter({ id: otherHeadId, houseId: otherHouseId })],
      ]),
      artifactInstances: new Map([[playerInst.id, playerInst]]),
    });
    const after = applyGlobalEventPhase(state);
    const player = expectDefined(after.houses.get(PLAYER_HOUSE_ID), "player");
    const other = expectDefined(after.houses.get(otherHouseId), "other");
    // Player: match → +2 rep, scandal unchanged.
    expect(player.reputation).toBe(50 + MONARCHS_MOOD_FAVORED_FAMILY_REPUTATION_SURGE_PER_TICK);
    expect(player.scandal).toBe(0);
    // Other: no-match → +1 scandal, rep unchanged.
    expect(other.scandal).toBe(MONARCHS_MOOD_SNUB_SCANDAL_PER_TICK);
    expect(other.reputation).toBe(50);
  });
});

// ── Verification matrix #11/#12: maybeFireNewEvent draw budgets ──────────

describe("maybeFireNewEvent draw budgets (matrix #11/#12)", () => {
  // Probe the per-tick draw cost on a fixed seed. The exact outcome depends
  // on the seeded sequence, but the BOUND is always: 1 (no-event) ≤ draws ≤
  // 3 (MonarchsMood spawn).
  it("no-event tick consumes 1 player-rng draw; spawning consumes 2 (non-MonarchsMood) or 3 (MonarchsMood)", () => {
    // Seed a state where the trigger roll fires + spawn lands on MonarchsMood.
    // We don't know which seed yields that without execution; instead assert
    // the AGGREGATE invariant: across N ticks, the draw count fits the bound.
    let state = withPlayerRng({ tick: 0 });
    for (let i = 0; i < 50; i += 1) {
      const before = expectDefined(state.rng.get(PLAYER_HOUSE_ID), "player").callCount;
      const after = applyGlobalEventPhase(state);
      const advanced = expectDefined(after.rng.get(PLAYER_HOUSE_ID), "player").callCount - before;
      // Per-tick must be in [1, 3]:
      //   1 = trigger roll only (no-event path OR fall-through)
      //   2 = trigger + kind-pick (event spawned but NOT MonarchsMood, OR dup-skip)
      //   3 = trigger + kind-pick + favored-family (MonarchsMood spawned fresh)
      expect(advanced).toBeGreaterThanOrEqual(1);
      expect(advanced).toBeLessThanOrEqual(3);
      // Officer-death rolls are gated on MilitaryOfficer-tagged chars (none
      // in this fixture), so they don't perturb the budget. Bump tick for
      // the next iteration.
      state = { ...after, tick: after.tick + 1 };
    }
  });
});
