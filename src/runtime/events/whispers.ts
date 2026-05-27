// P6: whisper + courier + staff event bus. Typed-event discriminated union;
// single bus for the entire espionage domain (whisper transitions, courier
// lifecycle, staff bribery/reassignment, the exile-blocked debug-trace).
//
// Publisher discipline (per CLAUDE.md non-negotiable §9):
// - Player-action wrappers (weaponizeWhisper, dismissWhisper, assignStaff,
//   spymasterIntercept) publish their owned event directly AFTER `set`
//   returns, then call publishWhisperTransitions with a wrapperPublishedKeys
//   Set so the diff helper skips the wrapper-owned transition.
// - Tick-advancing wrappers (advanceTick, travel, requestAudience,
//   escapeBankruptcy, refreshWardrobe, runYearPass) call
//   publishWhisperTransitions with the default empty Set (3rd arg omitted)
//   so the diff helper publishes every transition it detects.
// - sendBallroomMessage also calls publishWhisperTransitions to emit
//   WhisperCreated for synergy/wallflower-bonus/LLM-additive whispers.

import type { StaffAssignment, WeaponizationBranch } from "../../game/constants";
import type { CourierPayload, GameState, StaffMember, Whisper } from "../../game/entities";
import type { CharacterId, CourierPayloadId, HouseId, StaffId, WhisperId } from "../../game/rng";
import { EventBus } from "./bus";

export type WhisperEvent =
  | {
      kind: "WhisperCreated";
      tick: number;
      whisperId: WhisperId;
      sourceCharacterId: CharacterId;
      subjectCharacterId: CharacterId;
      destinationHouseId: HouseId;
      llmGenerated: boolean;
    }
  | { kind: "WhisperArrived"; tick: number; whisperId: WhisperId; destinationHouseId: HouseId }
  | { kind: "WhisperVerified"; tick: number; whisperId: WhisperId }
  | {
      kind: "WhisperWeaponized";
      tick: number;
      whisperId: WhisperId;
      branch: WeaponizationBranch;
      subjectCharacterId: CharacterId;
      scandalSheetAttribution: boolean | null;
    }
  | { kind: "WhisperDismissed"; tick: number; whisperId: WhisperId }
  | { kind: "PlayerExiled"; tick: number; reason: "ScandalSheetAttribution"; whisperId: WhisperId }
  | {
      kind: "CourierDelivered";
      tick: number;
      courierId: CourierPayloadId;
      whisperId: WhisperId;
      destinationHouseId: HouseId;
    }
  | {
      kind: "CourierIntercepted";
      tick: number;
      courierId: CourierPayloadId;
      whisperId: WhisperId;
      source: "StaffInterceptMail" | "SpymasterAction";
    }
  | {
      kind: "StaffReassigned";
      tick: number;
      staffId: StaffId;
      from: StaffAssignment;
      to: StaffAssignment;
    }
  | { kind: "StaffBribed"; tick: number; staffId: StaffId }
  // P24c: staff-lifecycle events — direct-published from the hire/fire/promote
  // free actions (NOT part of the tick-advancing publisher set / diff helper).
  | { kind: "StaffHired"; tick: number; staffId: StaffId }
  | { kind: "StaffDismissed"; tick: number; staffId: StaffId }
  | { kind: "StaffPromoted"; tick: number; staffId: StaffId; characterId: CharacterId }
  | { kind: "PlayerExileBlocked"; tick: number; action: string };

export const whisperBus = new EventBus<WhisperEvent>();

// Shared empty Set so tick-advance callers don't allocate per call. Frozen
// only by the readonly type — the per-call allocation cost across a long
// campaign is the optimization motivation, not strict immutability.
const EMPTY_KEYS: ReadonlySet<string> = new Set();

