// P5: full v1 → v6 chain test. Mirrors the v1-to-v5-chain test but extends
// through the new v5 → v6 step. Asserts:
//   hashState(fromSaveV6(runMigrations(saveV1, 1, 6, MIGRATIONS))) ===
//   hashState(createInitialState(seed, DEFAULT_CAMPAIGN_NAME))
//
// Hash-equivalence is load-bearing on six conditions (per the plan):
// (a) createInitialState produces empty grievances:[] on every house;
// (b) seedSchemesAndGrievancesIntoLegacyState ALSO produces grievances:[];
// (c) serializeRegistry preserves grievance insertion order (both = empty);
// (d) state.schemes is new Map() in both paths;
// (e) Independent house is seeded by both seedStartingFamily and
//     seedIndependentIntoLegacyState with identical shape;
// (f) accumulatedAffection is never populated by migrations (no in-flight
//     schemes in legacy saves).

import { describe, expect, it } from "vitest";
import { hashState } from "../../game/hash";
import { NEGATIVE_CONTROL_SEED, REPLAY_SEEDS } from "../../game/rng.seeds";
import { DEFAULT_CAMPAIGN_NAME, createInitialState } from "../../game/store";
import { SaveV1Schema, type SaveV6, SaveV6Schema, fromSaveV6 } from "../schema";
import { MIGRATIONS } from "./index";
import { runMigrations } from "./runner";

const PARITY_SEEDS = [...REPLAY_SEEDS, NEGATIVE_CONTROL_SEED] as const;

describe("v1 → v6 chain via runMigrations(MIGRATIONS)", () => {
  it.each(PARITY_SEEDS)(
    "seed %s: full chain produces valid SaveV6, hash matches fresh state",
    (seed) => {
      const v1 = SaveV1Schema.parse({
        version: 1,
        tick: 0,
        rng: [["player", { seed, callCount: 0 }]],
      });
      const migrated = runMigrations(v1, 1, 6, MIGRATIONS);
      const v6 = SaveV6Schema.parse(migrated);
      expect(v6.campaignName).toBe(DEFAULT_CAMPAIGN_NAME);
      expect(v6.era).toBe("Earlier");
      expect(v6.schemes).toEqual([]); // no in-flight schemes in fresh chain
      // Every house has grievances:[]
      for (const [, house] of v6.houses) {
        expect(house.grievances).toEqual([]);
      }
      // Full parity: lifted hash matches fresh state hash
      const lifted = fromSaveV6(v6 as SaveV6);
      expect(hashState(lifted)).toBe(hashState(createInitialState(seed, DEFAULT_CAMPAIGN_NAME)));
    },
  );
});
