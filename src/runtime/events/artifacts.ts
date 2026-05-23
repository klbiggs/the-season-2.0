// P10 artifact bus partition. Per CLAUDE.md non-negotiable §9 (no god files;
// events partitioned by domain) and the P9 elopementBus per-domain precedent.
//
// Four variants cover the artifact loop lifecycle:
//
//   ForgeryCreated     — direct-publish from commissionForgery wrapper.
//                        The diff helper does NOT cover this (commission is a
//                        free action that never runs inside tick-advancing
//                        phases, so a before/after diff at tick boundary
//                        wouldn't catch it).
//   ForgerySurfaced    — diff-helper from applyForgerySurfacingPhase
//                        (roll-driven) OR direct-publish from
//                        applySchemeResolutionPhase Treason Framing branch
//                        (consumption-driven). The `viaConsumption` field
//                        discriminates the two paths.
//   ThiefNoticeFired   — diff-helper from applyThiefNoticePhase when a new
//                        in-flight attempt is created.
//   TheftResolved      — diff-helper from applyThiefNoticePhase's
//                        auto-resolve sweep OR direct-publish from
//                        applyThwartTheftPure's wrapper.

import type { ArtifactInstanceId, CharacterId, ForgeryId, ThiefAttemptId } from "../../game/rng";
import { EventBus } from "./bus";

export type ArtifactEvent =
  | {
      kind: "ForgeryCreated";
      tick: number;
      forgeryId: ForgeryId;
      forgerCharacterId: CharacterId;
    }
  | {
      kind: "ForgerySurfaced";
      tick: number;
      forgeryId: ForgeryId;
      // true ⇔ Treason Framing flipped it; false ⇔ surfacing roll fired.
      viaConsumption: boolean;
    }
  | {
      kind: "ThiefNoticeFired";
      tick: number;
      thiefAttemptId: ThiefAttemptId;
      targetedArtifactInstanceId: ArtifactInstanceId;
    }
  | {
      kind: "TheftResolved";
      tick: number;
      thiefAttemptId: ThiefAttemptId;
      outcome: "Thwarted" | "Stolen" | "AutoThwarted";
    };

export const artifactBus = new EventBus<ArtifactEvent>();

// Diff helper covering the 3 tick-phase transitions. ForgeryCreated is NOT
// covered (direct-publish only — commission is a free action; the diff would
// fire spuriously every tick that the player commissions, but free actions
// fire OUTSIDE tick-advance so the diff wouldn't catch them anyway).
//
// Wired into the 6 tick-advancing wrappers (advanceTick + 4 P3 wrappers +
// proposeMarriage). runYearPass deliberately SKIPS — year-pass STEPS doesn't
// include applyForgerySurfacingPhase or applyThiefNoticePhase, so the diff
// would emit zero events.
import type { GameState } from "../../game/entities";

export function publishArtifactTransitions(before: GameState, after: GameState): void {
  // ForgerySurfaced: false → true on existing forgeries.
  for (const [id, afterForgery] of after.forgeries) {
    if (!afterForgery.surfaced) continue;
    const beforeForgery = before.forgeries.get(id);
    if (beforeForgery?.surfaced) continue;
    artifactBus.publish({
      kind: "ForgerySurfaced",
      tick: after.tick,
      forgeryId: id,
      // viaConsumption: false from diff path (roll-driven).
      // Treason Framing resolution direct-publishes with viaConsumption: true.
      viaConsumption: false,
    });
  }
  // ThiefNoticeFired: new in-flight attempts (thwarted: null) not present in `before`.
  for (const [id, afterAttempt] of after.thiefAttempts) {
    if (before.thiefAttempts.has(id)) continue;
    if (afterAttempt.thwarted !== null) continue;
    artifactBus.publish({
      kind: "ThiefNoticeFired",
      tick: after.tick,
      thiefAttemptId: id,
      targetedArtifactInstanceId: afterAttempt.targetedArtifactInstanceId,
    });
  }
  // TheftResolved: in-flight (thwarted: null) → resolved (thwarted: boolean).
  for (const [id, afterAttempt] of after.thiefAttempts) {
    const beforeAttempt = before.thiefAttempts.get(id);
    if (beforeAttempt === undefined) continue;
    if (beforeAttempt.thwarted !== null) continue;
    if (afterAttempt.thwarted === null) continue;
    artifactBus.publish({
      kind: "TheftResolved",
      tick: after.tick,
      thiefAttemptId: id,
      outcome: afterAttempt.thwarted ? "AutoThwarted" : "Stolen",
    });
  }
}
