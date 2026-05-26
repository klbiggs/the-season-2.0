// P23: pre-adulthood betrothals (§10 Q17). A Betrothal pre-commits a player-
// house party and a cross-house party (society or rival) to a future marriage.
// Lifecycle: Pending → Honored (auto-mint at adulthood) | Broken (explicit
// break, or either party's death).
//
// arrange/break are player-elected FREE actions (no tick), gated at the store
// wrapper for modal state (PlayerExiled / ElopementInProgress) like assignTutor.
// applyBetrothalHonorStep is an RNG-free year-pass STEP.
//
// Plan: plans/phases/23-marriage-family-depth.md item B.

import {
  ADULTHOOD_AGE_IN_YEARS,
  ALLIANCE_HOSTILITY_DROP,
  BETROTHAL_BREAK_RIVAL_HOSTILITY_BUMP,
  BETROTHAL_BREAK_SCANDAL,
  PROPOSAL_REPUTATION_THRESHOLD,
} from "../constants";
import type { Betrothal, GameState } from "../entities";
import { makeBetrothalId } from "../fixtures/betrothalIdFactory";
import { RIVAL_HOUSE_IDS_SET } from "../fixtures/rivals";
import { type BetrothalId, type CharacterId, type MarriageId, PLAYER_HOUSE_ID } from "../rng";
import { clamp } from "../util/clamp";
import { mintMarriage } from "./mintMarriage";

export type ArrangeBetrothalRejection =
  | { kind: "PlayerExiled" }
  | { kind: "ElopementInProgress" }
  | { kind: "PartyNotFound" }
  | { kind: "PartyDead" }
  | { kind: "NotCrossHouse" } // need EXACTLY one party in the player house
  | { kind: "PartyAlreadyBetrothed" }
  | { kind: "PartyAlreadyMarried" }
  | { kind: "BothPartiesAdult" } // both adults → propose directly instead
  | { kind: "InsufficientReputation"; current: number; required: number };

export type BreakBetrothalRejection =
  | { kind: "PlayerExiled" }
  | { kind: "ElopementInProgress" }
  | { kind: "BetrothalNotFound" }
  | { kind: "BetrothalNotPending" };

function isUnmarried(state: GameState, marriageId: MarriageId | null): boolean {
  if (marriageId === null) return true;
  const m = state.marriages.get(marriageId);
  return m === undefined || m.dissolved;
}

function hasPendingBetrothal(state: GameState, charId: CharacterId): boolean {
  for (const b of state.betrothals.values()) {
    if (b.status !== "Pending") continue;
    if (b.partyAId === charId || b.partyBId === charId) return true;
  }
  return false;
}

export function applyArrangeBetrothalPure(
  state: GameState,
  partyAId: CharacterId,
  partyBId: CharacterId,
):
  | { ok: true; nextState: GameState; betrothalId: BetrothalId }
  | {
      ok: false;
      reason: ArrangeBetrothalRejection;
    } {
  const playerHouse = state.houses.get(PLAYER_HOUSE_ID);
  if (playerHouse === undefined || playerHouse.exiled) {
    return { ok: false, reason: { kind: "PlayerExiled" } };
  }
  const a = state.characters.get(partyAId);
  const b = state.characters.get(partyBId);
  if (a === undefined || b === undefined || partyAId === partyBId) {
    return { ok: false, reason: { kind: "PartyNotFound" } };
  }
  if (!a.alive || !b.alive) {
    return { ok: false, reason: { kind: "PartyDead" } };
  }
  // EXACTLY one party in the player house (the player betroths a kin member to
  // an outside party). Both-player = incest; neither-player = not theirs to arrange.
  const aPlayer = a.houseId === PLAYER_HOUSE_ID;
  const bPlayer = b.houseId === PLAYER_HOUSE_ID;
  if (aPlayer === bPlayer) {
    return { ok: false, reason: { kind: "NotCrossHouse" } };
  }
  if (hasPendingBetrothal(state, partyAId) || hasPendingBetrothal(state, partyBId)) {
    return { ok: false, reason: { kind: "PartyAlreadyBetrothed" } };
  }
  if (!isUnmarried(state, a.marriageId) || !isUnmarried(state, b.marriageId)) {
    return { ok: false, reason: { kind: "PartyAlreadyMarried" } };
  }
  // At least one party must be pre-adult; if both are adults, propose directly.
  if (a.age >= ADULTHOOD_AGE_IN_YEARS && b.age >= ADULTHOOD_AGE_IN_YEARS) {
    return { ok: false, reason: { kind: "BothPartiesAdult" } };
  }
  if (playerHouse.reputation < PROPOSAL_REPUTATION_THRESHOLD) {
    return {
      ok: false,
      reason: {
        kind: "InsufficientReputation",
        current: playerHouse.reputation,
        required: PROPOSAL_REPUTATION_THRESHOLD,
      },
    };
  }

  const betrothalId = makeBetrothalId(state, partyAId, partyBId);
  const [lex0, lex1]: [CharacterId, CharacterId] =
    partyAId < partyBId ? [partyAId, partyBId] : [partyBId, partyAId];
  const betrothal: Betrothal = {
    id: betrothalId,
    partyAId: lex0,
    partyBId: lex1,
    arrangedAtTick: state.tick,
    status: "Pending",
    resolvedAtTick: null,
    honoredMarriageId: null,
  };
  const betrothals = new Map(state.betrothals);
  betrothals.set(betrothalId, betrothal);
  return { ok: true, nextState: { ...state, betrothals }, betrothalId };
}

