# P19 — Pre-ship cleanup: delete migration ladder

> Part of [The Season Master Plan](../MASTER.md). Prior: [P18 — (Optional) LLM Flavor Content](./18-llm-flavor.md).

**Goal.** Delete the v1→v{N} save-format migration ladder + Pre-schemas + strip cascade + chain tests. Ship v1.0 with a single `SaveV{current}Schema`. The discipline forcing function served its purpose through P0-P18; at v1.0 ship there are zero saves in the wild, so the ladder is dead weight (~2500-3000 LOC).

## Why this phase exists

Throughout P0-P18, every state-shape change has shipped with a full migration: bump `SAVE_VERSION_CURRENT`, declare `SaveV{N}Schema`, add or extend Pre-schemas (`HousePreV{N}Schema`, `CharacterPreV{N}Schema`), add strip helpers (`stripP{N}FieldsForLegacyEmit`), write `migrate_v{N}_to_v{N+1}`, write idempotence test, write chain test (`v1-to-v{N}-chain.test.ts`). This was load-bearing during development:

- Catches non-additive schema changes (CLAUDE.md §6 enforcement).
- Replay-harness chain-test ladder gives strong hash-stability coverage.
- Mid-dev save survival across phase branches.
- Forced the `.default([])` backward-compat shortcut + lazy-clone branch patterns into the codebase.

At v1.0 ship, none of these benefits apply:
- No real users have saves to migrate.
- The chain-test coverage is replayed by a single `SaveV{current}` round-trip test.
- Mid-dev save survival is moot post-ship.
- The discipline patterns are baked into CLAUDE.md and inherited by future phases.

## In scope

- **Delete every `migrate_v{N}_to_v{N+1}.ts`** at `src/persist/migrations/v*-to-v*.ts` (11+ files by P18).
- **Delete every legacy `SaveV{N}Schema`** declaration in `src/persist/schema.ts` for N < current. Keep only `SaveV{current}Schema`.
- **Delete every `HousePre{N}Schema` / `CharacterPre{N}Schema` / `MarriagePre{N}Schema`** Pre-schema declaration + their `defaultHouseV{N}Fields` / `defaultCharacterV{N}Fields` lift helpers.
- **Delete every `strip{Field}ForLegacyEmit` / `liftLegacyHousesFromV{N}Pre`** helper.
- **Delete every `fromSaveV{N}` + `fromSaveV{N}Bare` + `toSaveV{N}`** for N < current. Keep only the live emitter + lifter.
- **Delete every chain test** (`v1-to-v{N}-chain.test.ts`) and every per-step migration test (`v{N}-to-v{N+1}.test.ts` + `.idempotence.test.ts` + `.parity.test.ts`).
- **Delete the `MIGRATIONS` registry** at `src/persist/migrations/index.ts`. Replace with a noop or delete `runMigrations` entirely.
- **Simplify `load()` at `src/persist/dexie.ts`** — remove the legacy-version branch. On version mismatch, throw `UnknownSaveVersionError` (or new `LegacySaveNotSupportedError`) with a clear "save format incompatible, please reset" message.
- **Ship a `npm run reset-save` script** for any dev who still has a pre-cleanup save.
- **Rebase the LIVE `SaveV{current}Schema` to `version: 1`** (resets the version counter for v1.0 ship — every future post-ship migration starts the ladder fresh from v1).

## Out of scope

- Re-architecting the save format itself — the live schema shape stays as-is, just renumbered.
- Removing the migration discipline patterns (`.default()` backward-compat, lazy-clone branches, `pruneOrphanedConversationKeys` extension pattern) — those stay in CLAUDE.md.
- Building a "save importer" UI for legacy dev saves — `npm run reset-save` is enough.

## Spec refs

- `docs/greenfield-spec.md` §8 "Compatibility" — the spec's forward-migratability requirement is a v1.0+ ship contract. Pre-ship migration discipline served a different purpose (development discipline) and is deletable.
- `CLAUDE.md` "Non-negotiable architectural rules" §4 — the migration discipline patterns (named, pure, idempotent functions; named output schemas; per-migration idempotence test) STAY in CLAUDE.md as a future-phase contract. The deletion is the v1-vN scaffolding, not the discipline.

## Verification

- `pnpm test` clean — no migration tests remain to fail; round-trip test against `SaveV{current}Schema` only.
- `pnpm lint` clean.
- `pnpm typecheck` clean.
- `wc -l src/persist/schema.ts` drops from ~1900 → ~600.
- File count in `src/persist/migrations/` drops to 1-2 (index + runner stub, or both deleted).
- A fresh `pnpm dev` campaign saves and loads correctly.
- A pre-cleanup save in IndexedDB triggers the clean error message (verified manually or via Playwright).

## Key constants

- `SAVE_VERSION_CURRENT` resets to `1` (the v1.0 ship version).

## Close out

When the gates and verification items above are green, run `/close-phase 19` to update phase status in `plans/MASTER.md` §6, append to `plans/SESSION-NOTES.md`, and commit the changes (no push). This is the final pre-ship phase — after P19, the project is ready to tag v1.0.
