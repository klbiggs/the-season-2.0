// Proves the alea + {seed, callCount} replay contract is bit-identical for the
// pinned seedrandom@3.0.5 + alea algorithm. If this test ever fails, the
// replay invariant for every save in the wild is broken.

import { describe, expect, it } from "vitest";
import { type RngState, createRngState, drawNext } from "./rng";
import { NEGATIVE_CONTROL_SEED, REPLAY_SEEDS } from "./rng.seeds";

const TOTAL = 1000;
const SPLIT = 500;

function takeN(seed: string, count: number): number[] {
  let state = createRngState(seed);
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const { next, rngState } = drawNext(state);
    out.push(next);
    state = rngState;
  }
  return out;
}

const ALL_SEEDS = [...REPLAY_SEEDS, NEGATIVE_CONTROL_SEED] as const;

describe("replay equivalence: fresh = restore-from-callCount", () => {
  for (const seed of ALL_SEEDS) {
    it(`bit-identical sequence under seed "${seed}"`, () => {
      const sequenceA = takeN(seed, TOTAL);

      // Sequence B: build a state with callCount=SPLIT, then take SPLIT more.
      let stateB: RngState = { seed, callCount: SPLIT };
      const sequenceB: number[] = [];
      for (let i = 0; i < SPLIT; i += 1) {
        const { next, rngState } = drawNext(stateB);
        sequenceB.push(next);
        stateB = rngState;
      }

      expect(sequenceB).toEqual(sequenceA.slice(SPLIT, TOTAL));
    });
  }
});

describe("seed determinism — different seeds produce different sequences", () => {
  it("REPLAY_SEEDS produce distinct first draws", () => {
    const draws = REPLAY_SEEDS.map((s) => drawNext(createRngState(s)).next);
    expect(new Set(draws).size).toBe(REPLAY_SEEDS.length);
  });
  it("NEGATIVE_CONTROL_SEED differs from REPLAY_SEEDS[0]", () => {
    const a = drawNext(createRngState(REPLAY_SEEDS[0])).next;
    const b = drawNext(createRngState(NEGATIVE_CONTROL_SEED)).next;
    expect(a).not.toBe(b);
  });
});
