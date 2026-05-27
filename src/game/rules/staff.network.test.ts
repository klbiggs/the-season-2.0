// P24c: staff-network tests — hire (roster cap + wealth + procedural identity),
// fire (inert, never-deleted, BribedByRival fireable), I3 BribeDriver location
// specialization, I4 Whispers-perk bribery resistance.

import { describe, expect, it } from "vitest";
import { makeCharacter, makeGameState, makeHouse } from "../__test-utils__/factories";
import {
  STAFF_BRIBERY_PROBABILITY_BASE,
  STAFF_HIRE_WEALTH_COST,
  STAFF_PROCEDURAL_DRAWS_PER_HIRE,
  STAFF_ROSTER_MAX,
  WHISPERS_PERK_BRIBERY_RESISTANCE_MULTIPLIER,
} from "../constants";
import type { DynastyPerkAward, StaffMember } from "../entities";
import {
  type CharacterId,
  type HouseId,
  PLAYER_HOUSE_ID,
  type StaffId,
  createRngState,
  drawNext,
} from "../rng";
import { activeStaffCount, applyStaffOutputsPhase, fireStaff, hireStaff } from "./staff";

const HEAD = "player-head" as CharacterId;

function staff(id: string, o: Partial<StaffMember> = {}): StaffMember {
  return {
    id: id as StaffId,
    houseId: PLAYER_HOUSE_ID,
    name: `${id} (staff)`,
    isGreedy: false,
    loyalty: 70,
    upkeepPerTick: 1,
    assignment: "None",
    lastOutputTick: null,
    bribedAtTick: null,
    dismissedAtTick: null,
    promotedToCharacterId: null,
    ...o,
  };
}

const WHISPERS_AWARD: DynastyPerkAward = {
  perk: "Whispers",
  awardedAtTick: 0,
  awardedDuringGeneration: 1,
};

describe("I1 — hire / fire", () => {
  it("hireStaff mints a procedural active staffer + deducts wealth", () => {
    const state = makeGameState({
      rng: new Map([[PLAYER_HOUSE_ID, createRngState("hire-seed")]]),
      houses: new Map([[PLAYER_HOUSE_ID, makeHouse({ id: PLAYER_HOUSE_ID, wealth: 100 })]]),
    });
    const result = hireStaff(state);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(activeStaffCount(result.state)).toBe(1);
    expect(result.state.houses.get(PLAYER_HOUSE_ID)?.wealth).toBe(100 - STAFF_HIRE_WEALTH_COST);
    const hired = result.state.staff.get(result.staffId);
    expect(hired?.assignment).toBe("None");
    expect(hired?.dismissedAtTick).toBe(null);
    // Fixed procedural-identity draw budget on the player stream.
    const before = state.rng.get(PLAYER_HOUSE_ID)?.callCount ?? -1;
    const after = result.state.rng.get(PLAYER_HOUSE_ID)?.callCount ?? -1;
    expect(after - before).toBe(STAFF_PROCEDURAL_DRAWS_PER_HIRE);
  });

  it("hireStaff rejects RosterFull at the cap + InsufficientWealth below cost", () => {
    const full = new Map<StaffId, StaffMember>();
    for (let i = 0; i < STAFF_ROSTER_MAX; i++) full.set(`s-${i}` as StaffId, staff(`s-${i}`));
    const fullState = makeGameState({
      houses: new Map([[PLAYER_HOUSE_ID, makeHouse({ id: PLAYER_HOUSE_ID, wealth: 1000 })]]),
      staff: full,
    });
    const r1 = hireStaff(fullState);
    expect(r1.ok).toBe(false);
    if (r1.ok) throw new Error("unreachable");
    expect(r1.reason.kind).toBe("RosterFull");

    const poorState = makeGameState({
      rng: new Map([[PLAYER_HOUSE_ID, createRngState("x")]]),
      houses: new Map([[PLAYER_HOUSE_ID, makeHouse({ id: PLAYER_HOUSE_ID, wealth: 0 })]]),
    });
    const r2 = hireStaff(poorState);
    expect(r2.ok).toBe(false);
    if (r2.ok) throw new Error("unreachable");
    expect(r2.reason.kind).toBe("InsufficientWealth");
  });

  it("fireStaff makes a member inert WITHOUT deleting it; BribedByRival is fireable", () => {
    const state = makeGameState({
      tick: 9,
      staff: new Map([["s-0" as StaffId, staff("s-0", { assignment: "BribedByRival" })]]),
    });
    const result = fireStaff(state, "s-0" as StaffId);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.state.staff.size).toBe(1); // never deleted
    expect(result.state.staff.get("s-0" as StaffId)?.dismissedAtTick).toBe(9);
    expect(activeStaffCount(result.state)).toBe(0); // inert
  });

  it("applyStaffOutputsPhase skips dismissed + promoted staff (no bribery roll consumed)", () => {
    // A dismissed Greedy sub-threshold staffer would normally roll for bribery;
    // the skip means the player rng callCount does NOT advance.
    const state = makeGameState({
      tick: 5,
      rng: new Map([[PLAYER_HOUSE_ID, createRngState("skip-seed")]]),
      houses: new Map([[PLAYER_HOUSE_ID, makeHouse({ id: PLAYER_HOUSE_ID, wealth: 100 })]]),
      staff: new Map([
        ["s-0" as StaffId, staff("s-0", { isGreedy: true, loyalty: 10, dismissedAtTick: 2 })],
      ]),
    });
    const before = state.rng.get(PLAYER_HOUSE_ID)?.callCount ?? -1;
    const after = applyStaffOutputsPhase(state);
    expect(after.rng.get(PLAYER_HOUSE_ID)?.callCount).toBe(before); // no draw fired
    // Still inert + unchanged (not flipped to BribedByRival).
    expect(after.staff.get("s-0" as StaffId)?.dismissedAtTick).toBe(2);
    expect(after.staff.get("s-0" as StaffId)?.assignment).toBe("None");
  });
});

