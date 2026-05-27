// P6: staff resolver module. Owns loyalty drift, per-tick bribery rolls
// (Greedy + sub-threshold staff only), per-cadence outputs per assignment,
// and player actions for reassignment + Spymaster mail-intercept. Pure
// rule layer per CLAUDE.md non-negotiable §1.
//
// Determinism: the accumulator pattern clones acc.rng + acc.whispers +
// acc.couriers + acc.staff per iteration so makeWhisperId / makeCourierPayloadId
// index walks see prior iterations' creations (preventing same-tick id
// collisions across multi-staff cadence outputs).

import {
  SPYMASTER_INTERCEPT_WEALTH_COST,
  STAFF_ASSIGNMENTS,
  STAFF_BRIBED_BY_RIVAL_CADENCE_TICKS,
  STAFF_BRIBERY_LOYALTY_THRESHOLD,
  STAFF_BRIBERY_PROBABILITY_BASE,
  STAFF_BRIBE_DRIVER_CADENCE_TICKS,
  STAFF_HIRE_WEALTH_COST,
  STAFF_INTERCEPT_MAIL_CADENCE_TICKS,
  STAFF_LOYALTY_DRIFT_GREEDY_UNDERPAID_PER_TICK,
  STAFF_LOYALTY_DRIFT_UNDERPAID_PER_TICK,
  STAFF_ROSTER_MAX,
  STAFF_SNOOP_CADENCE_TICKS,
  type StaffAssignment,
  WHISPERS_PERK_BRIBERY_RESISTANCE_MULTIPLIER,
} from "../constants";
import type { GameState, StaffMember } from "../entities";
import type { LocationId } from "../fixtures/locations";
import { buildProceduralStaffMember, makeStaffId } from "../fixtures/staff";
import {
  type CharacterId,
  type CourierPayloadId,
  INDEPENDENT_HOUSE_ID,
  PLAYER_HOUSE_ID,
  type StaffId,
  drawNext,
  getOrThrow,
} from "../rng";
import { clamp } from "../util/clamp";
import { getHouseOrThrow } from "../util/lookups";
import { hasDynastyPerk } from "./dynastyLegacies";
import { generateSynergyWhisper, generateWhisperCourier } from "./whispers";

// ── Public input/result types ────────────────────────────────────────────

export type AssignStaffResult =
  | { ok: true; state: GameState }
  | { ok: false; reason: AssignStaffRejection };

export type AssignStaffRejection =
  | { kind: "StaffNotFound"; staffId: StaffId }
  | { kind: "StaffBribedByRival"; staffId: StaffId }
  | { kind: "AssignmentInvalid"; rejectedAssignment: StaffAssignment }
  | { kind: "PlayerExiled" }
  | { kind: "ElopementInProgress" }; // P9 Q4

export type SpymasterInterceptResult =
  | { ok: true; state: GameState }
  | { ok: false; reason: SpymasterInterceptRejection };

export type SpymasterInterceptRejection =
  | { kind: "NoLivingSpymaster" }
  | { kind: "InsufficientWealth"; have: number; need: number }
  | { kind: "NoEligibleCourier" }
  | { kind: "PlayerExiled" }
  | { kind: "ElopementInProgress" }; // P9 Q4

// ── Phase function (called from applyCourierAndStaffPhase) ───────────────

