// P10 artifact-loop rules (spec §3 "Wardrobe, Artifacts & Heirlooms",
// "Forgery & Theft", "Treason Framing", "Wardrobe Decay & Pre-Ball
// Composure Penalty", "Forgery Surfacing", "Thief Notice & Thwart"; §4
// "Artifact Definition", "Forgery Record", "Thief Attempt").
//
// Pure-rules layer: no imports from UI, persistence, LLM, runtime, or events.
// All functions return new state via hand-rolled clones per the CLAUDE.md
// pure-rule structural-sharing contract. Immer is the store/orchestrator
// boundary, not the rules layer.
//
// Five entry points:
//   applyEquipArtifactPure / applyUnequipArtifactPure / applyCommissionForgeryPure
//     — player-elected mutation functions (free actions; no tick advance).
//   applyForgerySurfacingPhase / applyThiefNoticePhase
//     — tick-phase functions (run from PHASES at slots 10 + 11).
//   applyThwartTheftPure
//     — player-elected free action.
//   applyPreBallComposurePenaltyPure
//     — called from enterBallroom wrapper BEFORE beginSession.
//
// Plus three read-side projections / pickers:
//   getEffectiveReputation / getEffectiveTraits
//     — projections at read site (artifact bonuses don't mutate house/character).
//   selectTargetedArtifactInstance
//     — deterministic valuable-artifact pick for thief notice.

import {
  FORGERY_SURFACING_PROBABILITY_BASIS_POINTS,
  FORGERY_SURFACING_VAIN_AFFECTION_DELTA,
  FORGERY_SURFACING_VAIN_MOOD_LOCK_DURATION_TICKS,
  PRE_BALL_COMPOSURE_PENALTY_PER_OUT_OF_SEASON_ARTIFACT,
  THIEF_NOTICE_PROBABILITY_BASIS_POINTS,
  THIEF_NOTICE_REPUTATION_THRESHOLD,
  THWART_SUCCESS_PROBABILITY_BASIS_POINTS,
  THWART_WEALTH_COST,
  VALUABLE_ARTIFACT_THRESHOLD,
  WARDROBE_REFRESH_INTERVAL_TICKS,
} from "../constants";
import { makePairKey } from "../conversation/types";
import type {
  ArtifactInstance,
  CourierPayload,
  ForgeryRecord,
  GameState,
  ThiefAttempt,
} from "../entities";
import type { Archetype } from "../fixtures/archetypes";
import {
  ARTIFACT_REGISTRY,
  type ArtifactFamily,
  makeArtifactInstanceId,
  makeForgeryId,
  makeThiefAttemptId,
} from "../fixtures/artifacts";
import {
  type ArtifactInstanceId,
  type CharacterId,
  type CourierPayloadId,
  type ForgeryId,
  type HouseId,
  PLAYER_HOUSE_ID,
  type ThiefAttemptId,
  type TraitId,
  drawNext,
  getOrThrow,
} from "../rng";
import { clamp } from "../util/clamp";

// ─── Rejection unions ─────────────────────────────────────────────────────

export type EquipRejection =
  | { kind: "ArtifactNotFound"; artifactInstanceId: ArtifactInstanceId }
  | { kind: "NotOwnedByCharacter" }
  | { kind: "CharacterDead" }
  | { kind: "CharacterNotFound" }
  | { kind: "AlreadyEquipped" }
  | { kind: "MaxOnePerFamily"; conflictingInstanceId: ArtifactInstanceId }
  | { kind: "PlayerExiled" }
  | { kind: "ElopementInProgress" };

export type UnequipRejection =
  | { kind: "ArtifactNotFound"; artifactInstanceId: ArtifactInstanceId }
  | { kind: "CharacterDead" }
  | { kind: "CharacterNotFound" }
  | { kind: "NotEquipped" }
  | { kind: "PlayerExiled" }
  | { kind: "ElopementInProgress" };

export type CommissionRejection =
  | { kind: "CharacterNotFound" }
  | { kind: "CharacterDead" }
  | { kind: "MissingArchetype"; required: readonly Archetype[] }
  | { kind: "UnknownDefinition"; definitionId: string }
  | { kind: "NotForgeable" }
  | { kind: "InsufficientWealth"; have: number; need: number }
  | { kind: "PlayerExiled" }
  | { kind: "ElopementInProgress" };

