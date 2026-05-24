// P13 globalEvent bus partition. Per CLAUDE.md non-negotiable §9 ("events
// partitioned by domain"). Variants cover era transition + per-event lifecycle
// (start / expire) + the courier-research direct-publish.
//
// EraTransitioned — fires when state.era flips Earlier → Later (one-shot at
//   tick === ERA_TRANSITION_TICK, via applyGlobalEventPhase).
// GlobalEventStarted — fires when a new event spawns (5%/tick trigger roll;
//   duplicate-kind skips never spawn).
// GlobalEventExpired — fires when an event drops at its endTick (after the
//   final per-tick effect application).
// CourierResearchUnlocked — direct-published by researchFastCouriers store
//   wrapper on success. Free action; never emits via diff helper.

import type { GlobalEvent } from "../../game/entities";
import type { GlobalEventId, HouseId } from "../../game/rng";
import type { GlobalEventKind } from "../../game/rules/globalEvents";
import type { GameState } from "../../game/store";
import { EventBus } from "./bus";

export type GlobalEventVariant =
  | {
      kind: "EraTransitioned";
      tick: number;
      from: "Earlier";
      to: "Later";
    }
  | {
      kind: "GlobalEventStarted";
      tick: number;
      event: GlobalEvent;
    }
  | {
      kind: "GlobalEventExpired";
      tick: number;
      eventId: GlobalEventId;
      eventKind: GlobalEventKind;
    }
  | {
      kind: "CourierResearchUnlocked";
      tick: number;
      houseId: HouseId;
    };

export const globalEventBus = new EventBus<GlobalEventVariant>();

// Diff helper. Rides on every tick-advancing store wrapper EXCEPT runYearPass
// (year-pass STEPS does not include applyGlobalEventPhase, so the diff would
// emit zero events). Per CLAUDE.md "11/11/9 publisher set" pin (P13 widens
// the P11 10/10/9 baseline).
//
export function publishGlobalEventTransitions(before: GameState, after: GameState): void {
  // Era transition (one-shot Earlier → Later).
  if (before.era === "Earlier" && after.era === "Later") {
    globalEventBus.publish({
      kind: "EraTransitioned",
      tick: after.tick,
      from: "Earlier",
      to: "Later",
    });
  }
  // New events spawned this tick.
  for (const [id, event] of after.globalEvents) {
    if (!before.globalEvents.has(id)) {
      globalEventBus.publish({
        kind: "GlobalEventStarted",
        tick: after.tick,
        event,
      });
    }
  }
  // Events expired this tick.
  for (const [id, event] of before.globalEvents) {
    if (!after.globalEvents.has(id)) {
      globalEventBus.publish({
        kind: "GlobalEventExpired",
        tick: after.tick,
        eventId: id,
        eventKind: event.kind,
      });
    }
  }
}
