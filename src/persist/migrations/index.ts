// Registry of save-format migrations. Each migration is a pure function
// migrate_vN_to_vN+1 declared in its own file with its own Vitest suite. The
// runner composes them in order and Zod-validates each step's output against
// the entry's outputSchema.
//
// P1: v1 → v2 (extends with houses/characters/marriages, seeded by
// seedStartingFamily).
// P2: v2 → v3 (adds campaignName: DEFAULT_CAMPAIGN_NAME).
// P3: v3 → v4 (adds GameState.era + 5 new House fields).
// P4: v4 → v5 (adds conversationHistory + affectionMap + Character composure
// + Independent house + 5 baseline NPCs).
// P5: v5 → v6 (adds GameState.schemes + House.grievances).
//
// assertMonotonic runs at module load — a misconfigured registry fails
// Vitest boot rather than during a real player load.

import {
  SaveV1Schema,
  SaveV2Schema,
  SaveV3Schema,
  SaveV4Schema,
  SaveV5Schema,
  SaveV6Schema,
} from "../schema";
import { type Migration, assertMonotonic } from "./runner";
import { migrate_v1_to_v2 } from "./v1-to-v2";
import { migrate_v2_to_v3 } from "./v2-to-v3";
import { migrate_v3_to_v4 } from "./v3-to-v4";
import { migrate_v4_to_v5 } from "./v4-to-v5";
import { migrate_v5_to_v6 } from "./v5-to-v6";

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
  {
    from: 3,
    to: 4,
    migrate: (s: unknown) => migrate_v3_to_v4(SaveV3Schema.parse(s)),
    outputSchema: SaveV4Schema,
  },
  {
    from: 4,
    to: 5,
    migrate: (s: unknown) => migrate_v4_to_v5(SaveV4Schema.parse(s)),
    outputSchema: SaveV5Schema,
  },
  {
    from: 5,
    to: 6,
    migrate: (s: unknown) => migrate_v5_to_v6(SaveV5Schema.parse(s)),
    outputSchema: SaveV6Schema,
  },
] as const;

assertMonotonic(MIGRATIONS);