// Walk staff in lex-StaffId order. For each staff member:
//   step 1: loyalty drift if owning house wealth < 0 (Greedy -2, else -1).
//   step 2: bribery roll IFF Greedy AND sub-threshold AND assignment !==
//           BribedByRival; on bribe, flip assignment + bribedAtTick AND
//           reset lastOutputTick to acc.tick (mirrors tryAssignStaff fix).
//   step 3: cadence-output IFF assignment !== "None" AND
//           state.tick - (lastOutputTick ?? -cadence) >= cadence.
//   step 4: lastOutputTick = state.tick if step 3 was reached (any non-None).
//
// PRNG: 1 draw per Greedy underpaid sub-threshold staff (bribery roll).
// Accumulator pattern: per-iteration clone-and-set of acc.rng / acc.staff /
// acc.whispers / acc.couriers so factories' index walks see prior creations.
export function applyStaffOutputsPhase(state: GameState): GameState {
  let acc: GameState = {
    ...state,
    staff: new Map(state.staff),
    rng: new Map(state.rng),
    whispers: new Map(state.whispers),
    couriers: new Map(state.couriers),
  };

  const sortedStaffIds = [...state.staff.keys()].sort();
  for (const staffId of sortedStaffIds) {
    const s0 = acc.staff.get(staffId);
    if (s0 === undefined) continue;
    // P24c: dismissed (fired) + promoted (→ Character) staff are INERT — never
    // deleted, but skipped here (no loyalty drift, no bribery roll, no cadence
    // output). The bribery roll is the only RNG draw in this loop, so skipping
    // an inert member consumes ZERO draws (an inert member never would have
    // drawn unless Greedy + sub-threshold; the skip is BEFORE the draw gate, so
    // a future fire of a Greedy member removes its per-tick draw — intended).
    if (s0.dismissedAtTick !== null || s0.promotedToCharacterId !== null) continue;
    let s = s0;

    // ── Step 1: loyalty drift ──────────────────────────────────────────
    const ownerHouse = acc.houses.get(s.houseId);
    if (ownerHouse !== undefined && ownerHouse.wealth < 0) {
      const delta = s.isGreedy
        ? STAFF_LOYALTY_DRIFT_GREEDY_UNDERPAID_PER_TICK
        : STAFF_LOYALTY_DRIFT_UNDERPAID_PER_TICK;
      s = { ...s, loyalty: clamp(s.loyalty + delta, 0, 100) };
      acc.staff.set(staffId, s);
    }

    // ── Step 2: bribery roll (Greedy + sub-threshold + not-already-bribed) ─
    if (
      s.isGreedy &&
      s.assignment !== "BribedByRival" &&
      s.loyalty < STAFF_BRIBERY_LOYALTY_THRESHOLD
    ) {
      const rngBefore = getOrThrow(acc.rng, s.houseId);
      const { next, rngState: rngAfter } = drawNext(rngBefore);
      acc = { ...acc, rng: new Map(acc.rng).set(s.houseId, rngAfter) };
      // P24c (I4): the Whispers dynasty perk's espionage-resistance half lowers
      // the bribery THRESHOLD (not the draw count — the draw above already
      // fired). Player-house staff only (the perk is a player-house legacy).
      const briberyThreshold =
        s.houseId === PLAYER_HOUSE_ID && hasDynastyPerk(acc, "Whispers")
          ? STAFF_BRIBERY_PROBABILITY_BASE * WHISPERS_PERK_BRIBERY_RESISTANCE_MULTIPLIER
          : STAFF_BRIBERY_PROBABILITY_BASE;
      if (next < briberyThreshold) {
        s = {
          ...s,
          assignment: "BribedByRival",
          bribedAtTick: acc.tick,
          lastOutputTick: acc.tick, // reset cadence anchor to avoid immediate-fire
        };
        acc.staff.set(staffId, s);
      }
    }

    // ── Step 3: cadence output (any assignment !== "None") ────────────
    if (s.assignment !== "None") {
      const cadence = cadenceForAssignment(s.assignment);
      const due = acc.tick - (s.lastOutputTick ?? -cadence) >= cadence;
      if (due) {
        const after = produceCadenceOutput(acc, s);
        acc = after;
        // ── Step 4: lastOutputTick update — fires whether the cadence
        // produced a deliverable or no-op (punch-the-clock semantics).
        const sFresh = acc.staff.get(staffId);
        if (sFresh !== undefined) {
          acc.staff.set(staffId, { ...sFresh, lastOutputTick: acc.tick });
        }
      }
    }
  }

  return acc;
}

