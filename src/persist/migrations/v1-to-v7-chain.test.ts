// P6: full v1 → v7 chain test. Extends the v1-to-v6 chain through the new
// v6 → v7 step. Asserts:
//   hashState(fromSaveV7(runMigrations(saveV1, 1, 7, MIGRATIONS))) ===
//   hashState(createInitialState(seed, DEFAULT_CAMPAIGN_NAME))
//
// Hash-equivalence is load-bearing on:
// (a) createInitialState produces empty grievances:[] AND exiled:false on
//     every house;
// (b) seedSchemesAndGrievancesIntoLegacyState produces grievances:[];
// (c) seedWhispersCouriersStaffIntoLegacyState seeds baseline staff via
//     buildBaselineStaffMap (single source of truth shared with the
//     fresh-state path through seedStartingFamily);
// (d) state.whispers/.couriers are new Map() in both paths;
// (e) serializeRegistry preserves Map.entries insertion-vs-lex order
//     identically across both paths (lex-sort discipline).

import { describe, expect, it } from "vitest";
import { hashState } from "../../game/hash";
import { NEGATIVE_CONTROL_SEED, REPLAY_SEEDS } from "../../game/rng.seeds";
import { DEFAULT_CAMPAIGN_NAME, createInitialState } from "../../game/store";
import { SaveV1Schema, type SaveV7, SaveV7Schema, fromSaveV7 } from "../schema";
import { MIGRATIONS } from "./index";
import { runMigrations } from "./runner";

const PARITY_SEEDS = [...REPLAY_SEEDS, NEGATIVE_CONTROL_SEED] as const;

describe("v1 → v7 chain via runMigrations(MIGRATIONS)", () => {
  it.each(PARITY_SEEDS)(
    "seed %s: full chain produces valid SaveV7, hash matches fresh state",
    (seed) => {
      const v1 = SaveV1Schema.parse({
        version: 1,
        tick: 0,
        rng: [["player", { seed, callCount: 0 }]],
      });
      const migrated = runMigrations(v1, 1, 7, MIGRATIONS);
      const v7 = SaveV7Schema.parse(migrated);
      expect(v7.campaignName).toBe(DEFAULT_CAMPAIGN_NAME);
      expect(v7.era).toBe("Earlier");
      expect(v7.schemes).toEqual([]);
      expect(v7.whispers).toEqual([]);
      expect(v7.couriers).toEqual([]);
      // Baseline staff seeded — 4 entries by lex order
      expect(v7.staff).toHaveLength(4);
      // Every house has exiled:false AND grievances:[]
      for (const [, house] of v7.houses) {
        expect(house.exiled).toBe(false);
        expect(house.grievances).toEqual([]);
      }
      // Full parity: lifted hash matches fresh state hash
      const lifted = fromSaveV7(v7 as SaveV7);
      expect(hashState(lifted)).toBe(hashState(createInitialState(seed, DEFAULT_CAMPAIGN_NAME)));
    },
  );
});
