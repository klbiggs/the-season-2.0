import { describe, expect, it } from "vitest";
import { PROCEDURAL_PROFILE_WEIGHTS } from "../constants";
import type { Character } from "../entities";
import type { CharacterId, HouseId, TraitId } from "../rng";
import { classifyArchetype } from "./archetypes";
import { PROCEDURAL_PROFILES } from "./proceduralProfiles";

function syntheticAdult(
  role: Character["role"],
  gender: "Female" | "Male",
  traits: readonly TraitId[],
): Character {
  return {
    id: "synthetic" as CharacterId,
    houseId: "synthetic" as HouseId,
    name: "",
    birthTick: 0,
    age: 30,
    deathAge: 80,
    alive: true,
    diedAtTick: null,
    mood: "Receptive",
    moodLockUntilTick: 0,
    role,
    archetype: "None",
    traits: [...traits],
    marriageId: null,
    composure: 100,
    maxComposure: 100,
    happiness: 100,
    temptationHookUnlocked: false,
    assignedTutorCharacterId: null,
    tutorBonusTraitGranted: false,
    dullSpouseExposureStartTick: null,
    parentCharacterIds: null,
    gender,
    equippedArtifactIds: [],
  };
}

describe("proceduralProfiles", () => {
  it("imports without throwing the module-load invariants", () => {
    // The import above already ran the invariants; reaching here means they passed.
    expect(PROCEDURAL_PROFILES.length).toBe(5);
  });

  it("covers exactly the weight-table keys", () => {
    const profileKeys = new Set(PROCEDURAL_PROFILES.map((p) => p.key));
    const weightKeys = new Set(Object.keys(PROCEDURAL_PROFILE_WEIGHTS));
    expect(profileKeys).toEqual(weightKeys);
  });

  it("weights sum to 100", () => {
    const sum = Object.values(PROCEDURAL_PROFILE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
  });

  it("each profile's guaranteed traits force its intended archetype (both genders when not fixed)", () => {
    for (const p of PROCEDURAL_PROFILES) {
      const genders: ("Female" | "Male")[] = p.fixedGender ? [p.fixedGender] : ["Female", "Male"];
      for (const g of genders) {
        expect(classifyArchetype(syntheticAdult(p.role, g, p.guaranteed))).toBe(p.archetype);
      }
    }
  });

  it("adding ANY pooled trait to the guaranteed set never flips the classification", () => {
    for (const p of PROCEDURAL_PROFILES) {
      const genders: ("Female" | "Male")[] = p.fixedGender ? [p.fixedGender] : ["Female", "Male"];
      for (const g of genders) {
        for (const pooled of p.pooled) {
          const traits = [...p.guaranteed, pooled];
          expect(classifyArchetype(syntheticAdult(p.role, g, traits))).toBe(p.archetype);
        }
      }
    }
  });

  it("BohemianRake guarantees MilitaryOfficer (P16 officer activation)", () => {
    const rake = PROCEDURAL_PROFILES.find((p) => p.key === "BohemianRake");
    expect(rake?.guaranteed).toContain("MilitaryOfficer" as TraitId);
  });

  it("Spymaster is a female Spinster; BohemianRake is a male Bohemian", () => {
    const spy = PROCEDURAL_PROFILES.find((p) => p.key === "Spymaster");
    expect(spy?.role).toBe("Spinster");
    expect(spy?.fixedGender).toBe("Female");
    const rake = PROCEDURAL_PROFILES.find((p) => p.key === "BohemianRake");
    expect(rake?.role).toBe("Bohemian");
    expect(rake?.fixedGender).toBe("Male");
  });
});
