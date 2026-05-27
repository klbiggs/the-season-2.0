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

import {
  ASSASSINATION_SCANDAL_DELTA,
  COURTING_AFFECTION_DELTA,
  ERA_TRANSITION_TICK,
  SABOTAGE_COMPOSURE_DELTA,
  SCHEME_COMPLETION_MOOD_LOCK_COMPOSURE_THRESHOLD,
  SCHEME_COMPLETION_MOOD_LOCK_TICKS,
  SCHEME_ERA_REQUIREMENTS,
  SCHEME_PREREQUISITES,
  SCHEME_TUNING,
  SEDUCTION_AFFECTION_CEILING,
  SEDUCTION_AFFECTION_PER_TICK,
  SEDUCTION_DISCOVERY_SCANDAL,
  SEDUCTION_PERK_AFFECTION_BASE_BONUS,
  SEDUCTION_PERK_DISCOVERY_SCANDAL_MULTIPLIER,
  SEDUCTION_SUSPICION_BASE,
  SEDUCTION_SUSPICION_CEILING,
  SEDUCTION_SUSPICION_SLOPE,
  type SchemeFailureReasonKind,
  type SchemeKind,
  type SchemeStatus,
  TEMPTATION_DISCOUNTED_SCANDAL,
  TREASON_FRAMING_RIVAL_HOSTILITY_DELTA,
  TREASON_FRAMING_RIVAL_REPUTATION_DELTA,
  WAR_EFFORT_SEDUCTION_AFFECTION_MULTIPLIER,
} from "../constants";
import { makePairKey } from "../conversation/types";
import type { GameState, Grievance, Scheme } from "../entities";
import type { Archetype } from "../fixtures/archetypes";
import { makeSchemeId } from "../fixtures/schemeIdFactory";
import {
  type CharacterId,
  type GrievanceId,
  type HouseId,
  PLAYER_HOUSE_ID,
  type SchemeId,
  type TraitId,
  drawNext,
  getOrThrow,
} from "../rng";

import { clamp } from "../util/clamp";
import { getCharacterOrThrow, getHouseOrThrow } from "../util/lookups";
import { pruneOrphanedConversationKeys } from "./aging";
import { hasDynastyPerk, recordPlayerHeadViolentDeath } from "./dynastyLegacies";
import { startElopementSprintFromDiscoveredSeduction } from "./elopement";

// P13: strict-TS-friendly cast of the trait literal for the WarEffort ×
// Seduction multiplier check inside resolveSeduction. Per CLAUDE.md
// "wired-but-inert at v1" pin — no v1 acquisition path produces an
// officer-tagged character, so this trait check is dormant until a future
// v1.5 phase ships an acquisition path.
const MILITARY_OFFICER: TraitId = "MilitaryOfficer" as TraitId;

// ── Public input/result types ────────────────────────────────────────────

export type StartSchemeInput = {
  kind: SchemeKind;
  targetCharacterId: CharacterId | null; // null only for Smuggling
  // P8: optional flag for rival-owned OpenSabotage to bypass wealth deduction
  // (rivals have no UI wealth budget at v1). Default false → wealth deducted
  // as in P5. ALL existing 10 call sites omit this field and preserve P5
  // behavior; only applyRivalActionPhase passes true.
  skipWealthDeduction?: boolean;
  // P11: optional flag for sibling-rival AutoSabotageScheme to bypass the
  // SelfTarget rejection (intra-house Sabotage IS the action's purpose).
  // Default false → SelfTarget rejection still fires for player-elected paths
  // attempting to sabotage own-house characters. Only set true by the
  // sibling-rival action dispatcher.
  skipSelfTargetGate?: boolean;
  // P11: optional override for selectAggressor's archetype-gated pick. When
  // set, the explicit aggressor is used as-is (no archetype validation, no
  // walk). Sibling-rival paths pass their own characterId; player-elected
  // paths leave undefined and selectAggressor runs normally.
  explicitAggressorCharacterId?: CharacterId;
};

