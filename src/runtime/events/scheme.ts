// Scheme event bus + diff-publisher helpers. Per CLAUDE.md non-negotiable §9
// (typed event publishers, no god files): partitioned per domain.
//
// Publisher discipline (load-bearing):
// - `startScheme` wrapper publishes SchemeStarted directly.
// - `cancelScheme` wrapper publishes SchemeCancelled directly (single
//   scheme touched, known schemeId, no diff walk needed).
// - tick-advancing store wrappers (advanceTick, travel, requestAudience,
//   escapeBankruptcy, refreshWardrobe) call publishSchemeTransitions
//   AFTER `set` returns to detect Active→terminal transitions from
//   applySchemeResolutionPhase, plus grievance-array appends from Sabotage.
// - `sendBallroomMessage` wrapper publishes GrievanceRecorded directly
//   when a faux-pas grievance is appended (non-tick path).
// - `runYearPass` does NOT call publishSchemeTransitions —
//   runYearPassPure never mutates state.schemes or house.grievances.
// - `replaceState` does NOT publish — load-time atomic state swap; UIs
//   query state directly.

import type { GrievanceSource, SchemeKind } from "../../game/constants";
import type { GameState, Scheme } from "../../game/entities";
import type { CharacterId, GrievanceId, HouseId, SchemeId } from "../../game/rng";
import { EventBus } from "./bus";

// Discriminated union of failure-reason payloads on the bus. Distinct from
// the on-entity SchemeFailureReasonKind enum: the bus event carries
// kind-specific extra fields (e.g., targetId for TargetDiedDuringFlight).
export type SchemeFailureReasonPayload =
  | { kind: "TargetDiedDuringFlight"; targetId: CharacterId }
  | { kind: "EraFlippedDuringSmuggling" };

export type SchemeEvent =
  | {
      kind: "SchemeStarted";
      tick: number;
      schemeId: SchemeId;
      schemeKind: SchemeKind;
      ownerHouseId: HouseId;
      targetCharacterId: CharacterId | null;
      endsAtTick: number;
    }
  | {
      kind: "SchemeCancelled";
      tick: number;
      schemeId: SchemeId;
      schemeKind: SchemeKind;
      ownerHouseId: HouseId;
      targetCharacterId: CharacterId | null;
      cancelSource: "Player" | "Chaperone";
    }
  | {
      kind: "SchemeCompleted";
      tick: number;
      schemeId: SchemeId;
      schemeKind: SchemeKind;
      ownerHouseId: HouseId;
      targetCharacterId: CharacterId | null;
    }
  | {
      kind: "SchemeFailed";
      tick: number;
      schemeId: SchemeId;
      schemeKind: SchemeKind;
      ownerHouseId: HouseId;
      reason: SchemeFailureReasonPayload;
    }
  | {
      kind: "SeductionDiscovered";
      tick: number;
      schemeId: SchemeId;
      ownerHouseId: HouseId;
      targetCharacterId: CharacterId;
    }
  | {
      kind: "GrievanceRecorded";
      tick: number;
      grievanceId: GrievanceId;
      perpetratorHouseId: HouseId;
      victimHouseId: HouseId;
      source: GrievanceSource;
    };

export const schemeBus = new EventBus<SchemeEvent>();

// ── mapFailureReasonToPayload (private to this module) ───────────────────
// Maps the on-entity SchemeFailureReasonKind enum to the bus event's
// discriminated-union reason payload. Pure mapping; no state reads.
// Private to publishSchemeTransitions — do NOT call from cancel paths.
function mapFailureReasonToPayload(scheme: Scheme): SchemeFailureReasonPayload {
  switch (scheme.failureReason) {
    case "TargetDied":
      // Smuggling has no target, but Smuggling never lands here — its only
      // failure mode is EraFlipped.
      if (scheme.targetCharacterId === null) {
        throw new Error(
          `mapFailureReasonToPayload: TargetDied with null targetCharacterId on scheme ${scheme.id}`,
        );
      }
      return { kind: "TargetDiedDuringFlight", targetId: scheme.targetCharacterId };
    case "EraFlipped":
      // Defensive guard: EraFlipped is currently Smuggling-only at v1. A
      // future scheme kind adopting EraFlipped must extend this switch AND
      // the event variants.
      if (scheme.kind !== "Smuggling") {
        throw new Error(
          `mapFailureReasonToPayload: EraFlipped on non-Smuggling kind ${scheme.kind} — extend switch and event variants`,
        );
      }
      return { kind: "EraFlippedDuringSmuggling" };
    case "Discovered":
      throw new Error(
        "mapFailureReasonToPayload: Discovered fires SeductionDiscovered, not SchemeFailed",
      );
    case null:
      throw new Error(
        `mapFailureReasonToPayload: scheme ${scheme.id} has status=Failed but failureReason=null (state corruption)`,
      );
  }
}

