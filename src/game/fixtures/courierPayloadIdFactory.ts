// P6: deterministic CourierPayloadId factory. Couriers participate in the
// hash projection; UUID-based ids would break the replay-harness 30-run
// stability NFR. Format: `courier:${originHouseId}:${tick}:${index}` where
// `index` is the count of existing couriers at this tick with this origin.
//
// Partitioned by (origin, tick) — two same-tick couriers from the same
// origin get index 0 and 1; same-tick couriers from different origins each
// get index 0. The whisperId field on the courier disambiguates payloads
// when multiple staff cadences fire on the same tick.

import type { GameState } from "../entities";
import type { CourierPayloadId, HouseId } from "../rng";

export function makeCourierPayloadId(state: GameState, originHouseId: HouseId): CourierPayloadId {
  let index = 0;
  for (const c of state.couriers.values()) {
    if (c.originHouseId === originHouseId && c.originTick === state.tick) {
      index += 1;
    }
  }
  return `courier:${originHouseId}:${state.tick}:${index}` as CourierPayloadId;
}
