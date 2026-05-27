// P11 sibling-rivals rule layer. Two responsibilities:
//   (1) Year-pass STEPS slot 4: promote eligible adult siblings of the new heir
//       into autonomous-actor entities on `playerHouse.siblingRivals`.
//   (2) Tick-phase slot 12 (`applySiblingRivalActionPhase`): per-cooldown-eligible
//       actor, draw a weighted action and dispatch its mutation; bump cooldown
//       and decay hostility per CLAUDE.md "cooldown burns on ALL outcomes".
//
// Pure: no side effects, no Immer, no bus.publish. Returns new state via
// hand-rolled shallow Map clones + spread per CLAUDE.md non-negotiable §1.
//
// Plan: plans/phases/11-sibling-rivals-secrets.md

import {
  SIBLING_RIVAL_ACTION_COOLDOWN_TICKS,
  SIBLING_RIVAL_ACTION_WEIGHTS,
  SIBLING_RIVAL_GAMBLING_DEBT_WEALTH_DRAIN,
  SIBLING_RIVAL_HOSTILITY_MAX,
  SIBLING_RIVAL_HOSTILITY_MIN,
  SIBLING_RIVAL_HOSTILITY_PER_ACTION,
  SIBLING_RIVAL_HOSTILITY_PER_FAILED_RECONCILIATION,
  SIBLING_RIVAL_PETTY_SABOTAGE_REPUTATION_DRAIN,
  SIBLING_RIVAL_PROMOTION_BASELINE_HOSTILITY,
  SIBLING_RIVAL_RECONCILIATION_REPUTATION_COST,
  SIBLING_RIVAL_RECONCILIATION_SUCCESS_AT_HOSTILITY_0,
  SIBLING_RIVAL_RECONCILIATION_SUCCESS_AT_HOSTILITY_100,
  SIBLING_RIVAL_RECONCILIATION_WEALTH_COST,
  SIBLING_RIVAL_TRAIT_HOSTILITY_AMBITIOUS,
  SIBLING_RIVAL_TRAIT_HOSTILITY_CUNNING,
  SIBLING_RIVAL_TRAIT_HOSTILITY_JADED,
  SIBLING_RIVAL_TRAIT_HOSTILITY_PIOUS,
  type SiblingRivalActionKind,
} from "../constants";
import type { Character, House, SiblingRivalState, Whisper } from "../entities";
import type { GameState } from "../entities";
import {
  type CharacterId,
  type HouseId,
  PLAYER_HOUSE_ID,
  type SiblingRivalActorId,
  type WhisperId,
  drawNext,
} from "../rng";
import { hasActivePlayerElopement } from "./elopement";
import { tryStartScheme } from "./schemes";

// ── Adulthood predicate (resolves cycle-2-iter-2 R5 — `isAdult` is exported here).
const ADULTHOOD_AGE_IN_YEARS = 18;
export function isAdult(c: Character): boolean {
  return c.age >= ADULTHOOD_AGE_IN_YEARS;
}

// ── isSiblingOf — genealogical predicate (resolves cycle-2-iter-2 B2).
// Returns true iff both characters have non-null parentCharacterIds AND share
// at least one parent id. First-generation NPCs (parentCharacterIds === null)
// are vacuously NOT siblings of anyone.
export function isSiblingOf(
  candidate: Character,
  heirId: CharacterId,
  characters: ReadonlyMap<CharacterId, Character>,
): boolean {
  const heir = characters.get(heirId);
  if (heir === undefined) return false;
  if (candidate.parentCharacterIds === null) return false;
  if (heir.parentCharacterIds === null) return false;
  const [pA, pB] = candidate.parentCharacterIds;
  const [hA, hB] = heir.parentCharacterIds;
  return pA === hA || pA === hB || pB === hA || pB === hB;
}

