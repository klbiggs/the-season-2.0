// P8: deterministic 12-exchange duel resolver. Spec §3 lines 364-370.
//
// Algorithm:
//   - Both duelists start at DUEL_INITIAL_COMPOSURE (100).
//   - Loop up to DUEL_MAX_EXCHANGES (12). Challenger acts first (spec §3 line 368).
//   - Each exchange consumes 1 PRNG draw for the per-exchange parry roll.
//     `parryRoll < DUEL_PARRY_PROBABILITY` (0.5) → no damage; else -50 composure.
//   - Loop exits on composure ≤ 0 OR exchanges == 12 (stalemate).
//   - Decisive loss: 1 PRNG draw for the 50/50 killed-vs-wounded roll.
//   - Killed: alive=false + pruneOrphanedConversationKeys death cascade.
//   - Wounded: composure restored to DUEL_WOUNDED_COMPOSURE_RESTORATION (25).
//   - Stalemate: both duelists' depleted composure persisted; no further mutation.
//
// Test-mode overrides bypass the parry draw:
//   - forceParryEveryExchange: true → all attacks blocked → 12-exchange Stalemate.
//   - forceNoParryEveryExchange: true → every attack lands → terminates by exch 3.

import {
  DUEL_INITIAL_COMPOSURE,
  DUEL_KILLED_VS_WOUNDED_PROBABILITY,
  DUEL_MAX_EXCHANGES,
  DUEL_PARRY_PROBABILITY,
  DUEL_WOUNDED_COMPOSURE_RESTORATION,
} from "../constants";
import type { Duel, DuelCasualty, DuelOutcome, GameState } from "../entities";
import {
  type CharacterId,
  type DuelId,
  type GrievanceId,
  type HouseId,
  type RngState,
  drawNext,
} from "../rng";
import { clamp } from "../util/clamp";
import { pruneOrphanedConversationKeys } from "./aging";
import { resolveBloodFeudByGrievance } from "./inheritedSecrets";

export type ResolveDuelOptions = {
  forceParryEveryExchange?: boolean;
  forceNoParryEveryExchange?: boolean;
};

export type ResolveDuelResult = {
  state: GameState;
  finalDuel: Duel;
  rngState: RngState;
};

// Locate the house that holds a grievance by walking all houses. v1 has <=5
// houses so the O(houses × grievances) cost is bounded. Returns null on
// missing — caller skips the grievance-flip step if the grievance vanished
// mid-cascade (e.g., a future phase that extends pruneOrphanedConversationKeys
// to drop grievances tied to a now-dead aggressor).
function findGrievanceHolderHouseId(state: GameState, grievanceId: GrievanceId): HouseId | null {
  for (const [hid, h] of state.houses) {
    if (h.grievances.some((g) => g.id === grievanceId)) return hid;
  }
  return null;
}

