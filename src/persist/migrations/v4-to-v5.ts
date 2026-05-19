// Pure idempotent v4 → v5 migration. Bumps to the P4 live format:
//   - Adds conversationHistory + affectionMap (empty Maps)
//   - Adds composure + maxComposure to each Character (default 100)
//   - Seeds the Independent house + 5 baseline NPCs + Independent RNG entry
//     (these did not exist in V4 saves — Independent is a P4 introduction)
//
// Body: compose-with-helper-then-reserialize pattern.
//   fromSaveV4 deserializes V4 AND seeds Independent via
//   seedIndependentIntoLegacyState (idempotent), then toSaveV5
//   re-serializes as V5 tuple arrays.
//
// Draw budget: ZERO. NPC deathAges are constants from the BASELINE_NPCS
// fixture; Independent's RNG seed is deterministically derived from the
// player seed via `${playerSeed}|independent`.

import { type SaveV4, type SaveV5, fromSaveV4, toSaveV5 } from "../schema";

export function migrate_v4_to_v5(save: SaveV4): SaveV5 {
  return toSaveV5(fromSaveV4(save));
}
