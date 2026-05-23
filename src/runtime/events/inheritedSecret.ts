// P11 inherited-secret + blood-feud bus partition (co-located per-domain).
// Variants cover both subsystems' lifecycle moments.
//
// Inherited-secret events:
//   InheritedSecretAccumulated — fires when accumulateInheritedSecretsAtSuccession
//                                 copies a Verified/Weaponized whisper into the
//                                 player house's ledger.
//   InheritedSecretEvicted     — fires when push-past-MAX_INHERITED_SECRETS
//                                 collapses the oldest entry into ancestorSummary.
//   InheritedSecretSurfaced    — fires when applyInheritedSecretSurfacingPhase
//                                 flips surfacedAgainstHouseId from null.
//
// Blood-feud events:
//   BloodFeudOpened   — fires when surfacing mints a new BloodFeud (+ paired
//                       casus-belli Grievance).
//   BloodFeudResolved — fires when `resolved` flips true via duel resolution
//                       (DuelWin / DuelLoss) OR generational decay.

import type { BloodFeud } from "../../game/entities";
import type { BloodFeudId, HouseId, InheritedSecretId, WhisperId } from "../../game/rng";
import { PLAYER_HOUSE_ID } from "../../game/rng";
import type { GameState } from "../../game/store";
import { EventBus } from "./bus";

export type InheritedSecretEvent =
  | {
      kind: "InheritedSecretAccumulated";
      tick: number;
      secretId: InheritedSecretId;
      sourceWhisperId: WhisperId;
    }
  | {
      kind: "InheritedSecretEvicted";
      tick: number;
      secretId: InheritedSecretId;
      collapsedIntoAncestorSummary: string;
    }
  | {
      kind: "InheritedSecretSurfaced";
      tick: number;
      secretId: InheritedSecretId;
      againstHouseId: HouseId;
    };

export type BloodFeudEvent =
  | {
      kind: "BloodFeudOpened";
      tick: number;
      feudId: BloodFeudId;
      offendingHouseId: HouseId;
      triggeringSecretId: InheritedSecretId;
    }
  | {
      kind: "BloodFeudResolved";
      tick: number;
      feudId: BloodFeudId;
      resolutionKind: Exclude<BloodFeud["resolutionKind"], null>;
    };

export const inheritedSecretBus = new EventBus<InheritedSecretEvent>();
export const bloodFeudBus = new EventBus<BloodFeudEvent>();

// Diff helper for InheritedSecretEvent. Walks player house's ledger before/after.
export function publishInheritedSecretTransitions(before: GameState, after: GameState): void {
  const beforeHouse = before.houses.get(PLAYER_HOUSE_ID);
  const afterHouse = after.houses.get(PLAYER_HOUSE_ID);
  if (afterHouse === undefined) return;

  const beforeById = new Map((beforeHouse?.inheritedSecrets ?? []).map((s) => [s.id, s] as const));

  for (const s of afterHouse.inheritedSecrets) {
    const prior = beforeById.get(s.id);
    if (prior === undefined) {
      inheritedSecretBus.publish({
        kind: "InheritedSecretAccumulated",
        tick: after.tick,
        secretId: s.id,
        sourceWhisperId: s.sourceWhisperId,
      });
      continue;
    }
    if (prior.surfacedAgainstHouseId === null && s.surfacedAgainstHouseId !== null) {
      inheritedSecretBus.publish({
        kind: "InheritedSecretSurfaced",
        tick: after.tick,
        secretId: s.id,
        againstHouseId: s.surfacedAgainstHouseId,
      });
    }
  }

  // Evictions: entries present in before but absent in after.
  const afterIds = new Set(afterHouse.inheritedSecrets.map((s) => s.id));
  for (const [id, prior] of beforeById) {
    if (afterIds.has(id)) continue;
    inheritedSecretBus.publish({
      kind: "InheritedSecretEvicted",
      tick: after.tick,
      secretId: id,
      collapsedIntoAncestorSummary: `Generation ${prior.originatingGenerationCount} inherited secret: ${prior.description}`,
    });
  }
}

const EMPTY_KEYS_BF: ReadonlySet<string> = new Set();

// Diff helper for BloodFeudEvent. Walks player house's bloodFeuds before/after.
// wrapperPublishedKeys reserved for future direct-publish callers.
export function publishBloodFeudTransitions(
  before: GameState,
  after: GameState,
  wrapperPublishedKeys: ReadonlySet<string> = EMPTY_KEYS_BF,
): void {
  const beforeHouse = before.houses.get(PLAYER_HOUSE_ID);
  const afterHouse = after.houses.get(PLAYER_HOUSE_ID);
  if (afterHouse === undefined) return;

  const beforeById = new Map((beforeHouse?.bloodFeuds ?? []).map((bf) => [bf.id, bf] as const));

  for (const bf of afterHouse.bloodFeuds) {
    const prior = beforeById.get(bf.id);
    if (prior === undefined) {
      if (wrapperPublishedKeys.has(`opened:${bf.id}`)) continue;
      bloodFeudBus.publish({
        kind: "BloodFeudOpened",
        tick: after.tick,
        feudId: bf.id,
        offendingHouseId: bf.offendingHouseId,
        triggeringSecretId: bf.triggeringSecretId,
      });
      continue;
    }
    if (!prior.resolved && bf.resolved && bf.resolutionKind !== null) {
      if (wrapperPublishedKeys.has(`resolved:${bf.id}`)) continue;
      bloodFeudBus.publish({
        kind: "BloodFeudResolved",
        tick: after.tick,
        feudId: bf.id,
        resolutionKind: bf.resolutionKind,
      });
    }
  }
}
