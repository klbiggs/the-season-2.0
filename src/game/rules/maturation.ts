// Year-pass maturation step. Detects characters who CROSSED the
// ADULTHOOD_AGE_IN_YEARS boundary this year-pass (age now exactly 18 after
// applyAgingStep's +1 increment), assigns the post-maturation role per the
// P7 role-assignment rules, re-classifies archetype, and seeds a pending
// tutor-trait choice if an assigned-tutor with non-None archetype exists.
//
// Insertion point: yearPass STEPS slot 2 (between aging and succession).
// The aging-before-maturation ordering is load-bearing: aging increments age,
// maturation reads the post-increment value at the exact-18 boundary.
//
// Determinism budget: ZERO PRNG draws. Pure deterministic computation.
//
// Plan: plans/phases/07-family-succession.md "Maturation step".

import { ADULTHOOD_AGE_IN_YEARS, MATURATION_RANDOM_TRAIT_PROBABILITY } from "../constants";
import type { Character, GameState } from "../entities";
import { ARCHETYPE_MATURATION_TRAIT_POOL, classifyArchetype } from "../fixtures/archetypes";
import type { Role } from "../fixtures/roles";
import { type TraitId, drawInt, drawNext } from "../rng";

// Role-decision branch per spec §3 + plan's role-assignment rules. Pure
// function on a single Character; reads no GameState (parent-aliveness not
// needed at v1). First-match-wins.
function computeMaturationRole(c: Character): Role {
  // P25 R1: the P23 "rival-house child → Exile" branch is REMOVED. Rival
  // succession now runs (R1), so rival children must be heir-eligible — they
  // fall through to the normal Spinster/Bohemian/Dependent rules like player
  // and society children. The Exile role stays reachable only via fixture
  // Exiles + future paths, NOT via maturation.
  //
  // Branch 1: unwed adult female → Spinster.
  if (c.gender === "Female" && c.marriageId === null) {
    return "Spinster";
  }
  // Branch 3: unwed adult male with Bohemian-trait set → Bohemian.
  if (
    c.gender === "Male" &&
    c.marriageId === null &&
    (c.traits.includes("Frivolous" as TraitId) ||
      c.traits.includes("Romantic" as TraitId) ||
      c.traits.includes("Jaded" as TraitId))
  ) {
    return "Bohemian";
  }
  // Else: keep Dependent (default for unwed adults without Bohemian markers,
  // and for unwed-but-not-yet-married unmatured edge cases).
  return "Dependent";
}

export function applyMaturationStep(state: GameState): GameState {
  let newChars = state.characters;
  let touched = false;
  const pendingChoices = new Map(state.pendingTutorTraitChoices);
  // P23 (item F): net-new rng accumulator. The random-archetype-trait draw
  // reads/writes the maturing character's OWN house rng (maturation iterates
  // lex-charId across houses, so a single shared stream would be wrong).
  const rng = new Map(state.rng);
  let rngChanged = false;
  const sortedCharIds = [...state.characters.keys()].sort();

  for (const charId of sortedCharIds) {
    // Read from newChars accumulator (NOT state.characters) so multi-sibling
    // iterations observe each prior iteration's role/archetype mutations.
    // Mirrors the per-iteration multi-Map accumulator pattern from
    // applyStaffOutputsPhase (CLAUDE.md non-negotiable).
    const c = newChars.get(charId);
    if (c === undefined || !c.alive) continue;
    // Exact-equals-18 boundary detection (NOT >=, to fire ONCE per character
    // per campaign). aging.ts is the SOLE age-incrementer, +1 per year-pass,
    // so age === 18 is hit exactly once across a campaign.
    if (c.age !== ADULTHOOD_AGE_IN_YEARS) continue;

    const newRole = computeMaturationRole(c);
    const reclassified = classifyArchetype({ ...c, role: newRole });

    // Pending tutor-trait choice: tutor must still be set AND tutor's
    // archetype must give a non-null pool. Note tutorChar lookup reads from
    // state.characters (not newChars) because the tutor is NEVER the
    // maturing character (assignTutor rejects TutorIsSelf); sibling iteration
    // cannot mutate another character's assignedTutorCharacterId — the loop
    // only mutates role + archetype per-character.
    const tutorChar =
      c.assignedTutorCharacterId !== null
        ? state.characters.get(c.assignedTutorCharacterId)
        : undefined;
    const tutorAlive = tutorChar?.alive === true;
    const tutorArchetype = tutorAlive && tutorChar !== undefined ? tutorChar.archetype : "None";
    const pool = ARCHETYPE_MATURATION_TRAIT_POOL[tutorArchetype];
    const pendsChoice = tutorAlive && pool !== null && c.assignedTutorCharacterId !== null;

    // P23 (item F): random-archetype trait pick. When the maturing character
    // classifies to a non-None archetype, roll once on their OWN house rng; on
    // success grant one random trait from that archetype's pool (deduped).
    // Budget: 1 gate draw per non-None-classified char + 1 pick draw on success.
    // None-classified characters draw nothing.
    let finalTraits = c.traits;
    if (reclassified !== "None") {
      const houseRng = rng.get(c.houseId);
      if (houseRng !== undefined) {
        const gate = drawNext(houseRng);
        let cursor = gate.rngState;
        if (gate.next < MATURATION_RANDOM_TRAIT_PROBABILITY) {
          const archetypePool = ARCHETYPE_MATURATION_TRAIT_POOL[reclassified];
          if (archetypePool !== null) {
            const picked = drawInt(cursor, archetypePool.length);
            cursor = picked.rngState;
            const traitId = archetypePool[picked.next];
            if (traitId !== undefined && !c.traits.includes(traitId)) {
              finalTraits = [...c.traits, traitId];
            }
          }
        }
        rng.set(c.houseId, cursor);
        rngChanged = true;
      }
    }

    if (!touched) {
      newChars = new Map(state.characters);
      touched = true;
    }
    newChars.set(charId, { ...c, role: newRole, archetype: reclassified, traits: finalTraits });

    if (pendsChoice && c.assignedTutorCharacterId !== null && pool !== null) {
      pendingChoices.set(charId, {
        childId: charId,
        tutorId: c.assignedTutorCharacterId,
        archetype: tutorArchetype as "Spymaster" | "BohemianRake" | "Tutor" | "CountryExile",
        // Pool is `readonly [TraitId, TraitId]` from the constant; tuple-
        // cast preserves the shape while satisfying the Zod schema's tuple.
        acceptableTraitIds: [pool[0], pool[1]],
        createdAtTick: state.tick,
      });
    }
    // If no choice pends, tutorBonusTraitGranted stays false permanently
    // (no bonus trait this campaign for this character).
  }

  if (!touched) return state;
  return {
    ...state,
    characters: newChars,
    pendingTutorTraitChoices: pendingChoices,
    ...(rngChanged ? { rng } : {}),
  };
}
