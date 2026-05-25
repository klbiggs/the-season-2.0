// Typed required-lookup helpers for the P1 entity Maps. Mirror P0's
// getOrThrow discipline in rng.ts: required lookups raise typed errors;
// programmer error, not recoverable state.
//
// MUST NOT re-export from rng.ts — re-exports would launder rule-(b) violations
// through ui → game-util → game-rng.

import type { Character, GameState, House, MarriageRecord } from "../entities";
import type { CharacterId, HouseId, MarriageId } from "../rng";
import { CharacterNotFoundError, HouseNotFoundError, MarriageNotFoundError } from "./errors";

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