// Diff helper — walks (a) after.whispers for new ids → WhisperCreated;
// (b) after.whispers for arrivedAtTick null→set → WhisperArrived;
// (c) after.whispers status transitions → WhisperVerified /
//     WhisperWeaponized (+ PlayerExiled if ScandalSheet attribution) /
//     WhisperDismissed, with wrapperPublishedKeys skip for wrapper-owned
//     transitions; (d) after.couriers status transitions → CourierDelivered /
//     CourierIntercepted; (e) after.staff assignment changes →
//     StaffReassigned / StaffBribed.
//
// Tick-advance callers omit the 3rd arg (defaults to EMPTY_KEYS — diff
// publishes every transition). Player-action wrappers pass non-empty Set
// like `new Set(["weaponize:" + whisperId])` so the matching transition is
// skipped (the wrapper publishes it directly).
export function publishWhisperTransitions(
  before: GameState,
  after: GameState,
  wrapperPublishedKeys: ReadonlySet<string> = EMPTY_KEYS,
): void {
  // (a) New whispers + (b) arrival + (c) status transitions
  for (const [id, afterW] of after.whispers) {
    const beforeW = before.whispers.get(id);
    if (beforeW === undefined) {
      // New whisper this tick
      whisperBus.publish({
        kind: "WhisperCreated",
        tick: after.tick,
        whisperId: id,
        sourceCharacterId: afterW.sourceCharacterId,
        subjectCharacterId: afterW.subjectCharacterId,
        destinationHouseId: afterW.destinationHouseId,
        llmGenerated: afterW.llmGenerated,
      });
      continue;
    }
    // Arrival transition
    if (beforeW.arrivedAtTick === null && afterW.arrivedAtTick !== null) {
      whisperBus.publish({
        kind: "WhisperArrived",
        tick: after.tick,
        whisperId: id,
        destinationHouseId: afterW.destinationHouseId,
      });
    }
    // Status transitions
    if (beforeW.status === afterW.status) continue;
    if (beforeW.status === "Unverified" && afterW.status === "Verified") {
      whisperBus.publish({ kind: "WhisperVerified", tick: after.tick, whisperId: id });
    } else if (afterW.status === "Weaponized") {
      // Wrapper-owned skip
      if (wrapperPublishedKeys.has(`weaponize:${id}`)) continue;
      publishWeaponizedTransition(after.tick, id, afterW);
    } else if (afterW.status === "Dismissed") {
      // Player-elected dismissal IS skipped; cascade-path Unverified→Dismissed
      // (death-cascade from pruneOrphanedConversationKeys) is NEVER skipped.
      if (wrapperPublishedKeys.has(`dismiss:${id}`)) continue;
      whisperBus.publish({ kind: "WhisperDismissed", tick: after.tick, whisperId: id });
    }
  }

  // (d) Courier transitions
  for (const [id, afterC] of after.couriers) {
    const beforeC = before.couriers.get(id);
    if (beforeC === undefined) continue; // new courier — no event variant at v1
    if (beforeC.status === afterC.status) continue;
    if (beforeC.status === "InFlight" && afterC.status === "Delivered") {
      whisperBus.publish({
        kind: "CourierDelivered",
        tick: after.tick,
        courierId: id,
        whisperId: afterC.whisperId,
        destinationHouseId: afterC.destinationHouseId,
      });
    } else if (beforeC.status === "InFlight" && afterC.status === "Intercepted") {
      // wrapperPublishedKeys "intercept:" tag denotes Spymaster player action.
      const source = wrapperPublishedKeys.has(`intercept:${id}`)
        ? "SpymasterAction"
        : "StaffInterceptMail";
      whisperBus.publish({
        kind: "CourierIntercepted",
        tick: after.tick,
        courierId: id,
        whisperId: afterC.whisperId,
        source,
      });
    }
  }

  // (e) Staff transitions
  for (const [id, afterS] of after.staff) {
    const beforeS = before.staff.get(id);
    if (beforeS === undefined) continue; // staff seeded only at fresh-state / migration
    if (beforeS.assignment === afterS.assignment) continue;
    if (afterS.assignment === "BribedByRival" && beforeS.assignment !== "BribedByRival") {
      whisperBus.publish({ kind: "StaffBribed", tick: after.tick, staffId: id });
    } else if (!wrapperPublishedKeys.has(`reassign:${id}`)) {
      whisperBus.publish({
        kind: "StaffReassigned",
        tick: after.tick,
        staffId: id,
        from: beforeS.assignment,
        to: afterS.assignment,
      });
    }
  }
}

function publishWeaponizedTransition(tick: number, id: WhisperId, w: Whisper): void {
  whisperBus.publish({
    kind: "WhisperWeaponized",
    tick,
    whisperId: id,
    branch: w.weaponizedAs ?? "Blackmail", // weaponizedAs non-null by status invariant
    subjectCharacterId: w.subjectCharacterId,
    scandalSheetAttribution: w.weaponizedAs === "ScandalSheet" ? w.scandalSheetAttribution : null,
  });
  if (w.weaponizedAs === "ScandalSheet" && w.scandalSheetAttribution === true) {
    whisperBus.publish({
      kind: "PlayerExiled",
      tick,
      reason: "ScandalSheetAttribution",
      whisperId: id,
    });
  }
}

// Type re-exports for store-action consumers (avoid re-import of unused types)
export type { Whisper, CourierPayload, StaffMember };
