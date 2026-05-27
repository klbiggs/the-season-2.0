// P9/P24a pure rules: elopement sprint resolution.
//
// Per CLAUDE.md non-negotiable #1, this module imports only from constants,
// fixtures, rng, util, and other rules modules. Every function returns new
// state via hand-rolled shallow clones — no Immer inside src/game/rules/**.
//
// P24a: sprints live in `state.elopements: Map<ElopementId, ElopementSprintState>`
// (was a nullable singleton). The player runs interactive sprints (Push / Fresh
// Horses / Surrender, keyed by ElopementId); rival/society sprints auto-resolve
// in applyElopementAutoResolvePhase. Terminal sprints PERSIST in the Map with
// `resolved: true` (never-delete) — termination is detected via the flag, NOT
// map-absence. `isPlayerControlled` gates the interactive overlay + the modal
// "suspend time" rule (hasActivePlayerElopement).
//
// Q3 verdict semantics (preserved): Won halves the initiator house's reputation
// always; a marriage is minted only when both parties are available for
// remarriage (matches applyProposalPure gates) — UNLESS the player elected
// abandon-on-win, which dissolves the prior marriage first (C3 / Q25).

import {
  ELOPEMENT_AUTO_FRESH_HORSES_PROBABILITY,
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
  PURSUIT_SPEED_ELOPER_TRAIT_MODIFIERS,
  PURSUIT_SPEED_PURSUER_TRAIT_MODIFIERS,
} from "../constants";
import type {
  Character,
  ElopementOutcome,
  ElopementSprintState,
  GameState,
  Scheme,
} from "../entities";
import { makeElopementId } from "../fixtures/elopementIdFactory";
import { TRAITS_ALL } from "../fixtures/traits";
import type { ElopementId, TraitId } from "../rng";
import { PLAYER_HOUSE_ID, drawNext, getOrThrow } from "../rng";
import { clamp } from "../util/clamp";
import { mintMarriage } from "./mintMarriage";

// Module-load assertion: every pursuit-speed trait-id key is a real trait
// (mirrors the LIFESPAN_TRAIT_MODIFIERS validity guard in lifespan.ts).
const TRAIT_ID_SET = new Set<string>(TRAITS_ALL);
for (const t of [
  ...PURSUIT_SPEED_ELOPER_TRAIT_MODIFIERS.keys(),
  ...PURSUIT_SPEED_PURSUER_TRAIT_MODIFIERS.keys(),
]) {
  if (!TRAIT_ID_SET.has(t)) {
    throw new Error(`PURSUIT_SPEED_*_TRAIT_MODIFIERS key "${t}" is not a valid trait id`);
  }
}

// ── Public helpers ────────────────────────────────────────────────────────

// Mirrors applyProposalPure's widow-remarriage semantics: a character with a
// non-null marriageId pointing at a dissolved marriage IS available to re-marry.
export function isAvailableForRemarriage(c: Character, state: GameState): boolean {
  if (c.marriageId === null) return true;
  const m = state.marriages.get(c.marriageId);
  return m !== undefined && m.dissolved === true;
}

// The modal "suspend time" predicate (supersedes the P9 `state.elopement !== null`
// gate): time is suspended only while an unresolved PLAYER-controlled sprint
// exists. Non-player (auto-resolving) sprints run during normal tick advancement.
export function hasActivePlayerElopement(state: GameState): boolean {
  for (const e of state.elopements.values()) {
    if (e.isPlayerControlled && !e.resolved) return true;
  }
  return false;
}

function sumPursuitModifiers(
  traits: readonly TraitId[],
  table: ReadonlyMap<TraitId, number>,
): number {
  let sum = 0;
  for (const t of traits) {
    sum += table.get(t) ?? 0;
  }
  return sum;
}

function pursuerHeadOf(state: GameState, sprint: ElopementSprintState): Character | undefined {
  const house = state.houses.get(sprint.pursuerHouseId);
  if (house === undefined) return undefined;
  return state.characters.get(house.headOfHouseCharacterId);
}

