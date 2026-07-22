// Canonical artifact registry per spec §3 line 553 + §4 line 553. Seven
// entries verbatim from the spec: sapphires, tiara, snuffbox, phaeton,
// mount, family-deed, ancestral-portrait.
//
// P24b: this fixture registry is now the FIXED half of artifact definitions.
// The PROCEDURAL half lives in `state.proceduralArtifactDefinitions` (generated
// at bootstrap). All definition lookups route through `resolveArtifactDefinition`
// (artifactDefinitions.ts), which falls through ARTIFACT_REGISTRY → the
// procedural map. Each ArtifactInstance references its definition by
// ArtifactDefinitionId (FK into either half).

import { z } from "zod";

import type { GameState } from "../entities";
import {
  type ArtifactDefinitionId,
  ArtifactDefinitionIdSchema,
  type ArtifactInstanceId,
  type CharacterId,
  type ForgeryId,
  type ThiefAttemptId,
  TraitIdSchema,
} from "../rng";

export const ARTIFACT_FAMILIES = [
  "sapphires",
  "tiara",
  "snuffbox",
  "phaeton",
  "mount",
  "family-deed",
  "ancestral-portrait",
] as const;
export type ArtifactFamily = (typeof ARTIFACT_FAMILIES)[number];

// P25 R9 (Q21): the coarser cultural axis MonarchsMood rolls over. Each of the
// 7 artifact families maps to exactly one culture, so a favored culture matches
// a house holding ANY family in that culture's group — coarser matching means
// more houses can equip their way out of the snub (the pivot becomes a real
// choice). Identity registry, not designer tuning.
export const CULTURES = ["Refinement", "Sport", "Heritage"] as const;
export type Culture = (typeof CULTURES)[number];

export const CULTURAL_AFFINITY_BY_FAMILY: Readonly<Record<ArtifactFamily, Culture>> = {
  sapphires: "Refinement",
  tiara: "Refinement",
  snuffbox: "Refinement",
  phaeton: "Sport",
  mount: "Sport",
  "family-deed": "Heritage",
  "ancestral-portrait": "Heritage",
};

// Module-load exhaustiveness guard: every family maps to a valid culture.
for (const fam of ARTIFACT_FAMILIES) {
  if (!CULTURES.includes(CULTURAL_AFFINITY_BY_FAMILY[fam])) {
    throw new Error(`CULTURAL_AFFINITY_BY_FAMILY[${fam}] is not a valid Culture`);
  }
}

export const ArtifactDefinitionSchema = z.object({
  id: ArtifactDefinitionIdSchema,
  displayName: z.string(),
  family: z.enum(ARTIFACT_FAMILIES),
  reputationBonusWhileEquipped: z.number().int(),
  scandalRiskWhileEquipped: z.number().int().min(0),
  traitGrantsWhileEquipped: z.array(TraitIdSchema),
  forgeable: z.boolean(),
  forgeWealthCost: z.number().int().nonnegative(),
});
export type ArtifactDefinition = z.infer<typeof ArtifactDefinitionSchema>;

// brandDef applies the ArtifactDefinitionId brand at a single point so the
// registry literal below stays plain-string. The id doubles as the Map key.
function brandDef(
  d: Omit<ArtifactDefinition, "id"> & { id: string },
): readonly [ArtifactDefinitionId, ArtifactDefinition] {
  const id = d.id as ArtifactDefinitionId;
  return [id, { ...d, id }];
}

