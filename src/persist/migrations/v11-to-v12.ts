// Pure idempotent v11 → v12 migration. Adds 3 new House ledger array fields
// (siblingRivals, inheritedSecrets, bloodFeuds) — all default-empty on legacy
// lift — and widens GRIEVANCE_SOURCES with "BloodFeud" (legacy V11 saves never
// emitted BloodFeud-sourced grievances, so no data needs lifting).
//
// Composition follows the established Bare+wrap precedent. P11 has NO bootstrap
// seeding (new fields default empty), so the migration delegates directly to
// fromSaveV11Bare → toSaveV12. Symmetric with the no-seeding migrations from
// earlier phases (v2-to-v3 era addition; v8-to-v9 rival-seed handled by Bare).
//
// Draw budget: ZERO. Pure shape transformation.

import { type SaveV11, type SaveV12, fromSaveV11Bare, toSaveV12 } from "../schema";

export function migrate_v11_to_v12(save: SaveV11): SaveV12 {
  return toSaveV12(fromSaveV11Bare(save));
}
