// P8: full v1 → v9 chain test. Extends v1-to-v8 chain through the new
// v8 → v9 step. Asserts:
//   hashState(fromSaveV9(runMigrations(saveV1, 1, 9, MIGRATIONS))) ===
//   hashState(createInitialState(seed, DEFAULT_CAMPAIGN_NAME))
//
// Hash-equivalence depends on:
// (a) createInitialState seeds 5 patronesses (PATRONESSES_FIXTURE) + 3 rivals
//     (RIVAL_HOUSES_FIXTURE) + 3 rival actors + 6 faction-tension entries (all 0).
// (b) migrate_v8_to_v9 → seedRivalsAndPatronessesIntoLegacyState produces the
//     same Maps from the same fixtures via the V8→V9 step.
// (c) Both paths derive per-rival RNG seeds via the identical string-concat
//     form `${campaignSeed}|${rivalHouseId}` (no arithmetic).
// (d) serializeRegistry preserves Map.entries lex-sort identically.

import { describe, expect, it } from "vitest";
import { hashState } from "../../game/hash";
import { NEGATIVE_CONTROL_SEED, REPLAY_SEEDS } from "../../game/rng.seeds";
import { DEFAULT_CAMPAIGN_NAME, createInitialState } from "../../game/store";
import { SaveV1Schema, type SaveV9, SaveV9Schema, fromSaveV9 } from "../schema";
import { MIGRATIONS } from "./index";
import { runMigrations } from "./runner";

const PARITY_SEEDS = [...REPLAY_SEEDS, NEGATIVE_CONTROL_SEED] as const;

describe("v1 → v9 chain via runMigrations(MIGRATIONS)", () => {
  it.each(PARITY_SEEDS)(
    "seed %s: full chain produces valid SaveV9, hash matches fresh state",
    (seed) => {
      const v1 = SaveV1Schema.parse({
        version: 1,
        tick: 0,
        rng: [["player", { seed, callCount: 0 }]],
      });
      const migrated = runMigrations(v1, 1, 9, MIGRATIONS);
      const v9 = SaveV9Schema.parse(migrated);
      // P8: 4 new top-level Maps are populated from fixtures.
      expect(v9.patronesses).toHaveLength(5);
      expect(v9.rivalActors).toHaveLength(3);
      expect(v9.factionTensions).toHaveLength(6);
      expect(v9.duels).toHaveLength(0);
      // Every faction-tension entry starts at 0.
      for (const [, t] of v9.factionTensions) {
        expect(t).toBe(0);
      }
      // Full parity: lifted V9 hash matches fresh-state hash.
      const lifted = fromSaveV9(v9 as SaveV9);
      expect(hashState(lifted)).toBe(hashState(createInitialState(seed, DEFAULT_CAMPAIGN_NAME)));
    },
  );
});
