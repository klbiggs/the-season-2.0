import { describe, expect, it } from "vitest";
import { makeHouse, makeHousesMap } from "../__test-utils__/factories";
import type { Character, GameState, MarriageRecord } from "../entities";
import type { CharacterId, HouseId, MarriageId, RngState } from "../rng";
import { applyEconomyPhase, classifyTier } from "./economy";

function makeState(overrides: Partial<GameState>): GameState {
  return {
    tick: 0,
    rng: new Map<HouseId, RngState>(),
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

describe("classifyTier", () => {
  it("Solvent at wealth ≥ 0", () => {
    expect(classifyTier(0)).toBe("Solvent");
    expect(classifyTier(100)).toBe("Solvent");
  });
  it("Hemorrhaging at -100 < w < 0", () => {
    expect(classifyTier(-1)).toBe("Hemorrhaging");
    expect(classifyTier(-99)).toBe("Hemorrhaging");
  });
  it("Embarrassed at -500 < w ≤ -100 (boundary -100 included)", () => {
    expect(classifyTier(-100)).toBe("Embarrassed");
    expect(classifyTier(-499)).toBe("Embarrassed");
  });
  it("Ruined at w ≤ -500", () => {
    expect(classifyTier(-500)).toBe("Ruined");
    expect(classifyTier(-1000)).toBe("Ruined");
  });
});

describe("applyEconomyPhase — classify-once boundary at wealth=-100", () => {
  it("wealth=-98 (Hemorrhaging) stays Hemorrhaging this tick even after -2 lands at -100", () => {
    const h = makeHouse({ wealth: -98 });
    const state = makeState({ houses: makeHousesMap([h]) });
    const next = applyEconomyPhase(state);
    // Hemorrhaging tier: -2 wealth, -1 reputation, 0 scandal. Wealth = -100,
    // BUT this phase already classified as Hemorrhaging — not reclassified to
    // Embarrassed mid-phase.
    const updated = next.houses.get(h.id);
    expect(updated?.wealth).toBe(-100);
    // The "-3 wealth" of Embarrassed would have produced -101 instead.
  });
  it("clamps reputation/scandal to [0, 100]", () => {
    const h = makeHouse({ wealth: -1000, reputation: 0, scandal: 99 });
    const state = makeState({ houses: makeHousesMap([h]) });
    const next = applyEconomyPhase(state);
    const updated = next.houses.get(h.id);
    // Ruined: -5 w, -2 r, +2 s. Reputation already 0 → stays 0. Scandal 99+2=101 → clamps to 100.
    expect(updated?.reputation).toBe(0);
    expect(updated?.scandal).toBe(100);
  });
});

describe("applyEconomyPhase — solvent house unchanged", () => {
  it("Solvent applies zero deltas", () => {
    const h = makeHouse({ wealth: 100, reputation: 50, scandal: 0 });
    const state = makeState({ houses: makeHousesMap([h]) });
    const next = applyEconomyPhase(state);
    const updated = next.houses.get(h.id);
    expect(updated?.wealth).toBe(100);
    expect(updated?.reputation).toBe(50);
    expect(updated?.scandal).toBe(0);
  });
});

// P25 R2 — rivals now participate in the economy (skip removed) + earn a flat
// baseline income. Pinned == Hemorrhaging decay magnitude so a crashed rival
// nets >= 0 outside events (no irreversible spiral).
const RIVAL_ASHFORD = "rival-ashford" as HouseId;

describe("applyEconomyPhase — P25 R2 rival baseline income", () => {
  it("a Solvent rival gains +2 baseline income", () => {
    const h = makeHouse({ id: RIVAL_ASHFORD, wealth: 200 });
    const state = makeState({ houses: makeHousesMap([h]) });
    const updated = applyEconomyPhase(state).houses.get(RIVAL_ASHFORD);
    expect(updated?.wealth).toBe(202); // 200 + Solvent(0) + baseline(2)
  });

  it("a Hemorrhaging rival nets 0 (baseline +2 cancels the -2 decay — floor holds)", () => {
    const h = makeHouse({ id: RIVAL_ASHFORD, wealth: -50 });
    const state = makeState({ houses: makeHousesMap([h]) });
    const updated = applyEconomyPhase(state).houses.get(RIVAL_ASHFORD);
    expect(updated?.wealth).toBe(-50); // -50 + Hemorrhaging(-2) + baseline(2)
  });

  it("a non-rival (player) house gets NO baseline income", () => {
    const h = makeHouse({ wealth: 100 }); // PLAYER_HOUSE_ID default
    const state = makeState({ houses: makeHousesMap([h]) });
    const updated = applyEconomyPhase(state).houses.get(h.id);
    expect(updated?.wealth).toBe(100); // Solvent(0), no baseline
  });
});
