// Pure idempotent v5 → v6 migration. Bumps to the P5 live format:
//   - Adds `schemes` top-level Map to GameState (empty Map default)
//   - Adds `grievances` array to every House (empty array default)
//
// Body: compose-with-helper-then-reserialize pattern.
//   fromSaveV5Bare deserializes V5 (without re-seeding Independent — V5
//   already has Independent by schema), then seedSchemesAndGrievancesIntoLegacyState
//   defaults schemes + per-house grievances, then toSaveV6 re-serializes as
//   V6 tuple arrays.
//
// Draw budget: ZERO. Every default is a literal constant.

// P10: switched from `fromSaveV5` (public wrap) to `fromSaveV5Bare` + inline
// seeders for the same reason as migrate_v4_to_v5 (avoid bootstrap
// contamination during the chain — see v4-to-v5.ts header).
import {
  type SaveV5,
  type SaveV6,
  fromSaveV5Bare,
  seedRivalsAndPatronessesIntoLegacyState,
  seedSchemesAndGrievancesIntoLegacyState,
  seedWhispersCouriersStaffIntoLegacyState,
  toSaveV6,
} from "../schema";

function extractPlayerSeed(save: SaveV5): string {
  const entry = save.rng.find(([id]) => id === "player");
  if (entry === undefined) throw new Error("migrate_v5_to_v6: save.rng has no player entry");
  return entry[1].seed;
}

export function migrate_v5_to_v6(save: SaveV5): SaveV6 {
  const playerSeed = extractPlayerSeed(save);
  const lifted = seedRivalsAndPatronessesIntoLegacyState(
    seedWhispersCouriersStaffIntoLegacyState(
      seedSchemesAndGrievancesIntoLegacyState(fromSaveV5Bare(save)),
    ),
    playerSeed,
  );
  return toSaveV6({ ...lifted, elopement: null });
}
