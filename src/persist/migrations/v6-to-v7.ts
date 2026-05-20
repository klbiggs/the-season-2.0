// Pure idempotent v6 → v7 migration. Adds GameState.whispers/.couriers/.staff
// (three new top-level Maps) AND House.exiled flag.
//
// Composition follows the P4/P5 Bare+wrap precedent:
//   migrate_v6_to_v7 = toSaveV7 ∘ seedWhispersCouriersStaff ∘ fromSaveV6Bare
//
// Bare-route (not the public fromSaveV6 wrapper) so we don't double-invoke
// the seeding helper. The Bare core leaves whispers/couriers/staff empty
// (and houses without exiled — they ride through the lifter); the seeder
// populates baseline staff + defaults exiled to false on every house.
//
// Draw budget: ZERO. Baseline staff carry constant ids/loyalties; no PRNG
// calls. A future migration that introduces randomized staff (procedural
// generation per P15+) MUST bump past v7 — adding draws to a deployed
// migration silently breaks the parity invariant for every legacy save.

import { type SaveV6, type SaveV7, fromSaveV6Bare, toSaveV7 } from "../schema";
import { seedWhispersCouriersStaffIntoLegacyState } from "../schema";

export function migrate_v6_to_v7(save: SaveV6): SaveV7 {
  const bare = fromSaveV6Bare(save);
  const seeded = seedWhispersCouriersStaffIntoLegacyState(bare);
  return toSaveV7(seeded);
}
