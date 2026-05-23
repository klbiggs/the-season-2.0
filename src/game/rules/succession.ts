// Year-pass succession step. Promotes heirs for houses whose head died and
// who aren't already in the heirless terminal state. Composes:
//   1. Skip if house.heirless === true (idempotence gate).
//   2. Family pool (primary): living adult chars with role Spouse|Heir|Dependent.
//   3. Adult-children pool (secondary): P7 fills real parent-edge traversal
//      via findAdultChildren below.
//   4. Marriage dissolution for the dead head's marriage record (if any).
//   5. Heirless terminal flag if both pools are empty.
//   6. Promotion: new head, generation++, -20 reputation, ancestor summary.
//   7. Q4 classifier widened to every surviving family-house character —
//      heir's role is HeadOfHouse post-promotion; siblings/spinsters/etc.
//      classify per their post-aging role.

import { ADULTHOOD_AGE_IN_YEARS, SUCCESSION_REPUTATION_PENALTY } from "../constants";
import type { Character, GameState, House, MarriageRecord } from "../entities";
import { classifyArchetype } from "../fixtures/archetypes";
import { RIVAL_HOUSE_IDS_SET } from "../fixtures/rivals";
import { type CharacterId, PLAYER_HOUSE_ID } from "../rng";
import { getMarriageOrThrow } from "../util/lookups";
import { accumulateInheritedSecretsAtSuccession } from "./inheritedSecrets";

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

// P7: real body. Filters by parent-edge — children whose parentCharacterIds
// includes the dead head's id, who are alive and adult. Lex-sorted by id so
// multi-eligible-children promotion is deterministic. No RNG draws.
//
// At P7 cross-house children don't exist (conception sets childHouseId to
// the spouse's house); a future P11 sibling-rival adoption flow would need
// a defensive `c.houseId === deadHead.houseId` filter.
export function findAdultChildren(state: GameState, deadHeadId: CharacterId): Character[] {
  const candidates: Character[] = [];
  for (const [, c] of state.characters) {
    if (!c.alive) continue;
    if (c.age < ADULTHOOD_AGE_IN_YEARS) continue;
    if (c.parentCharacterIds === null) continue;
    if (!c.parentCharacterIds.includes(deadHeadId)) continue;
    candidates.push(c);
  }
  candidates.sort((a, b) => a.id.localeCompare(b.id));
  return candidates;
}

// Format pinned in succession.ts so the synthetic test reads from the same
// source. Exact-string match.
function formatAncestorLine(generationOfDeceased: number, dead: Character): string {
  return `G${generationOfDeceased}: ${dead.name} (b. ${dead.birthTick}, d. ${dead.diedAtTick ?? "?"})`;
}

export function applySuccessionStep(state: GameState): GameState {
  let next: GameState = state;
  for (const [, house] of state.houses) {
    // P8: rival houses skip succession at v1. Rivals become heirless/dormant
    // when their head dies (per "rival succession" Out-of-scope deferral).
    // Narrowed to RIVAL_HOUSE_IDS_SET (NOT a blanket non-player skip) to
    // preserve Independent's pre-P8 auto-succession behavior.
    if (RIVAL_HOUSE_IDS_SET.has(house.id)) continue;
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

  // Step 7 (P7): classifier widened to every surviving family-house character.
  // Heir's role flips to HeadOfHouse post-promotion; siblings/spinsters/etc.
  // classify per their post-aging role + traits + gender + marriage. The
  // classifier is pure-referentially-transparent (no RNG draws), so the
  // double-classify (maturation then succession in the same year-pass) is
  // idempotent for the maturating child.
  const characters = new Map(state.characters);
  for (const [id, c] of state.characters) {
    if (c.houseId !== house.id) continue;
    if (!c.alive) continue;
    const isPromoted = id === heir.id;
    const post: Character = isPromoted
      ? { ...c, role: "HeadOfHouse", archetype: classifyArchetype({ ...c, role: "HeadOfHouse" }) }
      : { ...c, archetype: classifyArchetype(c) };
    characters.set(id, post);
  }

  // P11: accumulate inherited secrets from verified+weaponized whispers about
  // the player house. Runs ONLY on the PROMOTED branch (heirless succession
  // returns earlier — no future generations to inherit from) AND ONLY when the
  // player house succeeds (PLAYER_HOUSE_ID gate inside the helper).
  let next: GameState = { ...state, marriages, houses, characters };
  if (house.id === PLAYER_HOUSE_ID) {
    next = accumulateInheritedSecretsAtSuccession(next, dead.id, heir.id);
  }
  return next;
}

// `MarriageRecord` re-export keeps the import list self-documenting for callers.
export type { MarriageRecord };
