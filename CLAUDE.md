# CLAUDE.md — *The Season*

Project memory for future Claude Code sessions. Read this first; it tells you where the real documents live and what the non-negotiable rules are.

## Project at a glance

*The Season* is a single-player, turn-based, browser-based social-strategy and dynasty-simulation game (Regency / early Victorian Britain). A previous implementation is being rewritten greenfield. This repo is the new build.

## Where the source of truth lives

1. **`greenfield-spec.md`** — the only authoritative description of what the game does and why. WHAT and WHY only; no HOW. When the spec and code disagree, the spec wins unless an open question has been resolved in writing.
2. **`plans/MASTER.md`** — the architecture and phase index for the rebuild. Tech stack decisions, cross-cutting contracts, and pointers to per-phase subplans.
3. **`plans/phases/NN-name.md`** — one per phase (P0 through P18). Self-contained — when working on a phase, read its subplan + the relevant spec sections it references; don't try to hold the whole spec in context.

Always reach for the spec and the relevant phase subplan before inferring intent from code.

## Tech stack (locked — do not second-guess)

React 19 + Vite 6 + TypeScript (strict) · Tailwind v4 + shadcn/ui · Zustand + Immer · XState v5 · Dexie (IndexedDB) + Zod migrations · `@anthropic-ai/sdk` (BYOK, prompt-cached personas, tool-use responses) · Framer Motion · `react-force-graph-2d` for the social web · Biome · Vitest + Playwright · Vercel/Netlify static SPA. **No backend in v1. No PixiJS/Phaser/Three.js. No Tauri/Electron. No Redux. No boardgame.io.** Rationale in `plans/MASTER.md` §2.

## Non-negotiable architectural rules

These come from the spec's §9 "Lessons Learned" plus the master plan §3. Treat them as hard constraints, not preferences.

1. **Pure-logic / orchestrator separation.** `src/game/rules/**` is pure: no imports from UI, persistence, LLM, runtime, or events. Runtime orchestrators wrap pure logic and own all side effects. Lint enforces this (`eslint-plugin-boundaries`).
2. **One canonical tick clock.** A single `tick: number` is authoritative. Every scheduled event stores an **absolute end-tick**, never a relative duration.
3. **Determinism.** No `Math.random()` outside `src/game/rng.ts`. The conversation layer (LLM) is the only non-deterministic subsystem and **must not advance the gameplay PRNG call-count**. The replay harness must produce identical state hashes across 30 runs of any campaign.
4. **Save migrations are named, pure, idempotent functions.** Each `migrate_vN_to_vN+1` lives in its own file with its own Vitest suite. No fall-through migration blocks. No cumulative side effects between migrations.
5. **Action gating is atomic.** Validate preconditions first; deduct resources second; apply effects third. Never deduct-then-error.
6. **Clamp at every mutation site.** Affection/composure/reputation/scandal/favor/hostility/happiness clamping is applied wherever the value is mutated — never only at display.
7. **Async UI mutations.** Every conversation round-trip uses `AbortController` and a `requestId` ref. Post-await mutations check the request hasn't been superseded.
8. **Typed everything.** Discriminated unions for state-machine states, Zod schemas for save versions and LLM responses, typed event publishers. No string-based runtime lookups.
9. **No god files.** Events are partitioned by domain (`runtime/events/scheme.ts`, `events/conversation.ts`, etc.). Views decompose by responsibility, not as monoliths.
10. **Designer constants in one place.** Every numeric tuning (thresholds, costs, durations, decay rates) lives in `src/game/constants.ts`. Identities (NPCs, houses, artifacts, traits) live in `src/game/fixtures/`. Never inline these in UI code.

## Phase discipline

Build in phases per `plans/MASTER.md` §6. P0–P4 are the spine — get determinism, separation, state machines, save migrations, and the LLM round-trip right before fleshing out features.

**When working on a phase:**
- Read that phase's subplan + the spec sections it references — that's enough context.
- Don't pre-implement features owned by a later phase. The phase boundaries are dependency-ordered for a reason.
- Each phase's "Out of scope" list is binding. If something feels missing, it's almost always owned by a later phase.
- Each phase's "Verification" section is the definition of done.

## Coding conventions

- **TypeScript strict mode**, plus `noUncheckedIndexedAccess`.
- **Pure-logic modules return new state**, never mutate. Use Immer at the store/orchestrator boundary, not inside rules.
- **State machines are XState v5 actor refs** held in the Zustand store. Don't inline state-machine logic in components.
- **No comments that paraphrase code.** Comments explain non-obvious WHY — hidden constraints, subtle invariants, references to spec sections. Cite spec section (`§3 "Mood Transitions"`) for rule citations.
- **Tests live next to the code:** `economy.ts` and `economy.test.ts` colocated.
- **Pure-logic test coverage is the determinism contract** — aim for ~100% on `src/game/rules/**`. Coverage on UI is lower priority.
- **No emojis in code or comments** unless the user explicitly asks.

## LLM integration specifics

When wiring `src/llm/`:
- BYOK — user supplies their Anthropic key in the UI; never persist to disk, never log.
- Pre-flight key check is shape-only (`/^sk-ant-/`), no network round-trip.
- Structured output via the `respond` tool with `tool_choice: { type: "tool", name: "respond" }`. Validate response with Zod; clamp out-of-range fields defensively.
- Prompt-cache the per-character persona block (`cache_control: { type: "ephemeral" }`). Recency window (3 exchanges per `(houseId, targetCharId)`) is the dynamic suffix.
- Model routing: `claude-haiku-4-5` default; `claude-sonnet-4-6` or `claude-opus-4-7` on first-meeting (empty `(houseId, targetCharId)` history).
- 15-second timeout via `AbortController.signal.timeout()`.
- Failure paths (timeout, network, schema, missing key) must: not advance tick, not call combat resolver, not append to history, re-enable UI, surface banner. All four paths have Vitest coverage.
- Use the `claude-api` skill or Context7 MCP for SDK details — don't guess.

## Library documentation

Use the **Context7 MCP server** for library docs on React 19, Vite, Tailwind v4, shadcn, Zustand, Immer, XState v5, Dexie, Zod, the Anthropic SDK, Voyage AI, react-force-graph, Framer Motion, Vitest, Playwright, Biome. Prefer Context7 over web search or training-data recall.

## Verification expectations

Before declaring a phase or task done:
- `pnpm test` — all Vitest suites pass; deterministic replay harness produces identical hashes.
- `pnpm lint` — Biome clean; boundary-rule clean.
- `pnpm typecheck` — strict TS clean.
- For UI changes: run the dev server and exercise the golden path in a browser. If you can't test the UI, say so explicitly rather than claiming success.
- For LLM-touching changes: exercise all four failure paths (timeout, network, schema, missing key), not just the happy path.

## What not to do

- Don't introduce a backend / Supabase / Convex / auth service "to be safe." BYOK + IndexedDB is the design.
- Don't add a renderer (Pixi/Phaser/Three) for the map or ballroom — they're DOM.
- Don't add abstractions for hypothetical future requirements. Three similar lines beats a premature helper.
- Don't widen scope beyond the active phase's "In scope" list without an explicit user OK.
- Don't write multi-paragraph docstrings or feature-description comments. Code + spec section reference is enough.
- Don't fix a symptom by suppressing it — find the root cause. The "Lessons Learned" in `greenfield-spec.md` §9 enumerate the symptom-suppression patterns to avoid.

## Open questions

`plans/MASTER.md` §10 carries 24 open questions from `greenfield-spec.md` §10 with recommended v1 defaults. If you encounter one while working, surface it to the user — don't silently pick a different default than what's listed.
