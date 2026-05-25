// Deterministic gender derivation from CharacterId via FNV-1a 32-bit hash.
// Used by:
//   - buildBaselineNpcCharacter (bootstrap path) — derives gender for the 5
//     baseline NPCs + player character from their ids.
//   - defaultV8CharacterFields (in src/persist/schema.ts, called from
//     liftLegacyCharactersFromV8Pre on legacy V5/V6/V7 character lifts) —
//     derives gender for every character being lifted to V8 shape.
//
// Both consumers MUST share this single source of truth — the v1→v8 chain-
// test hash-parity assertion fails if the two paths produce different genders
// for the same id.
//
// The algorithm is FROZEN. Any change to the hash function silently re-rolls
// every legacy character's gender on next load — irrecoverable save corruption.
// A future trait-modifier or gender-redistribution feature MUST bump
// SAVE_VERSION_CURRENT and ship a migration that recomputes deterministically.
//
// Plan: plans/phases/07-family-succession.md "Legacy gender default rule".

import type { CharacterId } from "../rng";

// Standard FNV-1a 32-bit constants.
const FNV_OFFSET_BASIS_32 = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;

// Shared FNV-1a 32-bit hash, returned UNSIGNED (`>>> 0`). P16 extracted this
// from hashCharIdToGender so dynastySurnameForHouse (nameBanks.ts) can index a
// bank via `% length` — which needs the unsigned value. The gender derivation
// below reads only bit 0 (`& 1`), which is sign-insensitive, so this extraction
// is byte-identical to the prior inline computation — the FROZEN guarantee
// holds and hashCharIdToGender.test.ts golden pairs stay green.
export function fnv1a32(s: string): number {
  let hash = FNV_OFFSET_BASIS_32;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    // Math.imul keeps the multiplication in signed-32-bit semantics; required
    // for cross-platform determinism.
    hash = Math.imul(hash, FNV_PRIME_32);
  }
  return hash >>> 0;
}

export function hashCharIdToGender(id: CharacterId): "Female" | "Male" {
  return (fnv1a32(id) & 1) === 0 ? "Female" : "Male";
}
