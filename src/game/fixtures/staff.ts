// P6: baseline household-staff registry. Single source of truth for the
// fresh-state (seedStartingFamily) path. Mirrors the BASELINE_NPCS pattern
// at fixtures/npcs.ts.
//
// All fields are pre-assigned constants — ZERO RNG draws involved in staff
// construction. The bootstrap draw budget stays at 1 (player head's
// deathAge only), unchanged from P3.
//
// 4 baseline staff modeling a Regency household (housekeeper / valet /
// driver / lady's maid). 2 of 4 are Greedy by default, biasing playtest
// toward visible bribery pressure rather than a flat-rate happy path.

import {
  STAFF_PROCEDURAL_GREEDY_PCT,
  STAFF_PROCEDURAL_LOYALTY_MAX,
  STAFF_PROCEDURAL_LOYALTY_MIN,
  STAFF_PROCEDURAL_UPKEEP_MAX,
  STAFF_PROCEDURAL_UPKEEP_MIN,
  STAFF_UPKEEP_DEFAULT,
} from "../constants";
import type { GameState, StaffMember } from "../entities";
import { PLAYER_HOUSE_ID, type RngState, type StaffId, drawInt } from "../rng";

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
    // P24c: baseline staff start active (never dismissed, never promoted).
    dismissedAtTick: null,
    promotedToCharacterId: null,
  };
}

// Single source of truth — called by seedStartingFamily (fresh-state path)
// so there's no constants duplication in bootstrap.ts.
export function buildBaselineStaffMap(): Map<StaffId, StaffMember> {
  const m = new Map<StaffId, StaffMember>();
  for (const seed of BASELINE_STAFF) {
    m.set(seed.id, buildBaselineStaffMember(seed));
  }
  return m;
}

// ── P24c: hire + procedural staff identity ───────────────────────────────

// Surname bank for procedurally-hired staff (I4). Period below-stairs surnames.
const PROCEDURAL_STAFF_SURNAMES: readonly string[] = [
  "Bramble",
  "Coombe",
  "Fenwick",
  "Gattis",
  "Holloway",
  "Larkin",
  "Mossop",
  "Pruett",
  "Renshaw",
  "Sowerby",
  "Treadwell",
  "Wragge",
];

// Draw-free state-walk id factory (P6 reserved this for "P15+"; P24c ships it).
// Format `staff-proc-<index>` where index counts existing `staff-proc-` members
// (so hired ids never collide with the fixed BASELINE_STAFF ids).
export const PROCEDURAL_STAFF_ID_PREFIX = "staff-proc-";
export function makeStaffId(state: GameState): StaffId {
  let index = 0;
  for (const s of state.staff.values()) {
    if (s.id.startsWith(PROCEDURAL_STAFF_ID_PREFIX)) index += 1;
  }
  return `${PROCEDURAL_STAFF_ID_PREFIX}${index}` as StaffId;
}

// Procedural staff identity (I4). FIXED 4-draw budget: greedy → upkeep → loyalty
// → name. Mirrors buildBaselineStaffMember field-for-field. Always player-owned,
// assignment "None", active (not dismissed/promoted).
export function buildProceduralStaffMember(
  id: StaffId,
  rngState: RngState,
): { staff: StaffMember; rngState: RngState } {
  let rng = rngState;

  const greedyPick = drawInt(rng, 100);
  rng = greedyPick.rngState;
  const isGreedy = greedyPick.next < STAFF_PROCEDURAL_GREEDY_PCT;

  const upkeepPick = drawInt(rng, STAFF_PROCEDURAL_UPKEEP_MAX - STAFF_PROCEDURAL_UPKEEP_MIN + 1);
  rng = upkeepPick.rngState;
  const upkeepPerTick = upkeepPick.next + STAFF_PROCEDURAL_UPKEEP_MIN;

  const loyaltyPick = drawInt(rng, STAFF_PROCEDURAL_LOYALTY_MAX - STAFF_PROCEDURAL_LOYALTY_MIN + 1);
  rng = loyaltyPick.rngState;
  const loyalty = loyaltyPick.next + STAFF_PROCEDURAL_LOYALTY_MIN;

  const namePick = drawInt(rng, PROCEDURAL_STAFF_SURNAMES.length);
  rng = namePick.rngState;
  const surname = PROCEDURAL_STAFF_SURNAMES[namePick.next] as string;

  const staff: StaffMember = {
    id,
    houseId: PLAYER_HOUSE_ID,
    name: `${surname} (staff)`,
    isGreedy,
    loyalty,
    upkeepPerTick,
    assignment: "None",
    lastOutputTick: null,
    bribedAtTick: null,
    dismissedAtTick: null,
    promotedToCharacterId: null,
  };
  return { staff, rngState: rng };
}
