// P15: Dynasty tab. Read-only surface for the player house's permanent
// dynasty-legacy perks (spec §3 lines 507-510). Shows awarded perks (with the
// awarded-at-tick + generation snapshot) and progress toward each unearned perk
// as "current / threshold". All four fields ride the player House; non-player
// houses never accrue them.

import { useShallow } from "zustand/react/shallow";
import {
  PATRONAGE_PERK_CONSECUTIVE_NATURAL_DEATHS,
  SEDUCTION_PERK_CUMULATIVE_SUCCESSES,
  WHISPERS_PERK_CUMULATIVE_WEAPONIZED,
} from "../../../game/constants";
import { PLAYER_HOUSE_ID } from "../../../game/rng.seeds";
import type { SeasonStore } from "../../../game/store";

type Props = {
  store: SeasonStore;
};

// UI-local labels for the three progress counters (P14 UI-local-constants rule).
const PROGRESS_ROWS = [
  {
    perk: "Patronage",
    label: "Patronage (consecutive natural-death successions)",
    threshold: PATRONAGE_PERK_CONSECUTIVE_NATURAL_DEATHS,
  },
  {
    perk: "Seduction",
    label: "Seduction (cumulative successful seductions)",
    threshold: SEDUCTION_PERK_CUMULATIVE_SUCCESSES,
  },
  {
    perk: "Whispers",
    label: "Whispers (cumulative weaponized whispers)",
    threshold: WHISPERS_PERK_CUMULATIVE_WEAPONIZED,
  },
] as const;

export function DynastyTab({ store }: Props) {
  const { houses } = store(
    useShallow((s) => ({
      houses: s.houses,
      tick: s.tick,
    })),
  );

  const playerHouse = houses.get(PLAYER_HOUSE_ID);

  if (playerHouse === undefined) {
    return (
      <section data-testid="ledger-tab-dynasty" className="space-y-6">
        <h2 className="text-lg font-semibold text-stone-800">Dynasty Legacies</h2>
        <p className="text-sm text-stone-500">No player house found.</p>
      </section>
    );
  }

  const awarded = playerHouse.awardedDynastyPerks;
  const awardedKinds = new Set(awarded.map((a) => a.perk));
  const counterByPerk: Record<string, number> = {
    Patronage: playerHouse.consecutiveHeirsNaturalDeath,
    Seduction: playerHouse.cumulativeSuccessfulSeductions,
    Whispers: playerHouse.cumulativeWeaponizedWhispers,
  };
  const unearned = PROGRESS_ROWS.filter((r) => !awardedKinds.has(r.perk));

  return (
    <section data-testid="ledger-tab-dynasty" className="space-y-6">
      <h2 className="text-lg font-semibold text-stone-800">Dynasty Legacies</h2>

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-stone-500 uppercase tracking-wide">
          Awarded Perks
        </h3>
        {awarded.length === 0 ? (
          <p data-testid="dynasty-awarded-empty" className="text-sm text-stone-500">
            No dynasty perks awarded yet.
          </p>
        ) : (
          <ul data-testid="dynasty-awarded-list" className="space-y-1">
            {awarded.map((a) => (
              <li
                key={a.perk}
                data-testid={`dynasty-awarded-row-${a.perk}`}
                className="flex items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm"
              >
                <span className="w-32 font-medium text-stone-800">{a.perk}</span>
                <span className="text-stone-500">
                  awarded tick {a.awardedAtTick}, generation {a.awardedDuringGeneration}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-stone-500 uppercase tracking-wide">Progress</h3>
        {unearned.length === 0 ? (
          <p data-testid="dynasty-progress-empty" className="text-sm text-stone-500">
            All dynasty perks earned.
          </p>
        ) : (
          <ul data-testid="dynasty-progress-list" className="space-y-1">
            {unearned.map((r) => (
              <li
                key={r.perk}
                data-testid={`dynasty-progress-row-${r.perk}`}
                className="flex items-center gap-3 rounded-md border border-stone-200 px-3 py-2 text-sm"
              >
                <span className="flex-1 text-stone-700">{r.label}</span>
                <span className="font-mono text-stone-500">
                  {counterByPerk[r.perk]} / {r.threshold}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
