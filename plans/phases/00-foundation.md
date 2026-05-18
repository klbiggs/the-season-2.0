# P0 — Foundation

> Part of [The Season Master Plan](../MASTER.md). Next: [P1 — Tick Engine & Pure Rules](./01-tick-engine.md).

**Goal.** Stand up the SPA shell, the deterministic per-house PRNG, the Zustand store, the save scaffold, and the Vitest determinism harness. Nothing playable yet — this is the spine every other phase hangs on, and its purpose is to prove the determinism plumbing, not to ship state worth replaying.

**In scope.**

- **Toolchain.**
  - Vite 6 + React 19 + TypeScript strict (`strict: true`, `noUncheckedIndexedAccess: true`).
  - Tailwind v4 via `@tailwindcss/vite` plugin (CSS-first config, no `tailwind.config.ts`). **Mandatory Context7 lookup** for the Tailwind v4 + shadcn integration during P0 implementation — the v4 setup differs materially from v3-era shadcn docs.
  - shadcn/ui generator wired by running `pnpm dlx shadcn@latest init` non-interactively with `--style new-york --base-color neutral --css-variables`. Expected outputs: `components.json`, `src/lib/utils.ts` (exporting `cn`), theme tokens written to `src/index.css`. No components imported yet.
  - Package manager: **pnpm**, pinned via `"packageManager": "pnpm@9.15.0"` in `package.json`. Node pinned via `.nvmrc` to `22.11.0` (exact minor — drift across CI/local breaks determinism guarantees).
- **Lint setup.** Two tools, scoped:
  - **Biome** owns formatting + general lint (`pnpm lint`).
  - **ESLint** is installed with `eslint-plugin-boundaries` only and runs as a separate script (`pnpm lint:boundaries`). The ESLint config disables every rule category Biome owns and turns on boundary rules only. Both run in CI.
  - At P0 the boundaries config declares the elements (`game/rules`, `game/rng`, `game/constants`, `game/fixtures`, `runtime`, `llm`, `persist`, `ui`) but only ships and tests the two rules later phases will assert against: (a) `game/rules/**` may import only from `game/rules`, `game/constants`, `game/fixtures`, `game/rng`; (b) `game/rng` may be imported only from `game/rules/**` and `runtime/tickOrchestrator.ts` (the orchestrator file exists as a stub at P0 purely to anchor the rule — see stub body below).
  - **Belt-and-suspenders grep test (`src/game/forbidden-randomness.test.ts`).** A Vitest sanity test recursively reads every `.ts` and `.tsx` file under `src/` (using `node:fs/promises` + a hand-written walker — no shell `grep`) and asserts none contain the forbidden patterns. **Self-match avoidance:** the test constructs each pattern at runtime so the literal strings do NOT appear in its own source — e.g., `const MATH_RANDOM = ["Math", ".", "random"].join("");` and `const CRYPTO_RAND = ["crypto", ".", "getRandomValues"].join("");`. **Walker bounds:**
    - Root: literal `src/` only.
    - Exclusion list: `node_modules`, `dist`, `coverage`, `.git`, `.vite`, `build` (defensive — none should exist under `src/`).
    - Symlink guard: walker uses `fs.lstat` and skips entries where `isSymbolicLink()` is true.
    - Depth cap: 10 (asserts at depth >10 — fail loudly rather than recurse forever).
    - Allowlist (files where forbidden patterns are tolerated): `src/game/rng.ts`, `src/game/rng.test.ts`, `src/game/rng.replay.test.ts`, `src/game/forbidden-randomness.test.ts`.
