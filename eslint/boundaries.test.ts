// Boundary-rule fires-on-violation test. Uses ESLint's Node API against
// synthetic source strings — no on-disk fixtures, no extension-name games.

import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..");

function makeEslint(): ESLint {
  return new ESLint({
    overrideConfigFile: resolve(REPO_ROOT, "eslint.config.js"),
    cwd: REPO_ROOT,
  });
}

async function lint(source: string, filePath: string) {
  const eslint = makeEslint();
  const results = await eslint.lintText(source, { filePath: resolve(REPO_ROOT, filePath) });
  const result = results[0];
  if (result === undefined) throw new Error("ESLint returned no results");
  return result;
}

describe("boundary rule (b): only game/rules and runtime/tickOrchestrator may import game/rng", () => {
  it("errors when src/ui imports src/game/rng", async () => {
    const source = `import { drawNext } from "../game/rng";\nexport function x() { return drawNext; }\n`;
    const result = await lint(source, "src/ui/violation.ts");
    const fired = result.messages.some((m) => m.ruleId === "boundaries/element-types");
    expect(fired).toBe(true);
  });
});

describe("boundary rule (a): src/game/rules/** may only import from rules/constants/fixtures/rng", () => {
  it("errors when src/game/rules imports src/runtime/tickOrchestrator", async () => {
    const source = `import "../../runtime/tickOrchestrator";\nexport function x() { return 1; }\n`;
    const result = await lint(source, "src/game/rules/violation.ts");
    const fired = result.messages.some((m) => m.ruleId === "boundaries/element-types");
    expect(fired).toBe(true);
  });
});

describe("positive control: same-element imports", () => {
  it("does NOT error when game/rules imports another game/rules file", async () => {
    const source = `import "./moods";\nexport function x() { return 1; }\n`;
    const result = await lint(source, "src/game/rules/economy.ts");
    const fired = result.messages.some((m) => m.ruleId === "boundaries/element-types");
    expect(fired).toBe(false);
  });
});

// P1 positive controls: every new cross-element import path has its own case
// so a future config tightening can't silently break P1 retroactively.
describe("P1 positive controls — cross-element permission pins", () => {
  it("persist → game-bootstrap is permitted", async () => {
    const source = `import { seedStartingFamily } from "../../game/bootstrap";\nexport function x() { return seedStartingFamily; }\n`;
    const result = await lint(source, "src/persist/migrations/v1-to-v2.ts");
    const fired = result.messages.some((m) => m.ruleId === "boundaries/element-types");
    expect(fired).toBe(false);
  });

  it("game-bootstrap → game-rng is permitted", async () => {
    const source = `import { drawInt } from "./rng";\nexport function x() { return drawInt; }\n`;
    const result = await lint(source, "src/game/bootstrap.ts");
    const fired = result.messages.some((m) => m.ruleId === "boundaries/element-types");
    expect(fired).toBe(false);
  });

  it("runtime-tick-orchestrator → game-rules is permitted", async () => {
    const source = `import { applyEconomyPhase } from "../game/rules/economy";\nexport function x() { return applyEconomyPhase; }\n`;
    const result = await lint(source, "src/runtime/tickOrchestrator.ts");
    const fired = result.messages.some((m) => m.ruleId === "boundaries/element-types");
    expect(fired).toBe(false);
  });

  it("game-store → game-bootstrap is permitted", async () => {
    const source = `import { seedStartingFamily } from "./bootstrap";\nexport function x() { return seedStartingFamily; }\n`;
    const result = await lint(source, "src/game/store.ts");
    const fired = result.messages.some((m) => m.ruleId === "boundaries/element-types");
    expect(fired).toBe(false);
  });

  it("ui → game-util is permitted", async () => {
    const source = `import { getCharacterOrThrow } from "../../game/util/lookups";\nexport function x() { return getCharacterOrThrow; }\n`;
    const result = await lint(source, "src/ui/dev/DevApp.tsx");
    const fired = result.messages.some((m) => m.ruleId === "boundaries/element-types");
    expect(fired).toBe(false);
  });

  it("runtime → game-rules (folder-mode element) is permitted", async () => {
    const source = `import { applyAgingStep } from "../game/rules/aging";\nexport function x() { return applyAgingStep; }\n`;
    const result = await lint(source, "src/runtime/yearPass.ts");
    const fired = result.messages.some((m) => m.ruleId === "boundaries/element-types");
    expect(fired).toBe(false);
  });

  it("game-rules → game-util is permitted (the new allow-list entry)", async () => {
    const source = `import { assertNever } from "../util/assertNever";\nexport function x() { return assertNever; }\n`;
    const result = await lint(source, "src/game/rules/economy.ts");
    const fired = result.messages.some((m) => m.ruleId === "boundaries/element-types");
    expect(fired).toBe(false);
  });

  it("persist → game-fixtures is permitted", async () => {
    const source = `import { MoodSchema } from "../game/fixtures/moods";\nexport function x() { return MoodSchema; }\n`;
    const result = await lint(source, "src/persist/schema.ts");
    const fired = result.messages.some((m) => m.ruleId === "boundaries/element-types");
    expect(fired).toBe(false);
  });

  it("game-rules → game-entities is permitted (the new allow-list entry)", async () => {
    const source = `import type { GameState } from "../entities";\nexport function x(_s: GameState): number { return 1; }\n`;
    const result = await lint(source, "src/game/rules/economy.ts");
    const fired = result.messages.some((m) => m.ruleId === "boundaries/element-types");
    expect(fired).toBe(false);
  });
});
