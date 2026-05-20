// P5: scheme resolver module. Pure rule layer.
//
// Module-wide lookup convention (load-bearing): every state.houses.get(...),
// state.characters.get(...), state.schemes.get(...) call uses typed lookup
// helpers from src/game/util/lookups.ts per the travel.ts:46 /
// locationEffects.ts / monarchsAudience.ts precedent. RNG lookup uses
// `getOrThrow` from rng.ts (Map<HouseId, RngState>-shaped). NEVER use
// non-null assertions like state.houses.get(...)! — the typed-error helpers
// carry better diagnostic messages AND consistency across the module
// prevents subtle defense drift between branches.

import type { Archetype } from "../fixtures/archetypes";
import { makeSchemeId } from "../fixtures/schemeIdFactory";
import { makePairKey } from "../conversation/types";
import {
  ASSASSINATION_SCANDAL_DELTA,
  COURTING_AFFECTION_DELTA,
  ERA_TRANSITION_TICK,
  SABOTAGE_COMPOSURE_DELTA,
  SCHEME_ERA_REQUIREMENTS,
  SCHEME_PREREQUISITES,
  SCHEME_TUNING,
  SEDUCTION_AFFECTION_DELTA_ON_SUCCESS,
  SEDUCTION_DISCOVERY_PROBABILITY,
  type SchemeFailureReasonKind,
  type SchemeKind,
  type SchemeStatus,
} from "../constants";
import type { GameState, Grievance, Scheme } from "../entities";
import {
  type CharacterId,
  type GrievanceId,
  type HouseId,
  type SchemeId,
  drawNext,
  getOrThrow,
} from "../rng";
import { clamp } from "../util/clamp";
import { getCharacterOrThrow, getHouseOrThrow } from "../util/lookups";
import { pruneOrphanedConversationKeys } from "./aging";

// ── Public input/result types ────────────────────────────────────────────

export type StartSchemeInput = {
  kind: SchemeKind;
  targetCharacterId: CharacterId | null; // null only for Smuggling
};

export type StartSchemeRejection =
  | { kind: "InsufficientWealth"; have: number; need: number }
  | { kind: "MissingArchetype"; required: readonly Archetype[] }
  | { kind: "WrongEra"; required: "Earlier" | "Later"; current: "Earlier" | "Later" }
  | { kind: "UnclaimedSmugglingPass" }
  | { kind: "SmugglingPastEraEdge"; completionTick: number; eraTransitionTick: number }
  | { kind: "TargetIsDead"; targetId: CharacterId }
  | { kind: "SelfTarget"; targetId: CharacterId };
// P8+ forward-compat reservation: when rival heads can die mid-tick (P11
// sibling-rival action paths, P13 WarEffort officer deaths), add
// `| { kind: "HeadOfHouseDead"; ownerHouseId: HouseId }` to this union AND
// convert selectAggressor's defense-in-depth throw at the head.alive check
// into a typed rejection. At P5 the throw is correct because the player
// head is always alive at start-of-tick (no tick-phase succession exists yet).

export type StartSchemeResult =
  | { ok: true; schemeId: SchemeId; state: GameState }
  | { ok: false; reason: StartSchemeRejection };

export type CancelSchemeRejection =
  | { kind: "SchemeNotFound"; schemeId: SchemeId }
  | { kind: "SchemeNotActive"; schemeId: SchemeId; currentStatus: SchemeStatus };

export type CancelSchemeResult =
  | { ok: true; state: GameState }
  | { ok: false; reason: CancelSchemeRejection };

export type SchemeFailureReason =
  | { kind: "TargetDiedDuringFlight"; targetId: CharacterId }
  | { kind: "EraFlippedDuringSmuggling" };

export type SchemeTransition =
  | { kind: "Completed"; schemeId: SchemeId }
  | { kind: "Cancelled"; schemeId: SchemeId }
  | { kind: "Failed"; schemeId: SchemeId; reason: SchemeFailureReason }
  | { kind: "SeductionDiscovered"; schemeId: SchemeId; targetCharacterId: CharacterId };

