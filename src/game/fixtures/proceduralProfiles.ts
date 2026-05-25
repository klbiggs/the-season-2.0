// P16: archetype-aware generation profiles for procedural society NPCs. Each
// profile sets role + (optionally) a fixed gender + guaranteed traits so that
// `classifyArchetype` (archetypes.ts) deterministically returns the intended
// archetype — the `pooled` traits (drawn at generation) are curated to NOT flip
// the classifier branch. Module-load invariants enforce both the classifier
// lock and the MilitaryOfficer activation (D3) so a future trait-pool edit
// can't silently break either.

import { PROCEDURAL_PROFILE_WEIGHTS } from "../constants";
import type { Character } from "../entities";
import type { CharacterId, HouseId, TraitId } from "../rng";
import { type Archetype, classifyArchetype } from "./archetypes";
import type { Role } from "./roles";

type Gender = "Female" | "Male";
const t = (s: string): TraitId => s as TraitId;

export type ProceduralProfileKey = keyof typeof PROCEDURAL_PROFILE_WEIGHTS;

export type ProceduralProfile = {
  key: ProceduralProfileKey;
  /** Intended classifier outcome — pinned by the module-load invariant. */
  archetype: Archetype;
  role: Role;
  /** When set, overrides the drawn gender (the draw is still consumed). */
  fixedGender: Gender | null;
  /** Always present on the generated NPC (0 draws). */
  guaranteed: readonly TraitId[];
  /** Drawn from at generation (PROCEDURAL_NPC_TRAIT_DRAWS picks). */
  pooled: readonly TraitId[];
};

// ORDERED — the weighted pick (rules/proceduralNpcs.ts) walks this array in
// order, accumulating PROCEDURAL_PROFILE_WEIGHTS[key]. The order is part of the
// determinism contract; reordering re-rolls the society batch.
export const PROCEDURAL_PROFILES: readonly ProceduralProfile[] = [
  {
    key: "None",
    archetype: "None",
    role: "Dependent",
    fixedGender: null,
    guaranteed: [],
    pooled: [
      t("Generous"),
      t("Loyal"),
      t("Empathetic"),
      t("Bold"),
      t("Cautious"),
      t("Vain"),
      t("Witty"),
      t("Charming"),
      t("Brash"),
      t("Ambitious"),
      t("Greedy"),
    ],
  },
  {
    key: "BohemianRake",
    archetype: "BohemianRake",
    role: "Bohemian",
    fixedGender: "Male",
    guaranteed: [t("Jaded"), t("MilitaryOfficer")],
    pooled: [t("Bold"), t("Brash"), t("Charming"), t("Hedonistic"), t("Romantic"), t("Frivolous")],
  },
  {
    key: "Tutor",
    archetype: "Tutor",
    role: "Dependent",
    fixedGender: null,
    guaranteed: [t("Intellectual")],
    pooled: [t("Sophisticated"), t("Polyglot"), t("Eloquent"), t("Devout"), t("Ascetic")],
  },
  {
    key: "Spymaster",
    archetype: "Spymaster",
    role: "Spinster",
    fixedGender: "Female",
    guaranteed: [t("Cunning")],
    pooled: [t("Reserved"), t("Suspicious"), t("Cautious"), t("Observant"), t("Eloquent")],
  },
  {
    key: "CountryExile",
    archetype: "CountryExile",
    role: "Exile",
    fixedGender: null,
    guaranteed: [t("Rustic")],
    pooled: [t("Reclusive"), t("Melancholic"), t("ImpoverishedNobility"), t("Ascetic")],
  },
];

// ─── Module-load invariants ──────────────────────────────────────────────

