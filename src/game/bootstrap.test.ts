import { describe, expect, it } from "vitest";
import { seedStartingFamily } from "./bootstrap";
import { LIFESPAN_RANGE } from "./constants";
import { STARTING_HEAD_CHARACTER_ID, STARTING_HEAD_NAME } from "./fixtures/names";
import { createRngState } from "./rng";
import { PLAYER_HOUSE_ID } from "./rng.seeds";
import { createInitialState } from "./store";

describe("seedStartingFamily", () => {
  it("rolls a deathAge in [70, 95] inclusive", () => {
    const rng = createRngState("alpha");
    const seeded = seedStartingFamily(rng);
    expect(seeded.character.deathAge).toBeGreaterThanOrEqual(LIFESPAN_RANGE[0]);
    expect(seeded.character.deathAge).toBeLessThanOrEqual(LIFESPAN_RANGE[1]);
  });
  it("advances rngState callCount by exactly 1", () => {
    const rng = createRngState("alpha");
    const seeded = seedStartingFamily(rng);
    expect(seeded.rngState.callCount).toBe(1);
  });
  it("seeds house with PLAYER_HOUSE_ID + heirless=false", () => {
    const seeded = seedStartingFamily(createRngState("alpha"));
    expect(seeded.house.id).toBe(PLAYER_HOUSE_ID);
    expect(seeded.house.heirless).toBe(false);
  });
  it("seeds head as HeadOfHouse with birthTick=0, age=25, name='Player I'", () => {
    const seeded = seedStartingFamily(createRngState("alpha"));
    expect(seeded.character.id).toBe(STARTING_HEAD_CHARACTER_ID);
    expect(seeded.character.name).toBe(STARTING_HEAD_NAME);
    expect(seeded.character.role).toBe("HeadOfHouse");
    expect(seeded.character.birthTick).toBe(0);
    expect(seeded.character.age).toBe(25);
    expect(seeded.character.alive).toBe(true);
    expect(seeded.character.mood).toBe("Receptive");
  });
});

describe("bootstrap-order callCount invariant (C2 fold)", () => {
  // P0→P1 contract delta: createInitialState now advances callCount to 1 at
  // construction (head deathAge roll). This is the cheapest possible
  // detection site for bootstrap-order regression.
  it("createInitialState('alpha') leaves player rng at callCount === 1", () => {
    const state = createInitialState("alpha");
    expect(state.rng.get(PLAYER_HOUSE_ID)?.callCount).toBe(1);
  });
});
