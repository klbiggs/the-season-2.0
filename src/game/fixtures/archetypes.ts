import { z } from "zod";
import type { Character } from "../entities";

// 5 archetypes per spec §3 "Family Archetype Auto-Classification".
// Classification rules ship at P7; P1 ships a stub returning "None".
export const ARCHETYPES = ["Spymaster", "CountryExile", "BohemianRake", "Tutor", "None"] as const;

export type Archetype = (typeof ARCHETYPES)[number];

export const ArchetypeSchema = z.enum(ARCHETYPES);

// §10 Q4 resolution: classification runs ONLY at succession + child maturation
// trigger points; never on mid-life trait acquisition. P1's stub always
// returns "None" so no real reclassification occurs. P7 implements the
// first-match-wins rules and replaces this body. The stub is exported here
// (not at P7's destination) so the succession step can import it stably.
export function classifyArchetype(_character: Character): Archetype {
  return "None";
}
