// Shared synthetic-state builders for the P3 rule tests. All 5 new rule
// tests (locationEffects, travel, monarchsAudience, bankruptcyEscape,
// wardrobeRefresh) construct single-house GameState fixtures at specific
// locations with specific wealth/rep/scandal/cooldown values. Centralizing
// the builders keeps fixture drift to one file.

import type { Character, GameState, House } from "../entities";
import type { LocationId } from "../fixtures/locations";
import { PLAYER_HOUSE_ID } from "../rng";
import { createInitialState } from "../store";

// Build a single-house GameState at a given location. Overrides are applied
// to the GameState top level; House-specific overrides go via `house`.
export function synthStateAt(
  location: LocationId,
  options: {
    house?: Partial<House>;
    character?: Partial<Character>;
    state?: Partial<GameState>;
  } = {},
): GameState {
  const base = createInitialState("test");
  const head = base.houses.get(PLAYER_HOUSE_ID);
  if (head === undefined) throw new Error("createInitialState produced no player house");
  const char = base.characters.get(head.headOfHouseCharacterId);
  if (char === undefined) throw new Error("createInitialState produced no head character");

  const houseEntry: House = { ...head, currentLocation: location, ...(options.house ?? {}) };
  const houses = new Map(base.houses);
  houses.set(PLAYER_HOUSE_ID, houseEntry);

  const characters = new Map(base.characters);
  if (options.character !== undefined) {
    characters.set(char.id, { ...char, ...options.character });
  }

  return { ...base, houses, characters, ...(options.state ?? {}) };
}
