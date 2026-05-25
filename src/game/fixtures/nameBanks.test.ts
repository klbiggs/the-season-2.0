import { describe, expect, it } from "vitest";
import type { HouseId } from "../rng";
import { GIVEN_NAMES, SURNAMES, dynastySurnameForHouse, honorificFor } from "./nameBanks";

describe("nameBanks — shape", () => {
  it("has non-empty given-name banks for every era × gender", () => {
    for (const era of ["Earlier", "Later"] as const) {
      for (const gender of ["Female", "Male"] as const) {
        expect(GIVEN_NAMES[era][gender].length).toBeGreaterThan(0);
        // No empty strings, no duplicates within a cell.
        const set = new Set(GIVEN_NAMES[era][gender]);
        expect(set.size).toBe(GIVEN_NAMES[era][gender].length);
        for (const n of GIVEN_NAMES[era][gender]) expect(n.length).toBeGreaterThan(0);
      }
    }
  });

  it("has non-empty surname banks for every era with no duplicates", () => {
    for (const era of ["Earlier", "Later"] as const) {
      expect(SURNAMES[era].length).toBeGreaterThan(0);
      expect(new Set(SURNAMES[era]).size).toBe(SURNAMES[era].length);
    }
  });

  it("surname banks avoid the baseline + rival surnames (no identity confusion)", () => {
    const reserved = [
      "Aldridge",
      "Blackwood",
      "Carrington",
      "Dunmore",
      "Ellsworth",
      "Ashford",
      "Beaumont",
      "Cavendish",
    ];
    for (const era of ["Earlier", "Later"] as const) {
      for (const r of reserved) expect(SURNAMES[era]).not.toContain(r);
    }
  });
});

describe("honorificFor", () => {
  it("maps gender to a period honorific", () => {
    expect(honorificFor("Female")).toBe("Miss");
    expect(honorificFor("Male")).toBe("Mr.");
  });
});

describe("dynastySurnameForHouse — frozen golden outputs", () => {
  // Pinned via the shared FNV-1a over the FOUNDING-era surname bank. A drift in
  // the hash, the bank contents, or the bank ordering re-rolls every dynasty's
  // surname — these pairs are the contract.
  it.each([
    ["player", "Holloway"],
    ["independent", "Ottershaw"],
    ["rival-ashford", "Oakenshaw"],
    ["rival-beaumont", "Thornbury"],
    ["rival-cavendish", "Redmayne"],
  ])("house %s → %s", (houseId, expected) => {
    expect(dynastySurnameForHouse(houseId as HouseId)).toBe(expected);
  });

  it("is deterministic and always a member of the founding-era bank", () => {
    const id = "player" as HouseId;
    expect(dynastySurnameForHouse(id)).toBe(dynastySurnameForHouse(id));
    expect(SURNAMES.Earlier).toContain(dynastySurnameForHouse(id));
  });
});