- **`src/game/rng.ts`.** Seeded PRNG exposed as a per-house registry: `RngRegistry` with `get(houseId: HouseId): Rng` (throws `RngNotRegisteredError` if the key is missing — the load path must always re-register before calling `get`; a missing key is a programmer error, not a recoverable state). Backed by **`seedrandom@3.0.5`** (exact pin, not caret — the replay contract is too sharp for `^`) using the **`alea` algorithm explicitly**. **Mandatory Context7 lookup** for `seedrandom@3.0.5` to confirm the correct ESM import shape under Vite 6 + TS strict before writing the module — typings for `.alea` are known-thin and a side-import (`seedrandom/lib/alea`) may be required. Document the resolved import form inline in `rng.ts` so the next reader doesn't repeat the lookup. Each `Rng` wraps `{seed: string, callCount: number}` and exposes `next(): number`, `int(maxExclusive): number`, `pick<T>(arr): T`, `serialize(): {seed, callCount}`, `restore({seed, callCount}): void`. Restoration constructs a fresh `alea(seed)` instance then invokes `next()` exactly `callCount` times. The registry serializes to/from `Map<HouseId, {seed, callCount}>` (encoded in JSON as `Array<[HouseId, {seed, callCount}]>` to preserve key order; see `src/game/hash.ts` for the canonical serializer). P0 only ever registers one entry (`"player"`); the map shape is forward-compatible with P7's multi-house world without a save migration. The `"player"` entry is registered at store-construction time inside `createStore({ seed })`; the seed defaults to `"the-season-default"` for first-launch and is overridable via an optional `<SeedPrompt />` modal in `src/ui/dev/`. Subsequent sessions read the seed from the loaded save.
  - **Replay-equivalence test (`src/game/rng.replay.test.ts`).** Proves the algorithm/replay strategy is bit-identical: for each of 5 pinned seeds (`"alpha"`, `"beta"`, `"gamma"`, `"delta"`, `"epsilon"`) **plus the negative-control seed** (`"negative-control"`), generate sequence `A = [r1.next() for i in 0..999]` from a fresh `alea(seed)`, then generate sequence `B` by constructing a second `alea(seed)` and discarding the first 500 draws via `next()`, then taking the next 500. Assert `A.slice(500, 1000)` deep-equals `B`. Also assert that `restore({seed, callCount: 500})` followed by 500 `next()` calls produces `A.slice(500, 1000)`. **Why:** the master plan's `{seed, callCount}` contract assumes re-seed + N-call advance is deterministic; this test pins that assumption to the chosen library version. Pinned seeds live in `src/game/rng.seeds.test.ts` as a shared constants export to keep negative-control and replay seeds in one place.
- **`src/game/store.ts`.** Zustand store with Immer middleware. State at P0: `{ tick: number, rng: SerializedRngRegistry }`. Factory `createStore({ seed }: { seed: string })` registers the `"player"` RNG before returning the store — calling `store.getState().rng.player` after construction must succeed. Action `advanceTick()` increments `tick` by exactly 1 and draws one number from the player RNG (discarded). **P1 transition (binding commitment):** P1 removes the `advanceTick()` discard draw the moment its first real per-tick rule draw lands; `hashableState` does NOT change at the transition because the discarded draw still moved `callCount`, and `callCount` is what flows through the hash. Document this in the `advanceTick` JSDoc so the P1 implementer doesn't accidentally preserve it.
- **`src/runtime/tickOrchestrator.ts`** — stub-for-anchor only. Exact body:
  ```ts
  // Stub: anchors the eslint-plugin-boundaries rule allowing src/game/rng imports
  // from this file. Real orchestrator logic lands in P1.
  export {};
  ```
  No exports, no TODO comments beyond the one above. Existence is the contract.
- **`src/persist/`.**
  - `schema.ts` — Zod schema for `SaveV1 = { version: 1, tick: number, rng: Array<[HouseId, {seed: string, callCount: number}]> }`. The `rng` field is the array form of the registry's `Map`; deserialization in `load()` is responsible for rebuilding the `Map`.
  - `migrations/` — directory with `runner.ts` (composes `migrate_vN_to_vN+1` functions from a registry array) and an empty `index.ts` (no migrations yet — v1 is current). The runner is exercised by a Vitest test that feeds it a `v1` save and asserts identity output, so the composition logic is real before P2 lands real migrations.
  - `dexie.ts` — single Dexie DB `the-season` at **Dexie schema version 1** (separate concept from save-format `version: 1` — Dexie schema versions the object-store layout; save-format versions the JSON shape). One object store `saves` keyed by `slot: string`. Save and load APIs: `save(slot: string, state: GameState): Promise<void>` and `load(slot: string): Promise<SaveV1 | undefined>`. Save synchronously serializes into a plain JS object via `toSaveV1(state)` (sync prep per §8 NFR), then awaits `db.saves.put({ slot, data })` (async IO).
