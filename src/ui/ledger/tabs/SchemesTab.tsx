// P14: Schemes tab. Wraps the existing ActiveSchemesPanel for the live section
// and adds NEW read-only history sub-sections (Completed / Cancelled / Failed)
// grouped by status. History rows derive outcome prose from scheme.status +
// scheme.failureReason ONLY (the persisted Scheme entity has no scandalDelta —
// that lives on the SeductionDiscovered bus event, not on state).

import { useShallow } from "zustand/react/shallow";
import type { Scheme } from "../../../game/entities";
import type { SeasonStore } from "../../../game/store";
import { ActiveSchemesPanel } from "../ActiveSchemesPanel";

type Props = {
  store: SeasonStore;
};

function outcomeProse(scheme: Scheme): string {
  switch (scheme.status) {
    case "Completed":
      return "Completed";
    case "Cancelled":
      return "Cancelled (no refund)";
    case "Failed":
      return scheme.failureReason === null ? "Failed" : `Failed — ${scheme.failureReason}`;
    default:
      return scheme.status;
  }
}

function HistoryList({
  testId,
  heading,
  schemes,
  nameOf,
}: {
  testId: string;
  heading: string;
  schemes: Scheme[];
  nameOf: (scheme: Scheme) => string;
}) {
  if (schemes.length === 0) return null;
  return (
    <div className="space-y-1">
      <h3 className="text-sm font-medium text-stone-500 uppercase tracking-wide">
        {heading} ({schemes.length})
      </h3>
      <ul
        data-testid={testId}
        className="divide-y divide-stone-200 rounded-md border border-stone-200"
      >
        {schemes.map((scheme) => (
          <li
            key={scheme.id}
            data-testid={`scheme-history-row-${scheme.id}`}
            className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
          >
            <span className="font-medium text-stone-800">{scheme.kind}</span>
            <span className="text-stone-600">{nameOf(scheme)}</span>
            <span className="text-stone-500">
              t{scheme.startedAtTick}–{scheme.resolvedAtTick ?? "?"}
            </span>
            <span className="text-stone-700">{outcomeProse(scheme)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SchemesTab({ store }: Props) {
  const { schemes, characters } = store(
    useShallow((s) => ({ schemes: s.schemes, characters: s.characters })),
  );

  const history = [...schemes.values()]
    .filter((s) => s.status !== "Active")
    .sort((a, b) => a.id.localeCompare(b.id));
  const completed = history.filter((s) => s.status === "Completed");
  const cancelled = history.filter((s) => s.status === "Cancelled");
  const failed = history.filter((s) => s.status === "Failed");

  const nameOf = (scheme: Scheme): string =>
    scheme.targetCharacterId !== null
      ? (characters.get(scheme.targetCharacterId)?.name ?? "?")
      : "—";

  return (
    <section data-testid="ledger-tab-schemes" className="space-y-6">
      <h2 className="text-lg font-semibold text-stone-800">Schemes</h2>
      <div data-testid="schemes-active-list">
        <ActiveSchemesPanel store={store} />
      </div>
      {history.length === 0 ? (
        <p className="text-sm text-stone-500">No scheme history yet.</p>
      ) : (
        <div className="space-y-4">
          <HistoryList
            testId="schemes-history-completed-list"
            heading="Completed"
            schemes={completed}
            nameOf={nameOf}
          />
          <HistoryList
            testId="schemes-history-cancelled-list"
            heading="Cancelled"
            schemes={cancelled}
            nameOf={nameOf}
          />
          <HistoryList
            testId="schemes-history-failed-list"
            heading="Failed"
            schemes={failed}
            nameOf={nameOf}
          />
        </div>
      )}
    </section>
  );
}
