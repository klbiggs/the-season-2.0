// Marriage proposal pure-rule. Player-elected, tick-advancing. Follows the
// pre-tick action pattern from P3 (CLAUDE.md §10): pure rule first, then
// `advanceTickPure` from the store-action wrapper. Returns a discriminated
// outcome — `ok: true` for both accept and reject paths (both ARE outcomes,
// the action ran to completion); `ok: false` for predicate-failures.
//
// P23: two routes by the target's house class.
//   - Society house (INDEPENDENT or a minted soc-house-<n>): LOVE-MATCH —
//     affection-gated, acceptance slopes on affection (unchanged from P7).
//   - Rival house: POLITICAL ALLIANCE — no affection gate; a wealth dowry + a
//     hostility ceiling, acceptance slopes inversely on the rival's hostility.
//     Acceptance drops that rival's hostility (the alliance bond) + deducts the
//     dowry. The `CrossHouseMarriageNotSupported` rejection (P7 §10 Q16
//     deferral) is REMOVED.
//
// Atomic gating discipline (CLAUDE.md non-negotiable §5): validate → deduct
// → apply. Predicate-failure paths reject WITHOUT advancing tick OR RNG.
// Acceptance-roll paths ALWAYS advance RNG by exactly 1 regardless of outcome;
// resource deduction (dowry) happens ONLY on the acceptance path.
//
// Determinism budget:
//   - Predicate rejection: ZERO PRNG draws.
//   - Acceptance/roll-rejection: exactly 1 PRNG draw on PLAYER_HOUSE_ID's RNG.
//
// Plan: plans/phases/23-marriage-family-depth.md item A.

import {
  ADULTHOOD_AGE_IN_YEARS,
  AFFECTION_PROPOSAL_THRESHOLD,
  ALLIANCE_ACCEPTANCE_CEILING,
  ALLIANCE_ACCEPTANCE_FLOOR,
  ALLIANCE_DOWRY_WEALTH_COST,
  ALLIANCE_HOSTILITY_DROP,
  ALLIANCE_MAX_HOSTILITY,
  PROPOSAL_ACCEPTANCE_CEILING,
  PROPOSAL_ACCEPTANCE_FLOOR,
  PROPOSAL_REJECTION_SCANDAL_DELTA,
  PROPOSAL_REPUTATION_THRESHOLD,
} from "../constants";
import { makePairKey } from "../conversation/types";
import type { GameState, House, ProposalLogEntry } from "../entities";
import { RIVAL_HOUSE_IDS_SET, isSocietyHouse } from "../fixtures/rivals";
import {
  type CharacterId,
  type MarriageId,
  PLAYER_HOUSE_ID,
  type RngState,
  drawNext,
  getOrThrow,
} from "../rng";
import { clamp } from "../util/clamp";
import { mintMarriage } from "./mintMarriage";

export type ProposalRejection =
  | { kind: "TargetTooYoung" }
  | { kind: "TargetExiled" }
  | { kind: "TargetDead" }
  | { kind: "TargetAlreadyMarried" }
  | { kind: "TargetIsPlayerHead" }
  | { kind: "TargetIsSameHouse" }
  | { kind: "TargetHouseInvalid" } // neither society nor rival (defensive)
  | { kind: "TargetBetrothedToAnother" } // P23: target Pending-betrothed to a 3rd party
  | { kind: "RivalTooHostile"; current: number; max: number } // P23 alliance gate
  | { kind: "InsufficientWealthForDowry"; current: number; required: number } // P23 alliance gate
  | { kind: "TargetNotFound" }
  | { kind: "InsufficientAffection"; current: number; required: number }
  | { kind: "InsufficientReputation"; current: number; required: number }
  | { kind: "PlayerAlreadyMarried" }
  | { kind: "PlayerHeadDead" }
  | { kind: "PlayerExiled" }
  | { kind: "ElopementInProgress" }; // P9 Q4

export type ProposalOutcome =
  | {
      ok: true;
      accepted: true;
      via: "LoveMatch" | "Alliance"; // P23
      marriageId: MarriageId;
      spouseRoleFlipped: CharacterId;
      // P23 alliance-only annotations (undefined on the love-match path).
      allianceHostilityDrop?: number;
      dowryPaid?: number;
    }
  | { ok: true; accepted: false; scandalDelta: number }
  | { ok: false; reason: ProposalRejection };