export const ARTIFACT_REGISTRY: ReadonlyMap<ArtifactDefinitionId, ArtifactDefinition> = new Map([
  brandDef({
    id: "sapphires",
    displayName: "The Carrington Sapphires",
    family: "sapphires",
    reputationBonusWhileEquipped: 8,
    scandalRiskWhileEquipped: 1,
    traitGrantsWhileEquipped: [],
    forgeable: true,
    forgeWealthCost: 30,
  }),
  brandDef({
    id: "tiara",
    displayName: "The Marlborough Tiara",
    family: "tiara",
    reputationBonusWhileEquipped: 10,
    scandalRiskWhileEquipped: 1,
    traitGrantsWhileEquipped: [],
    forgeable: true,
    forgeWealthCost: 40,
  }),
  brandDef({
    id: "snuffbox",
    displayName: "The Imperial Snuffbox",
    family: "snuffbox",
    reputationBonusWhileEquipped: 4,
    scandalRiskWhileEquipped: 0,
    traitGrantsWhileEquipped: [],
    forgeable: true,
    forgeWealthCost: 15,
  }),
  brandDef({
    id: "phaeton",
    displayName: "The Crimson Phaeton",
    family: "phaeton",
    reputationBonusWhileEquipped: 6,
    scandalRiskWhileEquipped: 0,
    traitGrantsWhileEquipped: [],
    forgeable: false,
    forgeWealthCost: 0,
  }),
  brandDef({
    id: "mount",
    displayName: "Thoroughbred",
    family: "mount",
    reputationBonusWhileEquipped: 3,
    scandalRiskWhileEquipped: 0,
    traitGrantsWhileEquipped: [],
    forgeable: false,
    forgeWealthCost: 0,
  }),
  brandDef({
    id: "family-deed",
    displayName: "Norfolk Land Deed",
    family: "family-deed",
    reputationBonusWhileEquipped: 5,
    scandalRiskWhileEquipped: 0,
    traitGrantsWhileEquipped: [],
    forgeable: false,
    forgeWealthCost: 0,
  }),
  brandDef({
    id: "ancestral-portrait",
    displayName: "The Founder's Portrait",
    family: "ancestral-portrait",
    reputationBonusWhileEquipped: 5,
    scandalRiskWhileEquipped: 0,
    traitGrantsWhileEquipped: [],
    forgeable: false,
    forgeWealthCost: 0,
  }),
]);

// Module-load assertions (P10 hardening):
//   1. forgeable/forgeWealthCost coherence.
//   2. Every entry's family is in ARTIFACT_FAMILIES (no enum drift).
//   3. Family uniqueness — required for the "max one per family" equip
//      invariant to be enforceable (two definitions sharing a family would
//      silently break the MaxOnePerFamily check on equip).
{
  const familySeen = new Set<ArtifactFamily>();
  for (const def of ARTIFACT_REGISTRY.values()) {
    if (def.forgeable && def.forgeWealthCost <= 0) {
      throw new Error(
        `Artifact ${def.id} forgeable=true but forgeWealthCost=${def.forgeWealthCost}`,
      );
    }
    if (!def.forgeable && def.forgeWealthCost !== 0) {
      throw new Error(
        `Artifact ${def.id} forgeable=false but forgeWealthCost=${def.forgeWealthCost}`,
      );
    }
    if (!(ARTIFACT_FAMILIES as readonly string[]).includes(def.family)) {
      throw new Error(`Artifact ${def.id} carries family=${def.family} not in ARTIFACT_FAMILIES`);
    }
    if (familySeen.has(def.family)) {
      throw new Error(
        `Artifact ${def.id} duplicates family=${def.family} — max-one-per-family equip invariant requires unique families across the registry`,
      );
    }
    familySeen.add(def.family);
  }
}

// P24b: the SINGLE sanctioned artifact-definition lookup. Falls through the
// fixed ARTIFACT_REGISTRY → the procedural definitions in state. EVERY consumer
// (rules, bootstrap, store, runtime, UI) routes definition lookups through here;
// a lint/test guard bans bare `ARTIFACT_REGISTRY.get` outside this module so the
// procedural half can never be silently bypassed (the bootstrap.ts throw-on-
// unknown-id hazard). Returns undefined for an unknown id (callers handle).
export function resolveArtifactDefinition(
  state: GameState,
  definitionId: ArtifactDefinitionId,
): ArtifactDefinition | undefined {
  return (
    ARTIFACT_REGISTRY.get(definitionId) ?? state.proceduralArtifactDefinitions.get(definitionId)
  );
}

// Player bootstrap inventory. Three instances on a fresh campaign; two
// start equipped on the player head. Deterministic via lex-sorted IDs.
// sapphires + snuffbox cover the wardrobe-refresh / forgery loop; mount lets
// P12's "compliment mount" tactic gate on player ownership immediately.
//
// lastRefreshTick is set to 0 at bootstrap (in-season for the first
// WARDROBE_REFRESH_INTERVAL_TICKS ticks).
export const PLAYER_STARTING_ARTIFACTS: ReadonlyArray<{
  definitionId: ArtifactDefinitionId;
  equippedFromStart: boolean;
  lastRefreshTick: number;
}> = [
  {
    definitionId: "sapphires" as ArtifactDefinitionId,
    equippedFromStart: true,
    lastRefreshTick: 0,
  },
  {
    definitionId: "snuffbox" as ArtifactDefinitionId,
    equippedFromStart: false,
    lastRefreshTick: 0,
  },
  { definitionId: "mount" as ArtifactDefinitionId, equippedFromStart: true, lastRefreshTick: 0 },
];