// ── Private helpers ──────────────────────────────────────────────────────

// Aggressor selection: lex-smallest qualifying CharacterId for archetype-
// gated kinds; head-of-house for empty-acceptable kinds. Same character-set
// walk as the MissingArchetype validation step — when validation passes,
// this helper finds at least one match (defense-in-depth throw protects
// against future refactors that decouple the two walks).
function selectAggressor(
  state: GameState,
  ownerHouseId: HouseId,
  kind: SchemeKind,
): CharacterId {
  const acceptable = SCHEME_PREREQUISITES[kind];
  if (acceptable.length === 0) {
    // No archetype gate → aggressor defaults to the owner's head of house.
    const ownerHouse = getHouseOrThrow(state, ownerHouseId);
    const head = state.characters.get(ownerHouse.headOfHouseCharacterId);
    if (head === undefined || !head.alive) {
      // At P5 the player head is always alive at start-of-tick. Future phases
      // with tick-phase head mortality must gate on head.alive upstream OR
      // promote this throw to a typed HeadOfHouseDead rejection (see
      // StartSchemeRejection's reserved comment).
      throw new Error(
        `selectAggressor: head ${ownerHouse.headOfHouseCharacterId} of ${ownerHouseId} is not alive`,
      );
    }
    return ownerHouse.headOfHouseCharacterId;
  }
  // Archetype-gated → lex-smallest CharacterId among living family members
  // whose archetype is in `acceptable`. Same filter as the MissingArchetype
  // validation step in tryStartScheme — keeping the two walks in sync is the
  // load-bearing invariant.
  const matches: CharacterId[] = [];
  for (const c of state.characters.values()) {
    if (c.houseId === ownerHouseId && c.alive && acceptable.includes(c.archetype)) {
      matches.push(c.id);
    }
  }
  matches.sort(); // lex-sort by CharacterId (default .sort() on branded strings)
  if (matches.length === 0) {
    throw new Error(
      `selectAggressor: no qualifying family member in ${ownerHouseId} for kind=${kind} — upstream MissingArchetype validation must have passed in error`,
    );
  }
  return matches[0] as CharacterId;
}

// flipSchemeStatus — overloaded for type-safe Failed-requires-reason.
// Implementation signature requires failureReason explicitly (no default).
// Failed transitions MUST pass the 4-arg form; Completed/Cancelled pass null.
function flipSchemeStatus(
  baseState: GameState,
  schemeId: SchemeId,
  newStatus: "Completed" | "Cancelled",
): GameState;
function flipSchemeStatus(
  baseState: GameState,
  schemeId: SchemeId,
  newStatus: "Failed",
  failureReason: SchemeFailureReasonKind,
): GameState;
function flipSchemeStatus(
  baseState: GameState,
  schemeId: SchemeId,
  newStatus: Exclude<SchemeStatus, "Active">,
  failureReason: SchemeFailureReasonKind | null = null,
): GameState {
  const scheme = baseState.schemes.get(schemeId);
  if (scheme === undefined) {
    throw new Error(`flipSchemeStatus: scheme ${schemeId} not found`);
  }
  const newSchemes = new Map(baseState.schemes);
  newSchemes.set(schemeId, {
    ...scheme,
    status: newStatus,
    resolvedAtTick: baseState.tick,
    failureReason: newStatus === "Failed" ? failureReason : null,
  });
  return { ...baseState, schemes: newSchemes };
}

// ── Validators (public) ──────────────────────────────────────────────────

