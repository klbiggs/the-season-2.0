// Composes save-format migrations in version order. The runner mechanism is
// exercised at P0 by an identity test (no migrations registered) and at P1
// by the v1→v2 chain. P2 hardens with typed errors, per-step output Zod
// validation, and a registry-construction monotonicity guard.

import type { z } from "zod";
import { MigrationFailedError, MissingMigrationError, SaveVersionTooNewError } from "../errors";

export type Migration = {
  readonly from: number;
  readonly to: number;
  // Pure function: returns a new value, does not mutate input. The runner
  // wraps `migrate` in a try/catch that re-throws as MigrationFailedError so
  // every step's failure path is uniform.
  readonly migrate: (state: unknown) => unknown;
  // Schema for the migration's OUTPUT (i.e., SaveV{to} schema). The runner
  // parses the output against this schema; failure is MigrationFailedError.
  readonly outputSchema: z.ZodTypeAny;
};

// Module-load monotonicity check. A misconfigured registry throws here at
// Vitest boot (or app start in dev) — never during a player load.
export function assertMonotonic(migrations: readonly Migration[]): void {
  for (let i = 0; i < migrations.length; i++) {
    const m = migrations[i];
    if (m === undefined) continue;
    if (m.to !== m.from + 1) {
      throw new Error(`Migration #${i} skips: v${m.from} → v${m.to}`);
    }
    const prev = migrations[i - 1];
    if (i > 0 && prev !== undefined && m.from !== prev.to) {
      throw new Error(
        `Migration #${i} gap: previous ended at v${prev.to}, this starts at v${m.from}`,
      );
    }
  }
}

export function runMigrations(
  state: unknown,
  fromVersion: number,
  toVersion: number,
  registry: readonly Migration[],
): unknown {
  if (fromVersion === toVersion) return state;
  if (fromVersion > toVersion) {
    throw new SaveVersionTooNewError(fromVersion, toVersion);
  }
  let current = state;
  let version = fromVersion;
  while (version < toVersion) {
    const next = registry.find((m) => m.from === version);
    if (next === undefined) throw new MissingMigrationError(version, version + 1);
    if (next.to !== version + 1) {
      // Defense-in-depth — assertMonotonic catches this at module load, but
      // guard at runtime in case a future refactor inserts a "skip" entry.
      throw new MigrationFailedError(
        next.from,
        next.to,
        new Error(`Non-monotonic step: v${next.from} → v${next.to}`),
      );
    }
    try {
      const output = next.migrate(current);
      // Per-step Zod validation: a bad migration that returns malformed
      // output surfaces here as MigrationFailedError, not as a downstream
      // mystery in the next step.
      current = next.outputSchema.parse(output);
    } catch (cause) {
      // Don't re-wrap if the cause is already a MigrationFailedError.
      if (cause instanceof MigrationFailedError) throw cause;
      throw new MigrationFailedError(next.from, next.to, cause);
    }
    version = next.to;
  }
  return current;
}
