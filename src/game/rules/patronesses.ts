// P8: patroness erosion phase + ball-veto rule.
//
// applyPatronessErosionPhase runs at PHASES slot 9 (between happiness drift
// and rival action). On ticks where player house scandal >= 50, picks ONE
// patroness via `tick % size` round-robin over lex-sorted ids (zero PRNG
// draw consumed — avoids player-RNG drift across legacy saves). If max
// faction tension involving the patroness's faction ≥ 50, applies doubled
// erosion; else single erosion. Clamps [0, 100].
//
// checkBallVeto reads state.patronesses and returns the list of patronesses
// whose favor < PATRONESS_VETO_THRESHOLD. Empty list = no veto.

import {
  PATRONESS_FAVOR_EROSION_DOUBLED_PER_TICK,
  PATRONESS_FAVOR_EROSION_PER_TICK,
  PATRONESS_FAVOR_EROSION_SCANDAL_THRESHOLD,
  PATRONESS_FAVOR_EROSION_TENSION_THRESHOLD,
  PATRONESS_VETO_THRESHOLD,
  RIVAL_HOSTILITY_ACTIVATION_THRESHOLD,
} from "../constants";
import type { GameState } from "../entities";
import { makeFactionPairKey } from "../fixtures/factions";
import { PLAYER_HOUSE_ID, type PatronessId } from "../rng";
import { clamp } from "../util/clamp";

export function applyPatronessErosionPhase(state: GameState): GameState {
  // 1. Read player scandal.
  const playerHouse = state.houses.get(PLAYER_HOUSE_ID);
  const scandal = playerHouse?.scandal ?? 0;
  // 2. Below threshold → no-op.
  if (scandal < PATRONESS_FAVOR_EROSION_SCANDAL_THRESHOLD) return state;
  // 3. Deterministic round-robin pick.
  if (state.patronesses.size === 0) return state;
  const sortedIds = [...state.patronesses.keys()].sort();
  const pickedId = sortedIds[state.tick % sortedIds.length];
  if (pickedId === undefined) return state;
  const picked = state.patronesses.get(pickedId);
  if (picked === undefined) return state;
  // 4. Faction-tension lookup. Aggregate over ACTIVE rivals (hostility ≥
  //    threshold) — if any active rival is on a different faction AND the
  //    pair tension ≥ 50, erosion doubles.
  let maxTension = 0;
  for (const ra of state.rivalActors.values()) {
    const rivalHouse = state.houses.get(ra.houseId);
    if (rivalHouse === undefined) continue;
    if (rivalHouse.hostility < RIVAL_HOSTILITY_ACTIVATION_THRESHOLD) continue;
    if (ra.factionId === picked.factionId) continue; // self-faction not stored
    const pairKey = makeFactionPairKey(ra.factionId, picked.factionId);
    const t = state.factionTensions.get(pairKey) ?? 0;
    if (t > maxTension) maxTension = t;
  }
  const delta =
    maxTension >= PATRONESS_FAVOR_EROSION_TENSION_THRESHOLD
      ? PATRONESS_FAVOR_EROSION_DOUBLED_PER_TICK
      : PATRONESS_FAVOR_EROSION_PER_TICK;
  // 5. Write the new favor (clamped).
  const newFavor = clamp(picked.favor + delta, 0, 100);
  const newPatronesses = new Map(state.patronesses);
  newPatronesses.set(pickedId, { ...picked, favor: newFavor });
  return { ...state, patronesses: newPatronesses };
}

// Ball-veto check called by the ballroom enter-flow. Returns `{ vetoedBy: [] }`
// for no veto, `{ vetoedBy: [id1, id2, ...] }` for veto by named patronesses
// (lex-sorted by id for determinism).
export function checkBallVeto(state: GameState): { vetoedBy: PatronessId[] } {
  const vetoedBy: PatronessId[] = [];
  const sortedIds = [...state.patronesses.keys()].sort();
  for (const id of sortedIds) {
    const p = state.patronesses.get(id);
    if (p === undefined) continue;
    if (p.favor < PATRONESS_VETO_THRESHOLD) vetoedBy.push(id);
  }
  return { vetoedBy };
}
