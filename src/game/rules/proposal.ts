// Marriage proposal pure-rule. Player-elected, tick-advancing. Follows the
// pre-tick action pattern from P3 (CLAUDE.md §10): pure rule first, then
// `advanceTickPure` from the store-action wrapper. Returns a discriminated
// outcome — `ok: true` for both accept and reject paths (both ARE outcomes,
// the action ran to completion); `ok: false` for predicate-failures (gates
// 1-13).
//
// Atomic gating discipline (CLAUDE.md non-negotiable §5): validate → deduct
// → apply. Predicate-failure paths (gates 1-13) reject WITHOUT advancing
// tick OR RNG. Acceptance-roll paths (gates pass, draw decides) ALWAYS
// advance RNG by exactly 1 regardless of accept/reject outcome.
//
// Determinism budget:
//   - Predicate rejection (gates 1-13 fail): ZERO PRNG draws.
//   - Acceptance/roll-rejection: exactly 1 PRNG draw on PLAYER_HOUSE_ID's RNG.
//
// Plan: plans/phases/07-family-succession.md "Proposal action".

import {
  ADULTHOOD_AGE_IN_YEARS,
  AFFECTION_PROPOSAL_THRESHOLD,
  HAPPINESS_INITIAL,
  PROPOSAL_ACCEPTANCE_CEILING,
  PROPOSAL_ACCEPTANCE_FLOOR,
  PROPOSAL_REJECTION_SCANDAL_DELTA,
  PROPOSAL_REPUTATION_THRESHOLD,
} from "../constants";
import { makePairKey } from "../conversation/types";
import type { Character, GameState, House, MarriageRecord, ProposalLogEntry } from "../entities";
import { makeMarriageId } from "../fixtures/marriageIdFactory";
import {
  type CharacterId,
  INDEPENDENT_HOUSE_ID,
  type MarriageId,
  PLAYER_HOUSE_ID,
  type RngState,
  drawNext,
  getOrThrow,
} from "../rng";
import type { TraitId } from "../rng";

