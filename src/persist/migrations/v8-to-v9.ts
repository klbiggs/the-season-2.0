// Pure idempotent v8 → v9 migration. Adds 2 new House fields (hostility,
// factionId) + 1 new Grievance field (defendantCharacterId, nullable) + 4
// new top-level Maps (patronesses, rivalActors, factionTensions, duels).
//
// Composition follows the established Bare+wrap precedent:
//   migrate_v8_to_v9 = toSaveV9 ∘ seedRivalsAndPatronesses ∘ fromSaveV8Bare
//
// fromSaveV8Bare's lift step relies on Zod `.default()` backfills for the
// new House fields (hostility:0, factionId:"faction-crown") and the new
// Grievance field (defendantCharacterId:null). seedRivalsAndPatronesses
// seeds 3 rival houses + 9 associated characters + 3 per-rival RNG entries
// + 5 patronesses + 3 RivalActorState + 6 faction-tension entries (all 0)
// + empty duels Map from the canonical fixtures.
//
// Draw budget: ZERO. Per-rival RNG seeds derive deterministically from the
// player seed string (`${campaignSeed}|${rivalHouseId}` form, engine-stable
// over arithmetic alternatives). The migration does not consume any
// existing per-house RNG calls.
//
// Legacy V8 grievances were ALL player-perpetrated (verified at
// schemes.ts:Sabotage + store.ts:FauxPas — both set ownerHouseId =
// PLAYER_HOUSE_ID); their defendantCharacterId defaults to null, making
// them LegacyGrievanceUnactionable via demandSatisfaction. Only NEW
// post-P8 grievances (from rival-owned schemes) carry a non-null defendant
// and are duelable.

import {
  type SaveV8,
  type SaveV9,
  fromSaveV8Bare,
  seedRivalsAndPatronessesIntoLegacyState,
  toSaveV9,
} from "../schema";

function extractPlayerSeed(save: SaveV8): string {
  const entry = save.rng.find(([id]) => id === "player");
  if (entry === undefined) {
    throw new Error("migrate_v8_to_v9: save.rng has no player entry");
  }
  return entry[1].seed;
}

export function migrate_v8_to_v9(save: SaveV8): SaveV9 {
  const bare = fromSaveV8Bare(save);
  const playerSeed = extractPlayerSeed(save);
  const seeded = seedRivalsAndPatronessesIntoLegacyState(bare, playerSeed);
  return toSaveV9(seeded);
}
