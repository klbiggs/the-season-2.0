// 30-run replay determinism harness. Per-iteration `it.each` so a single-run
// failure surfaces the specific iteration rather than the bundle.

import { describe, expect, it } from "vitest";
import { hashState } from "./hash";
import { NEGATIVE_CONTROL_SEED, REPLAY_SEEDS } from "./rng.seeds";
import { createStore, selectGameState } from "./store";

const RUNS = 30;
const TICKS_PER_RUN = 1000;

function runOnce(seed: string): string {
  const store = createStore({ seed });
  for (let i = 0; i < TICKS_PER_RUN; i += 1) {
    store.getState().advanceTick();
  }
  return hashState(selectGameState(store.getState()));
}

describe(`30-run replay (seed = "${REPLAY_SEEDS[0]}", ${TICKS_PER_RUN} ticks)`, () => {
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
