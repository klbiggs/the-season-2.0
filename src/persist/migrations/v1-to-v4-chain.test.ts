// Full v1 → v2 → v3 → v4 chain test. Extends v1-to-v3-chain.test.ts to the
// new live save format. Verifies:
//   (a) a valid SaveV1 fed through runMigrations(save, 1, 4, MIGRATIONS)
//       produces a valid SaveV4
//   (b) the final state's era is "Earlier" and houses have all 5 P3 defaults
//   (c) for callCount: 0, final hash matches createInitialState(seed) —
//       parity invariant: lifted-from-V1-chain hash equals fresh hash

import { describe, expect, it } from "vitest";
import { hashState } from "../../game/hash";
import { NEGATIVE_CONTROL_SEED, REPLAY_SEEDS } from "../../game/rng.seeds";
import { DEFAULT_CAMPAIGN_NAME, createInitialState } from "../../game/store";
import { SaveV1Schema, type SaveV4, SaveV4Schema, fromSaveV4 } from "../schema";
import { MIGRATIONS } from "./index";
import { runMigrations } from "./runner";

const PARITY_SEEDS = [...REPLAY_SEEDS, NEGATIVE_CONTROL_SEED] as const;

describe("v1 → v4 chain via runMigrations(MIGRATIONS)", () => {
  it.each(PARITY_SEEDS)(
    "seed %s: full chain produces valid SaveV4 with era, hash matches fresh",
    (seed) => {
      const v1 = SaveV1Schema.parse({
        version: 1,
        tick: 0,
        rng: [["player", { seed, callCount: 0 }]],
      });
      const migrated = runMigrations(v1, 1, 4, MIGRATIONS);
      // (a) valid SaveV4
      const v4 = SaveV4Schema.parse(migrated);
      // (b) era + House defaults present
      expect(v4.era).toBe("Earlier");
      expect(v4.campaignName).toBe(DEFAULT_CAMPAIGN_NAME);
      const [, house] = v4.houses[0]!;
      expect(house.currentLocation).toBe("Capital");
      expect(house.consecutiveTicksAtCurrentLocation).toBe(0);
      expect(house.lastAudienceTick).toBeNull();
      expect(house.wardrobeLastRefreshTick).toBeNull();
      expect(house.blockadeBypassEarned).toBe(false);
      // (c) lifted hash matches fresh state for the same seed
      const lifted = fromSaveV4(v4 as SaveV4);
      expect(hashState(lifted)).toBe(hashState(createInitialState(seed, DEFAULT_CAMPAIGN_NAME)));
    },
  );
});
