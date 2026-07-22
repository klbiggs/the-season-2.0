// P26 guard: pins the REAL PHASES array order in src/runtime/tickOrchestrator.ts.
//
// Why a source scan rather than an import: the CLAUDE.md "frozen PHASES" non-
// negotiable deliberately keeps PHASES module-private (exporting it would let a
// consumer mutate the determinism contract), so no test can read the array at
// runtime. runOrchestratorWithPhases takes a SUBSTITUTED array, so every existing
// ordering test asserts only that the runner walks the array it was handed —
// which is true of any array and pins nothing about production order.
//
// That gap is not theoretical. Moving applyCallingCardPhase after
// applyRivalActionPhase — a direct violation of "rivals run last among
// RNG-consuming phases" — leaves the entire 1132-test suite green. This file is
// the only thing that fails on such a move.
//
// Maintenance: inserting a phase means editing EXPECTED_ORDER here. That is the
// point — the edit is the deliberate act of changing the determinism contract.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  fileURLToPath(new URL("./tickOrchestrator.ts", import.meta.url)),
  "utf8",
);

// The phase identifiers in their contractual order, slot 1..17.
const EXPECTED_ORDER = [
  "advanceTickPhase",
  "applyEconomyPhase",
  "applyLocationEffectsPhase",
  "applyCourierAndStaffPhase",
  "applySchemeResolutionPhase",
  "applyElopementAutoResolvePhase",
  "applyGlobalEventPhase",
  "applyCallingCardPhase",
  "applyMoodDriftPhase",
  "applyHappinessPhase",
  "applyPatronessErosionPhase",
  "applyForgerySurfacingPhase",
  "applyThiefNoticePhase",
  "applySiblingRivalActionPhase",
  "applyInheritedSecretSurfacingPhase",
  "applyRivalActionPhase",
  "evaluateDynastyPerks",
] as const;

// The sole phase permitted after applyRivalActionPhase, because it draws zero RNG
// (CLAUDE.md P15: "rivals last among RNG-consuming phases"). Any other phase
// appearing after rivals perturbs the seeded draw stream through the rival phase.
const RNG_FREE_TERMINAL = "evaluateDynastyPerks";

// Parses the `const PHASES: readonly TickPhase[] = [ ... ] as const;` literal and
// returns the identifiers in source order.
function parsePhaseOrder(): string[] {
  const start = SOURCE.indexOf("const PHASES");
  expect(start, "PHASES declaration not found — did the array get renamed?").toBeGreaterThan(-1);
  // Anchor on "= [", not the first "[": the type annotation `readonly TickPhase[]`
  // contains a bracket pair that precedes the array literal.
  const open = SOURCE.indexOf("= [", start) + "= ".length;
  const close = SOURCE.indexOf("] as const;", open);
  expect(close, "PHASES array terminator not found").toBeGreaterThan(open);
  return SOURCE.slice(open + 1, close)
    .split("\n")
    .map((line) =>
      line
        .replace(/\/\/.*$/, "")
        .trim()
        .replace(/,$/, ""),
    )
    .filter((line) => line.length > 0);
}

describe("PHASES order (real array, not a substituted one)", () => {
  it("matches the contractual order exactly", () => {
    expect(parsePhaseOrder()).toEqual([...EXPECTED_ORDER]);
  });

  it("has 17 slots post-P26", () => {
    expect(parsePhaseOrder()).toHaveLength(17);
  });

  it("runs the P26 calling-card phase after global events and before mood drift", () => {
    const order = parsePhaseOrder();
    expect(order.indexOf("applyCallingCardPhase")).toBe(order.indexOf("applyGlobalEventPhase") + 1);
    expect(order.indexOf("applyMoodDriftPhase")).toBe(order.indexOf("applyCallingCardPhase") + 1);
  });

  it("keeps rivals last among RNG-consuming phases", () => {
    const order = parsePhaseOrder();
    const rivalIdx = order.indexOf("applyRivalActionPhase");
    expect(rivalIdx).toBeGreaterThan(-1);
    // Everything after rivals must be RNG-free. Today that is exactly one phase.
    expect(order.slice(rivalIdx + 1)).toEqual([RNG_FREE_TERMINAL]);
  });

  it("runs the calling-card phase strictly before rivals (it consumes RNG)", () => {
    const order = parsePhaseOrder();
    expect(order.indexOf("applyCallingCardPhase")).toBeLessThan(
      order.indexOf("applyRivalActionPhase"),
    );
  });
});
