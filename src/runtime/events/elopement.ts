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
// Walks before/after state.elopement for null↔non-null transitions:
//   - null → non-null  → publish ElopementStarted (sprint mounted by
//                        applySchemeResolutionPhase's discovery branch).
//   - non-null → null  → publish ElopementResolved (terminal resolve OR
//                        pruneOrphanedConversationKeys branch 5 death cascade).
//
// Wrapper-side dedup: sprint terminal-resolve actions (elopementPush /
// elopementFreshHorses / elopementSurrender) direct-publish ElopementResolved
// from their own wrappers. Those wrappers DO NOT call this diff helper
// (sprint actions don't advance ticks), so there is no overlap to dedup at v1.
//
// runYearPass is INTENTIONALLY EXCLUDED from the publisher list at v1 because
// the Q4 gate blocks runYearPass when state.elopement !== null, making the
// non-null → null transition unreachable through that path.
export function publishElopementTransitions(
  before: import("../../game/entities").GameState,
  after: import("../../game/entities").GameState,
): void {
  if (before.elopement === null && after.elopement !== null) {
    elopementBus.publish({
      kind: "ElopementStarted",
      tick: after.tick,
      schemeId: after.elopement.schemeId,
      elopingCharacterId: after.elopement.elopingCharacterId,
      targetCharacterId: after.elopement.targetCharacterId,
    });
    return;
  }
  if (before.elopement !== null && after.elopement === null) {
    // Compute deltas by comparing the player house state across before/after.
    const playerBefore = before.houses.get("player" as import("../../game/rng").HouseId);
    const playerAfter = after.houses.get("player" as import("../../game/rng").HouseId);
    const repDelta =
      playerBefore !== undefined && playerAfter !== undefined
        ? playerAfter.reputation - playerBefore.reputation
        : 0;
    const scandalDelta =
      playerBefore !== undefined && playerAfter !== undefined
        ? playerAfter.scandal - playerBefore.scandal
        : 0;
    // Win-vs-Lost discriminator: a Won outcome applies rep-halve (repDelta < 0),
    // a Lost outcome applies +50 scandal (scandalDelta > 0).
    const outcome: "Won" | "Lost" = repDelta < 0 ? "Won" : "Lost";
    // Marriage-minted iff state.marriages grew across the transition AND the
    // new marriage carries viaElopement: true. The cheap heuristic is to walk
    // the after.marriages and find an entry with viaElopement && marriedAtTick
    // === after.tick — only one such entry can land per tick at v1.
    let marriageMinted = false;
    for (const m of after.marriages.values()) {
      if (m.viaElopement && m.marriedAtTick === after.tick) {
        marriageMinted = true;
        break;
      }
    }
    elopementBus.publish({
      kind: "ElopementResolved",
      tick: after.tick,
      schemeId: before.elopement.schemeId,
      outcome,
      marriageMinted,
      reputationDelta: repDelta,
      scandalDelta,
    });
  }
}
