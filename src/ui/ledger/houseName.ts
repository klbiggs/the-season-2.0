// P14: house display-name resolver for ledger tabs. The House entity carries
// no displayName field — rival names live in the fixture, and the player /
// Independent houses are named by convention. Shared by GrievancesTab (rival
// perpetrators) and RivalsTab.

import { RIVAL_HOUSES_FIXTURE } from "../../game/fixtures/rivals";
import { type HouseId, INDEPENDENT_HOUSE_ID, PLAYER_HOUSE_ID } from "../../game/rng.seeds";

const RIVAL_NAME_BY_ID = new Map<HouseId, string>(
  RIVAL_HOUSES_FIXTURE.map((r) => [r.houseId, r.displayName]),
);

export function houseDisplayName(houseId: HouseId): string {
  if (houseId === PLAYER_HOUSE_ID) return "Your House";
  if (houseId === INDEPENDENT_HOUSE_ID) return "The Independent House";
  return RIVAL_NAME_BY_ID.get(houseId) ?? houseId;
}