describe("I3 — BribeDriver location specialization", () => {
  function locState(staffAssignment: "Snoop" | "BribeDriver") {
    return makeGameState({
      tick: 20,
      rng: new Map([[PLAYER_HOUSE_ID, createRngState("loc-seed")]]),
      houses: new Map([
        [
          PLAYER_HOUSE_ID,
          makeHouse({
            id: PLAYER_HOUSE_ID,
            headOfHouseCharacterId: HEAD,
            currentLocation: "Country",
            wealth: 100,
          }),
        ],
      ]),
      characters: new Map([
        [HEAD, makeCharacter({ id: HEAD, houseId: PLAYER_HOUSE_ID })],
        [
          "npc-capital" as CharacterId,
          makeCharacter({
            id: "npc-capital" as CharacterId,
            houseId: "indep" as HouseId,
            assignedLocationId: "Capital",
          }),
        ],
        [
          "npc-country" as CharacterId,
          makeCharacter({
            id: "npc-country" as CharacterId,
            houseId: "indep" as HouseId,
            assignedLocationId: "Country",
          }),
        ],
      ]),
      staff: new Map([
        ["s-0" as StaffId, staff("s-0", { assignment: staffAssignment, lastOutputTick: 0 })],
      ]),
    });
  }

  it("BribeDriver targets an NPC at the player's location; Snoop picks lex-smallest regardless", () => {
    const bribe = applyStaffOutputsPhase(locState("BribeDriver"));
    const bribeWhisper = [...bribe.whispers.values()][0];
    // Player is at Country → BribeDriver picks npc-country (not the lex-smallest npc-capital).
    expect(bribeWhisper?.subjectCharacterId).toBe("npc-country" as CharacterId);

    const snoop = applyStaffOutputsPhase(locState("Snoop"));
    const snoopWhisper = [...snoop.whispers.values()][0];
    // Snoop is location-agnostic → lex-smallest non-player = npc-capital.
    expect(snoopWhisper?.subjectCharacterId).toBe("npc-capital" as CharacterId);
  });
});

describe("I4 — Whispers perk bribery resistance", () => {
  it("the perk lowers the bribery threshold (threshold shift, not draw-count)", () => {
    // Seed where the player-house first draw lands in [resisted, base) so the
    // SAME roll bribes WITHOUT the perk but is resisted WITH it.
    const resisted = STAFF_BRIBERY_PROBABILITY_BASE * WHISPERS_PERK_BRIBERY_RESISTANCE_MULTIPLIER;
    let seed: string | null = null;
    for (let i = 0; i < 5000; i++) {
      const s = `bribe-${i}`;
      const d = drawNext(createRngState(s)).next;
      if (d >= resisted && d < STAFF_BRIBERY_PROBABILITY_BASE) {
        seed = s;
        break;
      }
    }
    if (seed === null) throw new Error("no seed found in [resisted, base)");

    const greedy = staff("s-0", { isGreedy: true, loyalty: 10, assignment: "Snoop" });
    const base = makeGameState({
      tick: 5,
      rng: new Map([[PLAYER_HOUSE_ID, createRngState(seed)]]),
      houses: new Map([[PLAYER_HOUSE_ID, makeHouse({ id: PLAYER_HOUSE_ID, wealth: 100 })]]),
      staff: new Map([["s-0" as StaffId, greedy]]),
    });

    // No perk → bribed.
    const noPerk = applyStaffOutputsPhase(base);
    expect(noPerk.staff.get("s-0" as StaffId)?.assignment).toBe("BribedByRival");
    expect(noPerk.rng.get(PLAYER_HOUSE_ID)?.callCount).toBe(1); // 1 draw fired

    // With the Whispers perk → resisted (NOT bribed) — but the draw STILL fired.
    const withPerk = makeGameState({
      ...base,
      houses: new Map([
        [
          PLAYER_HOUSE_ID,
          makeHouse({ id: PLAYER_HOUSE_ID, wealth: 100, awardedDynastyPerks: [WHISPERS_AWARD] }),
        ],
      ]),
    });
    const after = applyStaffOutputsPhase(withPerk);
    expect(after.staff.get("s-0" as StaffId)?.assignment).toBe("Snoop"); // not bribed
    expect(after.rng.get(PLAYER_HOUSE_ID)?.callCount).toBe(1); // SAME draw count — threshold shift only
  });
});
