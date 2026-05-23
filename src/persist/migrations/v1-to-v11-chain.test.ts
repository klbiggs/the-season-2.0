// P10: full v1 → v11 chain test. Extends v1-to-v10 chain through the new
// v10 → v11 step. Asserts:
//   hashState(fromSaveV11(runMigrations(saveV1, 1, 11, MIGRATIONS))) ===
//   hashState(createInitialState(seed, DEFAULT_CAMPAIGN_NAME))
//
// Hash-equivalence depends on:
// (a) createInitialState seeds 3 player starting artifacts via
//     bootstrapPlayerArtifactsForInit.
// (b) migrate_v10_to_v11 seeds the SAME starting inventory via
//     bootstrapPlayerArtifactsForMigration (symmetric-seed pattern).
// (c) Character.equippedArtifactIds defaults to [] via Zod .default([]).
// (d) The v1-to-v10 chain assertions persist transitively.
//
// Per-step outputSchema validation: walks MIGRATIONS and asserts each
// step's `outputSchema.parse(step.migrate(prev))` succeeds before composing
// the next step. Catches mid-chain strip-cascade drift that final-state
// hash parity would miss.

import { describe, expect, it } from "vitest";
import { hashState } from "../../game/hash";
import { NEGATIVE_CONTROL_SEED, REPLAY_SEEDS } from "../../game/rng.seeds";
import { DEFAULT_CAMPAIGN_NAME, createInitialState } from "../../game/store";
import { SaveV1Schema, type SaveV11, SaveV11Schema, fromSaveV11 } from "../schema";
import { MIGRATIONS } from "./index";
import { runMigrations } from "./runner";

const PARITY_SEEDS = [...REPLAY_SEEDS, NEGATIVE_CONTROL_SEED] as const;

describe("v1 → v11 chain via runMigrations(MIGRATIONS)", () => {
  it.each(PARITY_SEEDS)(
    "seed %s: full chain produces valid SaveV11, hash matches fresh state",
    (seed) => {
      const v1 = SaveV1Schema.parse({
        version: 1,
        tick: 0,
        rng: [["player", { seed, callCount: 0 }]],
      });
      const migrated = runMigrations(v1, 1, 11, MIGRATIONS);
      const v11 = SaveV11Schema.parse(migrated);
      // Prior contracts persist.
      expect(v11.patronesses).toHaveLength(5);
      expect(v11.rivalActors).toHaveLength(3);
      expect(v11.factionTensions).toHaveLength(6);
      expect(v11.elopement).toBeNull();
      // P10 contract: 3 player starting artifacts.
      // P12 widening: `bootstrapPlayerArtifactsForMigration` now ALSO seeds
      // 2 NPC mount instances (Lord Blackwood + Miss Carrington) — total 5.
      // The fresh-state side via `createInitialState` mints the same 5
      // instances via the same helpers, so hash parity holds.
      expect(v11.artifactInstances).toHaveLength(5);
      expect(v11.forgeries).toHaveLength(0);
      expect(v11.thiefAttempts).toHaveLength(0);
      // Full parity: lifted V11 hash matches fresh-state hash.
      const lifted = fromSaveV11(v11 as SaveV11);
      expect(hashState(lifted)).toBe(hashState(createInitialState(seed, DEFAULT_CAMPAIGN_NAME)));
    },
  );

  it("per-step outputSchema validation succeeds at every chain hop", () => {
    const seed = REPLAY_SEEDS[0];
    let current: unknown = SaveV1Schema.parse({
      version: 1,
      tick: 0,
      rng: [["player", { seed, callCount: 0 }]],
    });
    for (const step of MIGRATIONS) {
      const next = step.migrate(current);
      expect(() => step.outputSchema.parse(next)).not.toThrow();
      current = next;
    }
  });
});
