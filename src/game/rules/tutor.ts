// Tutor assignment + trait-choice pure rules. Both are free actions (no tick
// cost). The store wrappers fire from `assignTutor` / `chooseTutorBonusTrait`
// actions — see store.ts. Atomic gating discipline per CLAUDE.md non-
// negotiable §5: validate → deduct → apply.
//
// `assignTutor` rejection variants enumerate every pre-mutation gate; the
// InsufficientWealth predicate at gate 5 ensures the wealth-cost is NOT
// deducted when the action rejects (per spec §10 line 651).
//
// Plan: plans/phases/07-family-succession.md "Tutor assignment + chooseTutorBonusTrait".

import { ADULTHOOD_AGE_IN_YEARS, TUTOR_REASSIGNMENT_WEALTH_COST } from "../constants";
import type { Character, GameState, TutorAssignmentLogEntry } from "../entities";
import {
  ARCHETYPE_MATURATION_TRAIT_POOL,
  type Archetype,
  classifyArchetype,
} from "../fixtures/archetypes";
import { type CharacterId, PLAYER_HOUSE_ID, type TraitId } from "../rng";

export type AssignTutorRejection =
  | { kind: "PlayerExiled" }
  | { kind: "ElopementInProgress" } // P9 Q4
  | { kind: "ChildNotFound" }
  | { kind: "ChildDead" }
  | { kind: "ChildAlreadyAdult" }
  | { kind: "ChildNotPlayerHouse" }
  | { kind: "TutorNotFound" }
  | { kind: "TutorDead" }
  | { kind: "TutorNotPlayerHouse" }
  | { kind: "TutorNotClassified" }
  | { kind: "TutorIsSelf" }
  | { kind: "InsufficientWealth"; current: number; required: number };

export type AssignTutorOutcome =
  | { ok: true; nextState: GameState; reassignmentCount: number }
  | { ok: false; reason: AssignTutorRejection };

export type ChooseTutorBonusTraitRejection =
  | { kind: "PlayerExiled" }
  | { kind: "ElopementInProgress" } // P9 Q4
  | { kind: "NoPendingChoice" }
  | { kind: "InvalidTrait"; valid: readonly TraitId[] }
  | { kind: "ChildDead" };

export type ChooseTutorBonusTraitOutcome =
  | {
      ok: true;
      nextState: GameState;
      // P23: mid-life reclassify info — set when granting the bonus trait
      // changed the child's archetype (the wrapper direct-publishes
      // ArchetypeReclassified with trigger "TraitAcquisition").
      archetypeChanged: { from: Archetype; to: Archetype } | null;
    }
  | { ok: false; reason: ChooseTutorBonusTraitRejection };

