// Save round-trip: advance, save, load into a fresh store, continue advancing,
// compare hashes against a control that never persisted. Pinned at 500/500.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { hashState } from "../game/hash";
import { REPLAY_SEEDS } from "../game/rng.seeds";
import { createStore, selectGameState } from "../game/store";
import { DEV_SLOT, _resetForTests, load, save } from "./dexie";
// P3: legacy SaveV1/V2/V3 migration is covered by dedicated suites; this
// round-trip test exercises the SaveV4 on-disk path (live save format).
import { fromSaveV9 } from "./schema";

const N_BEFORE_SAVE = 500;
const N_AFTER_LOAD = 500;
const SEED = REPLAY_SEEDS[0];

beforeEach(async () => {
  await _resetForTests();
});

afterEach(async () => {
  await _resetForTests();
});

describe("save → load → advance matches no-detour control", () => {
  it("hashes match", async () => {
    const sut = createStore({ seed: SEED });
    for (let i = 0; i < N_BEFORE_SAVE; i += 1) sut.getState().advanceTick();
    await save(DEV_SLOT, selectGameState(sut.getState()));

    const loaded = await load(DEV_SLOT);
    expect(loaded).toBeDefined();
    if (loaded === undefined) throw new Error("load returned undefined");

    const restored = createStore({ seed: SEED });
    restored.getState().replaceState(fromSaveV9(loaded));
    for (let i = 0; i < N_AFTER_LOAD; i += 1) restored.getState().advanceTick();

    const control = createStore({ seed: SEED });
    for (let i = 0; i < N_BEFORE_SAVE + N_AFTER_LOAD; i += 1) control.getState().advanceTick();

    expect(hashState(selectGameState(restored.getState()))).toBe(
      hashState(selectGameState(control.getState())),
    );
  });
});

describe("migration runner identity (v1 → v1)", () => {
  it("returns identical state", async () => {
    const { runMigrations } = await import("./migrations/runner");
    const { MIGRATIONS } = await import("./migrations/index");
    const input = { version: 1, tick: 7, rng: [["player", { seed: "x", callCount: 3 }]] };
    expect(runMigrations(input, 1, 1, MIGRATIONS)).toEqual(input);
  });
});
