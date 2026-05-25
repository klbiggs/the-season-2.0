// P16: pure idempotent v14 → v15 migration. Seeds the procedural society batch
// (PROCEDURAL_NPC_COUNT NPCs into INDEPENDENT_HOUSE_ID) into legacy saves so a
// migrated save matches the fresh-bootstrap society (chain-test parity). No new
// schema field — SaveV15 is structurally identical to SaveV14; the bump marks
// the "society guaranteed present" boundary.
//
// Composition follows the seed-step precedent (mirrors v8-to-v9, NOT v13-to-v14
// which has zero seed step): toSaveV15 ∘ seedProceduralSocietyIntoLegacyState ∘
// fromSaveV14Bare. The society generator consumes its own transient
// `${playerSeed}|procedural-npcs` stream (era pinned "Earlier"), so the migration
// advances no on-save RNG callCount.

import {
  type SaveV14,
  type SaveV15,
  fromSaveV14Bare,
  seedProceduralSocietyIntoLegacyState,
  toSaveV15,
} from "../schema";

// extractPlayerSeed is module-private in schema.ts; re-declared locally per the
// v8-to-v9 precedent. The campaign seed feeds the procedural sub-stream.
function extractPlayerSeed(save: SaveV14): string {
  const entry = save.rng.find(([id]) => id === "player");
  if (entry === undefined) {
    throw new Error("migrate_v14_to_v15: save.rng has no player entry");
  }
  return entry[1].seed;
}

export function migrate_v14_to_v15(save: SaveV14): SaveV15 {
  const bare = fromSaveV14Bare(save);
  const seeded = seedProceduralSocietyIntoLegacyState(bare, extractPlayerSeed(save));
  return toSaveV15(seeded);
}
