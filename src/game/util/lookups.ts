// Typed required-lookup helpers for the P1 entity Maps. Mirror P0's
// getOrThrow discipline in rng.ts: required lookups raise typed errors;
// programmer error, not recoverable state.
//
// MUST NOT re-export from rng.ts — re-exports would launder rule-(b) violations
// through ui → game-util → game-rng.

import type { Character, GameState, House, MarriageRecord, Scheme } from "../entities";
import type { CharacterId, HouseId, MarriageId, SchemeId } from "../rng";
import {
  CharacterNotFoundError,
  HouseNotFoundError,
  MarriageNotFoundError,
  SchemeNotFoundError,
} from "./errors";

export function getCharacterOrThrow(state: GameState, id: CharacterId): Character {
  const c = state.characters.get(id);
  if (c === undefined) throw new CharacterNotFoundError(id);
  return c;
}

export function getHouseOrThrow(state: GameState, id: HouseId): House {
  const h = state.houses.get(id);
  if (h === undefined) throw new HouseNotFoundError(id);
  return h;
}

export function getMarriageOrThrow(state: GameState, id: MarriageId): MarriageRecord {
  const m = state.marriages.get(id);
  if (m === undefined) throw new MarriageNotFoundError(id);
  return m;
}

// P5: scheme registry lookup. Mirrors the existing helpers. Note: state.rng
// already has an `getOrThrow` in rng.ts (different signature — Map<HouseId,
// RngState> rather than (state, id)); consumers should import that one
// directly via `import { getOrThrow } from "../rng";`.
export function getSchemeOrThrow(state: GameState, id: SchemeId): Scheme {
  const s = state.schemes.get(id);
  if (s === undefined) throw new SchemeNotFoundError(id);
  return s;
}
