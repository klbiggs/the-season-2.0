import { describe, expect, it } from "vitest";
import { PROCEDURAL_NPC_MAX_AGE, PROCEDURAL_NPC_MIN_AGE } from "../constants";
import { classifyArchetype } from "../fixtures/archetypes";
import { GIVEN_NAMES, SURNAMES, honorificFor } from "../fixtures/nameBanks";
import { INDEPENDENT_HOUSE_ID, type TraitId, createRngState } from "../rng";
import { PROCEDURAL_NPC_ID_PREFIX, generateSocietyNpcs } from "./proceduralNpcs";

const MILITARY_OFFICER = "MilitaryOfficer" as TraitId;

describe("generateSocietyNpcs — determinism", () => {
  it("consumes exactly 8 draws per NPC", () => {
    const rng = createRngState("seed-budget");
    const out = generateSocietyNpcs(rng, "Earlier", 3);
    expect(out.rngState.callCount).toBe(3 * 8);
  });

  it("is identical across 30 runs of the same seed/era/count", () => {
    const baseline = JSON.stringify(
      generateSocietyNpcs(createRngState("replay"), "Earlier", 20).characters,
    );
    for (let i = 0; i < 30; i++) {
      const again = JSON.stringify(
        generateSocietyNpcs(createRngState("replay"), "Earlier", 20).characters,
      );
      expect(again).toBe(baseline);
    }
  });

  it("differs by seed and by era", () => {
    const a = JSON.stringify(generateSocietyNpcs(createRngState("a"), "Earlier", 10).characters);
    const b = JSON.stringify(generateSocietyNpcs(createRngState("b"), "Earlier", 10).characters);
    const earlier = generateSocietyNpcs(createRngState("a"), "Earlier", 10).characters;
    const later = generateSocietyNpcs(createRngState("a"), "Later", 10).characters;
    expect(a).not.toBe(b);
    // Same seed, different era → same draw sequence but names from a different bank.
    expect(JSON.stringify(earlier)).not.toBe(JSON.stringify(later));
  });
});

describe("generateSocietyNpcs — structure", () => {
  const { characters } = generateSocietyNpcs(createRngState("structure"), "Earlier", 20);

  it("mints distinct prefixed ids 0..count-1", () => {
    const ids = characters.map((c) => c.id);
    expect(new Set(ids).size).toBe(20);
    for (let i = 0; i < 20; i++) expect(ids).toContain(`${PROCEDURAL_NPC_ID_PREFIX}${i}`);
  });

  it("are all single, non-head, adult INDEPENDENT-house members with deathAge > age", () => {
    for (const c of characters) {
      expect(c.houseId).toBe(INDEPENDENT_HOUSE_ID);
      expect(c.marriageId).toBeNull();
      expect(c.role).not.toBe("HeadOfHouse");
      expect(c.role).not.toBe("Heir");
      expect(c.alive).toBe(true);
      expect(c.parentCharacterIds).toBeNull();
      expect(c.equippedArtifactIds).toEqual([]);
      expect(c.age).toBeGreaterThanOrEqual(PROCEDURAL_NPC_MIN_AGE);
      expect(c.age).toBeLessThanOrEqual(PROCEDURAL_NPC_MAX_AGE);
      expect(c.deathAge).toBeGreaterThan(c.age);
    }
  });

  it("names come from the era/gender bank with a gender-matched honorific", () => {
    for (const c of characters) {
      const [honorific, given, surname] = c.name.split(" ");
      expect(honorific).toBe(honorificFor(c.gender));
      expect(GIVEN_NAMES.Earlier[c.gender]).toContain(given);
      expect(SURNAMES.Earlier).toContain(surname);
    }
  });

  it("stored archetype equals classifyArchetype(char) for every NPC", () => {
    for (const c of characters) {
      expect(c.archetype).toBe(classifyArchetype(c));
    }
  });

  it("MilitaryOfficer appears ONLY on BohemianRake-archetype (male Bohemian) NPCs", () => {
    for (const c of characters) {
      if (c.traits.includes(MILITARY_OFFICER)) {
        expect(c.archetype).toBe("BohemianRake");
        expect(c.gender).toBe("Male");
        expect(c.role).toBe("Bohemian");
      }
    }
  });
});

describe("generateSocietyNpcs — MilitaryOfficer activation (D3)", () => {
  it("produces at least one officer in a default-size batch", () => {
    // BohemianRake (~20% weight) guarantees MilitaryOfficer; a 20-NPC batch
    // reliably contains officers. Pinned seed makes this deterministic.
    const { characters } = generateSocietyNpcs(createRngState("officers"), "Earlier", 20);
    const officers = characters.filter((c) => c.traits.includes(MILITARY_OFFICER));
    expect(officers.length).toBeGreaterThan(0);
  });
});

describe("generateSocietyNpcs — weight-table distribution (archetype-aware)", () => {
  // Each profile maps 1:1 to a distinct archetype, so the archetype histogram of
  // a large batch is the realized profile distribution. Assert each share is
  // within tolerance of PROCEDURAL_PROFILE_WEIGHTS (None 40 / BohemianRake 20 /
  // Tutor 15 / Spymaster 15 / CountryExile 10).
  it("realized archetype shares track the weight table within ±5%", () => {
    const N = 4000;
    const { characters } = generateSocietyNpcs(createRngState("distribution"), "Earlier", N);
    const counts: Record<string, number> = {};
    for (const c of characters) counts[c.archetype] = (counts[c.archetype] ?? 0) + 1;
    const expected: Record<string, number> = {
      None: 0.4,
      BohemianRake: 0.2,
      Tutor: 0.15,
      Spymaster: 0.15,
      CountryExile: 0.1,
    };
    for (const [archetype, frac] of Object.entries(expected)) {
      const share = (counts[archetype] ?? 0) / N;
      expect(Math.abs(share - frac)).toBeLessThan(0.05);
    }
  });
});
