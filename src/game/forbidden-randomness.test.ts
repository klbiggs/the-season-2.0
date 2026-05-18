// Sanity check: non-deterministic randomness APIs must not appear in any
// `.ts`/`.tsx` file under `src/` except the allowlist below. Catches what
// `eslint-plugin-boundaries` can't (string-level forbidden API calls anywhere
// outside src/game/rng.ts).
//
// Self-match avoidance: the test constructs the forbidden patterns at runtime
// via the join idiom so the literal substrings do not appear in this file's
// source. Comments here must follow the same discipline — do NOT write the
// banned substrings out, even as documentation.

import { lstat, readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_ROOT = resolve(__dirname, "..");
const ALLOWLIST: ReadonlySet<string> = new Set([
  "game/rng.ts",
  "game/rng.test.ts",
  "game/rng.replay.test.ts",
]);

const EXCLUDE_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  "dist",
  "coverage",
  ".git",
  ".vite",
  "build",
]);

const MAX_DEPTH = 10;

const FORBIDDEN_PATTERNS: ReadonlyArray<string> = [
  ["Math", ".", "random"].join(""),
  ["crypto", ".", "getRandomValues"].join(""),
];

async function walk(root: string, depth: number, out: string[]): Promise<void> {
  if (depth > MAX_DEPTH) throw new Error(`Walker exceeded max depth ${MAX_DEPTH} at ${root}`);
  const entries = await readdir(root);
  for (const name of entries) {
    if (EXCLUDE_DIRS.has(name)) continue;
    const full = join(root, name);
    const stat = await lstat(full);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      await walk(full, depth + 1, out);
    } else if (stat.isFile() && (name.endsWith(".ts") || name.endsWith(".tsx"))) {
      out.push(full);
    }
  }
}

describe("forbidden randomness patterns are absent outside the allowlist", () => {
  it("no .ts/.tsx file under src/ contains forbidden patterns (except allowlist)", async () => {
    const files: string[] = [];
    await walk(SRC_ROOT, 0, files);
    const offenders: Array<{ file: string; pattern: string }> = [];
    for (const file of files) {
      const rel = relative(SRC_ROOT, file);
      if (ALLOWLIST.has(rel)) continue;
      const content = await readFile(file, "utf8");
      for (const pattern of FORBIDDEN_PATTERNS) {
        if (content.includes(pattern)) {
          offenders.push({ file: rel, pattern });
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
