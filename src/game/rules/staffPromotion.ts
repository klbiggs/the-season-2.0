// P24c (I2): promote a StaffMember into a first-class player-house Character.
// Pure rule layer. The promoted character is marriage-eligible and participates
// in all family/marriage/conversation systems immediately; the source staff is
// marked promotedToCharacterId (inert thereafter, never deleted).
//
// FIXED 4-draw budget on the player-house RNG stream: gender → age →
// deathAge-base → trait-pool pick. deathAge + role FINALIZE after traits are
// drawn (both applyLifespanModifiers and the role rule read the full trait
// array) — reorder finalization, not draws (P23 precedent).
//
// Gender is DRAWN (P16 procedural precedent), NOT hashCharIdToGender — that hash
// is restricted to fixed fixtures (P7); a promoted staffer is a new entity.
// computeMaturationRole is module-private in maturation.ts, so the role rule is
// RE-IMPLEMENTED here (player-house, marriage-eligible: Female→Spinster;
// Male+Bohemian-trait→Bohemian; else Dependent).

import {
  HAPPINESS_INITIAL,
  LIFESPAN_RANGE,
  PROMOTED_STAFF_AGE_MAX,
  PROMOTED_STAFF_AGE_MIN,
} from "../constants";
import type { Character, GameState } from "../entities";
import { classifyArchetype } from "../fixtures/archetypes";
import type { Role } from "../fixtures/roles";
import {
  type CharacterId,
  PLAYER_HOUSE_ID,
  type StaffId,
  type TraitId,
  drawInt,
  getOrThrow,
} from "../rng";
import { applyLifespanModifiers } from "./lifespan";

export type PromoteStaffRejection =
  | { kind: "StaffNotFound"; staffId: StaffId }
  | { kind: "StaffInactive"; staffId: StaffId } // already dismissed or promoted
  | { kind: "PlayerExiled" } // store-wrapper modal gate
  | { kind: "ElopementInProgress" }; // store-wrapper modal gate

export type PromoteStaffResult =
  | { ok: true; state: GameState; characterId: CharacterId }
  | { ok: false; reason: PromoteStaffRejection };

// Small benign trait pool for a promoted staffer (a servant's gestalt). Index 0
// of the draw means "no pooled trait." Greedy is added separately from isGreedy.
const PROMOTED_STAFF_TRAIT_POOL: readonly TraitId[] = [
  "Loyal" as TraitId,
  "Cunning" as TraitId,
  "Reserved" as TraitId,
  "Observant" as TraitId,
];

// Deterministic, never-delete-stable id for the promoted character. The source
// staffId is unique and never deleted, so `promoted-<staffId>` is unique forever.
export function promotedStaffCharacterId(staffId: StaffId): CharacterId {
  return `promoted-${staffId}` as CharacterId;
}

// Re-implemented from the module-private computeMaturationRole (maturation.ts).
// A promoted staffer is always player-house + marriage-eligible (marriageId null).
function promotedRole(gender: "Female" | "Male", traits: readonly TraitId[]): Role {
  if (gender === "Female") return "Spinster";
  if (
    gender === "Male" &&
    (traits.includes("Frivolous" as TraitId) ||
      traits.includes("Romantic" as TraitId) ||
      traits.includes("Jaded" as TraitId))
  ) {
    return "Bohemian";
  }
  return "Dependent";
}

export function promoteStaffToCharacter(state: GameState, staffId: StaffId): PromoteStaffResult {
  const staff = state.staff.get(staffId);
  if (staff === undefined) {
    return { ok: false, reason: { kind: "StaffNotFound", staffId } };
  }
  if (staff.dismissedAtTick !== null || staff.promotedToCharacterId !== null) {
    return { ok: false, reason: { kind: "StaffInactive", staffId } };
  }

  // ── Draws on the player-house stream (fixed 4-draw budget) ──────────────
  let rng = getOrThrow(state.rng, PLAYER_HOUSE_ID);

  const genderPick = drawInt(rng, 2);
  rng = genderPick.rngState;
  const gender: "Female" | "Male" = genderPick.next === 0 ? "Female" : "Male";

  const agePick = drawInt(rng, PROMOTED_STAFF_AGE_MAX - PROMOTED_STAFF_AGE_MIN + 1);
  rng = agePick.rngState;
  const age = agePick.next + PROMOTED_STAFF_AGE_MIN;

  const deathPick = drawInt(rng, LIFESPAN_RANGE[1] - LIFESPAN_RANGE[0] + 1);
  rng = deathPick.rngState;
  const baseDeathAge = deathPick.next + LIFESPAN_RANGE[0];

  const traitPick = drawInt(rng, PROMOTED_STAFF_TRAIT_POOL.length + 1);
  rng = traitPick.rngState;
  const traits: TraitId[] = [];
  if (staff.isGreedy) traits.push("Greedy" as TraitId);
  if (traitPick.next > 0) {
    const pooled = PROMOTED_STAFF_TRAIT_POOL[traitPick.next - 1] as TraitId;
    if (!traits.includes(pooled)) traits.push(pooled);
  }

  // ── Finalize AFTER traits are resolved (P23 draw-order discipline) ──────
  const deathAge = applyLifespanModifiers(baseDeathAge, gender, traits);
  const role = promotedRole(gender, traits);

  const id = promotedStaffCharacterId(staffId);
  const name = staff.name.replace(/\s*\(.*\)$/, ""); // strip the "(role)" suffix
  const base: Character = {
    id,
    houseId: PLAYER_HOUSE_ID,
    name,
    birthTick: 0,
    age,
    deathAge,
    alive: true,
    diedAtTick: null,
    mood: "Receptive",
    moodLockUntilTick: 0,
    role,
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
    gender,
    equippedArtifactIds: [],
    assignedLocationId: "Capital",
  };
  const character: Character = { ...base, archetype: classifyArchetype(base) };

  const newChars = new Map(state.characters);
  newChars.set(id, character);
  const newStaff = new Map(state.staff);
  newStaff.set(staffId, { ...staff, promotedToCharacterId: id });
  const newRng = new Map(state.rng);
  newRng.set(PLAYER_HOUSE_ID, rng);

  return {
    ok: true,
    state: { ...state, characters: newChars, staff: newStaff, rng: newRng },
    characterId: id,
  };
}
