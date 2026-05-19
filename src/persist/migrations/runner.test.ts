// Failure-mode coverage for runMigrations. Synthetic registries are used
// for adversarial cases (NOT the production MIGRATIONS array) so failures
// isolate cleanly. The production registry is exercised by the chain test.

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  MigrationFailedError,
  MissingMigrationError,
  SaveLoadError,
  SaveVersionTooNewError,
} from "../errors";
import { MIGRATIONS } from "./index";
import { type Migration, assertMonotonic, runMigrations } from "./runner";

const ANY_OBJECT_SCHEMA = z.unknown();

describe("runMigrations — identity pass", () => {
  it("from === to returns input unchanged with empty registry", () => {
    const input = { version: 1, tick: 0 };
    expect(runMigrations(input, 1, 1, [])).toBe(input);
  });

  it("(spec §7 edge case) v3 save doesn't re-run v2 migrations — returns reference identity and invokes no migration", () => {
    // Spy on every production migration's `migrate` function — none must fire.
    const spies = MIGRATIONS.map((m) => vi.spyOn(m, "migrate"));
    const save = {
      version: 3,
      tick: 0,
      rng: [],
      houses: [],
      characters: [],
      marriages: [],
      campaignName: "x",
    };
    // .toBe() asserts reference equality; .toEqual would be structural and
    // would silently pass even if the runner accidentally cloned.
    expect(runMigrations(save, 3, 3, MIGRATIONS)).toBe(save);
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});

describe("runMigrations — MissingMigrationError", () => {
  it("fires when no migration from current version is registered", () => {
    const registry: readonly Migration[] = [
      {
        from: 1,
        to: 2,
        migrate: (s) => s,
        outputSchema: ANY_OBJECT_SCHEMA,
      },
    ];
    expect(() => runMigrations({}, 1, 3, registry)).toThrow(MissingMigrationError);
  });
});

describe("runMigrations — SaveVersionTooNewError", () => {
  it("fires when fromVersion > toVersion", () => {
    expect(() => runMigrations({}, 5, 2, [])).toThrow(SaveVersionTooNewError);
  });
  it("error is a SaveLoadError", () => {
    try {
      runMigrations({}, 5, 2, []);
    } catch (err) {
      expect(err instanceof SaveLoadError).toBe(true);
    }
  });
});

describe("runMigrations — MigrationFailedError from a throwing migration", () => {
  it("wraps the inner cause and reports the step number", () => {
    const inner = new Error("synthetic step failure");
    const registry: readonly Migration[] = [
      {
        from: 1,
        to: 2,
        migrate: () => {
          throw inner;
        },
        outputSchema: ANY_OBJECT_SCHEMA,
      },
    ];
    try {
      runMigrations({}, 1, 2, registry);
      throw new Error("expected runMigrations to throw");
    } catch (err) {
      expect(err instanceof MigrationFailedError).toBe(true);
      const failed = err as MigrationFailedError;
      expect(failed.stepFrom).toBe(1);
      expect(failed.stepTo).toBe(2);
      expect(failed.inner).toBe(inner);
    }
  });
});

describe("runMigrations — MigrationFailedError from invalid migration output", () => {
  it("post-step Zod parse catches malformed output", () => {
    const STRICT_SCHEMA = z.object({ version: z.literal(2), tick: z.number() });
    const registry: readonly Migration[] = [
      {
        from: 1,
        to: 2,
        // Returns malformed shape; the per-step Zod parse must catch it.
        migrate: () => ({ version: 2 }),
        outputSchema: STRICT_SCHEMA,
      },
    ];
    try {
      runMigrations({}, 1, 2, registry);
      throw new Error("expected runMigrations to throw");
    } catch (err) {
      expect(err instanceof MigrationFailedError).toBe(true);
      const failed = err as MigrationFailedError;
      expect(failed.stepFrom).toBe(1);
      expect(failed.stepTo).toBe(2);
    }
  });
});

describe("runMigrations — re-wrap suppression", () => {
  it("does NOT re-wrap when a step throws MigrationFailedError directly", () => {
    const innerFailure = new MigrationFailedError(1, 2, new Error("synthetic inner"));
    const registry: readonly Migration[] = [
      {
        from: 1,
        to: 2,
        migrate: () => {
          throw innerFailure;
        },
        outputSchema: ANY_OBJECT_SCHEMA,
      },
    ];
    try {
      runMigrations({}, 1, 2, registry);
      throw new Error("expected runMigrations to throw");
    } catch (err) {
      // The same MigrationFailedError instance bubbles — NOT wrapped in
      // another MigrationFailedError whose .inner is the original.
      expect(err).toBe(innerFailure);
      const failed = err as MigrationFailedError;
      // Its inner.message should be the synthetic one (the runner didn't
      // re-wrap, so we read straight through).
      expect((failed.inner as Error).message).toBe("synthetic inner");
    }
  });
});

describe("assertMonotonic — registry-construction guard", () => {
  it("passes on a clean monotonic registry", () => {
    const ok: readonly Migration[] = [
      { from: 1, to: 2, migrate: (s) => s, outputSchema: ANY_OBJECT_SCHEMA },
      { from: 2, to: 3, migrate: (s) => s, outputSchema: ANY_OBJECT_SCHEMA },
    ];
    expect(() => assertMonotonic(ok)).not.toThrow();
  });

  it("throws on a skip (to !== from + 1)", () => {
    const skip: readonly Migration[] = [
      { from: 1, to: 3, migrate: (s) => s, outputSchema: ANY_OBJECT_SCHEMA },
    ];
    expect(() => assertMonotonic(skip)).toThrow(/skips/);
  });

  it("throws on a gap between entries", () => {
    const gap: readonly Migration[] = [
      { from: 1, to: 2, migrate: (s) => s, outputSchema: ANY_OBJECT_SCHEMA },
      { from: 3, to: 4, migrate: (s) => s, outputSchema: ANY_OBJECT_SCHEMA },
    ];
    expect(() => assertMonotonic(gap)).toThrow(/gap/);
  });
});
