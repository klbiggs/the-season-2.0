# P19 — Pre-ship cleanup: delete migration ladder + dead-code sweep

> Part of [The Season Master Plan](../MASTER.md). Prior: [P18 — (Optional) LLM Flavor Content](./18-llm-flavor.md). **Final phase** — after P19 the project is ready to tag v1.0.

**Goal.** Two coupled pre-ship demolitions, one PR window, one risk profile ("delete-only, no behavior change"):
1. **Delete the v1→v16 save-format migration ladder** — every `migrate_v{N}_to_v{N+1}`, every legacy `SaveV{1..15}Schema` + its `to/from` functions, every Pre-schema + strip/lift/seed helper, the runner + registry + every migration test. Rebase the live `SaveV16Schema` to `version: 1` (renamed `SaveV1Schema`). Ship v1.0 with a single save schema and an empty migration ladder.
2. **Sweep dead code** across the rest of the tree — unused exports/files/dependencies (knip-driven), the migration-deletion follow-on dead code (`bootstrapPlayerArtifactsForMigration`, `__buildSaveV9ForTests`, `MigrationFailedError`/`MissingMigrationError`), and the two deferred `lint:boundaries` violations.

The migration discipline was a development forcing function through P0–P18 (catches non-additive schema changes, gives chain-test hash coverage, survives mid-dev saves across phase branches). At v1.0 ship none of those benefits apply: zero saves in the wild, chain coverage is replayed by a single round-trip test, the discipline patterns are baked into CLAUDE.md for the *next* ladder. So the ladder is dead weight, and the dead-code sweep is its natural same-window companion.

## Resolved decisions (this session)

These three were open in the skeleton; resolved before fleshing out:

- **D1 — Rebase to `version: 1`.** Rename `SaveV16*` → `SaveV1*` and set the version literal/`SAVE_VERSION_CURRENT` to `1`. Clean ship story; the future post-ship ladder restarts from v1. Mechanical rename across `schema.ts`, `dexie.ts`, `SettingsMenu.tsx`, `save-roundtrip.test.ts`. (Note: the symbol `SaveV1` now denotes the *V16 shape* — there is no collision because the original `SaveV1Schema` is deleted in the same pass.)
- **D2 — Delete the runner entirely.** Delete `src/persist/migrations/` wholesale (all migration modules, the runner, the registry, `__test-utils__`, every migration test). `load()` loses its legacy branch: version `=== 1` → parse; anything else → a `SaveLoadError` variant. The first post-ship migration re-scaffolds the runner (cheap; CLAUDE.md §4 documents the discipline).
- **D3 — No reset tooling.** The plan's original "`npm run reset-save` Node script" is infeasible (Node cannot reach browser IndexedDB). We ship nothing. After rebase, any extant dev save (at v16) surfaces the existing `SaveVersionTooNewError` banner ("a newer version of the game…") — verified already covered by `tests/e2e/map-smoke.spec.ts` (`version: 99`). A dev who actually wants to keep playing clears IndexedDB by hand via DevTools. Single-user greenfield; the clean error *is* the UX.

## Why this phase exists

Eighteen feature phases produce drift. Two demolition targets:

### Part 1 — migration ladder

