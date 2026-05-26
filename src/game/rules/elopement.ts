// P9 pure rules: elopement sprint resolution.
//
// Per CLAUDE.md non-negotiable #1, this module imports only from constants,
// fixtures, rng, util, and other rules modules. Every function returns new
// state via hand-rolled shallow clones — no Immer inside src/game/rules/**.
//
// The Q3 verdict pins these semantics:
// - Win applies reputation-halve always.
// - Marriage minted ONLY when both eloping char and target are "available for
//   remarriage" (matches applyProposalPure gates 10/11: marriageId null OR
//   the referenced marriage is dissolved=true).
// - The win-time predicate re-reads aggressor + target via state.characters
//   at resolver entry (NOT cached at sprint-start) so same-tick proposeMarriage
//   races (per PHASES ordering contract) are observed.
//
// The Q4 verdict requires every player-elected mutation wrapper to gate on
// state.elopement === null. The store-action wrappers handle that — these
// pure rules are the only legal mutations while a sprint is active.

import {
  ELOPEMENT_FATHER_START_TILE,
  ELOPEMENT_FRESH_HORSES_MAX_USES,
  ELOPEMENT_FRESH_HORSES_PLAYER_ADVANCE,
  ELOPEMENT_FRESH_HORSES_WEALTH_COST,
  ELOPEMENT_LOSS_SCANDAL_DELTA,
  ELOPEMENT_PLAYER_START_TILE,
  ELOPEMENT_PUSH_COMPOSURE_COST,
  ELOPEMENT_PUSH_FATHER_ADVANCE,
  ELOPEMENT_PUSH_PLAYER_ADVANCE,
  ELOPEMENT_TRACK_LENGTH,
} from "../constants";
import type { Character, ElopementSprintState, GameState, House, Scheme } from "../entities";
import type { HouseId } from "../rng";
import { PLAYER_HOUSE_ID } from "../rng";
import { clamp } from "../util/clamp";
import { mintMarriage } from "./mintMarriage";

// ── Public helpers ────────────────────────────────────────────────────────

// Mirrors applyProposalPure's widow-remarriage semantics (proposal.ts:127-138):
// a character with a non-null marriageId pointing at a dissolved marriage IS
// available to re-marry. Q3 verdict requires harmonization.
export function isAvailableForRemarriage(c: Character, state: GameState): boolean {
  if (c.marriageId === null) return true;
  const m = state.marriages.get(c.marriageId);
  return m !== undefined && m.dissolved === true;
}

// ── Rejection unions ──────────────────────────────────────────────────────

export type ElopementActionRejection = { kind: "NoActiveSprint" };

export type ElopementFreshHorsesRejection =
  | { kind: "NoActiveSprint" }
  | { kind: "FreshHorsesExhausted" }
  | { kind: "InsufficientWealth"; have: number; need: number };

// ── Sprint mount (called from resolveSeduction's discovery branch) ────────

// Atomically applies the discovery-time scandal AND mounts state.elopement
// AND flips scheme status to Failed/Discovered. The previous resolveSeduction
// discovery body is now subsumed here — this is the SINGLE site applying the
// discovery scandal post-P9 (no double-firing).
//
// scandalDelta is computed by the CALLER (the temptation-discount branch
// lives in schemes.ts where the relevant constants are already imported).
// This helper applies the scandal AND mounts state.elopement; the CALLER is
// responsible for the scheme-status flip via flipSchemeStatus afterwards.
export function startElopementSprintFromDiscoveredSeduction(
  state: GameState,
  scheme: Scheme,
  scandalDelta: number,
): GameState {
  if (state.elopement !== null) {
    throw new Error(
      `startElopementSprintFromDiscoveredSeduction: state.elopement already non-null for scheme ${state.elopement.schemeId}; concurrent sprints unreachable per Q2 gate`,
    );
  }
  if (scheme.targetCharacterId === null) {
    throw new Error(
      `startElopementSprintFromDiscoveredSeduction: scheme ${scheme.id} has no targetCharacterId`,
    );
  }

  // Apply scandal to owner house.
  const newHouses = new Map(state.houses);
  const ownerHouse = newHouses.get(scheme.ownerHouseId);
  if (ownerHouse !== undefined) {
    newHouses.set(scheme.ownerHouseId, {
      ...ownerHouse,
      scandal: clamp(ownerHouse.scandal + scandalDelta, 0, 100),
    });
  }

  // Mount sprint state.
  const sprint: ElopementSprintState = {
    schemeId: scheme.id,
    elopingCharacterId: scheme.aggressorCharacterId,
    targetCharacterId: scheme.targetCharacterId,
    playerTilePosition: ELOPEMENT_PLAYER_START_TILE,
    fatherTilePosition: ELOPEMENT_FATHER_START_TILE,
    freshHorsesUsedCount: 0,
    startedAtTick: state.tick,
  };

  return { ...state, houses: newHouses, elopement: sprint };
}

