# P19 — Pre-ship cleanup: delete migration ladder + dead-code sweep

> Part of [The Season Master Plan](../MASTER.md). Prior: [P18 — (Optional) LLM Flavor Content](./18-llm-flavor.md).

**Goal.** Two coupled pre-ship demolitions:
1. Delete the v1→v{N} save-format migration ladder + Pre-schemas + strip cascade + chain tests. Ship v1.0 with a single `SaveV{current}Schema` rebased to `version: 1`.
2. Sweep dead code across the rest of the tree — unused exports, unused dependencies, unreferenced fixtures/constants, orphaned components, stale test utilities, leftover scaffolding, and any TODO/FIXME debt — so v1.0 ships clean.

Combined estimated delta: ~2500-3000 LOC from the ladder + an unknown (but bounded) amount from the broader sweep. The migration discipline forcing function served its purpose through P0-P18; at v1.0 ship there are zero saves in the wild, so the ladder is dead weight. The dead-code sweep is the natural companion: same release window, same "delete-only, no behavior change" risk profile, same final pre-ship audit.

## Why this phase exists

### Part 1 — migration ladder

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

### Part 2 — dead-code sweep

Eighteen feature phases produce drift. Patterns that accumulate during a phased rebuild and need a one-time post-P18 sweep:

- **Stranded exports** — helpers extracted "just in case" and never called from a second site; types exported from a module that ended up with one importer.
- **Orphan fixtures / constants** — designer constants tuned during a phase that got reworked; fixture entities (test NPCs, sample artifacts) referenced only by tests that have since been deleted or rewritten.
- **Stub-for-anchor leftovers** — `export {};` anchor files (CLAUDE.md convention) whose host phase shipped but never filled them in.
- **Replaced UI components** — early `view-N.tsx` prototypes superseded by the post-P10 ledger but never deleted; alternative renderers (e.g., a dropped force-graph variant) still sitting in the tree.
- **Unused dependencies** — packages added speculatively for a feature that pivoted (no `knip` / `depcheck` has run pre-ship).
- **Stale test utilities** — `src/persist/migrations/__test-utils__/idempotence.ts` and chain-test scaffolding are deletable WITH Part 1; broader test helpers (mock LLM responses for cut features, debug-trace utilities) need their own audit.
- **`// TODO` / `// FIXME` / `// HACK` debt** — currently `0` in `src/` and `server/` per a grep at plan-write time; the sweep enforces this stays at zero or each marker is converted into a tracked issue before tagging v1.0.

Doing this with the migration ladder deletion means a single "delete-only, no behavior change" PR window — both halves share the same verification gates (`pnpm test` + `pnpm lint` + `pnpm typecheck`) and the same risk profile (everything still has to work).

## In scope

### Part 1 — migration ladder

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

### Part 2 — dead-code sweep

- **Add `knip` as a devDependency** + a `pnpm knip` script. Configure with `entry: ["src/main.tsx", "server/index.ts"]` plus the test glob. Use `knip --reporter compact` for the audit pass. Delete every reported unused export, unused file, and unused dependency that isn't a known-required runtime peer. Commit the `knip.json` config alongside the deletions so future drift is detectable.
- **Add `pnpm depcheck`** (one-shot, not necessarily a permanent script) as a cross-check against knip's dependency report. Remove any package that both tools flag, after confirming it isn't pulled in transitively by a tool config (Biome plugins, ESLint resolver, Vite peer).
- **Audit `src/game/fixtures/`** — for every fixture entity (NPC, house, artifact, trait), grep for the id constant. If consumed only by deleted tests or by no production code path, delete the fixture entry. Update `RIVAL_HOUSE_IDS_SET` / `RIVAL_CHARACTER_IDS_SET` if any rival fixture is dropped.
- **Audit `src/game/constants.ts`** — for every exported designer constant, confirm a production import. Delete any constant that survives only because of `LIFESPAN_RANGE`-era tuning sweeps no longer in effect. Constants referenced ONLY by tests are suspect — verify the test still encodes a live invariant before keeping.
- **Audit anchor-stub files** — grep for `export {};` plus the one-line anchor comment. Any file whose host phase has shipped without backfilling the anchor either gets its real implementation or is deleted (and the ESLint boundary rule that referenced it updated).
- **Audit UI components under `src/ui/`** — every `*.tsx` component must be reachable from `src/main.tsx` via a real render path. Delete unmounted prototypes (e.g., early ledger renderers superseded by the post-P10 ledger, dropped force-graph variants from the P-whichever social-web iteration).
- **Audit test helpers** — `src/persist/migrations/__test-utils__/idempotence.ts` goes with Part 1. Broader audit: every `__test-utils__/` and `*.fixtures.ts` file must have a live importer post-Part 1 deletion. Mock LLM helpers for cut features (if any) get deleted.
- **Audit `server/`** — same rules: unused exports, unused helpers, dead routes. Confirm `server/personaCache.ts`, `server/conversation.ts`, `server/routing.ts`, `server/prompts/persona.ts`, `server/env.ts`, and `server/index.ts` are the complete surface; delete anything else.
- **Audit `scripts/`** — keep `generate-map.mjs` and the new `reset-save` script from Part 1; delete one-off dev scripts (data migrations, fixture dumps, debug dumpers) that won't be used post-ship.
- **TODO/FIXME/HACK gate** — `grep -rn "TODO\|FIXME\|HACK\|XXX" src/ server/ --include="*.ts" --include="*.tsx"` must return zero results outside of comments that explicitly explain a v1.5+ deferral (and even those should be tracked as issues, with the comment linking to the issue id).
- **Commented-out code** — zero blocks of commented-out code in `src/` or `server/`. If a block is preserved for reference, it lives in a git tag or in `plans/SESSION-NOTES.md`, not in source.
- **Boundary-rule audit** — re-run `pnpm lint:boundaries` after the sweep. If any boundary rule now references a deleted file, update or remove the rule.

