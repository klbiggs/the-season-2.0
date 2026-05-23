// Player-elected location action events. Published from store actions
// (travel, requestAudience, escapeBankruptcy, refreshWardrobe) AFTER the
// store mutation completes. Subscribers (e.g., MapView toasts) render
// transient UI feedback in response.

import type { LocationId } from "../../game/fixtures/locations";
import type { HouseId } from "../../game/rng";
import type { EscapeRejection } from "../../game/rules/bankruptcyEscape";
import type { AudienceOutcome } from "../../game/rules/monarchsAudience";
import type { PromenadeEntryRejection } from "../../game/rules/promenade";
import type { TravelRejection } from "../../game/rules/travel";
import type { WardrobeRejection } from "../../game/rules/wardrobeRefresh";
import { EventBus } from "./bus";

export type LocationEvent =
  | { kind: "TraveledTo"; tick: number; houseId: HouseId; from: LocationId; to: LocationId }
  | {
      kind: "TravelRejected";
      tick: number;
      houseId: HouseId;
      target: LocationId;
      reason: TravelRejection;
    }
  | { kind: "RequestedAudience"; tick: number; houseId: HouseId; outcome: AudienceOutcome }
  | { kind: "EscapedBankruptcy"; tick: number; houseId: HouseId }
  | { kind: "BankruptcyEscapeRejected"; tick: number; houseId: HouseId; reason: EscapeRejection }
  | { kind: "RefreshedWardrobe"; tick: number; houseId: HouseId }
  | { kind: "WardrobeRefreshRejected"; tick: number; houseId: HouseId; reason: WardrobeRejection }
  // P12: published from the enterPromenade store wrapper on every non-ok branch.
  | {
      kind: "PromenadeEntryRejected";
      tick: number;
      houseId: HouseId;
      reason: PromenadeEntryRejection;
    };

// Singleton bus. Future phases (P4 conversation, P5 scheme) will add their
// own event modules; each gets its own bus or shares this one — TBD when
// P4 ships.
export const locationBus = new EventBus<LocationEvent>();
