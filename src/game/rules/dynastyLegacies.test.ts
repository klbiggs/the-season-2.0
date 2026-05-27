// P15 — Dynasty Legacies gameplay-slice tests. Covers:
//   - Triggers (counter mutation sites → evaluateDynastyPerks awards).
//   - Effects (Patronage Country-yield boost, Seduction base bonus + scandal
//     halving, Whispers 2× verification, Whispers inbound intercept).
//   - RNG budget for the new conditional intercept draw (three cases) + the
//     RNG-freeness of evaluateDynastyPerks.

import { describe, expect, it } from "vitest";
import {
  makeCharacter,
  makeGameState,
  makeHouse,
  makeHousesMap,
} from "../__test-utils__/factories";
import {
  SEDUCTION_AFFECTION_PER_TICK,
  SEDUCTION_PERK_AFFECTION_BASE_BONUS,
  WHISPERS_PERK_VERIFICATION_MULTIPLIER,
  WHISPER_VERIFICATION_PER_TICK,
} from "../constants";
import { makePairKey } from "../conversation/types";
import type { CourierPayload, DynastyPerkAward, GameState, Whisper } from "../entities";
import {
  type CharacterId,
  type CourierPayloadId,
  type HouseId,
  PLAYER_HOUSE_ID,
  type RngState,
  type WhisperId,
  createRngState,
} from "../rng";
import { INDEPENDENT_HOUSE_ID } from "../rng";
import { applyCourierAndStaffPhase, applyWhispersPerkInterceptStep } from "./courier";
import {
  evaluateDynastyPerks,
  hasDynastyPerk,
  recordPlayerHeadNaturalDeath,
  recordPlayerHeadViolentDeath,
} from "./dynastyLegacies";
import { applyLocationEffectsPhase } from "./locationEffects";
import { applySchemeResolutionPhase, tryStartScheme } from "./schemes";
import { applyWhisperVerificationPhase } from "./whispers";

const RIVAL_HOUSE_ID = "rival-test" as HouseId;

function award(perk: DynastyPerkAward["perk"]): DynastyPerkAward {
  return { perk, awardedAtTick: 0, awardedDuringGeneration: 0 };
}

function makeWhisper(overrides: Partial<Whisper> = {}): Whisper {
  return {
    id: "w-0001" as WhisperId,
    text: "whisper",
    originatingTick: 0,
    sourceCharacterId: "src" as CharacterId,
    subjectCharacterId: "subj" as CharacterId,
    destinationHouseId: PLAYER_HOUSE_ID,
    arrivedAtTick: 0,
    verificationProgress: 0,
    status: "Unverified",
    weaponizedAs: null,
    weaponizedAtTick: null,
    scandalSheetAttribution: null,
    accidentalSlipDripsRemaining: 0,
    llmGenerated: false,
    ...overrides,
  };
}

function makeCourier(overrides: Partial<CourierPayload> = {}): CourierPayload {
  return {
    id: "c-0001" as CourierPayloadId,
    payloadType: "Whisper",
    whisperId: "w-0001" as WhisperId,
    originHouseId: RIVAL_HOUSE_ID,
    destinationHouseId: PLAYER_HOUSE_ID,
    originLocation: "Capital",
    destinationLocation: "Capital",
    originTick: 0,
    arrivalTick: 5,
    interceptable: true,
    direction: "Inbound",
    status: "InFlight",
    resolvedAtTick: null,
    ...overrides,
  };
}

// ── Triggers ───────────────────────────────────────────────────────────────