function cadenceForAssignment(assignment: StaffAssignment): number {
  switch (assignment) {
    case "Snoop":
      return STAFF_SNOOP_CADENCE_TICKS;
    case "BribeDriver":
      return STAFF_BRIBE_DRIVER_CADENCE_TICKS;
    case "InterceptMail":
      return STAFF_INTERCEPT_MAIL_CADENCE_TICKS;
    case "BribedByRival":
      return STAFF_BRIBED_BY_RIVAL_CADENCE_TICKS;
    case "None":
      // Unreachable via the step-3 gate; placeholder to keep switch exhaustive.
      return Number.POSITIVE_INFINITY;
  }
}

// Produces ONE cadence output for the given staff member; returns the
// new accumulator. May produce a no-op (no whisper/courier created) when
// no eligible subject exists — step 4 still updates lastOutputTick per
// the punch-the-clock semantic.
function produceCadenceOutput(acc: GameState, staff: StaffMember): GameState {
  const ownerHouse = getHouseOrThrow(acc, staff.houseId);
  const headOfHouseId = ownerHouse.headOfHouseCharacterId;
  switch (staff.assignment) {
    case "Snoop":
    case "BribeDriver": {
      // P24c (I3): BribeDriver targets NPCs at the player's CURRENT location
      // (spec §3 L457 — "whispers about characters whose recent travel matches");
      // Snoop stays location-agnostic. This differentiates the two by SUBJECT
      // SET, not just cadence.
      const location = staff.assignment === "BribeDriver" ? ownerHouse.currentLocation : null;
      const subject = pickStaffWhisperSubject(acc, location);
      if (subject === null) return acc;
      const w = generateSynergyWhisper(acc, headOfHouseId, subject, acc.tick);
      const newWhispers = new Map(acc.whispers);
      newWhispers.set(w.id, w);
      const acc2: GameState = { ...acc, whispers: newWhispers };
      const c = generateWhisperCourier(acc2, w, "Capital", PLAYER_HOUSE_ID);
      const newCouriers = new Map(acc2.couriers);
      newCouriers.set(c.id, c);
      return { ...acc2, couriers: newCouriers };
    }
    case "InterceptMail": {
      // Find the lex-smallest InFlight inbound interceptable courier
      // targeting PLAYER_HOUSE_ID. Flip to Intercepted; whisper stays Unverified
      // forever with arrivedAtTick: null (the "intercepted" marker).
      const sortedCourierIds = [...acc.couriers.keys()].sort();
      for (const cid of sortedCourierIds) {
        // biome-ignore lint/style/noNonNullAssertion: id from keys() always present
        const c = acc.couriers.get(cid)!;
        if (
          c.status === "InFlight" &&
          c.direction === "Inbound" &&
          c.destinationHouseId === PLAYER_HOUSE_ID &&
          c.interceptable
        ) {
          const newCouriers = new Map(acc.couriers);
          newCouriers.set(cid, { ...c, status: "Intercepted", resolvedAtTick: acc.tick });
          return { ...acc, couriers: newCouriers };
        }
      }
      return acc; // no eligible courier — no-op (lastOutputTick still updates)
    }
    case "BribedByRival": {
      // Outbound whisper ABOUT the player's head, destination = Independent
      // (placeholder at v1; P8 routes to a real rival). Inert at v1 (no
      // rival-side whisper-consuming rule).
      const playerHouse = getHouseOrThrow(acc, PLAYER_HOUSE_ID);
      const playerHeadId = playerHouse.headOfHouseCharacterId;
      const w = generateSynergyWhisper(acc, headOfHouseId, playerHeadId, acc.tick);
      const newWhispers = new Map(acc.whispers);
      newWhispers.set(w.id, w);
      const acc2: GameState = { ...acc, whispers: newWhispers };
      const c = generateWhisperCourier(acc2, w, "Capital", INDEPENDENT_HOUSE_ID);
      const newCouriers = new Map(acc2.couriers);
      newCouriers.set(c.id, c);
      return { ...acc2, couriers: newCouriers };
    }
    case "None":
      return acc; // unreachable per step-3 gate
  }
}

