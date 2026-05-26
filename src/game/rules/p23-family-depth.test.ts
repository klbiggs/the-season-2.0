// P23 behaviors: re-widowing role flip + betrothal auto-break (death cascade),
// maturation random-archetype trait, and tutor-bonus mid-life reclassify.

import { describe, expect, it } from "vitest";
import {
  makeCharacter,
  makeCharactersMap,
  makeGameState,
  makeHouse,
  makeHousesMap,
  makeMarriage,
} from "../__test-utils__/factories";
import { ADULTHOOD_AGE_IN_YEARS } from "../constants";
import type { Betrothal, GameState } from "../entities";
import { hashState } from "../hash";
import {
  type BetrothalId,
  type CharacterId,
  type MarriageId,
  PLAYER_HOUSE_ID,
  type TraitId,
  createRngState,
} from "../rng";
import { pruneOrphanedConversationKeys } from "./aging";
import { applyMaturationStep } from "./maturation";

const HEAD = "player-head" as CharacterId;
const SPOUSE = "spouse" as CharacterId;
const MID = "m-1" as MarriageId;

describe("P23 re-widowing role flip (death cascade)", () => {
  it("flips a surviving Spouse → Spinster, nulls marriageId, and reclassifies", () => {
    const head = makeCharacter({
      id: HEAD,
      houseId: PLAYER_HOUSE_ID,
      alive: false,
      marriageId: MID,
    });
    const spouse = makeCharacter({
      id: SPOUSE,
      houseId: PLAYER_HOUSE_ID,
      alive: true,
      role: "Spouse",
      gender: "Female",
      marriageId: MID,
      traits: ["Cunning" as TraitId],
      archetype: "None",
    });
    const state = makeGameState({
      tick: 40,
      characters: makeCharactersMap([head, spouse]),
      houses: makeHousesMap([makeHouse({ id: PLAYER_HOUSE_ID })]),
      marriages: new Map([[MID, makeMarriage({ id: MID, spouseAId: HEAD, spouseBId: SPOUSE })]]),
    });
    const after = pruneOrphanedConversationKeys(state, new Set([HEAD]));
    const widow = after.characters.get(SPOUSE);
    expect(widow?.role).toBe("Spinster");
    expect(widow?.marriageId).toBeNull();
    // Spinster + Cunning → Spymaster (classifier branch 1).
    expect(widow?.archetype).toBe("Spymaster");
    // Marriage record dissolved (branch 3).
    expect(after.marriages.get(MID)?.dissolved).toBe(true);
  });

  it("does not re-widow a surviving HEAD (only role 'Spouse' survivors flip)", () => {
    const head = makeCharacter({
      id: HEAD,
      houseId: PLAYER_HOUSE_ID,
      alive: true,
      role: "HeadOfHouse",
      marriageId: MID,
    });
    const spouse = makeCharacter({
      id: SPOUSE,
      houseId: PLAYER_HOUSE_ID,
      alive: false,
      role: "Spouse",
      marriageId: MID,
    });
    const state = makeGameState({
      tick: 40,
      characters: makeCharactersMap([head, spouse]),
      houses: makeHousesMap([makeHouse({ id: PLAYER_HOUSE_ID })]),
      marriages: new Map([[MID, makeMarriage({ id: MID, spouseAId: HEAD, spouseBId: SPOUSE })]]),
    });
    const after = pruneOrphanedConversationKeys(state, new Set([SPOUSE]));
    expect(after.characters.get(HEAD)?.role).toBe("HeadOfHouse");
    // Head's marriageId is NOT nulled by re-widowing (only role-Spouse survivors).
    expect(after.characters.get(HEAD)?.marriageId).toBe(MID);
  });
});

