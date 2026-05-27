// P16: pure deterministic procedural-society generator. Consumes a transient
// RNG sub-stream (seeded `${campaignSeed}|procedural-npcs` by the caller) with a
// FIXED 8-draw budget per NPC (profile, gender, age, deathAge, 2 pooled traits,
// given name, surname) — fixed regardless of branch so the draw count is part of
// the determinism contract. Society NPCs are all single, non-head, adults in
// INDEPENDENT_HOUSE_ID. Runs on the bootstrap path; identical seed + era +
// count ⇒ byte-identical society across runs.

import {
  HAPPINESS_INITIAL,
  LIFESPAN_RANGE,
  PROCEDURAL_NPC_MAX_AGE,
  PROCEDURAL_NPC_MIN_AGE,
  PROCEDURAL_NPC_TRAIT_DRAWS,
  PROCEDURAL_PROFILE_WEIGHTS,
} from "../constants";
import type { Character } from "../entities";
import { classifyArchetype } from "../fixtures/archetypes";
import { GIVEN_NAMES, SURNAMES, honorificFor } from "../fixtures/nameBanks";
import { PROCEDURAL_PROFILES, type ProceduralProfile } from "../fixtures/proceduralProfiles";
import {
  type CharacterId,
  INDEPENDENT_HOUSE_ID,
  type RngState,
  type TraitId,
  drawInt,
} from "../rng";
import { npcAssignedLocation } from "../fixtures/hashCharIdToGender";
import { applyLifespanModifiers } from "./lifespan";

// Shared id convention. The legacy-emit filter (persist/schema.ts) excludes
// characters whose id starts with this prefix from pre-P16 save formats.
export const PROCEDURAL_NPC_ID_PREFIX = "proc-npc-";

type Era = "Earlier" | "Later";

// Integer cumulative-sum weighted pick (strict `>`). drawInt returns [0,99];
// strict `>` (NOT `>=`) avoids over-weighting the first bucket by one.
function pickProfile(roll: number): ProceduralProfile {
  let cumulative = 0;
  for (const profile of PROCEDURAL_PROFILES) {
    cumulative += PROCEDURAL_PROFILE_WEIGHTS[profile.key];
    if (cumulative > roll) return profile;
  }
  // Unreachable: weights sum to 100 and roll <= 99, so cumulative crosses roll.
  // Returned only to satisfy the type — the last profile is the natural fallback.
  return PROCEDURAL_PROFILES[PROCEDURAL_PROFILES.length - 1] as ProceduralProfile;
}

