// Multi-step migration chain test (v1 → v2 → v3) — the actual reason for
// shipping a second registered migration at P2. Verifies:
//   (a) a valid SaveV1 fed through runMigrations(save, 1, 3, MIGRATIONS)
//       produces a valid SaveV3
//   (b) the intermediate v2 state is schema-valid (proved by the runner not
//       throwing during the per-step outputSchema.parse)
//   (c) the final state has campaignName: DEFAULT_CAMPAIGN_NAME
//   (d) for callCount: 0, the final hash matches createInitialState(seed,
//       DEFAULT_CAMPAIGN_NAME) — same parity invariant the existing
//       v1-to-v2.parity test relies on, extended to the full chain
//
// Seed list mirrors v1-to-v2.parity.test.ts: PARITY_SEEDS with 6 entries.

import { describe, expect, it } from "vitest";
import { hashState } from "../../game/hash";
import { NEGATIVE_CONTROL_SEED, REPLAY_SEEDS } from "../../game/rng.seeds";
import { DEFAULT_CAMPAIGN_NAME, createInitialState } from "../../game/store";
import { SaveV1Schema, type SaveV3, SaveV3Schema, fromSaveV3 } from "../schema";
import { MIGRATIONS } from "./index";
import { runMigrations } from "./runner";

const PARITY_SEEDS = [...REPLAY_SEEDS, NEGATIVE_CONTROL_SEED] as const;

describe("v1 → v3 chain via runMigrations(MIGRATIONS)", () => {
  it.each(PARITY_SEEDS)(
    "seed %s: full chain produces valid SaveV3 with campaignName, hash matches fresh",
    (seed) => {
      const v1 = SaveV1Schema.parse({
        version: 1,
        tick: 0,
        rng: [["player", { seed, callCount: 0 }]],
      });
      const migrated = runMigrations(v1, 1, 3, MIGRATIONS);
      // (a) valid SaveV3
      const v3 = SaveV3Schema.parse(migrated);
      // (c) final state has DEFAULT_CAMPAIGN_NAME
      expect(v3.campaignName).toBe(DEFAULT_CAMPAIGN_NAME);
      // (d) final hash matches fresh state with the same seed + default
      // campaign name (the runner walked the chain, the per-step Zod
      // validation passed, and the lifted GameState equals fresh GameState
      // for callCount: 0)
      const lifted = fromSaveV3(v3 as SaveV3);
      expect(hashState(lifted)).toBe(hashState(createInitialState(seed, DEFAULT_CAMPAIGN_NAME)));
    },
  );
});
