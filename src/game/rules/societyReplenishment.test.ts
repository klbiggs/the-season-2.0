import { describe, expect, it } from "vitest";
import { makeGameState } from "../__test-utils__/factories";
import { PROCEDURAL_NPC_COUNT, SOCIETY_MAX_ARRIVALS_PER_YEAR } from "../constants";
import type { Character, GameState } from "../entities";
import { hashState } from "../hash";
import { type CharacterId, INDEPENDENT_HOUSE_ID } from "../rng";
import { createInitialState } from "../store";
import {
  PROCEDURAL_NPC_ID_PREFIX,
  aliveProceduralNpcCount,
  totalProceduralNpcCount,
} from "./proceduralNpcs";
import { applySocietyReplenishmentStep } from "./societyReplenishment";

// Kill `n` alive procedural NPCs (lex-sorted by id) to open a replenishment
// deficit. Pure: clones the characters Map. Deterministic for a given state.
function killSocietyMembers(state: GameState, n: number): GameState {
  const procIds = [...state.characters.values()]
    .filter((c) => c.id.startsWith(PROCEDURAL_NPC_ID_PREFIX) && c.alive)
    .map((c) => c.id)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, n);
  const characters = new Map<CharacterId, Character>(state.characters);
  for (const id of procIds) {
    const c = characters.get(id);
    if (c !== undefined) characters.set(id, { ...c, alive: false, diedAtTick: state.tick });
  }
  return { ...state, characters };
}

describe("applySocietyReplenishmentStep (P22)", () => {
  it("is a no-op when the cohort is at the floor (fresh bootstrap)", () => {
    const state = createInitialState("seed-a");
    expect(aliveProceduralNpcCount(state.characters)).toBe(PROCEDURAL_NPC_COUNT);
    const result = applySocietyReplenishmentStep(state);
    expect(result).toBe(state); // same reference — zero-deficit fast path
  });

  it("is a no-op when there is no Independent rng stream (synthetic fixture)", () => {
    const state = makeGameState({}); // empty rng Map
    expect(state.rng.has(INDEPENDENT_HOUSE_ID)).toBe(false);
    expect(applySocietyReplenishmentStep(state)).toBe(state);
  });

  it("tops up toward the floor, capped at SOCIETY_MAX_ARRIVALS_PER_YEAR", () => {
    // Deficit 5 (kill 5) > cap 3 ⇒ exactly 3 arrivals.
    const state = killSocietyMembers(createInitialState("seed-a"), 5);
    expect(aliveProceduralNpcCount(state.characters)).toBe(PROCEDURAL_NPC_COUNT - 5);
    const result = applySocietyReplenishmentStep(state);
    expect(aliveProceduralNpcCount(result.characters)).toBe(
      PROCEDURAL_NPC_COUNT - 5 + SOCIETY_MAX_ARRIVALS_PER_YEAR,
    );
  });

  it("fills the exact deficit when it is below the cap", () => {
    const state = killSocietyMembers(createInitialState("seed-a"), 2); // deficit 2 < cap 3
    const result = applySocietyReplenishmentStep(state);
    expect(aliveProceduralNpcCount(result.characters)).toBe(PROCEDURAL_NPC_COUNT);
  });

  it("mints non-colliding ids continuing the proc-npc index", () => {
    const state = killSocietyMembers(createInitialState("seed-a"), 5);
    const before = totalProceduralNpcCount(state.characters); // 20 (alive + dead)
    const result = applySocietyReplenishmentStep(state);
    const newcomerIds = [...result.characters.keys()].filter((id) => !state.characters.has(id));
    expect(newcomerIds.sort()).toEqual([
      `${PROCEDURAL_NPC_ID_PREFIX}${before}`,
      `${PROCEDURAL_NPC_ID_PREFIX}${before + 1}`,
      `${PROCEDURAL_NPC_ID_PREFIX}${before + 2}`,
    ]);
  });

  it("never deletes characters (society grows monotonically)", () => {
    const state = killSocietyMembers(createInitialState("seed-a"), 5);
    const result = applySocietyReplenishmentStep(state);
    for (const id of state.characters.keys()) {
      expect(result.characters.has(id)).toBe(true);
    }
    expect(result.characters.size).toBe(state.characters.size + SOCIETY_MAX_ARRIVALS_PER_YEAR);
  });

  it("generates newcomers into INDEPENDENT_HOUSE_ID", () => {
    const state = killSocietyMembers(createInitialState("seed-a"), 5);
    const result = applySocietyReplenishmentStep(state);
    const newcomers = [...result.characters.values()].filter((c) => !state.characters.has(c.id));
    expect(newcomers).toHaveLength(SOCIETY_MAX_ARRIVALS_PER_YEAR);
    for (const c of newcomers) expect(c.houseId).toBe(INDEPENDENT_HOUSE_ID);
  });

  it("uses the CURRENT era — Later-era state yields different names than Earlier", () => {
    const earlier = killSocietyMembers({ ...createInitialState("seed-a"), era: "Earlier" }, 5);
    const later = killSocietyMembers({ ...createInitialState("seed-a"), era: "Later" }, 5);
    const namesOf = (s: GameState): string[] => {
      const r = applySocietyReplenishmentStep(s);
      return [...r.characters.values()]
        .filter((c) => !s.characters.has(c.id))
        .map((c) => c.name)
        .sort();
    };
    expect(namesOf(earlier)).not.toEqual(namesOf(later));
  });

  it("advances the Independent rng stream (draws were consumed)", () => {
    const state = killSocietyMembers(createInitialState("seed-a"), 5);
    const before = state.rng.get(INDEPENDENT_HOUSE_ID)?.callCount ?? -1;
    const result = applySocietyReplenishmentStep(state);
    const after = result.rng.get(INDEPENDENT_HOUSE_ID)?.callCount ?? -1;
    expect(after).toBeGreaterThan(before);
  });
});

describe("society replenishment determinism (≥30 runs)", () => {
  const RUNS = 30;

  // Builds an identical depleted state from a fixed seed, runs the replenishment
  // step, and hashes the result. Identical inputs ⇒ identical hash across runs.
  function runOnce(): string {
    const state = killSocietyMembers(createInitialState("replay-society"), 8);
    return hashState(applySocietyReplenishmentStep(state));
  }

  const baseline = runOnce();
  it.each(Array.from({ length: RUNS }, (_, i) => i + 1))("run %i matches the baseline hash", () => {
    expect(runOnce()).toBe(baseline);
  });
});
