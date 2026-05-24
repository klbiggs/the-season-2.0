// P15 — Dynasty Legacies & Renown Perks (spec §3 lines 507-510, §7 line 656).
// Pure rule layer: no UI/store/persist/LLM imports. GameState is imported from
// ../entities (NOT ../store) to stay inside the game-rules boundary.
//
// Two responsibilities:
//   1. evaluateDynastyPerks — the idempotent, RNG-FREE award function run at the
//      two terminal slots (tick PHASES slot 15 + year-pass STEPS slot 6). Reads
//      the player house's three progress counters; awards any not-yet-held perk
//      whose trigger is met. Never mutates a counter.
//   2. recordPlayerHead{Natural,Violent}Death — counter mutations at the death
//      sites (the site knows the cause; plan D4). Natural death increments the
//      consecutive streak; violent death resets it to 0.

import {
  PATRONAGE_PERK_CONSECUTIVE_NATURAL_DEATHS,
  SEDUCTION_PERK_CUMULATIVE_SUCCESSES,
  WHISPERS_PERK_CUMULATIVE_WEAPONIZED,
} from "../constants";
import type { DynastyPerkKind } from "../constants";
import type { DynastyPerkAward, GameState } from "../entities";
import { type CharacterId, PLAYER_HOUSE_ID } from "../rng";

// Read-only predicate: does the player house currently hold `perk`? Single
// source of truth for the effect sites (location effects, seduction, whisper
// verification, courier intercept).
export function hasDynastyPerk(state: GameState, perk: DynastyPerkKind): boolean {
  const house = state.houses.get(PLAYER_HOUSE_ID);
  if (house === undefined) return false;
  return house.awardedDynastyPerks.some((a) => a.perk === perk);
}

// Idempotent, RNG-free award evaluation. Awards in DYNASTY_PERK_KINDS order
// (Patronage → Seduction → Whispers) when multiple cross threshold in one tick.
// Returns the input unchanged when nothing awards (harmless on every wrapper).
export function evaluateDynastyPerks(state: GameState): GameState {
  const house = state.houses.get(PLAYER_HOUSE_ID);
  if (house === undefined) return state;
  const have = new Set(house.awardedDynastyPerks.map((a) => a.perk));
  const toAward: DynastyPerkKind[] = [];
  if (
    !have.has("Patronage") &&
    house.consecutiveHeirsNaturalDeath >= PATRONAGE_PERK_CONSECUTIVE_NATURAL_DEATHS
  ) {
    toAward.push("Patronage");
  }
  if (
    !have.has("Seduction") &&
    house.cumulativeSuccessfulSeductions >= SEDUCTION_PERK_CUMULATIVE_SUCCESSES
  ) {
    toAward.push("Seduction");
  }
  if (
    !have.has("Whispers") &&
    house.cumulativeWeaponizedWhispers >= WHISPERS_PERK_CUMULATIVE_WEAPONIZED
  ) {
    toAward.push("Whispers");
  }
  if (toAward.length === 0) return state;
  const newAwards: DynastyPerkAward[] = toAward.map((perk) => ({
    perk,
    awardedAtTick: state.tick,
    awardedDuringGeneration: house.generation,
  }));
  const houses = new Map(state.houses);
  houses.set(PLAYER_HOUSE_ID, {
    ...house,
    awardedDynastyPerks: [...house.awardedDynastyPerks, ...newAwards],
  });
  return { ...state, houses };
}

// Natural-death counter increment. Called by applyAgingStep AFTER its
// pruneOrphanedConversationKeys call (operates on post-prune state, so no
// clone-clobber). Increments iff the player head died this aging step. Reading
// the head from the passed state is correct: aging is STEPS slot 1 and
// succession is slot 3, so the head id is still the dying (pre-succession) head.
export function recordPlayerHeadNaturalDeath(
  state: GameState,
  deadCharIds: ReadonlySet<CharacterId>,
): GameState {
  const house = state.houses.get(PLAYER_HOUSE_ID);
  if (house === undefined) return state;
  if (!deadCharIds.has(house.headOfHouseCharacterId)) return state;
  const houses = new Map(state.houses);
  houses.set(PLAYER_HOUSE_ID, {
    ...house,
    consecutiveHeirsNaturalDeath: house.consecutiveHeirsNaturalDeath + 1,
  });
  return { ...state, houses };
}

// Violent-death counter reset (assassination / duel). Resets the consecutive
// streak to 0 iff the killed character is the current player head.
export function recordPlayerHeadViolentDeath(
  state: GameState,
  killedCharId: CharacterId,
): GameState {
  const house = state.houses.get(PLAYER_HOUSE_ID);
  if (house === undefined) return state;
  if (house.headOfHouseCharacterId !== killedCharId) return state;
  if (house.consecutiveHeirsNaturalDeath === 0) return state;
  const houses = new Map(state.houses);
  houses.set(PLAYER_HOUSE_ID, { ...house, consecutiveHeirsNaturalDeath: 0 });
  return { ...state, houses };
}
