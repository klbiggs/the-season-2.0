// P8: patroness favor / ball-veto events. Published from
// applyPatronessErosionPhase + checkBallVeto consumers (enterBallroom).

import type { PatronessId } from "../../game/rng";
import { EventBus } from "./bus";

export type PatronessEvent =
  | {
      kind: "PatronessFavorDropped";
      tick: number;
      patronessId: PatronessId;
      previous: number;
      next: number;
    }
  | {
      kind: "BallVetoTriggered";
      tick: number;
      vetoedBy: readonly PatronessId[];
    };

export const patronessBus = new EventBus<PatronessEvent>();
