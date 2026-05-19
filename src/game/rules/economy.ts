// Bankruptcy-tier classification + per-tick deltas per spec §3 "Economy &
// Bankruptcy". Pure: takes GameState, returns new GameState via hand-rolled
// shallow Map clone (CLAUDE.md non-negotiable §1).

import { ECONOMY_DELTAS } from "../constants";
import type { GameState, House } from "../entities";

export type BankruptcyTier = "Solvent" | "Hemorrhaging" | "Embarrassed" | "Ruined";

export function classifyTier(wealth: number): BankruptcyTier {
  if (wealth >= 0) return "Solvent";
  if (wealth > -100) return "Hemorrhaging";
  // wealth ∈ (-500, -100] is Embarrassed; wealth ≤ -500 is Ruined.
  if (wealth > -500) return "Embarrassed";
  return "Ruined";
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

// Snapshot-Map pattern: tiers computed once per phase on entry. Reclassifying
// after each delta would break the "wealth = -100 stays Hemorrhaging this
// tick" boundary case (spec §3 interval definition).
export function applyEconomyPhase(state: GameState): GameState {
  const tiersByHouseId = new Map(
    [...state.houses].map(([id, h]) => [id, classifyTier(h.wealth)] as const),
  );
  const houses = new Map<typeof state.houses extends Map<infer K, House> ? K : never, House>(
    state.houses,
  );
  for (const [houseId, house] of state.houses) {
    // Safe: tiersByHouseId built from the same Map's keys.
    const tier = tiersByHouseId.get(houseId);
    if (tier === undefined) continue;
    // Total map keyed by BankruptcyTier — non-null is safe because
    // `tier` is a BankruptcyTier, but noUncheckedIndexedAccess widens to
    // `| undefined` regardless.
    const delta = ECONOMY_DELTAS[tier] as { wealth: number; reputation: number; scandal: number };
    houses.set(houseId, {
      ...house,
      wealth: house.wealth + delta.wealth,
      reputation: clamp(house.reputation + delta.reputation, 0, 100),
      scandal: clamp(house.scandal + delta.scandal, 0, 100),
    });
  }
  return { ...state, houses };
}
