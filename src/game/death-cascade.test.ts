// P7 lint-style boundary test: every site under src/game/rules/** that
// flips `Character.alive = false` (or computes `alive: !dies`) MUST import
// `pruneOrphanedConversationKeys` from `./aging` (or live IN aging.ts
// itself). The 3-branch helper (tutor-prune + Dull-exposure prune + marriage-
// dissolution) is the canonical death-cascade site per CLAUDE.md.
//
// If a future-phase death-producing rule (P8 duel deaths, P11 sibling-rival
// kills, P13 WarEffort officer deaths) skips the helper, the orphan-prune
// cascade silently fails: tutor assignments referencing dead tutors stay
// stale, Dull-spouse exposure ticks survive past spouse death (continuing
// happiness drain), marriages stay un-dissolved.
//
// This test is grep-based across the rules-layer source files. It is NOT a
// replacement for unit tests of the helper itself (those live in aging.test.ts
// + the proposal/maturation/scheme tests that exercise the full year-pass
// composition).

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RULES_DIR = join(__dirname, "rules");

// Regex matches "alive: false" OR "alive: !dies" (the two known shapes that
// transition a Character from alive to dead). Future shapes (e.g.,
// "alive: someBoolean") would also need to match — extend the regex.
const ALIVE_FALSE_PATTERN = /alive:\s*(?:false\b|!dies\b)/;

function gatherRuleFiles(): Array<{ name: string; content: string }> {
  const out: Array<{ name: string; content: string }> = [];
  for (const entry of readdirSync(RULES_DIR)) {
    if (!entry.endsWith(".ts")) continue;
    if (entry.endsWith(".test.ts")) continue;
    const content = readFileSync(join(RULES_DIR, entry), "utf-8");
    out.push({ name: entry, content });
  }
  return out;
}

describe("death-cascade lint: alive-false mutations must import pruneOrphanedConversationKeys", () => {
  const files = gatherRuleFiles();

  it("at least one rule file matches the alive-false pattern (regex sanity check)", () => {
    const matched = files.filter((f) => ALIVE_FALSE_PATTERN.test(f.content));
    expect(matched.length).toBeGreaterThan(0);
  });

  it("every rule file that flips alive=false imports pruneOrphanedConversationKeys", () => {
    for (const f of files) {
      if (!ALIVE_FALSE_PATTERN.test(f.content)) continue;
      // aging.ts is the EXPORT site — it doesn't need to import the helper.
      if (f.name === "aging.ts") continue;
      const importsHelper =
        f.content.includes('from "./aging"') && f.content.includes("pruneOrphanedConversationKeys");
      expect(
        importsHelper,
        `${f.name} flips Character.alive = false but does NOT import pruneOrphanedConversationKeys from ./aging — the orphan-prune cascade will silently fail (tutor refs stale, Dull exposure persists, marriages stay un-dissolved). Either import + call the helper after the death mutation, OR route the death through applyAgingStep / runYearPassPure (year-pass deaths) / the existing Assassination resolver (which DOES call it).`,
      ).toBe(true);
    }
  });

  it("aging.ts defines pruneOrphanedConversationKeys (the canonical helper)", () => {
    const aging = files.find((f) => f.name === "aging.ts");
    expect(aging).toBeDefined();
    if (aging === undefined) throw new Error("aging.ts not found in rules dir");
    expect(aging.content).toMatch(/export function pruneOrphanedConversationKeys\b/);
  });
});
