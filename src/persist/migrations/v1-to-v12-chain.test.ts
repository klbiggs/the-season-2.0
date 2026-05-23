// P11: full v1 → v12 chain. Asserts:
//   hashState(fromSaveV12(runMigrations(saveV1, 1, 12, MIGRATIONS))) ===
//   hashState(createInitialState(seed, DEFAULT_CAMPAIGN_NAME))
//
// P11 has no bootstrap seeding (3 new House fields default to empty arrays
// on both fresh-state AND legacy-lift paths), so hash parity holds trivially
// across the v11→v12 hop. The v1→v11 chain parity established in
// v1-to-v11-chain.test.ts persists transitively.

import { describe, expect, it } from "vitest";
import { hashState } from "../../game/hash";
import { NEGATIVE_CONTROL_SEED, REPLAY_SEEDS } from "../../game/rng.seeds";
import { DEFAULT_CAMPAIGN_NAME, createInitialState } from "../../game/store";
import { SaveV1Schema, type SaveV12, SaveV12Schema, fromSaveV12 } from "../schema";
import { MIGRATIONS } from "./index";
import { runMigrations } from "./runner";

const PARITY_SEEDS = [...REPLAY_SEEDS, NEGATIVE_CONTROL_SEED] as const;

describe("v1 → v12 chain via runMigrations(MIGRATIONS)", () => {
  it.each(PARITY_SEEDS)(
    "seed %s: full chain produces valid SaveV12, hash matches fresh state",
    (seed) => {
      const v1 = SaveV1Schema.parse({
        version: 1,
        tick: 0,
        rng: [["player", { seed, callCount: 0 }]],
      });
      const migrated = runMigrations(v1, 1, 12, MIGRATIONS);
      const v12 = SaveV12Schema.parse(migrated);
      // Prior contracts persist.
      expect(v12.patronesses).toHaveLength(5);
      expect(v12.rivalActors).toHaveLength(3);
      expect(v12.factionTensions).toHaveLength(6);
      expect(v12.elopement).toBeNull();
      // P12: disk-side artifact count grows to 5 — the migration ladder's
      // `migrate_v10_to_v11` step calls `bootstrapPlayerArtifactsForMigration`,
      // which P12 widened to also seed NPC mounts via `bootstrapNpcMountFamily`.
      // Three player artifacts (sapphires/snuffbox/mount) + two NPC mounts
      // (Blackwood/Carrington) = 5 total.
      expect(v12.artifactInstances).toHaveLength(5);
      // P11 contract: empty ledgers on every house.
      for (const [, h] of v12.houses) {
        expect(h.siblingRivals).toEqual([]);
        expect(h.inheritedSecrets).toEqual([]);
        expect(h.bloodFeuds).toEqual([]);
      }
      // P12: lifted V12 size matches the disk-side 5; fromSaveV12 also calls
      // bootstrapNpcMountFamily but the helper is per-NPC idempotent so the
      // double-call doesn't add anything. Hash parity with fresh state holds.
      const lifted = fromSaveV12(v12 as SaveV12);
      expect(lifted.artifactInstances.size).toBe(5);
      expect(hashState(lifted)).toBe(hashState(createInitialState(seed, DEFAULT_CAMPAIGN_NAME)));
    },
  );
});