// P24c (I3): subject picker, now location-aware. `location === null` (Snoop) →
// lex-smallest living non-player NPC. `location !== null` (BribeDriver) →
// lex-smallest living non-player NPC AT that location (the player's current
// travel destination); FALLS BACK to the location-agnostic pick when no NPC
// matches, so the assignment still produces a whisper.
function pickStaffWhisperSubject(
  state: GameState,
  location: LocationId | null,
): CharacterId | null {
  const candidates: CharacterId[] = [];
  for (const c of state.characters.values()) {
    if (!c.alive || c.houseId === PLAYER_HOUSE_ID) continue;
    if (location !== null && c.assignedLocationId !== location) continue;
    candidates.push(c.id);
  }
  if (candidates.length > 0) {
    candidates.sort();
    // biome-ignore lint/style/noNonNullAssertion: candidates is non-empty per length check
    return candidates[0]!;
  }
  // No location match → fall back to the location-agnostic lex-smallest pick.
  return location === null ? null : pickStaffWhisperSubject(state, null);
}

// ── Player actions ───────────────────────────────────────────────────────

export function tryAssignStaff(
  state: GameState,
  staffId: StaffId,
  newAssignment: StaffAssignment,
): AssignStaffResult {
  const staff = state.staff.get(staffId);
  if (staff === undefined) {
    return { ok: false, reason: { kind: "StaffNotFound", staffId } };
  }
  if (staff.assignment === "BribedByRival") {
    return { ok: false, reason: { kind: "StaffBribedByRival", staffId } };
  }
  if (!STAFF_ASSIGNMENTS.includes(newAssignment)) {
    return { ok: false, reason: { kind: "AssignmentInvalid", rejectedAssignment: newAssignment } };
  }
  if (newAssignment === "BribedByRival") {
    // Only the bribery roll path may set this — never the player.
    return { ok: false, reason: { kind: "AssignmentInvalid", rejectedAssignment: newAssignment } };
  }
  const newStaff = new Map(state.staff);
  newStaff.set(staffId, {
    ...staff,
    assignment: newAssignment,
    // Reset cadence anchor to NOW so the new assignment waits a full cadence
    // cycle before firing (NOT null, which would mean "never produced" and
    // collapse the cadence check to always-true on the next tick).
    lastOutputTick: state.tick,
  });
  return { ok: true, state: { ...state, staff: newStaff } };
}

export function trySpymasterMailIntercept(state: GameState): SpymasterInterceptResult {
  // Walk state.characters for a living Spymaster in the player house.
  let hasSpymaster = false;
  for (const c of state.characters.values()) {
    if (c.houseId === PLAYER_HOUSE_ID && c.alive && c.archetype === "Spymaster") {
      hasSpymaster = true;
      break;
    }
  }
  if (!hasSpymaster) {
    return { ok: false, reason: { kind: "NoLivingSpymaster" } };
  }
  const owner = getHouseOrThrow(state, PLAYER_HOUSE_ID);
  if (owner.wealth < SPYMASTER_INTERCEPT_WEALTH_COST) {
    return {
      ok: false,
      reason: {
        kind: "InsufficientWealth",
        have: owner.wealth,
        need: SPYMASTER_INTERCEPT_WEALTH_COST,
      },
    };
  }
  // Find lex-smallest InFlight inbound interceptable courier.
  let targetId: CourierPayloadId | null = null;
  const sortedIds = [...state.couriers.keys()].sort();
  for (const cid of sortedIds) {
    // biome-ignore lint/style/noNonNullAssertion: id from keys() always present
    const c = state.couriers.get(cid)!;
    if (
      c.status === "InFlight" &&
      c.direction === "Inbound" &&
      c.destinationHouseId === PLAYER_HOUSE_ID &&
      c.interceptable
    ) {
      targetId = cid;
      break;
    }
  }
  if (targetId === null) {
    return { ok: false, reason: { kind: "NoEligibleCourier" } };
  }
  // Atomic: deduct wealth + flip courier status in a single new state.
  const newHouses = new Map(state.houses);
  newHouses.set(PLAYER_HOUSE_ID, {
    ...owner,
    wealth: owner.wealth - SPYMASTER_INTERCEPT_WEALTH_COST,
  });
  const newCouriers = new Map(state.couriers);
  // biome-ignore lint/style/noNonNullAssertion: targetId set inside the loop above
  const target = state.couriers.get(targetId)!;
  newCouriers.set(targetId, { ...target, status: "Intercepted", resolvedAtTick: state.tick });
  return { ok: true, state: { ...state, houses: newHouses, couriers: newCouriers } };
}