export function tryStartScheme(
  state: GameState,
  ownerHouseId: HouseId,
  input: StartSchemeInput,
): StartSchemeResult {
  const { kind, targetCharacterId } = input;

  // Validation step order (rationale pinned in plan):
  // (a) precondition asserts that throw (programmer-error inputs from
  //     malformed StartSchemeInput),
  // (b) resource-availability (cheap, owner-house-scoped),
  // (c) state-evolution checks (era, archetype),
  // (d) target-state checks (require dereferencing the target).

  // (a) Precondition asserts (throw — not typed rejection)
  if (kind !== "Smuggling" && targetCharacterId === null) {
    throw new Error(`tryStartScheme: kind=${kind} requires a non-null targetCharacterId`);
  }
  if (kind !== "Smuggling" && targetCharacterId !== null) {
    const target = state.characters.get(targetCharacterId);
    if (target === undefined) {
      throw new Error(`tryStartScheme: target character ${targetCharacterId} not found`);
    }
  }

  const ownerHouse = getHouseOrThrow(state, ownerHouseId);

  // (b) Resource: InsufficientWealth (player's own resource — most-checked
  // failure mode in actual play; surfacing first matches player expectation).
  const cost = SCHEME_TUNING[kind].wealthCost;
  if (ownerHouse.wealth < cost) {
    return { ok: false, reason: { kind: "InsufficientWealth", have: ownerHouse.wealth, need: cost } };
  }

  // (c) State-evolution: MissingArchetype
  const acceptable = SCHEME_PREREQUISITES[kind];
  if (acceptable.length > 0) {
    let found = false;
    for (const c of state.characters.values()) {
      if (c.houseId === ownerHouseId && c.alive && acceptable.includes(c.archetype)) {
        found = true;
        break;
      }
    }
    if (!found) {
      return { ok: false, reason: { kind: "MissingArchetype", required: acceptable } };
    }
  }

  // (c) State-evolution: WrongEra
  const eraReq = SCHEME_ERA_REQUIREMENTS[kind];
  if (eraReq !== null && state.era !== eraReq) {
    return { ok: false, reason: { kind: "WrongEra", required: eraReq, current: state.era } };
  }

  // (c) Smuggling-specific: unclaimed prior pass
  if (kind === "Smuggling" && ownerHouse.blockadeBypassEarned) {
    return { ok: false, reason: { kind: "UnclaimedSmugglingPass" } };
  }

  // (c) Smuggling-specific: would complete past era transition (spec §7)
  if (kind === "Smuggling") {
    const completionTick = state.tick + SCHEME_TUNING.Smuggling.durationTicks;
    if (completionTick > ERA_TRANSITION_TICK) {
      return {
        ok: false,
        reason: { kind: "SmugglingPastEraEdge", completionTick, eraTransitionTick: ERA_TRANSITION_TICK },
      };
    }
  }

  // (d) Target-state checks (only when kind has a target — TargetNotFound
  // already threw above, so targetCharacterId here is guaranteed live).
  if (kind !== "Smuggling" && targetCharacterId !== null) {
    const target = getCharacterOrThrow(state, targetCharacterId);
    if (!target.alive) {
      return { ok: false, reason: { kind: "TargetIsDead", targetId: targetCharacterId } };
    }
    if (target.houseId === ownerHouseId) {
      return { ok: false, reason: { kind: "SelfTarget", targetId: targetCharacterId } };
    }
  }

  // All gates passed → deduct wealth + register scheme atomically. Both
  // mutations land in the SAME returned state via shallow Map clones per
  // CLAUDE.md pure-rule structural-sharing contract.
  const durationTicks = SCHEME_TUNING[kind].durationTicks;
  const aggressorCharacterId = selectAggressor(state, ownerHouseId, kind);
  const newHouses = new Map(state.houses);
  newHouses.set(ownerHouseId, { ...ownerHouse, wealth: ownerHouse.wealth - cost });

  const schemeId = makeSchemeId(state, ownerHouseId, kind);
  const newScheme: Scheme = {
    id: schemeId,
    kind,
    ownerHouseId,
    aggressorCharacterId,
    targetCharacterId,
    startedAtTick: state.tick,
    endsAtTick: state.tick + durationTicks,
    status: "Active",
    resolvedAtTick: null,
    failureReason: null,
    accumulatedAffection: 0, // spec §4 line 543; dead data in v1 (one-shot discovery)
  };
  const newSchemes = new Map(state.schemes);
  newSchemes.set(schemeId, newScheme);

  return {
    ok: true,
    schemeId,
    state: { ...state, houses: newHouses, schemes: newSchemes },
  };
}

