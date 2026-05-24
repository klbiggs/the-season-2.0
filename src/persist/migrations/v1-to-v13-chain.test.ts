// P13: full v1 → v13 chain. Asserts:
//   hashState(fromSaveV13(runMigrations(saveV1, 1, 13, MIGRATIONS))) ===
//   hashState(createInitialState(seed, DEFAULT_CAMPAIGN_NAME))
//
// P13 has no bootstrap seeding (globalEvents defaults empty on both fresh-state
// AND legacy-lift paths; House.courierResearchEarned defaults false via Zod
// backfill on both), so hash parity holds trivially across the v12→v13 hop.
// The v1→v12 chain parity established in v1-to-v12-chain.test.ts persists
// transitively.

import { describe, expect, it } from "vitest";
import { hashState } from "../../game/hash";
import { NEGATIVE_CONTROL_SEED, REPLAY_SEEDS } from "../../game/rng.seeds";
import { DEFAULT_CAMPAIGN_NAME, createInitialState } from "../../game/store";
import { SaveV1Schema, type SaveV13, SaveV13Schema, fromSaveV13 } from "../schema";
import { MIGRATIONS } from "./index";
import { runMigrations } from "./runner";

const PARITY_SEEDS = [...REPLAY_SEEDS, NEGATIVE_CONTROL_SEED] as const;

describe("v1 → v13 chain via runMigrations(MIGRATIONS)", () => {
  it.each(PARITY_SEEDS)(
    "seed %s: full chain produces valid SaveV13, hash matches fresh state",
    (seed) => {
      const v1 = SaveV1Schema.parse({
        version: 1,
        tick: 0,
        rng: [["player", { seed, callCount: 0 }]],
      });
      const migrated = runMigrations(v1, 1, 13, MIGRATIONS);
      const v13 = SaveV13Schema.parse(migrated);
      // Prior contracts persist.
      expect(v13.patronesses).toHaveLength(5);
      expect(v13.rivalActors).toHaveLength(3);
      expect(v13.factionTensions).toHaveLength(6);
      expect(v13.elopement).toBeNull();
      // P12 contract: 3 player artifacts + 2 NPC mounts = 5.
      expect(v13.artifactInstances).toHaveLength(5);
      // P13 contracts: empty globalEvents + courierResearchEarned: false on every house.
      expect(v13.globalEvents).toEqual([]);
      for (const [, h] of v13.houses) {
        expect(h.siblingRivals).toEqual([]);
        expect(h.inheritedSecrets).toEqual([]);
        expect(h.bloodFeuds).toEqual([]);
        expect(h.courierResearchEarned).toBe(false);
      }
      // Hash parity with fresh state.
      const lifted = fromSaveV13(v13 as SaveV13);
      expect(lifted.artifactInstances.size).toBe(5);
      expect(lifted.globalEvents.size).toBe(0);
      expect(hashState(lifted)).toBe(hashState(createInitialState(seed, DEFAULT_CAMPAIGN_NAME)));
    },
  );
});
