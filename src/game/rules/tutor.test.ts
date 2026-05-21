// assignTutor + chooseTutorBonusTrait tests. Atomic gating: rejection paths
// preserve state.houses.wealth (no deduction on InsufficientWealth).
//
// Plan: plans/phases/07-family-succession.md "Tutor assignment + chooseTutorBonusTrait".

import { describe, expect, it } from "vitest";
import {
  makeCharacter,
  makeCharactersMap,
  makeGameState,
  makeHouse,
  makeHousesMap,
} from "../__test-utils__/factories";
import { ADULTHOOD_AGE_IN_YEARS, TUTOR_REASSIGNMENT_WEALTH_COST } from "../constants";
import { type CharacterId, PLAYER_HOUSE_ID, type TraitId } from "../rng";
import { applyAssignTutorPure, applyChooseTutorBonusTraitPure } from "./tutor";

function makeTutorState(
  opts: {
    childAge?: number;
    tutorArchetype?: "Spymaster" | "BohemianRake" | "Tutor" | "CountryExile" | "None";
    tutorAlive?: boolean;
    playerWealth?: number;
    prevAssignment?: boolean;
  } = {},
) {
  const childId = "child" as CharacterId;
  const tutorId = "tutor" as CharacterId;
  const child = makeCharacter({
    id: childId,
    houseId: PLAYER_HOUSE_ID,
    age: opts.childAge ?? 10,
    role: "Dependent",
  });
  const tutor = makeCharacter({
    id: tutorId,
    houseId: PLAYER_HOUSE_ID,
    age: 30,
    archetype: opts.tutorArchetype ?? "Spymaster",
    alive: opts.tutorAlive ?? true,
    role: "Spinster",
  });
  const playerHouse = makeHouse({
    id: PLAYER_HOUSE_ID,
    wealth: opts.playerWealth ?? 100,
  });
  const tutorAssignmentsLog = new Map();
  if (opts.prevAssignment) {
    tutorAssignmentsLog.set(childId, {
      tutorCharacterId: tutorId,
      assignedAtTick: 0,
      reassignmentCount: 0,
    });
  }
  return {
    state: makeGameState({
      characters: makeCharactersMap([child, tutor]),
      houses: makeHousesMap([playerHouse]),
      tutorAssignmentsLog,
    }),
    childId,
    tutorId,
  };
}

describe("applyAssignTutorPure — rejection matrix", () => {
  it("ChildAlreadyAdult rejection for age >= 18", () => {
    const { state, childId, tutorId } = makeTutorState({ childAge: ADULTHOOD_AGE_IN_YEARS });
    const result = applyAssignTutorPure(state, childId, tutorId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.kind).toBe("ChildAlreadyAdult");
  });

  it("TutorNotClassified rejection when tutor archetype is None", () => {
    const { state, childId, tutorId } = makeTutorState({ tutorArchetype: "None" });
    const result = applyAssignTutorPure(state, childId, tutorId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.kind).toBe("TutorNotClassified");
  });

  it("TutorDead rejection", () => {
    const { state, childId, tutorId } = makeTutorState({ tutorAlive: false });
    const result = applyAssignTutorPure(state, childId, tutorId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.kind).toBe("TutorDead");
  });

  it("TutorIsSelf rejection (synthetic child-tutor with classified archetype)", () => {
    // Edge case: same id passed as child + tutor. To reach gate 4 (TutorIsSelf),
    // we must pass gate 3 (tutor classified) — synthesize a child with
    // archetype !== None even though that's not a normal v1 state.
    const id = "self" as CharacterId;
    const c = makeCharacter({
      id,
      houseId: PLAYER_HOUSE_ID,
      age: 10,
      archetype: "Spymaster",
      role: "Dependent",
    });
    const playerHouse = makeHouse({
      id: PLAYER_HOUSE_ID,
      headOfHouseCharacterId: id,
    });
    const state = makeGameState({
      characters: makeCharactersMap([c]),
      houses: makeHousesMap([playerHouse]),
    });
    const result = applyAssignTutorPure(state, id, id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.kind).toBe("TutorIsSelf");
  });
});

