// P6: baseline household-staff registry. Single source of truth for both
// fresh-state (seedStartingFamily) and migration (seedWhispersCouriersStaff
// IntoLegacyState) paths so both produce byte-identical Maps. Mirrors the
// BASELINE_NPCS pattern at fixtures/npcs.ts.
//
// All fields are pre-assigned constants — ZERO RNG draws involved in staff
// construction. The bootstrap draw budget stays at 1 (player head's
// deathAge only), unchanged from P3.
//
// 4 baseline staff modeling a Regency household (housekeeper / valet /
// driver / lady's maid). 2 of 4 are Greedy by default, biasing playtest
// toward visible bribery pressure rather than a flat-rate happy path.

import { STAFF_UPKEEP_DEFAULT } from "../constants";
import type { StaffMember } from "../entities";
import { PLAYER_HOUSE_ID, type StaffId } from "../rng";

export type BaselineStaffSeed = {
  id: StaffId;
  name: string;
  isGreedy: boolean;
  startingLoyalty: number;
};

export const BASELINE_STAFF: ReadonlyArray<BaselineStaffSeed> = [
  {
    id: "staff-mrs-hudson" as StaffId,
    name: "Mrs. Hudson (housekeeper)",
    isGreedy: false,
    startingLoyalty: 80,
  },
  {
    id: "staff-thompson" as StaffId,
    name: "Thompson (valet)",
    isGreedy: true,
    startingLoyalty: 60,
  },
  {
    id: "staff-greer" as StaffId,
    name: "Greer (carriage driver)",
    isGreedy: false,
    startingLoyalty: 70,
  },
  {
    id: "staff-pell" as StaffId,
    name: "Pell (lady's maid)",
    isGreedy: true,
    startingLoyalty: 55,
  },
];

export function buildBaselineStaffMember(seed: BaselineStaffSeed): StaffMember {
  return {
    id: seed.id,
    houseId: PLAYER_HOUSE_ID,
    name: seed.name,
    isGreedy: seed.isGreedy,
    loyalty: seed.startingLoyalty,
    upkeepPerTick: STAFF_UPKEEP_DEFAULT,
    assignment: "None", // player must explicitly assign
    lastOutputTick: null, // never produced; first cadence fires at first reassign + cadence
    bribedAtTick: null,
  };
}

// Single source of truth — called by BOTH seedStartingFamily (fresh-state
// path) AND seedWhispersCouriersStaffIntoLegacyState (migration/lifter path)
// so there's no constants duplication between bootstrap.ts and schema.ts.
// Vitest assertion in bootstrap.test.ts asserts byte-identical staff Maps
// across both paths.
export function buildBaselineStaffMap(): Map<StaffId, StaffMember> {
  const m = new Map<StaffId, StaffMember>();
  for (const seed of BASELINE_STAFF) {
    m.set(seed.id, buildBaselineStaffMember(seed));
  }
  return m;
}