export function cancelScheme(state: GameState, schemeId: SchemeId): CancelSchemeResult {
  const scheme = state.schemes.get(schemeId);
  if (scheme === undefined) {
    return { ok: false, reason: { kind: "SchemeNotFound", schemeId } };
  }
  if (scheme.status !== "Active") {
    return {
      ok: false,
      reason: { kind: "SchemeNotActive", schemeId, currentStatus: scheme.status },
    };
  }
  // No wealth refund per spec line 362.
  return { ok: true, state: flipSchemeStatus(state, schemeId, "Cancelled") };
}

// ── Per-kind completion resolver ─────────────────────────────────────────

function resolveSchemeCompletion(state: GameState, scheme: Scheme): GameState {
  switch (scheme.kind) {
    case "Courting":
      return resolveCourting(state, scheme);
    case "Sabotage":
      return resolveSabotage(state, scheme);
    case "Seduction":
      return resolveSeduction(state, scheme);
    case "Chaperone":
      return resolveChaperone(state, scheme);
    case "Smuggling":
      return resolveSmuggling(state, scheme);
    case "Assassination":
      return resolveAssassination(state, scheme);
  }
}

function resolveCourting(state: GameState, scheme: Scheme): GameState {
  // Targets are required for Courting; targetCharacterId is non-null by
  // tryStartScheme's MissingTarget precondition.
  const targetId = scheme.targetCharacterId;
  if (targetId === null) {
    throw new Error(`resolveCourting: scheme ${scheme.id} has no target`);
  }
  const target = state.characters.get(targetId);
  if (target === undefined || !target.alive) {
    return flipSchemeStatus(state, scheme.id, "Failed", "TargetDied");
  }
  // Apply +40 affection (clamped [0, 100]).
  const key = makePairKey(scheme.ownerHouseId, targetId);
  const newAffection = new Map(state.affectionMap);
  const current = newAffection.get(key) ?? 0;
  newAffection.set(key, clamp(current + COURTING_AFFECTION_DELTA, 0, 100));
  const baseState = { ...state, affectionMap: newAffection };
  return flipSchemeStatus(baseState, scheme.id, "Completed");
}

function resolveSabotage(state: GameState, scheme: Scheme): GameState {
  const targetId = scheme.targetCharacterId;
  if (targetId === null) {
    throw new Error(`resolveSabotage: scheme ${scheme.id} has no target`);
  }
  const target = state.characters.get(targetId);
  if (target === undefined || !target.alive) {
    return flipSchemeStatus(state, scheme.id, "Failed", "TargetDied");
  }
  // Apply -30 composure (clamped [0, maxComposure]).
  const newCharacters = new Map(state.characters);
  newCharacters.set(targetId, {
    ...target,
    composure: clamp(target.composure + SABOTAGE_COMPOSURE_DELTA, 0, target.maxComposure),
  });

  // Append a Grievance to the TARGET's house.grievances array (cross-house
  // mutation: player owner pays wealth at start; target's house takes the
  // composure damage AND receives the grievance). At P5 the target's house
  // is always INDEPENDENT_HOUSE_ID per P4's NPC pool; P8 introduces rival
  // houses and partitions grievances accordingly.
  const targetHouse = getHouseOrThrow(state, target.houseId);
  const newHouses = new Map(state.houses);
  const newGrievance: Grievance = {
    id: `${scheme.ownerHouseId}:Sabotage:${scheme.id}` as GrievanceId,
    perpetratorHouseId: scheme.ownerHouseId,
    source: "Sabotage",
    schemeId: scheme.id,
    recordedAtTick: state.tick,
    resolved: false,
  };
  newHouses.set(target.houseId, {
    ...targetHouse,
    grievances: [...targetHouse.grievances, newGrievance],
  });

  const baseState = { ...state, characters: newCharacters, houses: newHouses };
  return flipSchemeStatus(baseState, scheme.id, "Completed");
}

