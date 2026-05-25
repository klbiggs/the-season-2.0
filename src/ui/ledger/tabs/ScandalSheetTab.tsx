// P18: Scandal Sheet tab. Read-only surface for the generated, persisted
// per-generation gossip columns (spec §3 line 271 — read-only, no game-state
// mutation). Reads state.flavorText, filters to ScandalColumn entries, renders
// newest-first. Columns are authored once at succession by the flavor
// orchestrator and read back verbatim here.

import { useShallow } from "zustand/react/shallow";
import type { FlavorContentEntry } from "../../../game/entities";
import type { SeasonStore } from "../../../game/store";

type Props = {
  store: SeasonStore;
};

export function ScandalSheetTab({ store }: Props) {
  const { flavorText } = store(
    useShallow((s) => ({
      flavorText: s.flavorText,
      tick: s.tick,
    })),
  );

  const columns: FlavorContentEntry[] = [...flavorText.values()]
    .filter((e) => e.kind === "ScandalColumn")
    .sort((a, b) => b.generatedAtTick - a.generatedAtTick);

  return (
    <section data-testid="ledger-tab-scandal-sheet" className="space-y-6">
      <h2 className="text-lg font-semibold text-stone-800">The Scandal Sheet</h2>
      {columns.length === 0 ? (
        <p data-testid="scandal-sheet-empty" className="text-sm text-stone-500">
          No columns published yet. The presses turn at each succession.
        </p>
      ) : (
        <ul data-testid="scandal-sheet-list" className="space-y-4">
          {columns.map((c) => (
            <li
              key={c.id}
              data-testid={`scandal-column-${c.id}`}
              className="rounded-md border border-stone-200 bg-stone-50 px-4 py-3"
            >
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-stone-400">
                Tick {c.generatedAtTick}
              </div>
              <p className="text-sm italic leading-relaxed text-stone-700">{c.text}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
