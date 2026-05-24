// P14: the canonical 8-tab Ledger view (fourth top-level view; suppressed by
// the Elopement overlay, takes precedence over Map). Hand-rolled ARIA tabs
// (shadcn is a v1.5 candidate per MASTER.md §2). Reading-only over the store —
// every tab reads via useShallow selectors; mutations route through existing
// store actions inside each tab.

import { useState } from "react";
import type { SeasonStore } from "../../game/store";
import { ArtifactsTab } from "./tabs/ArtifactsTab";
import { FamilyTreeTab } from "./tabs/FamilyTreeTab";
import { GrievancesTab } from "./tabs/GrievancesTab";
import { PatronessesTab } from "./tabs/PatronessesTab";
import { RivalsTab } from "./tabs/RivalsTab";
import { SchemesTab } from "./tabs/SchemesTab";
import { StaffTab } from "./tabs/StaffTab";
import { WhispersTab } from "./tabs/WhispersTab";

type Props = {
  store: SeasonStore;
  onExit: () => void;
};

type TabKey =
  | "family-tree"
  | "whispers"
  | "schemes"
  | "patronesses"
  | "grievances"
  | "rivals"
  | "staff"
  | "artifacts";

const TABS: ReadonlyArray<{ key: TabKey; label: string }> = [
  { key: "family-tree", label: "Family Tree" },
  { key: "whispers", label: "Whispers" },
  { key: "schemes", label: "Schemes" },
  { key: "patronesses", label: "Patronesses" },
  { key: "grievances", label: "Grievances" },
  { key: "rivals", label: "Rivals" },
  { key: "staff", label: "Staff" },
  { key: "artifacts", label: "Artifacts" },
];

export function LedgerView({ store, onExit }: Props) {
  const [active, setActive] = useState<TabKey>("family-tree");

  return (
    <div data-testid="ledger-view" className="flex flex-col gap-4 p-6">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={onExit}
          data-testid="ledger-back-btn"
          className="rounded-md border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-100"
        >
          ← Back to Map
        </button>
        <div role="tablist" aria-label="Ledger sections" className="flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`ledger-tabbtn-${t.key}`}
              aria-selected={active === t.key}
              aria-controls={`ledger-tab-${t.key}`}
              data-testid={`ledger-tabbtn-${t.key}`}
              onClick={() => setActive(t.key)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                active === t.key ? "bg-stone-800 text-white" : "text-stone-600 hover:bg-stone-100"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div role="tabpanel" aria-labelledby={`ledger-tabbtn-${active}`} className="min-h-[400px]">
        {active === "family-tree" && <FamilyTreeTab store={store} />}
        {active === "whispers" && <WhispersTab store={store} />}
        {active === "schemes" && <SchemesTab store={store} />}
        {active === "patronesses" && <PatronessesTab store={store} />}
        {active === "grievances" && <GrievancesTab store={store} />}
        {active === "rivals" && <RivalsTab store={store} />}
        {active === "staff" && <StaffTab store={store} />}
        {active === "artifacts" && <ArtifactsTab store={store} />}
      </div>
    </div>
  );
}
