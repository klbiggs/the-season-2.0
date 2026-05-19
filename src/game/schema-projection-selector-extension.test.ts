// Triple-sync trip-wire. Extends the schema↔projection invariant
// (hashable-state-extension.test.ts) with the selectGameState projection.
// Catches the three-surface schema-extension footgun: when adding a new
// GameState field, all three of GameStateSchema, hashableState, and
// selectGameState must learn the new key. The hashable-state-extension test
// only enforces the first two; this test enforces all three.

import { describe, expect, it } from "vitest";
import { GameStateSchema } from "./entities";
import { hashableState } from "./hash";
import { createStore, selectGameState } from "./store";

describe("schema↔projection↔selector triple-sync", () => {
  it("Object.keys(GameStateSchema.shape) == Object.keys(hashableState(...)) == Object.keys(selectGameState(...))", () => {
    const store = createStore({ seed: "trip-wire-test" });
    const storeState = store.getState();
    const schemaKeys = new Set(Object.keys(GameStateSchema.shape));
    const projectionKeys = new Set(Object.keys(hashableState(storeState)));
    const selectorKeys = new Set(Object.keys(selectGameState(storeState)));
    expect(projectionKeys).toEqual(schemaKeys);
    expect(selectorKeys).toEqual(schemaKeys);
  });
});