export type ThwartRejection =
  | { kind: "AttemptNotFound" }
  | { kind: "AttemptAlreadyResolved" }
  | { kind: "MissingSpymaster" }
  | { kind: "InsufficientWealth"; have: number; need: number }
  | { kind: "NoInFlightCourier" }
  | { kind: "PlayerExiled" }
  | { kind: "ElopementInProgress" };

// ─── Projections (read-side) ──────────────────────────────────────────────

// Equipped-artifact reputation bonuses are projected at read sites, NOT
// mutated into house.reputation. Rationale: equip→clamp(100) lossiness
// would make unequip asymmetric. Projection avoids the cap trap.
export function getEffectiveReputation(state: GameState, houseId: HouseId): number {
  const house = state.houses.get(houseId);
  if (!house) return 0;
  let bonus = 0;
  for (const ch of state.characters.values()) {
    if (ch.houseId !== houseId || !ch.alive) continue;
    for (const instId of ch.equippedArtifactIds) {
      const inst = state.artifactInstances.get(instId);
      if (!inst) continue;
      const def = ARTIFACT_REGISTRY.get(inst.definitionId);
      if (!def) continue;
      bonus += def.reputationBonusWhileEquipped;
    }
  }
  return clamp(house.reputation + bonus, 0, 100);
}

// Equipped-artifact trait grants — projection over persistent character.traits.
// Persona snapshot reads this so the LLM sees the effective trait set; other
// rule-layer consumers continue to read character.traits directly.
export function getEffectiveTraits(state: GameState, characterId: CharacterId): TraitId[] {
  const ch = state.characters.get(characterId);
  if (!ch) return [];
  const granted: TraitId[] = [];
  for (const instId of ch.equippedArtifactIds) {
    const inst = state.artifactInstances.get(instId);
    if (!inst) continue;
    const def = ARTIFACT_REGISTRY.get(inst.definitionId);
    if (!def) continue;
    for (const t of def.traitGrantsWhileEquipped) {
      if (!ch.traits.includes(t) && !granted.includes(t)) granted.push(t);
    }
  }
  return [...ch.traits, ...granted];
}

// Sum of scandalRiskWhileEquipped across player-house equipped artifacts.
// Used by applyEconomyPhase as the per-tick scandal additive.
export function effectiveScandalContributionFromArtifacts(state: GameState): number {
  let total = 0;
  for (const ch of state.characters.values()) {
    if (ch.houseId !== PLAYER_HOUSE_ID || !ch.alive) continue;
    for (const instId of ch.equippedArtifactIds) {
      const inst = state.artifactInstances.get(instId);
      if (!inst) continue;
      const def = ARTIFACT_REGISTRY.get(inst.definitionId);
      if (!def) continue;
      total += def.scandalRiskWhileEquipped;
    }
  }
  return total;
}