// ── publishSchemeTransitions ─────────────────────────────────────────────
// Diff helper: walks before/after state.schemes for status transitions, and
// before/after house.grievances arrays for new appends. Called from every
// tick-advancing store-action wrapper AFTER set returns. Publishes:
//   - SchemeCompleted on Active→Completed
//   - SchemeCancelled on Active→Cancelled (Chaperone-driven only in tick-
//     advance path; cancelScheme publishes from its own wrapper directly)
//   - SchemeFailed on Active→Failed (TargetDied / EraFlipped)
//   - SeductionDiscovered on Active→Failed with kind=Seduction +
//     failureReason=Discovered (single-publish; NO SchemeFailed)
//   - GrievanceRecorded for each new grievance appended to any house
//
// New schemeIds in `after` (start path) are NOT handled here — start events
// publish from startScheme's wrapper directly.
export function publishSchemeTransitions(before: GameState, after: GameState): void {
  // (1) Walk scheme status transitions.
  for (const [id, afterScheme] of after.schemes) {
    const beforeScheme = before.schemes.get(id);
    if (beforeScheme === undefined) continue; // new-scheme; owned by startScheme wrapper
    if (beforeScheme.status !== "Active") continue; // already terminal
    if (afterScheme.status === "Active") continue; // no transition this tick

    switch (afterScheme.status) {
      case "Completed":
        schemeBus.publish({
          kind: "SchemeCompleted",
          tick: after.tick,
          schemeId: id,
          schemeKind: afterScheme.kind,
          ownerHouseId: afterScheme.ownerHouseId,
          targetCharacterId: afterScheme.targetCharacterId,
        });
        break;
      case "Cancelled":
        // Tick-advance path: only Chaperone-driven cancellations land here.
        // cancelScheme's wrapper publishes Player-source cancellations
        // directly (NOT through this diff helper).
        schemeBus.publish({
          kind: "SchemeCancelled",
          tick: after.tick,
          schemeId: id,
          schemeKind: afterScheme.kind,
          ownerHouseId: afterScheme.ownerHouseId,
          targetCharacterId: afterScheme.targetCharacterId,
          cancelSource: "Chaperone",
        });
        break;
      case "Failed":
        // failureReason is the discriminator. Seduction-Discovered fires
        // SeductionDiscovered (not SchemeFailed); other failure modes fire
        // SchemeFailed.
        if (afterScheme.kind === "Seduction" && afterScheme.failureReason === "Discovered") {
          // targetCharacterId is non-null by Seduction invariant.
          if (afterScheme.targetCharacterId === null) {
            throw new Error(`publishSchemeTransitions: Seduction ${id} has null targetCharacterId`);
          }
          schemeBus.publish({
            kind: "SeductionDiscovered",
            tick: after.tick,
            schemeId: id,
            ownerHouseId: afterScheme.ownerHouseId,
            targetCharacterId: afterScheme.targetCharacterId,
          });
        } else {
          schemeBus.publish({
            kind: "SchemeFailed",
            tick: after.tick,
            schemeId: id,
            schemeKind: afterScheme.kind,
            ownerHouseId: afterScheme.ownerHouseId,
            reason: mapFailureReasonToPayload(afterScheme),
          });
        }
        break;
    }
  }

  // (2) Walk grievance-array appends. House.grievances is hash-relevant in
  // insertion order; a new appended entry shows up at the END. Compare
  // lengths per house and emit GrievanceRecorded for each new suffix entry.
  for (const [houseId, afterHouse] of after.houses) {
    const beforeHouse = before.houses.get(houseId);
    const beforeLen = beforeHouse?.grievances.length ?? 0;
    for (let i = beforeLen; i < afterHouse.grievances.length; i++) {
      const newGrievance = afterHouse.grievances[i];
      if (newGrievance === undefined) continue;
      schemeBus.publish({
        kind: "GrievanceRecorded",
        tick: after.tick,
        grievanceId: newGrievance.id,
        perpetratorHouseId: newGrievance.perpetratorHouseId,
        victimHouseId: houseId,
        source: newGrievance.source,
      });
    }
  }
}