export function applyBreakBetrothalPure(
  state: GameState,
  betrothalId: BetrothalId,
): { ok: true; nextState: GameState } | { ok: false; reason: BreakBetrothalRejection } {
  const playerHouse = state.houses.get(PLAYER_HOUSE_ID);
  if (playerHouse === undefined || playerHouse.exiled) {
    return { ok: false, reason: { kind: "PlayerExiled" } };
  }
  const betrothal = state.betrothals.get(betrothalId);
  if (betrothal === undefined) {
    return { ok: false, reason: { kind: "BetrothalNotFound" } };
  }
  if (betrothal.status !== "Pending") {
    return { ok: false, reason: { kind: "BetrothalNotPending" } };
  }

  const betrothals = new Map(state.betrothals);
  betrothals.set(betrothalId, {
    ...betrothal,
    status: "Broken",
    resolvedAtTick: state.tick,
  });

  // +scandal on the player house; + a hostility bump on a jilted rival party.
  const houses = new Map(state.houses);
  const ph = houses.get(PLAYER_HOUSE_ID);
  if (ph !== undefined) {
    houses.set(PLAYER_HOUSE_ID, {
      ...ph,
      scandal: clamp(ph.scandal + BETROTHAL_BREAK_SCANDAL, 0, 100),
    });
  }
  // The non-player party: if they belong to a rival house, jilting bumps its hostility.
  const partyA = state.characters.get(betrothal.partyAId);
  const partyB = state.characters.get(betrothal.partyBId);
  const otherParty = partyA?.houseId === PLAYER_HOUSE_ID ? partyB : partyA;
  if (otherParty !== undefined && RIVAL_HOUSE_IDS_SET.has(otherParty.houseId)) {
    const rh = houses.get(otherParty.houseId);
    if (rh !== undefined) {
      houses.set(otherParty.houseId, {
        ...rh,
        hostility: clamp(rh.hostility + BETROTHAL_BREAK_RIVAL_HOSTILITY_BUMP, 0, 100),
      });
    }
  }

  return { ok: true, nextState: { ...state, betrothals, houses } };
}

// Year-pass STEP. RNG-free. Auto-mints a marriage for each Pending betrothal
// whose BOTH parties are alive adults and currently unmarried.
export function applyBetrothalHonorStep(state: GameState): GameState {
  let working = state;
  let touched = false;
  let betrothals: Map<BetrothalId, Betrothal> | null = null;

  for (const betrothalId of [...state.betrothals.keys()].sort()) {
    const betrothal = state.betrothals.get(betrothalId);
    if (betrothal === undefined || betrothal.status !== "Pending") continue;
    const a = working.characters.get(betrothal.partyAId);
    const b = working.characters.get(betrothal.partyBId);
    if (a === undefined || b === undefined || !a.alive || !b.alive) continue;
    if (a.age < ADULTHOOD_AGE_IN_YEARS || b.age < ADULTHOOD_AGE_IN_YEARS) continue;
    if (!isUnmarried(working, a.marriageId) || !isUnmarried(working, b.marriageId)) continue;

    // Initiator = the player-house party (keeps role); the other flips to Spouse.
    const playerParty = a.houseId === PLAYER_HOUSE_ID ? a : b;
    const otherParty = a.houseId === PLAYER_HOUSE_ID ? b : a;
    const { nextState: minted, marriageId } = mintMarriage(working, playerParty.id, otherParty.id, {
      viaElopement: false,
    });
    working = minted;

    // A betrothal honored into a rival house is an alliance — drop hostility.
    if (RIVAL_HOUSE_IDS_SET.has(otherParty.houseId)) {
      const houses = new Map(working.houses);
      const rh = houses.get(otherParty.houseId);
      if (rh !== undefined) {
        houses.set(otherParty.houseId, {
          ...rh,
          hostility: clamp(rh.hostility - ALLIANCE_HOSTILITY_DROP, 0, 100),
        });
        working = { ...working, houses };
      }
    }

    betrothals ??= new Map(state.betrothals);
    betrothals.set(betrothalId, {
      ...betrothal,
      status: "Honored",
      resolvedAtTick: state.tick,
      honoredMarriageId: marriageId,
    });
    touched = true;
  }

  if (!touched) return state;
  return { ...working, betrothals: betrothals ?? working.betrothals };
}