// ── Push ──────────────────────────────────────────────────────────────────

export function applyElopementPushPure(
  state: GameState,
): GameState | { ok: false; reason: ElopementActionRejection } {
  if (state.elopement === null) {
    return { ok: false, reason: { kind: "NoActiveSprint" } };
  }
  const sprint = state.elopement;
  const newPlayerTile = clamp(
    sprint.playerTilePosition + ELOPEMENT_PUSH_PLAYER_ADVANCE,
    0,
    ELOPEMENT_TRACK_LENGTH,
  );
  const newFatherTile = clamp(
    sprint.fatherTilePosition + ELOPEMENT_PUSH_FATHER_ADVANCE,
    0,
    ELOPEMENT_TRACK_LENGTH,
  );

  // Composure cost on the eloping character (clamped at 0).
  const newChars = new Map(state.characters);
  const elopingChar = newChars.get(sprint.elopingCharacterId);
  let postComposure = elopingChar?.composure ?? 0;
  if (elopingChar !== undefined) {
    postComposure = clamp(
      elopingChar.composure - ELOPEMENT_PUSH_COMPOSURE_COST,
      0,
      elopingChar.maxComposure,
    );
    newChars.set(sprint.elopingCharacterId, { ...elopingChar, composure: postComposure });
  }

  const advancedSprint: ElopementSprintState = {
    ...sprint,
    playerTilePosition: newPlayerTile,
    fatherTilePosition: newFatherTile,
  };
  const advanced: GameState = {
    ...state,
    characters: newChars,
    elopement: advancedSprint,
  };

  // Terminal checks (in priority order):
  //   1. Player at finish line → Win.
  //   2. Father at finish line → Lost.
  //   3. Eloping character composure depleted → Lost.
  if (newPlayerTile === ELOPEMENT_TRACK_LENGTH) {
    return resolveElopementTerminal(advanced, "Won");
  }
  if (newFatherTile === ELOPEMENT_TRACK_LENGTH || postComposure === 0) {
    return resolveElopementTerminal(advanced, "Lost");
  }
  return advanced;
}

// ── Fresh Horses ──────────────────────────────────────────────────────────

export function applyElopementFreshHorsesPure(
  state: GameState,
): GameState | { ok: false; reason: ElopementFreshHorsesRejection } {
  if (state.elopement === null) {
    return { ok: false, reason: { kind: "NoActiveSprint" } };
  }
  const sprint = state.elopement;
  if (sprint.freshHorsesUsedCount >= ELOPEMENT_FRESH_HORSES_MAX_USES) {
    return { ok: false, reason: { kind: "FreshHorsesExhausted" } };
  }
  const playerHouse = state.houses.get(PLAYER_HOUSE_ID);
  if (playerHouse === undefined) {
    throw new Error("applyElopementFreshHorsesPure: PLAYER_HOUSE_ID not in state.houses");
  }
  if (playerHouse.wealth < ELOPEMENT_FRESH_HORSES_WEALTH_COST) {
    return {
      ok: false,
      reason: {
        kind: "InsufficientWealth",
        have: playerHouse.wealth,
        need: ELOPEMENT_FRESH_HORSES_WEALTH_COST,
      },
    };
  }

  // Mutate: tile + uses count + wealth (wealth unbounded per spec §3).
  const newPlayerTile = clamp(
    sprint.playerTilePosition + ELOPEMENT_FRESH_HORSES_PLAYER_ADVANCE,
    0,
    ELOPEMENT_TRACK_LENGTH,
  );
  const newHouses = new Map(state.houses);
  newHouses.set(PLAYER_HOUSE_ID, {
    ...playerHouse,
    wealth: playerHouse.wealth - ELOPEMENT_FRESH_HORSES_WEALTH_COST,
  });
  const advancedSprint: ElopementSprintState = {
    ...sprint,
    playerTilePosition: newPlayerTile,
    freshHorsesUsedCount: sprint.freshHorsesUsedCount + 1,
  };
  const advanced: GameState = {
    ...state,
    houses: newHouses,
    elopement: advancedSprint,
  };

  // Terminal: Fresh Horses can only advance the PLAYER's tile. If the player
  // hits 7, Won. The father did not advance — no Lost branch here.
  if (newPlayerTile === ELOPEMENT_TRACK_LENGTH) {
    return resolveElopementTerminal(advanced, "Won");
  }
  return advanced;
}

