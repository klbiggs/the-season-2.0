import { z } from "zod";

// P7 widens ROLES from 4 → 7 to support the spec §3 archetype-classifier rules
// at lines 489-496. The classifier reads Role + Traits + gender + marriage:
//   - Spinster role + (Cunning | Observant) → Spymaster archetype.
//   - Bohemian role + (Frivolous | Romantic | Jaded) → BohemianRake archetype.
//   - Tutor role triggered by traits (Intellectual | Sophisticated) + unwed.
//   - Exile role OR (ImpoverishedNobility | Rustic) → CountryExile archetype.
// Note: "Tutor" is an ARCHETYPE, not a Role (an unwed adult with Tutor traits
// stays role=Dependent and classifies to Tutor archetype). Spinster/Bohemian
// roles are mirror-named to the spec's classifier-input categories.
//
// Sibling-rival role ships at P11; staff are a separate StaffMember entity
// (P6), not a Character role.
export const ROLES = [
  "HeadOfHouse",
  "Heir",
  "Dependent",
  "Spouse",
  "Spinster", // NEW at P7 — unwed adult female; classifier prereq for Spymaster.
  "Exile", // NEW at P7 — adult living outside the family seat; CountryExile classifier prereq.
  "Bohemian", // NEW at P7 — unwed adult living an unconventional life; BohemianRake classifier prereq.
] as const;

export type Role = (typeof ROLES)[number];

export const RoleSchema = z.enum(ROLES);
