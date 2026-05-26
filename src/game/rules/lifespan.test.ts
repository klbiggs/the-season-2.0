import { describe, expect, it } from "vitest";
import { DEATH_AGE_MAX, DEATH_AGE_MIN } from "../constants";
import type { TraitId } from "../rng";
import { applyLifespanModifiers } from "./lifespan";

const t = (s: string) => s as TraitId;

describe("applyLifespanModifiers", () => {
  it("applies gender skew with no modifier traits", () => {
    expect(applyLifespanModifiers(80, "Female", [])).toBe(82); // +2
    expect(applyLifespanModifiers(80, "Male", [])).toBe(78); // -2
  });

  it("sums per-trait modifiers on top of the gender skew", () => {
    // Male(-2) + Rustic(+5) = +3
    expect(applyLifespanModifiers(80, "Male", [t("Rustic")])).toBe(83);
    // Female(+2) + Sophisticated(+3) + Intellectual(+2) = +7
    expect(applyLifespanModifiers(80, "Female", [t("Sophisticated"), t("Intellectual")])).toBe(87);
    // Male(-2) + ImpoverishedNobility(-5) + Melancholic(-4) = -11
    expect(applyLifespanModifiers(80, "Male", [t("ImpoverishedNobility"), t("Melancholic")])).toBe(
      69,
    );
  });

  it("ignores traits with no lifespan modifier (contributes 0)", () => {
    expect(applyLifespanModifiers(80, "Female", [t("Cunning"), t("Vain")])).toBe(82);
  });

  it("clamps to [DEATH_AGE_MIN, DEATH_AGE_MAX]", () => {
    // Push above the ceiling.
    expect(
      applyLifespanModifiers(95, "Female", [t("Rustic"), t("Sophisticated"), t("Pious")]),
    ).toBe(DEATH_AGE_MAX);
    // Push below the floor.
    expect(
      applyLifespanModifiers(70, "Male", [
        t("ImpoverishedNobility"),
        t("Melancholic"),
        t("Dull"),
        t("Hedonistic"),
      ]),
    ).toBe(DEATH_AGE_MIN);
  });
});
