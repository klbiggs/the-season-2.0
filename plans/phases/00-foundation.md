# P0 — Foundation

> Part of [The Season Master Plan](../MASTER.md). Next: [P1 — Tick Engine & Pure Rules](./01-tick-engine.md).

**Goal.** Stand up the SPA shell, the deterministic per-house PRNG, the Zustand store, the save scaffold, and the Vitest determinism harness. Nothing playable yet — this is the spine every other phase hangs on, and its purpose is to prove the determinism plumbing, not to ship state worth replaying.

**In scope.**

- **Toolchain.**
  - Vite 6 + React 19 + TypeScript strict (`strict: true`, `noUncheckedIndexedAccess: true`).
  - Tailwind v4 via `@tailwindcss/vite` plugin (CSS-first config, no `tailwind.config.ts`). **Mandatory Context7 lookup** for the Tailwind v4 + shadcn integration during P0 implementation — the v4 setup differs materially from v3-era shadcn docs.
  - shadcn/ui generator wired by running `pnpm dlx shadcn@latest init` non-interactively with `--style new-york --base-color neutral --css-variables`. Expected outputs: `components.json`, `src/lib/utils.ts` (exporting `cn`), theme tokens written to `src/index.css`. No components imported yet.
  - Package manager: **pnpm**, pinned via `"packageManager": "pnpm@9.15.0"` in `package.json`. Node pinned via `.nvmrc` to `22.11.0` (exact minor — drift across CI/local breaks determinism guarantees).
  - **`package.json` scripts (required at P0).** `test` (`vitest run`), `test:watch` (`vitest`), `lint` (`biome check --write src eslint`), `lint:boundaries` (`eslint --config eslint.config.js src`), `typecheck` (`tsc --noEmit -p tsconfig.json`), `dev` (`vite`), `build` (`vite build`), `e2e` (`playwright test`). All five gate commands referenced under Verification (`pnpm test`, `pnpm lint`, `pnpm lint:boundaries`, `pnpm typecheck`, `pnpm e2e`) resolve to these scripts.
  - **CI workflow is out of scope at P0** — deferred to a later ops-focused pass. Verification at P0 is "the scripts run clean locally"; CI YAML lands when there's a second contributor or the project gains a remote deploy target.
  - **All tech-stack libs pinned to specific versions in `package.json`** (not just `seedrandom`). React, Vite, Tailwind, `@tailwindcss/vite`, shadcn CLI, Zustand, Immer, Zod, Dexie, Framer Motion (when introduced), `react-force-graph-2d` (when introduced) all get exact or `~`-pinned versions selected at implementation time from npm latest-stable. Determinism is fragile to Zustand+Immer Map handling and Dexie's structured-clone path; pinning prevents accidental upgrade-induced hash drift.
- **Lint setup.** Two tools, scoped:
  - **Biome** owns formatting + general lint (`pnpm lint`).
  - **ESLint** is installed with `eslint-plugin-boundaries` only and runs as a separate script (`pnpm lint:boundaries`). The ESLint config disables every rule category Biome owns and turns on boundary rules only. Both run in CI.
  - At P0 the boundaries config declares the elements (`game/rules`, `game/rng`, `game/constants`, `game/fixtures`, `runtime`, `llm`, `persist`, `ui`) but only ships and tests the two rules later phases will assert against: (a) `game/rules/**` may import only from `game/rules`, `game/constants`, `game/fixtures`, `game/rng`; (b) `game/rng` may be imported only from `game/rules/**` and `runtime/tickOrchestrator.ts` (the orchestrator file exists as a stub at P0 purely to anchor the rule — see stub body below).
  - **Belt-and-suspenders grep test (`src/game/forbidden-randomness.test.ts`).** A Vitest sanity test recursively reads every `.ts` and `.tsx` file under `src/` (using `node:fs/promises` + a hand-written walker — no shell `grep`) and asserts none contain the forbidden patterns. **Self-match avoidance:** the test constructs each pattern at runtime so the literal strings do NOT appear in its own source — e.g., `const MATH_RANDOM = ["Math", ".", "random"].join("");` and `const CRYPTO_RAND = ["crypto", ".", "getRandomValues"].join("");`. **Walker bounds:**
    - Root: literal `src/` only.
    - Exclusion list: `node_modules`, `dist`, `coverage`, `.git`, `.vite`, `build` (defensive — none should exist under `src/`).
    - Symlink guard: walker uses `fs.lstat` and skips entries where `isSymbolicLink()` is true.
    - Depth cap: 10 (asserts at depth >10 — fail loudly rather than recurse forever).
    - Allowlist (files where forbidden patterns are tolerated): `src/game/rng.ts`, `src/game/rng.test.ts`, `src/game/rng.replay.test.ts`. The walker test itself is NOT on the allowlist because it constructs the forbidden patterns at runtime via `.join("")` — the literals never appear in its source.
