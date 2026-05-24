// P5: inline ledger panel showing Active schemes only. Renders as a
// collapsible section on the strategy-map sidebar (NOT a full ledger view —
// P14 owns the full tabbed ledger). Per the plan: minimum surface needed
// to expose the scheme lifecycle for testing and play.
//
// Reactive subscription pattern (load-bearing for perf): ticksRemaining
// depends on BOTH state.tick AND state.schemes. Without useShallow (or
// equivalent), Zustand's default subscribe-by-selector triggers two
// re-renders per tick. The combined selector below bundles the subscription
// into one re-render.

import { useShallow } from "zustand/react/shallow";
import type { SeasonStore } from "../../game/store";

type Props = {
  store: SeasonStore;
};

export function ActiveSchemesPanel({ store }: Props) {
  // useShallow bundles the (tick, schemes, characters) subscription into a
  // single re-render per tick. Adding `characters` to the bundle lets us
  // resolve target names without a separate selector.
  const { tick, schemes, characters } = store(
    useShallow((s) => ({
      tick: s.tick,
      schemes: s.schemes,
      characters: s.characters,
    })),
  );
  const cancelScheme = store((s) => s.cancelScheme);

  const active = [...schemes.values()]
    .filter((s) => s.status === "Active")
    .sort((a, b) => a.id.localeCompare(b.id));

  if (active.length === 0) {
    return (
      <div className="active-schemes-panel">
        <h3 className="active-schemes-panel__title">Active Schemes</h3>
        <p className="active-schemes-panel__empty">No active schemes.</p>
      </div>
    );
  }

  return (
    <div className="active-schemes-panel">
      <h3 className="active-schemes-panel__title">Active Schemes</h3>
      <ul className="active-schemes-panel__list">
        {active.map((scheme) => {
          // Defensive clamp at render time against a brief post-resolution flash
          // before the panel re-filters (status hasn't propagated to the
          // useShallow snapshot yet).
          const ticksRemaining = Math.max(0, scheme.endsAtTick - tick);
          const target =
            scheme.targetCharacterId !== null ? characters.get(scheme.targetCharacterId) : null;
          const targetLabel = target?.name ?? (scheme.kind === "Smuggling" ? "—" : "?");
          return (
            <li key={scheme.id} className="active-schemes-panel__row">
              <span className="active-schemes-panel__kind">{scheme.kind}</span>
              <span className="active-schemes-panel__target">{targetLabel}</span>
              <span className="active-schemes-panel__ticks">{ticksRemaining}t</span>
              <button
                type="button"
                className="active-schemes-panel__cancel"
                data-testid={`active-scheme-cancel-${scheme.id}`}
                title="Cancel this scheme. No wealth refund."
                onClick={() => {
                  // Spec line 362: cancellation refunds nothing. UI confirms via
                  // window.confirm at minimum-polish; richer modal at P14.
                  if (
                    window.confirm(`Cancel this ${scheme.kind}? Wealth cost will not be refunded.`)
                  ) {
                    const result = cancelScheme(scheme.id);
                    if (!result.ok) {
                      console.warn(`cancelScheme(${scheme.id}) rejected:`, result.reason);
                    }
                  }
                }}
              >
                Cancel
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