export type ProposalRejection =
  | { kind: "TargetTooYoung" }
  | { kind: "TargetExiled" }
  | { kind: "TargetDead" }
  | { kind: "TargetAlreadyMarried" }
  | { kind: "TargetIsPlayerHead" }
  | { kind: "TargetIsSameHouse" }
  | { kind: "CrossHouseMarriageNotSupported" }
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
      marriageId: MarriageId;
      spouseRoleFlipped: CharacterId;
    }
  | { ok: true; accepted: false; scandalDelta: number }
  | { ok: false; reason: ProposalRejection };

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function applyProposalPure(
  state: GameState,
  targetCharacterId: CharacterId,
): { nextState: GameState; outcome: ProposalOutcome } {
  // ── Predicate gates 1-13: validate before any mutation ──
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
  // Gate 8: CrossHouseMarriageNotSupported (§10 Q16 deferral). At v1 the
  // only permitted target-house is INDEPENDENT; future rival houses (P8) will
  // need explicit handling. The gate-7-first ordering means "incest gate first;
  // cross-house gate covers the residual non-player non-Independent space".
  if (target.houseId !== INDEPENDENT_HOUSE_ID) {
    return {
      nextState: state,
      outcome: { ok: false, reason: { kind: "CrossHouseMarriageNotSupported" } },
    };
  }
  // Gate 9: TargetTooYoung (§10 Q17 deferral).
  if (target.age < ADULTHOOD_AGE_IN_YEARS) {
    return { nextState: state, outcome: { ok: false, reason: { kind: "TargetTooYoung" } } };
  }
  // Gate 10: TargetAlreadyMarried.
  if (target.marriageId !== null) {
    const targetMarriage = state.marriages.get(target.marriageId);
    if (targetMarriage !== undefined && !targetMarriage.dissolved) {
      return { nextState: state, outcome: { ok: false, reason: { kind: "TargetAlreadyMarried" } } };
    }
  }
  // Gate 11: PlayerAlreadyMarried (degenerate at v1 fresh state; future-phase
  // safety once heirs marry pre-succession).
  if (playerHead.marriageId !== null) {
    const playerMarriage = state.marriages.get(playerHead.marriageId);
    if (playerMarriage !== undefined && !playerMarriage.dissolved) {
      return { nextState: state, outcome: { ok: false, reason: { kind: "PlayerAlreadyMarried" } } };
    }
  }
  // Gate 12: InsufficientReputation.
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
  // Gate 13: InsufficientAffection.
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

  // ── Gates pass. Single PRNG draw decides accept/reject. ──
  const rngState = getOrThrow(state.rng, PLAYER_HOUSE_ID);
  const { next: draw, rngState: rngAfter } = drawNext(rngState);
  // Acceptance probability: floor + (affection - 80)/20 × (ceiling - floor).
  // At affection=80, slope = 0.5; at affection=100, slope = 0.95. The clamp
  // is defensive dead code in the [80, 100] affection domain (max 0.95).
  const slope = clamp(
    PROPOSAL_ACCEPTANCE_FLOOR +
      ((currentAffection - AFFECTION_PROPOSAL_THRESHOLD) / 20) *
        (PROPOSAL_ACCEPTANCE_CEILING - PROPOSAL_ACCEPTANCE_FLOOR),
    0,
    1,
  );

  const newRng = new Map(state.rng);
  newRng.set(PLAYER_HOUSE_ID, rngAfter);

  if (draw < slope) {
    // ── Accepted branch ──
    const marriageId = makeMarriageId(state, playerHead.id, targetCharacterId);
    const [lex0, lex1] =
      playerHead.id < targetCharacterId
        ? [playerHead.id, targetCharacterId]
        : [targetCharacterId, playerHead.id];
    const newMarriage: MarriageRecord = {
      id: marriageId,
      spouseAId: lex0,
      spouseBId: lex1,
      marriedAtTick: state.tick,
      dissolved: false,
      dissolvedAtTick: null,
      // Player-elected proposal mints a non-elopement marriage. The elopement
      // win branch (resolveElopementTerminal in rules/elopement.ts) sets true.
      viaElopement: false,
    };
    const newMarriages = new Map(state.marriages);
    newMarriages.set(marriageId, newMarriage);

    // Update both spouses' marriageId. Target also flips role:
    //   - Spinster/Dependent → Spouse
    //   - others (already-married widows, etc.) keep their role
    // Player head's role stays HeadOfHouse.
    const newChars = new Map(state.characters);
    const targetRole =
      target.role === "Spinster" || target.role === "Dependent" ? "Spouse" : target.role;
    const targetUpdated: Character = {
      ...target,
      role: targetRole,
      marriageId,
    };
    const playerUpdated: Character = {
      ...playerHead,
      marriageId,
    };

    // Dull-trait exposure detection. If the player head carries Dull, the
    // target's exposure tick is set. If the target carries Dull, the player's
    // exposure tick is set. Mutual Dull → both get exposure ticks. Happiness
    // stays at current value (HAPPINESS_INITIAL on first marriage).
    const playerDull = playerHead.traits.includes("Dull" as TraitId);
    const targetDull = target.traits.includes("Dull" as TraitId);
    if (playerDull) {
      targetUpdated.dullSpouseExposureStartTick = state.tick;
    }
    if (targetDull) {
      playerUpdated.dullSpouseExposureStartTick = state.tick;
    }
    // Defensive — if either character was previously single, ensure happiness
    // sits at the initial value (no-op for fresh-state characters).
    if (targetUpdated.happiness === 0) targetUpdated.happiness = HAPPINESS_INITIAL;
    if (playerUpdated.happiness === 0) playerUpdated.happiness = HAPPINESS_INITIAL;

    newChars.set(target.id, targetUpdated);
    newChars.set(playerHead.id, playerUpdated);

    const newProposalsLog = new Map(state.proposalsLog);
    const logEntry: ProposalLogEntry = {
      outcome: "Accepted",
      tick: state.tick,
      byCharacterId: playerHead.id,
    };
    newProposalsLog.set(targetCharacterId, logEntry);

    const nextState: GameState = {
      ...state,
      rng: newRng,
      characters: newChars,
      marriages: newMarriages,
      proposalsLog: newProposalsLog,
    };
    return {
      nextState,
      outcome: {
        ok: true,
        accepted: true,
        marriageId,
        spouseRoleFlipped: target.id,
      },
    };
  }

  // ── Rejected-on-roll branch ──
  // Apply +5 scandal to player house (clamped [0, 100]).
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
