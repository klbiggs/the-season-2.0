// Name registry. P1 shipped only the seeded-head name; P16 added the procedural
// name banks; P22 derives the founder's name from those banks (was "Player I").

import { PLAYER_HOUSE_ID } from "../rng";
import type { CharacterId, MarriageId } from "../rng";
import { founderName } from "./nameBanks";

// Deterministic id literal for the campaign-start head. Per the CharacterId
// minting policy table in the P1 plan.
export const STARTING_HEAD_CHARACTER_ID = "player-head" as CharacterId;

// P22: founder now gets a full procedural name matching descendants (no regnal
// numeral) instead of the "Player I" placeholder. Derived (hash-picked, no RNG
// draw) so the bootstrap draw budget is unchanged. STARTING_HEAD_NAME stays the
// single symbol the bootstrap + its test read.
export const STARTING_HEAD_NAME = founderName(STARTING_HEAD_CHARACTER_ID, PLAYER_HOUSE_ID);

// Deterministic id template for conceived children. nth is always 0 at P1
// (one conception per marriage per year-pass); the suffix is forward-
// compatible with multi-conception phases.
export function childCharacterId(marriageId: MarriageId, tick: number, nth: number): CharacterId {
  return `${marriageId}-child${tick}-${nth}` as CharacterId;
}