- **`src/ui/dev/`** — all P0 UI lives here. Files: `<DevApp />` (single-page shell), `<TickButton />`, `<TickReadout />`, `<SaveButton />`, `<LoadButton />`, `<SeedPrompt />` (first-launch optional override; pre-fills with `"the-season-default"`). The entry `src/main.tsx` mounts `<DevApp />`. **P3 teardown commitment:** the entire `src/ui/dev/` directory is deleted when P3 ships the strategy map; document this in `<DevApp />`'s top-of-file comment so the P3 implementer doesn't accidentally keep it.
- **Vitest determinism harness.** `src/game/rng.test.ts`, `src/game/rng.replay.test.ts`, `src/persist/save-roundtrip.test.ts`, `src/game/hashable-state-extension.test.ts`:
  - **30-run replay** in `it.each` form (one `it` block per run for failure isolation, not a single bundled assertion): from seed `"alpha"`, advance 1,000 ticks, hash via `hashState`, repeat 30 times in the same process with fresh store instances. All 30 hashes must match each other. Negative control: same harness with seed `"negative-control"` produces a hash different from the `"alpha"` baseline.
  - **Save round-trip**: save at tick 500, advance 500 more, compare hash against a control that advanced 1000 ticks without the save/load detour. N is pinned at 500/500 — large enough to expose buffering or callCount-sync bugs, small enough for fast feedback.
  - **Migration runner identity**: feed `SaveV1` through `runMigrations(state, 1, 1)`; assert structural equality.
  - **`hashableState` extension enforcement** — guards against a future phase forgetting to extend the projection. The test introspects the current `GameState` type via a Zod schema (or a hand-curated key list pinned in `src/game/hash.replay-keys.ts`) and asserts that every replay-relevant key is present in `hashableState`'s output. P0 ships with `["tick", "rng"]`; later phases add their keys to the constant. If a phase adds replay state without updating the constant, this test fails.

**Out of scope.** Rules logic, LLM, hosting/deploy config, all later-phase machine implementations. View-router scaffolding is deferred until P3 introduces a second view. **Empty directories are created (`src/game/machines/`, `src/game/fixtures/`, `src/game/rules/`, `src/runtime/events/`) but contain no implementation files at P0** — they exist solely so the boundary rule's element-paths resolve cleanly. A `.gitkeep` keeps each present.

**Spec refs.** §3 "Tick-Driven Time Advancement" (paragraphs on phase order and absolute end-tick), §3 "Save & Load" (versioned schema, pure-function migrations), §8 "Determinism" (30-run replay, lint enforcement, conversation excluded), §8 "Save serialization synchronous", §9 architectural requirements 1–3, 7–10.

**Key rules / constants.**

- `tick: number` starts at 0; `advanceTick()` increments by exactly 1.
- `advanceTick()` performs one PRNG draw on the `"player"` house RNG and discards it. **Why:** otherwise `callCount` never moves at P0 and the harness can't detect a busted RNG round-trip; a real-but-discarded draw makes the determinism test meaningful before P1 has rules to draw on its own. **P1 removes this** (see store.ts bullet).
- `HouseId` is a branded `string` (`type HouseId = string & { __brand: "HouseId" }`); P0 only uses `"player" as HouseId`.
- Save format version is `1`. The version field is required and validated by Zod before any migration runs.
- **`src/game/hash.ts`** — the canonical hashing module. Three named exports:
  - `hashableState(state: GameState): unknown` — projects the store's state to a JSON-safe value. At P0 this returns `{ tick: state.tick, rng: state.rng }` (the `Map<HouseId, ...>` is already serialized as `Array<[K, V]>` per the rng-registry contract). Each later phase that adds replay-relevant state extends this projection; non-replay state (UI selection, derived caches) is excluded.
  - `canonicalJSON(value: unknown): string` — deterministic stringify: object keys sorted lexicographically (`Object.keys(v).sort()`), arrays in insertion order, no whitespace, no `undefined` (treated as omitted), no `NaN`/`Infinity` (throws). Lists are arrays-only — `Set`/`Map` must be projected to arrays by `hashableState` first.
  - `hashState(state: GameState): string` — returns `sha256(canonicalJSON(hashableState(state)))` as lowercase hex (64 chars). SHA-256 from `node:crypto` `createHash("sha256")` (Vitest runs in Node 22; browser hashing is not needed at P0 since the determinism harness is test-only).
  Vitest coverage: `canonicalJSON` against fixtures with shuffled key orders producing identical output; `hashState` against two snapshots with reordered Map entries producing identical hashes (guards against the `Map` → JSON insertion-order trap).