// ── deriveInitialHostility — trait-modified baseline (resolves cycle-2-iter-7 B1).
export function deriveInitialHostility(c: Character): number {
  let h = SIBLING_RIVAL_PROMOTION_BASELINE_HOSTILITY;
  if (c.traits.includes("Jaded" as Character["traits"][number])) {
    h += SIBLING_RIVAL_TRAIT_HOSTILITY_JADED;
  }
  if (c.traits.includes("Ambitious" as Character["traits"][number])) {
    h += SIBLING_RIVAL_TRAIT_HOSTILITY_AMBITIOUS;
  }
  if (c.traits.includes("Cunning" as Character["traits"][number])) {
    h += SIBLING_RIVAL_TRAIT_HOSTILITY_CUNNING;
  }
  if (c.traits.includes("Pious" as Character["traits"][number])) {
    h += SIBLING_RIVAL_TRAIT_HOSTILITY_PIOUS;
  }
  return Math.max(1, Math.min(SIBLING_RIVAL_HOSTILITY_MAX, h));
}

// ── Promotion (year-pass STEPS slot 4) ─────────────────────────────────────
// Closure factory: runYearPassPure captures pre-succession heads ONCE per
// year-pass, then builds the promotion step that closes over the snapshot.
// Step signature `(state) => state` stays uniform with the other STEPS.
export function buildSiblingRivalPromotionStep(
  preSuccessionHeads: ReadonlyMap<HouseId, CharacterId>,
): (state: GameState) => GameState {
  return (state: GameState): GameState => {
    const playerHouse = state.houses.get(PLAYER_HOUSE_ID);
    if (playerHouse === undefined) return state;
    const deadHeadId = preSuccessionHeads.get(PLAYER_HOUSE_ID);
    const currentHeadId = playerHouse.headOfHouseCharacterId;
    if (deadHeadId === undefined) return state; // no pre-succession record
    if (deadHeadId === currentHeadId) return state; // no succession happened
    return promoteEligibleSiblingsAtSuccession(state, deadHeadId, currentHeadId);
  };
}

// Pure helper: promote every eligible sibling of the new heir.
// Eligible = alive + adult + in player house + not the new heir + not the
// dead head + genealogical sibling of the new heir (per isSiblingOf).
export function promoteEligibleSiblingsAtSuccession(
  state: GameState,
  deadHeadId: CharacterId,
  newHeirId: CharacterId,
): GameState {
  const playerHouse = state.houses.get(PLAYER_HOUSE_ID);
  if (playerHouse === undefined) return state;

  // Lex-sort the candidate ids for deterministic promotion order (CLAUDE.md
  // "Lex-sort iteration over identifier Maps").
  const candidateIds = [...state.characters.keys()].sort();
  const newPromotions: SiblingRivalState[] = [];
  const existingActorCharIds = new Set(playerHouse.siblingRivals.map((sr) => sr.characterId));

  for (const id of candidateIds) {
    if (id === newHeirId || id === deadHeadId) continue;
    if (existingActorCharIds.has(id)) continue; // already promoted previously
    const c = state.characters.get(id);
    if (c === undefined || !c.alive) continue;
    if (c.houseId !== PLAYER_HOUSE_ID) continue;
    if (!isAdult(c)) continue;
    if (!isSiblingOf(c, newHeirId, state.characters)) continue;

    newPromotions.push({
      id: `siblingRival-${id}` as SiblingRivalActorId,
      characterId: id,
      hostility: deriveInitialHostility(c),
      lastActionTick: state.tick,
      reconciled: false,
      promotedAtTick: state.tick,
    });
  }

  if (newPromotions.length === 0) return state;

  const newHouses = new Map(state.houses);
  newHouses.set(PLAYER_HOUSE_ID, {
    ...playerHouse,
    siblingRivals: [...playerHouse.siblingRivals, ...newPromotions],
  });
  return { ...state, houses: newHouses };
}

// ── Tick-phase action loop (PHASES slot 12) ────────────────────────────────
// Cumulative scaled weights for pickSiblingActionByScaledWeight.
function computeCumulativeSiblingWeights(): readonly [number, number, number, number] {
  const w = SIBLING_RIVAL_ACTION_WEIGHTS;
  return [
    w.GamblingDebt,
    w.GamblingDebt + w.LeakSecret,
    w.GamblingDebt + w.LeakSecret + w.PettySabotage,
    w.GamblingDebt + w.LeakSecret + w.PettySabotage + w.AutoSabotageScheme,
  ];
}

