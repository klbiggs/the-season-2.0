// Enforcement: the keyset of hashableState's output must equal the keyset of
// GameStateSchema. A phase author who adds a field to GameStateSchema must
// also extend hashableState — and vice versa. Catches the "added field, forgot
// the projection" failure mode.

import { describe, expect, it } from "vitest";
import { hashableState } from "./hash";
import { GameStateSchema, createInitialState } from "./store";

describe("hashableState matches GameStateSchema's keyset", () => {
  it("schema keys == projection keys", () => {
    const schemaKeys = Object.keys(GameStateSchema.shape).sort();
    const projectionKeys = Object.keys(hashableState(createInitialState("seed"))).sort();
    expect(projectionKeys).toEqual(schemaKeys);
  });
});
