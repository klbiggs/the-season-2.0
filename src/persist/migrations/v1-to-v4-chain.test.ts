// Full v1 → v2 → v3 → v4 chain test. Extends v1-to-v3-chain.test.ts to the
// new live save format. Verifies:
//   (a) a valid SaveV1 fed through runMigrations(save, 1, 4, MIGRATIONS)
//       produces a valid SaveV4
//   (b) the final state's era is "Earlier" and houses have all 5 P3 defaults
//   (c) for callCount: 0, final hash matches createInitialState(seed) —
//       parity invariant: lifted-from-V1-chain hash equals fresh hash

import { describe, expect, it } from "vitest";
import { NEGATIVE_CONTROL_SEED, REPLAY_SEEDS } from "../../game/rng.seeds";
import { PLAYER_HOUSE_ID } from "../../game/rng.seeds";
import { DEFAULT_CAMPAIGN_NAME } from "../../game/store";
import { SaveV1Schema, type SaveV4, SaveV4Schema, fromSaveV4 } from "../schema";
import { MIGRATIONS } from "./index";
import { runMigrations } from "./runner";

const PARITY_SEEDS = [...REPLAY_SEEDS, NEGATIVE_CONTROL_SEED] as const;

describe("v1 → v4 chain via runMigrations(MIGRATIONS)", () => {
  it.each(PARITY_SEEDS)(
    "seed %s: full chain produces valid SaveV4 with era + house defaults",
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
      // P4: find by id (Independent is NOT in v4 chain output — it ships at
      // v4→v5. Player house only here).
      const playerTuple = v4.houses.find(([id]) => id === PLAYER_HOUSE_ID);
      expect(playerTuple).toBeDefined();
      if (playerTuple === undefined) throw new Error("unreachable");
      const house = playerTuple[1];
      expect(house.currentLocation).toBe("Capital");
      expect(house.consecutiveTicksAtCurrentLocation).toBe(0);
      expect(house.lastAudienceTick).toBeNull();
      expect(house.wardrobeLastRefreshTick).toBeNull();
      expect(house.blockadeBypassEarned).toBe(false);
      // P4 NOTE: hashState(lifted) === hashState(createInitialState(seed))
      // parity assertion DROPPED here — fresh state has Independent + 5
      // NPCs + Independent RNG (P4 additions) which aren't in the v4 chain
      // output. Full v1↔fresh parity moves to v1-to-v5-chain.test.ts.
      const lifted = fromSaveV4(v4 as SaveV4);
      expect(lifted.tick).toBe(0);
    },
  );
});
