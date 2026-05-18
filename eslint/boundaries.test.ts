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

describe("positive control", () => {
  it("does NOT error when game/rules imports another game/rules file", async () => {
    const source = `import "./moods";\nexport function x() { return 1; }\n`;
    const result = await lint(source, "src/game/rules/economy.ts");
    const fired = result.messages.some((m) => m.ruleId === "boundaries/element-types");
    expect(fired).toBe(false);
  });
});