function pickSiblingActionByScaledWeight(
  cumulative: readonly [number, number, number, number],
  rollScaled: number,
): SiblingRivalActionKind {
  if (rollScaled < cumulative[0]) return "GamblingDebt";
  if (rollScaled < cumulative[1]) return "LeakSecret";
  if (rollScaled < cumulative[2]) return "PettySabotage";
  return "AutoSabotageScheme";
}

// Module-local helper: clone-and-write-back for SiblingRivalState updates.
function updateSiblingRivalActor(
  state: GameState,
  actorId: SiblingRivalActorId,
  patch: Partial<Pick<SiblingRivalState, "hostility" | "lastActionTick" | "reconciled">>,
): GameState {
  const playerHouse = state.houses.get(PLAYER_HOUSE_ID);
  if (playerHouse === undefined) return state;
  const idx = playerHouse.siblingRivals.findIndex((sr) => sr.id === actorId);
  if (idx === -1) return state;
  const existing = playerHouse.siblingRivals[idx];
  if (existing === undefined) return state;
  const newSiblingRivals = [...playerHouse.siblingRivals];
  newSiblingRivals[idx] = { ...existing, ...patch };
  const newHouses = new Map(state.houses);
  newHouses.set(PLAYER_HOUSE_ID, { ...playerHouse, siblingRivals: newSiblingRivals });
  return { ...state, houses: newHouses };
}

// Index-counted whisper id factory for LeakSecret action.
function makeLeakWhisperId(
  state: GameState,
  sourceId: CharacterId,
  subjectId: CharacterId,
): WhisperId {
  let index = 0;
  for (const w of state.whispers.values()) {
    if (
      w.sourceCharacterId === sourceId &&
      w.subjectCharacterId === subjectId &&
      w.originatingTick === state.tick
    ) {
      index += 1;
    }
  }
  return `${sourceId}:${subjectId}:${state.tick}:${index}` as WhisperId;
}

function dispatchSiblingRivalAction(
  state: GameState,
  actor: SiblingRivalState,
  pickedKind: SiblingRivalActionKind,
): GameState {
  const playerHouse = state.houses.get(PLAYER_HOUSE_ID);
  if (playerHouse === undefined) return state;

  switch (pickedKind) {
    case "GamblingDebt": {
      const newHouses = new Map(state.houses);
      newHouses.set(PLAYER_HOUSE_ID, {
        ...playerHouse,
        wealth: playerHouse.wealth - SIBLING_RIVAL_GAMBLING_DEBT_WEALTH_DRAIN,
      });
      return { ...state, houses: newHouses };
    }
    case "PettySabotage": {
      const newRep = Math.max(
        0,
        Math.min(100, playerHouse.reputation - SIBLING_RIVAL_PETTY_SABOTAGE_REPUTATION_DRAIN),
      );
      const newHouses = new Map(state.houses);
      newHouses.set(PLAYER_HOUSE_ID, { ...playerHouse, reputation: newRep });
      return { ...state, houses: newHouses };
    }
    case "LeakSecret": {
      // Intra-house leak — arrivedAtTick set immediately (no courier transit).
      const subjectChar = state.characters.get(actor.characterId);
      const subjectName = subjectChar?.name ?? actor.characterId;
      const whisperId = makeLeakWhisperId(
        state,
        actor.characterId,
        playerHouse.headOfHouseCharacterId,
      );
      const whisper: Whisper = {
        id: whisperId,
        text: `${subjectName} leaks gossip about the head of house.`,
        originatingTick: state.tick,
        sourceCharacterId: actor.characterId,
        subjectCharacterId: playerHouse.headOfHouseCharacterId,
        destinationHouseId: PLAYER_HOUSE_ID,
        arrivedAtTick: state.tick,
        verificationProgress: 0,
        status: "Unverified",
        weaponizedAs: null,
        weaponizedAtTick: null,
        scandalSheetAttribution: null,
        accidentalSlipDripsRemaining: 0,
        llmGenerated: false,
      };
      const newWhispers = new Map(state.whispers);
      newWhispers.set(whisperId, whisper);
      return { ...state, whispers: newWhispers };
    }
    case "AutoSabotageScheme": {
      // Intra-house Sabotage: actor is in PLAYER house targeting player head
      // (also PLAYER house). Requires skipSelfTargetGate + explicitAggressor.
      const result = tryStartScheme(state, PLAYER_HOUSE_ID, {
        kind: "Sabotage",
        targetCharacterId: playerHouse.headOfHouseCharacterId,
        skipWealthDeduction: true,
        skipSelfTargetGate: true,
        explicitAggressorCharacterId: actor.characterId,
      });
      return result.ok ? result.state : state;
    }
  }
}