`src/persist/schema.ts` is **2686 lines** (the skeleton's "~1900" estimate was stale). It holds 15 legacy `SaveV{N}Schema` declarations, their `toSaveV{N}`/`fromSaveV{N}`/`fromSaveV{N}Bare` round-trip functions, 8 Pre-schemas (`HousePreV4/V6/V7/V12Pre11/V13/V14`, `CharacterPreV5/V8`), and ~25 strip/lift/seed helpers — all in service of lifting v1–v15 saves forward. `src/persist/migrations/` holds 15 `migrate_*` modules + the runner + the registry + ~35 test files. None of it has a live consumer at ship beyond the single `SaveV16` (→ `SaveV1`) round-trip.

### Part 2 — dead-code sweep

Reconnaissance corrected several skeleton assumptions — the actual surface is **smaller** than the skeleton implied:

- **Already clean (gate-only, no work):** zero `export {};` anchor stubs in the tree; zero `TODO`/`FIXME`/`HACK`/`XXX` in `src/`+`server/`; `scripts/` holds only `generate-map.mjs` (no one-off dev scripts to delete).
- **Real targets:** unused exports/files/deps that no tool has yet swept (`knip`/`depcheck` are not installed); the migration-deletion follow-on dead code (below); the two deferred boundary violations.
- **Migration follow-on dead code** (confirmed by grep — becomes dead the moment Part 1 lands):
  - `bootstrapPlayerArtifactsForMigration` (`src/game/bootstrap.ts`) — used **only** by legacy lifters/migrations (~10 sites across `schema.ts` (V1–V12 region) plus `migrations/v10-to-v11.ts` + `v4-to-v5.ts`), all deleted in Part 1. Conclusion (dead after Part 1) holds, but verify zero callers post-deletion rather than trusting any single-lifter framing. (`bootstrapNpcMountFamily` stays — live caller at `store.ts:189`.)
  - `__buildSaveV9ForTests` + the `toSaveV9` import (`src/main.tsx`) — exposed on `window` for Playwright but **no e2e spec references it** (the corrupt-save spec uses `__putRawForTests`). Dead.
  - `MigrationFailedError` + `MissingMigrationError` (`src/persist/errors.ts`) — thrown only by the runner. Dead after D2. (`SaveVersionTooNewError`/`UnknownSaveVersionError`/`InvalidSaveSchemaError` stay.)
- **Deferred boundary fix (CLAUDE.md P14 carve-out):** `src/game/rules/inheritedSecrets.ts:38` and `src/game/rules/siblingRivals.ts:42` both `import type { GameState } from "../store"` (rule-(a) violation). The fix is a 2-file swap to `from "../entities"` (`GameState` is exported at `entities.ts:646`), bringing `lint:boundaries` from its known-2-error baseline to **zero**.

## Out of scope

- **Re-architecting the save format.** The live schema *shape* is unchanged — only renumbered/renamed.
- **Removing migration discipline from CLAUDE.md.** The patterns (`.default()` backward-compat, lazy-clone branches, `pruneOrphanedConversationKeys` extension, named/pure/idempotent migrations, `outputSchema`) STAY as the next-ladder contract. P19 deletes the v1–v16 *scaffolding*, not the discipline.
- **The empty `src/game/machines/` slot + XState.** `src/game/machines/` is empty (`.gitkeep` only) and XState was never added as a dependency — a documented-but-unrealized stack slot (MASTER §2/§4/§5.2, CLAUDE.md tech stack). Removing it would force a multi-doc architecture rewrite, which the "no rule-doc rewrites" guard below forbids. Leave the `.gitkeep`; note the non-realization in SESSION-NOTES at close-out. Not dead *code* (it's an empty dir), so knip ignores it.
- **Refactoring "smelly" but live code.** Delete-only. A helper with one *production* caller stays. Inlining/renaming live code is a different risk profile.
- **Test rewrites.** If a test dies because its subject died, it goes with the subject. Do not rewrite living tests for clarity here.
- **Dependency upgrades.** Removing an unused dep is in scope; bumping a kept dep is not.
- **CLAUDE.md / spec edits beyond necessity.** If the sweep deletes something CLAUDE.md names, update that reference in the same PR — but do not use P19 as cover for broader rule-doc rewrites.

## Spec refs

- `greenfield-spec.md` §8 "Compatibility" — forward-migratability is a v1.0+ ship contract (future ladder). Pre-ship migration discipline served development discipline and is deletable.
- `CLAUDE.md` "Non-negotiable architectural rules" §4 — the migration discipline STAYS as a future-phase contract; the deletion is the v1–v16 scaffolding only.
- `CLAUDE.md` "Coding conventions" — no spec line covers dead code; the sweep is pre-ship hygiene. If a new convention emerges (e.g. "`pnpm knip` stays clean on every PR"), add one CLAUDE.md line at close-out.

## Approach

Sequence so each sub-step has a clean revert point; land Part 1 fully green before Part 2 (Part 1's deletions unblock Part 2's sweep).

### Part 1 — migration ladder (one commit, or 2: "delete ladder" then "rebase to v1")

1. **`src/persist/schema.ts` — delete legacy.** Remove `SaveV1Schema`…`SaveV15Schema` and their `toSaveV{1..15}` / `fromSaveV{1..15}` / `fromSaveV{4..15}Bare`. Remove all Pre-schemas (`HousePreV4/V6/V7/V12Pre11/V13/V14`, `CharacterPreV5/V8`) and every strip/lift/default/seed helper (`defaultHouseV4/V6/V7`, `liftLegacyHouses*`, `liftHousesFromPreV13/PreV14/V12Pre11`, `stripGrievances*`/`stripV6Fields*`/`stripExiled*`/`stripP11*`/`stripCourierResearch*`/`stripP15*`/`stripBloodFeudGrievances*`/`stripV8CharacterFields*`/`stripEquippedArtifacts*`, `filterProceduralNpcsForLegacyEmit`, `defaultCharacterV5/V8`, `liftLegacyCharacters*`, `seedIndependentIntoLegacyState`, `seedSchemesAndGrievancesIntoLegacyState`, `seedWhispersCouriersStaffIntoLegacyState`, `seedProceduralSocietyIntoLegacyState`, `seedRivalsAndPatronessesIntoLegacyState`). Keep `SaveV16Schema`, `toSaveV16`, `fromSaveV16`, **and `fromSaveV16Bare`** (the live `fromSaveV16` calls it at `schema.ts:2678` — it is NOT dead), plus shared infra (`serializeRegistry`/`deserializeRegistry`, the imports the live path needs). Prune now-unused imports (`bootstrapPlayerArtifactsForMigration`, fixture imports only legacy lifters used, etc.).
2. **Rebase to v1 (D1).** `SAVE_VERSION_CURRENT = 16` → `1`. Rename `SaveV16Schema`→`SaveV1Schema`, type `SaveV16`→`SaveV1`, `toSaveV16`→`toSaveV1`, `fromSaveV16`→`fromSaveV1`, `fromSaveV16Bare`→`fromSaveV1Bare`. Set the `version:` literal in the schema *and* in `toSaveV1`'s emitted object to `1` (note `toSaveV16` currently emits `version: SAVE_VERSION_CURRENT`, so this falls out of the constant change — confirm no stray literal `16` remains).
3. **Delete `src/persist/migrations/` wholesale (D2)** — the directory, all 15 `migrate_*` modules, `runner.ts`, `runner.test.ts`, `index.ts`, every `*-chain.test.ts` / `*.test.ts` / `*.idempotence.test.ts` / `*.parity.test.ts` / `*.callcount-passthrough.test.ts`, and `__test-utils__/`.
4. **`src/persist/dexie.ts` — simplify `load()`.** Drop the 16-arm `SaveRecord.data` union (→ `data: SaveV1`) and the 16 individual `type SaveV{N}` imports at `dexie.ts:14-29` (keep only the live `SaveV1` type + `SaveV1Schema` + `toSaveV1`). Drop the `MIGRATIONS` + `runMigrations` imports and the legacy `runMigrations(...)` branch. `load()`: no `version` → `InvalidSaveSchemaError`; non-int / `< 1` → `UnknownSaveVersionError`; `> 1` → `SaveVersionTooNewError`; `=== 1` → `SaveV1Schema.parse`. Rename the surviving `toSaveV16`/`SaveV16Schema`/`SaveV16` references to `…V1`.
5. **`src/persist/errors.ts` — delete `MigrationFailedError` + `MissingMigrationError`** (now unthrown), and fix their two dependent test files:
   - **`src/persist/errors.test.ts`** (3 sites): remove the two imports (lines 4-5), remove the two rows from the parametrized `variants` table (lines 25-26), and delete the dedicated `describe("MigrationFailedError — inner-cause preservation")` block (lines 59-74).
   - **`src/persist/dexie.test.ts`** (the load-path corruption suite is materially affected by the rebase, not a one-line import drop):
     - Remove the `MigrationFailedError` import (line 10).
     - **Delete the entire `describe("load() — MigrationFailedError from a malformed legacy save")` block (lines 102-148).** Both its tests feed legacy versions (`version: 1` and `version: 3`) expecting `MigrationFailedError`; post-rebase `version: 1` is *current* (a malformed payload there surfaces `InvalidSaveSchemaError`, not a migration error) and `version: 3` trips `SaveVersionTooNewError` (`3 > 1`). The block is structurally impossible and the error type it asserts is deleted.
     - In the `describe("load() — InvalidSaveSchemaError")` malformed-current-version test (lines 57-99), change the in-payload `version: 16` → `version: 1` and update its comment (lines 58-62, which currently explain the V16-routing hazard). With `version: 1` (now current) and the malformed `tick`, it hits `SaveV1Schema.parse` → `InvalidSaveSchemaError` as before.
     - The `version: 99` / `version: 0` / `"two"` / no-version tests are unchanged (`99 > 1` still → `SaveVersionTooNewError`, etc.).
6. **`src/game/bootstrap.ts` — delete `bootstrapPlayerArtifactsForMigration`.** Keep `bootstrapNpcMountFamily`.
7. **`src/main.tsx` — delete `__buildSaveV9ForTests` + the `toSaveV9` import** (`main.tsx:7`) and only the `__buildSaveV9ForTests`-specific lines of the `window` augmentation (`45,53`). **Keep `__putRawForTests`** (typing at `44,52`) — it shares the same `window` block and is live (consumed by `tests/e2e/map-smoke.spec.ts:61`). Confirm no e2e spec breaks (none reference `__buildSaveV9ForTests`).
8. **`src/persist/save-roundtrip.test.ts`** — rename `fromSaveV16`→`fromSaveV1`; delete the "migration runner identity (v1 → v1)" `describe` block (runner is gone).
9. **`src/ui/shared/SettingsMenu.tsx`** — rename `fromSaveV16`→`fromSaveV1` (load button → `replaceState`).
10. **Comment cleanup** — light touch where comments reference deleted `SaveV{N}` symbols and now mislead, across **all four** residue files: `entities.ts`, `bootstrap.ts`, `store.ts`, **and `store.elopement-gate.test.ts:11`** ("SaveV10 hand-craft"), plus the stale `save-roundtrip.test.ts:10-11` header ("exercises the SaveV4 on-disk path"). Sweeping all four is what makes the Part-1 grep gate (below) read clean. Do not rewrite living prose for style.
11. **Land green:** `pnpm test` + `pnpm lint` + `pnpm typecheck` + a manual `pnpm dev` save/load smoke.

### Part 2 — dead-code sweep (commit per category for targeted revert)

1. **Boundary fix first** — swap `../store` → `../entities` in `inheritedSecrets.ts:38` + `siblingRivals.ts:42`; confirm `pnpm lint:boundaries` is now **zero** errors (was the known-2 baseline).
2. **Install `knip`** as a devDependency + `"knip": "knip"` script + commit `knip.json`. Config: `entry: ["src/main.tsx", "server/index.ts"]`; `project: ["src/**/*.{ts,tsx}", "server/**/*.ts"]`; rely on knip's built-in vite/vitest/eslint/playwright/biome plugins for config-file + test entry detection. Run `knip --reporter compact`. **Skim before deleting** — known false positives to add to the `ignore`/`ignoreExportsUsedInFile`/`ignoreDependencies` lists: the `window.__*ForTests` helpers in `main.tsx` invoked dynamically from Playwright `page.evaluate` (e.g. `__putRawForTests`), and any runtime peer a plugin doesn't infer. Delete every genuine unused export / file / dependency.
3. **`pnpm dlx depcheck`** (one-shot cross-check; not a permanent script). Remove a package only if **both** tools flag it AND it isn't a transitive tool peer (Biome plugin, ESLint resolver, Vite/Tailwind peer).
4. **Leaves-first manual audits** for what knip can't infer (each its own commit; `pnpm test` between):
   - `src/game/fixtures/` — for each fixture id, grep for a *production* consumer; delete entries referenced only by deleted tests. If any rival fixture drops, update `RIVAL_HOUSE_IDS_SET`/`RIVAL_CHARACTER_IDS_SET`.
   - `src/game/constants.ts` — for each exported constant, confirm a production import; a constant referenced *only* by tests is suspect (keep only if the test encodes a live invariant).
   - `src/game/__test-utils__/`, `src/runtime/__test-utils__/`, `*.fixtures.ts` — every helper must have a live importer post-Part-1; delete orphans.
   - `src/ui/**` — every `*.tsx` must be reachable from `src/main.tsx`; delete unmounted prototypes.
   - `server/` — confirm `index.ts`, `env.ts`, `routing.ts`, `conversation.ts`, `personaCache.ts`, `embeddings.ts`, `flavor.ts`, `prompts/*`, plus the shared-types edge are the complete surface; delete anything else.
5. **Re-run `knip` + `depcheck`** — second pass catches deletions unblocked by the first.
6. **Gate confirmations (no expected work):** `TODO/FIXME/HACK/XXX` grep stays zero; no `export {};` anchor stubs reappeared; commented-out-code grep audited by hand (informational).

## Verification

### Part 1
- `pnpm test` clean — no migration tests remain; `save-roundtrip.test.ts` exercises the single `SaveV1` round-trip.
- `src/persist/migrations/` directory is **gone** (skeleton said "1-2 files"; D2 deletes it entirely).
- `wc -l src/persist/schema.ts` drops from **2686 → ~400–600** (*informational*, not a hard gate — `pnpm test`/`typecheck`/`knip` are the real gates; live entity schemas live in `entities.ts`, not here, so what remains is `SaveV1Schema` + `toSaveV1`/`fromSaveV1`/`fromSaveV1Bare` + serialize helpers + imports).
- `SAVE_VERSION_CURRENT === 1`; no live `SaveV{2..16}` symbol remains. The grep `grep -rE "SaveV([2-9]|1[0-6])\b" src` returns only comment residue in the P1.10-swept files (`entities.ts`, `bootstrap.ts`, `store.ts`, `store.elopement-gate.test.ts`) — with P1.10 done, manually confirm every remaining hit is a comment, not a live reference.
- A fresh `pnpm dev` campaign saves and loads correctly via `SettingsMenu`.
- A pre-cleanup save (`version: 99` / any `> 1`) surfaces the `SaveVersionTooNewError` banner — covered by `tests/e2e/map-smoke.spec.ts` (unchanged: `99 > 1` still trips the same path).

### Part 2
- `pnpm knip` clean (zero unused files/exports/dependencies — or a committed `knip.json` ignore list documenting each deliberate exception).
- `pnpm dlx depcheck` cross-check clean (or documented exceptions).
- `grep -rnE "TODO|FIXME|HACK|XXX" src/ server/ --include="*.ts" --include="*.tsx"` returns zero.
- Replay harness produces identical state hashes across 30 runs (no fixture/constant deletion silently shifted RNG seeding).
- `pnpm dev` golden-path smoke: bootstrap, run 5 ticks, open a conversation, save, reload, verify state.

### Joint
- `pnpm test` clean.
- `pnpm lint` clean (Biome).
- `pnpm lint:boundaries` **zero** errors (the P14 known-2 baseline is fixed in Part 2 step 1).
- `pnpm typecheck` clean (both `tsconfig.json` and `server/tsconfig.json`).
- `pnpm build` produces a working bundle.

## Key constants

- `SAVE_VERSION_CURRENT` resets to `1` (the v1.0 ship version; `schema.ts`).

## Close out

When all gates and verification items are green, run `/close-phase 19` to update phase status in `plans/MASTER.md` §6, append to `plans/SESSION-NOTES.md` (note the v16→v1 rebase, the runner deletion, the `knip` addition, and the unrealized `machines/`+XState slot), apply any CLAUDE.md additions (e.g. the `pnpm knip` clean-on-PR line; update the P14 carve-out note now that `lint:boundaries` is zero), and commit (no push). This is the final pre-ship phase — after P19, the project is ready to tag v1.0.

## Accumulated Risks & Suggestions

*Passively collected from review cycles. Not blockers. Triaged at convergence.*

- [C1] `bootstrapPlayerArtifactsForMigration` is called by ~10 legacy lifters (V1–V12 region) plus `migrations/v10-to-v11.ts` and `v4-to-v5.ts`, not just V1/V2/V3 — conclusion (dead after Part 1) is correct, but verify zero callers post-deletion rather than trusting the "V1/V2/V3 only" framing. [applied]
- [C1] `errors.test.ts` edit is 3 sites (imports lines 4-5, variants-table rows 25-26, the inner-cause `describe` 59-74), not one. [likely addressed]
- [C1] Comment-cleanup list (P1.10) omits `src/game/store.elopement-gate.test.ts:11` ("SaveV10 hand-craft") and the stale `save-roundtrip.test.ts:10-11` header ("exercises the SaveV4 on-disk path") — both fall in the "now mislead" category the step targets. [applied]
- [C1] The Part 1 grep gate (`SaveV([2-9]|1[0-6])` empty) circularly depends on the B2 `dexie.test.ts` rewrite — note the coupling so the implementer doesn't treat the grep as independently satisfiable. [likely addressed]
- [C1] knip/depcheck two-pass + leaves-first manual audit is well-scoped; the `window.__*ForTests` false-positive callout is confirmed correct (`__putRawForTests` survives, `__buildSaveV9ForTests` is genuinely unreferenced). *(affirmation — no action)*
- [C1] The `2686 → ~400-600` line-count target should stay informational, not a hard gate (the real gates are `pnpm test`/`typecheck`/`knip` clean). [applied]
- [C1] `dexie.ts` P1.4 should also enumerate pruning the 16 individual `type SaveV{N}` imports at `dexie.ts:14-29` and the 16-arm `data` union (`50-65`), not just the union + `MIGRATIONS`/`runMigrations`; `typecheck` catches it but enumeration is cleaner. [applied]
- [C2] The Part-1 grep gate (`SaveV([2-9]|1[0-6])` "empty except incidental prose") is not literally satisfiable — `SaveV{N}` survives in comment residue across `entities.ts`(2), `bootstrap.ts`(2), `store.ts`(1), and `store.elopement-gate.test.ts:11`. Either tighten the gate to a named-file allowlist or have P1.10 sweep all four (P1.10 currently names only the first three). A literal gate-runner reads FAIL as written. [applied]
- [C2] Enumerate the knip/depcheck ignore-list (the `window.__*ForTests` Playwright helpers, replay-only fixtures, Biome/ESLint/Vite transitive peers) before the sweep, so genuine-vs-FP triage doesn't stall. *(note for implementer — full enumeration is best done once `knip` output is in hand; the plan's "skim before deleting" already covers the approach)*
- [C3] P1.7 should pin that the `__putRawForTests` window typing (`main.tsx:44,52`) STAYS while only the `__buildSaveV9ForTests` lines (`45,53`) + the `toSaveV9` import (`7`) are removed — they share the same `window` augmentation block. [applied]
