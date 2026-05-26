// P14: Staff tab. Wraps the existing StaffPanel (roster + assignment) and
// SpymasterInterceptCard (spymaster action), both moved here from the MapView
// sidebar. Zero behavioral change to either panel.
//
// P21: adds a Couriers readout (in-flight + resolved) so the Spymaster intercept
// affordance is legible — the card acts on state.couriers, which had no readout.

import { useShallow } from "zustand/react/shallow";
import type { CourierPayload } from "../../../game/entities";
import type { SeasonStore } from "../../../game/store";
import { SpymasterInterceptCard } from "../SpymasterInterceptCard";
import { StaffPanel } from "../StaffPanel";
import { houseDisplayName } from "../houseName";

type Props = {
  store: SeasonStore;
};

function CourierRoute({ c }: { c: CourierPayload }) {
  return (
    <span className="flex-1 text-stone-700">
      {houseDisplayName(c.originHouseId)} <span className="text-stone-400">→</span>{" "}
      {houseDisplayName(c.destinationHouseId)}
    </span>
  );
}

export function StaffTab({ store }: Props) {
  const { couriers, tick } = store(useShallow((s) => ({ couriers: s.couriers, tick: s.tick })));

  const inFlight = [...couriers.values()]
    .filter((c) => c.status === "InFlight")
    .sort((a, b) => a.arrivalTick - b.arrivalTick || a.id.localeCompare(b.id));
  const resolved = [...couriers.values()]
    .filter((c) => c.status !== "InFlight")
    .sort((a, b) => (b.resolvedAtTick ?? 0) - (a.resolvedAtTick ?? 0) || a.id.localeCompare(b.id));

  return (
    <section data-testid="ledger-tab-staff" className="space-y-6">
      <h2 className="text-lg font-semibold text-stone-800">Staff</h2>
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-stone-500 uppercase tracking-wide">Roster</h3>
        <StaffPanel store={store} />
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-stone-500 uppercase tracking-wide">
          Spymaster Action
        </h3>
        <SpymasterInterceptCard store={store} />
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-stone-500 uppercase tracking-wide">Couriers</h3>
        {inFlight.length === 0 && resolved.length === 0 ? (
          <p className="text-sm text-stone-500">No couriers in transit.</p>
        ) : (
          <>
            {inFlight.length > 0 && (
              <ul data-testid="staff-couriers-list" className="space-y-1">
                {inFlight.map((c) => (
                  <li
                    key={c.id}
                    data-testid={`courier-row-${c.id}`}
                    className="flex items-center gap-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm"
                  >
                    <span className="w-20 text-stone-500">{c.direction}</span>
                    <CourierRoute c={c} />
                    <span className="w-24 text-stone-500">
                      {Math.max(0, c.arrivalTick - tick)}t left
                    </span>
                    {c.interceptable && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                        interceptable
                      </span>
                    )}
                    <span className="w-28 text-stone-400">{c.whisperId}</span>
                  </li>
                ))}
              </ul>
            )}
            {resolved.length > 0 && (
              <details data-testid="staff-couriers-history">
                <summary className="cursor-pointer text-sm text-stone-500">
                  Resolved ({resolved.length})
                </summary>
                <ul className="mt-1 space-y-1">
                  {resolved.map((c) => (
                    <li
                      key={c.id}
                      data-testid={`courier-row-${c.id}`}
                      className="flex items-center gap-3 rounded-md border border-stone-200 px-3 py-2 text-sm opacity-70"
                    >
                      <span className="w-24 text-stone-500">{c.status}</span>
                      <span className="w-20 text-stone-500">{c.direction}</span>
                      <CourierRoute c={c} />
                      <span className="w-20 text-stone-400">
                        {c.resolvedAtTick !== null ? `t${c.resolvedAtTick}` : "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </div>
    </section>
  );
}
