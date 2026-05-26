// P23 (item G): society dynasties. A year-pass STEP that pairs eligible
// unattached society singles (alive adults in INDEPENDENT) into NEW society
// houses (`soc-house-<n>`), each with one spouse as HeadOfHouse. Society
// conception + succession then run for free via the house-generic lifecycle
// (applyConceptionStep / applySuccessionStep already iterate state.houses).
//
// Determinism:
//   - Pairing draws come from the EXISTING state.rng[INDEPENDENT_HOUSE_ID]
//     stream (same stream replenishment + mood drift use; they interleave
//     deterministically). Budget: 2 draws per marriage (female idx, male idx).
//   - Each minted society house gets its OWN rng entry seeded
//     createRngState(`${indepSeed}|${socHouseId}`) — deterministic +
//     campaign-specific without storing a separate campaign seed.
//   - New house ids start at the count of existing `soc-house-` houses
//     (contiguous; houses are never deleted).
//   - Guarded on the Independent rng stream's existence so synthetic year-pass
//     fixtures (which omit it) no-op instead of throwing.
//
// Plan: plans/phases/23-marriage-family-depth.md item G.

import { ADULTHOOD_AGE_IN_YEARS, SOCIETY_MARRIAGES_PER_YEAR } from "../constants";
import type { Character, GameState, House } from "../entities";
import { classifyArchetype } from "../fixtures/archetypes";
import { fnv1a32 } from "../fixtures/hashCharIdToGender";
import {
  SOCIETY_FACTION_POOL,
  SOCIETY_HOUSE_ID_PREFIX,
  buildSocietyHouse,
} from "../fixtures/rivals";
import {
  type CharacterId,
  type FactionId,
  type HouseId,
  INDEPENDENT_HOUSE_ID,
  type RngState,
  createRngState,
  drawInt,
} from "../rng";
import { mintMarriage } from "./mintMarriage";

function nextSocietyHouseIndex(state: GameState): number {
  let n = 0;
  for (const id of state.houses.keys()) {
    if (id.startsWith(SOCIETY_HOUSE_ID_PREFIX)) n++;
  }
  return n;
}

export function applySocietyMarriageStep(state: GameState): GameState {
  const indepRng = state.rng.get(INDEPENDENT_HOUSE_ID);
  if (indepRng === undefined) return state; // synthetic fixture — no society to marry.

  // Eligible unattached singles: alive adults in INDEPENDENT with no marriage.
  // Lex-sort by id, then split by gender (lex-sorted within each pool).
  const eligible: Character[] = [];
  for (const c of state.characters.values()) {
    if (!c.alive) continue;
    if (c.houseId !== INDEPENDENT_HOUSE_ID) continue;
    if (c.age < ADULTHOOD_AGE_IN_YEARS) continue;
    if (c.marriageId !== null) continue;
    eligible.push(c);
  }
  eligible.sort((a, b) => a.id.localeCompare(b.id));
  const females = eligible.filter((c) => c.gender === "Female").map((c) => c.id);
  const males = eligible.filter((c) => c.gender === "Male").map((c) => c.id);

  const marriages = Math.min(SOCIETY_MARRIAGES_PER_YEAR, females.length, males.length);
  if (marriages === 0) return state; // zero draws — hash-neutral no-op.

  let working = state;
  let rngCursor: RngState = indepRng;
  let houseIndex = nextSocietyHouseIndex(state);
  // Mutable remaining pools (picked entries spliced out).
  const femaleRemaining = [...females];
  const maleRemaining = [...males];

  for (let k = 0; k < marriages; k++) {
    // Draw 1: female pick. Draw 2: male pick.
    const fPick = drawInt(rngCursor, femaleRemaining.length);
    rngCursor = fPick.rngState;
    const femaleId = femaleRemaining.splice(fPick.next, 1)[0] as CharacterId;
    const mPick = drawInt(rngCursor, maleRemaining.length);
    rngCursor = mPick.rngState;
    const maleId = maleRemaining.splice(mPick.next, 1)[0] as CharacterId;

    // Mint the new society house id + seed its rng from the Independent seed.
    const socHouseId = `${SOCIETY_HOUSE_ID_PREFIX}${houseIndex}` as HouseId;
    houseIndex += 1;
    const factionId = SOCIETY_FACTION_POOL[
      fnv1a32(socHouseId) % SOCIETY_FACTION_POOL.length
    ] as FactionId;

    // Mint the marriage (shared core): male = initiator (role kept), female =
    // target (flips Spinster/Dependent → Spouse) + Dull-exposure detection.
    const { nextState: minted } = mintMarriage(working, maleId, femaleId, { viaElopement: false });

    // Move BOTH spouses into the new house; male → HeadOfHouse (Regency
    // convention; female already Spouse from the mint); reclassify both.
    const newChars = new Map(minted.characters);
    const male = newChars.get(maleId);
    const female = newChars.get(femaleId);
    if (male !== undefined) {
      const movedMale: Character = { ...male, houseId: socHouseId, role: "HeadOfHouse" };
      newChars.set(maleId, { ...movedMale, archetype: classifyArchetype(movedMale) });
    }
    if (female !== undefined) {
      const movedFemale: Character = { ...female, houseId: socHouseId };
      newChars.set(femaleId, { ...movedFemale, archetype: classifyArchetype(movedFemale) });
    }

    const newHouses = new Map(minted.houses);
    const socHouse: House = buildSocietyHouse(socHouseId, maleId, factionId);
    newHouses.set(socHouseId, socHouse);

    const newRng = new Map(minted.rng);
    newRng.set(socHouseId, createRngState(`${indepRng.seed}|${socHouseId}`));

    working = { ...minted, characters: newChars, houses: newHouses, rng: newRng };
  }

  // Write back the advanced Independent rng cursor.
  const finalRng = new Map(working.rng);
  finalRng.set(INDEPENDENT_HOUSE_ID, rngCursor);
  return { ...working, rng: finalRng };
}