export function applySiblingRivalActionPhase(state: GameState): GameState {
  const playerHouse = state.houses.get(PLAYER_HOUSE_ID);
  if (playerHouse === undefined) return state;
  if (playerHouse.siblingRivals.length === 0) return state;

  // Lex-sort actors for deterministic per-tick draw order.
  const sortedActors = [...playerHouse.siblingRivals].sort((a, b) => a.id.localeCompare(b.id));
  let acc = state;

  for (const actor of sortedActors) {
    if (actor.reconciled) continue;
    if (state.tick - actor.lastActionTick < SIBLING_RIVAL_ACTION_COOLDOWN_TICKS) continue;

    // Draw from shared player-house RNG.
    const playerRng = acc.rng.get(PLAYER_HOUSE_ID);
    if (playerRng === undefined) continue;
    const { next: roll, rngState: newRng } = drawNext(playerRng);
    const newRngMap = new Map(acc.rng);
    newRngMap.set(PLAYER_HOUSE_ID, newRng);
    acc = { ...acc, rng: newRngMap };

    const cumulative = computeCumulativeSiblingWeights();
    const totalWeight = cumulative[3]; // fixed 4-tuple — guaranteed defined
    const rollScaled = Math.floor(roll * totalWeight);
    const pickedKind = pickSiblingActionByScaledWeight(cumulative, rollScaled);

    // Dispatch the action's mutation. State may be unchanged on rejection
    // (e.g., AutoSabotageScheme target dead) — cooldown still burns below.
    acc = dispatchSiblingRivalAction(acc, actor, pickedKind);

    // Refresh actor pointer (dispatch may have mutated state.houses).
    const refreshedHouse = acc.houses.get(PLAYER_HOUSE_ID);
    if (refreshedHouse === undefined) continue;
    const currentActor = refreshedHouse.siblingRivals.find((sr) => sr.id === actor.id);
    if (currentActor === undefined) continue;
    const newHostility = Math.max(
      SIBLING_RIVAL_HOSTILITY_MIN,
      Math.min(
        SIBLING_RIVAL_HOSTILITY_MAX,
        currentActor.hostility + SIBLING_RIVAL_HOSTILITY_PER_ACTION,
      ),
    );

    acc = updateSiblingRivalActor(acc, actor.id, {
      hostility: newHostility,
      lastActionTick: state.tick,
    });

    // Auto-reconciliation at hostility 0.
    if (newHostility === SIBLING_RIVAL_HOSTILITY_MIN) {
      acc = updateSiblingRivalActor(acc, actor.id, { reconciled: true });
    }
  }
  return acc;
}

// ── Reconciliation (player-elected pre-tick action) ────────────────────────

export type ReconciliationRejection =
  | { kind: "NoActiveSiblingRival" }
  | { kind: "AlreadyReconciled" }
  | { kind: "InsufficientWealth"; have: number; need: number }
  | { kind: "WrongLocation"; current: import("../fixtures/locations").LocationId }
  | { kind: "PlayerExiled" }
  | { kind: "ElopementInProgress" };

export type ReconciliationOutcome =
  | { ok: true; kind: "Success"; flippedToReconciled: true }
  | { ok: true; kind: "Failure"; hostilityBumpedBy: number }
  | { ok: false; reason: ReconciliationRejection };

