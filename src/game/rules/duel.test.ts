// P8: duel resolver tests. Verifies the canonical Stalemate-by-construction
// and challenger-first attack-ordering paths via the test-mode overrides.

import { describe, expect, it } from "vitest";
import { makeCharacter, makeGameState } from "../__test-utils__/factories";
import type { Duel, Grievance } from "../entities";
import {
  type CharacterId,
  type DuelId,
  type GrievanceId,
  type HouseId,
  createRngState,
} from "../rng";
import { resolveDuel } from "./duel";

function buildDuelState(seed = "duel-seed") {
  const challengerId = "challenger-c" as CharacterId;
  const defenderId = "defender-d" as CharacterId;
  const challenger = makeCharacter({
    id: challengerId,
    name: "Challenger",
    composure: 100,
    maxComposure: 100,
  });
  const defender = makeCharacter({
    id: defenderId,
    name: "Defender",
    composure: 100,
    maxComposure: 100,
  });
  const characters = new Map<CharacterId, ReturnType<typeof makeCharacter>>();
  characters.set(challengerId, challenger);
  characters.set(defenderId, defender);
  const grievanceId = "g-test" as GrievanceId;
  const duelId = "duel-test" as DuelId;
  const duel: Duel = {
    id: duelId,
    challengerCharacterId: challengerId,
    defenderCharacterId: defenderId,
    grievanceId,
    initiatedAtTick: 0,
    status: "Active",
    resolvedAtTick: null,
    outcome: null,
    loserCasualty: "Unharmed",
    exchangesElapsed: 0,
  };
  const duels = new Map<DuelId, Duel>([[duelId, duel]]);
  const state = makeGameState({ characters, duels });
  const rng = createRngState(seed);
  return { state, duelId, challengerId, defenderId, grievanceId, rng };
}

describe("resolveDuel — forceParryEveryExchange → Stalemate", () => {
  it("reaches 12-exchange stalemate when every parry blocks damage", () => {
    const { state, duelId, rng } = buildDuelState();
    const { finalDuel } = resolveDuel(state, duelId, rng, { forceParryEveryExchange: true });
    expect(finalDuel.outcome).toBe("Stalemate");
    expect(finalDuel.loserCasualty).toBe("Unharmed");
    expect(finalDuel.exchangesElapsed).toBe(12);
    expect(finalDuel.status).toBe("Resolved");
  });
});

describe("resolveDuel — forceNoParryEveryExchange → ChallengerVictory", () => {
  it("terminates after exchange 3 with defender as loser (challenger acts first)", () => {
    const { state, duelId, rng } = buildDuelState();
    const { finalDuel } = resolveDuel(state, duelId, rng, { forceNoParryEveryExchange: true });
    // Spec §3 line 368: challenger attacks first.
    // exch 1: challenger → defender 100→50
    // exch 2: defender → challenger 100→50
    // exch 3: challenger → defender 50→0 (defender loses)
    expect(finalDuel.outcome).toBe("ChallengerVictory");
    expect(finalDuel.exchangesElapsed).toBe(3);
    expect(["Killed", "Wounded"]).toContain(finalDuel.loserCasualty);
  });
});

describe("resolveDuel — Stalemate skips grievance flip", () => {
  it("does NOT flip grievance.resolved on Stalemate", () => {
    const { state, duelId, rng } = buildDuelState();
    // Seed a grievance on the player house (the only house in makeGameState).
    const grievance: Grievance = {
      id: "g-test" as GrievanceId,
      perpetratorHouseId: "rival-test" as HouseId,
      defendantCharacterId: null,
      source: "Sabotage",
      schemeId: null,
      recordedAtTick: 0,
      resolved: false,
    };
    const newHouses = new Map(state.houses);
    // The replay test sets up empty houses by default — for the stalemate
    // grievance assertion we add a house holding the grievance directly.
    const houseId = "player" as HouseId;
    newHouses.set(houseId, {
      id: houseId,
      wealth: 100,
      reputation: 50,
      scandal: 0,
      headOfHouseCharacterId: "challenger-c" as CharacterId,
      generation: 0,
      ancestorSummary: [],
      heirless: false,
      currentLocation: "Capital",
      consecutiveTicksAtCurrentLocation: 0,
      lastAudienceTick: null,
      wardrobeLastRefreshTick: null,
      blockadeBypassEarned: false,
      grievances: [grievance],
      exiled: false,
      hostility: 0,
      factionId: "faction-crown" as import("../rng").FactionId,
      siblingRivals: [],
      inheritedSecrets: [],
      bloodFeuds: [],
      courierResearchEarned: false,
    });
    const stateWithHouse = { ...state, houses: newHouses };
    const { state: postState, finalDuel } = resolveDuel(stateWithHouse, duelId, rng, {
      forceParryEveryExchange: true,
    });
    expect(finalDuel.outcome).toBe("Stalemate");
    const holder = postState.houses.get(houseId);
    expect(holder?.grievances[0]?.resolved).toBe(false);
  });
});

describe("resolveDuel — mutually exclusive force flags throw", () => {
  it("throws when both forceParry + forceNoParry are true", () => {
    const { state, duelId, rng } = buildDuelState();
    expect(() =>
      resolveDuel(state, duelId, rng, {
        forceParryEveryExchange: true,
        forceNoParryEveryExchange: true,
      }),
    ).toThrow();
  });
});
