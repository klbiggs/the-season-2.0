// P22: ongoing society replenishment. A year-pass STEP (NOT a tick PHASE) that
// tops the alive procedural-society cohort back toward PROCEDURAL_NPC_COUNT as
// members age out, so the ton doesn't silently empty over generations.
//
// Top-up-to-floor model: deficit = PROCEDURAL_NPC_COUNT − aliveProceduralNpcCount;
// arrivals = clamp(deficit, 0, SOCIETY_MAX_ARRIVALS_PER_YEAR). Zero arrivals ⇒
// zero draws (hash-neutral no-op) — the common case until society NPCs start
// dying (procedural deathAge ≥ 70 vs start age ≤ 55).
//
// Determinism:
//   - Draws come from the EXISTING state.rng[INDEPENDENT_HOUSE_ID] stream (already
//     in the projection/hash; also consumed per-tick by applyMoodDriftPhase — the
//     two interleave deterministically). No new state.rng entry; P22 adds no
//     GameState field.
//   - New ids start at totalProceduralNpcCount (alive + dead `proc-npc-` count;
//     contiguous from 0 since characters are never deleted) so ids never collide.
//   - Era = state.era (current) so a Later-era ton gets Later-era names.
//   - Per-NPC budget stays the fixed 8 draws (generateSocietyNpcs).

import { PROCEDURAL_NPC_COUNT, SOCIETY_MAX_ARRIVALS_PER_YEAR } from "../constants";
import type { Character, GameState } from "../entities";
import { type CharacterId, INDEPENDENT_HOUSE_ID } from "../rng";
import {
  aliveProceduralNpcCount,
  generateSocietyNpcs,
  totalProceduralNpcCount,
} from "./proceduralNpcs";

export function applySocietyReplenishmentStep(state: GameState): GameState {
  // No Independent rng stream ⇒ no society to maintain. Real campaigns always
  // seed it at createInitialState; this guard keeps the step a clean no-op on
  // synthetic year-pass fixtures (succession/yearPass tests) that omit it,
  // instead of throwing via getOrThrow.
  const rngBefore = state.rng.get(INDEPENDENT_HOUSE_ID);
  if (rngBefore === undefined) return state;

  const deficit = PROCEDURAL_NPC_COUNT - aliveProceduralNpcCount(state.characters);
  if (deficit <= 0) return state;
  const arrivals = Math.min(deficit, SOCIETY_MAX_ARRIVALS_PER_YEAR);
  const { characters: newcomers, rngState: rngAfter } = generateSocietyNpcs(
    rngBefore,
    state.era,
    arrivals,
    totalProceduralNpcCount(state.characters),
  );

  const characters = new Map<CharacterId, Character>(state.characters);
  for (const c of newcomers) characters.set(c.id, c);

  const rng = new Map(state.rng);
  rng.set(INDEPENDENT_HOUSE_ID, rngAfter);

  return { ...state, characters, rng };
}