## Out of scope

- Re-architecting the save format itself — the live schema shape stays as-is, just renumbered.
- Removing the migration discipline patterns (`.default()` backward-compat, lazy-clone branches, `pruneOrphanedConversationKeys` extension pattern) — those stay in CLAUDE.md.
- Building a "save importer" UI for legacy dev saves — `npm run reset-save` is enough.
- **Refactoring "smelly" code that isn't dead.** The sweep is delete-only. If a helper has one caller but that caller IS production code, leave it. Inlining or renaming is a separate concern with a different risk profile.
- **Test rewrites.** If a test is dead because the code it covers is dead, the test goes with the code. Do not rewrite living tests for clarity in this phase.
- **Dependency upgrades.** Removing an unused dep is in scope; bumping a kept dep is not.
- **CLAUDE.md / spec edits.** If the sweep deletes a pattern referenced by name in CLAUDE.md, update the reference in the same PR — but do not use this phase as cover for broader rule-doc rewrites.

## Spec refs

- `docs/greenfield-spec.md` §8 "Compatibility" — the spec's forward-migratability requirement is a v1.0+ ship contract. Pre-ship migration discipline served a different purpose (development discipline) and is deletable.
- `CLAUDE.md` "Non-negotiable architectural rules" §4 — the migration discipline patterns (named, pure, idempotent functions; named output schemas; per-migration idempotence test) STAY in CLAUDE.md as a future-phase contract. The deletion is the v1-vN scaffolding, not the discipline.
- `CLAUDE.md` "Coding conventions" — no spec line covers dead-code; the sweep is a pre-ship hygiene pass. After the sweep, add a one-line entry to CLAUDE.md if any new convention emerged (e.g., "`pnpm knip` must stay clean on every PR").

## Approach

Sequence the work so each sub-step has a clean revert point:

1. **Part 1 first** — delete the migration ladder. Land green (`pnpm test` + `pnpm lint` + `pnpm typecheck` + manual `pnpm dev` smoke). This is the biggest deletion and the most likely source of follow-on dead exports the sweep then catches.
2. **Install `knip` + `depcheck`**, run them, commit the config. Skim the report before deleting anything — both tools have known false positives (entry points they don't recognize, dynamic imports, peer deps).
3. **Sweep in dependency order, leaves first** — fixtures → constants → test helpers → UI components → server. Each category gets its own commit so a revert is targeted. Re-run `pnpm test` between categories.
4. **Re-run `knip` + `depcheck` at the end** — second pass catches deletions unblocked by first-pass deletions.
5. **Final verification gate** — all listed verification items below in one clean run.

## Verification

### Part 1
- `pnpm test` clean — no migration tests remain to fail; round-trip test against `SaveV{current}Schema` only.
- `wc -l src/persist/schema.ts` drops from ~1900 → ~600.
- File count in `src/persist/migrations/` drops to 1-2 (index + runner stub, or both deleted).
- A fresh `pnpm dev` campaign saves and loads correctly.
- A pre-cleanup save in IndexedDB triggers the clean error message (verified manually or via Playwright).

### Part 2
- `pnpm knip` clean (zero unused files, zero unused exports, zero unused dependencies — or a documented `knip.json` ignore list for any deliberate exception).
- `pnpm depcheck` cross-check clean (or documented ignore list).
- `grep -rn "TODO\|FIXME\|HACK\|XXX" src/ server/ --include="*.ts" --include="*.tsx"` returns zero hits (or every hit links to a tracked issue).
- `grep -rn "^[[:space:]]*//.*[a-z]" src/ server/ --include="*.ts" --include="*.tsx"` audited by hand for commented-out code blocks (informational, not a hard gate).
- Replay harness still produces identical state hashes across 30 runs (no fixture deletion silently shifted RNG seeding).
- `pnpm dev` golden-path smoke: bootstrap a campaign, run 5 ticks, open a conversation, save, reload, verify state.

### Joint
- `pnpm test` clean.
- `pnpm lint` clean.
- `pnpm lint:boundaries` clean (boundary rules updated for any deleted file).
- `pnpm typecheck` clean.
- `pnpm build` produces a working bundle.

## Key constants

- `SAVE_VERSION_CURRENT` resets to `1` (the v1.0 ship version).

## Close out

When the gates and verification items above are green, run `/close-phase 19` to update phase status in `plans/MASTER.md` §6, append to `plans/SESSION-NOTES.md`, and commit the changes (no push). This is the final pre-ship phase — after P19, the project is ready to tag v1.0.
