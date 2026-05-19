// P1 dev affordance: triggers a single year-pass (aging → succession →
// conception). Per-click semantics, not per-tick — two rapid clicks produce
// two age increments at the same state.tick. P3+ may add gating for the real
// gameplay UI; the dev surface accepts the raw semantics.

import type { SeasonStore } from "../../game/store";

type Props = { store: SeasonStore };

export function YearPassButton({ store }: Props) {
  const runYearPass = store((s) => s.runYearPass);
  return (
    <button
      type="button"
      onClick={runYearPass}
      className="px-4 py-2 rounded bg-amber-700 text-stone-50 hover:bg-amber-600"
      data-testid="year-pass-button"
    >
      Pass Year
    </button>
  );
}