function resolveSeduction(state: GameState, scheme: Scheme): GameState {
  const targetId = scheme.targetCharacterId;
  if (targetId === null) {
    throw new Error(`resolveSeduction: scheme ${scheme.id} has no target`);
  }
  const target = state.characters.get(targetId);
  if (target === undefined || !target.alive) {
    // Target-dead branch: NO draw, NO mutation beyond status flip. Preserves
    // the per-house RNG call-count invariant. A Seduction that completes
    // against a dead target does NOT advance the discovery draw count.
    return flipSchemeStatus(state, scheme.id, "Failed", "TargetDied");
  }
  // Discovery roll on the owner's per-house RNG. drawNext returns
  // { next, rngState } — rename via destructure to `postDraw` (using
  // "state" as the rename target would shadow the outer state).
  const rngState = getOrThrow(state.rng, scheme.ownerHouseId);
  const { next, rngState: postDraw } = drawNext(rngState);
  const discovered = next < SEDUCTION_DISCOVERY_PROBABILITY;
  const newRng = new Map(state.rng);
  newRng.set(scheme.ownerHouseId, postDraw);
  const baseState = { ...state, rng: newRng };

  if (discovered) {
    // Single-publish: status field flips to "Failed" with reason "Discovered";
    // the diff helper's publisher discriminator routes this to a
    // SeductionDiscovered event (NOT SchemeFailed). P9's elopement-sprint
    // overlay listens for SeductionDiscovered.
    return flipSchemeStatus(baseState, scheme.id, "Failed", "Discovered");
  }

  // Not-discovered: apply +80 affection (clamped), flip to Completed.
  const newAffection = new Map(baseState.affectionMap);
  const key = makePairKey(scheme.ownerHouseId, targetId);
  const current = newAffection.get(key) ?? 0;
  newAffection.set(key, clamp(current + SEDUCTION_AFFECTION_DELTA_ON_SUCCESS, 0, 100));
  const stateWithAffection = { ...baseState, affectionMap: newAffection };
  return flipSchemeStatus(stateWithAffection, scheme.id, "Completed");
}

function resolveChaperone(state: GameState, scheme: Scheme): GameState {
  const targetId = scheme.targetCharacterId;
  if (targetId === null) {
    throw new Error(`resolveChaperone: scheme ${scheme.id} has no target`);
  }
  const target = state.characters.get(targetId);
  if (target === undefined || !target.alive) {
    return flipSchemeStatus(state, scheme.id, "Failed", "TargetDied");
  }

  // Find all active Seductions on the same target character. Lex-sort by
  // SchemeId for deterministic cancellation order. The two-pass resolver
  // in applySchemeResolutionPhase ensures Chaperones run BEFORE other-kinds
  // partitions — so any same-tick Seduction is still Active here.
  const matchedSeductionIds: SchemeId[] = [];
  for (const s of state.schemes.values()) {
    if (
      s.kind === "Seduction" &&
      s.status === "Active" &&
      s.targetCharacterId === targetId
    ) {
      matchedSeductionIds.push(s.id);
    }
  }
  matchedSeductionIds.sort();

  // Flip each matched Seduction to Cancelled (NOT Failed — Chaperone is a
  // pre-emptive defensive cancel, semantically distinct from Discovery).
  // No wealth refund to the seducing house (spec line 362 generalizes).
  let acc = state;
  for (const seductionId of matchedSeductionIds) {
    acc = flipSchemeStatus(acc, seductionId, "Cancelled");
  }
  // Chaperone itself completes — even if no matching seductions exist
  // ("vigilant for nothing" still resolves cleanly).
  return flipSchemeStatus(acc, scheme.id, "Completed");
}

function resolveSmuggling(state: GameState, scheme: Scheme): GameState {
  // Completion-time era check (spec §7). At v1 this is unreachable because
  // ERA_TRANSITION_TICK is fixed; defensive against P13 mid-flight era flips.
  if (state.era !== "Earlier") {
    return flipSchemeStatus(state, scheme.id, "Failed", "EraFlipped");
  }
  // Set blockadeBypassEarned = true on the owner house.
  const ownerHouse = getHouseOrThrow(state, scheme.ownerHouseId);
  const newHouses = new Map(state.houses);
  newHouses.set(scheme.ownerHouseId, { ...ownerHouse, blockadeBypassEarned: true });
  const baseState = { ...state, houses: newHouses };
  return flipSchemeStatus(baseState, scheme.id, "Completed");
}