export function applyAssignTutorPure(
  state: GameState,
  childCharacterId: CharacterId,
  tutorCharacterId: CharacterId,
): AssignTutorOutcome {
  // Gate 1: PlayerExiled.
  const playerHouse = state.houses.get(PLAYER_HOUSE_ID);
  if (playerHouse?.exiled === true) {
    return { ok: false, reason: { kind: "PlayerExiled" } };
  }
  // Gate 2: child predicates.
  const child = state.characters.get(childCharacterId);
  if (child === undefined) return { ok: false, reason: { kind: "ChildNotFound" } };
  if (!child.alive) return { ok: false, reason: { kind: "ChildDead" } };
  if (child.age >= ADULTHOOD_AGE_IN_YEARS)
    return { ok: false, reason: { kind: "ChildAlreadyAdult" } };
  if (child.houseId !== PLAYER_HOUSE_ID) {
    return { ok: false, reason: { kind: "ChildNotPlayerHouse" } };
  }
  // Gate 3: tutor predicates.
  const tutor = state.characters.get(tutorCharacterId);
  if (tutor === undefined) return { ok: false, reason: { kind: "TutorNotFound" } };
  if (!tutor.alive) return { ok: false, reason: { kind: "TutorDead" } };
  if (tutor.houseId !== PLAYER_HOUSE_ID) {
    return { ok: false, reason: { kind: "TutorNotPlayerHouse" } };
  }
  if (tutor.archetype === "None") {
    return { ok: false, reason: { kind: "TutorNotClassified" } };
  }
  // Gate 4: TutorIsSelf.
  if (tutor.id === child.id) {
    return { ok: false, reason: { kind: "TutorIsSelf" } };
  }
  // Gate 5: reassignment wealth cost. First assignment is free; subsequent
  // assignments cost TUTOR_REASSIGNMENT_WEALTH_COST per spec §10 line 651.
  // Wealth NOT deducted on rejection (atomic-gating contract).
  const prevEntry = state.tutorAssignmentsLog.get(childCharacterId);
  const isReassignment = prevEntry !== undefined;
  const reassignmentCount = isReassignment ? prevEntry.reassignmentCount + 1 : 0;
  if (isReassignment) {
    if (playerHouse === undefined) {
      // Defensive — player house should always exist.
      return {
        ok: false,
        reason: {
          kind: "InsufficientWealth",
          current: 0,
          required: TUTOR_REASSIGNMENT_WEALTH_COST,
        },
      };
    }
    if (playerHouse.wealth < TUTOR_REASSIGNMENT_WEALTH_COST) {
      return {
        ok: false,
        reason: {
          kind: "InsufficientWealth",
          current: playerHouse.wealth,
          required: TUTOR_REASSIGNMENT_WEALTH_COST,
        },
      };
    }
  }

  // ── Gates pass. Apply mutations atomically. ──
  const newChars = new Map(state.characters);
  newChars.set(childCharacterId, { ...child, assignedTutorCharacterId: tutorCharacterId });

  const newLog = new Map(state.tutorAssignmentsLog);
  const logEntry: TutorAssignmentLogEntry = {
    tutorCharacterId,
    assignedAtTick: state.tick,
    reassignmentCount,
  };
  newLog.set(childCharacterId, logEntry);

  // Wealth deduction on reassignment only.
  const newHouses =
    isReassignment && playerHouse !== undefined ? new Map(state.houses) : state.houses;
  if (isReassignment && playerHouse !== undefined) {
    newHouses.set(PLAYER_HOUSE_ID, {
      ...playerHouse,
      wealth: playerHouse.wealth - TUTOR_REASSIGNMENT_WEALTH_COST,
    });
  }

  return {
    ok: true,
    nextState: {
      ...state,
      characters: newChars,
      tutorAssignmentsLog: newLog,
      ...(isReassignment ? { houses: newHouses } : {}),
    },
    reassignmentCount,
  };
}

export function applyChooseTutorBonusTraitPure(
  state: GameState,
  childCharacterId: CharacterId,
  chosenTraitId: TraitId,
): ChooseTutorBonusTraitOutcome {
  // Gate 1: PlayerExiled.
  const playerHouse = state.houses.get(PLAYER_HOUSE_ID);
  if (playerHouse?.exiled === true) {
    return { ok: false, reason: { kind: "PlayerExiled" } };
  }
  // Gate 2: pending-choice exists.
  const pending = state.pendingTutorTraitChoices.get(childCharacterId);
  if (pending === undefined) {
    return { ok: false, reason: { kind: "NoPendingChoice" } };
  }
  // Gate 3: trait is in the pool.
  if (!pending.acceptableTraitIds.includes(chosenTraitId)) {
    return {
      ok: false,
      reason: { kind: "InvalidTrait", valid: pending.acceptableTraitIds },
    };
  }
  // Gate 4: child still alive (defensive — choices can survive across ticks).
  const child = state.characters.get(childCharacterId);
  if (child === undefined || !child.alive) {
    return { ok: false, reason: { kind: "ChildDead" } };
  }

  // ── Gates pass. Apply: append trait (silent no-op on duplicate per
  // C-fc2-10 resolution), flip tutorBonusTraitGranted, clear pending entry. ──
  const newChars = new Map(state.characters);
  const newTraits = child.traits.includes(chosenTraitId)
    ? child.traits // silent no-op on duplicate; traits-list ordering preserved
    : [...child.traits, chosenTraitId];
  // P23 (item D): mid-life reclassify — granting a trait can change the child's
  // archetype (e.g., a Spinster gaining Cunning → Spymaster). Recompute here.
  const withTrait: Character = { ...child, traits: newTraits, tutorBonusTraitGranted: true };
  const newArchetype = classifyArchetype(withTrait);
  const updated: Character = { ...withTrait, archetype: newArchetype };
  newChars.set(childCharacterId, updated);

  const newPending = new Map(state.pendingTutorTraitChoices);
  newPending.delete(childCharacterId);

  return {
    ok: true,
    nextState: {
      ...state,
      characters: newChars,
      pendingTutorTraitChoices: newPending,
    },
    archetypeChanged:
      newArchetype !== child.archetype ? { from: child.archetype, to: newArchetype } : null,
  };
}

// Re-export ARCHETYPE_MATURATION_TRAIT_POOL pin for test consumers.
export { ARCHETYPE_MATURATION_TRAIT_POOL };
