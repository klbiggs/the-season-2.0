// Conception step (year-pass). Iterates ALL active marriages in lex marriageId
// order, applies in-loop predicates (dissolved===false, both spouses alive,
// both under fertility ceiling, cadence hit). Failed predicate skips THAT
// marriage and continues — no early-return.
//
// RNG identity: per-house. The child joins state.characters.get(spouseAId).
// houseId (the lex-first spouse's house at marriage creation). All conception
// draws come from that house's RngState.
//
// Multi-marriage RNG isolation is NOT exercised by the main replay harness
// at P1 (fresh state has no marriages). A synthetic-state unit fixture in
// conception.test.ts covers the 2-marriage case. The full replay-harness
// extension lands at P7.

import {
  FERTILITY_CEILING_AGE,
  HAPPINESS_INITIAL,
  LIFESPAN_RANGE,
  TRAIT_NOVELTY_PROBABILITY,
  YEARS_PER_CONCEPTION_CYCLE,
} from "../constants";
import type { Character, GameState } from "../entities";
import { childCharacterId, childName } from "../fixtures/names";
import { TRAITS_ALL } from "../fixtures/traits";
import { type CharacterId, type RngState, type TraitId, drawInt, drawNext } from "../rng";
import { getCharacterOrThrow } from "../util/lookups";

// Exact 4-draw budget per call, deterministic regardless of branch taken:
//   1. First union index (drawNext consumed; pool may be empty)
//   2. Second union index (consumed regardless)
//   3. Novelty gate (consumed regardless)
//   4. Third-trait pick (consumed regardless)
// Empty-pool fallbacks SKIP populating the slot but STILL consume the draw.
export function inheritTraits(
  unionTraits: ReadonlySet<TraitId>,
  noveltyPool: readonly TraitId[],
  rngState: RngState,
): { traits: TraitId[]; rngState: RngState } {
  const sortedUnion = [...unionTraits].sort();
  const traits: TraitId[] = [];
  let rng = rngState;
  const chosen = new Set<TraitId>();

  // Slot 1: first union pick.
  {
    const { next, rngState: post } = drawNext(rng);
    rng = post;
    const candidates = sortedUnion.filter((t) => !chosen.has(t));
    if (candidates.length > 0) {
      const idx = Math.floor(next * candidates.length);
      const pick = candidates[idx];
      if (pick !== undefined) {
        traits.push(pick);
        chosen.add(pick);
      }
    }
  }
  // Slot 2: second union pick.
  {
    const { next, rngState: post } = drawNext(rng);
    rng = post;
    const candidates = sortedUnion.filter((t) => !chosen.has(t));
    if (candidates.length > 0) {
      const idx = Math.floor(next * candidates.length);
      const pick = candidates[idx];
      if (pick !== undefined) {
        traits.push(pick);
        chosen.add(pick);
      }
    }
  }
  // Slot 3: novelty gate. Fires BEFORE slot-4 candidate-pool composition.
  let useNovelty: boolean;
  {
    const { next, rngState: post } = drawNext(rng);
    rng = post;
    useNovelty = next < TRAIT_NOVELTY_PROBABILITY;
  }
  // Slot 4: third-trait pick. Candidate pool depends on slot-3 outcome.
  {
    const { next, rngState: post } = drawNext(rng);
    rng = post;
    const sourcePool: readonly TraitId[] = useNovelty
      ? noveltyPool.filter((t) => !chosen.has(t))
      : sortedUnion.filter((t) => !chosen.has(t));
    if (sourcePool.length > 0) {
      const idx = Math.floor(next * sourcePool.length);
      const pick = sourcePool[idx];
      if (pick !== undefined) {
        traits.push(pick);
        chosen.add(pick);
      }
    }
  }
  return { traits, rngState: rng };
}

