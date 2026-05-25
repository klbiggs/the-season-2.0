// P18: pure idempotent v15 → v16 migration. Adds the single top-level
// state.flavorText Map (generated flavor content). The field seeds empty via
// fromSaveV15Bare's `flavorText: new Map()` return literal — V15 saves predate
// the field and carry no generated flavor, so an empty Map is correct (no
// retroactive content). No strip-cascade needed: flavorText is a top-level
// field that legacy emitters never serialize.
//
// Composition follows the zero-seed Bare+wrap precedent (mirrors v13-to-v14,
// NOT v14-to-v15 which has a society seed step). Uses the Bare half because the
// migration runner does its own seed steps; the public mount-seeding wrapper
// (fromSaveV15) would double-seed.
//
// Draw budget: ZERO. Pure shape transformation.

import { type SaveV15, type SaveV16, fromSaveV15Bare, toSaveV16 } from "../schema";

export function migrate_v15_to_v16(save: SaveV15): SaveV16 {
  return toSaveV16(fromSaveV15Bare(save));
}
