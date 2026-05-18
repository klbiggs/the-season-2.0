import { describe, expect, it } from "vitest";
import {
  EmptyArrayError,
  type HouseId,
  RngNotRegisteredError,
  type RngState,
  createRngState,
  deserializeRegistry,
  drawInt,
  drawNext,
  getOrThrow,
  pickItem,
  serializeRegistry,
} from "./rng";

const PLAYER = "player" as HouseId;
const RIVAL = "rival" as HouseId;

describe("createRngState", () => {
  it("starts with callCount 0", () => {
    expect(createRngState("seed")).toEqual({ seed: "seed", callCount: 0 });
  });
});

describe("drawNext", () => {
  it("returns a number in [0, 1) and bumps callCount", () => {
    const state = createRngState("seed");
    const { next, rngState } = drawNext(state);
    expect(next).toBeGreaterThanOrEqual(0);
    expect(next).toBeLessThan(1);
    expect(rngState.callCount).toBe(1);
    expect(rngState.seed).toBe("seed");
  });
  it("is pure — does not mutate input", () => {
    const state = createRngState("seed");
    drawNext(state);
    expect(state).toEqual({ seed: "seed", callCount: 0 });
  });
  it("returns the same draw for the same {seed, callCount}", () => {
    const a = drawNext({ seed: "x", callCount: 5 });
    const b = drawNext({ seed: "x", callCount: 5 });
    expect(a.next).toBe(b.next);
    expect(a.rngState).toEqual(b.rngState);
  });
});

describe("drawInt", () => {
  it("returns an integer in [0, maxExclusive)", () => {
    let state = createRngState("seed");
    for (let i = 0; i < 100; i += 1) {
      const result = drawInt(state, 10);
      expect(result.next).toBeGreaterThanOrEqual(0);
      expect(result.next).toBeLessThan(10);
      expect(Number.isInteger(result.next)).toBe(true);
      state = result.rngState;
    }
  });
});

describe("pickItem", () => {
  it("picks an element of the array", () => {
    const state = createRngState("seed");
    const arr = ["a", "b", "c"] as const;
    const { item } = pickItem(state, arr);
    expect(arr).toContain(item);
  });
  it("throws EmptyArrayError on empty input", () => {
    expect(() => pickItem(createRngState("seed"), [])).toThrow(EmptyArrayError);
  });
});

describe("serializeRegistry", () => {
  it("emits lex-sorted array by HouseId", () => {
    const map = new Map<HouseId, RngState>();
    map.set("zebra" as HouseId, createRngState("z"));
    map.set("alpha" as HouseId, createRngState("a"));
    map.set("mike" as HouseId, createRngState("m"));
    const out = serializeRegistry(map);
    expect(out.map(([id]) => id)).toEqual(["alpha", "mike", "zebra"]);
  });
  it("is identity-preserving through deserialize", () => {
    const map = new Map<HouseId, RngState>();
    map.set(PLAYER, { seed: "p", callCount: 3 });
    map.set(RIVAL, { seed: "r", callCount: 7 });
    const roundTripped = deserializeRegistry(serializeRegistry(map));
    expect(roundTripped.size).toBe(2);
    expect(roundTripped.get(PLAYER)).toEqual({ seed: "p", callCount: 3 });
    expect(roundTripped.get(RIVAL)).toEqual({ seed: "r", callCount: 7 });
  });
});

describe("getOrThrow", () => {
  it("returns the state for a registered houseId", () => {
    const map = new Map<HouseId, RngState>();
    const player = createRngState("p");
    map.set(PLAYER, player);
    expect(getOrThrow(map, PLAYER)).toBe(player);
  });
  it("throws RngNotRegisteredError on missing key", () => {
    const map = new Map<HouseId, RngState>();
    expect(() => getOrThrow(map, PLAYER)).toThrow(RngNotRegisteredError);
  });
});