- **`src/game/rng.ts`.** Seeded PRNG, **no class abstraction**. The RNG state is plain data — `RngState = { seed: string; callCount: number }` — and lives directly in the Zustand store as `Map<HouseId, RngState>`. The module exports pure functions only:
  - `createRngState(seed: string): RngState` — returns `{ seed, callCount: 0 }`.
  - `drawNext(rngState: RngState): { next: number; rngState: RngState }` — constructs a fresh `alea(rngState.seed)`, invokes `next()` exactly `rngState.callCount + 1` times, returns the final draw plus an updated `RngState` with `callCount: rngState.callCount + 1`. Pure: no module-level cache, no closure state. **Performance note (acceptable at P0):** every call rebuilds the alea instance, so cost is O(callCount) per draw. At P0's draw rates (≤1 per tick) this is negligible; the deferred `{state: true}` optimization (see Accumulated Risks) lands at the phase where draw rates breach the budget.
  - `drawInt(rngState, maxExclusive): { next: number; rngState: RngState }` and `pickItem<T>(rngState, arr: readonly T[]): { item: T; rngState: RngState }` — helpers over `drawNext`. **`pickItem` throws `EmptyArrayError` on empty input** — pure-logic callers must pre-guard.
  - `serializeRegistry(map: Map<HouseId, RngState>): Array<[HouseId, RngState]>` — sorted lexicographically by `HouseId` (`[...map].sort(([a],[b]) => a.localeCompare(b))`). The lex-sort is non-negotiable: it keeps the hash invariant across Map insertion-order differences that arise from save→load round-trips at P7 (multi-house). At P0 with a single `"player"` entry the sort is a no-op but the discipline is in place. `deserializeRegistry(array): Map<HouseId, RngState>` — rebuilds the Map preserving the (already-sorted) array iteration order.
  - `getOrThrow(map: Map<HouseId, RngState>, houseId: HouseId): RngState` — throws `RngNotRegisteredError` if the key is missing (programmer error, not recoverable state).
  
  Backed by **`seedrandom@3.0.5`** (exact pin, not caret — the replay contract is too sharp for `^`) using the **`alea` algorithm explicitly**. **Mandatory Context7 lookup** for `seedrandom@3.0.5` to confirm the correct ESM import shape under Vite 6 + TS strict before writing the module — typings for `.alea` are known-thin and a side-import (`seedrandom/lib/alea`) may be required. Document the resolved import form inline in `rng.ts` so the next reader doesn't repeat the lookup. P0 only ever registers one entry (`"player"`); the Map shape is forward-compatible with P7's multi-house world without a save migration. The `"player"` entry is created at store-construction time inside `createStore({ seed })`; the seed defaults to `"the-season-default"` for first-launch and is overridable via an optional `<SeedPrompt />` modal in `src/ui/dev/`. Subsequent sessions read the seed from the loaded save.
  - **Replay-equivalence test (`src/game/rng.replay.test.ts`).** Proves the algorithm/replay strategy is bit-identical: for each of 5 pinned seeds (`"alpha"`, `"beta"`, `"gamma"`, `"delta"`, `"epsilon"`) **plus the negative-control seed** (`"negative-control"`), generate sequence `A = [r1.next() for i in 0..999]` from a fresh `alea(seed)`, then generate sequence `B` by constructing a second `alea(seed)` and discarding the first 500 draws via `next()`, then taking the next 500. Assert `A.slice(500, 1000)` deep-equals `B`. Also assert that `restore({seed, callCount: 500})` followed by 500 `next()` calls produces `A.slice(500, 1000)`. **Why:** the master plan's `{seed, callCount}` contract assumes re-seed + N-call advance is deterministic; this test pins that assumption to the chosen library version. Pinned seeds live in `src/game/rng.seeds.test.ts` as a shared constants export to keep negative-control and replay seeds in one place.
