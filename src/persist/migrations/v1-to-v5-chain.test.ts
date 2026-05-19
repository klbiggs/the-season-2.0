// Full v1 → v5 chain test. Asserts the FULL parity invariant:
//   hashState(fromSaveV5(runMigrations(saveV1, 1, 5, MIGRATIONS))) ===
//   hashState(createInitialState(seed, DEFAULT_CAMPAIGN_NAME))
// Both sides produce 2-house states (player + Independent) so parity holds
// bit-for-bit. Parallel partial v1-to-v3-chain and v1-to-v4-chain tests
// drop their parity assertions; full parity lives here at P4+.

import { describe, expect, it } from "vitest";
import { hashState } from "../../game/hash";
import { NEGATIVE_CONTROL_SEED, REPLAY_SEEDS } from "../../game/rng.seeds";
import { DEFAULT_CAMPAIGN_NAME, createInitialState } from "../../game/store";
import { SaveV1Schema, type SaveV5, SaveV5Schema, fromSaveV5 } from "../schema";
import { MIGRATIONS } from "./index";
import { runMigrations } from "./runner";

const PARITY_SEEDS = [...REPLAY_SEEDS, NEGATIVE_CONTROL_SEED] as const;

describe("v1 → v5 chain via runMigrations(MIGRATIONS)", () => {
  it.each(PARITY_SEEDS)(
    "seed %s: full chain produces valid SaveV5, hash matches fresh state",
    (seed) => {
      const v1 = SaveV1Schema.parse({
        version: 1,
        tick: 0,
        rng: [["player", { seed, callCount: 0 }]],
      });
      const migrated = runMigrations(v1, 1, 5, MIGRATIONS);
      // (a) valid SaveV5
      const v5 = SaveV5Schema.parse(migrated);
      // (b) final state has DEFAULT_CAMPAIGN_NAME + era
      expect(v5.campaignName).toBe(DEFAULT_CAMPAIGN_NAME);
      expect(v5.era).toBe("Earlier");
      // (c) full parity: lifted hash matches fresh state hash
      const lifted = fromSaveV5(v5 as SaveV5);
      expect(hashState(lifted)).toBe(hashState(createInitialState(seed, DEFAULT_CAMPAIGN_NAME)));
    },
  );
});
