# P2 — Save/Load & Migrations

> Part of [The Season Master Plan](../MASTER.md). Prior: [P1 — Tick Engine](./01-tick-engine.md). Next: [P3 — Strategy Map](./03-strategy-map.md).

**Goal.** Build the full versioned save/load infrastructure with migration discipline before more rules introduce more migration surface.

**In scope.**
- Zod schemas for `SaveV1` (P0 baseline) and one synthetic `SaveV2` (adds a placeholder field) so the migration runner has something to test against.
- `persist/migrations/v1_to_v2.ts` as the template — named pure function, individually unit-tested.
- Migration runner: composes `migrate_vN_to_vN+1` in order; rejects unknown versions with a readable error.
- Corrupt-save handling: surface readable error, offer "start new game".
- Absolute-tick serialization invariants documented and tested (every scheduled future event stores its end-tick, never a remaining-ticks delta).

**Out of scope.** Sidecar binary vector index (deferred to P17).

**Spec refs.** §3 "Save & Load", §5 "Filesystem Persistence", §7 "Save-data migration ordering", §8 "Compatibility", §9 reliability requirements.

**Key rules / constants.** All scheduled events store absolute ticks; per-house `{seed, callCount}` round-trip; conversation history bounded to 3 most-recent exchanges per `(house, target)` pair.

**Machines.** None new.

**Edge cases (§7).** "Save-data migration ordering" — strictly sequenced, no re-running of older migrations.

**Verification.** Vitest: each migration in isolation against fixture inputs; full chain v1 → vN against composed fixture; corrupted-file recovery surfaces correctly; cold-load reproduces 30-tick replay hash from P0.

**Close out.** When the gates and verification items above are green, run `/close-phase P2` to update phase status in `plans/MASTER.md` §6, append to `plans/SESSION-NOTES.md`, resolve any open questions answered during the work, and surface proposed `CLAUDE.md` additions and a commit message for approval.