describe("dynasty-perk triggers", () => {
  it("awards Patronage after 3 consecutive player-head natural deaths", () => {
    const head = makeCharacter({ id: "head" as CharacterId });
    let state = makeGameState({
      houses: makeHousesMap([makeHouse({ headOfHouseCharacterId: "head" as CharacterId })]),
    });
    const dead = new Set<CharacterId>([head.id]);
    // The streak increments at the death site; evaluate reads the counter.
    for (let i = 0; i < 3; i += 1) {
      state = recordPlayerHeadNaturalDeath(state, dead);
    }
    expect(state.houses.get(PLAYER_HOUSE_ID)?.consecutiveHeirsNaturalDeath).toBe(3);
    const after = evaluateDynastyPerks(state);
    expect(hasDynastyPerk(after, "Patronage")).toBe(true);
    expect(after.houses.get(PLAYER_HOUSE_ID)?.awardedDynastyPerks[0]?.perk).toBe("Patronage");
  });

  it("does NOT award Patronage at 2 deaths; violent death resets the streak", () => {
    const head = makeCharacter({ id: "head" as CharacterId });
    let state = makeGameState({
      houses: makeHousesMap([makeHouse({ headOfHouseCharacterId: "head" as CharacterId })]),
    });
    const dead = new Set<CharacterId>([head.id]);
    state = recordPlayerHeadNaturalDeath(state, dead);
    state = recordPlayerHeadNaturalDeath(state, dead);
    // A violent kill of the head mid-streak resets the counter to 0.
    state = recordPlayerHeadViolentDeath(state, head.id);
    expect(state.houses.get(PLAYER_HOUSE_ID)?.consecutiveHeirsNaturalDeath).toBe(0);
    expect(hasDynastyPerk(evaluateDynastyPerks(state), "Patronage")).toBe(false);
    // Rebuild the streak to 3 → now awards.
    state = recordPlayerHeadNaturalDeath(state, dead);
    state = recordPlayerHeadNaturalDeath(state, dead);
    state = recordPlayerHeadNaturalDeath(state, dead);
    expect(hasDynastyPerk(evaluateDynastyPerks(state), "Patronage")).toBe(true);
  });

  it("awards Seduction at the cumulative success threshold", () => {
    const below = makeGameState({
      houses: makeHousesMap([makeHouse({ cumulativeSuccessfulSeductions: 3 })]),
    });
    expect(hasDynastyPerk(evaluateDynastyPerks(below), "Seduction")).toBe(false);
    const at = makeGameState({
      houses: makeHousesMap([makeHouse({ cumulativeSuccessfulSeductions: 4 })]),
    });
    expect(hasDynastyPerk(evaluateDynastyPerks(at), "Seduction")).toBe(true);
  });

  it("awards Whispers at the cumulative weaponized threshold", () => {
    const below = makeGameState({
      houses: makeHousesMap([makeHouse({ cumulativeWeaponizedWhispers: 4 })]),
    });
    expect(hasDynastyPerk(evaluateDynastyPerks(below), "Whispers")).toBe(false);
    const at = makeGameState({
      houses: makeHousesMap([makeHouse({ cumulativeWeaponizedWhispers: 5 })]),
    });
    expect(hasDynastyPerk(evaluateDynastyPerks(at), "Whispers")).toBe(true);
  });

  it("is idempotent (already-awarded perk is not re-pushed)", () => {
    const state = makeGameState({
      houses: makeHousesMap([
        makeHouse({ cumulativeSuccessfulSeductions: 9, awardedDynastyPerks: [award("Seduction")] }),
      ]),
    });
    const after = evaluateDynastyPerks(state);
    expect(after).toBe(state); // returns input unchanged when nothing new awards
    expect(after.houses.get(PLAYER_HOUSE_ID)?.awardedDynastyPerks).toHaveLength(1);
  });
});

// ── Effects ──────────────────────────────────────────────────────────────

