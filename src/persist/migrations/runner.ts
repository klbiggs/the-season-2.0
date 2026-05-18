// Composes save-format migrations in version order. The runner mechanism is
// exercised at P0 by an identity test (no migrations registered) so the
// composition logic is proven before P2 lands real migrations.

export type Migration = {
  from: number;
  to: number;
  // Pure function: returns a new value, does not mutate input.
  migrate: (state: unknown) => unknown;
};

export class MissingMigrationError extends Error {
  constructor(from: number, to: number) {
    super(`No migration registered from v${from} to v${to}`);
    this.name = "MissingMigrationError";
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
    throw new Error(`Downward migration not supported: v${fromVersion} → v${toVersion}`);
  }
  let current = state;
  let version = fromVersion;
  while (version < toVersion) {
    const next = registry.find((m) => m.from === version);
    if (next === undefined) throw new MissingMigrationError(version, version + 1);
    current = next.migrate(current);
    version = next.to;
  }
  return current;
}
