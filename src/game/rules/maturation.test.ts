// applyMaturationStep tests — age-18 boundary, role assignment, archetype
// reclassify, pending tutor-trait choice.
//
// Plan: plans/phases/07-family-succession.md "Maturation step".

import { describe, expect, it } from "vitest";
import { makeCharacter, makeCharactersMap, makeGameState } from "../__test-utils__/factories";
import { ADULTHOOD_AGE_IN_YEARS } from "../constants";
import type { CharacterId, HouseId, TraitId } from "../rng";
import { applyMaturationStep } from "./maturation";

describe("applyMaturationStep — age-18 boundary detection", () => {
  it("fires for character at exact age 18", () => {
    const child = makeCharacter({
      id: "child" as CharacterId,
      age: ADULTHOOD_AGE_IN_YEARS,
      role: "Dependent",
      gender: "Female",
    });
    const state = makeGameState({ characters: makeCharactersMap([child]) });
    const after = applyMaturationStep(state);
    const matured = after.characters.get("child" as CharacterId);
    expect(matured?.role).toBe("Spinster");
  });

  it("does NOT fire for character at age 17", () => {
    const child = makeCharacter({
      id: "child" as CharacterId,
      age: 17,
      role: "Dependent",
      gender: "Female",
    });
    const state = makeGameState({ characters: makeCharactersMap([child]) });
    const after = applyMaturationStep(state);
    expect(after.characters.get("child" as CharacterId)?.role).toBe("Dependent");
  });

  it("does NOT fire for character at age 19 (already matured in a prior year)", () => {
    const child = makeCharacter({
      id: "child" as CharacterId,
      age: 19,
      role: "Dependent",
      gender: "Female",
    });
    const state = makeGameState({ characters: makeCharactersMap([child]) });
    const after = applyMaturationStep(state);
    expect(after.characters.get("child" as CharacterId)?.role).toBe("Dependent");
  });
});

describe("applyMaturationStep — role assignment rules", () => {
  it("unwed adult female → Spinster role", () => {
    const child = makeCharacter({
      id: "child" as CharacterId,
      age: ADULTHOOD_AGE_IN_YEARS,
      role: "Dependent",
      gender: "Female",
      marriageId: null,
    });
    const state = makeGameState({ characters: makeCharactersMap([child]) });
    const after = applyMaturationStep(state);
    expect(after.characters.get("child" as CharacterId)?.role).toBe("Spinster");
  });

  it("unwed adult male with Frivolous → Bohemian role", () => {
    const child = makeCharacter({
      id: "child" as CharacterId,
      age: ADULTHOOD_AGE_IN_YEARS,
      role: "Dependent",
      gender: "Male",
      marriageId: null,
      traits: ["Frivolous" as TraitId],
    });
    const state = makeGameState({ characters: makeCharactersMap([child]) });
    const after = applyMaturationStep(state);
    expect(after.characters.get("child" as CharacterId)?.role).toBe("Bohemian");
  });

  it("unwed adult male WITHOUT Bohemian traits → stays Dependent", () => {
    const child = makeCharacter({
      id: "child" as CharacterId,
      age: ADULTHOOD_AGE_IN_YEARS,
      role: "Dependent",
      gender: "Male",
      marriageId: null,
      traits: [],
    });
    const state = makeGameState({ characters: makeCharactersMap([child]) });
    const after = applyMaturationStep(state);
    expect(after.characters.get("child" as CharacterId)?.role).toBe("Dependent");
  });

  // P25 R1: the rival-house-child → Exile branch is removed, so rival children
  // mature into normal heir-eligible roles (Exile is now unreachable via
  // maturation). Society children were already exempt (P23) — assert both.
  it("rival-house female child matures to Spinster (NOT Exile)", () => {
    const child = makeCharacter({
      id: "child" as CharacterId,
      houseId: "rival-ashford" as HouseId,
      age: ADULTHOOD_AGE_IN_YEARS,
      role: "Dependent",
      gender: "Female",
      marriageId: null,
      traits: [],
    });
    const state = makeGameState({ characters: makeCharactersMap([child]) });
    const after = applyMaturationStep(state);
    expect(after.characters.get("child" as CharacterId)?.role).toBe("Spinster");
  });
});

