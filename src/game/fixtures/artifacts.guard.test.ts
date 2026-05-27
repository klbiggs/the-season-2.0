// P24b guard: `ARTIFACT_REGISTRY.get` is banned everywhere EXCEPT the resolver
// module (fixtures/artifacts.ts). Every consumer MUST route definition lookups
// through resolveArtifactDefinition so the procedural half can never be silently
// bypassed (the bootstrap.ts throw-on-unknown-id hazard, plan E1). This scans the
// source tree and fails on any stray bare `.get` call against the registry.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_DIR = join(fileURLToPath(new URL("../../", import.meta.url)));
// The resolver lives here (the ONE sanctioned `ARTIFACT_REGISTRY.get` site); this
// guard file references the needle in prose, so both are excluded by basename.
const ALLOWED = new Set(["artifacts.ts", "artifacts.guard.test.ts"]);
// Needle assembled from parts so this file does not match its own scan.
const NEEDLE = `ARTIFACT_REGISTRY${"."}get`;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe("ARTIFACT_REGISTRY.get is confined to the resolver module", () => {
  it("no source file outside fixtures/artifacts.ts calls the registry .get directly", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC_DIR)) {
      const base = file.slice(file.lastIndexOf("/") + 1);
      if (ALLOWED.has(base)) continue;
      if (readFileSync(file, "utf8").includes(NEEDLE)) {
        offenders.push(file.slice(file.indexOf("/src/") + 1));
      }
    }
    expect(offenders, `Route these through resolveArtifactDefinition:\n${offenders.join("\n")}`).toEqual(
      [],
    );
  });
});
