// Year-pass succession step. Promotes heirs for houses whose head died and
// who aren't already in the heirless terminal state. Composes:
//   1. Skip if house.heirless === true (idempotence gate).
//   2. Family pool (primary): living adult chars with role Spouse|Heir|Dependent.
//   3. Adult-children pool (secondary): empty at P1; helper returns []; P7
//      fills in real parent-child traversal.
//   4. Marriage dissolution for the dead head's marriage record (if any).
//   5. Heirless terminal flag if both pools are empty.
//   6. Promotion: new head, generation++, -20 reputation, ancestor summary.
//   7. Q4 classifier stub call.

import { ADULTHOOD_AGE_IN_YEARS, SUCCESSION_REPUTATION_PENALTY } from "../constants";
import type { Character, GameState, House, MarriageRecord } from "../entities";
import { classifyArchetype } from "../fixtures/archetypes";
import { getMarriageOrThrow } from "../util/lookups";

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

// P1 stub: parent-child traversal doesn't exist yet (no parent IDs on
// Character; child records ship at P7). Returns [] regardless of inputs.
export function findAdultChildren(_state: GameState, _deadHeadId: Character["id"]): Character[] {
  return [];
}

// Format pinned in succession.ts so the synthetic test reads from the same
// source. Exact-string match.
function formatAncestorLine(generationOfDeceased: number, dead: Character): string {
  return `G${generationOfDeceased}: ${dead.name} (b. ${dead.birthTick}, d. ${dead.diedAtTick ?? "?"})`;
}

export function applySuccessionStep(state: GameState): GameState {
  let next: GameState = state;
  for (const [, house] of state.houses) {
    if (house.heirless) continue;
    const head = next.characters.get(house.headOfHouseCharacterId);
    if (head === undefined || head.alive) continue;
    next = processDeadHead(next, house, head);
  }
  return next;
}

function processDeadHead(state: GameState, house: House, dead: Character): GameState {
  // Step 4: marriage dissolution (runs BEFORE pool filter so the dissolved-spouse
  // is still role: "Spouse" at filter time per the surviving-spouse pin).
  const marriages = new Map(state.marriages);
  if (dead.marriageId !== null) {
    const rec = getMarriageOrThrow(state, dead.marriageId);
    if (!rec.dissolved) {
      const updated: MarriageRecord = {
        ...rec,
        dissolved: true,
        dissolvedAtTick: state.tick,
      };
      marriages.set(rec.id, updated);
    }
  }

  // Step 2: family pool (primary). Living adult role-filtered candidates,
  // lex-sorted by characterId, first match wins. HeadOfHouse role naturally
  // excluded so dead head is self-excluded.
  const candidates: Character[] = [];
  for (const [, c] of state.characters) {
    if (c.houseId !== house.id) continue;
    if (!c.alive) continue;
    if (c.age < ADULTHOOD_AGE_IN_YEARS) continue;
    if (c.role !== "Spouse" && c.role !== "Heir" && c.role !== "Dependent") continue;
    candidates.push(c);
  }
  candidates.sort((a, b) => a.id.localeCompare(b.id));

  let heir: Character | undefined = candidates[0];
  if (heir === undefined) {
    // Step 3: adult-children pool (P1: always empty).
    const adultChildren = findAdultChildren(state, dead.id);
    heir = adultChildren[0];
  }

  // Ancestor summary is appended whenever the head dies, regardless of
  // heirless-vs-promoted outcome — the deceased is recorded either way.
  const ancestorLine = formatAncestorLine(house.generation, dead);
  const houses = new Map(state.houses);

  if (heir === undefined) {
    // Step 5: heirless terminal flag + ancestor summary appended.
    houses.set(house.id, {
      ...house,
      heirless: true,
      ancestorSummary: [...house.ancestorSummary, ancestorLine],
    });
    return { ...state, marriages, houses };
  }

  // Step 6: promotion.
  const newGeneration = house.generation + 1;
  houses.set(house.id, {
    ...house,
    headOfHouseCharacterId: heir.id,
    generation: newGeneration,
    reputation: clamp(house.reputation - SUCCESSION_REPUTATION_PENALTY, 0, 100),
    ancestorSummary: [...house.ancestorSummary, ancestorLine],
  });

  // Step 7: classify newly-promoted heir's archetype. P1 stub always "None".
  const characters = new Map(state.characters);
  const promoted: Character = {
    ...heir,
    role: "HeadOfHouse",
    archetype: classifyArchetype(heir),
  };
  characters.set(heir.id, promoted);

  return { ...state, marriages, houses, characters };
}

// `MarriageRecord` re-export keeps the import list self-documenting for callers.
export type { MarriageRecord };
