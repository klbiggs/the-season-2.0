// Canonical artifact registry per spec §3 line 553 + §4 line 553. Seven
// entries verbatim from the spec: sapphires, tiara, snuffbox, phaeton,
// mount, family-deed, ancestral-portrait. Procedural artifact generation
// (P16) extends this set later.
//
// Definitions are fixture-only (NOT in GameState). Each ArtifactInstance
// in state.artifactInstances references its definition by string ID; the
// registry is the lookup table.

import { z } from "zod";

import type { GameState } from "../entities";
import {
  type ArtifactInstanceId,
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

export const ArtifactDefinitionSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  family: z.enum(ARTIFACT_FAMILIES),
  reputationBonusWhileEquipped: z.number().int(),
  scandalRiskWhileEquipped: z.number().int().min(0),
  traitGrantsWhileEquipped: z.array(TraitIdSchema),
  forgeable: z.boolean(),
  forgeWealthCost: z.number().int().nonnegative(),
});
export type ArtifactDefinition = z.infer<typeof ArtifactDefinitionSchema>;

export const ARTIFACT_REGISTRY: ReadonlyMap<string, ArtifactDefinition> = new Map([
  [
    "sapphires",
    {
      id: "sapphires",
      displayName: "The Carrington Sapphires",
      family: "sapphires",
      reputationBonusWhileEquipped: 8,
      scandalRiskWhileEquipped: 1,
      traitGrantsWhileEquipped: [],
      forgeable: true,
      forgeWealthCost: 30,
    },
  ],
  [
    "tiara",
    {
      id: "tiara",
      displayName: "The Marlborough Tiara",
      family: "tiara",
      reputationBonusWhileEquipped: 10,
      scandalRiskWhileEquipped: 1,
      traitGrantsWhileEquipped: [],
      forgeable: true,
      forgeWealthCost: 40,
    },
  ],
  [
    "snuffbox",
    {
      id: "snuffbox",
      displayName: "The Imperial Snuffbox",
      family: "snuffbox",
      reputationBonusWhileEquipped: 4,
      scandalRiskWhileEquipped: 0,
      traitGrantsWhileEquipped: [],
      forgeable: true,
      forgeWealthCost: 15,
    },
  ],
  [
    "phaeton",
    {
      id: "phaeton",
      displayName: "The Crimson Phaeton",
      family: "phaeton",
      reputationBonusWhileEquipped: 6,
      scandalRiskWhileEquipped: 0,
      traitGrantsWhileEquipped: [],
      forgeable: false,
      forgeWealthCost: 0,
    },
  ],
  [
    "mount",
    {
      id: "mount",
      displayName: "Thoroughbred",
      family: "mount",
      reputationBonusWhileEquipped: 3,
      scandalRiskWhileEquipped: 0,
      traitGrantsWhileEquipped: [],
      forgeable: false,
      forgeWealthCost: 0,
    },
  ],
  [
    "family-deed",
    {
      id: "family-deed",
      displayName: "Norfolk Land Deed",
      family: "family-deed",
      reputationBonusWhileEquipped: 5,
      scandalRiskWhileEquipped: 0,
      traitGrantsWhileEquipped: [],
      forgeable: false,
      forgeWealthCost: 0,
    },
  ],
  [
    "ancestral-portrait",
    {
      id: "ancestral-portrait",
      displayName: "The Founder's Portrait",
      family: "ancestral-portrait",
      reputationBonusWhileEquipped: 5,
      scandalRiskWhileEquipped: 0,
      traitGrantsWhileEquipped: [],
      forgeable: false,
      forgeWealthCost: 0,
    },
  ],
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

// Player bootstrap inventory. Three instances on a fresh campaign; two
// start equipped on the player head. Deterministic via lex-sorted IDs.
// sapphires + snuffbox cover the wardrobe-refresh / forgery loop; mount lets
// P12's "compliment mount" tactic gate on player ownership immediately.
//
// lastRefreshTick is set to 0 at bootstrap (in-season for the first
// WARDROBE_REFRESH_INTERVAL_TICKS ticks).
export const PLAYER_STARTING_ARTIFACTS: ReadonlyArray<{
  definitionId: string;
  equippedFromStart: boolean;
  lastRefreshTick: number;
}> = [
  { definitionId: "sapphires", equippedFromStart: true, lastRefreshTick: 0 },
  { definitionId: "snuffbox", equippedFromStart: false, lastRefreshTick: 0 },
  { definitionId: "mount", equippedFromStart: true, lastRefreshTick: 0 },
];

// Deterministic ID factories. Each walks existing state to find the next
// per-definitionId / per-source counter, matching the P6 deterministic-id
// pattern (state-walk discipline).

// Format: `artifact-${definitionId}-${index}` where index counts existing
// instances with the same definitionId. Per-definitionId scope means each
// definition has its own 0-based counter (sapphires-0, snuffbox-0, mount-0
// at bootstrap; a second sapphires forgery would land at sapphires-1).
export function makeArtifactInstanceId(state: GameState, definitionId: string): ArtifactInstanceId {
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
export type { ArtifactInstanceId, CharacterId, ForgeryId, ThiefAttemptId } from "../rng";
