// Pure idempotent v5 → v6 migration. Bumps to the P5 live format:
//   - Adds `schemes` top-level Map to GameState (empty Map default)
//   - Adds `grievances` array to every House (empty array default)
//
// Body: compose-with-helper-then-reserialize pattern.
//   fromSaveV5Bare deserializes V5 (without re-seeding Independent — V5
//   already has Independent by schema), then seedSchemesAndGrievancesIntoLegacyState
//   defaults schemes + per-house grievances, then toSaveV6 re-serializes as
//   V6 tuple arrays.
//
// Draw budget: ZERO. Every default is a literal constant.

import { type SaveV5, type SaveV6, fromSaveV5, toSaveV6 } from "../schema";

export function migrate_v5_to_v6(save: SaveV5): SaveV6 {
  // fromSaveV5 already composes Bare + seedSchemesAndGrievances; no further
  // seeding needed. The result is a fully-formed V6 GameState ready to
  // reserialize.
  return toSaveV6(fromSaveV5(save));
}
