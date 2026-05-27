// P24b (E1): pure deterministic procedural artifact-DEFINITION generator.
// Consumes a transient RNG sub-stream (seeded `${campaignSeed}|procedural-artifacts`
// by the caller) with a FIXED PROCEDURAL_ARTIFACT_DRAWS_PER_DEF budget per
// definition — fixed regardless of branch so the draw count is part of the
// determinism contract. Runs on the bootstrap path; the generated definitions
// are PERSISTED in the save and re-read verbatim on load (never regenerated —
// no seed persists). Identical seed + count ⇒ byte-identical definitions.

import {
  PROCEDURAL_ARTIFACT_FORGEABLE_PCT,
  PROCEDURAL_ARTIFACT_FORGE_COST_MAX,
  PROCEDURAL_ARTIFACT_FORGE_COST_MIN,
  PROCEDURAL_ARTIFACT_REP_MAX,
  PROCEDURAL_ARTIFACT_REP_MIN,
  PROCEDURAL_ARTIFACT_SCANDAL_MAX,
  PROCEDURAL_ARTIFACT_TRAIT_POOL,
} from "../constants";
import {
  ARTIFACT_FAMILIES,
  type ArtifactDefinition,
  PROCEDURAL_ARTIFACT_NAMES,
} from "../fixtures/artifacts";
import { type ArtifactDefinitionId, type RngState, type TraitId, drawInt } from "../rng";

// Shared id convention. `proc-artifact-<i>`; the resolver distinguishes these
// from the fixed ARTIFACT_REGISTRY keys by membership, not by prefix.
export const PROCEDURAL_ARTIFACT_ID_PREFIX = "proc-artifact-";

function buildProceduralArtifactDefinition(
  rngState: RngState,
  index: number,
): { definition: ArtifactDefinition; rngState: RngState } {
  let rng = rngState;

  // Draw 1: family.
  const familyPick = drawInt(rng, ARTIFACT_FAMILIES.length);
  rng = familyPick.rngState;
  const family = ARTIFACT_FAMILIES[familyPick.next] as (typeof ARTIFACT_FAMILIES)[number];

  // Draw 2: display name (per-family bank).
  const nameBank = PROCEDURAL_ARTIFACT_NAMES[family];
  const namePick = drawInt(rng, nameBank.length);
  rng = namePick.rngState;
  const displayName = nameBank[namePick.next] as string;

  // Draw 3: reputation bonus in [REP_MIN, REP_MAX].
  const repPick = drawInt(rng, PROCEDURAL_ARTIFACT_REP_MAX - PROCEDURAL_ARTIFACT_REP_MIN + 1);
  rng = repPick.rngState;
  const reputationBonusWhileEquipped = repPick.next + PROCEDURAL_ARTIFACT_REP_MIN;

  // Draw 4: scandal risk in [0, SCANDAL_MAX].
  const scandalPick = drawInt(rng, PROCEDURAL_ARTIFACT_SCANDAL_MAX + 1);
  rng = scandalPick.rngState;
  const scandalRiskWhileEquipped = scandalPick.next;

  // Draw 5: 0-1 trait grant. Index into [none, ...pool]; 0 ⇒ no grant.
  const traitPick = drawInt(rng, PROCEDURAL_ARTIFACT_TRAIT_POOL.length + 1);
  rng = traitPick.rngState;
  const traitGrantsWhileEquipped: TraitId[] =
    traitPick.next === 0 ? [] : [PROCEDURAL_ARTIFACT_TRAIT_POOL[traitPick.next - 1] as TraitId];

  // Draw 6: forgeable gate.
  const forgeablePick = drawInt(rng, 100);
  rng = forgeablePick.rngState;
  const forgeable = forgeablePick.next < PROCEDURAL_ARTIFACT_FORGEABLE_PCT;

  // Draw 7: forge cost in [COST_MIN, COST_MAX]. ALWAYS drawn (fixed budget);
  // used only when forgeable — non-forgeable defs carry cost 0 to satisfy the
  // ArtifactDefinition forgeable⇔cost coherence invariant.
  const costPick = drawInt(
    rng,
    PROCEDURAL_ARTIFACT_FORGE_COST_MAX - PROCEDURAL_ARTIFACT_FORGE_COST_MIN + 1,
  );
  rng = costPick.rngState;
  const forgeWealthCost = forgeable ? costPick.next + PROCEDURAL_ARTIFACT_FORGE_COST_MIN : 0;

  const id = `${PROCEDURAL_ARTIFACT_ID_PREFIX}${index}` as ArtifactDefinitionId;
  const definition: ArtifactDefinition = {
    id,
    displayName,
    family,
    reputationBonusWhileEquipped,
    scandalRiskWhileEquipped,
    traitGrantsWhileEquipped,
    forgeable,
    forgeWealthCost,
  };
  return { definition, rngState: rng };
}

export function generateArtifactDefinitions(
  rngState: RngState,
  count: number,
): { definitions: ArtifactDefinition[]; rngState: RngState } {
  let rng = rngState;
  const definitions: ArtifactDefinition[] = [];
  for (let i = 0; i < count; i++) {
    const built = buildProceduralArtifactDefinition(rng, i);
    definitions.push(built.definition);
    rng = built.rngState;
  }
  return { definitions, rngState: rng };
}
