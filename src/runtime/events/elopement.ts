// P9 elopement bus partition. Per CLAUDE.md non-negotiable §9 ("no god files;
// events partitioned by domain"). Variants cover the four lifecycle moments:
//
//   ElopementStarted   — fires when applySchemeResolutionPhase mounts a sprint
//                        on a discovered Seduction (diff helper: null → non-null).
//   ElopementProgressed — fires from the three sprint-action wrappers
//                        (elopementPush / elopementFreshHorses) — direct
//                        publish, not via diff helper. (Surrender is terminal,
//                        so it publishes ElopementResolved directly instead.)
//   ElopementResolved  — fires when state.elopement flips non-null → null
//                        (Won / Lost / Surrender all collapse to Won|Lost per
//                        spec §3 line 377). Carries marriageMinted + delta
//                        details for ledger consumption.
//   ElopementBlocked   — void-publish from advanceTick / runYearPass /
//                        proposeMarriage when state.elopement !== null gates
//                        the action. Debug-trace only; no live subscriber at
//                        P9 (P14 ledger / P17 telemetry will own subscription).
//
// Divergence from P6 PlayerExileBlocked precedent: that variant rides on
// whisperBus (cross-cutting); P9 ElopementBlocked rides on the per-domain
// elopementBus. Future modal-state Blocked events follow the P9 precedent
// (per-domain bus), not P6.

import type { CharacterId, SchemeId } from "../../game/rng";
import { EventBus } from "./bus";

export type ElopementEvent =
  | {
      kind: "ElopementStarted";
      tick: number;
      schemeId: SchemeId;
      elopingCharacterId: CharacterId;
      targetCharacterId: CharacterId;
    }
  | {
      kind: "ElopementProgressed";
      tick: number;
      schemeId: SchemeId;
      action: "Push" | "FreshHorses";
      playerTilePosition: number;
      fatherTilePosition: number;
      freshHorsesUsedCount: number;
    }
  | {
      kind: "ElopementResolved";
      tick: number;
      schemeId: SchemeId;
      outcome: "Won" | "Lost";
      marriageMinted: boolean;
      reputationDelta: number; // negative on Won; 0 on Lost
      scandalDelta: number; // 0 on Won; +50 on Lost
    }
  | {
      kind: "ElopementBlocked";
      tick: number;
      attemptedAction: "advanceTick" | "runYearPass" | "proposeMarriage";
    };

export const elopementBus = new EventBus<ElopementEvent>();

// Diff helper called from tick-advancing store wrappers AFTER `set` returns.
// P24a: elopements is a Map — the diff walks per-ElopementId transitions and
// publishes AT MOST one event per sprint (dedupe by id):
//   - id present in `after` but not `before`  → ElopementStarted (mount).
//   - sprint resolved in `after`, not in `before` (per its `resolved` flag)
//     → ElopementResolved (terminal resolve OR aging Branch-5 death cascade).
//
// The sprint carries its own `outcome` field, so Won/Lost is read directly (no
// rep/scandal-delta inference). Deltas are computed against the sprint's
// INITIATOR house (player for player sprints; rival/society for non-player).
//
// Wrapper-side dedup: the interactive sprint actions direct-publish
// ElopementResolved on terminal resolve and DO NOT advance ticks, so they don't
// also call this diff helper — no overlap. This helper now rides runYearPass too
// (society-initiated sprints can mount/resolve there now that non-player sprints
// don't block year-pass — the prior "runYearPass excluded" note no longer holds).
export function publishElopementTransitions(
  before: import("../../game/entities").GameState,
  after: import("../../game/entities").GameState,
): void {
  for (const [id, sprint] of after.elopements) {
    const prev = before.elopements.get(id);

    // New mount.
    if (prev === undefined) {
      elopementBus.publish({
        kind: "ElopementStarted",
        tick: after.tick,
        schemeId: sprint.schemeId,
        elopingCharacterId: sprint.elopingCharacterId,
        targetCharacterId: sprint.targetCharacterId,
      });
      continue;
    }

    // Resolution transition (unresolved → resolved).
    if (sprint.resolved && !prev.resolved) {
      const initBefore = before.houses.get(sprint.initiatorHouseId);
      const initAfter = after.houses.get(sprint.initiatorHouseId);
      const reputationDelta =
        initBefore !== undefined && initAfter !== undefined
          ? initAfter.reputation - initBefore.reputation
          : 0;
      const scandalDelta =
        initBefore !== undefined && initAfter !== undefined
          ? initAfter.scandal - initBefore.scandal
          : 0;
      // Marriage minted iff a viaElopement marriage between this sprint's two
      // parties landed this tick.
      let marriageMinted = false;
      for (const m of after.marriages.values()) {
        if (
          m.viaElopement &&
          m.marriedAtTick === after.tick &&
          ((m.spouseAId === sprint.elopingCharacterId &&
            m.spouseBId === sprint.targetCharacterId) ||
            (m.spouseBId === sprint.elopingCharacterId && m.spouseAId === sprint.targetCharacterId))
        ) {
          marriageMinted = true;
          break;
        }
      }
      elopementBus.publish({
        kind: "ElopementResolved",
        tick: after.tick,
        schemeId: sprint.schemeId,
        outcome: sprint.outcome ?? "Lost",
        marriageMinted,
        reputationDelta,
        scandalDelta,
      });
    }
  }
}
