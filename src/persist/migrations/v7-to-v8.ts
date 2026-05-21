// Pure idempotent v7 → v8 migration. Adds 7 new Character fields (happiness,
// temptationHookUnlocked, assignedTutorCharacterId, tutorBonusTraitGranted,
// dullSpouseExposureStartTick, parentCharacterIds, gender) and 3 new top-
// level Maps (proposalsLog, tutorAssignmentsLog, pendingTutorTraitChoices).
//
// Composition follows the P4/P5/P6 Bare+wrap precedent:
//   migrate_v7_to_v8 = toSaveV8 ∘ fromSaveV7Bare
//
// fromSaveV7Bare's lift step calls liftLegacyCharactersFromV8Pre which
// defaults the 7 V8 character fields per character (gender derived from
// hashCharIdToGender(id) so the migration agrees with the fresh-state
// bootstrap path). The 3 new top-level Maps default to empty.
//
// Draw budget: ZERO. Gender is derived via a deterministic non-PRNG hash;
// the migration does not consume any per-house RNG calls. The hash
// algorithm is FROZEN — a future migration that changes it MUST bump past
// v8 and re-derive deterministically.
//
// Pre-P7 unwed adult characters in legacy V7 saves stay role: "Dependent"
// post-migration — the migration does NOT retroactively run maturation
// (per §10 Q4 trigger-walk: classification fires only at succession + child
// maturation). Spinster/Bohemian/Exile classifier paths remain accessible
// only via mid-campaign child maturation post-load.

import { type SaveV7, type SaveV8, fromSaveV7Bare, toSaveV8 } from "../schema";

export function migrate_v7_to_v8(save: SaveV7): SaveV8 {
  const bare = fromSaveV7Bare(save);
  // No additional seed helpers — fromSaveV7Bare's
  // liftLegacyCharactersFromV8Pre already defaults the 7 V8 character fields,
  // and the 3 new top-level Maps default to empty in the Bare core.
  return toSaveV8(bare);
}