// P12: NPC mount-family bootstrap. Two named baseline NPCs ship with an
// equipped mount-family instance so the ComplimentMount promenade tactic
// has meaningful partners from tick 0. Picks: Lord Blackwood (baseline NPC
// head — cultural fit for equestrian portrayal) and Miss Carrington
// (Romantic+Frivolous traits — fashionable mount ownership consistent with
// the trait gestalt). NPC mounts always equip — equippedFromStart flag is
// elided because there's no NPC unequipped-starting-artifact use case at v1.
// lastRefreshTick is derived from the bootstrap helper's `tick` parameter
// (always 0 on fresh state; save.tick on the live-load path).
export const NPC_STARTING_MOUNT_FAMILY: ReadonlyArray<{
  characterId: CharacterId;
  definitionId: ArtifactDefinitionId;
}> = [
  { characterId: "npc-blackwood" as CharacterId, definitionId: "mount" as ArtifactDefinitionId },
  { characterId: "npc-carrington" as CharacterId, definitionId: "mount" as ArtifactDefinitionId },
];

// P24b: per-family display-name banks for procedural artifact definitions.
// generateArtifactDefinitions (rules/proceduralArtifacts.ts) draws a name by
// index over the chosen family's bank. Distinct from the fixture displayNames
// above — these are the "lesser" period-flavored variants the procedural set
// scatters across houses.
export const PROCEDURAL_ARTIFACT_NAMES: Readonly<Record<ArtifactFamily, readonly string[]>> = {
  sapphires: [
    "The Ashby Emeralds",
    "The Wexford Rubies",
    "The Pendleton Pearls",
    "A Garnet Parure",
  ],
  tiara: ["The Hartwell Coronet", "A Diamond Aigrette", "The Sterne Diadem", "A Pearl Circlet"],
  snuffbox: ["An Enamelled Snuffbox", "A Tortoiseshell Box", "A Gilt Bonbonnière", "A Vinaigrette"],
  phaeton: ["A High-Perch Phaeton", "A Curricle", "A Barouche", "A Town Chariot"],
  mount: ["A Bay Hunter", "A Grey Hack", "A Matched Pair", "An Arab Mare"],
  "family-deed": ["A Yorkshire Holding", "A Cornish Estate", "A Fen Grant", "A Border Manor"],
  "ancestral-portrait": [
    "A Lely Portrait",
    "A Reynolds Canvas",
    "The Dowager's Likeness",
    "A Miniature",
  ],
};

// Deterministic ID factories. Each walks existing state to find the next
// per-definitionId / per-source counter, matching the P6 deterministic-id
// pattern (state-walk discipline).

// Format: `artifact-${definitionId}-${index}` where index counts existing
// instances with the same definitionId. Per-definitionId scope means each
// definition has its own 0-based counter (sapphires-0, snuffbox-0, mount-0
// at bootstrap; a second sapphires forgery would land at sapphires-1).
export function makeArtifactInstanceId(
  state: GameState,
  definitionId: ArtifactDefinitionId,
): ArtifactInstanceId {
  let index = 0;
  for (const inst of state.artifactInstances.values()) {
    if (inst.definitionId === definitionId) index += 1;
  }
  return `artifact-${definitionId}-${index}` as ArtifactInstanceId;
}

// Format: `forgery-${forgedArtifactInstanceId}-${index}` where index counts
// existing forgeries against the same target instance. At v1 always 0 (one
// forgery per instance), but the slot is robust to future flows.
export function makeForgeryId(
  state: GameState,
  forgedArtifactInstanceId: ArtifactInstanceId,
): ForgeryId {
  let index = 0;
  for (const f of state.forgeries.values()) {
    if (f.forgedArtifactInstanceId === forgedArtifactInstanceId) index += 1;
  }
  return `forgery-${forgedArtifactInstanceId}-${index}` as ForgeryId;
}

// Format: `thief-${targetedArtifactInstanceId}-${index}`.
export function makeThiefAttemptId(
  state: GameState,
  targetedArtifactInstanceId: ArtifactInstanceId,
): ThiefAttemptId {
  let index = 0;
  for (const t of state.thiefAttempts.values()) {
    if (t.targetedArtifactInstanceId === targetedArtifactInstanceId) index += 1;
  }
  return `thief-${targetedArtifactInstanceId}-${index}` as ThiefAttemptId;
}

// Re-exports for convenience (consumers tend to want both factory + types).
export type {
  ArtifactDefinitionId,
  ArtifactInstanceId,
  CharacterId,
  ForgeryId,
  ThiefAttemptId,
} from "../rng";
