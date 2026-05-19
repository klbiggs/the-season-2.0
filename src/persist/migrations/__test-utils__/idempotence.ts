import { expect } from "vitest";

// Asserts that a save migration is idempotent — running it twice on the
// same input produces deeply-equal outputs. Catches non-deterministic
// migrations (forbidden randomness, time reads, module-level mutation)
// before they ship. Every migrate_vN_to_vN+1.idempotence.test.ts file
// reuses this so the convention is enforceable by file existence.
export function assertMigrationIdempotent<In, Out>(migrate: (input: In) => Out, fixture: In): void {
  expect(migrate(fixture)).toEqual(migrate(fixture));
}
