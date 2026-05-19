// Registry of save-format migrations. Each migration is a pure function
// migrate_vN_to_vN+1 declared in its own file with its own Vitest suite. The
// runner composes them in order.
//
// P1: first entry — v1 → v2 (extends SaveV1 with houses/characters/marriages
// seeded by seedStartingFamily). Wrapped with SaveV1Schema.parse to bridge the
// Migration.migrate `unknown → unknown` signature against the typed
// migrate_v1_to_v2.

import { SaveV1Schema } from "../schema";
import type { Migration } from "./runner";
import { migrate_v1_to_v2 } from "./v1-to-v2";

export const MIGRATIONS: readonly Migration[] = [
  { from: 1, to: 2, migrate: (s) => migrate_v1_to_v2(SaveV1Schema.parse(s)) },
] as const;
