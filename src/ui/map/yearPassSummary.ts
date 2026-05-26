// P20: pure before/after diff of a runYearPass, used to surface the dynasty
// clock's effects (births / deaths / succession) that have no bus event of
// their own. There is no ChildConceived / SuccessionOccurred event in
// runtime/events/family.ts, and the pre-pass head's death is deliberately
// suppressed from publishCharacterDeaths — so a state diff is the only way to
// report what a year-pass did. Pure + UI-local (no store/orchestrator import);
// unit-tested in yearPassSummary.test.ts.

import type { GameState } from "../../game/entities";
import { PLAYER_HOUSE_ID } from "../../game/rng.seeds";

export type YearPassSummary = {
  // New player-house characters minted this pass (conception step).
  birthsCount: number;
  // Names of player-house members whose `alive` flipped true → false this pass,
  // EXCLUDING the pre-pass head (covered by `succession`).
  deaths: string[];
  // Non-null when the player house's head changed across the pass.
  succession: { generation: number; newHeadName: string } | null;
};

export function summarizeYearPass(before: GameState, after: GameState): YearPassSummary {
  let birthsCount = 0;
  for (const [id, c] of after.characters) {
    if (c.houseId === PLAYER_HOUSE_ID && !before.characters.has(id)) {
      birthsCount += 1;
    }
  }

  const beforeHeadId = before.houses.get(PLAYER_HOUSE_ID)?.headOfHouseCharacterId ?? null;

  const deaths: string[] = [];
  for (const [id, afterC] of after.characters) {
    if (afterC.houseId !== PLAYER_HOUSE_ID) continue;
    if (id === beforeHeadId) continue; // covered by succession, if any
    const wasAlive = before.characters.get(id)?.alive ?? false;
    if (wasAlive && !afterC.alive) deaths.push(afterC.name);
  }

  const afterHouse = after.houses.get(PLAYER_HOUSE_ID);
  const afterHeadId = afterHouse?.headOfHouseCharacterId ?? null;
  let succession: YearPassSummary["succession"] = null;
  if (beforeHeadId !== null && afterHeadId !== null && beforeHeadId !== afterHeadId) {
    succession = {
      generation: afterHouse?.generation ?? 0,
      newHeadName: after.characters.get(afterHeadId)?.name ?? afterHeadId,
    };
  }

  return { birthsCount, deaths, succession };
}

// Renders a YearPassSummary into a single player-facing line. Empty (quiet
// year) → a neutral confirmation rather than silence.
export function formatYearPassSummary(s: YearPassSummary): string {
  const parts: string[] = [];
  if (s.succession !== null) {
    parts.push(
      `${s.succession.newHeadName} inherits — Generation ${s.succession.generation} (−20 reputation).`,
    );
  }
  if (s.birthsCount > 0) {
    parts.push(s.birthsCount === 1 ? "A child was born." : `${s.birthsCount} children were born.`);
  }
  if (s.deaths.length > 0) {
    parts.push(`Lost: ${s.deaths.join(", ")}.`);
  }
  if (parts.length === 0) return "A year passed quietly.";
  return parts.join(" ");
}