// ── Surrender ─────────────────────────────────────────────────────────────

// Surrender is always reachable when a sprint is active; the caller (store
// wrapper) gates `state.elopement !== null` and throws if false. Surrender
// folds into the Lost outcome (spec §3 line 377 — no separate "Surrendered").
export function applyElopementSurrenderPure(state: GameState): GameState {
  if (state.elopement === null) {
    throw new Error("applyElopementSurrenderPure: state.elopement is null");
  }
  const sprint = state.elopement;
  const surrenderedSprint: ElopementSprintState = {
    ...sprint,
    fatherTilePosition: ELOPEMENT_TRACK_LENGTH,
  };
  const advanced: GameState = { ...state, elopement: surrenderedSprint };
  return resolveElopementTerminal(advanced, "Lost");
}

// ── Terminal resolver ────────────────────────────────────────────────────

// Applies the terminal effect atomically AND nulls state.elopement.
//   Won  → reputation halved (clamped [0, 100]); if both eloping char and
//          target are available for remarriage (Q3 verdict harmonization with
//          applyProposalPure gates 10/11), mints a MarriageRecord with
//          viaElopement: true.
//   Lost → +50 scandal on player house (clamped [0, 100]).
// In either case, state.elopement is set to null on return.
export function resolveElopementTerminal(state: GameState, outcome: "Won" | "Lost"): GameState {
  if (state.elopement === null) {
    throw new Error("resolveElopementTerminal: state.elopement is null");
  }
  const sprint = state.elopement;
  const newHouses = new Map(state.houses);
  const playerHouse = newHouses.get(PLAYER_HOUSE_ID);
  if (playerHouse === undefined) {
    throw new Error("resolveElopementTerminal: PLAYER_HOUSE_ID not in state.houses");
  }

  if (outcome === "Lost") {
    newHouses.set(PLAYER_HOUSE_ID, {
      ...playerHouse,
      scandal: clamp(playerHouse.scandal + ELOPEMENT_LOSS_SCANDAL_DELTA, 0, 100),
    });
    return { ...state, houses: newHouses, elopement: null };
  }

  // Won branch.
  newHouses.set(PLAYER_HOUSE_ID, {
    ...playerHouse,
    reputation: clamp(Math.floor(playerHouse.reputation / 2), 0, 100),
  });

  // Re-read aggressor + target via state.characters at this moment (NOT
  // cached at sprint-start) — Q3 verdict's same-tick proposeMarriage contract.
  const aggressor = state.characters.get(sprint.elopingCharacterId);
  const target = state.characters.get(sprint.targetCharacterId);

  // Defensive fall-through: if either party died between sprint-start and
  // win-time (unreachable today per pruneOrphanedConversationKeys branch 5,
  // but matches selectAggressor's defense-in-depth discipline), skip mint
  // and return rep-halved + null elopement.
  if (aggressor === undefined || target === undefined || !aggressor.alive || !target.alive) {
    return { ...state, houses: newHouses, elopement: null };
  }

  // Marriage-mint predicate harmonized with applyProposalPure widow-remarriage
  // semantics (proposal.ts:127-138 + Q3 verdict).
  if (isAvailableForRemarriage(aggressor, state) && isAvailableForRemarriage(target, state)) {
    return mintMarriageAndCommit(state, newHouses, aggressor, target);
  }

  // Win-without-union: one of the parties is in an Active marriage; rep-halve
  // applies, no marriage minted, sprint cleared.
  return { ...state, houses: newHouses, elopement: null };
}

// Internal helper — mints the viaElopement marriage via the shared P23
// mintMarriage core (id + record + both marriageId + target role flip), then
// layers the elopement-specific bits: the rep-halved houses + elopement: null.
// Opts out of Dull-exposure to preserve pre-P23 elopement behavior (an
// elopement union does not seed a Dull-spouse temptation latch).
function mintMarriageAndCommit(
  state: GameState,
  newHouses: Map<HouseId, House>,
  aggressor: Character,
  target: Character,
): GameState {
  const { nextState } = mintMarriage(state, aggressor.id, target.id, {
    viaElopement: true,
    applyDullExposure: false,
  });
  return { ...nextState, houses: newHouses, elopement: null };
}