function buildProceduralNpcCharacter(
  rngState: RngState,
  era: Era,
  index: number,
): { character: Character; rngState: RngState } {
  let rng = rngState;

  // Draw 1: profile (weighted).
  const profilePick = drawInt(rng, 100);
  rng = profilePick.rngState;
  const profile = pickProfile(profilePick.next);

  // Draw 2: gender (drawn; profile may override for the Character but the draw
  // is still consumed). effectiveGender drives gender + honorific + name bank.
  const genderPick = drawInt(rng, 2);
  rng = genderPick.rngState;
  const drawnGender: "Female" | "Male" = genderPick.next === 0 ? "Female" : "Male";
  const effectiveGender = profile.fixedGender ?? drawnGender;

  // Draw 3: age within the adult band.
  const agePick = drawInt(rng, PROCEDURAL_NPC_MAX_AGE - PROCEDURAL_NPC_MIN_AGE + 1);
  rng = agePick.rngState;
  const age = agePick.next + PROCEDURAL_NPC_MIN_AGE;

  // Draw 4: base deathAge offset (always > age since age <= MAX_AGE <
  // LIFESPAN_RANGE[0]). P23: modifiers applied AFTER the trait loop below — the
  // pooled traits (draws 5+) are drawn after this, so finalizing inline here
  // would miss them. Draw order is unchanged; only finalization is deferred.
  const deathPick = drawInt(rng, LIFESPAN_RANGE[1] - LIFESPAN_RANGE[0] + 1);
  rng = deathPick.rngState;
  const baseDeathAge = deathPick.next + LIFESPAN_RANGE[0];

  // Draws 5..(4+PROCEDURAL_NPC_TRAIT_DRAWS): pooled traits (dedup vs guaranteed
  // + prior; collision consumes the draw without adding a trait).
  const traits: TraitId[] = [...profile.guaranteed];
  for (let k = 0; k < PROCEDURAL_NPC_TRAIT_DRAWS; k++) {
    const pick = drawInt(rng, profile.pooled.length);
    rng = pick.rngState;
    const candidate = profile.pooled[pick.next];
    if (candidate !== undefined && !traits.includes(candidate)) traits.push(candidate);
  }

  // P23: finalize deathAge with trait + gender lifespan modifiers (no draw).
  // effectiveGender (draw 2) + the full trait list are both resolved here.
  const deathAge = applyLifespanModifiers(baseDeathAge, effectiveGender, traits);

  // Draw 7: given name (effective gender).
  const givenBank = GIVEN_NAMES[era][effectiveGender];
  const givenPick = drawInt(rng, givenBank.length);
  rng = givenPick.rngState;
  const givenName = givenBank[givenPick.next] as string;

  // Draw 8: surname.
  const surnameBank = SURNAMES[era];
  const surnamePick = drawInt(rng, surnameBank.length);
  rng = surnamePick.rngState;
  const surname = surnameBank[surnamePick.next] as string;

  const id = `${PROCEDURAL_NPC_ID_PREFIX}${index}` as CharacterId;
  const name = `${honorificFor(effectiveGender)} ${givenName} ${surname}`;

  // Build with a placeholder archetype, classify, then set. classifyArchetype
  // reads role/gender/marriageId/age/traits — none of which depend on archetype.
  const base: Character = {
    id,
    houseId: INDEPENDENT_HOUSE_ID,
    name,
    birthTick: 0, // mirrors baseline NPCs — no aging skew (age field is authoritative)
    age,
    deathAge,
    alive: true,
    diedAtTick: null,
    mood: "Receptive",
    moodLockUntilTick: 0,
    role: profile.role,
    archetype: "None",
    traits,
    marriageId: null,
    composure: 100,
    maxComposure: 100,
    happiness: HAPPINESS_INITIAL,
    temptationHookUnlocked: false,
    assignedTutorCharacterId: null,
    tutorBonusTraitGranted: false,
    dullSpouseExposureStartTick: null,
    parentCharacterIds: null,
    gender: effectiveGender,
    equippedArtifactIds: [],
    assignedLocationId: npcAssignedLocation(id),
  };
  const character: Character = { ...base, archetype: classifyArchetype(base) };
  return { character, rngState: rng };
}

// `startIndex` (P22) offsets the `proc-npc-<i>` id suffix so replenishment
// batches mint non-colliding ids after the bootstrap cohort. Bootstrap passes 0
// (default); replenishment passes the count of all existing `proc-npc-` entries.
export function generateSocietyNpcs(
  rngState: RngState,
  era: Era,
  count: number,
  startIndex = 0,
): { characters: Character[]; rngState: RngState } {
  let rng = rngState;
  const characters: Character[] = [];
  for (let i = 0; i < count; i++) {
    const built = buildProceduralNpcCharacter(rng, era, startIndex + i);
    characters.push(built.character);
    rng = built.rngState;
  }
  return { characters, rngState: rng };
}

// P22 society-replenishment counters. Both walk state.characters for the
// `proc-npc-` prefix — no stored counter field (characters are never deleted,
// so the total count is the highest-minted-index + 1, contiguous from 0).
//   - aliveProceduralNpcCount: alive cohort size → drives the replenishment floor.
//   - totalProceduralNpcCount: all minted (alive + dead) → the next id startIndex.
export function aliveProceduralNpcCount(characters: ReadonlyMap<CharacterId, Character>): number {
  let n = 0;
  for (const c of characters.values()) {
    if (c.id.startsWith(PROCEDURAL_NPC_ID_PREFIX) && c.alive) n++;
  }
  return n;
}

export function totalProceduralNpcCount(characters: ReadonlyMap<CharacterId, Character>): number {
  let n = 0;
  for (const c of characters.values()) {
    if (c.id.startsWith(PROCEDURAL_NPC_ID_PREFIX)) n++;
  }
  return n;
}
