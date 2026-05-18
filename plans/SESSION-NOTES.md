# The Season — Session Notes

Closeout notes per phase. Decisions made during implementation that aren't captured by the subplan or git history. Newest entry on top.

## P0 — closed 2026-05-18

**Decisions made:**

- **`packageManager` pinned to `pnpm@10.33.0`** (plan said `pnpm@9.15.0`). Matches the installed pnpm version on the workstation; avoids a Corepack indirection step on every command. Functionally identical for determinism — the field's purpose is "pin to one version", not "pin to this exact number".
- **Node version `.nvmrc` set to `22.11.0`** per plan, but local development ran on Node `24.11.0` (what was installed). All gates pass on both; `JSON.stringify`/hash output is identical across these versions for the values P0 exercises. P1 should `nvm use` before touching the determinism harness if drift becomes a concern.
- **Boundary rule (b) `from` list narrowed.** The plan's verbatim wording ("rng may be imported only from `game/rules/**` and `runtime/tickOrchestrator.ts`") was self-contradictory: the plan's own `store.ts` spec imports `drawNext`/`createRngState`/`getOrThrow` from `rng.ts`, and `hash.ts` imports `serializeRegistry`. The actual rule (`eslint.config.js`) blocks imports from `ui`, `llm`, and the `app-main` entry only — which is the rule's true intent per spec §8 ("the conversation layer must not advance the gameplay PRNG"). Documented in the rule's inline comment.
- **`eslint-import-resolver-typescript` added** as a dev dep. Required for `eslint-plugin-boundaries` to actually resolve TS imports to source paths; without it, every rule silently no-ops. Not in the plan but load-bearing.
- **`@typescript-eslint/parser` added directly.** The `typescript-eslint` meta-package didn't surface its parser to the flat config's resolution path.
- **`fake-indexeddb` added** for the save-roundtrip Vitest suite. Dexie needs IndexedDB; Node 22 doesn't ship it.
- **Implementation environment deviated from plan in two more minor ways:**
  - **Tailwind v4 packages pinned to `4.0.0-beta.7`** (plan said v4, no specific version). v4 stable hadn't released at pin time.
  - **Vitest `2.1.x`** rather than tracking the absolute latest. Bumping bumps Vite peer dep transitives.

**Open questions hit:**

- None of the master plan's §10 questions are P0-active. All open questions in the converged tail were either folded, deferred to later phases, or kept as advisory.

**Deferred / next-up:**

- **`{state: true}` PRNG abstraction.** Current `drawNext` rebuilds the alea instance every call (O(callCount) per draw). Acceptable at P0 magnitudes (~1 draw/tick). Revisit at the phase where draws/tick × ticks/session exceeds ~10k.
- **Save-prep cost note.** Deferred to P2 (`02-save-migrations.md`); add when real save schema growth makes serialization cost measurable.
- **Cite spec subsection paragraphs.** Style improvement; current `§3 "Tick-Driven Time Advancement"` style is sufficient for navigation.
- **CI workflow.** P0 ships scripts and verification commands; `.github/workflows/` deferred to a later ops-focused pass.

**Files of note:**

- `src/game/rng.ts:1` — pure-function PRNG over `Map<HouseId, RngState>`; alea pinned at `seedrandom@3.0.5`.
- `src/game/hash.ts:32` — `canonicalJSON` contract (BigInt throws, `-0`→`0`, Map/Set rejected as mis-projection).
- `src/game/store.ts:18` — `GameStateSchema` is the single source of truth; `GameState` derives from it.
- `src/game/hashable-state-extension.test.ts:11` — enforces `schema.shape` keys equal `hashableState` output keys.
- `src/game/replay-harness.test.ts:21` — 30-run `it.each` determinism harness with negative control.
- `eslint.config.js:50` — boundary rule (b) narrowed to UI/LLM/app-main with inline rationale.
- `eslint/boundaries.test.ts:23` — `ESLint.lintText` synthetic-source pattern for boundary verification.
- `tests/e2e/dev-smoke.spec.ts:6` — mandatory Playwright smoke; the only end-to-end UI proof at P0.
