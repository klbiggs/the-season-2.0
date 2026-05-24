// P15: full v1 → v14 chain. Asserts:
//   hashState(fromSaveV14(runMigrations(saveV1, 1, 14, MIGRATIONS))) ===
//   hashState(createInitialState(seed, DEFAULT_CAMPAIGN_NAME))
//
// P15 has no bootstrap seeding (the 4 dynasty-legacy House fields default
// empty/0 on both fresh-state AND legacy-lift paths), so hash parity holds
// trivially across the v13→v14 hop. The v1→v13 chain parity established in
// v1-to-v13-chain.test.ts persists transitively.

import { describe, expect, it } from "vitest";
import { hashState } from "../../game/hash";
import { NEGATIVE_CONTROL_SEED, REPLAY_SEEDS } from "../../game/rng.seeds";
import { DEFAULT_CAMPAIGN_NAME, createInitialState } from "../../game/store";
import { SaveV1Schema, type SaveV14, SaveV14Schema, fromSaveV14 } from "../schema";
import { MIGRATIONS } from "./index";
import { runMigrations } from "./runner";

const PARITY_SEEDS = [...REPLAY_SEEDS, NEGATIVE_CONTROL_SEED] as const;

describe("v1 → v14 chain via runMigrations(MIGRATIONS)", () => {
  it.each(PARITY_SEEDS)(
    "seed %s: full chain produces valid SaveV14, hash matches fresh state",
    (seed) => {
      const v1 = SaveV1Schema.parse({
        version: 1,
        tick: 0,
        rng: [["player", { seed, callCount: 0 }]],
      });
      const migrated = runMigrations(v1, 1, 14, MIGRATIONS);
      const v14 = SaveV14Schema.parse(migrated);
      // Prior contracts persist.
      expect(v14.patronesses).toHaveLength(5);
      expect(v14.rivalActors).toHaveLength(3);
      expect(v14.factionTensions).toHaveLength(6);
      expect(v14.elopement).toBeNull();
      // P12 contract: 3 player artifacts + 2 NPC mounts = 5.
      expect(v14.artifactInstances).toHaveLength(5);
      // P13 contracts: empty globalEvents + courierResearchEarned: false.
      expect(v14.globalEvents).toEqual([]);
      // P15 contracts: empty awardedDynastyPerks + zeroed counters on every house.
      for (const [, h] of v14.houses) {
        expect(h.siblingRivals).toEqual([]);
        expect(h.inheritedSecrets).toEqual([]);
        expect(h.bloodFeuds).toEqual([]);
        expect(h.courierResearchEarned).toBe(false);
        expect(h.awardedDynastyPerks).toEqual([]);
        expect(h.consecutiveHeirsNaturalDeath).toBe(0);
        expect(h.cumulativeSuccessfulSeductions).toBe(0);
        expect(h.cumulativeWeaponizedWhispers).toBe(0);
      }
      // Hash parity with fresh state.
      const lifted = fromSaveV14(v14 as SaveV14);
      expect(lifted.artifactInstances.size).toBe(5);
      expect(lifted.globalEvents.size).toBe(0);
      expect(hashState(lifted)).toBe(hashState(createInitialState(seed, DEFAULT_CAMPAIGN_NAME)));
    },
  );
});