function resolveAssassination(state: GameState, scheme: Scheme): GameState {
  const targetId = scheme.targetCharacterId;
  if (targetId === null) {
    throw new Error(`resolveAssassination: scheme ${scheme.id} has no target`);
  }
  const target = state.characters.get(targetId);
  if (target === undefined || !target.alive) {
    // No double-kill, no scandal applied if already dead.
    return flipSchemeStatus(state, scheme.id, "Failed", "TargetDied");
  }
  // Flip alive=false on target; apply +25 scandal to owner (clamped).
  const newCharacters = new Map(state.characters);
  newCharacters.set(targetId, { ...target, alive: false, diedAtTick: state.tick });

  const ownerHouse = getHouseOrThrow(state, scheme.ownerHouseId);
  const newHouses = new Map(state.houses);
  newHouses.set(scheme.ownerHouseId, {
    ...ownerHouse,
    scandal: clamp(ownerHouse.scandal + ASSASSINATION_SCANDAL_DELTA, 0, 100),
  });

  // Death-cascade pure-rule call. Assassination is the first tick-phase path
  // that kills a character. pruneOrphanedConversationKeys (extracted from
  // applyAgingStep) walks the orphan-prune body that was previously inlined
  // and only fired from runYearPass. Heir-inheritance comment migrated
  // verbatim with the helper body.
  const afterPrune = pruneOrphanedConversationKeys(
    { ...state, characters: newCharacters, houses: newHouses },
    new Set<CharacterId>([targetId]),
  );
  return flipSchemeStatus(afterPrune, scheme.id, "Completed");
}

// ── Orchestrator phase ───────────────────────────────────────────────────

// Two-pass resolver per spec §7 "Chaperone preempts in-flight Seduction".
// Pass 1 walks Chaperones; pass 2 walks all other kinds. Both passes are
// left-folds with lex-sort-by-SchemeId within their kind partition.
// Transitions returned by per-kind resolvers are discarded at the phase
// level — the post-fold `status` + `failureReason` fields on each scheme
// entity are the diff-helper's source of truth.
//
// Why two passes (not single-pass lex-sort): at P8 with rival-owned schemes,
// SchemeId format `${owner}:${kind}:${tick}:${index}` lex-sorts by owner
// FIRST — a rival's Chaperone could sort AFTER the player's Seduction and
// fail to preempt. The partition makes Chaperone-first a structural
// contract, not a lex-sort coincidence.
export function applySchemeResolutionPhase(state: GameState): GameState {
  const chaperoneIds: SchemeId[] = [];
  const otherIds: SchemeId[] = [];
  for (const [id, scheme] of state.schemes) {
    if (scheme.status !== "Active" || scheme.endsAtTick !== state.tick) continue;
    if (scheme.kind === "Chaperone") {
      chaperoneIds.push(id);
    } else {
      otherIds.push(id);
    }
  }
  chaperoneIds.sort();
  otherIds.sort();

  // Pass 1: Chaperones. May flip same-tick Seductions to "Cancelled"
  // BEFORE pass 2 sees them.
  const afterChaperones = chaperoneIds.reduce<GameState>((acc, id) => {
    const scheme = acc.schemes.get(id);
    if (scheme === undefined || scheme.status !== "Active") return acc;
    return resolveSchemeCompletion(acc, scheme);
  }, state);

  // Pass 2: all other kinds. Reading each scheme from acc.schemes.get(id)
  // (not from a captured ref) so a pass-1 Chaperone's cancel of a same-tick
  // Seduction is visible — the Seduction's resolver short-circuits on
  // status !== "Active".
  return otherIds.reduce<GameState>((acc, id) => {
    const scheme = acc.schemes.get(id);
    if (scheme === undefined || scheme.status !== "Active") return acc;
    return resolveSchemeCompletion(acc, scheme);
  }, afterChaperones);
}