export type StartSchemeRejection =
  | { kind: "InsufficientWealth"; have: number; need: number }
  | { kind: "MissingArchetype"; required: readonly Archetype[] }
  | { kind: "WrongEra"; required: "Earlier" | "Later"; current: "Earlier" | "Later" }
  | { kind: "UnclaimedSmugglingPass" }
  | { kind: "SmugglingPastEraEdge"; completionTick: number; eraTransitionTick: number }
  | { kind: "TargetIsDead"; targetId: CharacterId }
  | { kind: "SelfTarget"; targetId: CharacterId }
  | { kind: "PlayerExiled" } // P6 exile-gate variant
  | { kind: "ElopementInProgress" } // P9 Q4 — matches PlayerExiled wrapper-symmetry precedent
  | { kind: "SeductionAlreadyActiveForAggressor"; activeSchemeId: SchemeId }; // P9 Q2
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
  | { kind: "SchemeNotActive"; schemeId: SchemeId; currentStatus: SchemeStatus }
  | { kind: "PlayerExiled" } // P6 exile-gate variant
  | { kind: "ElopementInProgress" }; // P9 Q4

export type CancelSchemeResult =
  | { ok: true; state: GameState }
  | { ok: false; reason: CancelSchemeRejection };

// ── Private helpers ──────────────────────────────────────────────────────

// Aggressor selection: lex-smallest qualifying CharacterId for archetype-
// gated kinds; head-of-house for empty-acceptable kinds. Same character-set
// walk as the MissingArchetype validation step — when validation passes,
// this helper finds at least one match (defense-in-depth throw protects
// against future refactors that decouple the two walks).
function selectAggressor(state: GameState, ownerHouseId: HouseId, kind: SchemeKind): CharacterId {
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
// P9: exported so the cross-rule import from elopement.ts can call it after
// startElopementSprintFromDiscoveredSeduction. Rules → rules is boundary-clean
// per CLAUDE.md non-negotiable #1.
export function flipSchemeStatus(
  baseState: GameState,
  schemeId: SchemeId,
  newStatus: "Completed" | "Cancelled",
): GameState;
export function flipSchemeStatus(
  baseState: GameState,
  schemeId: SchemeId,
  newStatus: "Failed",
  failureReason: SchemeFailureReasonKind,
): GameState;
export function flipSchemeStatus(
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
  // P8: input.skipWealthDeduction bypasses BOTH the gate AND the deduction
  // — used by applyRivalActionPhase OpenSabotage (rivals have no v1 wealth
  // budget per the "cosmetic rival wealth" out-of-scope item).
  const cost = SCHEME_TUNING[kind].wealthCost;
  const skipWealth = input.skipWealthDeduction === true;
  if (!skipWealth && ownerHouse.wealth < cost) {
    return {
      ok: false,
      reason: { kind: "InsufficientWealth", have: ownerHouse.wealth, need: cost },
    };
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
        reason: {
          kind: "SmugglingPastEraEdge",
          completionTick,
          eraTransitionTick: ERA_TRANSITION_TICK,
        },
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
    // P11: skipSelfTargetGate bypasses the SelfTarget rejection — sibling-rival
    // AutoSabotageScheme is intra-house by design (actor in PLAYER house targets player head).
    if (target.houseId === ownerHouseId && input.skipSelfTargetGate !== true) {
      return { ok: false, reason: { kind: "SelfTarget", targetId: targetCharacterId } };
    }
  }

  // All gates passed → deduct wealth + register scheme atomically. Both
  // mutations land in the SAME returned state via shallow Map clones per
  // CLAUDE.md pure-rule structural-sharing contract.
  const durationTicks = SCHEME_TUNING[kind].durationTicks;
  // P11: explicitAggressorCharacterId overrides selectAggressor's archetype-gated
  // pick (sibling-rival passes its own characterId; player-elected C2 picker passes
  // the player's chosen family member). P24a hardening: validate the supplied
  // aggressor against the SAME constraints selectAggressor enforces. The
  // house-level MissingArchetype gate above only proves SOME member of the house
  // qualifies — NOT that the CHOSEN one does. Without this, the C2 picker could
  // assign an ineligible (wrong-archetype) member to an archetype-gated scheme
  // (Chaperone needs Spymaster; Assassination/TreasonFraming need a Rake/Exile),
  // bypassing the prerequisite. Reject (never throw) so the sibling-rival
  // dispatcher degrades to its existing `result.ok ? state` no-op instead of
  // crashing the deterministic tick chain; its AutoSabotageScheme passes a live
  // in-house actor for kind Sabotage (empty prereq), so it is unaffected.
  let aggressorCharacterId: CharacterId;
  if (input.explicitAggressorCharacterId !== undefined) {
    const aggressor = state.characters.get(input.explicitAggressorCharacterId);
    if (
      aggressor === undefined ||
      !aggressor.alive ||
      aggressor.houseId !== ownerHouseId ||
      (acceptable.length > 0 && !acceptable.includes(aggressor.archetype))
    ) {
      return { ok: false, reason: { kind: "MissingArchetype", required: acceptable } };
    }
    aggressorCharacterId = input.explicitAggressorCharacterId;
  } else {
    aggressorCharacterId = selectAggressor(state, ownerHouseId, kind);
  }

  // P9 Q2 gate — per-aggressor Seduction concurrency check.
  // Inserted post-selectAggressor (so aggressorCharacterId is in scope) and
  // pre-wealth-deduction (atomic gating per CLAUDE.md non-negotiable §5).
  // Functionally per-house at v1 because selectAggressor returns the head for
  // Seduction; future-proof for later phases that may widen the aggressor pool.
  if (kind === "Seduction") {
    for (const existing of state.schemes.values()) {
      if (
        existing.kind === "Seduction" &&
        existing.status === "Active" &&
        existing.ownerHouseId === ownerHouseId &&
        existing.aggressorCharacterId === aggressorCharacterId
      ) {
        return {
          ok: false,
          reason: { kind: "SeductionAlreadyActiveForAggressor", activeSchemeId: existing.id },
        };
      }
    }
  }

  const newHouses = new Map(state.houses);
  // P8: gate the wealth-deduction write on skipWealthDeduction. The
  // newHouses.set write is unconditional (always re-writes the owner-slot)
  // but the wealth delta is 0 when skipWealth is true — preserves the
  // structural-sharing contract while making rival-owned schemes free.
  const wealthDelta = skipWealth ? 0 : -cost;
  newHouses.set(ownerHouseId, { ...ownerHouse, wealth: ownerHouse.wealth + wealthDelta });

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
      // P24a: Seduction is processed per-tick (see applySchemeResolutionPhase
      // pass 2). This dispatcher branch keeps the switch exhaustive and routes a
      // direct call through the same per-tick processor.
      return processSeductionTick(state, scheme);
    case "Chaperone":
      return resolveChaperone(state, scheme);
    case "Smuggling":
      return resolveSmuggling(state, scheme);
    case "Assassination":
      return resolveAssassination(state, scheme);
    case "TreasonFraming":
      return resolveTreasonFraming(state, scheme);
  }
}