describe("applyMaturationStep — archetype classification", () => {
  it("Spinster + Cunning → Spymaster archetype", () => {
    const child = makeCharacter({
      id: "child" as CharacterId,
      age: ADULTHOOD_AGE_IN_YEARS,
      role: "Dependent",
      gender: "Female",
      traits: ["Cunning" as TraitId],
    });
    const state = makeGameState({ characters: makeCharactersMap([child]) });
    const after = applyMaturationStep(state);
    const matured = after.characters.get("child" as CharacterId);
    expect(matured?.role).toBe("Spinster");
    expect(matured?.archetype).toBe("Spymaster");
  });

  it("Spinster + non-qualifying traits → None archetype", () => {
    const child = makeCharacter({
      id: "child" as CharacterId,
      age: ADULTHOOD_AGE_IN_YEARS,
      role: "Dependent",
      gender: "Female",
      traits: ["Bold" as TraitId],
    });
    const state = makeGameState({ characters: makeCharactersMap([child]) });
    const after = applyMaturationStep(state);
    expect(after.characters.get("child" as CharacterId)?.archetype).toBe("None");
  });
});

describe("applyMaturationStep — pending tutor-trait choice", () => {
  it("seeds pending choice when tutor archetype is non-None", () => {
    const tutorId = "tutor" as CharacterId;
    const childId = "child" as CharacterId;
    const tutor = makeCharacter({
      id: tutorId,
      age: 30,
      archetype: "Spymaster",
      role: "Spinster",
    });
    const child = makeCharacter({
      id: childId,
      age: ADULTHOOD_AGE_IN_YEARS,
      role: "Dependent",
      gender: "Female",
      assignedTutorCharacterId: tutorId,
    });
    const state = makeGameState({
      tick: 50,
      characters: makeCharactersMap([tutor, child]),
    });
    const after = applyMaturationStep(state);
    const pending = after.pendingTutorTraitChoices.get(childId);
    expect(pending).toBeDefined();
    expect(pending?.archetype).toBe("Spymaster");
    expect(pending?.acceptableTraitIds).toEqual(["Observant", "Cunning"]);
  });

  it("does NOT seed pending choice when no tutor assigned", () => {
    const child = makeCharacter({
      id: "child" as CharacterId,
      age: ADULTHOOD_AGE_IN_YEARS,
      role: "Dependent",
      gender: "Female",
      assignedTutorCharacterId: null,
    });
    const state = makeGameState({ characters: makeCharactersMap([child]) });
    const after = applyMaturationStep(state);
    expect(after.pendingTutorTraitChoices.size).toBe(0);
  });

  it("does NOT seed pending choice when tutor is dead", () => {
    const tutorId = "tutor" as CharacterId;
    const childId = "child" as CharacterId;
    const tutor = makeCharacter({
      id: tutorId,
      alive: false,
      archetype: "Spymaster",
    });
    const child = makeCharacter({
      id: childId,
      age: ADULTHOOD_AGE_IN_YEARS,
      role: "Dependent",
      gender: "Female",
      assignedTutorCharacterId: tutorId,
    });
    const state = makeGameState({ characters: makeCharactersMap([tutor, child]) });
    const after = applyMaturationStep(state);
    expect(after.pendingTutorTraitChoices.size).toBe(0);
  });
});

describe("applyMaturationStep — determinism + zero draws", () => {
  it("does not advance RNG callCount", () => {
    const child = makeCharacter({
      id: "child" as CharacterId,
      age: ADULTHOOD_AGE_IN_YEARS,
      role: "Dependent",
      gender: "Female",
    });
    const state = makeGameState({ characters: makeCharactersMap([child]) });
    const after = applyMaturationStep(state);
    expect(after.rng).toBe(state.rng);
  });

  it("returns state unchanged when no characters cross age 18", () => {
    const state = makeGameState();
    const after = applyMaturationStep(state);
    expect(after).toBe(state);
  });
});
