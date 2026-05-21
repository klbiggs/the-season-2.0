// P9 — v9 → v10 migration tests.
//
// Verifies the shape transformation: SaveV10 carries the new `elopement: null`
// top-level field plus the new `viaElopement: false` field on every existing
// MarriageRecord (via the `.default(false)` parse-side backfill on the live
// MarriageRecordSchema). Migration consumes ZERO PRNG draws — the rng tuple
// is byte-identical pre/post.

import { describe, expect, it } from "vitest";
import { DEFAULT_CAMPAIGN_NAME, createInitialState } from "../../game/store";
import { type SaveV9, SaveV9Schema, SaveV10Schema, toSaveV9 } from "../schema";
import { migrate_v9_to_v10 } from "./v9-to-v10";

function buildV9Fixture(seed: string): SaveV9 {
  const fresh = createInitialState(seed, DEFAULT_CAMPAIGN_NAME);
  return toSaveV9(fresh);
}

describe("migrate_v9_to_v10", () => {
  it("adds top-level elopement: null", () => {
    const v9 = buildV9Fixture("alpha");
    const v10 = migrate_v9_to_v10(v9);
    expect(v10.version).toBe(10);
    expect(v10.elopement).toBeNull();
  });

  it("output parses against SaveV10Schema", () => {
    const v9 = buildV9Fixture("beta");
    const v10 = migrate_v9_to_v10(v9);
    expect(() => SaveV10Schema.parse(v10)).not.toThrow();
  });

  it("rng tuple is byte-identical pre/post (ZERO draw budget)", () => {
    const v9 = buildV9Fixture("gamma");
    const v10 = migrate_v9_to_v10(v9);
    expect(v10.rng).toEqual(v9.rng);
  });

  it("rng schema shape parses identically between V9 and V10", () => {
    // Structural guard against a future RngStateSchema widening that would
    // silently break the byte-identity claim above. We parse a known rng
    // tuple against both schemas and assert identical output.
    const sample = [["player" as never, { seed: "abc", callCount: 0 }] as never];
    expect(SaveV10Schema.shape.rng.parse(sample)).toEqual(SaveV9Schema.shape.rng.parse(sample));
  });

  it("every legacy marriage gains viaElopement: false via .default(false)", () => {
    // The fresh campaign has no marriages, so this test verifies the contract
    // shape via a hand-built V9 fixture with a synthetic marriage entry.
    const v9 = buildV9Fixture("delta");
    const synth: SaveV9 = {
      ...v9,
      marriages: [
        [
          "test-m" as never,
          {
            id: "test-m" as never,
            spouseAId: "a" as never,
            spouseBId: "b" as never,
            marriedAtTick: 0,
            dissolved: false,
            dissolvedAtTick: null,
            // viaElopement omitted on disk; the live MarriageRecordSchema's
            // .default(false) backfills at parse time.
          } as never,
        ],
      ],
    };
    const v10 = migrate_v9_to_v10(synth);
    expect(v10.marriages[0]?.[1]?.viaElopement).toBe(false);
  });
});
