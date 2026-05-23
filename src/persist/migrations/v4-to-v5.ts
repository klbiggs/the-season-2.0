// Pure idempotent v4 → v5 migration. Bumps to the P4 live format:
//   - Adds conversationHistory + affectionMap (empty Maps)
//   - Adds composure + maxComposure to each Character (default 100)
//   - Seeds the Independent house + 5 baseline NPCs + Independent RNG entry
//     (these did not exist in V4 saves — Independent is a P4 introduction)
//
// Body: compose-with-helper-then-reserialize pattern.
//   fromSaveV4 deserializes V4 AND seeds Independent via
//   seedIndependentIntoLegacyState (idempotent), then toSaveV5
//   re-serializes as V5 tuple arrays.
//
// Draw budget: ZERO. NPC deathAges are constants from the BASELINE_NPCS
// fixture; Independent's RNG seed is deterministically derived from the
// player seed via `${playerSeed}|independent`.

// P10: switched from `fromSaveV4` (public wrap) to `fromSaveV4Bare` + inline
// seeders. The public wrap calls `bootstrapPlayerArtifactsForMigration`
// (added at P10) which contaminates the migration chain — if migrate_v4_to_v5
// seeded artifact ids on the player head's `equippedArtifactIds`, those would
// flow through every subsequent migration (V5..V10) and break the V10 load
// path's idempotence guard (which sees a populated equippedArtifactIds and
// SKIPS the bootstrap, leaving artifactInstances Map empty — invariant
// violation). Using the Bare half here keeps the chain bootstrap-free until
// the final FROM load.
import {
  type SaveV4,
  type SaveV5,
  fromSaveV4Bare,
  seedIndependentIntoLegacyState,
  seedRivalsAndPatronessesIntoLegacyState,
  seedSchemesAndGrievancesIntoLegacyState,
  seedWhispersCouriersStaffIntoLegacyState,
  toSaveV5,
} from "../schema";

function extractPlayerSeed(save: SaveV4): string {
  const entry = save.rng.find(([id]) => id === "player");
  if (entry === undefined) throw new Error("migrate_v4_to_v5: save.rng has no player entry");
  return entry[1].seed;
}

export function migrate_v4_to_v5(save: SaveV4): SaveV5 {
  const playerSeed = extractPlayerSeed(save);
  const lifted = seedRivalsAndPatronessesIntoLegacyState(
    seedWhispersCouriersStaffIntoLegacyState(
      seedSchemesAndGrievancesIntoLegacyState(
        seedIndependentIntoLegacyState(fromSaveV4Bare(save), playerSeed),
      ),
    ),
    playerSeed,
  );
  return toSaveV5({ ...lifted, elopement: null });
}
