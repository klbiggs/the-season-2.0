// Pure idempotent v2 → v3 migration. Adds the campaignName field to
// GameState. Default value is DEFAULT_CAMPAIGN_NAME so the migrated save
// matches a fresh save's hash for the same seed (verified by
// v2-to-v3.parity.test.ts).
//
// Draw-budget: ZERO. campaignName is a literal default, never randomized.
// A future "procedurally generated default campaign name" change MUST bump
// the save format past v3 — adding draws to a deployed migration silently
// breaks the parity invariant for every legacy save.
//
// Idempotence: the function is a pure (SaveV2) → SaveV3 mapping with no
// module-level mutation, no time-dependent reads, no RNG. The runner's
// per-step Zod parse deep-clones the result, so the input's nested arrays
// are never aliased into observable output state.

import { DEFAULT_CAMPAIGN_NAME } from "../../game/store";
import type { SaveV2, SaveV3 } from "../schema";

export function migrate_v2_to_v3(save: SaveV2): SaveV3 {
  return {
    version: 3,
    tick: save.tick,
    rng: save.rng,
    houses: save.houses,
    characters: save.characters,
    marriages: save.marriages,
    campaignName: DEFAULT_CAMPAIGN_NAME,
  };
}