export function applyConceptionStep(state: GameState): GameState {
  // Iterate the full marriages Map (lex by marriageId); filter in-loop. Failed
  // predicates skip THAT marriage and continue to the next; no early-return.
  const sortedMarriageIds = [...state.marriages.keys()].sort();
  let characters = state.characters;
  const rng = new Map(state.rng);
  // Track whether anything changed so we don't return a needlessly new object.
  let touched = false;

  for (const marriageId of sortedMarriageIds) {
    const marriage = state.marriages.get(marriageId);
    if (marriage === undefined) continue;
    if (marriage.dissolved) continue;

    // (currentTick - marriedAtTick) > 0 && % CYCLE === 0. The `> 0` guard
    // prevents wedding-tick conception per spec interpretation.
    const dt = state.tick - marriage.marriedAtTick;
    if (dt <= 0 || dt % YEARS_PER_CONCEPTION_CYCLE !== 0) continue;

    // Throw-on-orphan for BOTH spouses (symmetric).
    const spouseA = getCharacterOrThrow(state, marriage.spouseAId);
    const spouseB = getCharacterOrThrow(state, marriage.spouseBId);
    if (!spouseA.alive || !spouseB.alive) continue;
    if (spouseA.age >= FERTILITY_CEILING_AGE) continue;
    if (spouseB.age >= FERTILITY_CEILING_AGE) continue;

    // RNG identity: per-house. Child joins spouseA's house.
    const childHouseId = spouseA.houseId;
    let rngState = rng.get(childHouseId);
    if (rngState === undefined) continue;

    // 4 draws for traits.
    const unionTraits = new Set<TraitId>([...spouseA.traits, ...spouseB.traits]);
    const noveltyPool = TRAITS_ALL.filter((t) => !unionTraits.has(t));
    const { traits, rngState: postTraits } = inheritTraits(unionTraits, noveltyPool, rngState);
    rngState = postTraits;

    // 5th draw: deathAge.
    const range = LIFESPAN_RANGE[1] - LIFESPAN_RANGE[0] + 1;
    const { next: deathOffset, rngState: postDeath } = drawInt(rngState, range);
    rngState = postDeath;
    const deathAge = deathOffset + LIFESPAN_RANGE[0];

    // P7 6th draw: gender (50/50 split). Inserted AFTER deathAge so the
    // existing P1 4+1 draw budget for trait inheritance + deathAge is
    // preserved; gender is the new last draw. Replay-harness call-count
    // expectations gain +1 per child accordingly.
    const { next: genderRoll, rngState: postGender } = drawNext(rngState);
    rngState = postGender;
    const gender: "Female" | "Male" = genderRoll < 0.5 ? "Female" : "Male";

    // P7: parent edges. Lex-sort matches MarriageRecordSchema spouseAId/spouseBId
    // invariant (spouseAId < spouseBId at marriage creation) — passing them
    // verbatim preserves the sort.
    const parents: readonly [CharacterId, CharacterId] = [marriage.spouseAId, marriage.spouseBId];

    const newCharId = childCharacterId(marriageId, state.tick, 0);
    const child: Character = {
      id: newCharId,
      houseId: childHouseId,
      name: childName(marriageId, state.tick),
      birthTick: state.tick,
      age: 0,
      deathAge,
      alive: true,
      diedAtTick: null,
      mood: "Receptive",
      moodLockUntilTick: 0,
      role: "Dependent",
      archetype: "None",
      traits,
      // P4: children start with default composure.
      composure: 100,
      maxComposure: 100,
      marriageId: null,
      // P7 defaults — children inherit parent edges; happiness starts full;
      // no tutor at birth; no Dull exposure yet (happens on later marriage).
      happiness: HAPPINESS_INITIAL,
      temptationHookUnlocked: false,
      assignedTutorCharacterId: null,
      tutorBonusTraitGranted: false,
      dullSpouseExposureStartTick: null,
      parentCharacterIds: [parents[0], parents[1]],
      gender,
    };
    if (!touched) {
      characters = new Map(state.characters);
      touched = true;
    }
    characters.set(newCharId, child);
    rng.set(childHouseId, rngState);
  }

  if (!touched) return state;
  return { ...state, characters, rng };
}
