// P25 R4: player-diplomacy free actions — withdraw a grievance (non-duel
// resolution), extend an olive branch (pay to cool a rival), or declare war
// (provoke a rival). All pure rules returning a typed envelope; the store
// wrappers compose overwriteFromGameState + direct-publish on grievancesBus.

import {
  DECLARE_WAR_HOSTILITY_BUMP,
  DECLARE_WAR_SCANDAL_COST,
  DECLARE_WAR_TENSION_BUMP,
  FACTION_TENSION_CAP,
  OLIVE_BRANCH_HOSTILITY_DROP,
  OLIVE_BRANCH_WEALTH_COST,
  WITHDRAW_GRIEVANCE_HOSTILITY_DROP,
} from "../constants";
import type { GameState } from "../entities";
import { PLAYER_FACTION_ID, makeFactionPairKey } from "../fixtures/factions";
import { RIVAL_HOUSE_IDS_SET } from "../fixtures/rivals";
import { type GrievanceId, type HouseId, PLAYER_HOUSE_ID } from "../rng";
import { clamp } from "../util/clamp";
import { hasActivePlayerElopement } from "./elopement";
import { resolveBloodFeudByGrievance } from "./inheritedSecrets";

export type WithdrawGrievanceRejection =
  | { kind: "PlayerExiled" }
  | { kind: "ElopementInProgress" }
  | { kind: "GrievanceNotFound" }
  | { kind: "GrievanceAlreadyResolved" };

export type OliveBranchRejection =
  | { kind: "PlayerExiled" }
  | { kind: "ElopementInProgress" }
  | { kind: "NotARivalHouse" }
  | { kind: "InsufficientWealth"; have: number; need: number };

export type DeclareWarRejection =
  | { kind: "PlayerExiled" }
  | { kind: "ElopementInProgress" }
  | { kind: "NotARivalHouse" };

type Envelope<R> = { ok: true; nextState: GameState } | { ok: false; reason: R };

function playerModalGate(
  state: GameState,
): { kind: "PlayerExiled" } | { kind: "ElopementInProgress" } | null {
  if (state.houses.get(PLAYER_HOUSE_ID)?.exiled === true) return { kind: "PlayerExiled" };
  if (hasActivePlayerElopement(state)) return { kind: "ElopementInProgress" };
  return null;
}

// Withdraw a player-held grievance (flip resolved) + cool the perpetrator rival
// + resolve any blood feud backed by that grievance ("Withdrawn").
export function applyWithdrawGrievance(
  state: GameState,
  grievanceId: GrievanceId,
): Envelope<WithdrawGrievanceRejection> {
  const gate = playerModalGate(state);
  if (gate !== null) return { ok: false, reason: gate };
  const playerHouse = state.houses.get(PLAYER_HOUSE_ID);
  if (playerHouse === undefined) return { ok: false, reason: { kind: "GrievanceNotFound" } };
  const grievance = playerHouse.grievances.find((g) => g.id === grievanceId);
  if (grievance === undefined) return { ok: false, reason: { kind: "GrievanceNotFound" } };
  if (grievance.resolved) return { ok: false, reason: { kind: "GrievanceAlreadyResolved" } };

  const newHouses = new Map(state.houses);
  newHouses.set(PLAYER_HOUSE_ID, {
    ...playerHouse,
    grievances: playerHouse.grievances.map((g) =>
      g.id === grievanceId ? { ...g, resolved: true } : g,
    ),
  });
  // Cool the perpetrator rival's hostility (the perpetrator is who the player
  // holds the grievance against).
  const perp = newHouses.get(grievance.perpetratorHouseId);
  if (perp !== undefined) {
    newHouses.set(grievance.perpetratorHouseId, {
      ...perp,
      hostility: clamp(perp.hostility + WITHDRAW_GRIEVANCE_HOSTILITY_DROP, 0, 100),
    });
  }
  // Resolve any linked blood feud (grievances-bus owned; distinct from the duel path).
  const withFeud = resolveBloodFeudByGrievance(
    { ...state, houses: newHouses },
    grievanceId,
    "Withdrawn",
  );
  return { ok: true, nextState: withFeud };
}

export function applyExtendOliveBranch(
  state: GameState,
  rivalHouseId: HouseId,
): Envelope<OliveBranchRejection> {
  const gate = playerModalGate(state);
  if (gate !== null) return { ok: false, reason: gate };
  if (!RIVAL_HOUSE_IDS_SET.has(rivalHouseId)) {
    return { ok: false, reason: { kind: "NotARivalHouse" } };
  }
  const playerHouse = state.houses.get(PLAYER_HOUSE_ID);
  const rival = state.houses.get(rivalHouseId);
  if (playerHouse === undefined || rival === undefined) {
    return { ok: false, reason: { kind: "NotARivalHouse" } };
  }
  if (playerHouse.wealth < OLIVE_BRANCH_WEALTH_COST) {
    return {
      ok: false,
      reason: {
        kind: "InsufficientWealth",
        have: playerHouse.wealth,
        need: OLIVE_BRANCH_WEALTH_COST,
      },
    };
  }
  const newHouses = new Map(state.houses);
  newHouses.set(PLAYER_HOUSE_ID, {
    ...playerHouse,
    wealth: playerHouse.wealth - OLIVE_BRANCH_WEALTH_COST,
  });
  newHouses.set(rivalHouseId, {
    ...rival,
    hostility: clamp(rival.hostility + OLIVE_BRANCH_HOSTILITY_DROP, 0, 100),
  });
  return { ok: true, nextState: { ...state, houses: newHouses } };
}

export function applyDeclareWar(
  state: GameState,
  rivalHouseId: HouseId,
): Envelope<DeclareWarRejection> {
  const gate = playerModalGate(state);
  if (gate !== null) return { ok: false, reason: gate };
  if (!RIVAL_HOUSE_IDS_SET.has(rivalHouseId)) {
    return { ok: false, reason: { kind: "NotARivalHouse" } };
  }
  const playerHouse = state.houses.get(PLAYER_HOUSE_ID);
  const rival = state.houses.get(rivalHouseId);
  if (playerHouse === undefined || rival === undefined) {
    return { ok: false, reason: { kind: "NotARivalHouse" } };
  }
  const newHouses = new Map(state.houses);
  newHouses.set(PLAYER_HOUSE_ID, {
    ...playerHouse,
    scandal: clamp(playerHouse.scandal + DECLARE_WAR_SCANDAL_COST, 0, 100),
  });
  newHouses.set(rivalHouseId, {
    ...rival,
    hostility: clamp(rival.hostility + DECLARE_WAR_HOSTILITY_BUMP, 0, 100),
  });
  // Display-only tension bump on the (crown, rivalFaction) pair. Crown pairs are
  // excluded from rival action weighting, so this feeds the numeric matrix + the
  // R8 viz only — NOT rival AI (the hostility bump is the behavioral lever).
  const pairKey = makeFactionPairKey(PLAYER_FACTION_ID, rival.factionId);
  const newTensions = new Map(state.factionTensions);
  const current = newTensions.get(pairKey) ?? 0;
  newTensions.set(pairKey, clamp(current + DECLARE_WAR_TENSION_BUMP, 0, FACTION_TENSION_CAP));
  return { ok: true, nextState: { ...state, houses: newHouses, factionTensions: newTensions } };
}
