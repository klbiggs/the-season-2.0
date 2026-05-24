// Pure idempotent v12 → v13 migration. Adds GameState.globalEvents Map
// (empty on legacy lift — no event mid-flight at migration time) +
// House.courierResearchEarned (Zod .default(false) backfill). The new
// MilitaryOfficer trait is enum-string-only (no save-format change beyond
// what TraitIdSchema's transform already accepts).
//
// Composition follows the established Bare+wrap precedent (mirrors v11-to-v12).
// P13 has NO bootstrap seeding — new field defaults empty; the House field
// defaults via Zod backfill inside HouseSchema parse during fromSaveV12Bare's
// lift step. Migration body is the minimal `return toSaveV13(fromSaveV12Bare(save))`.
//
// Draw budget: ZERO. Pure shape transformation.

import { type SaveV12, type SaveV13, fromSaveV12Bare, toSaveV13 } from "../schema";

export function migrate_v12_to_v13(save: SaveV12): SaveV13 {
  return toSaveV13(fromSaveV12Bare(save));
}
