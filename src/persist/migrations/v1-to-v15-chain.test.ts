// P16: full v1 → v15 chain. Asserts:
//   hashState(fromSaveV15(runMigrations(saveV1, 1, 15, MIGRATIONS))) ===
//   hashState(createInitialState(seed, DEFAULT_CAMPAIGN_NAME))
//
// The v14→v15 hop seeds the procedural society batch; createInitialState now
// also contains it (via seedStartingFamily). Both paths run the SAME generator
// from the SAME `${seed}|procedural-npcs` transient stream, so the societies are
// byte-identical and hash parity holds. The society contract (count + all
// single, non-head, Independent-house) is asserted directly.

import { describe, expect, it } from "vitest";
import { PROCEDURAL_NPC_COUNT } from "../../game/constants";
import { hashState } from "../../game/hash";
import { INDEPENDENT_HOUSE_ID } from "../../game/rng";
import { NEGATIVE_CONTROL_SEED, REPLAY_SEEDS } from "../../game/rng.seeds";
import { PROCEDURAL_NPC_ID_PREFIX } from "../../game/rules/proceduralNpcs";
import { DEFAULT_CAMPAIGN_NAME, createInitialState } from "../../game/store";
import { SaveV1Schema, type SaveV15, SaveV15Schema, fromSaveV15 } from "../schema";
import { MIGRATIONS } from "./index";
import { runMigrations } from "./runner";

const PARITY_SEEDS = [...REPLAY_SEEDS, NEGATIVE_CONTROL_SEED] as const;

describe("v1 → v15 chain via runMigrations(MIGRATIONS)", () => {
  it.each(PARITY_SEEDS)(
    "seed %s: full chain produces valid SaveV15, hash matches fresh state",
    (seed) => {
      const v1 = SaveV1Schema.parse({
        version: 1,
        tick: 0,
        rng: [["player", { seed, callCount: 0 }]],
      });
      const migrated = runMigrations(v1, 1, 15, MIGRATIONS);
      const v15 = SaveV15Schema.parse(migrated);

      // Prior contracts persist.
      expect(v15.patronesses).toHaveLength(5);
      expect(v15.rivalActors).toHaveLength(3);
      expect(v15.factionTensions).toHaveLength(6);
      expect(v15.elopement).toBeNull();
      expect(v15.artifactInstances).toHaveLength(5);
      expect(v15.globalEvents).toEqual([]);

      // P16 society contract: exactly PROCEDURAL_NPC_COUNT proc-npc-* characters,
      // all single, non-head, in the Independent house.
      const society = v15.characters.filter(([id]) => id.startsWith(PROCEDURAL_NPC_ID_PREFIX));
      expect(society).toHaveLength(PROCEDURAL_NPC_COUNT);
      for (const [, c] of society) {
        expect(c.houseId).toBe(INDEPENDENT_HOUSE_ID);
        expect(c.marriageId).toBeNull();
        expect(c.role).not.toBe("HeadOfHouse");
      }

      // Hash parity with fresh state (proves bootstrap-path society ==
      // legacy-seed-path society).
      const lifted = fromSaveV15(v15 as SaveV15);
      expect(hashState(lifted)).toBe(hashState(createInitialState(seed, DEFAULT_CAMPAIGN_NAME)));
    },
  );
});
