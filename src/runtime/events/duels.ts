// P8: duel-resolved + grievance-resolved events. Published from the
// demandSatisfaction store-action wrapper AFTER the state mutation completes.
// P25 R3: publishDuelTransitions is a before/after diff helper that additionally
// covers duels minted+resolved inside a tick phase (rival DemandSatisfaction) —
// rides every tick-advancing wrapper EXCEPT runYearPass.

import type { DuelCasualty, DuelOutcome, GameState } from "../../game/entities";
import type { CharacterId, DuelId, GrievanceId, HouseId } from "../../game/rng";
import { EventBus } from "./bus";

export type DuelEvent =
  | {
      kind: "DuelInitiated";
      tick: number;
      duelId: DuelId;
      challengerCharacterId: CharacterId;
      defenderCharacterId: CharacterId;
    }
  | {
      kind: "DuelResolved";
      tick: number;
      duelId: DuelId;
      outcome: DuelOutcome;
      loserCasualty: DuelCasualty;
      exchangesElapsed: number;
    }
  | {
      kind: "GrievanceResolved";
      tick: number;
      grievanceId: GrievanceId;
      perpetratorHouseId: HouseId;
    };

export const duelBus = new EventBus<DuelEvent>();

// Locate the perpetrator house for a grievance id (walks all houses; v1 has
// <= a handful). Returns null if the grievance is absent (never expected for a
// resolved duel, but keeps the publish defensive).
function findPerpetratorHouseId(state: GameState, grievanceId: GrievanceId): HouseId | null {
  for (const house of state.houses.values()) {
    const g = house.grievances.find((x) => x.id === grievanceId);
    if (g !== undefined) return g.perpetratorHouseId;
  }
  return null;
}

// P25 R3: before/after diff for duels minted/resolved during tick phases (rival
// DemandSatisfaction). A rival duel is minted AND resolved within ONE phase, so
// the diff sees `absent → Resolved` (never a committed Active) — emit BOTH
// DuelInitiated and DuelResolved for it. demandSatisfaction (a free action) is
// disjoint from tick phases, so this introduces no double-publish.
export function publishDuelTransitions(before: GameState, after: GameState): void {
  for (const [id, afterDuel] of after.duels) {
    const beforeDuel = before.duels.get(id);
    if (beforeDuel === undefined) {
      duelBus.publish({
        kind: "DuelInitiated",
        tick: after.tick,
        duelId: id,
        challengerCharacterId: afterDuel.challengerCharacterId,
        defenderCharacterId: afterDuel.defenderCharacterId,
      });
    }
    const wasResolved = beforeDuel?.status === "Resolved";
    if (afterDuel.status === "Resolved" && !wasResolved && afterDuel.outcome !== null) {
      duelBus.publish({
        kind: "DuelResolved",
        tick: after.tick,
        duelId: id,
        outcome: afterDuel.outcome,
        loserCasualty: afterDuel.loserCasualty,
        exchangesElapsed: afterDuel.exchangesElapsed,
      });
      if (afterDuel.outcome !== "Stalemate") {
        const perpetratorHouseId = findPerpetratorHouseId(after, afterDuel.grievanceId);
        if (perpetratorHouseId !== null) {
          duelBus.publish({
            kind: "GrievanceResolved",
            tick: after.tick,
            grievanceId: afterDuel.grievanceId,
            perpetratorHouseId,
          });
        }
      }
    }
  }
}
