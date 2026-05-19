import { describe, expect, it } from "vitest";
import { synthStateAt } from "../__test-utils__/playerLocationFixtures";
import { BANKRUPTCY_ESCAPE_SCANDAL_COST, BANKRUPTCY_ESCAPE_WEALTH_GAIN } from "../constants";
import { PLAYER_HOUSE_ID } from "../rng";
import { InvalidEscapeError, applyBankruptcyEscape, canEscapeBankruptcy } from "./bankruptcyEscape";

describe("canEscapeBankruptcy", () => {
  it("rejects WrongLocation when not at Country", () => {
    const state = synthStateAt("Capital", { house: { wealth: -50 } });
    const result = canEscapeBankruptcy(state, PLAYER_HOUSE_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.kind).toBe("WrongLocation");
  });

  it("rejects NotInsolvent when wealth >= 0", () => {
    const state = synthStateAt("Country", { house: { wealth: 0 } });
    const result = canEscapeBankruptcy(state, PLAYER_HOUSE_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.kind).toBe("NotInsolvent");
  });

  it("allows at Country with negative wealth", () => {
    const state = synthStateAt("Country", { house: { wealth: -50 } });
    expect(canEscapeBankruptcy(state, PLAYER_HOUSE_ID).ok).toBe(true);
  });
});

describe("applyBankruptcyEscape", () => {
  it("applies +50 wealth and +5 scandal", () => {
    const state = synthStateAt("Country", { house: { wealth: -50, scandal: 10 } });
    const next = applyBankruptcyEscape(state, PLAYER_HOUSE_ID);
    const house = next.houses.get(PLAYER_HOUSE_ID);
    expect(house?.wealth).toBe(-50 + BANKRUPTCY_ESCAPE_WEALTH_GAIN);
    expect(house?.scandal).toBe(10 + BANKRUPTCY_ESCAPE_SCANDAL_COST);
  });

  it("clamps scandal at 100", () => {
    const state = synthStateAt("Country", { house: { wealth: -50, scandal: 98 } });
    const next = applyBankruptcyEscape(state, PLAYER_HOUSE_ID);
    expect(next.houses.get(PLAYER_HOUSE_ID)?.scandal).toBe(100);
  });

  it("throws InvalidEscapeError when called against unvalidated state", () => {
    const state = synthStateAt("Capital", { house: { wealth: -50 } });
    expect(() => applyBankruptcyEscape(state, PLAYER_HOUSE_ID)).toThrow(InvalidEscapeError);
  });
});
