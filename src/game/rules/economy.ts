// Bankruptcy-tier classification + per-tick deltas per spec §3 "Economy &
// Bankruptcy". Pure: takes GameState, returns new GameState via hand-rolled
// shallow Map clone (CLAUDE.md non-negotiable §1).

import { ECONOMY_DELTAS, RIVAL_BASELINE_INCOME_PER_TICK } from "../constants";
import type { GameState, House } from "../entities";
import { RIVAL_HOUSE_IDS_SET } from "../fixtures/rivals";
import { PLAYER_HOUSE_ID } from "../rng";
import { effectiveScandalContributionFromArtifacts } from "./artifacts";

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
    // P25 R2: rival houses now participate in the economy (removed the P8
    // cosmetic-wealth skip). They get bankruptcy-tier decay like any house PLUS
    // a flat baseline income (they have no location economy — see the
    // RIVAL_BASELINE_INCOME_PER_TICK note). Independent + society keep their
    // pre-existing tier-only participation.
    // Safe: tiersByHouseId built from the same Map's keys.
    const tier = tiersByHouseId.get(houseId);
    if (tier === undefined) continue;
    // Total map keyed by BankruptcyTier — non-null is safe because
    // `tier` is a BankruptcyTier, but noUncheckedIndexedAccess widens to
    // `| undefined` regardless.
    const delta = ECONOMY_DELTAS[tier] as { wealth: number; reputation: number; scandal: number };
    // P10: artifact-scandal additive — sum of scandalRiskWhileEquipped across
    // player-house equipped artifacts. Computed once per player branch (gated
    // by houseId === PLAYER_HOUSE_ID below); composes additively with the
    // economy-tier scandal delta under a single clamp at write. Silent by
    // design at v1: P14 ledger selector surfaces this contribution.
    let artifactScandalDelta = 0;
    if (houseId === PLAYER_HOUSE_ID) {
      artifactScandalDelta = effectiveScandalContributionFromArtifacts(state);
    }
    // P25 R2: rival baseline income (draw-free). Composes additively with the
    // tier delta under the wealth write. Wealth stays UNCLAMPED (bankruptcy-tier
    // fidelity — same as the tier delta).
    const baselineIncome = RIVAL_HOUSE_IDS_SET.has(houseId) ? RIVAL_BASELINE_INCOME_PER_TICK : 0;
    houses.set(houseId, {
      ...house,
      wealth: house.wealth + delta.wealth + baselineIncome,
      reputation: clamp(house.reputation + delta.reputation, 0, 100),
      scandal: clamp(house.scandal + delta.scandal + artifactScandalDelta, 0, 100),
    });
  }
  return { ...state, houses };
}
