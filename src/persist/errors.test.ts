import { describe, expect, it } from "vitest";
import {
  InvalidSaveSchemaError,
  MigrationFailedError,
  MissingMigrationError,
  SaveLoadError,
  SaveVersionTooNewError,
  UnknownSaveVersionError,
} from "./errors";

// Coverage discipline:
// (a) class extends SaveLoadError
// (b) class extends Error
// (c) stable userMessage
// (d) preserves `name` field
// (e) narrows through throw/catch — catches a regression where a future
//     refactor breaks the prototype chain (e.g., wrong Object.setPrototypeOf
//     during error wrapping)

describe("SaveLoadError variants — class hierarchy", () => {
  const variants: ReadonlyArray<[string, () => SaveLoadError]> = [
    ["InvalidSaveSchemaError", () => new InvalidSaveSchemaError([{ path: "x", message: "y" }])],
    ["UnknownSaveVersionError", () => new UnknownSaveVersionError("two")],
    ["SaveVersionTooNewError", () => new SaveVersionTooNewError(5, 3)],
    ["MigrationFailedError", () => new MigrationFailedError(1, 2, new Error("synthetic"))],
    ["MissingMigrationError", () => new MissingMigrationError(2, 3)],
  ];

  for (const [name, factory] of variants) {
    describe(name, () => {
      it("(a) extends SaveLoadError", () => {
        expect(factory() instanceof SaveLoadError).toBe(true);
      });
      it("(b) extends Error", () => {
        expect(factory() instanceof Error).toBe(true);
      });
      it("(c) has a stable userMessage", () => {
        const a = factory();
        const b = factory();
        expect(a.userMessage).toBe(b.userMessage);
        expect(typeof a.userMessage).toBe("string");
        expect(a.userMessage.length).toBeGreaterThan(0);
      });
      it("(d) preserves name field", () => {
        expect(factory().name).toBe(name);
      });
      it("(e) narrows through throw/catch", () => {
        try {
          throw factory();
        } catch (err) {
          expect(err instanceof SaveLoadError).toBe(true);
          expect(err instanceof Error).toBe(true);
        }
      });
    });
  }
});

describe("MigrationFailedError — inner-cause preservation", () => {
  it("carries the inner error", () => {
    const inner = new Error("synthetic inner");
    const err = new MigrationFailedError(1, 2, inner);
    expect(err.inner).toBe(inner);
  });
  it("formats inner Error message in this.message", () => {
    const err = new MigrationFailedError(1, 2, new Error("xyz"));
    expect(err.message).toContain("xyz");
    expect(err.message).toContain("v1 → v2");
  });
  it("stringifies non-Error inner causes", () => {
    const err = new MigrationFailedError(1, 2, "string cause");
    expect(err.message).toContain("string cause");
  });
});

describe("SaveLoadError — userMessage differentiation", () => {
  it("SaveVersionTooNewError has a distinct user message", () => {
    const tooNew = new SaveVersionTooNewError(5, 3).userMessage;
    const corrupt = new InvalidSaveSchemaError([]).userMessage;
    expect(tooNew).not.toBe(corrupt);
    expect(tooNew).toMatch(/newer version/);
  });
});
