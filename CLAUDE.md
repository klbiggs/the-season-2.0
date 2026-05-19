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

React 19 + Vite 6 + TypeScript (strict) · Tailwind v4 + shadcn/ui · Zustand + Immer · XState v5 · Dexie (IndexedDB) + Zod migrations · `@google/genai` (Gemini SDK; BYOK, context-cached personas, function-calling for structured output) · Framer Motion · `react-force-graph-2d` for the social web · Biome · Vitest + Playwright · Vercel/Netlify static SPA. **No backend in v1. No PixiJS/Phaser/Three.js. No Tauri/Electron. No Redux. No boardgame.io.** Rationale in `plans/MASTER.md` §2.

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
- **Determinism-sensitive deps are exact-pinned** (no caret). At P0 this is `seedrandom@3.0.5`; later phases that introduce libs whose internals affect hashing (anything participating in `hashableState` or save serialization) must do the same. Other deps may use `~` (patch-only). Document the rationale in a proximity comment when adding to the list.
- **Pure-logic modules return new state**, never mutate. Use Immer at the store/orchestrator boundary, not inside rules.
- **State machines are XState v5 actor refs** held in the Zustand store. Don't inline state-machine logic in components.
- **No comments that paraphrase code.** Comments explain non-obvious WHY — hidden constraints, subtle invariants, references to spec sections. Cite spec section (`§3 "Mood Transitions"`) for rule citations.
- **Tests live next to the code:** `economy.ts` and `economy.test.ts` colocated.
- **Pure-logic test coverage is the determinism contract** — aim for ~100% on `src/game/rules/**`. Coverage on UI is lower priority.
- **No emojis in code or comments** unless the user explicitly asks.
- **`src/game/hash.ts` is the canonical hash module.** Every phase that adds replay-relevant state extends `hashableState`'s projection; `GameStateSchema` (in `src/game/store.ts`) is the single source of truth for what counts as state, and `hashable-state-extension.test.ts` enforces the schema-keys ↔ projection-keys equality. Never compute a side-channel hash.
- **Boundary-rule tests use `ESLint.lintText` against synthetic source strings**, never on-disk `.ts.snippet` fixtures or extension-name games. See `eslint/boundaries.test.ts` for the pattern.
- **Stub-for-anchor.** When a boundary rule needs to reference a file that doesn't have implementation yet, ship the file with `export {};` and a single one-line comment explaining what anchors it (see `src/runtime/tickOrchestrator.ts`). The file existing is the contract.
- **`HouseId` is a branded `string`** (`type HouseId = string & { __brand: "HouseId" }`), exported from `src/game/rng.ts`. Never refer to a house by raw `string`; always cast at the boundary (`"player" as HouseId`) and propagate the type from there. **`CharacterId`, `MarriageId`, `TraitId` (added at P1) follow the same pattern** — branded strings exported from `rng.ts` with companion Zod schemas (`CharacterIdSchema`, etc.) using `.transform`, not `.brand`.
- **Phase-order discipline (P1).** `src/runtime/tickOrchestrator.ts` exports a frozen `PHASES: readonly TickPhase[]` array. Rivals always run last (spec §3); the phase chain order is the determinism contract. Never inline phase logic in components or other modules — substitute via the imported phase functions.
- **Year-pass is a distinct trigger from tick-advance.** Calling `runYearPass()` does NOT advance `tick`. They are two separate store actions with distinct state-mutation effects. Load-bearing for conception cadence, succession entry-point, and replay-harness scheduling.
- **Lex-sort iteration over identifier Maps.** Every rule that iterates a `Map<Id, Entity>` and consumes RNG must sort by Id first (matches the `serializeRegistry` lex-sort discipline from P0). When a rule iterates by house first, it uses lex-`houseId` outer / lex-`characterId` inner. See `src/game/rules/moods.ts` for the canonical pattern.
- **Locked characters skip BOTH the roll AND the draw.** Regression bait — drawing-and-discarding on locked characters silently shifts every other character's downstream draw by one. See `src/game/rules/moods.ts`'s `rollMoodDrift`.
- **Lifespan distribution is `[70, 95]` uniform integer** per `LIFESPAN_RANGE` constant in `src/game/constants.ts` (resolves spec §10 Q18). Future phases extending lifespan via trait modifiers must keep the base distribution intact or bump the save version.
- **Characters / Houses / Marriages are never deleted; status flips only.** `state.characters` grows monotonically across a campaign; death sets `alive: false`, NOT removal. Same for `state.houses` (heirless flag, not removal) and `state.marriages` (`dissolved: true`, not removal). Every `getCharacterOrThrow`-style lookup depends on this invariant.
- **Pure-rule structural-sharing contract.** Rules in `src/game/rules/**` return new state via hand-rolled shallow Map clones (`new Map(state.X)` + `.set(...)` + spread). Never mutate input state or input Maps; never use Immer inside `src/game/rules/**` (Immer is the store/orchestrator boundary, not the rules layer).
- **In-memory `z.map(...)` vs save-format `z.array(z.tuple(...))`.** `GameStateSchema` (in `src/game/entities.ts`) uses `z.map` so rules can call `state.characters.get(...)`. `SaveV3Schema` uses `z.array(z.tuple(...))` for stable on-disk serialization (same form as SaveV1 and SaveV2). The two forms are bridged by `serializeRegistry` / `deserializeRegistry`. Never copy the array shape into the in-memory schema.
- **Save migrations declare an `outputSchema`** matching their target version's `SaveV{to}Schema`. The migration runner Zod-parses each step's output against this schema before the next step runs. A migration that ships without an `outputSchema` is incomplete.
- **Every save migration ships an idempotence Vitest assertion** of the form `expect(migrate(fixture)).toEqual(migrate(fixture))` (via the `assertMigrationIdempotent` helper in `src/persist/migrations/__test-utils__/idempotence.ts`). Catches non-deterministic migrations before they ship.
- **`SaveLoadError` is the load-path error contract.** All errors thrown by `load()` during a load attempt are instances of `SaveLoadError` and carry a `userMessage: string` field. UI surfaces rendering these errors display `err.userMessage`; the technical `message` is for logging. Programmer-error throws at module-load time (e.g., `assertMonotonic`) are NOT part of this contract — they throw plain `Error` and surface only at test-suite boot.
- **`GameState` fields default to "in schema, in projection, in hash"** unless there is a documented reason otherwise. The `hashable-state-extension.test.ts` enforces schema-keys ↔ projection-keys equality. P2's `campaignName` follows this default (renaming a campaign advances the hash). Excluded-from-hash fields are an exception that requires its own ledger entry in the projection and a `// excluded-from-hash: <reason>` inline comment.
- **Schema↔projection↔selector triple-sync (P3).** Adding a top-level `GameState` field requires updates to three surfaces: `GameStateSchema` (in `src/game/entities.ts`), `hashableState` (`src/game/hash.ts`), and `selectGameState` (`src/game/store.ts`). The trip-wire at `src/game/schema-projection-selector-extension.test.ts` enforces all three by `Object.keys` comparison. Forgetting `selectGameState` breaks `save()` silently — Zod parse fails at write time, not at field-add time. Also update `createInitialState` and every `set`-style state copy in `store.ts` (`advanceTick`, `runYearPass`, `replaceState`, and every P3+ player-elected action).
- **Player-elected actions follow the pre-tick action pattern (P3).** All four P3 actions (travel, requestAudience, escapeBankruptcy, refreshWardrobe) mutate `GameState` first via a pure rule function, then call `advanceTickPure` through a store-action wrapper. This guarantees same-tick ordering invariants (notably the §7 audience-drops-rival-hostility-before-rival-phase contract) without orchestrator-internal reordering. New player-elected actions in later phases (P5 schemes, P8 reconciliation) follow this same shape. Rejections are returned as typed discriminated unions (`{ ok: false; reason: SomeRejection }`), never thrown — the UI renders rejection-specific prose.
- **Event-bus is a typed `Map<EventVariant["kind"], Set<Subscriber>>` pub/sub at `src/runtime/events/bus.ts` (P3).** Event types are partitioned per domain (`location.ts`; future phases add `conversation.ts`, `scheme.ts`, etc.). **`bus.publish` fires from store-action wrappers ONLY, AFTER `set` returns** — never from inside the orchestrator's phase chain (which must stay pure) and never from inside an Immer producer body. React subscribers register via the `useBusEvent<K>(bus, kind, handler)` hook (or raw `useEffect` + `bus.subscribe` with explicit cleanup). Future phases inherit this discipline.

