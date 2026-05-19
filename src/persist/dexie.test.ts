// Load-path corruption coverage. Each case writes a hand-crafted record
// into Dexie via _putRawForTests (bypassing save()'s Zod validation), then
// awaits load() and asserts the typed error type.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { _putRawForTests, _resetForTests, load } from "./dexie";
import {
  InvalidSaveSchemaError,
  MigrationFailedError,
  SaveLoadError,
  SaveVersionTooNewError,
  UnknownSaveVersionError,
} from "./errors";

const SLOT = "dev";

beforeEach(async () => {
  await _resetForTests();
});

afterEach(async () => {
  await _resetForTests();
});

describe("load() — SaveVersionTooNewError", () => {
  it("fires when version > SAVE_VERSION_CURRENT", async () => {
    await _putRawForTests(SLOT, { version: 99 });
    await expect(load(SLOT)).rejects.toBeInstanceOf(SaveVersionTooNewError);
  });
});

describe("load() — UnknownSaveVersionError", () => {
  it("fires on version: 0", async () => {
    await _putRawForTests(SLOT, { version: 0 });
    await expect(load(SLOT)).rejects.toBeInstanceOf(UnknownSaveVersionError);
  });

  it("fires on non-numeric version", async () => {
    await _putRawForTests(SLOT, { version: "two" });
    try {
      await load(SLOT);
      throw new Error("expected load() to throw");
    } catch (err) {
      expect(err instanceof UnknownSaveVersionError).toBe(true);
      expect((err as UnknownSaveVersionError).observedVersion).toBe("two");
    }
  });
});

describe("load() — InvalidSaveSchemaError", () => {
  it("fires when record has no version field", async () => {
    await _putRawForTests(SLOT, {});
    await expect(load(SLOT)).rejects.toBeInstanceOf(InvalidSaveSchemaError);
  });

  it("fires when SaveV5 (current-version) fields are malformed", async () => {
    // Post-P4 the current-version path is SaveV5. Malformed current-version
    // records hit SaveV5Schema.parse directly and surface as
    // InvalidSaveSchemaError (NOT MigrationFailedError — no migration runs).
    await _putRawForTests(SLOT, {
      version: 5,
      tick: "not-a-number",
      rng: [],
      houses: [],
      characters: [],
      marriages: [],
      campaignName: "x",
      era: "Earlier",
      conversationHistory: [],
      affectionMap: [],
    });
    try {
      await load(SLOT);
      throw new Error("expected load() to throw");
    } catch (err) {
      expect(err instanceof InvalidSaveSchemaError).toBe(true);
      const issues = (err as InvalidSaveSchemaError).zodIssues;
      expect(issues.some((i) => i.path.includes("tick"))).toBe(true);
    }
  });
});

describe("load() — MigrationFailedError from a malformed legacy save", () => {
  it("fires when SaveV1 input fails the registry's SaveV1Schema.parse wrap", async () => {
    // A v1 record with a non-string seed inside rng — the registry entry's
    // SaveV1Schema.parse wrap throws, which the runner catches and rethrows
    // as MigrationFailedError.
    await _putRawForTests(SLOT, {
      version: 1,
      tick: 0,
      rng: [["player", { seed: 42, callCount: 0 }]],
    });
    try {
      await load(SLOT);
      throw new Error("expected load() to throw");
    } catch (err) {
      expect(err instanceof MigrationFailedError).toBe(true);
      const failed = err as MigrationFailedError;
      expect(failed.stepFrom).toBe(1);
      expect(failed.stepTo).toBe(2);
    }
  });

  it("fires when malformed SaveV3 fields fail the v3→v4 migration's parse wrap", async () => {
    // Post-P3, version: 3 is legacy. Malformed V3 records route through
    // runMigrations(raw, 3, 4); the v3→v4 entry's SaveV3Schema.parse(s) wrap
    // throws on the malformed tick, which the runner catches and rethrows
    // as MigrationFailedError. (Pre-P3 this same case surfaced as
    // InvalidSaveSchemaError because v3 was the current version.)
    await _putRawForTests(SLOT, {
      version: 3,
      tick: "not-a-number",
      rng: [],
      houses: [],
      characters: [],
      marriages: [],
      campaignName: "x",
    });
    try {
      await load(SLOT);
      throw new Error("expected load() to throw");
    } catch (err) {
      expect(err instanceof MigrationFailedError).toBe(true);
      const failed = err as MigrationFailedError;
      expect(failed.stepFrom).toBe(3);
      expect(failed.stepTo).toBe(4);
    }
  });
});

describe("load() — all corruption errors are SaveLoadError", () => {
  it("the abstract base catches every failure mode", async () => {
    await _putRawForTests(SLOT, { version: 99 });
    try {
      await load(SLOT);
    } catch (err) {
      expect(err instanceof SaveLoadError).toBe(true);
    }
  });
});
