// P24c (I2): promote-staff-to-Character tests — behavior, rejections, and
// ≥30-run determinism (the gender→age→deathAge→traits draws on the player stream).

import { describe, expect, it } from "vitest";
import { makeGameState, makeHouse } from "../__test-utils__/factories";
import type { StaffMember } from "../entities";
import { hashState } from "../hash";
import {
  type CharacterId,
  PLAYER_HOUSE_ID,
  type StaffId,
  createRngState,
  getOrThrow,
} from "../rng";
import { promoteStaffToCharacter, promotedStaffCharacterId } from "./staffPromotion";

const STAFF_ID = "staff-proc-0" as StaffId;

function makeStaff(overrides: Partial<StaffMember> = {}): StaffMember {
  return {
    id: STAFF_ID,
    houseId: PLAYER_HOUSE_ID,
    name: "Bramble (staff)",
    isGreedy: false,
    loyalty: 70,
    upkeepPerTick: 2,
    assignment: "None",
    lastOutputTick: null,
    bribedAtTick: null,
    dismissedAtTick: null,
    promotedToCharacterId: null,
    ...overrides,
  };
}

function stateWithStaff(staff: StaffMember, seed = "promote-seed") {
  return makeGameState({
    tick: 50,
    rng: new Map([[PLAYER_HOUSE_ID, createRngState(seed)]]),
    houses: new Map([[PLAYER_HOUSE_ID, makeHouse({ id: PLAYER_HOUSE_ID })]]),
    staff: new Map([[staff.id, staff]]),
  });
}

describe("promoteStaffToCharacter", () => {
  it("converts a staffer into a marriage-eligible player-house Character + marks the source inert", () => {
    const state = stateWithStaff(makeStaff({ isGreedy: true }));
    const result = promoteStaffToCharacter(state, STAFF_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    const charId = promotedStaffCharacterId(STAFF_ID);
    expect(result.characterId).toBe(charId);
    const char = result.state.characters.get(charId);
    expect(char).toBeDefined();
    if (char === undefined) throw new Error("unreachable");
    expect(char.houseId).toBe(PLAYER_HOUSE_ID);
    expect(char.marriageId).toBe(null); // marriage-eligible
    expect(char.alive).toBe(true);
    // isGreedy staffer → Greedy trait carried onto the character.
    expect(char.traits).toContain("Greedy");
    // deathAge lifespan-rolled into the widened bound.
    expect(char.deathAge).toBeGreaterThanOrEqual(55);
    expect(char.deathAge).toBeLessThanOrEqual(100);
    // role consistent with gender (Female→Spinster; Male→Dependent/Bohemian).
    if (char.gender === "Female") expect(char.role).toBe("Spinster");
    else expect(["Dependent", "Bohemian"]).toContain(char.role);

    // Source staff is now inert (promotedToCharacterId set; never deleted).
    const src = result.state.staff.get(STAFF_ID);
    expect(src?.promotedToCharacterId).toBe(charId);
    expect(result.state.staff.size).toBe(1); // not removed

    // Fixed 4-draw budget on the player stream.
    const before = getOrThrow(state.rng, PLAYER_HOUSE_ID);
    const after = getOrThrow(result.state.rng, PLAYER_HOUSE_ID);
    expect(after.callCount - before.callCount).toBe(4);
  });

  it("rejects an already-promoted or dismissed staffer (StaffInactive)", () => {
    const promoted = promoteStaffToCharacter(
      stateWithStaff(makeStaff({ promotedToCharacterId: "x" as CharacterId })),
      STAFF_ID,
    );
    expect(promoted.ok).toBe(false);
    if (promoted.ok) throw new Error("unreachable");
    expect(promoted.reason.kind).toBe("StaffInactive");

    const dismissed = promoteStaffToCharacter(
      stateWithStaff(makeStaff({ dismissedAtTick: 10 })),
      STAFF_ID,
    );
    expect(dismissed.ok).toBe(false);
    if (dismissed.ok) throw new Error("unreachable");
    expect(dismissed.reason.kind).toBe("StaffInactive");
  });

  it("rejects an unknown staffer (StaffNotFound)", () => {
    const result = promoteStaffToCharacter(stateWithStaff(makeStaff()), "nope" as StaffId);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason.kind).toBe("StaffNotFound");
  });

  it("is deterministic across 30 runs of the same seed + state", () => {
    const staff = makeStaff({ isGreedy: true });
    const baseline = promoteStaffToCharacter(stateWithStaff(staff), STAFF_ID);
    expect(baseline.ok).toBe(true);
    if (!baseline.ok) throw new Error("unreachable");
    const baselineHash = hashState(baseline.state);
    for (let i = 0; i < 30; i++) {
      const replay = promoteStaffToCharacter(stateWithStaff(staff), STAFF_ID);
      expect(replay.ok).toBe(true);
      if (!replay.ok) throw new Error("unreachable");
      expect(hashState(replay.state)).toBe(baselineHash);
    }
  });
});
