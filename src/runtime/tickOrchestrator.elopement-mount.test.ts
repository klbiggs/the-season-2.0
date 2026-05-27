// P9 — positive-control phase-chain test for state.elopement mount.
//
// applySchemeResolutionPhase gained a new side effect at P9: when the
// resolveSeduction discovery branch fires, it calls
// startElopementSprintFromDiscoveredSeduction which writes state.elopement.
// This test pins that contract — without it, a future refactor that moves the
// sprint-mount helper to a different phase slot would silently break the
// discovery → mount path.

import { describe, expect, it } from "vitest";
import {
  SEDUCTION_AFFECTION_CEILING,
  SEDUCTION_SUSPICION_BASE,
  SEDUCTION_SUSPICION_CEILING,
  SEDUCTION_SUSPICION_SLOPE,
} from "../game/constants";
import type { GameState, Scheme } from "../game/entities";
import { drawNext } from "../game/rng";
import { PLAYER_HOUSE_ID } from "../game/rng";
import type { CharacterId, SchemeId } from "../game/rng";
import { applySchemeResolutionPhase } from "../game/rules/schemes";
import { createInitialState } from "../game/store";

// P24a: the per-tick suspicion probability when accumulatedAffection is at the
// ceiling (the max ramp). The discovery mount test pre-sets accumulatedAffection
// to the ceiling so the suspicion roll is meaningful + a discovery draw is
// findable.
const MAX_SUSPICION_P = Math.min(
  SEDUCTION_SUSPICION_BASE + SEDUCTION_AFFECTION_CEILING * SEDUCTION_SUSPICION_SLOPE,
  SEDUCTION_SUSPICION_CEILING,
);

// Walk a fixed seed's draw stream until we find a call-count offset that yields a
// draw < `threshold` at the next draw site. Returns { seed, callCount } such that
// state.rng[player] = { seed, callCount } produces that hit on the next drawNext.
function findRngStateBelow(
  seedString: string,
  threshold: number,
): { seed: string; callCount: number } {
  let rng = { seed: seedString, callCount: 0 };
  for (let i = 0; i < 400; i++) {
    const { next, rngState } = drawNext(rng);
    if (next < threshold) {
      return rng;
    }
    rng = rngState;
  }
  throw new Error(`findRngStateBelow: no draw < ${threshold} found in 400 iterations`);
}

function makeStateWithSeductionAtEndTick(seedString: string): {
  state: GameState;
  schemeId: SchemeId;
} {
  const fresh = createInitialState(seedString);
  // Build a Seduction scheme that's ready to resolve THIS tick.
  const targetId = [...fresh.characters.keys()].find((id) => {
    const c = fresh.characters.get(id);
    return c?.houseId !== PLAYER_HOUSE_ID && c?.alive === true;
  });
  if (targetId === undefined) {
    throw new Error("makeStateWithSeductionAtEndTick: no eligible target");
  }
  const aggressorId = fresh.houses.get(PLAYER_HOUSE_ID)?.headOfHouseCharacterId;
  if (aggressorId === undefined) {
    throw new Error("makeStateWithSeductionAtEndTick: no head of house");
  }
  const schemeId = `${PLAYER_HOUSE_ID}:Seduction:0:0` as SchemeId;
  const scheme: Scheme = {
    id: schemeId,
    kind: "Seduction",
    ownerHouseId: PLAYER_HOUSE_ID,
    aggressorCharacterId: aggressorId,
    targetCharacterId: targetId as CharacterId,
    startedAtTick: 0,
    endsAtTick: 0, // ready to resolve at tick 0
    status: "Active",
    resolvedAtTick: null,
    failureReason: null,
    // P24a: pre-set to the ceiling so the per-tick suspicion roll is at its max
    // ramp — a discovery draw is then findable in the seed stream.
    accumulatedAffection: SEDUCTION_AFFECTION_CEILING,
  };
  // Prime the player house's RNG so the next (suspicion) draw lands < the max
  // suspicion probability → discovery fires this tick.
  const primedRng = findRngStateBelow(seedString, MAX_SUSPICION_P);
  const newRng = new Map(fresh.rng);
  newRng.set(PLAYER_HOUSE_ID, primedRng);
  const state: GameState = {
    ...fresh,
    rng: newRng,
    schemes: new Map([[schemeId, scheme]]),
  };
  return { state, schemeId };
}

