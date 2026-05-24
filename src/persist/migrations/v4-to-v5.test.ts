// migrate_v4_to_v5 tests: byte-identical Independent construction across
// fresh-state (createInitialState) and migration paths. Closes the
// regression-bait gate for seedIndependentIntoLegacyState's correctness.

import { describe, expect, it } from "vitest";
import { BASELINE_NPCS } from "../../game/fixtures/npcs";
import { INDEPENDENT_HOUSE_ID } from "../../game/rng";
import { DEFAULT_CAMPAIGN_NAME, createInitialState } from "../../game/store";
import { type SaveV4, toSaveV4 } from "../schema";
import { migrate_v4_to_v5 } from "./v4-to-v5";

describe("migrate_v4_to_v5 byte-identity vs fresh state", () => {
  it("Independent house + 5 NPCs + Independent RNG match createInitialState", () => {
    const seed = "test-seed";
    // Build a V4 save from a synthetic pre-P4 GameState. The cleanest way:
    // strip Independent + the P4 new fields from a fresh state, serialize
    // to V4, then run the migration and compare against the original
    // fresh state.
    const fresh = createInitialState(seed, DEFAULT_CAMPAIGN_NAME);

    // Build a synthetic V4 by stripping Independent + the new fields from
    // fresh. The stripped state simulates a pre-P4 V4 save on disk.
    const strippedHouses = new Map(fresh.houses);
    strippedHouses.delete(INDEPENDENT_HOUSE_ID);
    const strippedRng = new Map(fresh.rng);
    strippedRng.delete(INDEPENDENT_HOUSE_ID);
    const strippedCharacters = new Map(fresh.characters);
    for (const npc of BASELINE_NPCS) strippedCharacters.delete(npc.id);
    const v4Source = {
      ...fresh,
      houses: strippedHouses,
      characters: strippedCharacters,
      rng: strippedRng,
    };

    const v4Save: SaveV4 = toSaveV4(v4Source);
    const v5Save = migrate_v4_to_v5(v4Save);

    // Independent house byte-identity. P5 widening: SaveV5Schema's house tuple
    // value is now HousePreV6Schema (omits grievances) — toSaveV5 strips
    // grievances on emit. Compare against fresh.houses.get(...) with grievances
    // stripped to match the V5-stage shape.
    const migratedIndy = v5Save.houses.find(([id]) => id === INDEPENDENT_HOUSE_ID);
    const freshIndy = fresh.houses.get(INDEPENDENT_HOUSE_ID);
    expect(migratedIndy).toBeDefined();
    expect(freshIndy).toBeDefined();
    if (freshIndy === undefined) throw new Error("unreachable");
    // P6: SaveV5's houses tuple uses HousePreV6Schema which omits BOTH
    // grievances AND exiled (post-P6 extension). Strip both for comparison.
    // P11: HousePreV6Schema also omits siblingRivals/inheritedSecrets/bloodFeuds.
    // P13: HousePreV6Schema also omits courierResearchEarned.
    // P15: HousePreV6Schema also omits the 4 dynasty-legacy fields.
    const {
      grievances: _g,
      exiled: _e,
      siblingRivals: _sr,
      inheritedSecrets: _is,
      bloodFeuds: _bf,
      courierResearchEarned: _cre,
      awardedDynastyPerks: _adp,
      consecutiveHeirsNaturalDeath: _chnd,
      cumulativeSuccessfulSeductions: _css,
      cumulativeWeaponizedWhispers: _cww,
      ...freshIndyStripped
    } = freshIndy;
    expect(migratedIndy?.[1]).toEqual(freshIndyStripped);

    // 5 NPCs byte-identity. P7: SaveV5Schema characters tuple uses
    // CharacterPreV8Schema (no V8 fields); strip them from fresh for comparison.
    for (const npcSeed of BASELINE_NPCS) {
      const migrated = v5Save.characters.find(([id]) => id === npcSeed.id);
      const freshChar = fresh.characters.get(npcSeed.id);
      expect(migrated).toBeDefined();
      if (freshChar === undefined) throw new Error("unreachable");
      const {
        happiness: _h,
        temptationHookUnlocked: _t,
        assignedTutorCharacterId: _at,
        tutorBonusTraitGranted: _bt,
        dullSpouseExposureStartTick: _ds,
        parentCharacterIds: _p,
        gender: _g,
        equippedArtifactIds: _ea,
        ...freshCharStripped
      } = freshChar;
      expect(migrated?.[1]).toEqual(freshCharStripped);
    }

    // Independent RNG byte-identity
    const migratedIndyRng = v5Save.rng.find(([id]) => id === INDEPENDENT_HOUSE_ID);
    const freshIndyRng = fresh.rng.get(INDEPENDENT_HOUSE_ID);
    expect(migratedIndyRng?.[1]).toEqual(freshIndyRng);
  });
});

describe("migrate_v4_to_v5 idempotence", () => {
  it("equal-input → equal-output (pure function, no nondeterministic dependencies)", () => {
    const fresh = createInitialState("alpha", DEFAULT_CAMPAIGN_NAME);
    const strippedHouses = new Map(fresh.houses);
    strippedHouses.delete(INDEPENDENT_HOUSE_ID);
    const strippedRng = new Map(fresh.rng);
    strippedRng.delete(INDEPENDENT_HOUSE_ID);
    const strippedCharacters = new Map(fresh.characters);
    for (const npc of BASELINE_NPCS) strippedCharacters.delete(npc.id);
    const v4 = toSaveV4({
      ...fresh,
      houses: strippedHouses,
      characters: strippedCharacters,
      rng: strippedRng,
    });
    const out1 = migrate_v4_to_v5(v4);
    const out2 = migrate_v4_to_v5(v4);
    expect(out1).toEqual(out2);
  });
});
