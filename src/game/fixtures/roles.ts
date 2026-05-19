import { z } from "zod";

// P1 ships 4 roles. Spec §4 lists 8 (head-of-house / heir / dependent / spinster
// / exile / bohemian / staff / sibling-rival); the 4 missing values defer to
// P6 (staff), P7 (spinster/exile/bohemian via archetype classification), P11
// (sibling-rival). "Spouse" is added at P1 (not in spec) to support
// surviving-spouse promotion semantics in succession step 4.
export const ROLES = ["HeadOfHouse", "Heir", "Dependent", "Spouse"] as const;

export type Role = (typeof ROLES)[number];

export const RoleSchema = z.enum(ROLES);
