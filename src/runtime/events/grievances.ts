// P25 R4: player-diplomacy event partition (per CLAUDE.md non-negotiable §9).
// Non-duel grievance resolution + rival-relations actions split into their own
// bus (the P8 pin: "future v1.5 paths that resolve grievances outside duels
// would split into their own publisher"). All three are FREE actions —
// direct-published from their store wrappers, never via a diff helper.

import type { GrievanceId, HouseId } from "../../game/rng";
import { EventBus } from "./bus";

export type GrievanceEvent =
  | {
      kind: "GrievanceWithdrawn";
      tick: number;
      grievanceId: GrievanceId;
      perpetratorHouseId: HouseId;
    }
  | {
      kind: "OliveBranchExtended";
      tick: number;
      rivalHouseId: HouseId;
    }
  | {
      kind: "WarDeclared";
      tick: number;
      rivalHouseId: HouseId;
    };

export const grievancesBus = new EventBus<GrievanceEvent>();
