// P24b (E1): procedural artifact-definition generator tests — determinism
// (≥30-run), draw-budget contract, field ranges, and forgeable⇔cost coherence.

import { describe, expect, it } from "vitest";
import {
  PROCEDURAL_ARTIFACT_DEF_COUNT,
  PROCEDURAL_ARTIFACT_DRAWS_PER_DEF,
  PROCEDURAL_ARTIFACT_FORGE_COST_MAX,
  PROCEDURAL_ARTIFACT_FORGE_COST_MIN,
  PROCEDURAL_ARTIFACT_REP_MAX,
  PROCEDURAL_ARTIFACT_REP_MIN,
  PROCEDURAL_ARTIFACT_SCANDAL_MAX,
} from "../constants";
import { ARTIFACT_FAMILIES } from "../fixtures/artifacts";
import { createRngState } from "../rng";
import { PROCEDURAL_ARTIFACT_ID_PREFIX, generateArtifactDefinitions } from "./proceduralArtifacts";

describe("generateArtifactDefinitions", () => {
  it("produces COUNT definitions with contiguous proc-artifact-<i> ids", () => {
    const { definitions } = generateArtifactDefinitions(
      createRngState("seed|procedural-artifacts"),
      PROCEDURAL_ARTIFACT_DEF_COUNT,
    );
    expect(definitions).toHaveLength(PROCEDURAL_ARTIFACT_DEF_COUNT);
    definitions.forEach((d, i) => {
      expect(d.id).toBe(`${PROCEDURAL_ARTIFACT_ID_PREFIX}${i}`);
    });
  });

  it("consumes exactly PROCEDURAL_ARTIFACT_DRAWS_PER_DEF draws per definition (budget contract)", () => {
    const start = createRngState("budget-seed");
    const { rngState } = generateArtifactDefinitions(start, PROCEDURAL_ARTIFACT_DEF_COUNT);
    expect(rngState.callCount - start.callCount).toBe(
      PROCEDURAL_ARTIFACT_DRAWS_PER_DEF * PROCEDURAL_ARTIFACT_DEF_COUNT,
    );
  });

  it("is deterministic across 30 runs of the same seed", () => {
    const run = () =>
      JSON.stringify(
        generateArtifactDefinitions(
          createRngState("determinism|seed"),
          PROCEDURAL_ARTIFACT_DEF_COUNT,
        ).definitions,
      );
    const baseline = run();
    for (let i = 0; i < 30; i++) {
      expect(run()).toBe(baseline);
    }
  });

  it("emits fields within their tuned ranges + forgeable⇔cost coherence", () => {
    const { definitions } = generateArtifactDefinitions(createRngState("ranges"), 200);
    for (const d of definitions) {
      expect(ARTIFACT_FAMILIES).toContain(d.family);
      expect(d.displayName.length).toBeGreaterThan(0);
      expect(d.reputationBonusWhileEquipped).toBeGreaterThanOrEqual(PROCEDURAL_ARTIFACT_REP_MIN);
      expect(d.reputationBonusWhileEquipped).toBeLessThanOrEqual(PROCEDURAL_ARTIFACT_REP_MAX);
      expect(d.scandalRiskWhileEquipped).toBeGreaterThanOrEqual(0);
      expect(d.scandalRiskWhileEquipped).toBeLessThanOrEqual(PROCEDURAL_ARTIFACT_SCANDAL_MAX);
      expect(d.traitGrantsWhileEquipped.length).toBeLessThanOrEqual(1);
      // Coherence invariant shared with ARTIFACT_REGISTRY: forgeable ⇔ cost > 0.
      if (d.forgeable) {
        expect(d.forgeWealthCost).toBeGreaterThanOrEqual(PROCEDURAL_ARTIFACT_FORGE_COST_MIN);
        expect(d.forgeWealthCost).toBeLessThanOrEqual(PROCEDURAL_ARTIFACT_FORGE_COST_MAX);
      } else {
        expect(d.forgeWealthCost).toBe(0);
      }
    }
  });
});
