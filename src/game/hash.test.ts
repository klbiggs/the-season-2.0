import { describe, expect, it } from "vitest";
import { canonicalJSON, hashState, hashableState } from "./hash";
import type { CharacterId, HouseId, MarriageId, RngState } from "./rng";
import {
  type Character,
  DEFAULT_CAMPAIGN_NAME,
  type House,
  type MarriageRecord,
  createInitialState,
} from "./store";

describe("canonicalJSON — key order invariance", () => {
  it("sorts object keys lexicographically", () => {
    expect(canonicalJSON({ z: 1, a: 2, m: 3 })).toBe('{"a":2,"m":3,"z":1}');
  });
  it("emits arrays in insertion order", () => {
    expect(canonicalJSON([3, 1, 2])).toBe("[3,1,2]");
  });
  it("produces identical output for differently-ordered objects", () => {
    const a = canonicalJSON({ x: 1, y: 2 });
    const b = canonicalJSON({ y: 2, x: 1 });
    expect(a).toBe(b);
  });
});

describe("canonicalJSON — number contract", () => {
  it("normalizes -0 to 0", () => {
    expect(canonicalJSON(-0)).toBe("0");
    expect(canonicalJSON(0)).toBe("0");
  });
  it("throws on NaN", () => {
    expect(() => canonicalJSON(Number.NaN)).toThrow();
  });
  it("throws on Infinity / -Infinity", () => {
    expect(() => canonicalJSON(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => canonicalJSON(Number.NEGATIVE_INFINITY)).toThrow();
  });
  it("throws on BigInt", () => {
    expect(() => canonicalJSON(BigInt(1))).toThrow();
  });
});

describe("canonicalJSON — type contract", () => {
  it("throws on Map (mis-projection guard)", () => {
    expect(() => canonicalJSON(new Map([["k", "v"]]))).toThrow();
  });
  it("throws on Set (mis-projection guard)", () => {
    expect(() => canonicalJSON(new Set([1, 2]))).toThrow();
  });
  it("omits undefined object values", () => {
    expect(canonicalJSON({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});

describe("hashableState", () => {
  it("includes only replay-relevant keys", () => {
    const state = createInitialState("seed");
    const projected = hashableState(state);
    // P1: full keyset is characters/houses/marriages/rng/tick. Object.keys().sort()
    // protects against insertion-order drift in hashableState's projection literal.
    expect(Object.keys(projected).sort()).toEqual([
      "affectionMap",
      "artifactInstances",
      "betrothals",
      "callingCards",
      "campaignName",
      "characters",
      "conversationHistory",
      "couriers",
      "duels",
      "elopements",
      "era",
      "factionTensions",
      "flavorText",
      "forgeries",
      "globalEvents",
      "houses",
      "marriages",
      "patronesses",
      "pendingTutorTraitChoices",
      "proceduralArtifactDefinitions",
      "proposalsLog",
      "rivalActors",
      "rng",
      "schemes",
      "staff",
      "thiefAttempts",
      "tick",
      "tutorAssignmentsLog",
      "whispers",
    ]);
  });
  it("converts Map to sorted Array<[K, V]>", () => {
    const state = createInitialState("seed");
    const projected = hashableState(state);
    expect(Array.isArray(projected.rng)).toBe(true);
    expect(Array.isArray(projected.houses)).toBe(true);
    expect(Array.isArray(projected.characters)).toBe(true);
    expect(Array.isArray(projected.marriages)).toBe(true);
  });
});

describe("hashState — Map reorder invariance", () => {
  it("produces identical hash for differently-ordered Maps", () => {
    const rngState: RngState = { seed: "x", callCount: 0 };
    const map1 = new Map<HouseId, RngState>();
    map1.set("zebra" as HouseId, rngState);
    map1.set("alpha" as HouseId, rngState);
    const map2 = new Map<HouseId, RngState>();
    map2.set("alpha" as HouseId, rngState);
    map2.set("zebra" as HouseId, rngState);
    const emptyHouses = new Map<HouseId, House>();
    const emptyCharacters = new Map<CharacterId, Character>();
    const emptyMarriages = new Map<MarriageId, MarriageRecord>();
    expect(
      hashState({
        tick: 0,
        rng: map1,
        houses: emptyHouses,
        characters: emptyCharacters,
        marriages: emptyMarriages,
        campaignName: DEFAULT_CAMPAIGN_NAME,
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
      }),
    ).toBe(
      hashState({
        tick: 0,
        rng: map2,
        houses: emptyHouses,
        characters: emptyCharacters,
        marriages: emptyMarriages,
        campaignName: DEFAULT_CAMPAIGN_NAME,
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
      }),
    );
  });
  it("differs for different tick values", () => {
    const s1 = createInitialState("seed");
    const s2 = { ...s1, tick: 1 };
    expect(hashState(s1)).not.toBe(hashState(s2));
  });
});
