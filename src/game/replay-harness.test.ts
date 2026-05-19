// P1 replay determinism harness. Replaces P0's 1000-tick discard-driven
// schedule wholesale (P0's baseline hash is intentionally not preserved at
// P1; see "P0→P1 replay-hash baseline reset" in plans/phases/01-tick-engine.md).
//
// Schedule: 100 ticks of advanceTick with runYearPass every 10 ticks.
// Loop body ordering pin: advanceTick ALWAYS precedes runYearPass within an
// iteration so year-pass fires at tick i+1 (first at tick 1, then 11, 21, ...,
// 91 — 10 year-passes total). Reversing the order would shift every year-pass
// by one tick and break replay determinism. Do NOT "fix" this to fire at
// ticks 10, 20, ...

import { describe, expect, it } from "vitest";
import { hashState } from "./hash";
import { NEGATIVE_CONTROL_SEED, REPLAY_SEEDS } from "./rng.seeds";
import { createStore, selectGameState } from "./store";

const RUNS = 30;
const TICKS_PER_RUN = 100;
const YEAR_PASS_EVERY = 10;

function runOnce(seed: string): string {
  const store = createStore({ seed });
  for (let i = 0; i < TICKS_PER_RUN; i += 1) {
    store.getState().advanceTick();
    if (i % YEAR_PASS_EVERY === 0) {
      store.getState().runYearPass();
    }
  }
  return hashState(selectGameState(store.getState()));
}

describe(`30-run replay (seed = "${REPLAY_SEEDS[0]}", ${TICKS_PER_RUN} ticks + year-pass every ${YEAR_PASS_EVERY})`, () => {
  const baseline = runOnce(REPLAY_SEEDS[0]);
  it.each(Array.from({ length: RUNS }, (_, i) => i + 1))(
    "run %i matches baseline hash",
    (_runNumber) => {
      expect(runOnce(REPLAY_SEEDS[0])).toBe(baseline);
    },
  );
});

describe("negative control — different seed yields a different hash", () => {
  it("baseline seed != negative-control seed", () => {
    const baseline = runOnce(REPLAY_SEEDS[0]);
    const control = runOnce(NEGATIVE_CONTROL_SEED);
    expect(baseline).not.toBe(control);
  });
});
