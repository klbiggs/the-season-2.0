// P7: full v1 → v8 chain test. Extends the v1-to-v7 chain through the new
// v7 → v8 step. Asserts:
//   hashState(fromSaveV8(runMigrations(saveV1, 1, 8, MIGRATIONS))) ===
//   hashState(createInitialState(seed, DEFAULT_CAMPAIGN_NAME))
//
// Hash-equivalence is load-bearing on:
// (a) createInitialState produces 3 empty top-level Maps (proposalsLog,
//     tutorAssignmentsLog, pendingTutorTraitChoices);
// (b) migrate_v7_to_v8 produces those same 3 empty Maps via the Bare lift;
// (c) bootstrap + legacy-lift derive gender via the SAME hashCharIdToGender
//     algorithm for every character — the FNV-1a hash is frozen across
//     both paths (per CLAUDE.md P7 convention);
// (d) the 7 new V8 character fields default to the same constants in both
//     paths (happiness=100, temptationHookUnlocked=false, etc.);
// (e) serializeRegistry preserves Map.entries lex-sort identically across
//     both paths.

import { describe, expect, it } from "vitest";
import { hashState } from "../../game/hash";
import { NEGATIVE_CONTROL_SEED, REPLAY_SEEDS } from "../../game/rng.seeds";
import { DEFAULT_CAMPAIGN_NAME, createInitialState } from "../../game/store";
import { SaveV1Schema, type SaveV8, SaveV8Schema, fromSaveV8 } from "../schema";
import { MIGRATIONS } from "./index";
import { runMigrations } from "./runner";

const PARITY_SEEDS = [...REPLAY_SEEDS, NEGATIVE_CONTROL_SEED] as const;

describe("v1 → v8 chain via runMigrations(MIGRATIONS)", () => {
  it.each(PARITY_SEEDS)(
    "seed %s: full chain produces valid SaveV8, hash matches fresh state",
    (seed) => {
      const v1 = SaveV1Schema.parse({
        version: 1,
        tick: 0,
        rng: [["player", { seed, callCount: 0 }]],
      });
      const migrated = runMigrations(v1, 1, 8, MIGRATIONS);
      const v8 = SaveV8Schema.parse(migrated);
      // P7-added fields default to empty.
      expect(v8.proposalsLog).toEqual([]);
      expect(v8.tutorAssignmentsLog).toEqual([]);
      expect(v8.pendingTutorTraitChoices).toEqual([]);
      // Every character carries the 7 V8 field defaults.
      for (const [, c] of v8.characters) {
        expect(c.happiness).toBe(100);
        expect(c.temptationHookUnlocked).toBe(false);
        expect(c.assignedTutorCharacterId).toBeNull();
        expect(c.tutorBonusTraitGranted).toBe(false);
        expect(c.dullSpouseExposureStartTick).toBeNull();
        expect(c.parentCharacterIds).toBeNull();
        expect(["Female", "Male"]).toContain(c.gender);
      }
      // Full parity: lifted V8 hash matches fresh-state hash.
      const lifted = fromSaveV8(v8 as SaveV8);
      expect(hashState(lifted)).toBe(hashState(createInitialState(seed, DEFAULT_CAMPAIGN_NAME)));
    },
  );
});
