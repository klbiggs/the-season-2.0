// P15 dynasty-legacy bus partition. Per CLAUDE.md non-negotiable §9 ("events
// partitioned by domain"). One variant:
//
//   DynastyPerkAwarded — fires when a permanent house-level perk is first
//                        awarded (the player house's awardedDynastyPerks grows
//                        by one entry). Awards happen at the two terminal
//                        evaluation slots (tick PHASES slot 15 + year-pass STEPS
//                        slot 6); both flow through the diff helper below, so
//                        there is no direct-publish path and no skip-rule needed.

import type { DynastyPerkKind } from "../../game/constants";
import { PLAYER_HOUSE_ID } from "../../game/rng";
import type { GameState } from "../../game/store";
import { EventBus } from "./bus";

export type DynastyLegacyEvent = {
  kind: "DynastyPerkAwarded";
  tick: number;
  perk: DynastyPerkKind;
  generation: number;
};

export const dynastyLegacyBus = new EventBus<DynastyLegacyEvent>();

// Diff helper: emits DynastyPerkAwarded for each perk present in `after`'s
// player house but absent in `before`'s. Safe (zero events) when nothing
// changed, so it rides every tick-advancing wrapper harmlessly.
export function publishDynastyPerkAwards(before: GameState, after: GameState): void {
  const afterHouse = after.houses.get(PLAYER_HOUSE_ID);
  if (afterHouse === undefined) return;
  const beforeHouse = before.houses.get(PLAYER_HOUSE_ID);
  const had = new Set((beforeHouse?.awardedDynastyPerks ?? []).map((a) => a.perk));
  for (const award of afterHouse.awardedDynastyPerks) {
    if (had.has(award.perk)) continue;
    dynastyLegacyBus.publish({
      kind: "DynastyPerkAwarded",
      tick: after.tick,
      perk: award.perk,
      generation: award.awardedDuringGeneration,
    });
  }
}
