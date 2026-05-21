// P8: duel-resolved + grievance-resolved events. Published from the
// demandSatisfaction store-action wrapper AFTER the state mutation completes.

import type { DuelCasualty, DuelOutcome } from "../../game/entities";
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