- **`src/game/store.ts`.** Zustand store with Immer middleware. **Canonical type definition — Zod schema is the single source of truth.** `src/game/store.ts` exports `GameStateSchema`, `GameState`, `createStore`, `createInitialState`, and the action signatures; every other module that references `GameState` imports it from here.
  ```ts
  export const GameStateSchema = z.object({
    tick: z.number().int().nonnegative(),
    rng: z.map(z.string().transform(s => s as HouseId), RngStateSchema),
  });
  export type GameState = z.infer<typeof GameStateSchema>;
  
  export function createInitialState(seed: string): GameState {
    return { tick: 0, rng: new Map([["player" as HouseId, createRngState(seed)]]) };
  }
  ```
  Deriving the type from the schema (not the other way around) is what makes the `hashable-state-extension.test.ts` enforcement work: a new field cannot be added to `GameState` without first adding it to `GameStateSchema.shape`, which the extension test reads at runtime.
  Factory `createStore({ seed }: { seed: string })` initializes its state via `createInitialState(seed)` before returning the store. Access pattern is `state.rng.get("player")` (throws via `getOrThrow` from `rng.ts` if missing). Actions:
  ```ts
  advanceTick: () => set(produce(state => {
    const player = getOrThrow(state.rng, "player" as HouseId);
    const { rngState } = drawNext(player); // draw discarded; see Why below
    state.rng.set("player" as HouseId, rngState);
    state.tick += 1;
  })),
  replaceState: (next: GameState) => set(() => next), // atomic state swap; see Bootstrap order
  ```
  **Bootstrap order (pinned to remove implementation ambiguity).**
  1. `src/main.tsx` calls `createStore({ seed: "the-season-default" })` synchronously at module load and renders `<DevApp />`. The store always exists from first frame with the default seed.
  2. `<LoadButton />` reads slot `DEV_SLOT` via `load()`, then calls `replaceState(fromSaveV1(save))`. The swap is atomic — UI never observes a partially-loaded state.
  3. `<SeedPrompt />` (optional first-launch override) calls `replaceState(createInitialState(promptedSeed))`. Same atomic-swap mechanism.
  4. Any `advanceTick()` calls before a load or prompt operate on the default-seeded RNG and are discarded when `replaceState` fires — by design (dev-only scaffold).
  
  No "deferred construction behind prompt" path: the store is unconditionally constructable with the default seed, and `replaceState` is the single mechanism for any subsequent seed change.
  
  **P1 transition (binding commitment):** P1 removes the `advanceTick()` discard draw the moment its first real per-tick rule draw lands; `hashableState` does NOT change at the transition because the discarded draw still moved `callCount`, and `callCount` is what flows through the hash. Document this in the `advanceTick` JSDoc so the P1 implementer doesn't accidentally preserve it.
- **`src/runtime/tickOrchestrator.ts`** — stub-for-anchor only. Exact body:
  ```ts
  // Stub: anchors the eslint-plugin-boundaries rule allowing src/game/rng imports
  // from this file. Real orchestrator logic lands in P1.
  export {};
  ```
  No exports, no TODO comments beyond the one above. Existence is the contract.
