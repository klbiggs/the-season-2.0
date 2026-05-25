// P18: full v1 → v16 chain. Asserts:
//   hashState(fromSaveV16(runMigrations(saveV1, 1, 16, MIGRATIONS))) ===
//   hashState(createInitialState(seed, DEFAULT_CAMPAIGN_NAME))
//
// The v15→v16 hop adds state.flavorText (empty on every legacy lift). Both the
// legacy-migration path and createInitialState produce an empty flavorText, so
// hash parity holds. The society contract (count + all single, non-head,
// Independent-house) is still asserted directly.

import { describe, expect, it } from "vitest";
import { PROCEDURAL_NPC_COUNT } from "../../game/constants";
import { hashState } from "../../game/hash";
import { INDEPENDENT_HOUSE_ID } from "../../game/rng";
import { NEGATIVE_CONTROL_SEED, REPLAY_SEEDS } from "../../game/rng.seeds";
import { PROCEDURAL_NPC_ID_PREFIX } from "../../game/rules/proceduralNpcs";
import { DEFAULT_CAMPAIGN_NAME, createInitialState } from "../../game/store";
import { SaveV1Schema, type SaveV16, SaveV16Schema, fromSaveV16 } from "../schema";
import { MIGRATIONS } from "./index";
import { runMigrations } from "./runner";

const PARITY_SEEDS = [...REPLAY_SEEDS, NEGATIVE_CONTROL_SEED] as const;

describe("v1 → v16 chain via runMigrations(MIGRATIONS)", () => {
  it.each(PARITY_SEEDS)(
    "seed %s: full chain produces valid SaveV16, hash matches fresh state",
    (seed) => {
      const v1 = SaveV1Schema.parse({
        version: 1,
        tick: 0,
        rng: [["player", { seed, callCount: 0 }]],
      });
      const migrated = runMigrations(v1, 1, 16, MIGRATIONS);
      const v16 = SaveV16Schema.parse(migrated);

      // Prior contracts persist.
      expect(v16.patronesses).toHaveLength(5);
      expect(v16.rivalActors).toHaveLength(3);
      expect(v16.factionTensions).toHaveLength(6);
      expect(v16.elopement).toBeNull();
      expect(v16.artifactInstances).toHaveLength(5);
      expect(v16.globalEvents).toEqual([]);

      // P18 contract: flavorText is empty on every legacy lift (no retroactive
      // generated content).
      expect(v16.flavorText).toEqual([]);

      // P16 society contract: exactly PROCEDURAL_NPC_COUNT proc-npc-* characters,
      // all single, non-head, in the Independent house.
      const society = v16.characters.filter(([id]) => id.startsWith(PROCEDURAL_NPC_ID_PREFIX));
      expect(society).toHaveLength(PROCEDURAL_NPC_COUNT);
      for (const [, c] of society) {
        expect(c.houseId).toBe(INDEPENDENT_HOUSE_ID);
        expect(c.marriageId).toBeNull();
        expect(c.role).not.toBe("HeadOfHouse");
      }

      // Hash parity with fresh state (proves bootstrap-path society ==
      // legacy-seed-path society + flavorText empty on both).
      const lifted = fromSaveV16(v16 as SaveV16);
      expect(hashState(lifted)).toBe(hashState(createInitialState(seed, DEFAULT_CAMPAIGN_NAME)));
    },
  );
});