**Machines.** None implemented yet. (Bankruptcy-tier classification lives in P1 with the economy rule; this phase's empty `src/game/machines/` directory is structure-only.)

**Edge cases (§7).** None gameplay-active yet. **"Save-data migration ordering"** is exercised by the migration-runner identity test: the runner composes a (currently empty) list of named functions, so when P2 adds `migrate_v1_to_v2` the composition mechanism is already proven.

**Verification.**

- `pnpm test` — all Vitest suites green; the 30-run replay (via `it.each`) produces identical hashes; the negative-control seed produces a different hash; save → reload → advance round-trip hash matches a no-detour control; `hashableState` extension test passes.
- `pnpm lint` — Biome clean.
- `pnpm lint:boundaries` — ESLint boundaries clean against `src/`.
- **Boundary-rule fires-on-violation test (`eslint/boundaries.test.ts`).** A Vitest test that exercises ESLint's Node API directly — no on-disk fixture, no `.ts.snippet` extension games:
  ```ts
  import { ESLint } from "eslint";
  const eslint = new ESLint({ overrideConfigFile: "eslint.config.js" });
  const [result] = await eslint.lintText(
    `import { rng } from "../../rng";\nexport function x() { return rng; }\n`,
    { filePath: "src/ui/violation.ts" }
  );
  expect(result.messages.some(m => m.ruleId === "boundaries/element-types")).toBe(true);
  ```
  **Three cases — one for each boundary rule plus a positive control:**
  - **Rule (b) negative**: `src/ui/violation.ts` importing `src/game/rng` MUST error (only `game/rules/**` and `runtime/tickOrchestrator.ts` may import `rng`).
  - **Rule (a) negative**: `src/game/rules/violation.ts` importing `src/runtime/tickOrchestrator` MUST error (rules may only import from `game/rules`, `game/constants`, `game/fixtures`, `game/rng`).
  - **Positive control**: `src/game/rules/economy.ts` (synthetic) importing `src/game/rules/moods.ts` (synthetic) MUST NOT error.
  This exercises both boundary rules and proves the config is active without committing a violating source file.
- `pnpm typecheck` — `tsc --noEmit` clean under strict + `noUncheckedIndexedAccess`.
- Forbidden-randomness walker test passes; allowlist is exactly the four files named above.
- **CLAUDE.md updates.** Append the four P0 conventions to the project `CLAUDE.md` before declaring the phase done: (1) `src/game/hash.ts` is the canonical hash module; extend `hashableState`'s projection when adding replay state. (2) Boundary-rule fires-on-violation tests use `ESLint.lintText` against synthetic source — never on-disk `.ts.snippet` fixtures. (3) Stub-for-anchor pattern: a real file with `export {};` is the way to anchor a future boundary rule. (4) `HouseId` is a branded string; never raw `string` when referring to a house.
- **Smoke check (human-verification-only).** `pnpm dev` opens the app; the tick button advances the readout; save/load round-trips. **An autonomous agent must declare this step untested unless it has access to a real browser** — per CLAUDE.md's UI-testing honesty rule. A Playwright spec covering this flow is acceptable as a substitute and can land in P0 if implementer chooses.

**Rollback.** Trivial pre-merge: revert the branch. No IndexedDB cleanup is needed since `slot: "dev"` is dev-only and the schema starts fresh on rebuild. If a partial rollback is needed post-merge (some files keep, some revert), the order is: schema first, then store, then UI — preserving the dependency direction.

**Hosting / deploy.** Deferred. Static-SPA target (Vercel or Netlify, master §2) is decided when there's a real surface to deploy.

## Accumulated Risks & Suggestions

*Passively collected from review cycles. Not blockers. Triaged at convergence.*

- [C1] `save()` / `load()` signatures incomplete; "sync prep + async IO" boundary not specified. [folded]
- [C1] `RngRegistry` "player" registration locus, timing, and seed source unspecified. [folded]
- [C1] `Map<HouseId,...>` to JSON conversion implicit; needs explicit array<->Map convention. [folded]
- [C1] `hashableState(state)` location, signature, and phase-extension contract missing. [likely addressed]
- [C1] Grep test allowlist must include the B2 boundary-violation fixture path. [likely addressed]
- [C1] shadcn/ui "wired" is ambiguous — needs exact CLI invocation and resulting files. [folded]
- [C1] Tailwind v4 + shadcn integration has known friction; pin versions or require Context7 lookup. [folded]
- [C1] Save-roundtrip "N more ticks" doesn't pin N. [folded]
- [C1] Negative-control seed not pinned; hash-equality assertion details thin. [folded]
- [C1] CLAUDE.md updates not addressed (hash helper location, boundary-fixture convention, stub-for-anchor pattern). [folded]
- [C1] Pin `seedrandom@^3.0.5` + `alea` with `{state: true}`. [likely addressed]
- [C1] Pin pnpm version via `packageManager` field. [folded]
- [C1] Use per-iteration `it` blocks for 30-run replay for better failure isolation. [folded]
- [C1] Document save-prep cost concern as a future-phase note. [deferred to P2: belongs in 02-save-migrations.md when real serialization cost matters]
- [C1] State rollback explicitly even though it's trivial pre-merge. [folded]
- [C1] Specify dev UI directory (`src/ui/dev/`) and its expected disappearance at P3. [folded]
- [C1] Specify exact `tickOrchestrator.ts` stub contents to remove a design decision. [folded]
- [C1] Pin negative-control alternate seed value. [folded]
- [C1] Make "no events/machines/fixtures content" out-of-scope explicit. [folded]
- [C1] `seedrandom.alea` import shape under Vite 6 ESM + TS strict not verified — `seedrandom/lib/alea` side-import may be required. [folded: Context7 lookup mandated in rng.ts bullet]
- [C1] `forbidden-randomness.test.ts` walker has no max-depth, no `node_modules`/`dist`/`coverage` exclusion, no symlink-loop guard. [folded]
- [C1] Pin `.nvmrc` to a specific Node 22 minor version (e.g., `22.11.0`), not just "Node 22 LTS". [folded]
- [C1] Triage the `## Accumulated Risks & Suggestions` tail before implementation begins; the tail grows across reviews but items don't move until convergence. [folded: this triage pass]
- [C2] C1 tail (23 items) not converged into plan body; many items still open per cross-plan pattern. [folded: this triage pass]
- [C2] Negative-control seed value still unpinned in the determinism harness. [folded]
- [C2] P0 `advanceTick()` discard-draw precedent may silently persist into P1 and shift replay invariants once real rule draws land. [folded: P1 transition binding commitment in store.ts bullet]
- [C2] Manual `pnpm dev` smoke step is not autonomously verifiable; conflicts with CLAUDE.md UI-testing honesty rule ("if you can't test the UI, say so"). [folded]
- [C2] Consider `seedrandom.alea({state: true})` for O(1) restore vs the current O(callCount) replay strategy. [deferred: revisit when callCount exceeds ~10k draws per phase that breaches the threshold]
- [C2] `RngRegistry.get(houseId)` throw vs return-undefined semantics on a missing key unspecified — load path needs to know. [folded]
- [C2] Document `{state: true}` revisit at the phase where callCount exceeds ~10k draws. [deferred: tracked with the prior C2 item]
- [C2] Add a brief Rollback section per R11. [folded]
- [C3] `hashableState` extension contract has no test enforcement — a future phase that forgets to extend the projection won't be caught. [folded: `hashable-state-extension.test.ts`]
- [C3] Dangling `eslint/test-fixtures/` reference unused after switch to `lintText` in-memory pattern. [folded: reference removed from walker bullet]
- [C3] Dexie schema version (separate from save-format version) not pinned. [folded]
- [C3] CLAUDE.md / MASTER.md updates for new conventions (hash.ts, stub-for-anchor, lintText fixture pattern, HouseId brand) not addressed. [folded into Verification step]
- [C3] Implement `{state: true}` abstraction at P0 even if internally using replay-by-callCount — avoids future-phase rework.
- [C3] Explicit exclusion list for forbidden-randomness walker (node_modules, dist, coverage, .git; symlink-loop guard). [folded]
- [C3] Pin `seedrandom` exactly (not caret) — determinism is too sharp a contract for `^`. [folded]
- [C3] Make "directories exist but empty" out-of-scope explicit for events/, fixtures/, rules/. [folded]
- [C3] Cite specific spec subsections, not just §N headings.
