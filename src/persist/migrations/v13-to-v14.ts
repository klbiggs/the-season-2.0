// Pure idempotent v13 → v14 migration. Adds 4 new House fields
// (awardedDynastyPerks + 3 progress counters). The fields seed empty/0 via the
// Zod .default(...) on HouseSchema + the explicit liftHousesFromPreV14 append
// (defense-in-depth). Empty seeding is the §10 OQ#22 going-forward-only
// contract — no retroactive perk awards on the first load of a migrated save.
//
// Composition follows the established Bare+wrap precedent (mirrors v12-to-v13).
// P15 has NO bootstrap seeding beyond the empty-field append. Migration body is
// the minimal `return toSaveV14(fromSaveV13Bare(save))`.
//
// Draw budget: ZERO. Pure shape transformation.

import { type SaveV13, type SaveV14, fromSaveV13Bare, toSaveV14 } from "../schema";

export function migrate_v13_to_v14(save: SaveV13): SaveV14 {
  return toSaveV14(fromSaveV13Bare(save));
}