function eloperAdvanceBonus(state: GameState, sprint: ElopementSprintState): number {
  const eloper = state.characters.get(sprint.elopingCharacterId);
  return eloper === undefined
    ? 0
    : sumPursuitModifiers(eloper.traits, PURSUIT_SPEED_ELOPER_TRAIT_MODIFIERS);
}

function pursuerAdvanceBonus(state: GameState, sprint: ElopementSprintState): number {
  const head = pursuerHeadOf(state, sprint);
  return head === undefined
    ? 0
    : sumPursuitModifiers(head.traits, PURSUIT_SPEED_PURSUER_TRAIT_MODIFIERS);
}

// ── Rejection unions ──────────────────────────────────────────────────────

export type ElopementActionRejection = { kind: "NoActiveSprint" };

export type ElopementFreshHorsesRejection =
  | { kind: "NoActiveSprint" }
  | { kind: "FreshHorsesExhausted" }
  | { kind: "InsufficientWealth"; have: number; need: number };

// ── Sprint mount (called from resolveSeduction's discovery branch) ────────

// Applies the discovery-time scandal to the initiator (owner) house AND mints a
// new sprint into state.elopements keyed by ElopementId. isPlayerControlled is
// derived from the owner house; the CALLER (schemes.ts) flips the scheme status
// to Failed/Discovered afterward. scandalDelta is computed by the caller (the
// temptation-discount / perk branches live in schemes.ts).
export function startElopementSprintFromDiscoveredSeduction(
  state: GameState,
  scheme: Scheme,
  scandalDelta: number,
): GameState {
  if (scheme.targetCharacterId === null) {
    throw new Error(
      `startElopementSprintFromDiscoveredSeduction: scheme ${scheme.id} has no targetCharacterId`,
    );
  }

  // Apply scandal to the initiator (owner) house.
  const newHouses = new Map(state.houses);
  const ownerHouse = newHouses.get(scheme.ownerHouseId);
  if (ownerHouse !== undefined) {
    newHouses.set(scheme.ownerHouseId, {
      ...ownerHouse,
      scandal: clamp(ownerHouse.scandal + scandalDelta, 0, 100),
    });
  }

  // Pursuer = the target's house (the pursuing "father").
  const target = state.characters.get(scheme.targetCharacterId);
  const pursuerHouseId = target?.houseId ?? scheme.ownerHouseId;

  const id = makeElopementId(state, scheme.id);
  const sprint: ElopementSprintState = {
    id,
    schemeId: scheme.id,
    elopingCharacterId: scheme.aggressorCharacterId,
    targetCharacterId: scheme.targetCharacterId,
    initiatorHouseId: scheme.ownerHouseId,
    pursuerHouseId,
    isPlayerControlled: scheme.ownerHouseId === PLAYER_HOUSE_ID,
    playerTilePosition: ELOPEMENT_PLAYER_START_TILE,
    fatherTilePosition: ELOPEMENT_FATHER_START_TILE,
    freshHorsesUsedCount: 0,
    abandonOnWin: false,
    resolved: false,
    outcome: null,
    resolvedAtTick: null,
    startedAtTick: state.tick,
  };
  const newElopements = new Map(state.elopements);
  newElopements.set(id, sprint);

  return { ...state, houses: newHouses, elopements: newElopements };
}

// Player-elected per-sprint toggle (surfaced as the overlay "abandon on win"
// switch). No-op if the sprint is missing/resolved.
export function setElopementAbandonOnWin(
  state: GameState,
  id: ElopementId,
  abandonOnWin: boolean,
): GameState {
  const sprint = state.elopements.get(id);
  if (sprint === undefined || sprint.resolved) return state;
  const newElopements = new Map(state.elopements);
  newElopements.set(id, { ...sprint, abandonOnWin });
  return { ...state, elopements: newElopements };
}

