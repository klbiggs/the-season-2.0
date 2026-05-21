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
// P6: v6 → v7 (adds GameState.whispers/.couriers/.staff + House.exiled).
// P7: v7 → v8 (adds 7 new Character fields + 3 new top-level Maps).
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
  SaveV7Schema,
  SaveV8Schema,
  SaveV9Schema,
  SaveV10Schema,
} from "../schema";
import { type Migration, assertMonotonic } from "./runner";
import { migrate_v1_to_v2 } from "./v1-to-v2";
import { migrate_v2_to_v3 } from "./v2-to-v3";
import { migrate_v3_to_v4 } from "./v3-to-v4";
import { migrate_v4_to_v5 } from "./v4-to-v5";
import { migrate_v5_to_v6 } from "./v5-to-v6";
import { migrate_v6_to_v7 } from "./v6-to-v7";
import { migrate_v7_to_v8 } from "./v7-to-v8";
import { migrate_v8_to_v9 } from "./v8-to-v9";
import { migrate_v9_to_v10 } from "./v9-to-v10";

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
  {
    from: 6,
    to: 7,
    migrate: (s: unknown) => migrate_v6_to_v7(SaveV6Schema.parse(s)),
    outputSchema: SaveV7Schema,
  },
  {
    from: 7,
    to: 8,
    migrate: (s: unknown) => migrate_v7_to_v8(SaveV7Schema.parse(s)),
    outputSchema: SaveV8Schema,
  },
  {
    from: 8,
    to: 9,
    migrate: (s: unknown) => migrate_v8_to_v9(SaveV8Schema.parse(s)),
    outputSchema: SaveV9Schema,
  },
  {
    from: 9,
    to: 10,
    migrate: (s: unknown) => migrate_v9_to_v10(SaveV9Schema.parse(s)),
    outputSchema: SaveV10Schema,
  },
] as const;

assertMonotonic(MIGRATIONS);