describe("applyAssignTutorPure — atomic gating", () => {
  it("InsufficientWealth rejection on reassignment does NOT deduct wealth", () => {
    const { state, childId, tutorId } = makeTutorState({
      prevAssignment: true,
      playerWealth: 3, // < required 5
    });
    const beforeWealth = state.houses.get(PLAYER_HOUSE_ID)?.wealth;
    const result = applyAssignTutorPure(state, childId, tutorId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.kind).toBe("InsufficientWealth");
    // Wealth UNCHANGED — atomic gating.
    if (!result.ok) {
      // state is unchanged via reference on rejection in current impl path.
      expect(state.houses.get(PLAYER_HOUSE_ID)?.wealth).toBe(beforeWealth);
    }
  });

  it("First assignment is FREE (no wealth deduction)", () => {
    const { state, childId, tutorId } = makeTutorState({ playerWealth: 100 });
    const result = applyAssignTutorPure(state, childId, tutorId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.nextState.houses.get(PLAYER_HOUSE_ID)?.wealth).toBe(100);
      expect(result.reassignmentCount).toBe(0);
    }
  });

  it("Reassignment DEDUCTS TUTOR_REASSIGNMENT_WEALTH_COST on success", () => {
    const { state, childId, tutorId } = makeTutorState({
      prevAssignment: true,
      playerWealth: 100,
    });
    const result = applyAssignTutorPure(state, childId, tutorId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.nextState.houses.get(PLAYER_HOUSE_ID)?.wealth).toBe(
        100 - TUTOR_REASSIGNMENT_WEALTH_COST,
      );
      expect(result.reassignmentCount).toBe(1);
    }
  });
});

describe("applyAssignTutorPure — success effects", () => {
  it("sets child.assignedTutorCharacterId", () => {
    const { state, childId, tutorId } = makeTutorState();
    const result = applyAssignTutorPure(state, childId, tutorId);
    if (!result.ok) throw new Error("expected ok");
    expect(result.nextState.characters.get(childId)?.assignedTutorCharacterId).toBe(tutorId);
  });

  it("logs entry in tutorAssignmentsLog with reassignmentCount=0", () => {
    const { state, childId, tutorId } = makeTutorState();
    const result = applyAssignTutorPure(state, childId, tutorId);
    if (!result.ok) throw new Error("expected ok");
    const log = result.nextState.tutorAssignmentsLog.get(childId);
    expect(log?.tutorCharacterId).toBe(tutorId);
    expect(log?.reassignmentCount).toBe(0);
  });
});

describe("applyChooseTutorBonusTraitPure", () => {
  it("NoPendingChoice rejection when no entry exists", () => {
    const { state, childId } = makeTutorState();
    const result = applyChooseTutorBonusTraitPure(state, childId, "Observant" as TraitId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.kind).toBe("NoPendingChoice");
  });

  it("InvalidTrait rejection when chosen not in pool", () => {
    const { state, childId, tutorId } = makeTutorState();
    const newPending = new Map(state.pendingTutorTraitChoices);
    newPending.set(childId, {
      childId,
      tutorId,
      archetype: "Spymaster",
      acceptableTraitIds: ["Observant" as TraitId, "Cunning" as TraitId],
      createdAtTick: 0,
    });
    const stateWithPending = { ...state, pendingTutorTraitChoices: newPending };
    const result = applyChooseTutorBonusTraitPure(stateWithPending, childId, "Random" as TraitId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.kind).toBe("InvalidTrait");
  });

  it("appends chosen trait and flips tutorBonusTraitGranted", () => {
    const { state, childId, tutorId } = makeTutorState();
    const newPending = new Map(state.pendingTutorTraitChoices);
    newPending.set(childId, {
      childId,
      tutorId,
      archetype: "Spymaster",
      acceptableTraitIds: ["Observant" as TraitId, "Cunning" as TraitId],
      createdAtTick: 0,
    });
    const stateWithPending = { ...state, pendingTutorTraitChoices: newPending };
    const result = applyChooseTutorBonusTraitPure(stateWithPending, childId, "Cunning" as TraitId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const child = result.nextState.characters.get(childId);
    expect(child?.traits).toContain("Cunning");
    expect(child?.tutorBonusTraitGranted).toBe(true);
    // Pending entry cleared.
    expect(result.nextState.pendingTutorTraitChoices.has(childId)).toBe(false);
  });

  it("silent no-op on duplicate trait (does not double-append)", () => {
    const { state, childId, tutorId } = makeTutorState();
    // Pre-stuff child with "Cunning".
    const child = state.characters.get(childId);
    if (child === undefined) throw new Error("test setup");
    const newChars = new Map(state.characters);
    newChars.set(childId, { ...child, traits: ["Cunning" as TraitId] });
    const newPending = new Map(state.pendingTutorTraitChoices);
    newPending.set(childId, {
      childId,
      tutorId,
      archetype: "Spymaster",
      acceptableTraitIds: ["Observant" as TraitId, "Cunning" as TraitId],
      createdAtTick: 0,
    });
    const stateWithPending = {
      ...state,
      characters: newChars,
      pendingTutorTraitChoices: newPending,
    };
    const result = applyChooseTutorBonusTraitPure(stateWithPending, childId, "Cunning" as TraitId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const childAfter = result.nextState.characters.get(childId);
    expect(childAfter?.traits.filter((t) => t === "Cunning").length).toBe(1);
    expect(childAfter?.tutorBonusTraitGranted).toBe(true);
  });
});