describe("Patronage effect (Country wealth yield)", () => {
  function buildState(awarded: DynastyPerkAward[], location: "Country" | "Capital"): GameState {
    const head = makeCharacter({ id: "head" as CharacterId });
    return makeGameState({
      rng: new Map<HouseId, RngState>([[PLAYER_HOUSE_ID, createRngState("seed")]]),
      houses: makeHousesMap([
        makeHouse({
          headOfHouseCharacterId: head.id,
          currentLocation: location,
          wealth: 100,
          awardedDynastyPerks: awarded,
        }),
      ]),
      characters: new Map([[head.id, head]]),
    });
  }

  it("boosts the Country yield (×5 + flat 3) only when held + at Country", () => {
    // Country base delta is +1. With perk: round(1×5)+3 = +8.
    const held = applyLocationEffectsPhase(buildState([award("Patronage")], "Country"));
    expect(held.houses.get(PLAYER_HOUSE_ID)?.wealth).toBe(108);
  });

  it("does NOT boost when the perk is not held", () => {
    const unheld = applyLocationEffectsPhase(buildState([], "Country"));
    expect(unheld.houses.get(PLAYER_HOUSE_ID)?.wealth).toBe(101); // baseline +1
  });

  it("does NOT boost when not at Country", () => {
    // Capital delta is +0 wealth; the perk only modulates a positive Country delta.
    const elsewhere = applyLocationEffectsPhase(buildState([award("Patronage")], "Capital"));
    expect(elsewhere.houses.get(PLAYER_HOUSE_ID)?.wealth).toBe(100);
  });
});

describe("Whispers verification 2× effect", () => {
  function buildState(awarded: DynastyPerkAward[], sourceHouse: HouseId): GameState {
    const source = makeCharacter({ id: "src" as CharacterId, houseId: sourceHouse });
    return makeGameState({
      houses: makeHousesMap([
        makeHouse({ awardedDynastyPerks: awarded }),
        makeHouse({ id: RIVAL_HOUSE_ID }),
      ]),
      characters: new Map([[source.id, source]]),
      whispers: new Map([["w-0001" as WhisperId, makeWhisper({ verificationProgress: 0 })]]),
    });
  }

  it("doubles the per-tick increment for player-sourced whispers when held", () => {
    const after = applyWhisperVerificationPhase(buildState([award("Whispers")], PLAYER_HOUSE_ID));
    expect(after.whispers.get("w-0001" as WhisperId)?.verificationProgress).toBe(
      WHISPER_VERIFICATION_PER_TICK * WHISPERS_PERK_VERIFICATION_MULTIPLIER,
    );
  });

  it("uses the base increment for a rival-sourced whisper even when held", () => {
    const after = applyWhisperVerificationPhase(buildState([award("Whispers")], RIVAL_HOUSE_ID));
    expect(after.whispers.get("w-0001" as WhisperId)?.verificationProgress).toBe(
      WHISPER_VERIFICATION_PER_TICK,
    );
  });

  it("uses the base increment when the perk is not held", () => {
    const after = applyWhisperVerificationPhase(buildState([], PLAYER_HOUSE_ID));
    expect(after.whispers.get("w-0001" as WhisperId)?.verificationProgress).toBe(
      WHISPER_VERIFICATION_PER_TICK,
    );
  });
});

// ── RNG budget for the conditional intercept draw ─────────────────────────

