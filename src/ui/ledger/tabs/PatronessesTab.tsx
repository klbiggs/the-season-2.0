// P14: Patronesses tab. Reading-only view of the 5 canonical patronesses
// (favor [0,100], colored by veto-proximity) plus the 4×4 faction-tension
// matrix (6 unordered pairs, mirror-symmetric, declaration-order headers).

import { useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { useShallow } from "zustand/react/shallow";
import {
  FACTION_DISPLAY_NAMES,
  FACTION_IDS,
  makeFactionPairKey,
} from "../../../game/fixtures/factions";
import type { FactionPairKey } from "../../../game/rng.seeds";
import type { SeasonStore } from "../../../game/store";
import { FACTION_COLOR_BY_ID } from "../../socialWeb/colors";

type Props = {
  store: SeasonStore;
};

// P25 R8: pure builder for the faction-tension force-graph — 4 faction nodes +
// 6 tension-weighted links. Exported for unit tests; the numeric matrix stays
// the source of truth (this is a read-only spatial rendering of the same data).
export type FactionGraphNode = { id: string; name: string; color: string };
export type FactionGraphLink = { source: string; target: string; tension: number };
export type FactionGraphData = { nodes: FactionGraphNode[]; links: FactionGraphLink[] };

export function buildFactionGraphData(
  factionTensions: ReadonlyMap<FactionPairKey, number>,
): FactionGraphData {
  const nodes = FACTION_IDS.map((fid, idx) => ({
    id: fid,
    name: FACTION_DISPLAY_NAMES[idx] ?? fid,
    color: FACTION_COLOR_BY_ID[fid] ?? "#64748b",
  }));
  const links: FactionGraphLink[] = [];
  for (let i = 0; i < FACTION_IDS.length; i++) {
    for (let j = i + 1; j < FACTION_IDS.length; j++) {
      const a = FACTION_IDS[i];
      const b = FACTION_IDS[j];
      if (a === undefined || b === undefined) continue;
      links.push({
        source: a,
        target: b,
        tension: factionTensions.get(makeFactionPairKey(a, b)) ?? 0,
      });
    }
  }
  return { nodes, links };
}

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

  // P25 R8: numeric | spatial toggle (numeric is the source of truth).
  const [tensionView, setTensionView] = useState<"numeric" | "spatial">("numeric");
  const factionGraph = buildFactionGraphData(factionTensions);

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
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-medium text-stone-500 uppercase tracking-wide">
            Faction Tension
          </h3>
          <div className="inline-flex rounded border border-stone-300 text-xs">
            {(["numeric", "spatial"] as const).map((m) => (
              <button
                key={m}
                type="button"
                data-testid={`faction-tension-toggle-${m}`}
                onClick={() => setTensionView(m)}
                className={`px-2 py-0.5 ${
                  tensionView === m ? "bg-stone-800 text-white" : "text-stone-600"
                }`}
              >
                {m === "numeric" ? "Matrix" : "Web"}
              </button>
            ))}
          </div>
        </div>
        {tensionView === "spatial" ? (
          <div
            data-testid="faction-tension-graph"
            className="overflow-hidden rounded"
            style={{ backgroundColor: "#1c1917" }}
          >
            <ForceGraph2D
              width={480}
              height={320}
              graphData={factionGraph}
              nodeId="id"
              nodeLabel="name"
              nodeColor={(n: FactionGraphNode) => n.color}
              nodeRelSize={7}
              linkColor={() => "#78716c"}
              linkWidth={(l: FactionGraphLink) => Math.max(1, (l.tension / 100) * 6)}
              linkLabel={(l: FactionGraphLink) => String(l.tension)}
              backgroundColor="#1c1917"
            />
          </div>
        ) : (
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
        )}
      </div>
    </section>
  );
}
