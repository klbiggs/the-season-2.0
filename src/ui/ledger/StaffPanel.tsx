// P6: inline ledger panel for household staff. Shows each staff member's
// name, loyalty bar (color-coded), upkeep, and assignment dropdown. Bribed
// staff render with a "Bribed by rival house" badge instead of the
// dropdown (per the tryAssignStaff rule layer rejection).

import { useShallow } from "zustand/react/shallow";
import {
  STAFF_ASSIGNMENTS,
  STAFF_HIRE_WEALTH_COST,
  STAFF_ROSTER_MAX,
  type StaffAssignment,
} from "../../game/constants";
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
  const hireStaff = store((s) => s.hireStaff);
  const fireStaff = store((s) => s.fireStaff);
  const promoteStaff = store((s) => s.promoteStaff);

  const sorted = [...staff.values()].sort((a, b) => a.id.localeCompare(b.id));
  // P24c: active = not dismissed AND not promoted (the roster-cap count).
  const activeCount = sorted.filter(
    (s) => s.dismissedAtTick === null && s.promotedToCharacterId === null,
  ).length;
  const rosterFull = activeCount >= STAFF_ROSTER_MAX;

  return (
    <div className="staff-panel">
      <h3 className="staff-panel__title">Staff</h3>
      <button
        type="button"
        data-testid="hire-staff-btn"
        disabled={rosterFull}
        title={rosterFull ? `Roster full (max ${STAFF_ROSTER_MAX})` : ""}
        onClick={() => {
          const result = hireStaff();
          if (!result.ok) console.warn("hireStaff rejected:", result.reason);
        }}
        className="rounded bg-stone-800 px-2 py-1 text-xs font-medium text-white hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Hire Staff ({STAFF_HIRE_WEALTH_COST}g) · {activeCount}/{STAFF_ROSTER_MAX}
      </button>
      {sorted.length === 0 ? (
        <p className="staff-panel__empty">No household staff.</p>
      ) : (
        <ul className="staff-panel__list">
          {sorted.map((s) => {
            const tier = loyaltyTier(s.loyalty);
            const isBribed = s.assignment === "BribedByRival";
            const isInert = s.dismissedAtTick !== null || s.promotedToCharacterId !== null;
            return (
              <li
                key={s.id}
                data-testid={`staff-row-${s.id}`}
                className="staff-panel__row"
                style={isInert ? { opacity: 0.55 } : undefined}
              >
                <div className="staff-panel__name">{s.name}</div>
                {isInert ? (
                  <div className="staff-panel__bribed-badge">
                    {s.promotedToCharacterId !== null
                      ? `Promoted (t${s.dismissedAtTick ?? ""})`
                      : `Dismissed t${s.dismissedAtTick}`}
                  </div>
                ) : (
                  <>
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
                    <button
                      type="button"
                      data-testid={`promote-staff-${s.id}`}
                      title="Promote this staffer into a marriage-eligible family member"
                      onClick={() => {
                        if (
                          window.confirm(
                            `Promote ${s.name} into a family Character? This is permanent.`,
                          )
                        ) {
                          const result = promoteStaff(s.id as StaffId);
                          if (!result.ok)
                            console.warn(`promoteStaff(${s.id}) rejected:`, result.reason);
                        }
                      }}
                      className="rounded bg-emerald-700 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-600"
                    >
                      Promote
                    </button>
                    <button
                      type="button"
                      data-testid={`fire-staff-${s.id}`}
                      title="Dismiss this staffer (the only way to remove a bribed member)"
                      onClick={() => {
                        const result = fireStaff(s.id as StaffId);
                        if (!result.ok) console.warn(`fireStaff(${s.id}) rejected:`, result.reason);
                      }}
                      className="rounded bg-rose-700 px-2 py-1 text-xs font-medium text-white hover:bg-rose-600"
                    >
                      Fire
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
