// P6: inline ledger panel for household staff. Shows each staff member's
// name, loyalty bar (color-coded), upkeep, and assignment dropdown. Bribed
// staff render with a "Bribed by rival house" badge instead of the
// dropdown (per the tryAssignStaff rule layer rejection).

import { useShallow } from "zustand/react/shallow";
import { STAFF_ASSIGNMENTS, type StaffAssignment } from "../../game/constants";
import type { StaffId } from "../../game/rng.seeds";
import type { SeasonStore } from "../../game/store";

type Props = {
  store: SeasonStore;
};

// Only player-electable assignments — BribedByRival is system-set only.
const SELECTABLE_ASSIGNMENTS: ReadonlyArray<StaffAssignment> = STAFF_ASSIGNMENTS.filter(
  (a): a is StaffAssignment => a !== "BribedByRival",
);

function loyaltyTier(loyalty: number): "high" | "mid" | "low" {
  if (loyalty >= 70) return "high";
  if (loyalty >= 30) return "mid";
  return "low";
}

export function StaffPanel({ store }: Props) {
  const { staff } = store(useShallow((s) => ({ staff: s.staff })));
  const assignStaff = store((s) => s.assignStaff);

  const sorted = [...staff.values()].sort((a, b) => a.id.localeCompare(b.id));
  if (sorted.length === 0) {
    return (
      <div className="staff-panel">
        <h3 className="staff-panel__title">Staff</h3>
        <p className="staff-panel__empty">No household staff.</p>
      </div>
    );
  }

  return (
    <div className="staff-panel">
      <h3 className="staff-panel__title">Staff</h3>
      <ul className="staff-panel__list">
        {sorted.map((s) => {
          const tier = loyaltyTier(s.loyalty);
          const isBribed = s.assignment === "BribedByRival";
          return (
            <li key={s.id} className="staff-panel__row">
              <div className="staff-panel__name">{s.name}</div>
              <div className={`staff-panel__loyalty staff-panel__loyalty--${tier}`}>
                Loyalty: {s.loyalty}
              </div>
              <div className="staff-panel__upkeep">Upkeep: {s.upkeepPerTick}/tick</div>
              {isBribed ? (
                <div className="staff-panel__bribed-badge">Bribed by rival house</div>
              ) : (
                <select
                  className="staff-panel__assignment"
                  value={s.assignment}
                  onChange={(e) => {
                    const newAssignment = e.target.value as StaffAssignment;
                    const result = assignStaff(s.id as StaffId, newAssignment);
                    if (!result.ok) {
                      console.warn(
                        `assignStaff(${s.id}, ${newAssignment}) rejected:`,
                        result.reason,
                      );
                    }
                  }}
                >
                  {SELECTABLE_ASSIGNMENTS.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