export function applyReconciliationAttempt(
  state: GameState,
  siblingCharacterId: CharacterId,
): { nextState: GameState; outcome: ReconciliationOutcome } {
  const playerHouse = state.houses.get(PLAYER_HOUSE_ID);
  if (playerHouse === undefined) {
    return { nextState: state, outcome: { ok: false, reason: { kind: "PlayerExiled" } } };
  }
  // Modal-state gates (CLAUDE.md P6 + P9 pins) at the TOP — before any cost calc.
  if (playerHouse.exiled) {
    return { nextState: state, outcome: { ok: false, reason: { kind: "PlayerExiled" } } };
  }
  if (hasActivePlayerElopement(state)) {
    return { nextState: state, outcome: { ok: false, reason: { kind: "ElopementInProgress" } } };
  }
  // Eligibility gates.
  if (playerHouse.currentLocation !== "Capital") {
    return {
      nextState: state,
      outcome: {
        ok: false,
        reason: { kind: "WrongLocation", current: playerHouse.currentLocation },
      },
    };
  }
  if (playerHouse.wealth < SIBLING_RIVAL_RECONCILIATION_WEALTH_COST) {
    return {
      nextState: state,
      outcome: {
        ok: false,
        reason: {
          kind: "InsufficientWealth",
          have: playerHouse.wealth,
          need: SIBLING_RIVAL_RECONCILIATION_WEALTH_COST,
        },
      },
    };
  }
  const actorIdx = playerHouse.siblingRivals.findIndex(
    (sr) => sr.characterId === siblingCharacterId,
  );
  if (actorIdx === -1) {
    return { nextState: state, outcome: { ok: false, reason: { kind: "NoActiveSiblingRival" } } };
  }
  const actor = playerHouse.siblingRivals[actorIdx];
  if (actor === undefined) {
    return { nextState: state, outcome: { ok: false, reason: { kind: "NoActiveSiblingRival" } } };
  }
  if (actor.reconciled) {
    return { nextState: state, outcome: { ok: false, reason: { kind: "AlreadyReconciled" } } };
  }

  // Deduct costs (cost-on-attempt invariant — paid even on failure per spec §3 line 485 "per attempt").
  const newRep = Math.max(
    0,
    Math.min(100, playerHouse.reputation - SIBLING_RIVAL_RECONCILIATION_REPUTATION_COST),
  );
  const houseAfterCost: House = {
    ...playerHouse,
    wealth: playerHouse.wealth - SIBLING_RIVAL_RECONCILIATION_WEALTH_COST,
    reputation: newRep,
  };

  // Roll for success.
  const playerRng = state.rng.get(PLAYER_HOUSE_ID);
  if (playerRng === undefined) {
    return { nextState: state, outcome: { ok: false, reason: { kind: "PlayerExiled" } } };
  }
  const { next: roll, rngState: newRng } = drawNext(playerRng);
  const successProbability =
    SIBLING_RIVAL_RECONCILIATION_SUCCESS_AT_HOSTILITY_0 +
    (actor.hostility / 100) *
      (SIBLING_RIVAL_RECONCILIATION_SUCCESS_AT_HOSTILITY_100 -
        SIBLING_RIVAL_RECONCILIATION_SUCCESS_AT_HOSTILITY_0);

  const newRngMap = new Map(state.rng);
  newRngMap.set(PLAYER_HOUSE_ID, newRng);

  const newSiblingRivals = [...playerHouse.siblingRivals];
  if (roll < successProbability) {
    // Success — flip latch.
    newSiblingRivals[actorIdx] = { ...actor, reconciled: true, hostility: 0 };
    const newHouses = new Map(state.houses);
    newHouses.set(PLAYER_HOUSE_ID, { ...houseAfterCost, siblingRivals: newSiblingRivals });
    return {
      nextState: { ...state, houses: newHouses, rng: newRngMap },
      outcome: { ok: true, kind: "Success", flippedToReconciled: true },
    };
  }
  // Failure — hostility bump.
  const bumpedHostility = Math.min(
    SIBLING_RIVAL_HOSTILITY_MAX,
    actor.hostility + SIBLING_RIVAL_HOSTILITY_PER_FAILED_RECONCILIATION,
  );
  newSiblingRivals[actorIdx] = { ...actor, hostility: bumpedHostility };
  const newHouses = new Map(state.houses);
  newHouses.set(PLAYER_HOUSE_ID, { ...houseAfterCost, siblingRivals: newSiblingRivals });
  return {
    nextState: { ...state, houses: newHouses, rng: newRngMap },
    outcome: {
      ok: true,
      kind: "Failure",
      hostilityBumpedBy: SIBLING_RIVAL_HOSTILITY_PER_FAILED_RECONCILIATION,
    },
  };
}