export function applyProposalPure(
  state: GameState,
  targetCharacterId: CharacterId,
): { nextState: GameState; outcome: ProposalOutcome } {
  // ── Predicate gates: validate before any mutation ──
  // Gate 1: PlayerExiled.
  const playerHouse = state.houses.get(PLAYER_HOUSE_ID);
  if (playerHouse === undefined) {
    // Defensive — player house should always exist post-bootstrap.
    return { nextState: state, outcome: { ok: false, reason: { kind: "PlayerExiled" } } };
  }
  if (playerHouse.exiled) {
    return { nextState: state, outcome: { ok: false, reason: { kind: "PlayerExiled" } } };
  }
  // Gate 2: PlayerHeadDead.
  const playerHead = state.characters.get(playerHouse.headOfHouseCharacterId);
  if (playerHead === undefined || !playerHead.alive) {
    return { nextState: state, outcome: { ok: false, reason: { kind: "PlayerHeadDead" } } };
  }
  // Gate 3: TargetNotFound.
  const target = state.characters.get(targetCharacterId);
  if (target === undefined) {
    return { nextState: state, outcome: { ok: false, reason: { kind: "TargetNotFound" } } };
  }
  // Gate 4: TargetDead.
  if (!target.alive) {
    return { nextState: state, outcome: { ok: false, reason: { kind: "TargetDead" } } };
  }
  // Gate 5: TargetExiled.
  const targetHouse = state.houses.get(target.houseId);
  if (targetHouse?.exiled === true) {
    return { nextState: state, outcome: { ok: false, reason: { kind: "TargetExiled" } } };
  }
  // Gate 6: TargetIsPlayerHead.
  if (target.id === playerHead.id) {
    return { nextState: state, outcome: { ok: false, reason: { kind: "TargetIsPlayerHead" } } };
  }
  // Gate 7: TargetIsSameHouse (incest gate; covers player-house siblings + dependents).
  if (target.houseId === PLAYER_HOUSE_ID) {
    return { nextState: state, outcome: { ok: false, reason: { kind: "TargetIsSameHouse" } } };
  }
  // Gate 8 (P23): house-class routing. Society houses (INDEPENDENT + minted
  // soc-house-<n>) → love-match. Rival houses → political alliance. Neither →
  // defensive TargetHouseInvalid (no other house class exists at v1).
  const isRivalTarget = RIVAL_HOUSE_IDS_SET.has(target.houseId);
  const isSocietyTarget = isSocietyHouse(target.houseId);
  if (!isRivalTarget && !isSocietyTarget) {
    return { nextState: state, outcome: { ok: false, reason: { kind: "TargetHouseInvalid" } } };
  }
  // Gate 9: TargetTooYoung. Direct marriage is for adults; pre-adults pair via
  // a betrothal (arrangeBetrothal), not a direct proposal.
  if (target.age < ADULTHOOD_AGE_IN_YEARS) {
    return { nextState: state, outcome: { ok: false, reason: { kind: "TargetTooYoung" } } };
  }
  // Gate 9.5 (P23): TargetBetrothedToAnother. A target Pending-betrothed to a
  // third party can't be poached; honoring the existing betrothal is the path.
  for (const b of state.betrothals.values()) {
    if (b.status !== "Pending") continue;
    if (b.partyAId !== targetCharacterId && b.partyBId !== targetCharacterId) continue;
    const other = b.partyAId === targetCharacterId ? b.partyBId : b.partyAId;
    if (other !== playerHead.id) {
      return {
        nextState: state,
        outcome: { ok: false, reason: { kind: "TargetBetrothedToAnother" } },
      };
    }
  }
  // Gate 10: TargetAlreadyMarried.
  if (target.marriageId !== null) {
    const targetMarriage = state.marriages.get(target.marriageId);
    if (targetMarriage !== undefined && !targetMarriage.dissolved) {
      return { nextState: state, outcome: { ok: false, reason: { kind: "TargetAlreadyMarried" } } };
    }
  }
  // Gate 11: PlayerAlreadyMarried.
  if (playerHead.marriageId !== null) {
    const playerMarriage = state.marriages.get(playerHead.marriageId);
    if (playerMarriage !== undefined && !playerMarriage.dissolved) {
      return { nextState: state, outcome: { ok: false, reason: { kind: "PlayerAlreadyMarried" } } };
    }
  }
  // Gate 12: InsufficientReputation (applies to both routes).
  if (playerHouse.reputation < PROPOSAL_REPUTATION_THRESHOLD) {
    return {
      nextState: state,
      outcome: {
        ok: false,
        reason: {
          kind: "InsufficientReputation",
          current: playerHouse.reputation,
          required: PROPOSAL_REPUTATION_THRESHOLD,
        },
      },
    };
  }

  // ── Route-specific gates + acceptance slope ──
  let slope: number;
  if (isRivalTarget) {
    // Alliance gate A: rival hostility ceiling. targetHouse exists (gate 5
    // resolved it without the exiled flag; rivals are never exiled at v1).
    const rivalHostility = targetHouse?.hostility ?? 0;
    if (rivalHostility > ALLIANCE_MAX_HOSTILITY) {
      return {
        nextState: state,
        outcome: {
          ok: false,
          reason: { kind: "RivalTooHostile", current: rivalHostility, max: ALLIANCE_MAX_HOSTILITY },
        },
      };
    }
    // Alliance gate B: wealth dowry.
    if (playerHouse.wealth < ALLIANCE_DOWRY_WEALTH_COST) {
      return {
        nextState: state,
        outcome: {
          ok: false,
          reason: {
            kind: "InsufficientWealthForDowry",
            current: playerHouse.wealth,
            required: ALLIANCE_DOWRY_WEALTH_COST,
          },
        },
      };
    }
    // Acceptance slopes INVERSELY with hostility: a calmer rival is likelier to
    // accept the alliance. At hostility 0 → ceiling; at the ceiling → floor.
    slope = clamp(
      ALLIANCE_ACCEPTANCE_FLOOR +
        (1 - rivalHostility / ALLIANCE_MAX_HOSTILITY) *
          (ALLIANCE_ACCEPTANCE_CEILING - ALLIANCE_ACCEPTANCE_FLOOR),
      0,
      1,
    );
  } else {
    // Love-match gate 13: InsufficientAffection.
    const affectionKey = makePairKey(PLAYER_HOUSE_ID, targetCharacterId);
    const currentAffection = state.affectionMap.get(affectionKey) ?? 0;
    if (currentAffection < AFFECTION_PROPOSAL_THRESHOLD) {
      return {
        nextState: state,
        outcome: {
          ok: false,
          reason: {
            kind: "InsufficientAffection",
            current: currentAffection,
            required: AFFECTION_PROPOSAL_THRESHOLD,
          },
        },
      };
    }
    // Acceptance probability: floor + (affection - 80)/20 × (ceiling - floor).
    slope = clamp(
      PROPOSAL_ACCEPTANCE_FLOOR +
        ((currentAffection - AFFECTION_PROPOSAL_THRESHOLD) / 20) *
          (PROPOSAL_ACCEPTANCE_CEILING - PROPOSAL_ACCEPTANCE_FLOOR),
      0,
      1,
    );
  }

  // ── Gates pass. Single PRNG draw decides accept/reject. ──
  const rngState = getOrThrow(state.rng, PLAYER_HOUSE_ID);
  const { next: draw, rngState: rngAfter } = drawNext(rngState);
  const newRng = new Map(state.rng);
  newRng.set(PLAYER_HOUSE_ID, rngAfter);

  if (draw < slope) {
    // ── Accepted branch (shared mint via mintMarriage; target role flips to
    // Spouse inside the helper). ──
    const { nextState: minted, marriageId } = mintMarriage(
      state,
      playerHead.id,
      targetCharacterId,
      {
        viaElopement: false,
      },
    );

    const newProposalsLog = new Map(state.proposalsLog);
    const logEntry: ProposalLogEntry = {
      outcome: "Accepted",
      tick: state.tick,
      byCharacterId: playerHead.id,
    };
    newProposalsLog.set(targetCharacterId, logEntry);

    if (isRivalTarget) {
      // Deduct dowry from the player house + drop the rival's hostility (the
      // alliance bond). Both clamped at their mutation sites.
      const newHouses = new Map(minted.houses);
      const ph = newHouses.get(PLAYER_HOUSE_ID);
      if (ph !== undefined) {
        newHouses.set(PLAYER_HOUSE_ID, { ...ph, wealth: ph.wealth - ALLIANCE_DOWRY_WEALTH_COST });
      }
      const rh = newHouses.get(target.houseId);
      if (rh !== undefined) {
        newHouses.set(target.houseId, {
          ...rh,
          hostility: clamp(rh.hostility - ALLIANCE_HOSTILITY_DROP, 0, 100),
        });
      }
      const nextState: GameState = {
        ...minted,
        rng: newRng,
        houses: newHouses,
        proposalsLog: newProposalsLog,
      };
      return {
        nextState,
        outcome: {
          ok: true,
          accepted: true,
          via: "Alliance",
          marriageId,
          spouseRoleFlipped: target.id,
          allianceHostilityDrop: ALLIANCE_HOSTILITY_DROP,
          dowryPaid: ALLIANCE_DOWRY_WEALTH_COST,
        },
      };
    }

    const nextState: GameState = {
      ...minted,
      rng: newRng,
      proposalsLog: newProposalsLog,
    };
    return {
      nextState,
      outcome: {
        ok: true,
        accepted: true,
        via: "LoveMatch",
        marriageId,
        spouseRoleFlipped: target.id,
      },
    };
  }

  // ── Rejected-on-roll branch (both routes: +scandal, no dowry deduction). ──
  const newHouses = new Map(state.houses);
  newHouses.set(PLAYER_HOUSE_ID, {
    ...playerHouse,
    scandal: clamp(playerHouse.scandal + PROPOSAL_REJECTION_SCANDAL_DELTA, 0, 100),
  });

  const newProposalsLog = new Map(state.proposalsLog);
  const logEntry: ProposalLogEntry = {
    outcome: "Rejected",
    tick: state.tick,
    byCharacterId: playerHead.id,
  };
  newProposalsLog.set(targetCharacterId, logEntry);

  const nextState: GameState = {
    ...state,
    rng: newRng,
    houses: newHouses,
    proposalsLog: newProposalsLog,
  };
  return {
    nextState,
    outcome: { ok: true, accepted: false, scandalDelta: PROPOSAL_REJECTION_SCANDAL_DELTA },
  };
}

// Test-utility re-exports (House + RngState referenced for synthetic-state
// fixtures in proposal.test.ts).
export type { House, RngState };
