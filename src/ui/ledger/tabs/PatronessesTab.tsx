// P14: Patronesses tab. Reading-only view of the 5 canonical patronesses
// (favor [0,100], colored by veto-proximity) plus the 4×4 faction-tension
// matrix (6 unordered pairs, mirror-symmetric, declaration-order headers).

import { useShallow } from "zustand/react/shallow";
import {
  FACTION_DISPLAY_NAMES,
  FACTION_IDS,
  makeFactionPairKey,
} from "../../../game/fixtures/factions";
import type { SeasonStore } from "../../../game/store";

type Props = {
  store: SeasonStore;
};

function favorBarColor(favor: number): string {
  if (favor >= 60) return "bg-green-600";
  if (favor >= 40) return "bg-yellow-500";
  if (favor >= 20) return "bg-orange-500";
  return "bg-red-600"; // < 20 — impending ball veto (spec §3 line 116)
}

export function PatronessesTab({ store }: Props) {
  const { patronesses, factionTensions } = store(
    useShallow((s) => ({
      patronesses: s.patronesses,
      factionTensions: s.factionTensions,
    })),
  );

  const rows = [...patronesses.values()].sort((a, b) => a.id.localeCompare(b.id));

  const factionLabel = (idx: number): string => FACTION_DISPLAY_NAMES[idx] ?? "?";

  return (
    <section data-testid="ledger-tab-patronesses" className="space-y-6">
      <h2 className="text-lg font-semibold text-stone-800">Patronesses</h2>
      <ul data-testid="patroness-list" className="space-y-2">
        {rows.map((p) => {
          const factionIdx = FACTION_IDS.indexOf(p.factionId);
          return (
            <li
              key={p.id}
              data-testid={`patroness-row-${p.id}`}
              className="flex items-center gap-3 rounded-md border border-stone-200 px-3 py-2"
            >
              <span className="w-48 font-medium text-stone-800">{p.displayName}</span>
              <span className="w-20 text-sm text-stone-500">
                {factionIdx >= 0 ? factionLabel(factionIdx) : p.factionId}
              </span>
              <div className="relative h-3 flex-1 overflow-hidden rounded bg-stone-200">
                <div
                  className={`h-full ${favorBarColor(p.favor)}`}
                  style={{ width: `${p.favor}%` }}
                />
              </div>
              <span className="w-10 text-right text-sm tabular-nums text-stone-700">{p.favor}</span>
            </li>
          );
        })}
      </ul>

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-stone-500 uppercase tracking-wide">
          Faction Tension
        </h3>
        <table data-testid="faction-tension-matrix" className="border-collapse text-sm">
          <thead>
            <tr>
              <th className="px-2 py-1" />
              {FACTION_IDS.map((fid, idx) => (
                <th key={fid} className="px-2 py-1 text-stone-500 font-medium">
                  {factionLabel(idx)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FACTION_IDS.map((rowFid, rowIdx) => (
              <tr key={rowFid}>
                <th className="px-2 py-1 text-left text-stone-500 font-medium">
                  {factionLabel(rowIdx)}
                </th>
                {FACTION_IDS.map((colFid, colIdx) => {
                  if (rowIdx === colIdx) {
                    return (
                      <td
                        key={colFid}
                        className="px-2 py-1 text-center text-stone-300 bg-stone-50"
                        data-testid={`tension-cell-${rowIdx}-${colIdx}`}
                      >
                        —
                      </td>
                    );
                  }
                  const value = factionTensions.get(makeFactionPairKey(rowFid, colFid)) ?? 0;
                  return (
                    <td
                      key={colFid}
                      className="px-2 py-1 text-center tabular-nums text-stone-700"
                      data-testid={`tension-cell-${rowIdx}-${colIdx}`}
                    >
                      {value}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
