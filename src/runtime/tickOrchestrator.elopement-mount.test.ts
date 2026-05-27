// P9 — positive-control phase-chain test for state.elopement mount.
//
// applySchemeResolutionPhase gained a new side effect at P9: when the
// resolveSeduction discovery branch fires, it calls
// startElopementSprintFromDiscoveredSeduction which writes state.elopement.
// This test pins that contract — without it, a future refactor that moves the
// sprint-mount helper to a different phase slot would silently break the
// discovery → mount path.

import { describe, expect, it } from "vitest";
import { SEDUCTION_DISCOVERY_PROBABILITY } from "../game/constants";
import type { GameState, Scheme } from "../game/entities";
import { drawNext } from "../game/rng";
import { PLAYER_HOUSE_ID } from "../game/rng";
import type { CharacterId, SchemeId } from "../game/rng";
import { applySchemeResolutionPhase } from "../game/rules/schemes";
import { createInitialState } from "../game/store";

// Walk a fixed seed's draw stream until we find a call-count offset that
// yields a draw < SEDUCTION_DISCOVERY_PROBABILITY at the next draw site.
// Returns { seed, callCount } such that state.rng[player] = { seed, callCount }
// produces a discovery hit on the next `drawNext` call.
function findDiscoveringRngState(seedString: string): { seed: string; callCount: number } {
  let rng = { seed: seedString, callCount: 0 };
  for (let i = 0; i < 100; i++) {
    const { next, rngState } = drawNext(rng);
    if (next < SEDUCTION_DISCOVERY_PROBABILITY) {
      return rng;
    }
    rng = rngState;
  }
  throw new Error(
    "findDiscoveringRngState: no discovery draw found in 100 iterations — seed unsuitable",
  );
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
    accumulatedAffection: 0,
  };
  // Prime the player house's RNG so the next draw lands < discovery probability.
  const primedRng = findDiscoveringRngState(seedString);
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
    // Find an rng state where the next draw is ≥ 0.2 (no discovery).
    let rng = { seed: "non-discover-test", callCount: 0 };
    for (let i = 0; i < 100; i++) {
      const { next, rngState } = drawNext(rng);
      if (next >= SEDUCTION_DISCOVERY_PROBABILITY) break;
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
