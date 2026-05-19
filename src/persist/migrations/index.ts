// Registry of save-format migrations. Each migration is a pure function
// migrate_vN_to_vN+1 declared in its own file with its own Vitest suite. The
// runner composes them in order and Zod-validates each step's output against
// the entry's outputSchema.
//
// P1: v1 → v2 (extends with houses/characters/marriages, seeded by
// seedStartingFamily).
// P2: v2 → v3 (adds campaignName: DEFAULT_CAMPAIGN_NAME).
//
// assertMonotonic runs at module load — a misconfigured registry fails
// Vitest boot rather than during a real player load.

import { SaveV1Schema, SaveV2Schema, SaveV3Schema } from "../schema";
import { type Migration, assertMonotonic } from "./runner";
import { migrate_v1_to_v2 } from "./v1-to-v2";
import { migrate_v2_to_v3 } from "./v2-to-v3";

export const MIGRATIONS: readonly Migration[] = [
  {
    from: 1,
    to: 2,
    migrate: (s: unknown) => migrate_v1_to_v2(SaveV1Schema.parse(s)),
    outputSchema: SaveV2Schema,
  },
  {
    from: 2,
    to: 3,
    migrate: (s: unknown) => migrate_v2_to_v3(SaveV2Schema.parse(s)),
    outputSchema: SaveV3Schema,
  },
] as const;

assertMonotonic(MIGRATIONS);
