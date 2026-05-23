// Pure idempotent v9 → v10 migration. Adds 1 new top-level field
// (elopement: ElopementSprintState | null) + 1 new MarriageRecord field
// (viaElopement: z.boolean().default(false)). The MarriageRecord widening
// is handled by Zod's `.default(false)` parse-side backfill at the live
// MarriageRecordSchema (no Pre-shape rebuild required — matches the P8
// House.hostility/factionId precedent).
//
// Composition follows the established Bare+wrap precedent:
//   migrate_v9_to_v10 = toSaveV10 ∘ { ...fromSaveV9Bare, elopement: null }
//
// Draw budget: ZERO. No PRNG consumed; the migration is a pure shape
// transformation with one new field (elopement: null) added at the top
// level + zero changes to nested entities (viaElopement is populated by
// the live MarriageRecordSchema's `.default(false)` at Bare deserialization).

import { type SaveV9, type SaveV10, fromSaveV9Bare, toSaveV10 } from "../schema";

export function migrate_v9_to_v10(save: SaveV9): SaveV10 {
  const bare = fromSaveV9Bare(save);
  // P10 widened GameState with three new top-level Maps. toSaveV10 takes a
  // GameState (post-P10 shape) but emits a SaveV10 (pre-P10 shape) — the
  // strip-on-emit cascade drops the three Maps. Pass empty Maps here so the
  // typecheck passes; toSaveV10 ignores them per its strip discipline.
  const seeded = {
    ...bare,
    elopement: null,
    artifactInstances: new Map(),
    forgeries: new Map(),
    thiefAttempts: new Map(),
  };
  return toSaveV10(seeded);
}