// P10 — Treason Framing. The 7th scheme kind. Consumes an unsurfaced forgery
// and damages the rival house (rep + hostility). Reuses Scheme.targetCharacterId
// (the rival head's CharacterId) — no schema widening; rival house derived as
// state.characters.get(targetCharacterId).houseId. Lex-first unsurfaced forgery
// is picked deterministically. Vain-NPC cascade does NOT fire on consumption
// (spec §3 line 433 — cascade only fires from the surfacing roll). Caller
// (publishArtifactTransitions diff helper) emits ForgerySurfaced with
// viaConsumption: true so subscribers know the surfacing happened.
function resolveTreasonFraming(state: GameState, scheme: Scheme): GameState {
  const targetId = scheme.targetCharacterId;
  if (targetId === null) {
    throw new Error(`resolveTreasonFraming: scheme ${scheme.id} has no target`);
  }
  const target = state.characters.get(targetId);
  if (target === undefined || !target.alive) {
    return flipSchemeStatus(state, scheme.id, "Failed", "TargetDied");
  }
  // Derive rival house from the target's current houseId — handles same-tick
  // moves that might (in future phases) shift the target between houses.
  const rivalHouse = state.houses.get(target.houseId);
  if (rivalHouse === undefined) {
    throw new Error(`resolveTreasonFraming: target house ${target.houseId} missing`);
  }
  // Pick LEX-FIRST unsurfaced forgery (deterministic).
  let pickedForgeryId: typeof scheme.id | null = null; // brand-narrowed below
  const unsurfacedSorted = [...state.forgeries.values()]
    .filter((f) => !f.surfaced)
    .sort((a, b) => a.id.localeCompare(b.id));
  const picked = unsurfacedSorted[0];
  if (picked === undefined) {
    // tryStartScheme's MissingUnsurfacedForgery gate makes this unreachable
    // via normal dispatch; throw if it somehow fires.
    throw new Error(
      `resolveTreasonFraming: scheme ${scheme.id} completing with no unsurfaced forgery in state`,
    );
  }
  pickedForgeryId = picked.id as unknown as typeof scheme.id;
  void pickedForgeryId; // reference-only — actual flip below
  // Apply effects atomically.
  const newHouses = new Map(state.houses);
  newHouses.set(rivalHouse.id, {
    ...rivalHouse,
    reputation: clamp(rivalHouse.reputation + TREASON_FRAMING_RIVAL_REPUTATION_DELTA, 0, 100),
    hostility: clamp(rivalHouse.hostility + TREASON_FRAMING_RIVAL_HOSTILITY_DELTA, 0, 100),
  });
  const newForgeries = new Map(state.forgeries);
  newForgeries.set(picked.id, { ...picked, surfaced: true, surfacedAtTick: state.tick });
  const afterEffects: GameState = {
    ...state,
    houses: newHouses,
    forgeries: newForgeries,
  };
  return flipSchemeStatus(afterEffects, scheme.id, "Completed");
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
  const newComposure = clamp(target.composure + SABOTAGE_COMPOSURE_DELTA, 0, target.maxComposure);
  // P24a (C6): a completion-driven composure crash below the threshold locks the
  // target Defensive (reuses the moodLockUntilTick field; pure Map clone — NOT
  // the store-layer faux-pas write). Mood drift respects the lock (moods.ts).
  const moodLocked = newComposure < SCHEME_COMPLETION_MOOD_LOCK_COMPOSURE_THRESHOLD;
  const newCharacters = new Map(state.characters);
  newCharacters.set(targetId, {
    ...target,
    composure: newComposure,
    ...(moodLocked
      ? {
          mood: "Defensive" as const,
          moodLockUntilTick: Math.max(
            target.moodLockUntilTick,
            state.tick + SCHEME_COMPLETION_MOOD_LOCK_TICKS,
          ),
        }
      : {}),
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
    // P8: defendant is the aggressor character that ran the scheme. At v1
    // player-perpetrated Sabotage grievances are NOT actionable via
    // demandSatisfaction (player can't sensibly duel themselves), but the
    // field is set explicitly so post-P11 rival-demand-satisfaction paths
    // can resolve it; rival-perpetrated Sabotage at P8 (OpenSabotage via
    // applyRivalActionPhase) carries the rival head id and IS the v1
    // duel-loop trigger.
    defendantCharacterId: scheme.aggressorCharacterId,
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

// P24a (C1, Q6): multi-tick Seduction. Called EVERY tick a Seduction is Active
// (not just at endsAtTick — see applySchemeResolutionPhase pass 2). Each tick:
//   1. accrue affection toward the target (per-tick base × WarEffort multiplier),
//      bumping the scheme's accumulatedAffection (capped at the ceiling);
//   2. roll a suspicion check whose probability RAMPS with accumulatedAffection.
// On a hit → discovery mid-flight (scandal + elopement sprint + Failed/Discovered).
// Reaching endsAtTick without discovery → Completed (+ a one-time perk affection
// bonus + the cumulative-successes counter for player-owned). One draw/tick on
// the owner stream; the target-dead branch draws nothing (call-count invariant).
function processSeductionTick(state: GameState, scheme: Scheme): GameState {
  const targetId = scheme.targetCharacterId;
  if (targetId === null) {
    throw new Error(`processSeductionTick: scheme ${scheme.id} has no target`);
  }
  const target = state.characters.get(targetId);
  if (target === undefined || !target.alive) {
    return flipSchemeStatus(state, scheme.id, "Failed", "TargetDied");
  }

  const key = makePairKey(scheme.ownerHouseId, targetId);
  const isPlayerOwned = scheme.ownerHouseId === PLAYER_HOUSE_ID;

  // 1. Per-tick affection accrual. WarEffort × MilitaryOfficer multiplier applies
  // to the per-tick base (dormant at v1 — no officer acquisition path).
  const aggressor = state.characters.get(scheme.aggressorCharacterId);
  const isOfficer = aggressor?.traits.includes(MILITARY_OFFICER) === true;
  const hasActiveWarEffort = [...state.globalEvents.values()].some((e) => e.kind === "WarEffort");
  const warMultiplier =
    isOfficer && hasActiveWarEffort ? WAR_EFFORT_SEDUCTION_AFFECTION_MULTIPLIER : 1.0;
  const tickDelta = Math.round(SEDUCTION_AFFECTION_PER_TICK * warMultiplier);

  const newAffection = new Map(state.affectionMap);
  newAffection.set(key, clamp((newAffection.get(key) ?? 0) + tickDelta, 0, 100));
  const newAccumulated = Math.min(
    scheme.accumulatedAffection + tickDelta,
    SEDUCTION_AFFECTION_CEILING,
  );
  const newSchemes = new Map(state.schemes);
  newSchemes.set(scheme.id, { ...scheme, accumulatedAffection: newAccumulated });

  // 2. Per-tick suspicion roll (probability ramps with accumulatedAffection).
  const rngState = getOrThrow(state.rng, scheme.ownerHouseId);
  const { next, rngState: postDraw } = drawNext(rngState);
  const newRng = new Map(state.rng);
  newRng.set(scheme.ownerHouseId, postDraw);

  const baseState: GameState = {
    ...state,
    affectionMap: newAffection,
    schemes: newSchemes,
    rng: newRng,
  };

  const suspicion = clamp(
    SEDUCTION_SUSPICION_BASE + newAccumulated * SEDUCTION_SUSPICION_SLOPE,
    0,
    SEDUCTION_SUSPICION_CEILING,
  );
  if (next < suspicion) {
    // Discovered mid-flight. Discovery scandal selection: temptation discount
    // (aggressor's latch + non-spouse target) + P15 perk-halving (player-owned).
    const aggressorMarriage =
      aggressor !== undefined && aggressor.marriageId !== null
        ? state.marriages.get(aggressor.marriageId)
        : undefined;
    const aggressorSpouseId =
      aggressor !== undefined && aggressorMarriage !== undefined && !aggressorMarriage.dissolved
        ? aggressorMarriage.spouseAId === aggressor.id
          ? aggressorMarriage.spouseBId
          : aggressorMarriage.spouseAId
        : null;
    const targetIsSpouse = aggressorSpouseId !== null && targetId === aggressorSpouseId;
    const selectedScandalDelta =
      aggressor?.temptationHookUnlocked === true && !targetIsSpouse
        ? TEMPTATION_DISCOUNTED_SCANDAL
        : SEDUCTION_DISCOVERY_SCANDAL;
    const scandalDelta =
      isPlayerOwned && hasDynastyPerk(state, "Seduction")
        ? Math.round(selectedScandalDelta * SEDUCTION_PERK_DISCOVERY_SCANDAL_MULTIPLIER)
        : selectedScandalDelta;
    // Mounts the elopement sprint (isPlayerControlled derived from the owner) +
    // applies the discovery scandal; the status flip drives SeductionDiscovered.
    const stateWithScandalAndSprint = startElopementSprintFromDiscoveredSeduction(
      baseState,
      scheme,
      scandalDelta,
    );
    return flipSchemeStatus(stateWithScandalAndSprint, scheme.id, "Failed", "Discovered");
  }

  // Not discovered this tick. Still in flight until endsAtTick.
  if (state.tick < scheme.endsAtTick) {
    return baseState;
  }

  // Reached endsAtTick without discovery → Completed. P15: a one-time perk
  // affection bonus on the successful completion (player-owned) + the cumulative
  // counter (the perk awards at the terminal eval phase).
  let completedState = baseState;
  if (isPlayerOwned && hasDynastyPerk(state, "Seduction")) {
    const a = new Map(completedState.affectionMap);
    a.set(key, clamp((a.get(key) ?? 0) + SEDUCTION_PERK_AFFECTION_BASE_BONUS, 0, 100));
    completedState = { ...completedState, affectionMap: a };
  }
  if (isPlayerOwned) {
    const playerHouse = completedState.houses.get(PLAYER_HOUSE_ID);
    if (playerHouse !== undefined) {
      const newHouses = new Map(completedState.houses);
      newHouses.set(PLAYER_HOUSE_ID, {
        ...playerHouse,
        cumulativeSuccessfulSeductions: playerHouse.cumulativeSuccessfulSeductions + 1,
      });
      completedState = { ...completedState, houses: newHouses };
    }
  }
  return flipSchemeStatus(completedState, scheme.id, "Completed");
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
    if (s.kind === "Seduction" && s.status === "Active" && s.targetCharacterId === targetId) {
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

  // P15: violent-death counter reset must thread INTO the state that flows
  // into prune — a bare recordPlayerHeadViolentDeath(state, targetId) is
  // silently discarded by the inline rebuild (newHouses derives from the
  // original state.houses, not the helper output). The reset writes the
  // PLAYER house entry while the owner-scandal write above targets the
  // assassin's house entry — independent sets, so they compose cleanly.
  const afterReset = recordPlayerHeadViolentDeath(
    { ...state, characters: newCharacters, houses: newHouses },
    targetId,
  );
  // Death-cascade pure-rule call. Assassination is the first tick-phase path
  // that kills a character. pruneOrphanedConversationKeys (extracted from
  // applyAgingStep) walks the orphan-prune body that was previously inlined
  // and only fired from runYearPass. Heir-inheritance comment migrated
  // verbatim with the helper body.
  const afterPrune = pruneOrphanedConversationKeys(afterReset, new Set<CharacterId>([targetId]));
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
  const seductionIds: SchemeId[] = [];
  const otherIds: SchemeId[] = [];
  for (const [id, scheme] of state.schemes) {
    if (scheme.status !== "Active") continue;
    if (scheme.kind === "Seduction") {
      // P24a: Seductions are processed EVERY tick of flight (per-tick accrual +
      // suspicion ramp), NOT only at endsAtTick. Collected regardless of tick.
      seductionIds.push(id);
      continue;
    }
    if (scheme.endsAtTick !== state.tick) continue;
    if (scheme.kind === "Chaperone") {
      chaperoneIds.push(id);
    } else {
      otherIds.push(id);
    }
  }
  chaperoneIds.sort();
  seductionIds.sort();
  otherIds.sort();

  // Pass 1: Chaperones. resolveChaperone scans ALL Active Seductions on the
  // target (incl. mid-flight ones, any tick), flipping them to "Cancelled"
  // BEFORE pass 2 sees them.
  const afterChaperones = chaperoneIds.reduce<GameState>((acc, id) => {
    const scheme = acc.schemes.get(id);
    if (scheme === undefined || scheme.status !== "Active") return acc;
    return resolveSchemeCompletion(acc, scheme);
  }, state);

  // Pass 2: per-tick Seduction processing. Reads each scheme from acc (not a
  // captured ref) so a pass-1 Chaperone's cancel short-circuits here. One draw
  // per Active Seduction per tick on the owner stream (lex-sorted by id).
  const afterSeductions = seductionIds.reduce<GameState>((acc, id) => {
    const scheme = acc.schemes.get(id);
    if (scheme === undefined || scheme.status !== "Active") return acc;
    return processSeductionTick(acc, scheme);
  }, afterChaperones);

  // Pass 3: all other completions at endsAtTick (deterministic, no draws).
  return otherIds.reduce<GameState>((acc, id) => {
    const scheme = acc.schemes.get(id);
    if (scheme === undefined || scheme.status !== "Active") return acc;
    return resolveSchemeCompletion(acc, scheme);
  }, afterSeductions);
}
