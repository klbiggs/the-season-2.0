// P9: full v1 → v10 chain test. Extends v1-to-v9 chain through the new
// v9 → v10 step. Asserts:
//   hashState(fromSaveV10(runMigrations(saveV1, 1, 10, MIGRATIONS))) ===
//   hashState(createInitialState(seed, DEFAULT_CAMPAIGN_NAME))
//
// Hash-equivalence depends on:
// (a) createInitialState seeds elopement: null on fresh state.
// (b) migrate_v9_to_v10 sets elopement: null on every legacy lift (ZERO PRNG
//     draws).
// (c) MarriageRecord.viaElopement defaults to false on every legacy marriage
//     via Zod .default(false) parse-side backfill (no marriages exist at
//     fresh-state, so this is a structural-symmetry assertion only).
// (d) The v1-to-v9 chain assertions (P8) continue to hold transitively.

import { describe, expect, it } from "vitest";
import { hashState } from "../../game/hash";
import { NEGATIVE_CONTROL_SEED, REPLAY_SEEDS } from "../../game/rng.seeds";
import { DEFAULT_CAMPAIGN_NAME, createInitialState } from "../../game/store";
import { SaveV1Schema, type SaveV10, SaveV10Schema, fromSaveV10 } from "../schema";
import { MIGRATIONS } from "./index";
import { runMigrations } from "./runner";

const PARITY_SEEDS = [...REPLAY_SEEDS, NEGATIVE_CONTROL_SEED] as const;

describe("v1 → v10 chain via runMigrations(MIGRATIONS)", () => {
  it.each(PARITY_SEEDS)(
    "seed %s: full chain produces valid SaveV10, hash matches fresh state",
    (seed) => {
      const v1 = SaveV1Schema.parse({
        version: 1,
        tick: 0,
        rng: [["player", { seed, callCount: 0 }]],
      });
      const migrated = runMigrations(v1, 1, 10, MIGRATIONS);
      const v10 = SaveV10Schema.parse(migrated);
      // P8 contracts persist through v10.
      expect(v10.patronesses).toHaveLength(5);
      expect(v10.rivalActors).toHaveLength(3);
      expect(v10.factionTensions).toHaveLength(6);
      expect(v10.duels).toHaveLength(0);
      // P9: elopement is null on every legacy lift.
      expect(v10.elopement).toBeNull();
      // Full parity: lifted V10 hash matches fresh-state hash.
      const lifted = fromSaveV10(v10 as SaveV10);
      expect(hashState(lifted)).toBe(hashState(createInitialState(seed, DEFAULT_CAMPAIGN_NAME)));
    },
  );
});
