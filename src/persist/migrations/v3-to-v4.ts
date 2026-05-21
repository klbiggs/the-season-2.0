// Pure idempotent v3 → v4 migration. Adds GameState.era + 5 new House
// fields (currentLocation, consecutiveTicksAtCurrentLocation,
// lastAudienceTick, wardrobeLastRefreshTick, blockadeBypassEarned).
//
// Draw-budget: ZERO. All defaults are literal constants, never randomized.
// A future "procedurally place the player on a random starting location"
// change MUST bump past v4 — adding draws to a deployed migration silently
// breaks the parity invariant for every legacy save.
//
// Idempotence: pure (SaveV3) → SaveV4 mapping with no module-level mutation,
// no time-dependent reads, no RNG. The runner's per-step Zod parse deep-clones
// the result, so the input's nested arrays are never aliased into observable
// output state.

import type { FactionId } from "../../game/rng";
import type { SaveV3, SaveV4 } from "../schema";

export function migrate_v3_to_v4(save: SaveV3): SaveV4 {
  return {
    version: 4,
    tick: save.tick,
    rng: save.rng,
    houses: save.houses.map(([id, h]) => [
      id,
      {
        ...h,
        currentLocation: "Capital" as const,
        consecutiveTicksAtCurrentLocation: 0,
        lastAudienceTick: null,
        wardrobeLastRefreshTick: null,
        blockadeBypassEarned: false,
        // P6 transitional: SaveV4Schema's houses tuple uses HousePreV6Schema
        // (= HouseSchema.omit({grievances:true})). Post-P6 HouseSchema gains
        // `exiled`, so HousePreV6Schema now requires `exiled` too. Commit 2
        // introduces HousePreV7Schema and re-targets V4/V5/V6 schemas; until
        // then this default keeps the migration emitter passing Zod parse.
        exiled: false,
        // P8: new House fields. defaults match the bootstrap path for
        // player + Independent (no rivals at this migration step).
        hostility: 0,
        factionId: "faction-crown" as FactionId,
      },
    ]),
    characters: save.characters,
    marriages: save.marriages,
    campaignName: save.campaignName,
    era: "Earlier",
  };
}
