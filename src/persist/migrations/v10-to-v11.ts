// Pure idempotent v10 → v11 migration. Adds 3 new top-level GameState Maps
// (artifactInstances, forgeries, thiefAttempts) + 1 new Character field
// (equippedArtifactIds: z.array(...).default([])) + the 7th SchemeKind
// (TreasonFraming). The Character widening uses Zod's `.default([])` parse-
// side backfill at the live CharacterSchema — no Pre-shape rebuild required.
//
// Symmetric-seed pattern (P4/P8 precedent): the migration calls
// bootstrapPlayerArtifactsForMigration so legacy V10 saves get the SAME
// starting inventory that createInitialState produces on a fresh build.
// Without this, the v1-to-v11-chain.test.ts byte-identity assertion
// mathematically cannot hold.
//
// Composition follows the established Bare+wrap precedent:
//   migrate_v10_to_v11 = toSaveV11 ∘ bootstrapPlayerArtifactsForMigration ∘ {
//     ...fromSaveV10Bare,
//     artifactInstances: empty Map,
//     forgeries: empty Map,
//     thiefAttempts: empty Map,
//   }
//
// Draw budget: ZERO. The migration is a pure shape transformation; no PRNG
// consumed. The bootstrap helper uses deterministic state-walk counters for
// ids (no draws). Verified by:
//   expect(migrate_v10_to_v11(save).rng).toEqual(save.rng)
// at v10-to-v11.test.ts.

import { bootstrapPlayerArtifactsForMigration } from "../../game/bootstrap";
import type { ArtifactInstance, ForgeryRecord, ThiefAttempt } from "../../game/entities";
import type { ArtifactInstanceId, ForgeryId, ThiefAttemptId } from "../../game/rng";
import { type SaveV10, type SaveV11, fromSaveV10Bare, toSaveV11 } from "../schema";

export function migrate_v10_to_v11(save: SaveV10): SaveV11 {
  const bare = fromSaveV10Bare(save);
  // P10: three new top-level Maps default empty; bootstrapPlayerArtifactsForMigration
  // then seeds player starting inventory symmetric with createInitialState.
  // bootstrapPlayerArtifactsForMigration is idempotent — if the input already
  // has populated artifactInstances or equippedArtifactIds (shouldn't happen
  // post-Bare, but guards the migration-runner double-call path), returns
  // state unchanged.
  const seeded = bootstrapPlayerArtifactsForMigration({
    ...bare,
    artifactInstances: new Map<ArtifactInstanceId, ArtifactInstance>(),
    forgeries: new Map<ForgeryId, ForgeryRecord>(),
    thiefAttempts: new Map<ThiefAttemptId, ThiefAttempt>(),
  });
  return toSaveV11(seeded);
}