// ── P24c: hire / fire ──────────────────────────────────────────────────────

export type HireStaffRejection =
  | { kind: "RosterFull"; cap: number }
  | { kind: "InsufficientWealth"; have: number; need: number }
  | { kind: "PlayerExiled" }
  | { kind: "ElopementInProgress" };

export type HireStaffResult =
  | { ok: true; state: GameState; staffId: StaffId }
  | { ok: false; reason: HireStaffRejection };

export type FireStaffRejection =
  | { kind: "StaffNotFound"; staffId: StaffId }
  | { kind: "StaffInactive"; staffId: StaffId } // already dismissed or promoted
  | { kind: "PlayerExiled" }
  | { kind: "ElopementInProgress" };

export type FireStaffResult =
  | { ok: true; state: GameState }
  | { ok: false; reason: FireStaffRejection };

// Active = not dismissed AND not promoted — drives the roster cap (+ excludes
// inert members from any "how many staff do I have" count).
export function activeStaffCount(state: GameState): number {
  let n = 0;
  for (const s of state.staff.values()) {
    if (s.dismissedAtTick === null && s.promotedToCharacterId === null) n += 1;
  }
  return n;
}

// hireStaff — atomic-gated (roster cap, then wealth), then mint a procedurally-
// identified staff member (4 draws on the player stream) + deduct wealth.
export function hireStaff(state: GameState): HireStaffResult {
  if (activeStaffCount(state) >= STAFF_ROSTER_MAX) {
    return { ok: false, reason: { kind: "RosterFull", cap: STAFF_ROSTER_MAX } };
  }
  const player = getHouseOrThrow(state, PLAYER_HOUSE_ID);
  if (player.wealth < STAFF_HIRE_WEALTH_COST) {
    return {
      ok: false,
      reason: { kind: "InsufficientWealth", have: player.wealth, need: STAFF_HIRE_WEALTH_COST },
    };
  }
  const id = makeStaffId(state);
  const rngBefore = getOrThrow(state.rng, PLAYER_HOUSE_ID);
  const { staff, rngState: rngAfter } = buildProceduralStaffMember(id, rngBefore);
  const newRng = new Map(state.rng).set(PLAYER_HOUSE_ID, rngAfter);
  const newHouses = new Map(state.houses).set(PLAYER_HOUSE_ID, {
    ...player,
    wealth: player.wealth - STAFF_HIRE_WEALTH_COST,
  });
  const newStaff = new Map(state.staff).set(id, staff);
  return {
    ok: true,
    state: { ...state, rng: newRng, houses: newHouses, staff: newStaff },
    staffId: id,
  };
}

// fireStaff — set dismissedAtTick (never deleted; inert thereafter). Firing a
// BribedByRival member is ALLOWED — the only way to remove a turned member.
export function fireStaff(state: GameState, staffId: StaffId): FireStaffResult {
  const staff = state.staff.get(staffId);
  if (staff === undefined) {
    return { ok: false, reason: { kind: "StaffNotFound", staffId } };
  }
  if (staff.dismissedAtTick !== null || staff.promotedToCharacterId !== null) {
    return { ok: false, reason: { kind: "StaffInactive", staffId } };
  }
  const newStaff = new Map(state.staff).set(staffId, { ...staff, dismissedAtTick: state.tick });
  return { ok: true, state: { ...state, staff: newStaff } };
}