export function resolveDuel(
  state: GameState,
  duelId: DuelId,
  rngStateIn: RngState,
  opts?: ResolveDuelOptions,
): ResolveDuelResult {
  if (opts?.forceParryEveryExchange === true && opts?.forceNoParryEveryExchange === true) {
    throw new Error(
      "resolveDuel: forceParryEveryExchange and forceNoParryEveryExchange are mutually exclusive",
    );
  }

  const duel = state.duels.get(duelId);
  if (duel === undefined) {
    throw new Error(`resolveDuel: duel ${duelId} not found in state.duels`);
  }
  const challenger = state.characters.get(duel.challengerCharacterId);
  const defender = state.characters.get(duel.defenderCharacterId);
  if (challenger === undefined || defender === undefined) {
    throw new Error("resolveDuel: missing challenger or defender character");
  }

  // Spec §3 line 366: "Each duellist begins at 100 composure" — reset at duel
  // entry regardless of pre-duel composure.
  let challengerComposure = DUEL_INITIAL_COMPOSURE;
  let defenderComposure = DUEL_INITIAL_COMPOSURE;
  let exchanges = 0;
  let attacker: "challenger" | "defender" = "challenger"; // spec line 368
  let rngState = rngStateIn;

  while (challengerComposure > 0 && defenderComposure > 0 && exchanges < DUEL_MAX_EXCHANGES) {
    // Determine if this attack lands.
    let parried: boolean;
    if (opts?.forceParryEveryExchange === true) {
      parried = true;
    } else if (opts?.forceNoParryEveryExchange === true) {
      parried = false;
    } else {
      const { next: parryRoll, rngState: nextRng } = drawNext(rngState);
      rngState = nextRng;
      parried = parryRoll < DUEL_PARRY_PROBABILITY;
    }
    const composureDelta = parried ? 0 : -50; // -(BASE_POWER × MULTIPLIER)
    // Apply to the defender of THIS exchange (challenger and defender alternate).
    if (attacker === "challenger") {
      defenderComposure = clamp(defenderComposure + composureDelta, 0, DUEL_INITIAL_COMPOSURE);
    } else {
      challengerComposure = clamp(challengerComposure + composureDelta, 0, DUEL_INITIAL_COMPOSURE);
    }
    exchanges += 1;
    attacker = attacker === "challenger" ? "defender" : "challenger";
  }

  // Determine outcome.
  let outcome: DuelOutcome;
  let loserCasualty: DuelCasualty;
  let loserId: CharacterId | null = null;
  if (exchanges === DUEL_MAX_EXCHANGES && challengerComposure > 0 && defenderComposure > 0) {
    outcome = "Stalemate"; // favors defender per spec line 369
    loserCasualty = "Unharmed";
  } else {
    if (challengerComposure <= 0) {
      loserId = duel.challengerCharacterId;
      outcome = "DefenderVictory";
    } else {
      loserId = duel.defenderCharacterId;
      outcome = "ChallengerVictory";
    }
    const { next: casualtyRoll, rngState: postCasualty } = drawNext(rngState);
    rngState = postCasualty;
    loserCasualty = casualtyRoll < DUEL_KILLED_VS_WOUNDED_PROBABILITY ? "Killed" : "Wounded";
  }

  // Write composure back UNCONDITIONALLY for both duelists.
  let workingState = state;
  const newCharacters = new Map(state.characters);
  newCharacters.set(challenger.id, {
    ...challenger,
    composure: clamp(challengerComposure, 0, challenger.maxComposure),
  });
  newCharacters.set(defender.id, {
    ...defender,
    composure: clamp(defenderComposure, 0, defender.maxComposure),
  });
  workingState = { ...workingState, characters: newCharacters };

  // Casualty branches.
  if (loserCasualty === "Killed" && loserId !== null) {
    const loserChar = newCharacters.get(loserId);
    if (loserChar !== undefined) {
      newCharacters.set(loserId, {
        ...loserChar,
        alive: false,
        diedAtTick: workingState.tick,
      });
      workingState = pruneOrphanedConversationKeys(
        { ...workingState, characters: newCharacters },
        new Set<CharacterId>([loserId]),
      );
    }
  } else if (loserCasualty === "Wounded" && loserId !== null) {
    const loserChar = newCharacters.get(loserId);
    if (loserChar !== undefined) {
      newCharacters.set(loserId, {
        ...loserChar,
        composure: clamp(DUEL_WOUNDED_COMPOSURE_RESTORATION, 0, loserChar.maxComposure),
      });
      workingState = { ...workingState, characters: newCharacters };
    }
  }

  // Flip the grievance's resolved field on decisive outcomes only (spec §3
  // line 369: Stalemate keeps the grievance unresolved).
  if (outcome !== "Stalemate") {
    const holderHouseId = findGrievanceHolderHouseId(workingState, duel.grievanceId);
    if (holderHouseId !== null) {
      const holderHouse = workingState.houses.get(holderHouseId);
      if (holderHouse !== undefined) {
        const newGrievances = holderHouse.grievances.map((g) =>
          g.id === duel.grievanceId ? { ...g, resolved: true } : g,
        );
        const newHouses = new Map(workingState.houses);
        newHouses.set(holderHouseId, { ...holderHouse, grievances: newGrievances });
        workingState = { ...workingState, houses: newHouses };
      }
    }
    // P11: mirror the grievance flip onto any BloodFeud linked via triggeringGrievanceId.
    // resolutionKind derives from the duel outcome (challenger-perspective; player house
    // is the holder for BloodFeud grievances per the surfacing-phase write).
    const bloodFeudResolutionKind: "DuelWin" | "DuelLoss" =
      outcome === "ChallengerVictory" ? "DuelWin" : "DuelLoss";
    workingState = resolveBloodFeudByGrievance(
      workingState,
      duel.grievanceId,
      bloodFeudResolutionKind,
    );
  }

  // Write the resolved duel entity back to state.duels.
  const finalDuel: Duel = {
    ...duel,
    status: "Resolved",
    resolvedAtTick: workingState.tick,
    outcome,
    loserCasualty,
    exchangesElapsed: exchanges,
  };
  const newDuels = new Map(workingState.duels);
  newDuels.set(duel.id, finalDuel);
  workingState = { ...workingState, duels: newDuels };

  return { state: workingState, finalDuel, rngState };
}
