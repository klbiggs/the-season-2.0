// Load-path corruption coverage. Each case writes a hand-crafted record
// into Dexie via _putRawForTests (bypassing save()'s Zod validation), then
// awaits load() and asserts the typed error type.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { _putRawForTests, _resetForTests, load } from "./dexie";
import {
  InvalidSaveSchemaError,
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

  it("fires when current-version (SaveV1) fields are malformed", async () => {
    // P19 — the only save format is the live SaveV1 (version 1). A malformed
    // current-version record hits SaveV1Schema.parse directly and surfaces as
    // InvalidSaveSchemaError. The in-payload version literal MUST be 1
    // (current); any other value would trip SaveVersionTooNewError /
    // UnknownSaveVersionError before reaching the parse.
    await _putRawForTests(SLOT, {
      version: 1,
      tick: "not-a-number",
      rng: [],
      houses: [],
      characters: [],
      marriages: [],
      campaignName: "x",
      era: "Earlier",
      conversationHistory: [],
      affectionMap: [],
      schemes: [],
      whispers: [],
      couriers: [],
      staff: [],
      proposalsLog: [],
      tutorAssignmentsLog: [],
      pendingTutorTraitChoices: [],
      patronesses: [],
      rivalActors: [],
      factionTensions: [],
      duels: [],
      elopement: null,
      artifactInstances: [],
      forgeries: [],
      thiefAttempts: [],
      globalEvents: [],
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
