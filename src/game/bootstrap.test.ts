import { describe, expect, it } from "vitest";
import { seedStartingFamily } from "./bootstrap";
import { LIFESPAN_RANGE, PROCEDURAL_NPC_COUNT } from "./constants";
import { STARTING_HEAD_CHARACTER_ID, STARTING_HEAD_NAME } from "./fixtures/names";
import { BASELINE_NPCS } from "./fixtures/npcs";
import { INDEPENDENT_HOUSE_ID, createRngState } from "./rng";
import { PLAYER_HOUSE_ID } from "./rng.seeds";
import { createInitialState } from "./store";

// P4: seedStartingFamily now returns plural arrays. Look up the player
// house/character by id to keep tests stable across future-phase NPC seeding.
function getPlayer(seeded: ReturnType<typeof seedStartingFamily>) {
  const house = seeded.houses.find((h) => h.id === PLAYER_HOUSE_ID);
  const character = seeded.characters.find((c) => c.houseId === PLAYER_HOUSE_ID);
  if (house === undefined || character === undefined) {
    throw new Error("test setup: player house/character missing from seedStartingFamily");
  }
  return { house, character };
}

describe("seedStartingFamily", () => {
  it("rolls a deathAge in [70, 95] inclusive", () => {
    const rng = createRngState("alpha");
    const seeded = seedStartingFamily(rng, "alpha");
    const { character } = getPlayer(seeded);
    expect(character.deathAge).toBeGreaterThanOrEqual(LIFESPAN_RANGE[0]);
    expect(character.deathAge).toBeLessThanOrEqual(LIFESPAN_RANGE[1]);
  });
  it("advances rngState callCount by exactly 1 (NPCs are constants)", () => {
    const rng = createRngState("alpha");
    const seeded = seedStartingFamily(rng, "alpha");
    expect(seeded.rngState.callCount).toBe(1);
  });
  it("seeds player house with PLAYER_HOUSE_ID + heirless=false", () => {
    const seeded = seedStartingFamily(createRngState("alpha"), "alpha");
    const { house } = getPlayer(seeded);
    expect(house.id).toBe(PLAYER_HOUSE_ID);
    expect(house.heirless).toBe(false);
  });
  it("seeds head as HeadOfHouse with birthTick=0, age=25, name='Player I'", () => {
    const seeded = seedStartingFamily(createRngState("alpha"), "alpha");
    const { character } = getPlayer(seeded);
    expect(character.id).toBe(STARTING_HEAD_CHARACTER_ID);
    expect(character.name).toBe(STARTING_HEAD_NAME);
    expect(character.role).toBe("HeadOfHouse");
    expect(character.birthTick).toBe(0);
    expect(character.age).toBe(25);
    expect(character.alive).toBe(true);
    expect(character.mood).toBe("Receptive");
  });
  it("seeds Independent house alongside player (P4)", () => {
    const seeded = seedStartingFamily(createRngState("alpha"), "alpha");
    const indy = seeded.houses.find((h) => h.id === INDEPENDENT_HOUSE_ID);
    expect(indy).toBeDefined();
    expect(indy?.heirless).toBe(false);
  });
  it("seeds the 5 baseline NPCs into INDEPENDENT_HOUSE_ID (P4)", () => {
    const seeded = seedStartingFamily(createRngState("alpha"), "alpha");
    const indyIds = new Set(
      seeded.characters.filter((c) => c.houseId === INDEPENDENT_HOUSE_ID).map((c) => c.id),
    );
    // P16: the Independent house also holds the procedural society batch, so the
    // baseline NPCs are a SUBSET now (not the full membership). Assert each
    // baseline NPC is present.
    for (const npc of BASELINE_NPCS) expect(indyIds.has(npc.id)).toBe(true);
  });

  it("seeds PROCEDURAL_NPC_COUNT society NPCs into INDEPENDENT_HOUSE_ID (P16)", () => {
    const seeded = seedStartingFamily(createRngState("alpha"), "alpha");
    const society = seeded.characters.filter((c) => c.id.startsWith("proc-npc-"));
    expect(society).toHaveLength(PROCEDURAL_NPC_COUNT);
    for (const c of society) expect(c.houseId).toBe(INDEPENDENT_HOUSE_ID);
  });
});

describe("bootstrap-order callCount invariant (C2 fold)", () => {
  // P0→P1 contract delta: createInitialState advances callCount to 1 at
  // construction (head deathAge roll). P4: NPC deathAges are constants —
  // callCount stays at 1 (unchanged from P3).
  it("createInitialState('alpha') leaves player rng at callCount === 1", () => {
    const state = createInitialState("alpha");
    expect(state.rng.get(PLAYER_HOUSE_ID)?.callCount).toBe(1);
  });
  it("createInitialState('alpha') leaves Independent rng at callCount === 0 (P4)", () => {
    const state = createInitialState("alpha");
    expect(state.rng.get(INDEPENDENT_HOUSE_ID)?.callCount).toBe(0);
  });
});
