// Placeholder name registry. P1 ships only the seeded-head name; later phases
// expand into a real roster.

import type { CharacterId, MarriageId } from "../rng";

export const STARTING_HEAD_NAME = "Player I";

// Deterministic id literal for the campaign-start head. Per the CharacterId
// minting policy table in the P1 plan.
export const STARTING_HEAD_CHARACTER_ID = "player-head" as CharacterId;

// Deterministic id template for conceived children. nth is always 0 at P1
// (one conception per marriage per year-pass); the suffix is forward-
// compatible with multi-conception phases.
export function childCharacterId(marriageId: MarriageId, tick: number, nth: number): CharacterId {
  return `${marriageId}-child${tick}-${nth}` as CharacterId;
}

export function childName(marriageId: MarriageId, tick: number): string {
  return `Child of ${marriageId} @${tick}`;
}