function syntheticAdult(role: Role, gender: Gender, traits: readonly TraitId[]): Character {
  return {
    id: "synthetic-profile-check" as CharacterId,
    houseId: "synthetic" as HouseId,
    name: "",
    birthTick: 0,
    age: 30,
    deathAge: 80,
    alive: true,
    diedAtTick: null,
    mood: "Receptive",
    moodLockUntilTick: 0,
    role,
    archetype: "None",
    traits: [...traits],
    marriageId: null,
    composure: 100,
    maxComposure: 100,
    happiness: 100,
    temptationHookUnlocked: false,
    assignedTutorCharacterId: null,
    tutorBonusTraitGranted: false,
    dullSpouseExposureStartTick: null,
    parentCharacterIds: null,
    gender,
    equippedArtifactIds: [],
  };
}

// Classifier branch triggers (archetypes.ts:26-64). A pooled trait that matches
// a branch EARLIER than (or different from) the profile's intended branch would
// flip the classification when drawn.
const RAKE_TRIGGERS: readonly TraitId[] = [t("Frivolous"), t("Romantic"), t("Jaded")];
const TUTOR_TRIGGERS: readonly TraitId[] = [t("Intellectual"), t("Sophisticated")];
const EXILE_TRIGGERS: readonly TraitId[] = [t("ImpoverishedNobility"), t("Rustic")];

// (1) Profile keys must exactly cover the weight table.
{
  const weightKeys = Object.keys(PROCEDURAL_PROFILE_WEIGHTS);
  if (PROCEDURAL_PROFILES.length !== weightKeys.length) {
    throw new Error(
      `PROCEDURAL_PROFILES (${PROCEDURAL_PROFILES.length}) must match PROCEDURAL_PROFILE_WEIGHTS keys (${weightKeys.length})`,
    );
  }
  const profileKeys = new Set(PROCEDURAL_PROFILES.map((p) => p.key));
  for (const k of weightKeys) {
    if (!profileKeys.has(k as ProceduralProfileKey)) {
      throw new Error(`PROCEDURAL_PROFILE_WEIGHTS key "${k}" has no matching profile`);
    }
  }
}

// (2) Each profile's guaranteed traits + role (+ both genders when not fixed)
// must force the intended classifyArchetype outcome.
for (const p of PROCEDURAL_PROFILES) {
  const genders: Gender[] = p.fixedGender ? [p.fixedGender] : ["Female", "Male"];
  for (const g of genders) {
    const got = classifyArchetype(syntheticAdult(p.role, g, p.guaranteed));
    if (got !== p.archetype) {
      throw new Error(
        `PROCEDURAL_PROFILES["${p.key}"] guaranteed traits classify as "${got}" (gender ${g}), expected "${p.archetype}"`,
      );
    }
  }
}

// (3) Pooled traits must not flip the classifier. None must exclude every
// trigger; Tutor must exclude rake + exile triggers (Tutor pool may carry tutor
// triggers — they reinforce, not flip).
{
  const none = PROCEDURAL_PROFILES.find((p) => p.key === "None");
  if (none) {
    for (const tr of [...RAKE_TRIGGERS, ...TUTOR_TRIGGERS, ...EXILE_TRIGGERS]) {
      if (none.pooled.includes(tr)) {
        throw new Error(`None profile pooled trait "${tr}" would flip the classifier off None`);
      }
    }
  }
  const tutor = PROCEDURAL_PROFILES.find((p) => p.key === "Tutor");
  if (tutor) {
    for (const tr of [...RAKE_TRIGGERS, ...EXILE_TRIGGERS]) {
      if (tutor.pooled.includes(tr)) {
        throw new Error(`Tutor profile pooled trait "${tr}" would flip the classifier off Tutor`);
      }
    }
  }
}

// (4) MilitaryOfficer activation (D3): the BohemianRake profile MUST guarantee
// it — this is P16's first designed officer acquisition path.
{
  const rake = PROCEDURAL_PROFILES.find((p) => p.key === "BohemianRake");
  if (!rake || !rake.guaranteed.includes(t("MilitaryOfficer"))) {
    throw new Error("BohemianRake profile must guarantee MilitaryOfficer (P16 officer activation)");
  }
}
