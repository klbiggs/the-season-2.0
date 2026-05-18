// Registry of save-format migrations. Each migration is a pure function
// migrate_vN_to_vN+1 declared in its own file with its own Vitest suite. The
// runner composes them in order.
//
// No migrations yet — v1 is current. P2 will add the first entry.

import type { Migration } from "./runner";

export const MIGRATIONS: readonly Migration[] = [] as const;