## LLM integration specifics

When wiring `src/llm/`:
- BYOK — user supplies their Gemini API key in the UI; never persist to disk, never log.
- Pre-flight key check is shape-only (`/^AIza/`), no network round-trip. Google API keys conventionally start with `AIza` followed by 35 chars.
- Structured output via function-calling: a single `FunctionDeclaration` named `respond` declared in `tools[].functionDeclarations`, forced via `config.toolConfig.functionCallingConfig: { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: ["respond"] }`. Validate `response.functionCalls[0].args` with Zod; clamp out-of-range fields defensively.
- Context-cache the per-character persona block via `ai.caches.create({ model, config: { systemInstruction, ttl: "3600s" } })` (explicit, stateful — different from Anthropic's per-message implicit `cache_control`). Subsequent `generateContent` calls pass `config.cachedContent: cache.name`. Cache misses fall back to non-cached prompts.
- Model routing: `gemini-3.5-flash` default; `gemini-3.1-pro-preview` on first-meeting (empty `(houseId, targetCharId)` history).
- 15-second timeout via `AbortController.signal.timeout(15_000)` passed in `config.abortSignal`.
- Failure paths (timeout, network, schema, missing key) must: not advance tick, not call combat resolver, not append to history, re-enable UI, surface banner. All four paths have Vitest coverage.
- Use the Context7 MCP for `@google/genai` SDK details — don't guess.

## Library documentation

Use the **Context7 MCP server** for library docs on React 19, Vite, Tailwind v4, shadcn, Zustand, Immer, XState v5, Dexie, Zod, the Google Gen AI SDK (`@google/genai`), Voyage AI, react-force-graph, Framer Motion, Vitest, Playwright, Biome. Prefer Context7 over web search or training-data recall.

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
