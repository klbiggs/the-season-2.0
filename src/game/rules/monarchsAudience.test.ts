import { describe, expect, it } from "vitest";
import { synthStateAt } from "../__test-utils__/playerLocationFixtures";
import {
  MONARCH_AUDIENCE_COOLDOWN_TICKS,
  MONARCH_AUDIENCE_PARTIAL_SCANDAL_DELTA,
  MONARCH_AUDIENCE_REPUTATION_COST,
  MONARCH_AUDIENCE_REPUTATION_THRESHOLD,
  MONARCH_AUDIENCE_WEALTH_COST,
} from "../constants";
import { PLAYER_HOUSE_ID } from "../rng";
import { applyAudience, canRequestAudience } from "./monarchsAudience";

describe("canRequestAudience — rejection paths", () => {
  it("rejects WrongLocation when not at Capital", () => {
    const state = synthStateAt("Country", { house: { reputation: 50 } });
    const result = canRequestAudience(state, PLAYER_HOUSE_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.kind).toBe("WrongLocation");
  });

  it("rejects InsufficientReputation when reputation < 30", () => {
    const state = synthStateAt("Capital", { house: { reputation: 29 } });
    const result = canRequestAudience(state, PLAYER_HOUSE_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.kind).toBe("InsufficientReputation");
  });

  it("rejects CooldownActive when within 30 ticks of last attempt", () => {
    const state = synthStateAt("Capital", {
      house: { reputation: 50, lastAudienceTick: 10 },
      state: { tick: 39 },
    });
    const result = canRequestAudience(state, PLAYER_HOUSE_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.kind).toBe("CooldownActive");
      if (result.reason.kind === "CooldownActive") {
        expect(result.reason.ticksUntilAvailable).toBe(1);
      }
    }
  });

  it("allows when exactly 30 ticks have elapsed (>= comparator boundary)", () => {
    const state = synthStateAt("Capital", {
      house: { reputation: 50, lastAudienceTick: 10 },
      state: { tick: 40 },
    });
    expect(canRequestAudience(state, PLAYER_HOUSE_ID).ok).toBe(true);
  });
});

describe("applyAudience — outcome bands", () => {
  it("returns Denied when canRequestAudience rejects (state unchanged)", () => {
    const state = synthStateAt("Country", { house: { reputation: 50 } });
    const { state: next, outcome } = applyAudience(state, PLAYER_HOUSE_ID);
    expect(outcome.kind).toBe("Denied");
    expect(next).toBe(state);
  });

  it("returns Partial at rep=30 (band: 30 ≤ rep < 50)", () => {
    const state = synthStateAt("Capital", { house: { reputation: 30 } });
    const { outcome } = applyAudience(state, PLAYER_HOUSE_ID);
    expect(outcome.kind).toBe("Partial");
  });

  it("returns Partial at rep=49 (band: 30 ≤ rep < 50)", () => {
    const state = synthStateAt("Capital", { house: { reputation: 49 } });
    const { outcome } = applyAudience(state, PLAYER_HOUSE_ID);
    expect(outcome.kind).toBe("Partial");
  });

  it("returns FullSuccess at rep=50 (full lower bound)", () => {
    const state = synthStateAt("Capital", { house: { reputation: 50 } });
    const { outcome } = applyAudience(state, PLAYER_HOUSE_ID);
    expect(outcome.kind).toBe("FullSuccess");
  });

  it("returns FullSuccess at rep=100 (capped)", () => {
    const state = synthStateAt("Capital", { house: { reputation: 100 } });
    const { outcome } = applyAudience(state, PLAYER_HOUSE_ID);
    expect(outcome.kind).toBe("FullSuccess");
  });
});

describe("applyAudience — state mutations", () => {
  it("deducts wealth and reputation on Partial", () => {
    const state = synthStateAt("Capital", { house: { reputation: 40, wealth: 100, scandal: 5 } });
    const { state: next } = applyAudience(state, PLAYER_HOUSE_ID);
    const house = next.houses.get(PLAYER_HOUSE_ID);
    expect(house?.wealth).toBe(100 - MONARCH_AUDIENCE_WEALTH_COST);
    expect(house?.reputation).toBe(40 - MONARCH_AUDIENCE_REPUTATION_COST);
    expect(house?.scandal).toBe(5 + MONARCH_AUDIENCE_PARTIAL_SCANDAL_DELTA);
  });

  it("wipes scandal to 0 on FullSuccess", () => {
    const state = synthStateAt("Capital", { house: { reputation: 60, scandal: 30 } });
    const { state: next } = applyAudience(state, PLAYER_HOUSE_ID);
    expect(next.houses.get(PLAYER_HOUSE_ID)?.scandal).toBe(0);
  });

  it("does NOT update lastAudienceTick on denial path (cooldown not locked)", () => {
    const state = synthStateAt("Capital", { house: { reputation: 29 } });
    const { state: next } = applyAudience(state, PLAYER_HOUSE_ID);
    expect(next.houses.get(PLAYER_HOUSE_ID)?.lastAudienceTick).toBeNull();
  });

  it("updates lastAudienceTick on Partial", () => {
    const state = synthStateAt("Capital", {
      house: { reputation: 40 },
      state: { tick: 100 },
    });
    const { state: next } = applyAudience(state, PLAYER_HOUSE_ID);
    expect(next.houses.get(PLAYER_HOUSE_ID)?.lastAudienceTick).toBe(100);
  });

  it("updates lastAudienceTick on FullSuccess", () => {
    const state = synthStateAt("Capital", {
      house: { reputation: 70 },
      state: { tick: 100 },
    });
    const { state: next } = applyAudience(state, PLAYER_HOUSE_ID);
    expect(next.houses.get(PLAYER_HOUSE_ID)?.lastAudienceTick).toBe(100);
  });
});

describe("applyAudience — cooldown boundary", () => {
  it("T=10 audience then T=40 second audience: OK (40-10=30 >= cooldown)", () => {
    const state = synthStateAt("Capital", {
      house: { reputation: 50, lastAudienceTick: 10 },
      state: { tick: 40 },
    });
    const { outcome } = applyAudience(state, PLAYER_HOUSE_ID);
    expect(outcome.kind).not.toBe("Denied");
  });

  it("T=10 audience then T=39 second audience: Denied (39-10=29 < cooldown)", () => {
    const state = synthStateAt("Capital", {
      house: { reputation: 50, lastAudienceTick: 10 },
      state: { tick: 39 },
    });
    const { outcome } = applyAudience(state, PLAYER_HOUSE_ID);
    expect(outcome.kind).toBe("Denied");
  });

  it(`uses MONARCH_AUDIENCE_COOLDOWN_TICKS = ${MONARCH_AUDIENCE_COOLDOWN_TICKS}`, () => {
    expect(MONARCH_AUDIENCE_COOLDOWN_TICKS).toBe(30);
    expect(MONARCH_AUDIENCE_REPUTATION_THRESHOLD).toBe(30);
  });
});
