import { z } from "zod";
import { ADULTHOOD_AGE_IN_YEARS } from "../constants";
import type { Character } from "../entities";
import type { TraitId } from "../rng";

// 5 archetypes per spec §3 "Family Archetype Auto-Classification".
// Classification rules ship at P7; P1 shipped a stub returning "None".
export const ARCHETYPES = ["Spymaster", "CountryExile", "BohemianRake", "Tutor", "None"] as const;

export type Archetype = (typeof ARCHETYPES)[number];

export const ArchetypeSchema = z.enum(ARCHETYPES);

// §3 line 489-496 first-match-wins classifier rules.
// Trait-check convention: classifier uses `new Set(traits).has(...)` because
// branches read the same trait multiple times (Set-membership cost is
// amortized over multiple .has() calls per call). Other rules that read a
// trait ONCE (e.g., maturation's computeMaturationRole) use the cheaper
// `traits.includes(...)` array method directly. Both produce identical
// semantics; the choice is allocation-discipline only.
//
// §10 Q4 resolution: classification runs ONLY at succession + child maturation
// trigger points; never on mid-life trait acquisition. The classifier is
// pure-referentially-transparent — same input always produces same output;
// no RNG draws.
export function classifyArchetype(character: Character): Archetype {
  const traits = new Set(character.traits);
  const role = character.role;
  // Branch 1: Spinster role + (Cunning | Observant) → Spymaster.
  if (
    role === "Spinster" &&
    (traits.has("Cunning" as TraitId) || traits.has("Observant" as TraitId))
  ) {
    return "Spymaster";
  }
  // Branch 2: unwed adult male + (Frivolous | Romantic | Jaded) → BohemianRake.
  if (
    character.gender === "Male" &&
    character.marriageId === null &&
    character.age >= ADULTHOOD_AGE_IN_YEARS &&
    (traits.has("Frivolous" as TraitId) ||
      traits.has("Romantic" as TraitId) ||
      traits.has("Jaded" as TraitId))
  ) {
    return "BohemianRake";
  }
  // Branch 3: unwed adult + (Intellectual | Sophisticated) → Tutor.
  if (
    character.marriageId === null &&
    character.age >= ADULTHOOD_AGE_IN_YEARS &&
    (traits.has("Intellectual" as TraitId) || traits.has("Sophisticated" as TraitId))
  ) {
    return "Tutor";
  }
  // Branch 4: Exile role OR (ImpoverishedNobility | Rustic) → CountryExile.
  if (
    role === "Exile" ||
    traits.has("ImpoverishedNobility" as TraitId) ||
    traits.has("Rustic" as TraitId)
  ) {
    return "CountryExile";
  }
  return "None";
}

// Per-archetype trait pool offered to the player at child maturation (spec §3
// line 475). Snapshot taken at maturation tick T; later resolved by the
// `chooseTutorBonusTrait` action consuming the entry in
// state.pendingTutorTraitChoices.
//
// "None" archetype maps to null — unclassified tutors grant no bonus trait
// (the maturation step skips pending-choice creation when the tutor's
// archetype is None).
export const ARCHETYPE_MATURATION_TRAIT_POOL: Readonly<
  Record<Archetype, readonly [TraitId, TraitId] | null>
> = {
  Spymaster: ["Observant" as TraitId, "Cunning" as TraitId],
  BohemianRake: ["Jaded" as TraitId, "Melancholic" as TraitId],
  Tutor: ["Intellectual" as TraitId, "Sophisticated" as TraitId],
  CountryExile: ["ImpoverishedNobility" as TraitId, "Rustic" as TraitId],
  None: null,
};

// Module-load invariants for the pool table. If "None" is renamed in a future
// phase the assertion fires; if a new archetype is added without an entry the
// trait-grant logic silently no-ops on it.
if (ARCHETYPE_MATURATION_TRAIT_POOL.None !== null) {
  throw new Error(
    "ARCHETYPE_MATURATION_TRAIT_POOL.None must be null (no bonus trait for unclassified)",
  );
}
for (const arch of ARCHETYPES) {
  if (arch === "None") continue;
  const pool = ARCHETYPE_MATURATION_TRAIT_POOL[arch];
  if (pool === null || pool.length !== 2) {
    throw new Error(
      `ARCHETYPE_MATURATION_TRAIT_POOL[${arch}] must have exactly 2 trait entries (got ${pool?.length ?? "null"})`,
    );
  }
}
