// P8: rival-action / hostility / faction-tension events. Published from
// applyRivalActionPhase + applyAudience + relevant store actions AFTER the
// state mutation completes.

import type { RivalActionKind } from "../../game/constants";
import type { FactionPairKey, HouseId } from "../../game/rng";
import { EventBus } from "./bus";

export type RivalEvent =
  | {
      kind: "RivalActionFired";
      tick: number;
      rivalHouseId: HouseId;
      action: RivalActionKind;
    }
  | {
      kind: "RivalHostilityChanged";
      tick: number;
      rivalHouseId: HouseId;
      previous: number;
      next: number;
    }
  | {
      kind: "FactionTensionChanged";
      tick: number;
      pairKey: FactionPairKey;
      previous: number;
      next: number;
    };

export const rivalBus = new EventBus<RivalEvent>();