describe("P23 betrothal auto-break on party death", () => {
  it("flips a Pending betrothal naming a dead party to Broken (no scandal)", () => {
    const child = makeCharacter({
      id: "child" as CharacterId,
      houseId: PLAYER_HOUSE_ID,
      alive: false,
    });
    const npc = makeCharacter({
      id: "npc" as CharacterId,
      houseId: "independent" as never,
      alive: true,
    });
    const bid = "b-1" as BetrothalId;
    const betrothal: Betrothal = {
      id: bid,
      partyAId: "child" as CharacterId,
      partyBId: "npc" as CharacterId,
      arrangedAtTick: 0,
      status: "Pending",
      resolvedAtTick: null,
      honoredMarriageId: null,
    };
    const state = makeGameState({
      tick: 12,
      characters: makeCharactersMap([child, npc]),
      houses: makeHousesMap([makeHouse({ id: PLAYER_HOUSE_ID, scandal: 0 })]),
      betrothals: new Map([[bid, betrothal]]),
    });
    const after = pruneOrphanedConversationKeys(state, new Set(["child" as CharacterId]));
    expect(after.betrothals.get(bid)?.status).toBe("Broken");
    expect(after.betrothals.get(bid)?.resolvedAtTick).toBe(12);
    // Death is not a jilt — no scandal.
    expect(after.houses.get(PLAYER_HOUSE_ID)?.scandal).toBe(0);
  });
});

describe("P23 maturation random-archetype trait", () => {
  it("draws on the maturing char's house rng for a non-None classification", () => {
    // Female + Cunning maturing at 18 → Spinster role → Spymaster archetype (non-None).
    const child = makeCharacter({
      id: "kid" as CharacterId,
      houseId: PLAYER_HOUSE_ID,
      age: ADULTHOOD_AGE_IN_YEARS,
      role: "Dependent",
      gender: "Female",
      traits: ["Cunning" as TraitId],
    });
    const rng = new Map([[PLAYER_HOUSE_ID, createRngState("mat-seed")]]);
    const beforeCount = rng.get(PLAYER_HOUSE_ID)?.callCount ?? 0;
    const state = makeGameState({
      tick: 18,
      characters: makeCharactersMap([child]),
      houses: makeHousesMap([makeHouse({ id: PLAYER_HOUSE_ID })]),
      rng,
    });
    const after = applyMaturationStep(state);
    const matured = after.characters.get("kid" as CharacterId);
    expect(matured?.role).toBe("Spinster");
    expect(matured?.archetype).toBe("Spymaster");
    // The gate draw advanced the house rng (non-None classification).
    expect(after.rng.get(PLAYER_HOUSE_ID)?.callCount).toBeGreaterThan(beforeCount);
    // Any granted bonus trait comes from the Spymaster pool (Observant|Cunning).
    for (const t of matured?.traits ?? []) {
      expect(["Cunning", "Observant"]).toContain(t as string);
    }
  });

  it("draws NOTHING for a None-classified maturing char", () => {
    // Male, no Bohemian traits, married-less but no classifier trait → Dependent → None.
    const child = makeCharacter({
      id: "kid2" as CharacterId,
      houseId: PLAYER_HOUSE_ID,
      age: ADULTHOOD_AGE_IN_YEARS,
      role: "Dependent",
      gender: "Male",
      traits: [],
    });
    const rng = new Map([[PLAYER_HOUSE_ID, createRngState("mat-seed-2")]]);
    const beforeCount = rng.get(PLAYER_HOUSE_ID)?.callCount ?? 0;
    const state = makeGameState({
      tick: 18,
      characters: makeCharactersMap([child]),
      houses: makeHousesMap([makeHouse({ id: PLAYER_HOUSE_ID })]),
      rng,
    });
    const after = applyMaturationStep(state);
    expect(after.characters.get("kid2" as CharacterId)?.archetype).toBe("None");
    // No draw consumed for a None classification.
    expect(after.rng.get(PLAYER_HOUSE_ID)?.callCount).toBe(beforeCount);
  });

  it("is deterministic across 30 identical-seed runs (random-trait draw)", () => {
    const build = (): GameState =>
      makeGameState({
        tick: 18,
        characters: makeCharactersMap([
          makeCharacter({
            id: "kid" as CharacterId,
            houseId: PLAYER_HOUSE_ID,
            age: ADULTHOOD_AGE_IN_YEARS,
            role: "Dependent",
            gender: "Female",
            traits: ["Cunning" as TraitId],
          }),
        ]),
        houses: makeHousesMap([makeHouse({ id: PLAYER_HOUSE_ID })]),
        rng: new Map([[PLAYER_HOUSE_ID, createRngState("mat-determinism")]]),
      });
    const baseline = hashState(applyMaturationStep(build()));
    for (let i = 0; i < 30; i++) {
      expect(hashState(applyMaturationStep(build()))).toBe(baseline);
    }
  });
});