describe("Whispers inbound-intercept RNG budget", () => {
  // Builds a state with `matching` couriers that satisfy the full 5-predicate
  // filter (InFlight + inbound + interceptable + dest=player + subject=player).
  function buildState(awarded: DynastyPerkAward[], matching: number): GameState {
    const subject = makeCharacter({ id: "subj" as CharacterId, houseId: PLAYER_HOUSE_ID });
    const whispers = new Map<WhisperId, Whisper>();
    const couriers = new Map<CourierPayloadId, CourierPayload>();
    for (let i = 0; i < matching; i += 1) {
      const wid = `w-${i}` as WhisperId;
      const cid = `c-${i}` as CourierPayloadId;
      whispers.set(wid, makeWhisper({ id: wid, subjectCharacterId: subject.id }));
      couriers.set(cid, makeCourier({ id: cid, whisperId: wid }));
    }
    return makeGameState({
      tick: 1,
      rng: new Map<HouseId, RngState>([[PLAYER_HOUSE_ID, createRngState("seed")]]),
      houses: makeHousesMap([makeHouse({ awardedDynastyPerks: awarded })]),
      characters: new Map([[subject.id, subject]]),
      whispers,
      couriers,
    });
  }

  it("draws ZERO when the perk is not held", () => {
    const state = buildState([], 3);
    const before = state.rng.get(PLAYER_HOUSE_ID)?.callCount;
    const after = applyWhispersPerkInterceptStep(state);
    expect(after).toBe(state);
    expect(after.rng.get(PLAYER_HOUSE_ID)?.callCount).toBe(before);
  });

  it("draws ZERO when held but no couriers match", () => {
    const state = buildState([award("Whispers")], 0);
    const before = state.rng.get(PLAYER_HOUSE_ID)?.callCount ?? 0;
    const after = applyWhispersPerkInterceptStep(state);
    expect(after.rng.get(PLAYER_HOUSE_ID)?.callCount).toBe(before);
  });

  it("draws exactly N when held with N matching couriers", () => {
    const state = buildState([award("Whispers")], 3);
    const before = state.rng.get(PLAYER_HOUSE_ID)?.callCount ?? 0;
    const after = applyWhispersPerkInterceptStep(state);
    expect(after.rng.get(PLAYER_HOUSE_ID)?.callCount).toBe(before + 3);
  });

  it("does NOT match couriers whose subject is a non-player character", () => {
    const subjRival = makeCharacter({ id: "subj-r" as CharacterId, houseId: RIVAL_HOUSE_ID });
    const state = makeGameState({
      tick: 1,
      rng: new Map<HouseId, RngState>([[PLAYER_HOUSE_ID, createRngState("seed")]]),
      houses: makeHousesMap([makeHouse({ awardedDynastyPerks: [award("Whispers")] })]),
      characters: new Map([[subjRival.id, subjRival]]),
      whispers: new Map([
        ["w-0001" as WhisperId, makeWhisper({ subjectCharacterId: subjRival.id })],
      ]),
      couriers: new Map([["c-0001" as CourierPayloadId, makeCourier()]]),
    });
    const before = state.rng.get(PLAYER_HOUSE_ID)?.callCount ?? 0;
    const after = applyWhispersPerkInterceptStep(state);
    expect(after.rng.get(PLAYER_HOUSE_ID)?.callCount).toBe(before); // subject clause filters it out
  });

  it("intercept fires within the composer between verify and drain", () => {
    // A matching courier arriving THIS tick: with the perk, the intercept can
    // flip it to Intercepted before drain delivers it. Deterministic via seed.
    const subject = makeCharacter({ id: "subj" as CharacterId, houseId: PLAYER_HOUSE_ID });
    const state = makeGameState({
      tick: 5,
      rng: new Map<HouseId, RngState>([[PLAYER_HOUSE_ID, createRngState("seed")]]),
      houses: makeHousesMap([makeHouse({ awardedDynastyPerks: [award("Whispers")] })]),
      characters: new Map([[subject.id, subject]]),
      whispers: new Map([
        [
          "w-0001" as WhisperId,
          makeWhisper({ subjectCharacterId: subject.id, arrivedAtTick: null }),
        ],
      ]),
      couriers: new Map([["c-0001" as CourierPayloadId, makeCourier({ arrivalTick: 5 })]]),
    });
    const after = applyCourierAndStaffPhase(state);
    const c = after.couriers.get("c-0001" as CourierPayloadId);
    // Either Intercepted (roll < p) or Delivered (roll >= p) — never still InFlight.
    expect(c?.status === "Intercepted" || c?.status === "Delivered").toBe(true);
    // A draw was consumed regardless of outcome (one matching courier).
    expect(after.rng.get(PLAYER_HOUSE_ID)?.callCount).toBe(1);
  });
});

// ── evaluateDynastyPerks is RNG-free ──────────────────────────────────────

describe("evaluateDynastyPerks RNG-freeness", () => {
  it("consumes zero RNG (justifies post-rival terminal placement)", () => {
    const state = makeGameState({
      rng: new Map<HouseId, RngState>([[PLAYER_HOUSE_ID, createRngState("seed")]]),
      houses: makeHousesMap([makeHouse({ cumulativeSuccessfulSeductions: 4 })]),
    });
    const before = state.rng.get(PLAYER_HOUSE_ID)?.callCount;
    const after = evaluateDynastyPerks(state);
    expect(after.rng.get(PLAYER_HOUSE_ID)?.callCount).toBe(before);
    expect(hasDynastyPerk(after, "Seduction")).toBe(true);
  });
});