- **`src/persist/`.**
  - `schema.ts` — Zod schema for `SaveV1 = { version: 1, tick: number, rng: Array<[HouseId, {seed: string, callCount: number}]> }`. Also exports the bidirectional bridge between live state and save format:
    - `toSaveV1(state: GameState): SaveV1` — calls `serializeRegistry(state.rng)` to flatten the Map, wraps with `{ version: 1, tick: state.tick, rng: ... }`, and returns the result **after** Zod-validating via `SaveV1Schema.parse()` (catches in-memory state that wouldn't deserialize, before it hits disk).
    - `fromSaveV1(save: SaveV1): GameState` — calls `deserializeRegistry(save.rng)` to rebuild the Map; returns `{ tick: save.tick, rng: ... }`. Caller is responsible for Zod-validating the incoming `save` first (the `load()` API does so).
  - `migrations/` — directory with `runner.ts` (composes `migrate_vN_to_vN+1` functions from a registry array) and an empty `index.ts` (no migrations yet — v1 is current). The runner is exercised by a Vitest test that feeds it a `v1` save and asserts identity output, so the composition logic is real before P2 lands real migrations.
  - `dexie.ts` — single Dexie DB `the-season` at **Dexie schema version 1** (separate concept from save-format `version: 1` — Dexie schema versions the object-store layout; save-format versions the JSON shape). One object store `saves` keyed by `slot: string`. Save and load APIs: `save(slot: string, state: GameState): Promise<void>` and `load(slot: string): Promise<SaveV1 | undefined>`. `save()` synchronously calls `toSaveV1(state)` (sync prep per §8 NFR), then awaits `db.saves.put({ slot, data })` (async IO). `load()` awaits `db.saves.get(slot)`, then Zod-validates via `SaveV1Schema.parse()`, returning `undefined` if no record exists. Dev slot is exported as a constant: `export const DEV_SLOT = "dev"` — UI components and the round-trip test reference `DEV_SLOT`, never the literal string.
- **`src/ui/dev/`** — all P0 UI lives here. Files: `<DevApp />` (single-page shell), `<TickButton />`, `<TickReadout />`, `<SaveButton />`, `<LoadButton />`, `<SeedPrompt />` (first-launch optional override; pre-fills with `"the-season-default"`). The entry `src/main.tsx` mounts `<DevApp />`. **P3 teardown commitment:** the entire `src/ui/dev/` directory is deleted when P3 ships the strategy map; document this in `<DevApp />`'s top-of-file comment so the P3 implementer doesn't accidentally keep it.
- **Vitest determinism harness.** `src/game/rng.test.ts`, `src/game/rng.replay.test.ts`, `src/persist/save-roundtrip.test.ts`, `src/game/hashable-state-extension.test.ts`:
  - **30-run replay** in `it.each` form (one `it` block per run for failure isolation, not a single bundled assertion): from seed `"alpha"`, advance 1,000 ticks, hash via `hashState`, repeat 30 times in the same process with fresh store instances. All 30 hashes must match each other. Negative control: same harness with seed `"negative-control"` produces a hash different from the `"alpha"` baseline.
  - **Save round-trip**: save at tick 500, advance 500 more, compare hash against a control that advanced 1000 ticks without the save/load detour. N is pinned at 500/500 — large enough to expose buffering or callCount-sync bugs, small enough for fast feedback.
  - **Migration runner identity**: feed `SaveV1` through `runMigrations(state, 1, 1)`; assert structural equality.
  - **`hashableState` extension enforcement** — guards against a future phase forgetting to extend the projection. **Mechanism (pinned, not handwaved):** `GameState` is declared via a single Zod schema `GameStateSchema` in `src/game/store.ts`; the TypeScript type is derived from it (`type GameState = z.infer<typeof GameStateSchema>`). The extension test asserts `Object.keys(hashableState(sample)).sort()` deep-equals `Object.keys(GameStateSchema.shape).sort()`. Because the schema is the single source of truth for `GameState`, a phase author who adds a field must extend the schema, which then forces a corresponding extension to `hashableState` or the test fails. Catches the "added field, forgot everything else" case at test-run time.

**Out of scope.** Rules logic, LLM, hosting/deploy config, all later-phase machine implementations. View-router scaffolding is deferred until P3 introduces a second view. **Empty directories are created (`src/game/machines/`, `src/game/fixtures/`, `src/game/rules/`, `src/runtime/events/`) but contain no implementation files at P0** — they exist solely so the boundary rule's element-paths resolve cleanly. A `.gitkeep` keeps each present.

**Spec refs.** §3 "Tick-Driven Time Advancement" (paragraphs on phase order and absolute end-tick), §3 "Save & Load" (versioned schema, pure-function migrations), §8 "Determinism" (30-run replay, lint enforcement, conversation excluded), §8 "Save serialization synchronous", §9 architectural requirements 1–3, 7–10.

**Key rules / constants.**

- `tick: number` starts at 0; `advanceTick()` increments by exactly 1.
- `advanceTick()` performs one PRNG draw on the `"player"` house RNG and discards it. **Why:** otherwise `callCount` never moves at P0 and the harness can't detect a busted RNG round-trip; a real-but-discarded draw makes the determinism test meaningful before P1 has rules to draw on its own. **P1 removes this** (see store.ts bullet).
- `HouseId` is a branded `string` (`type HouseId = string & { __brand: "HouseId" }`); P0 only uses `"player" as HouseId`.
- Save format version is `1`. The version field is required and validated by Zod before any migration runs.
- **`src/game/hash.ts`** — the canonical hashing module. Three named exports:
  - `hashableState(state: GameState): unknown` — projects the store's state to a JSON-safe value. At P0 this returns `{ tick: state.tick, rng: serializeRegistry(state.rng) }` — the `Map` is converted to its `Array<[HouseId, RngState]>` form inside this function, so the canonical hash never depends on JS-engine Map iteration order. Each later phase that adds replay-relevant state extends this projection; non-replay state (UI selection, derived caches) is excluded.
  - `canonicalJSON(value: unknown): string` — deterministic stringify: object keys sorted lexicographically (`Object.keys(v).sort()`), arrays in insertion order, no whitespace, no `undefined` (treated as omitted), no `NaN`/`Infinity` (throws), no `BigInt` (throws — gameplay numerics are `number` only at every phase boundary), `-0` normalized to `0` before stringify. Numbers otherwise use `JSON.stringify`'s default formatting (which is fully deterministic across Node 22 across all integer/float magnitudes). Lists are arrays-only — `Set`/`Map` must be projected to arrays by `hashableState` first.
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
- **Playwright smoke spec (`tests/e2e/dev-smoke.spec.ts`) — MANDATORY at P0.** Covers: app mounts; tick button advances readout from 0→1→2; save button persists state to slot `DEV_SLOT`; reload restores the persisted tick. Verified via `pnpm e2e`. **Why mandatory:** the determinism plumbing's only end-to-end proof needs one non-conditional path, and an autonomous agent has no other way to verify the UI without violating CLAUDE.md's honesty rule. No "implementer chooses" optionality.

**Rollback.** Trivial pre-merge: revert the branch. No IndexedDB cleanup is needed since `slot: "dev"` is dev-only and the schema starts fresh on rebuild. If a partial rollback is needed post-merge (some files keep, some revert), the order is: schema first, then store, then UI — preserving the dependency direction.

**Hosting / deploy.** Deferred. Static-SPA target (Vercel or Netlify, master §2) is decided when there's a real surface to deploy.

## Accumulated Risks & Suggestions

*Live triage list — only entries with no resolution marker remain. Fully-resolved items from cycles 1–3 were pruned post-convergence; their content lives in git history.*

**Deferred (tracked, owner identified):**
- [C1] Document save-prep cost concern as a future-phase note. [deferred to P2: belongs in 02-save-migrations.md when real serialization cost matters]
- [C2] Consider `seedrandom.alea({state: true})` for O(1) restore vs the current O(callCount) replay strategy. [deferred: revisit when callCount exceeds ~10k draws per phase that breaches the threshold]
- [C2] Document `{state: true}` revisit at the phase where callCount exceeds ~10k draws. [deferred: tracked with the prior C2 item]

**Advisory (intentionally not folded):**
- [C3] Implement `{state: true}` abstraction at P0 even if internally using replay-by-callCount — avoids future-phase rework. [advisory: implementer's call — P0 callCount magnitudes don't justify the complexity yet]
- [C3] Cite specific spec subsections, not just §N headings. [advisory: style preference; current refs are sufficient]