describe("applySchemeResolutionPhase: discovered Seduction mounts state.elopement", () => {
  it("flips state.elopement from null → ElopementSprintState on discovery", () => {
    const { state, schemeId } = makeStateWithSeductionAtEndTick("mount-test-A");
    expect(state.elopements.size).toBe(0);
    const after = applySchemeResolutionPhase(state);
    const resolvedScheme = after.schemes.get(schemeId);
    expect(resolvedScheme?.status).toBe("Failed");
    expect(resolvedScheme?.failureReason).toBe("Discovered");
    // Phase-chain side effect: a sprint is now mounted in state.elopements.
    expect(after.elopements.size).toBe(1);
    const sprint = [...after.elopements.values()][0];
    expect(sprint?.schemeId).toBe(schemeId);
    expect(sprint?.elopingCharacterId).toBe(resolvedScheme?.aggressorCharacterId);
    expect(sprint?.targetCharacterId).toBe(resolvedScheme?.targetCharacterId);
  });

  it("sprint starts at the canonical tile positions (player 2, father 0)", () => {
    const { state } = makeStateWithSeductionAtEndTick("mount-test-B");
    const after = applySchemeResolutionPhase(state);
    const sprint = [...after.elopements.values()][0];
    expect(sprint?.playerTilePosition).toBe(2);
    expect(sprint?.fatherTilePosition).toBe(0);
    expect(sprint?.freshHorsesUsedCount).toBe(0);
  });

  it("non-discovered Seduction (completion branch) leaves state.elopement null", () => {
    // Prime with a seed that does NOT discover on the first draw.
    const fresh = createInitialState("non-discover-test");
    const targetId = [...fresh.characters.keys()].find((id) => {
      const c = fresh.characters.get(id);
      return c?.houseId !== PLAYER_HOUSE_ID && c?.alive === true;
    });
    const aggressorId = fresh.houses.get(PLAYER_HOUSE_ID)?.headOfHouseCharacterId;
    if (targetId === undefined || aggressorId === undefined) throw new Error("unreachable");
    const schemeId = `${PLAYER_HOUSE_ID}:Seduction:0:0` as SchemeId;
    // Find an rng state where the next (suspicion) draw is ≥ the max suspicion p
    // (so no discovery fires regardless of the per-tick ramp; accumulatedAffection
    // is 0 here, well below the ceiling).
    let rng = { seed: "non-discover-test", callCount: 0 };
    for (let i = 0; i < 100; i++) {
      const { next, rngState } = drawNext(rng);
      if (next >= MAX_SUSPICION_P) break;
      rng = rngState;
    }
    const newRng = new Map(fresh.rng);
    newRng.set(PLAYER_HOUSE_ID, rng);
    const scheme: Scheme = {
      id: schemeId,
      kind: "Seduction",
      ownerHouseId: PLAYER_HOUSE_ID,
      aggressorCharacterId: aggressorId,
      targetCharacterId: targetId as CharacterId,
      startedAtTick: 0,
      endsAtTick: 0,
      status: "Active",
      resolvedAtTick: null,
      failureReason: null,
      accumulatedAffection: 0,
    };
    const state: GameState = {
      ...fresh,
      rng: newRng,
      schemes: new Map([[schemeId, scheme]]),
    };
    const after = applySchemeResolutionPhase(state);
    const resolvedScheme = after.schemes.get(schemeId);
    expect(resolvedScheme?.status).toBe("Completed");
    expect(after.elopements.size).toBe(0);
  });
});