// Deterministic valuable-artifact picker for thief notice. Walks all equipped
// player-owned instances in lex-instance-id order, filters to "valuable"
// (def.reputationBonusWhileEquipped >= VALUABLE_ARTIFACT_THRESHOLD), picks
// the first. Returns null when no valuable equipped artifact exists.
export function selectTargetedArtifactInstance(state: GameState): ArtifactInstance | null {
  const candidates: ArtifactInstance[] = [];
  for (const ch of state.characters.values()) {
    if (ch.houseId !== PLAYER_HOUSE_ID || !ch.alive) continue;
    for (const instId of ch.equippedArtifactIds) {
      const inst = state.artifactInstances.get(instId);
      if (!inst) continue;
      const def = ARTIFACT_REGISTRY.get(inst.definitionId);
      if (!def) continue;
      if (def.reputationBonusWhileEquipped >= VALUABLE_ARTIFACT_THRESHOLD) {
        candidates.push(inst);
      }
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.id.localeCompare(b.id));
  return candidates[0] ?? null;
}

// ─── Player-elected mutations (free actions) ──────────────────────────────

export function applyEquipArtifactPure(
  state: GameState,
  characterId: CharacterId,
  artifactInstanceId: ArtifactInstanceId,
): { ok: true; state: GameState } | { ok: false; reason: EquipRejection } {
  const inst = state.artifactInstances.get(artifactInstanceId);
  if (!inst) {
    return { ok: false, reason: { kind: "ArtifactNotFound", artifactInstanceId } };
  }
  const ch = state.characters.get(characterId);
  if (!ch) return { ok: false, reason: { kind: "CharacterNotFound" } };
  if (!ch.alive) return { ok: false, reason: { kind: "CharacterDead" } };
  if (inst.ownerCharacterId !== ch.id) {
    return { ok: false, reason: { kind: "NotOwnedByCharacter" } };
  }
  if (ch.equippedArtifactIds.includes(artifactInstanceId)) {
    return { ok: false, reason: { kind: "AlreadyEquipped" } };
  }
  const def = ARTIFACT_REGISTRY.get(inst.definitionId);
  if (!def) {
    throw new Error(
      `applyEquipArtifactPure: artifact ${inst.id} references unknown definition ${inst.definitionId}`,
    );
  }
  // Family uniqueness: at most one instance per family per character.
  const targetFamily: ArtifactFamily = def.family;
  for (const otherId of ch.equippedArtifactIds) {
    const other = state.artifactInstances.get(otherId);
    if (!other) continue;
    const otherDef = ARTIFACT_REGISTRY.get(other.definitionId);
    if (!otherDef) continue;
    if (otherDef.family === targetFamily) {
      return {
        ok: false,
        reason: { kind: "MaxOnePerFamily", conflictingInstanceId: otherId },
      };
    }
  }
  const newChars = new Map(state.characters);
  newChars.set(ch.id, {
    ...ch,
    equippedArtifactIds: [...ch.equippedArtifactIds, artifactInstanceId],
  });
  return { ok: true, state: { ...state, characters: newChars } };
}

export function applyUnequipArtifactPure(
  state: GameState,
  characterId: CharacterId,
  artifactInstanceId: ArtifactInstanceId,
): { ok: true; state: GameState } | { ok: false; reason: UnequipRejection } {
  const ch = state.characters.get(characterId);
  if (!ch) return { ok: false, reason: { kind: "CharacterNotFound" } };
  if (!ch.alive) return { ok: false, reason: { kind: "CharacterDead" } };
  if (!state.artifactInstances.has(artifactInstanceId)) {
    return { ok: false, reason: { kind: "ArtifactNotFound", artifactInstanceId } };
  }
  if (!ch.equippedArtifactIds.includes(artifactInstanceId)) {
    return { ok: false, reason: { kind: "NotEquipped" } };
  }
  const newChars = new Map(state.characters);
  newChars.set(ch.id, {
    ...ch,
    equippedArtifactIds: ch.equippedArtifactIds.filter((id) => id !== artifactInstanceId),
  });
  return { ok: true, state: { ...state, characters: newChars } };
}

export function applyCommissionForgeryPure(
  state: GameState,
  forgerCharacterId: CharacterId,
  definitionId: string,
):
  | { ok: true; state: GameState; forgeryId: ForgeryId }
  | { ok: false; reason: CommissionRejection } {
  const forger = state.characters.get(forgerCharacterId);
  if (!forger) return { ok: false, reason: { kind: "CharacterNotFound" } };
  if (!forger.alive) return { ok: false, reason: { kind: "CharacterDead" } };
  // Forger must be in the player house (BohemianRake archetype guards via SCHEME_PREREQUISITES).
  if (forger.houseId !== PLAYER_HOUSE_ID) {
    return { ok: false, reason: { kind: "MissingArchetype", required: ["BohemianRake"] } };
  }
  if (forger.archetype !== "BohemianRake") {
    return { ok: false, reason: { kind: "MissingArchetype", required: ["BohemianRake"] } };
  }
  const def = ARTIFACT_REGISTRY.get(definitionId);
  if (!def) return { ok: false, reason: { kind: "UnknownDefinition", definitionId } };
  if (!def.forgeable) return { ok: false, reason: { kind: "NotForgeable" } };
  const playerHouse = state.houses.get(PLAYER_HOUSE_ID);
  if (!playerHouse) {
    throw new Error("applyCommissionForgeryPure: player house missing");
  }
  if (playerHouse.wealth < def.forgeWealthCost) {
    return {
      ok: false,
      reason: { kind: "InsufficientWealth", have: playerHouse.wealth, need: def.forgeWealthCost },
    };
  }
  // Mint instance + forgery record. Wealth deduction last per atomic-gating
  // (CLAUDE.md non-negotiable §5).
  const newHouses = new Map(state.houses);
  newHouses.set(playerHouse.id, {
    ...playerHouse,
    wealth: playerHouse.wealth - def.forgeWealthCost,
  });
  const instId = makeArtifactInstanceId(state, definitionId);
  const inst: ArtifactInstance = {
    id: instId,
    definitionId,
    ownerHouseId: playerHouse.id,
    ownerCharacterId: forger.id,
    lastRefreshTick: state.tick,
    forgedFlag: true,
  };
  const newArtifactInstances = new Map(state.artifactInstances);
  newArtifactInstances.set(instId, inst);
  const stateForForgeryId: GameState = { ...state, artifactInstances: newArtifactInstances };
  const forgeryId = makeForgeryId(stateForForgeryId, instId);
  const forgery: ForgeryRecord = {
    id: forgeryId,
    forgedArtifactInstanceId: instId,
    forgerCharacterId: forger.id,
    forgedAtTick: state.tick,
    surfaced: false,
    surfacedAtTick: null,
  };
  const newForgeries = new Map(state.forgeries);
  newForgeries.set(forgeryId, forgery);
  return {
    ok: true,
    state: {
      ...state,
      houses: newHouses,
      artifactInstances: newArtifactInstances,
      forgeries: newForgeries,
    },
    forgeryId,
  };
}

// ─── Tick-phase rules ─────────────────────────────────────────────────────

const VAIN_TRAIT_ID = "Vain" as TraitId;

// Walks unsurfaced forgeries in lex-id order; for each, draws ONE roll from
// the player-house RNG stream. If roll < FORGERY_SURFACING_PROBABILITY_BASIS_POINTS,
// flips surfaced + fires cascade (every Vain NPC: mood lock + affection drop).
//
// Per-iteration multi-Map accumulator: forgeries + characters + affectionMap
// + rng all clone-and-write-back together when ANY surfacing fires.
// Locked Vain NPCs DO participate (extend lock via Math.max; never shorten).
export function applyForgerySurfacingPhase(state: GameState): GameState {
  const sortedForgeries = [...state.forgeries.values()].sort((a, b) => a.id.localeCompare(b.id));
  let rngState = getOrThrow(state.rng, PLAYER_HOUSE_ID);
  let charsChanged = false;
  let newChars = state.characters;
  let affChanged = false;
  let newAffection = state.affectionMap;
  let forgChanged = false;
  let newForgeries = state.forgeries;
  let rngChanged = false;

  const playerHouse = state.houses.get(PLAYER_HOUSE_ID);
  const playerHead = playerHouse?.headOfHouseCharacterId;

  for (const forgery of sortedForgeries) {
    if (forgery.surfaced) continue;
    const { next: roll, rngState: nextRng } = drawNext(rngState);
    rngState = nextRng;
    rngChanged = true;
    if (Math.floor(roll * 10000) < FORGERY_SURFACING_PROBABILITY_BASIS_POINTS) {
      if (!forgChanged) {
        newForgeries = new Map(state.forgeries);
        forgChanged = true;
      }
      newForgeries.set(forgery.id, { ...forgery, surfaced: true, surfacedAtTick: state.tick });
      if (playerHead === undefined) continue;
      // Cascade — walk ALL characters in lex order, hit Vain NPCs.
      const sortedChars = [...state.characters.values()].sort((a, b) => a.id.localeCompare(b.id));
      for (const ch of sortedChars) {
        if (!ch.alive) continue;
        if (ch.houseId === PLAYER_HOUSE_ID) continue;
        if (!ch.traits.includes(VAIN_TRAIT_ID)) continue;
        // LOAD-BEARING: read from newChars accumulator (NOT state.characters).
        // On the first cascade hit we clone state.characters → newChars; for
        // SUBSEQUENT same-pass cascades (multi-forgery surfacing in one tick)
        // we honor prior mood-lock extensions via Math.max — without this,
        // each cascade would re-clone from pristine state and lose accumulated
        // locks. The strict `< state.tick` discipline doesn't apply here;
        // this is a different invariant (multi-Map accumulator coherence per
        // P6 precedent).
        if (!charsChanged) {
          newChars = new Map(state.characters);
          charsChanged = true;
        }
        const currentCh = newChars.get(ch.id);
        if (!currentCh) continue;
        const newLockUntil = Math.max(
          currentCh.moodLockUntilTick,
          state.tick + FORGERY_SURFACING_VAIN_MOOD_LOCK_DURATION_TICKS,
        );
        newChars.set(ch.id, {
          ...currentCh,
          mood: "Defensive",
          moodLockUntilTick: newLockUntil,
        });
        // Affection drop (clamped [0, 100]). Default 0 per project convention.
        const key = makePairKey(ch.houseId, playerHead);
        if (!affChanged) {
          newAffection = new Map(state.affectionMap);
          affChanged = true;
        }
        const currentAff = newAffection.get(key) ?? 0;
        const nextAff = clamp(currentAff + FORGERY_SURFACING_VAIN_AFFECTION_DELTA, 0, 100);
        newAffection.set(key, nextAff);
      }
    }
  }

  const result: GameState = { ...state };
  if (rngChanged) {
    const newRng = new Map(state.rng);
    newRng.set(PLAYER_HOUSE_ID, rngState);
    result.rng = newRng;
  }
  if (forgChanged) result.forgeries = newForgeries;
  if (charsChanged) result.characters = newChars;
  if (affChanged) result.affectionMap = newAffection;
  return result;
}

// Three-stage gate: (a) effective reputation >= THIEF_NOTICE_REPUTATION_THRESHOLD,
// (b) at least one valuable equipped artifact, (c) roll < THIEF_NOTICE_PROBABILITY_BASIS_POINTS.
// Then auto-resolve sweep on in-flight attempts from PREVIOUS tick.
// LOAD-BEARING: auto-resolve predicate is `< state.tick` (strict less-than),
// NOT `<=`. This function CREATES new attempts with `noticedAtTick = state.tick`
// AND auto-resolves OLDER attempts (noticedAtTick < state.tick) in the same
// pass — strict less-than keeps just-created attempts in-flight for the
// player to thwart on the next dispatch.
export function applyThiefNoticePhase(state: GameState): GameState {
  let rngState = getOrThrow(state.rng, PLAYER_HOUSE_ID);
  let rngChanged = false;
  let attemptsChanged = false;
  let newAttempts = state.thiefAttempts;
  let artifactsChanged = false;
  let newArtifacts = state.artifactInstances;
  let charsChanged = false;
  let newChars = state.characters;

  // Stage 1: gate on effective reputation.
  const effectiveRep = getEffectiveReputation(state, PLAYER_HOUSE_ID);
  if (effectiveRep >= THIEF_NOTICE_REPUTATION_THRESHOLD) {
    // Stage 2: gate on at least one valuable equipped artifact.
    const targeted = selectTargetedArtifactInstance(state);
    if (targeted !== null) {
      // Stage 3: roll.
      const { next: roll, rngState: nextRng } = drawNext(rngState);
      rngState = nextRng;
      rngChanged = true;
      if (Math.floor(roll * 10000) < THIEF_NOTICE_PROBABILITY_BASIS_POINTS) {
        // Notice fires — create new in-flight ThiefAttempt.
        const stateForId: GameState = { ...state, thiefAttempts: newAttempts };
        const id = makeThiefAttemptId(stateForId, targeted.id);
        const attempt: ThiefAttempt = {
          id,
          targetedArtifactInstanceId: targeted.id,
          ownerCharacterId: targeted.ownerCharacterId,
          noticedAtTick: state.tick,
          thwarted: null,
          resolvedAtTick: null,
        };
        if (!attemptsChanged) {
          newAttempts = new Map(state.thiefAttempts);
          attemptsChanged = true;
        }
        newAttempts.set(id, attempt);
      }
    }
  }

  // Auto-resolve sweep — strictly older attempts only.
  for (const [id, attempt] of state.thiefAttempts) {
    if (attempt.thwarted !== null) continue;
    if (attempt.noticedAtTick >= state.tick) continue;
    // Auto-resolve: check if targeted instance is still equipped.
    const inst = state.artifactInstances.get(attempt.targetedArtifactInstanceId);
    const owner = inst ? state.characters.get(inst.ownerCharacterId) : undefined;
    const stillEquipped =
      inst !== undefined && owner !== undefined && owner.equippedArtifactIds.includes(inst.id);
    if (!attemptsChanged) {
      newAttempts = new Map(state.thiefAttempts);
      attemptsChanged = true;
    }
    if (!stillEquipped || inst === undefined) {
      // Auto-thwart: unequipped between notice and resolution OR instance gone.
      newAttempts.set(id, { ...attempt, thwarted: true, resolvedAtTick: state.tick });
    } else {
      // Theft succeeds — remove artifact from owner's equipped list AND
      // delete the instance from state.artifactInstances (theft removes
      // the artifact per spec §3 line 442).
      newAttempts.set(id, { ...attempt, thwarted: false, resolvedAtTick: state.tick });
      if (!artifactsChanged) {
        newArtifacts = new Map(state.artifactInstances);
        artifactsChanged = true;
      }
      newArtifacts.delete(inst.id);
      if (owner !== undefined) {
        if (!charsChanged) {
          newChars = new Map(state.characters);
          charsChanged = true;
        }
        const currentOwner = newChars.get(owner.id);
        if (currentOwner) {
          newChars.set(owner.id, {
            ...currentOwner,
            equippedArtifactIds: currentOwner.equippedArtifactIds.filter((x) => x !== inst.id),
          });
        }
      }
    }
  }

  const result: GameState = { ...state };
  if (rngChanged) {
    const newRng = new Map(state.rng);
    newRng.set(PLAYER_HOUSE_ID, rngState);
    result.rng = newRng;
  }
  if (attemptsChanged) result.thiefAttempts = newAttempts;
  if (artifactsChanged) result.artifactInstances = newArtifacts;
  if (charsChanged) result.characters = newChars;
  return result;
}

// Player-elected free action. Validates: in-flight attempt exists +
// Spymaster alive in player house + wealth >= cost + ≥1 InFlight courier
// matching the 4-predicate filter (InFlight + Inbound + interceptable +
// destinationHouseId === PLAYER_HOUSE_ID — mirrors trySpymasterMailIntercept).
//
// On success roll: artifact survives (thwarted: true). On fail: artifact
// removed from owner.equippedArtifactIds + state.artifactInstances.
// Wealth + courier are burned regardless of roll outcome (after all gates pass).
export function applyThwartTheftPure(
  state: GameState,
  thiefAttemptId: ThiefAttemptId,
):
  | { ok: true; state: GameState; outcome: "Thwarted" | "Stolen" }
  | { ok: false; reason: ThwartRejection } {
  const attempt = state.thiefAttempts.get(thiefAttemptId);
  if (!attempt) return { ok: false, reason: { kind: "AttemptNotFound" } };
  if (attempt.thwarted !== null) {
    return { ok: false, reason: { kind: "AttemptAlreadyResolved" } };
  }
  // Spymaster gate — at least one alive player-house BohemianRake-or-Spymaster
  // family member. Per spec §3 line 441 — "spymaster-archetype family member."
  let hasSpymaster = false;
  for (const ch of state.characters.values()) {
    if (ch.houseId === PLAYER_HOUSE_ID && ch.alive && ch.archetype === "Spymaster") {
      hasSpymaster = true;
      break;
    }
  }
  if (!hasSpymaster) return { ok: false, reason: { kind: "MissingSpymaster" } };
  const playerHouse = state.houses.get(PLAYER_HOUSE_ID);
  if (!playerHouse) {
    throw new Error("applyThwartTheftPure: player house missing");
  }
  if (playerHouse.wealth < THWART_WEALTH_COST) {
    return {
      ok: false,
      reason: { kind: "InsufficientWealth", have: playerHouse.wealth, need: THWART_WEALTH_COST },
    };
  }
  // Courier filter — same 4 predicates as trySpymasterMailIntercept.
  const candidates: CourierPayload[] = [];
  for (const c of state.couriers.values()) {
    if (
      c.status === "InFlight" &&
      c.direction === "Inbound" &&
      c.interceptable === true &&
      c.destinationHouseId === PLAYER_HOUSE_ID
    ) {
      candidates.push(c);
    }
  }
  if (candidates.length === 0) return { ok: false, reason: { kind: "NoInFlightCourier" } };
  candidates.sort((a, b) => a.id.localeCompare(b.id));
  const burnedCourier = candidates[0];
  if (burnedCourier === undefined) {
    throw new Error("applyThwartTheftPure: candidates non-empty but no entry");
  }
  // All gates passed — apply effects atomically.
  const newHouses = new Map(state.houses);
  newHouses.set(playerHouse.id, {
    ...playerHouse,
    wealth: playerHouse.wealth - THWART_WEALTH_COST,
  });
  const newCouriers: Map<CourierPayloadId, CourierPayload> = new Map(state.couriers);
  newCouriers.set(burnedCourier.id, { ...burnedCourier, status: "Intercepted" });
  // Roll for thwart success.
  const rngState = getOrThrow(state.rng, PLAYER_HOUSE_ID);
  const { next: roll, rngState: nextRng } = drawNext(rngState);
  const newRng = new Map(state.rng);
  newRng.set(PLAYER_HOUSE_ID, nextRng);
  const success = Math.floor(roll * 10000) < THWART_SUCCESS_PROBABILITY_BASIS_POINTS;
  const newAttempts = new Map(state.thiefAttempts);
  newAttempts.set(attempt.id, {
    ...attempt,
    thwarted: success,
    resolvedAtTick: state.tick,
  });
  let newArtifactInstances = state.artifactInstances;
  let newCharacters = state.characters;
  if (!success) {
    // Theft succeeds — remove artifact from owner + state.artifactInstances.
    const inst = state.artifactInstances.get(attempt.targetedArtifactInstanceId);
    if (inst) {
      newArtifactInstances = new Map(state.artifactInstances);
      newArtifactInstances.delete(inst.id);
      const owner = state.characters.get(inst.ownerCharacterId);
      if (owner) {
        newCharacters = new Map(state.characters);
        newCharacters.set(owner.id, {
          ...owner,
          equippedArtifactIds: owner.equippedArtifactIds.filter((x) => x !== inst.id),
        });
      }
    }
  }
  return {
    ok: true,
    state: {
      ...state,
      houses: newHouses,
      couriers: newCouriers,
      rng: newRng,
      thiefAttempts: newAttempts,
      artifactInstances: newArtifactInstances,
      characters: newCharacters,
    },
    outcome: success ? "Thwarted" : "Stolen",
  };
}

// Pre-ball composure penalty. Called from enterBallroom wrapper BEFORE
// beginSession. Computes total penalty across player head's equipped
// out-of-season artifacts; deducts from composure (clamped at 0).
// Returns state unchanged if zero out-of-season artifacts (structural-sharing
// short-circuit avoids no-op set() in the wrapper).
export function applyPreBallComposurePenaltyPure(state: GameState): GameState {
  const player = state.houses.get(PLAYER_HOUSE_ID);
  if (!player) return state;
  const playerHead = state.characters.get(player.headOfHouseCharacterId);
  if (!playerHead || !playerHead.alive) return state;
  let outOfSeasonPenalty = 0;
  for (const instId of playerHead.equippedArtifactIds) {
    const inst = state.artifactInstances.get(instId);
    if (!inst) continue;
    if (state.tick - inst.lastRefreshTick > WARDROBE_REFRESH_INTERVAL_TICKS) {
      outOfSeasonPenalty += PRE_BALL_COMPOSURE_PENALTY_PER_OUT_OF_SEASON_ARTIFACT;
    }
  }
  if (outOfSeasonPenalty === 0) return state;
  const newComposure = clamp(playerHead.composure - outOfSeasonPenalty, 0, playerHead.maxComposure);
  const newChars = new Map(state.characters);
  newChars.set(playerHead.id, { ...playerHead, composure: newComposure });
  return { ...state, characters: newChars };
}
