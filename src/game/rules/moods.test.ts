import { describe, expect, it } from "vitest";
import {
  makeCharacter,
  makeCharactersMap,
  makeHouse,
  makeHousesMap,
} from "../__test-utils__/factories";
import type { Character, GameState, MarriageRecord } from "../entities";
import { MOOD_POOL, MOOD_POOL_TOTAL_WEIGHT } from "../fixtures/moods";
import { hashState } from "../hash";
import {
  type CharacterId,
  type HouseId,
  type MarriageId,
  type RngState,
  createRngState,
} from "../rng";
import { PLAYER_HOUSE_ID } from "../rng.seeds";
import { applyFauxPasLock, applyMoodDriftPhase, rollMoodDrift } from "./moods";

function makeState(overrides: Partial<GameState>): GameState {
  return {
    tick: 0,
    rng: new Map<HouseId, RngState>([[PLAYER_HOUSE_ID, createRngState("alpha")]]),
    houses: new Map(),
    characters: new Map<CharacterId, Character>(),
    marriages: new Map<MarriageId, MarriageRecord>(),
    campaignName: "test-campaign",
    era: "Earlier",
    conversationHistory: new Map(),
    affectionMap: new Map(),
    schemes: new Map(),
    whispers: new Map(),
    couriers: new Map(),
    staff: new Map(),
    ...overrides,
  };
}

describe("rollMoodDrift — lock-respect zero-draw invariant", () => {
  it("locked character skips BOTH roll and draw", () => {
    const rng = createRngState("alpha");
    const { mood, rngState } = rollMoodDrift("Receptive", rng, /*tick*/ 0, /*lockUntil*/ 5);
    expect(mood).toBe("Receptive");
    expect(rngState.callCount).toBe(0); // ← critical: callCount unchanged
  });
  it("non-locked character consumes at least 1 draw (gate)", () => {
    // With a seed that produces gate >= 0.15 (miss), only 1 draw consumed.
    const rng = createRngState("alpha");
    const { rngState } = rollMoodDrift("Receptive", rng, 0, 0);
    expect(rngState.callCount).toBeGreaterThanOrEqual(1);
  });
});

describe("applyFauxPasLock", () => {
  it("adds the 5-tick lock duration", () => {
    expect(applyFauxPasLock(0)).toBe(5);
    expect(applyFauxPasLock(100)).toBe(105);
  });
});

describe("MOOD_POOL_TOTAL_WEIGHT — derived constant", () => {
  it("equals sum of MOOD_POOL weights", () => {
    expect(MOOD_POOL_TOTAL_WEIGHT).toBe(MOOD_POOL.reduce((s, e) => s + e.weight, 0));
  });
  it("equals 9 at P1 tuning", () => {
    expect(MOOD_POOL_TOTAL_WEIGHT).toBe(9);
  });
});

describe("applyMoodDriftPhase — Map-insertion-order regression test", () => {
  // C5-tail fold: shuffled vs lex-sorted insertion order must produce
  // identical hash. Locks down the iteration-order discipline.
  it("hash is invariant to characters Map insertion order", () => {
    const h = makeHouse();
    const charA = makeCharacter({ id: "aaa" as CharacterId, houseId: h.id });
    const charB = makeCharacter({ id: "bbb" as CharacterId, houseId: h.id });
    const charC = makeCharacter({ id: "ccc" as CharacterId, houseId: h.id });

    // Lex-sorted insertion
    const charsLex = new Map<CharacterId, Character>();
    charsLex.set(charA.id, charA);
    charsLex.set(charB.id, charB);
    charsLex.set(charC.id, charC);

    // Reverse insertion (worst case for accidental insertion-order dependence)
    const charsRev = new Map<CharacterId, Character>();
    charsRev.set(charC.id, charC);
    charsRev.set(charB.id, charB);
    charsRev.set(charA.id, charA);

    const stateLex = makeState({ houses: makeHousesMap([h]), characters: charsLex });
    const stateRev = makeState({ houses: makeHousesMap([h]), characters: charsRev });

    const nextLex = applyMoodDriftPhase(stateLex);
    const nextRev = applyMoodDriftPhase(stateRev);

    expect(hashState(nextLex)).toBe(hashState(nextRev));
  });
});

describe("applyMoodDriftPhase — distribution sanity (C6 regression-catch)", () => {
  // Seed: "alpha" pinned. ±2% bound interpreted as a regression-catch on
  // seedrandom's first ~2000 outputs, NOT a statistical claim.
  it("empirical distribution roughly matches MOOD_POOL weights", () => {
    const h = makeHouse();
    // 1000 characters, all unlocked, all Receptive at start.
    const chars: Character[] = [];
    for (let i = 0; i < 1000; i += 1) {
      const id = `c-${String(i).padStart(4, "0")}` as CharacterId;
      chars.push(makeCharacter({ id, houseId: h.id, mood: "Receptive" }));
    }
    const state = makeState({
      tick: 0,
      houses: makeHousesMap([h]),
      characters: makeCharactersMap(chars),
    });
    const next = applyMoodDriftPhase(state);

    // Count how many ended up in non-Receptive moods (i.e., rerolled).
    let reroll = 0;
    for (const c of next.characters.values()) {
      if (c.mood !== "Receptive") reroll += 1;
    }
    // 15% gate × 1000 ≈ 150 hits. Of those, ~5/9 (~56%) land on a non-Receptive
    // value (Defensive/Distracted/Jealous weights sum to 5; Receptive=4/9). So
    // expected ~83 non-Receptive after the phase. Loose bound for the
    // regression-catch framing: ±50 of expected.
    expect(reroll).toBeGreaterThan(40);
    expect(reroll).toBeLessThan(150);
  });
});