// ── Seduction resolver effect + counter (integration via resolution phase) ─

describe("Seduction resolver — base bonus + counter increment", () => {
  const TARGET_ID = "npc-target" as CharacterId;

  // Minimal synth state with a player house + an Independent-house target.
  function synthSeductionState(seed: string, awarded: DynastyPerkAward[]): GameState {
    const playerHead = makeCharacter({
      id: "player-head" as CharacterId,
      houseId: PLAYER_HOUSE_ID,
    });
    const target = makeCharacter({ id: TARGET_ID, houseId: INDEPENDENT_HOUSE_ID });
    return makeGameState({
      tick: 5,
      rng: new Map<HouseId, RngState>([
        [PLAYER_HOUSE_ID, createRngState(seed)],
        [INDEPENDENT_HOUSE_ID, createRngState("indy")],
      ]),
      houses: makeHousesMap([
        makeHouse({
          id: PLAYER_HOUSE_ID,
          headOfHouseCharacterId: playerHead.id,
          wealth: 500,
          awardedDynastyPerks: awarded,
        }),
        makeHouse({ id: INDEPENDENT_HOUSE_ID, headOfHouseCharacterId: target.id }),
      ]),
      characters: new Map([
        [playerHead.id, playerHead],
        [target.id, target],
      ]),
    });
  }

  // Drive a scheme to its end-tick and resolve. Returns the resolved scheme +
  // state. The discovery roll happens at resolution; caller seed-sweeps for the
  // success branch.
  function resolveAt(state: GameState, awarded: DynastyPerkAward[]) {
    const start = tryStartScheme(state, PLAYER_HOUSE_ID, {
      kind: "Seduction",
      targetCharacterId: TARGET_ID,
    });
    if (!start.ok) return null;
    const scheme = start.state.schemes.get(start.schemeId);
    if (scheme === undefined) return null;
    const atEnd = { ...start.state, tick: scheme.endsAtTick };
    const resolved = applySchemeResolutionPhase(atEnd);
    const finalScheme = resolved.schemes.get(start.schemeId);
    return finalScheme?.status === "Completed" ? { resolved, awarded } : null;
  }

  function findSuccess(awarded: DynastyPerkAward[]) {
    for (let i = 0; i < 100; i += 1) {
      const r = resolveAt(synthSeductionState(`probe-${i}`, awarded), awarded);
      if (r !== null) return r.resolved;
    }
    throw new Error("no success-branch seed found");
  }

  it("a player-owned success increments cumulativeSuccessfulSeductions", () => {
    const resolved = findSuccess([]);
    expect(resolved.houses.get(PLAYER_HOUSE_ID)?.cumulativeSuccessfulSeductions).toBe(1);
  });

  it("the Seduction perk adds the base bonus to the success affection delta", () => {
    const baseline = findSuccess([]);
    const baselineKey = [...baseline.affectionMap.keys()].find((k) => k.includes(TARGET_ID));
    const baselineDelta = baselineKey ? (baseline.affectionMap.get(baselineKey) ?? 0) : 0;
    // P24a: a single completing tick accrues one per-tick delta (multi-tick model).
    expect(baselineDelta).toBe(SEDUCTION_AFFECTION_PER_TICK);

    const withPerk = findSuccess([award("Seduction")]);
    const perkKey = [...withPerk.affectionMap.keys()].find((k) => k.includes(TARGET_ID));
    const perkDelta = perkKey ? (withPerk.affectionMap.get(perkKey) ?? 0) : 0;
    // P24a: per-tick accrual + the one-time completion perk bonus.
    expect(perkDelta).toBe(SEDUCTION_AFFECTION_PER_TICK + SEDUCTION_PERK_AFFECTION_BASE_BONUS);
    expect(perkDelta).toBeGreaterThan(baselineDelta);
    // Sanity: the pair-key shape the resolver writes under contains the target.
    expect(makePairKey(PLAYER_HOUSE_ID, TARGET_ID)).toContain(TARGET_ID);
  });
});