// ── Push (interactive, player sprints) ──────────────────────────────────────

export function applyElopementPushPure(
  state: GameState,
  id: ElopementId,
): GameState | { ok: false; reason: ElopementActionRejection } {
  const sprint = state.elopements.get(id);
  if (sprint === undefined || sprint.resolved) {
    return { ok: false, reason: { kind: "NoActiveSprint" } };
  }
  const newPlayerTile = clamp(
    sprint.playerTilePosition + ELOPEMENT_PUSH_PLAYER_ADVANCE + eloperAdvanceBonus(state, sprint),
    0,
    ELOPEMENT_TRACK_LENGTH,
  );
  const newFatherTile = clamp(
    sprint.fatherTilePosition + ELOPEMENT_PUSH_FATHER_ADVANCE + pursuerAdvanceBonus(state, sprint),
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

  const newElopements = new Map(state.elopements);
  newElopements.set(id, {
    ...sprint,
    playerTilePosition: newPlayerTile,
    fatherTilePosition: newFatherTile,
  });
  const advanced: GameState = { ...state, characters: newChars, elopements: newElopements };

  // Terminal checks (priority): player at finish → Win; father at finish OR
  // eloping composure depleted → Lost.
  if (newPlayerTile === ELOPEMENT_TRACK_LENGTH) {
    return resolveElopementTerminal(advanced, id, "Won");
  }
  if (newFatherTile === ELOPEMENT_TRACK_LENGTH || postComposure === 0) {
    return resolveElopementTerminal(advanced, id, "Lost");
  }
  return advanced;
}

// ── Fresh Horses (interactive, player sprints) ──────────────────────────────

export function applyElopementFreshHorsesPure(
  state: GameState,
  id: ElopementId,
): GameState | { ok: false; reason: ElopementFreshHorsesRejection } {
  const sprint = state.elopements.get(id);
  if (sprint === undefined || sprint.resolved) {
    return { ok: false, reason: { kind: "NoActiveSprint" } };
  }
  if (sprint.freshHorsesUsedCount >= ELOPEMENT_FRESH_HORSES_MAX_USES) {
    return { ok: false, reason: { kind: "FreshHorsesExhausted" } };
  }
  const initiatorHouse = state.houses.get(sprint.initiatorHouseId);
  if (initiatorHouse === undefined) {
    throw new Error("applyElopementFreshHorsesPure: initiator house not in state.houses");
  }
  if (initiatorHouse.wealth < ELOPEMENT_FRESH_HORSES_WEALTH_COST) {
    return {
      ok: false,
      reason: {
        kind: "InsufficientWealth",
        have: initiatorHouse.wealth,
        need: ELOPEMENT_FRESH_HORSES_WEALTH_COST,
      },
    };
  }

  const newPlayerTile = clamp(
    sprint.playerTilePosition +
      ELOPEMENT_FRESH_HORSES_PLAYER_ADVANCE +
      eloperAdvanceBonus(state, sprint),
    0,
    ELOPEMENT_TRACK_LENGTH,
  );
  const newHouses = new Map(state.houses);
  newHouses.set(sprint.initiatorHouseId, {
    ...initiatorHouse,
    wealth: initiatorHouse.wealth - ELOPEMENT_FRESH_HORSES_WEALTH_COST,
  });
  const newElopements = new Map(state.elopements);
  newElopements.set(id, {
    ...sprint,
    playerTilePosition: newPlayerTile,
    freshHorsesUsedCount: sprint.freshHorsesUsedCount + 1,
  });
  const advanced: GameState = { ...state, houses: newHouses, elopements: newElopements };

  // Fresh Horses advances only the player tile — no Lost branch here.
  if (newPlayerTile === ELOPEMENT_TRACK_LENGTH) {
    return resolveElopementTerminal(advanced, id, "Won");
  }
  return advanced;
}

// ── Surrender (interactive, player sprints) ─────────────────────────────────

export function applyElopementSurrenderPure(state: GameState, id: ElopementId): GameState {
  const sprint = state.elopements.get(id);
  if (sprint === undefined || sprint.resolved) {
    throw new Error("applyElopementSurrenderPure: sprint missing or already resolved");
  }
  const newElopements = new Map(state.elopements);
  newElopements.set(id, { ...sprint, fatherTilePosition: ELOPEMENT_TRACK_LENGTH });
  const advanced: GameState = { ...state, elopements: newElopements };
  return resolveElopementTerminal(advanced, id, "Lost");
}

// ── Auto-resolve phase (non-player sprints) ─────────────────────────────────

// Tick phase: deterministically advances every unresolved NON-player-controlled
// sprint by one Push-equivalent (both tiles + pursuit-trait modifiers), with a
// seeded ELOPEMENT_AUTO_FRESH_HORSES_PROBABILITY chance to "use fresh horses"
// (eloper tile +ELOPEMENT_FRESH_HORSES_PLAYER_ADVANCE) while uses remain. One
// draw per unresolved non-player sprint per tick on the initiator-house stream.
// Resolves Won/Lost when terminal; resolved sprints persist in the Map.
export function applyElopementAutoResolvePhase(state: GameState): GameState {
  const ids = [...state.elopements.values()]
    .filter((e) => !e.resolved && !e.isPlayerControlled)
    .map((e) => e.id)
    .sort();

  let working = state;
  for (const id of ids) {
    const sprint = working.elopements.get(id);
    if (sprint === undefined || sprint.resolved) continue;

    const rngState = getOrThrow(working.rng, sprint.initiatorHouseId);
    const { next, rngState: postDraw } = drawNext(rngState);
    const newRng = new Map(working.rng);
    newRng.set(sprint.initiatorHouseId, postDraw);
    working = { ...working, rng: newRng };

    const useFreshHorses =
      next < ELOPEMENT_AUTO_FRESH_HORSES_PROBABILITY &&
      sprint.freshHorsesUsedCount < ELOPEMENT_FRESH_HORSES_MAX_USES;

    const playerAdvance =
      ELOPEMENT_PUSH_PLAYER_ADVANCE +
      eloperAdvanceBonus(working, sprint) +
      (useFreshHorses ? ELOPEMENT_FRESH_HORSES_PLAYER_ADVANCE : 0);
    const fatherAdvance = ELOPEMENT_PUSH_FATHER_ADVANCE + pursuerAdvanceBonus(working, sprint);

    const newPlayerTile = clamp(
      sprint.playerTilePosition + playerAdvance,
      0,
      ELOPEMENT_TRACK_LENGTH,
    );
    const newFatherTile = clamp(
      sprint.fatherTilePosition + fatherAdvance,
      0,
      ELOPEMENT_TRACK_LENGTH,
    );

    const newElopements = new Map(working.elopements);
    newElopements.set(id, {
      ...sprint,
      playerTilePosition: newPlayerTile,
      fatherTilePosition: newFatherTile,
      freshHorsesUsedCount: sprint.freshHorsesUsedCount + (useFreshHorses ? 1 : 0),
    });
    working = { ...working, elopements: newElopements };

    if (newPlayerTile === ELOPEMENT_TRACK_LENGTH) {
      working = resolveElopementTerminal(working, id, "Won");
    } else if (newFatherTile === ELOPEMENT_TRACK_LENGTH) {
      working = resolveElopementTerminal(working, id, "Lost");
    }
  }
  return working;
}

// ── Terminal resolver ────────────────────────────────────────────────────

// Marks the sprint resolved (persists in the Map) and applies the terminal
// effect on the INITIATOR house:
//   Lost → +ELOPEMENT_LOSS_SCANDAL_DELTA scandal (clamped [0,100]).
//   Won  → reputation halved (clamped [0,100]); then a marriage is minted if
//          both parties are available for remarriage, OR (C3) the prior
//          marriage is abandoned-then-minted when the player elected abandonOnWin.
export function resolveElopementTerminal(
  state: GameState,
  id: ElopementId,
  outcome: ElopementOutcome,
): GameState {
  const sprint = state.elopements.get(id);
  if (sprint === undefined) {
    throw new Error(`resolveElopementTerminal: no sprint ${id}`);
  }

  const newElopements = new Map(state.elopements);
  newElopements.set(id, { ...sprint, resolved: true, outcome, resolvedAtTick: state.tick });
  const newHouses = new Map(state.houses);
  const initiatorHouse = newHouses.get(sprint.initiatorHouseId);

  if (outcome === "Lost") {
    if (initiatorHouse !== undefined) {
      newHouses.set(sprint.initiatorHouseId, {
        ...initiatorHouse,
        scandal: clamp(initiatorHouse.scandal + ELOPEMENT_LOSS_SCANDAL_DELTA, 0, 100),
      });
    }
    return { ...state, houses: newHouses, elopements: newElopements };
  }

  // Won branch — halve the initiator house's reputation.
  if (initiatorHouse !== undefined) {
    newHouses.set(sprint.initiatorHouseId, {
      ...initiatorHouse,
      reputation: clamp(Math.floor(initiatorHouse.reputation / 2), 0, 100),
    });
  }
  const working: GameState = { ...state, houses: newHouses, elopements: newElopements };

  // Re-read parties at resolution time (NOT cached at sprint-start).
  const aggressor = working.characters.get(sprint.elopingCharacterId);
  const target = working.characters.get(sprint.targetCharacterId);
  if (aggressor === undefined || target === undefined || !aggressor.alive || !target.alive) {
    return working;
  }

  if (isAvailableForRemarriage(aggressor, working) && isAvailableForRemarriage(target, working)) {
    return mintMarriageAndCommit(working, aggressor.id, target.id, false);
  }
  // Abandon-on-win (C3 / Q25): a party is in an active marriage but the player
  // elected to abandon it on a win — dissolve-then-mint.
  if (sprint.abandonOnWin) {
    return mintMarriageAndCommit(working, aggressor.id, target.id, true);
  }
  // Win-without-union: rep-halve only; no marriage minted.
  return working;
}

// Mints the viaElopement marriage via the shared P23 mintMarriage core. When
// `abandonPriorMarriages` is set, any active marriage of either party is first
// dissolved with viaAbandonment (both spouses' marriageId nulled) so the mint
// is unambiguous (C3). NOTE: the abandoned partner's role recompute is added by
// the C3 abandonMarriage helper (P24a task 8) — shared at that point.
function mintMarriageAndCommit(
  state: GameState,
  aggressorId: Character["id"],
  targetId: Character["id"],
  abandonPriorMarriages: boolean,
): GameState {
  let working = state;
  if (abandonPriorMarriages) {
    for (const partyId of [aggressorId, targetId]) {
      const party = working.characters.get(partyId);
      if (party === undefined || party.marriageId === null) continue;
      const m = working.marriages.get(party.marriageId);
      if (m === undefined || m.dissolved) continue;
      const newMarriages = new Map(working.marriages);
      newMarriages.set(m.id, {
        ...m,
        dissolved: true,
        dissolvedAtTick: working.tick,
        viaAbandonment: true,
      });
      const newChars = new Map(working.characters);
      for (const sid of [m.spouseAId, m.spouseBId]) {
        const c = newChars.get(sid);
        if (c !== undefined) newChars.set(sid, { ...c, marriageId: null });
      }
      working = { ...working, marriages: newMarriages, characters: newChars };
    }
  }
  const { nextState } = mintMarriage(working, aggressorId, targetId, {
    viaElopement: true,
    applyDullExposure: false,
  });
  return nextState;
}
