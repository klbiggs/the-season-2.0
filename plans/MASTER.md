# *The Season* — Master Plan

> Master plan for rebuilding *The Season* greenfield in the browser. Source spec is `../greenfield-spec.md`; §-references throughout point there. Per-phase subplans live in [`phases/`](./phases/).

---

## Table of Contents

1. [Context](#1-context)
2. [Tech Stack (Decisions)](#2-tech-stack-decisions)
3. [Architecture Principles](#3-architecture-principles)
4. [Repository Layout](#4-repository-layout)
5. [Cross-Cutting Contracts](#5-cross-cutting-contracts)
6. [Phase Index](#6-phase-index)
7. [Capability Map (§3 → Phase)](#7-capability-map)
8. [Edge Cases (§7 → Phase)](#8-edge-cases)
9. [Non-Functional Requirements (§8) Cross-Reference](#9-non-functional-requirements)
10. [Open Questions (§10)](#10-open-questions)

---

## 1. Context

*The Season* is a single-player, turn-based, browser-based social-strategy and dynasty-simulation game set in Regency / early Victorian Britain. The player guides a noble house across multiple generations: managing wealth, reputation, scandal, marriages, schemes, whispers, duels, and faction politics. The signature interaction is a conversational ballroom where natural-language player input is resolved by a deterministic combat engine modulated by an LLM phrasing-quality multiplier.

**Why now:** A prior implementation (apparent Godot codebase based on §9 idioms) is being rewritten greenfield in the browser to address structural concerns from the §9 "Lessons Learned": pure-logic/runtime separation, deterministic replay, decomposed views, pure-function save migrations, and disciplined async UI mutation.

**Hard frame:**
- Browser-based; no desktop wrapper (Tauri, Electron) in scope.
- Single-player; LLM conversation proxied through a localhost-only Node server holding the API key.
- No public backend; the game runs on the developer machine only (the proxy is single-user and not deployed).

---

## 2. Tech Stack (Decisions)

| Concern | Choice | Why |
|---|---|---|
| Framework | **React 19 + Vite 6 + TypeScript (strict)** | Largest ecosystem for the dense informational UI this game needs; type-system carries the discriminated-union state machines and LLM response schemas |
| Styling / components | **Tailwind v4 + shadcn/ui** | Dense ledger UI, modals, tabs, form panels — shadcn composables map 1:1 to the game's surfaces |
| State | **Zustand + Immer** | Lean, no boilerplate, plays well with pure-logic separation; Immer lets per-tick mutations read naturally while staying structurally immutable |
| State machines | **XState v5** | §3 explicitly enumerates 6+ state machines; modeling them inline prevents in-between-states bugs |
| Determinism | **`seedrandom` wrapped in a per-house `Rng` with `{seed, callCount}`** | Round-trips through save/load; one canonical source forbidden from `Math.random` (lint-enforced) |
| Persistence | **Dexie (IndexedDB) + Zod-validated migrations** | Saves can grow large with embeddings; IndexedDB handles it; migrations are named pure functions per §9 |
| LLM | **`@google/genai` on a localhost Node proxy; key in `server/.env`; persona context-cached server-side; function-calling for structured output via `/api/llm/conversation`** | Forces structured outputs via function-calling (validated by Zod), caches per-character persona via explicit `caches.create` resources between turns; the key never reaches the browser bundle |
| Local LLM proxy | **Node 22+ http (no framework), bound to 127.0.0.1:8787** | Single endpoint; holds Gemini key out of the bundle without adding a hosted backend |
| Embeddings (optional, deferred) | **Voyage AI** | Best-in-class retrieval quality; cheap; in-browser cosine similarity over a bounded array — no vector DB needed at this scale |
| Animations | **Framer Motion** | DOM-native, perfect for portrait slides on faux-pas/sabotage/scheme completion |
| Social web visualization | **react-force-graph-2d** (canvas-backed, D3-force under the hood, custom node sprites for portraits) | The one spatial surface in the app |
| All other rendering | **DOM + CSS + SVG** | Strategy map = 7 location pins. Ballroom = 5 portrait cards. Elopement = 7-tile row. Ledger = tables. No game engine needed. |
| Lint / format | **Biome** | Single config, faster than ESLint+Prettier |
| Tests | **Vitest** (pure logic ~100% coverage) + **Playwright** (UI flows) | Pure-logic tests are the determinism contract |
| Hosting | **Local dev only** (`pnpm dev` runs Vite + Node proxy concurrently) | Not deployed publicly in v1 |

**Explicitly NOT in the stack:**
- No PixiJS / Phaser / Three.js (visual budget doesn't justify a renderer).
- No *public* backend / Supabase / Convex / auth service. The localhost proxy is the single concession — single-user, never deployed, holds only the Gemini key.
- No boardgame.io (its turn/phase abstractions don't fit the spec's irregular tick clock).
- No Redux / Redux Toolkit (Zustand + Immer covers it).
- No Tauri / Electron (browser only).

---

## 3. Architecture Principles

Distilled from §9, keeping only framework-agnostic guidance:

1. **Pure gameplay logic separated from runtime orchestration.** Combat math, scheme resolution, mood drift, succession, duel resolution, marriage acceptance, economy tier classification — these live in `src/game/rules/` with zero imports from UI, persistence, LLM, or events. Runtime orchestrators wrap them and own all side effects.
2. **One canonical tick clock.** A single `tick: number` is the source of truth. Every scheduled event stores an absolute end-tick, never a relative duration.
3. **Topically-partitioned event modules.** No single `events.ts` god file. Group by domain (`events/scheme.ts`, `events/conversation.ts`, `events/family.ts`).
4. **Decomposed views.** The map and ballroom views split by responsibility (tick orchestration, location routing, tactic dispatch, scheme panel state, conversation flow) — each independently testable.
5. **Centralized fixture & constants registries.** NPC names, house names, artifact definitions, trait registry, mood registry, location deltas, scheme costs/durations — every tunable in `src/game/constants.ts` or `src/game/fixtures/`, never in UI code.
6. **Pure-function save migrations.** Each `vN → vN+1` is a named idempotent function with its own Vitest suite. The runner composes them.
7. **Async continuation safety.** Every conversation round-trip uses `AbortController` threaded through `fetch`, and post-await state mutations check that the request hasn't been superseded (a `requestId` ref pattern). This is the React equivalent of §9's three-fold guard.
8. **Determinism boundary is explicit.** The non-deterministic LLM layer must not touch the gameplay PRNG call-count. Enforced by lint: only `src/game/rules/**` and `src/runtime/tickOrchestrator.ts` may import from `src/game/rng.ts`.
9. **Typed dependency injection / typed registry — no string-based runtime lookups.** Every cross-component reference is typed.
10. **Action gating is atomic.** No "deducted wealth then errored" paths. Validate preconditions first; deduct second; apply effects third.

---

## 4. Repository Layout

```
the-season-2.0/
├── greenfield-spec.md                 # Source of truth (read-only reference)
├── plans/                             # This master plan + per-phase subplans
│   ├── MASTER.md
│   └── phases/00-foundation.md … 18-llm-flavor.md
├── package.json
├── vite.config.ts
├── tsconfig.json
├── biome.json
├── index.html
└── src/
    ├── main.tsx
    ├── App.tsx                        # View shell: Map | Ballroom | Ledger | Elopement
    ├── game/
    │   ├── constants.ts               # All §3 tuning values in one place
    │   ├── rng.ts                     # Per-house seeded PRNG + call-count
    │   ├── rules/                     # PURE. No non-rule imports.
    │   │   ├── combat.ts              # Affection/Composure deltas, stance modifiers
    │   │   ├── economy.ts             # Bankruptcy tier classification, per-tick deltas
    │   │   ├── schemes.ts             # Cost/duration/prerequisite resolution
    │   │   ├── moods.ts               # Drift roller, faux-pas lock
    │   │   ├── duel.ts                # 12-exchange resolver
    │   │   ├── elopement.ts           # Sprint advance/win conditions
    │   │   ├── marriage.ts            # Proposal acceptance, conception, inheritance
    │   │   ├── succession.ts          # Heir resolution, archetype classification
    │   │   ├── rivals.ts              # Action weighting, hostility decay
    │   │   ├── patronesses.ts         # Favor erosion, veto checks
    │   │   ├── whispers.ts            # Verification progress, weaponization branches
    │   │   ├── artifacts.ts           # Wardrobe decay, forgery surfacing, theft notice
    │   │   ├── siblingRivals.ts       # Promotion at succession, action roller
    │   │   ├── inheritedSecrets.ts    # Surfacing, blood feuds
    │   │   ├── dynastyLegacies.ts     # Perk trigger evaluation
    │   │   ├── globalEvents.ts        # WarEffort, MarketCrash, MonarchsMood
    │   │   ├── era.ts                 # Era transition
    │   │   ├── happiness.ts           # Dull-spouse drain, temptation hook
    │   │   ├── promenade.ts           # Hyde Park resolution
    │   │   ├── staff.ts               # Loyalty drift, bribery roll, assignment outputs
    │   │   └── courier.ts             # Transit time lookup (per location pair)
    │   ├── machines/                  # XState definitions (see §5.2)
    │   ├── fixtures/                  # NPCs, houses, artifacts, traits, locations, patronesses, factions
    │   └── store.ts                   # Zustand + Immer (thin reducer over rules/)
    ├── runtime/                       # Orchestrators (side effects)
    │   ├── tickOrchestrator.ts        # Fixed-order phase runner
    │   ├── conversationOrchestrator.ts
    │   ├── schemeOrchestrator.ts
    │   ├── elopementOrchestrator.ts
    │   ├── successionOrchestrator.ts
    │   └── events/                    # Topically partitioned (scheme, conversation, family, scandal, ...)
    ├── llm/
    │   ├── client.ts                  # Gemini SDK setup, BYOK, timeout, abort
    │   ├── prompts/                   # Cacheable persona blocks per character
    │   ├── tools.ts                   # `respond` + `generateWhisper` tool schemas
    │   ├── routing.ts                 # Haiku default; Sonnet/Opus for first-meeting
    │   └── embeddings.ts              # OPTIONAL — Voyage client (deferred)
    ├── persist/
    │   ├── schema.ts                  # Zod schemas per save version
    │   ├── migrations/                # Named pure functions vN → vN+1
    │   ├── dexie.ts                   # IndexedDB setup
    │   └── vectorIndex.ts             # OPTIONAL — embedding sidecar
    └── ui/
        ├── map/
        ├── ballroom/
        ├── ledger/
        ├── elopement/
        ├── socialWeb/
        ├── promenade/
        └── shared/                    # shadcn/ui composables, theming
```

---

## 5. Cross-Cutting Contracts

### 5.1 Determinism

- **PRNG:** `seedrandom`-based, wrapped per-house. Every draw advances `callCount`. Save stores `{seed, callCount}`; load re-seeds then advance-draws `callCount` times.
- **Per-tick phase order is fixed** (§3 "Tick-Driven Time Advancement"): time advance → economy → courier draining → scheme resolution → global-event roll → mood drift → rival action roll. Rival action **always runs last** so its draws can't perturb earlier seeded outcomes.
- **The conversation layer is excluded** and must not advance the gameplay PRNG call-count.
- **Lint rule + Vitest sanity test:** grep-fail on `Math.random` outside permitted files; `eslint-plugin-boundaries` confines `src/game/rng.ts` imports.
- **Replay harness:** Vitest runs 30 identical-seed campaigns; final state hash must be identical across all 30 (§8).

### 5.2 State Machines Catalog (§3)

| Machine | States | Triggers |
|---|---|---|
| Whisper (P6) | Unverified → Verified → Weaponized \| Dismissed; subject-death cascade auto-flips Unverified/Verified → Dismissed (Weaponized whispers persist past subject death) | Tick verification progress (+10/tick toward 100 once arrived); player weaponize/dismiss action; subject-death cascade via `pruneOrphanedConversationKeys` |
| CourierPayload (P6) | InFlight → Delivered \| Intercepted \| Cancelled | Absolute `arrivalTick` reached; InterceptMail staff cadence; Spymaster player action |
| Staff (P6) | `assignment: Snoop \| BribeDriver \| InterceptMail \| None` ↔ each other (player) → `BribedByRival` (terminal — fire-staff action ships P15+) | Per-tick loyalty drift on `wealth < 0` (Greedy -2/tick; base -1/tick); per-tick bribery roll (5% × Greedy × loyalty<30); player reassignment via `assignStaff` |
| Scheme | Active → Completed \| Cancelled \| Failed | Tick countdown; player cancel; prerequisite invalidation. **P5: implemented as a `Scheme.status` field on the entity, NOT a literal XState actor** — per-scheme actors would multiply ref counts by N-active-schemes and complicate save/load serialization with no behavioral benefit. The pure resolver in `applySchemeResolutionPhase` + `cancelScheme` gates the transitions. |
| Marriage | Active → Dissolved | Spouse death |
| Era | Earlier → Later | Fixed tick threshold (one-way) |
| Mood (per NPC) | Receptive \| Defensive(locked) \| Distracted \| Jealous \| Grieving | Per-tick drift roll; reactive on faux-pas |
| Bankruptcy tier | Solvent \| Hemorrhaging \| Embarrassed \| Ruined | Recomputed each tick from wealth |
| Conversation round-trip | Idle → Sending → Resolving → Done \| Failed | Player send; LLM response; abort/timeout |
| Elopement sprint | Running → Won \| Lost | Player tile = 7 (win); father tile = 7 or composure ≤ 0 (loss) |
| Sibling-rival | Active → Reconciled | Hostility decays to 0 OR successful reconciliation action |
| Forgery | Unsurfaced → Surfaced | Per-tick surfacing roll |
| Global event | Active → Expired | Absolute end-tick reached |
| View routing | Map \| Ballroom \| Ledger \| ElopementOverlay | Player navigation; overlay suspends Map |

All machines live in `src/game/machines/` and are XState v5 actor refs held in the Zustand store.

### 5.3 Save Migration Discipline

- Save format is JSON, versioned by an integer `version` field.
- Each migration is a named pure function: `export function migrate_v3_to_v4(state: SaveV3): SaveV4`.
- A migration runner composes them in order: `runMigrations(state, fromVersion, toVersion)`.
- Each migration has its own Vitest file with example fixtures.
- **Forbidden:** sequential-fall-through migration blocks; cumulative side effects between migrations.
- Schema is Zod-validated per version (`SaveV3Schema.parse(state)` before running migrations from v3).
- The vector index (optional) is a binary sidecar keyed by save-game identifier — not part of the JSON save.

### 5.4 LLM Integration Contract (§5) — P7.5 relocated to localhost proxy

- **Transport:** SPA → `POST /api/llm/conversation` → localhost Node proxy (`server/`, bound to `127.0.0.1:8787`) → Gemini SDK. The SDK is no longer in the browser bundle (moved to `devDependencies`). The proxy holds the key in `server/.env` (gitignored); browser never sees it.
- **Wire format:** `ProxyConversationRequestSchema` in `src/llm/types.ts` (shared client/server). Includes a `characterStateSnapshot` carrying the persona-relevant Character/Marriage state — server reads the snapshot directly without consulting GameState. The rules-layer `pinnedIntent` is NOT on the wire; it stays client-side.
- **Routing:** server-decided in `server/routing.ts` based on conversation history. First-meeting (empty history) → `gemini-3.1-pro-preview`; subsequent turns → `gemini-3.5-flash`.
- **Structured output via function-calling.** Single forced function `respond` (server registers both `RESPOND_TOOL` and `GENERATE_WHISPER_TOOL` per `server/tools.ts`); `config.toolConfig.functionCallingConfig.mode = ANY` with `allowedFunctionNames: ["respond"]`. Server validates the response shape with Zod (`ConversationResponseSchema`) before returning; client re-validates defensively.
- **Context caching:** lives server-side in `server/personaCache.ts` (in-memory `Map<key, {name, createdAt}>` with 60-min TTL via `PERSONA_CACHE_TTL_MS`). Browser invalidation hook (`TargetCharacterDied` event) POSTs to `/api/llm/persona/invalidate` (fire-and-forget). Cache lifetime = server process lifetime; dev-server restart wipes the map. Cache-create failures (non-abort) swallow and fall back to passing `systemInstruction` directly that turn.
- **Timeout budget:** orchestrator owns a 15s client-side `AbortController` (composed with the user-exit signal via `AbortSignal.any`); server owns a 13s composite AbortController covering BOTH `caches.create` AND `generateContent`. First-meeting Pro paths can plausibly exceed 13s — accepted v1 behavior; client retries hit the now-populated cache.
- **Failure paths** (timeout, network, schema, cancelled — `missing-key` removed at P7.5 since the browser no longer holds a key):
  - Do NOT advance the tick.
  - Do NOT call the combat resolver.
  - Do NOT append to conversation history.
  - DO re-enable UI controls + surface a user-readable banner.
- **Pre-flight key check:** lives in `server/env.ts:validateEnv()`, called from `listen()` (NOT module-load) — fails fast with a clear assertion if `GEMINI_API_KEY` is missing or shape-malformed (`/^AIza/`). The regex moved from `src/game/constants.ts` to `server/env.ts`; no client-side consumer remains.
- **Pin-always-overrides** (`narrowResponse` + `resolveTactic` + `resolveMoodHint` in `src/llm/types.ts`) stays CLIENT-SIDE only — the server never narrows; combat-rule pin handling lives next to the rest of combat logic.
- **Out-of-range values clamped defensively**, not errored.
- **Unknown classifications fall back to the pinned intent (or Flattery if none pinned).**

### 5.5 Pure Logic / Orchestrator Separation

- `src/game/rules/**` may import only from: `src/game/constants.ts`, `src/game/fixtures/**`, `src/game/rng.ts`, and other `src/game/rules/**` files.
- `src/runtime/**` orchestrates: calls rules, mutates the Zustand store, publishes events, schedules UI updates.
- `src/ui/**` reads from the Zustand store; player actions dispatch through orchestrators.
- **Lint enforcement:** `eslint-plugin-boundaries` config codifies this.

### 5.6 Event System

- Topically partitioned modules under `src/runtime/events/`: `scheme.ts`, `conversation.ts`, `family.ts`, `scandal.ts`, `economy.ts`, `combat.ts`, `tick.ts`.
- Each module defines its own typed event variants (discriminated unions) and publisher.
- Subscribers register via React effects; **every subscription pairs with a cleanup unsubscribe** (§9).
- No global string-keyed event bus.

### 5.7 Fixture Registry & Designer Constants

- `src/game/constants.ts` — every numeric tuning in §3: trait base value (10), bonus value (+15), penalty value (−10), quality bounds [0.5, 1.5], affection threshold (80), reputation threshold (40), proposal slope endpoints (0.5, 0.95), conception cadence (2 years), fertility ceiling (40), succession reputation penalty (−20), scheme costs/durations, etc.
- `src/game/fixtures/` — every named identity: 32 traits, 5 moods, 7 locations, 7 scheme types, 4 tactics, 5 patronesses, 3 rival houses, 3 factions, 2 eras, 3 global events, artifact registry.

---

## 6. Phase Index

| # | Phase | Subplan | Depends on | Status |
|---|---|---|---|---|
| P0 | Foundation: setup, RNG, save scaffold | [`phases/00-foundation.md`](./phases/00-foundation.md) | — | ✅ done |
| P1 | Tick Engine & Pure Rules | [`phases/01-tick-engine.md`](./phases/01-tick-engine.md) | P0 | ✅ done |
| P2 | Save/Load & Migrations | [`phases/02-save-migrations.md`](./phases/02-save-migrations.md) | P0 | ✅ done |
| P3 | Strategy Map & Locations | [`phases/03-strategy-map.md`](./phases/03-strategy-map.md) | P1 | ✅ done |
| P4 | LLM Conversation & Ballroom | [`phases/04-ballroom-llm.md`](./phases/04-ballroom-llm.md) | P0, P1 | ✅ done |
| P5 | Schemes & Multi-Tick Operations | [`phases/05-schemes.md`](./phases/05-schemes.md) | P1, P4 | ✅ done |
| P6 | Whispers, Espionage & Staff | [`phases/06-whispers-espionage.md`](./phases/06-whispers-espionage.md) | P1, P4, P5 | ✅ done |
| P7 | Family, Marriage & Succession | [`phases/07-family-succession.md`](./phases/07-family-succession.md) | P1 | ✅ done |
| P7.5 | LLM key relocation to localhost proxy | [`phases/07-5-llm-relocation.md`](./phases/07-5-llm-relocation.md) | P4 | ✅ done |
| P8 | Rival Houses, Patronesses & Duels | [`phases/08-rivals-patronesses.md`](./phases/08-rivals-patronesses.md) | P1, P5 | ✅ done |
| P9 | Elopement Sprint Overlay | [`phases/09-elopement.md`](./phases/09-elopement.md) | P5 | ✅ done |
| P10 | Artifacts, Wardrobe, Forgery & Theft | [`phases/10-artifacts.md`](./phases/10-artifacts.md) | P7 | ✅ done |
| P11 | Sibling Rivals & Inherited Secrets | [`phases/11-sibling-rivals-secrets.md`](./phases/11-sibling-rivals-secrets.md) | P7, P6 | — |
| P12 | Hyde Park Promenade | [`phases/12-promenade.md`](./phases/12-promenade.md) | P3, P4, P10 | — |
| P13 | Global Events & Era Progression | [`phases/13-global-events-era.md`](./phases/13-global-events-era.md) | P1, P10 | — |
| P14 | Ledger View & Social Web Visualization | [`phases/14-ledger-social-web.md`](./phases/14-ledger-social-web.md) | most prior | — |
| P15 | Dynasty Legacies & Renown Perks | [`phases/15-dynasty-legacies.md`](./phases/15-dynasty-legacies.md) | P7, P5, P6 | — |
| P16 | Polish — Audio, i18n, Procedural Identity | [`phases/16-polish.md`](./phases/16-polish.md) | most prior | — |
| P17 | (Optional) Semantic Memory | [`phases/17-semantic-memory.md`](./phases/17-semantic-memory.md) | P4, P6, P5 | — |
| P18 | (Optional) LLM Flavor Content | [`phases/18-llm-flavor.md`](./phases/18-llm-flavor.md) | P4, P10 | — |

**Note**: P7.5 is a cross-cutting architectural amendment (LLM-key relocation), not a new feature phase. P8+ "Depends on" columns do NOT inherit P7.5.

---

## 7. Capability Map (§3 → Phase)

Every §3 capability is owned by exactly one phase:

| §3 Capability | Phase |
|---|---|
| View Routing Between Modes | P0 shell; P3 map; P4 ballroom; P9 elopement; P14 ledger |
| Tick-Driven Time Advancement | P1 |
| Strategy Map | P3 |
| Conversational Ballroom | P4 |
| Schemes | P5 (+ P10 Treason Framing) |
| Elopement Sprint | P9 |
| Marriage, Conception & Succession | P7 |
| Espionage & Whisper Ledger | P6 |
| Patronesses & Faction Politics | P8 |
| Duels & Grievances | P8 |
| Rival Houses | P8 |
| Mood Drift | P1 |
| Global Events | P13 |
| Ledger View | P14 |
| Save & Load | P0 scaffold; P2 migrations; all phases own their schema additions |
| Wardrobe, Artifacts & Heirlooms | P10 |
| Forgery & Theft | P10 |
| Treason Framing | P10 |
| Hyde Park Daytime Promenade | P12 |
| Staff Espionage (Downstairs Network) | P6 |
| Whisper Weaponization Branches | P6 |
| Sibling Rivals | P11 |
| Family Archetype Auto-Classification | P7 |
| Tutor Influence | P7 |
| Inherited Secrets & Blood Feuds | P11 |
| Dynasty Legacies | P15 |
| Social Web Visualization | P14 |
| Generated Flavor Content | P18 |
| Audio, Localization & Procedural Identity | P16 |
| Real Semantic Memory | P17 |
| Happiness Drain from Dull-Spouse | P7 |

---

## 8. Edge Cases (§7 → Phase)

| Edge case | Owning phase |
|---|---|
| Mid-conversation view exit | P4 |
| Heir promotion mid-conversation | P4 + P7 |
| Era-flip during a Smuggling scheme | P5 |
| Same-tick monarch's audience and rival action | P3 (audience) + P8 (rival order) |
| Cancellation of in-flight Seduction by Chaperone | P5 |
| Mood-lock cascade prevention | P1 (mood layer) + P4 (faux-pas trigger) |
| Affection/Composure mutation from multiple sites | enforced everywhere; lint + tests in P0/P1 |
| Save-data migration ordering | P2 |
| Rival-house associated-character pruning | P8 + P7 (death cascade) |
| Conversation history orphan keys | P6 + P4 |
| Forgery surfacing cascade | P10 |
| Theft against an unequipped artifact | P10 |
| Sibling-rival promotion of a corpse | P11 |
| Tutor reassignment after maturation | P7 |
| Wardrobe refresh during bankruptcy | P10 |
| Out-of-season artifact equipped mid-ball | P10 |
| Staff bribery while assigned to mail interception | P6 |
| Inherited-secret surface against a now-allied rival | P11 |
| Dynasty perk award during the same tick as succession | P15 |
| Embedding service failure during conversation start | P4 stub; P17 full |
| Cultural-pivot Monarch's Mood against no-artifact house | P13 |
| Action gating bypassed by mid-flight scheme starts | P5 |

---

## 9. Non-Functional Requirements (§8)

| NFR | Where enforced |
|---|---|
| 15-second conversation timeout | P4 |
| Save serialization synchronous, no UI stall | P2 |
| Conversation history < 50 KB | P4 bounded recency |
| Genealogical children list — old generations collapse to ancestor summary | P7 + P11 |
| Inherited-secrets ledger bounded | P11 |
| Artifacts/forgeries per house capped | P10 |
| Vector index capped FIFO | P17 |
| 30-run replay stability | P0 harness; every phase adds its own determinism tests |
| Credential never persisted / logged | P7.5 `server/.env` (gitignored); browser never sees the key |
| Structured logging on decision points | every phase |
| Conversation failure logging without credential leak | P4 |
| Designer constants in one canonical location each | P0 sets up `constants.ts`; every phase adds its own constants there |
| Save-data forward migratability | P2 |

---

## 10. Open Questions (§10)

Carrying forward all 24 open questions with a recommended default for each. Resolve before implementation begins.

| # | Question | Default for v1 |
|---|---|---|
| 1 | Heirs inherit patroness favor scores or reset? | **Inherit** (continuity > reset). **Resolved at P8** ([phases/08-rivals-patronesses.md](./phases/08-rivals-patronesses.md)); patroness favor is stored as a top-level `state.patronesses: Map<PatronessId, PatronessRecord>` keyed by patroness identity (NOT per-house). Succession (existing `applySuccessionStep` in `runYearPass`) leaves this Map untouched, so the heir reads the same favor values the prior head did — "inherit" is free of any copy-on-promote action. |
| 2 | Rival-house registry procedurally seeded or canonical? | **Canonical** (matches prior implementation; predictability for testing). **Resolved at P8** ([phases/08-rivals-patronesses.md](./phases/08-rivals-patronesses.md)); `RIVAL_HOUSES_FIXTURE` at `src/game/fixtures/rivals.ts` ships three hardcoded `RivalHouseSeed` entries (id, displayName, factionId, startingReputation, startingHostility, associatedCharacterIds). Bootstrap seeds the fixture into `state.houses` (rivals are full `House` entities, not a separate registry) + `state.rivalActors: Map<HouseId, RivalActorState>` for the per-rival action loop. The V8→V9 migration seeds the same fixture into legacy saves via `seedRivalsAndPatronessesIntoLegacyState`. |
| 3 | Sibling-rival mechanic active in v1? | **Yes** (specced detail level suggests intent) |
| 4 | Archetype classification on mid-life trait acquisition? | **No** — only at succession + child maturation per §3. **Resolved at P1** ([phases/01-tick-engine.md](./phases/01-tick-engine.md)); P7 implements full rules. |
| 5 | LLM routing for proposal/scheme/duel/audience in v1? | **No** — first-meeting only. **Resolved at P4** ([phases/04-ballroom-llm.md](./phases/04-ballroom-llm.md)); `routeModel(history)` is the single decision point — empty `(houseId, targetCharId)` history → Gemini Pro, otherwise Gemini Flash. Pre-wiring (proposal/scheme/duel/audience override seams) is explicitly NOT shipped at P4. |
| 6 | Seduction discovery one-shot or multi-tick suspicion? | **Resolved at P5** ([phases/05-schemes.md](./phases/05-schemes.md)): one-shot binary at completion with `SEDUCTION_DISCOVERY_PROBABILITY = 0.2`. Multi-tick suspicion is a v1.5 candidate — its surface area (per-tick rolls, NPC suspicion levels, mid-flight cancellation paths) doesn't fit the v1 elopement-sprint scope and would force a save-format change. `accumulatedAffection` field reserved on the Scheme entity for the eventual v1.5 transition. |
| 7 | Treason Framing in v1? | **Yes** — ships with P10. **Resolved at P10** ([phases/10-artifacts.md](./phases/10-artifacts.md)); 7th scheme kind in the `Scheme.kind` discriminated union, gated on at least one unsurfaced `ForgeryRecord` in `state.forgeries`. `tryStartScheme` gains `MissingUnsurfacedForgery` rejection variant. Completion flips `forgery.surfaced = true` (the consumed forgery cannot back a second Treason Framing). Apex outcome of the forge-loop; deferring would ship the artifact registry as an inert economic dead-end. |
| 8 | Faction tension graphical visualization? | **No** — numeric in rival ledger only. **Resolved at P8** ([phases/08-rivals-patronesses.md](./phases/08-rivals-patronesses.md)); faction tension lives as `state.factionTensions: Map<FactionPairKey, number>` (3 factions → 3 unordered pairs). The Rivals ledger tab renders a 3×3 numeric matrix (diagonal blank); no D3/force-graph or canvas node. Graphical viz is a v1.5 candidate. |
| 9 | Social Web replaces textual ledgers? | **Coexist** in v1 |
| 10 | Wardrobe decay global tick or per-artifact-family? | **Global tick** (simpler; per-family in v1.5). **Resolved at P10** ([phases/10-artifacts.md](./phases/10-artifacts.md)); single `WARDROBE_REFRESH_INTERVAL_TICKS` constant in `src/game/constants.ts` applied uniformly across every artifact family. Per-family decay would add tuning surface (per-family `refreshIntervalTicks` field or designer table) without changing the wardrobe-refresh affordance (one wealth spend resets ALL equipped artifacts regardless of family). Per-family decay pairs naturally with P16's procedural artifact generation as a v1.5 candidate. |
| 11 | Forged artifacts detectable by Observant NPCs? | **Hidden until per-tick surfacing roll** (simpler). **Resolved at P10** ([phases/10-artifacts.md](./phases/10-artifacts.md)); single surfacing mechanism via `FORGERY_SURFACING_PROBABILITY` per-tick roll. Parallel Observant-trait detection would fork the cascade semantics (Vain-NPC lock + affection delta vs. Observant-only knowledge), forcing dual cascade paths and per-NPC trait scans against the per-tick draw budget. Observant retains value elsewhere (P11 inherited-secrets detection, future hooks). `ForgeryRecord.surfaced` is a one-way latch flipped by `applyForgerySurfacingPhase` (roll) + the Treason Framing scheme-resolution branch (consumption). |
| 12 | Semantic-memory subsystem in v1? | **Deferred to v1.5** (P17 optional) |
| 13 | LLM tool surface beyond whisper-generation in v1? | **Whisper only** in v1. **Resolved at P4** ([phases/04-ballroom-llm.md](./phases/04-ballroom-llm.md)); P4 ships only the structured `respond` function-declaration. The `generateWhisper` function-declaration is wired at P6 once whispers exist (added alongside `respond` in the `tools[].functionDeclarations` array). No grievance/secret-sharing/mood-reveal tools in v1. |
| 14 | NPC-initiated conversations in v1? | **Deferred**. **Resolved at P4** ([phases/04-ballroom-llm.md](./phases/04-ballroom-llm.md)); the conversation round-trip is strictly player-initiated. No "NPC speaks first" prompt path, no autonomous greeting machine. |
| 15 | Streaming dialogue in v1? | **No** — single-shot "thinking..." pattern. **Resolved at P4** ([phases/04-ballroom-llm.md](./phases/04-ballroom-llm.md)); the SDK call is `ai.models.generateContent(...)` (non-streaming; the SDK's `generateContentStream` variant is NOT used), gated by a single 15s `AbortController.signal.timeout()` passed via `config.abortSignal`. No partial-token render path, no mid-stream cancellation. |
| 16 | Cross-house marriages with rivals? | **Deferred to v1.5**. **Resolved at P7** ([phases/07-family-succession.md](./phases/07-family-succession.md)); proposal-rule layer rejects rival-house targets with `{ kind: "CrossHouseMarriageNotSupported" }` rejection variant. Alliance/hostility-cascade surface area pairs with P8 rival entities; bundling in v1 compounds risk and forces `MarriageRecordSchema` changes. |
| 17 | Pre-adulthood betrothals? | **Deferred to v1.5**. **Resolved at P7** ([phases/07-family-succession.md](./phases/07-family-succession.md)); proposal-rule layer rejects pre-adulthood targets with `{ kind: "TargetTooYoung" }` rejection variant. Betrothal entity + Pending/Honored/Broken lifecycle is a parallel mini-subsystem out of P7 scope. |
| 18 | Lifespan fixed or per-character rolled? | **Per-character rolled**, uniform integer `[70, 95]` (varied siblings is good gameplay). **Resolved at P1** ([phases/01-tick-engine.md](./phases/01-tick-engine.md)); trait modifiers deferred to P7. |
| 19 | Staff-espionage subsystem in v1? | **Yes** — specced. **Resolved at P6** ([phases/06-whispers-espionage.md](./phases/06-whispers-espionage.md)). Ships 4 baseline staff (Mrs. Hudson / Thompson / Greer / Pell), 5 assignment slots (Snoop / BribeDriver / InterceptMail / None / BribedByRival), per-tick loyalty drift on underpayment (Greedy faster), per-tick bribery roll for Greedy sub-threshold staff, cadence-based outputs per assignment. Bribed-staff outbound whispers route to `INDEPENDENT_HOUSE_ID` at P6 (inert consumer); P8 routes to real rivals. Spymaster mail-intercept rule-layer ships; UI disabled until P7 produces a real archetype. |
| 20 | Three weaponization branches simultaneously? | **All three** in v1. **Resolved at P6** ([phases/06-whispers-espionage.md](./phases/06-whispers-espionage.md)). Each branch has a distinct decision-tree shape (Blackmail = small certain cost / certain reward; Scandal Sheet = no scandal cost / large damage / 15% self-exile attribution; Accidental Slip = no scandal cost / slow drip across 5 conversation turns). Shipping one at a time would leave the player with a single tactical shape until subsequent phases ship the others, defeating the spec's "three meaningful choices" intent. |
| 21 | Cultural-pivot before artifact registry ships? | **N/A** — P10 (artifacts) ships before P13 (events) |
| 22 | Dynasty perks retroactive? | **No** — going-forward only |
| 23 | Dull-spouse temptation hook auto-unlocks or ledger-elected? | **Auto-unlock on threshold crossing** (less friction). **Resolved at P7** ([phases/07-family-succession.md](./phases/07-family-succession.md)); `temptationHookUnlocked: boolean` field on Character is a one-way latch (set true on first sub-threshold tick post-Dull-marriage; never reverts). Gates discounted-scandal Seduction (`TEMPTATION_DISCOUNTED_SCANDAL = 5` vs P5 baseline `SEDUCTION_DISCOVERY_SCANDAL = 25`). |
| 24 | Allow concurrent player Seductions per aggressor at v1? | **One Seduction per aggressor at a time** (Q2 verdict). **Resolved at P9 PROVISIONALLY** ([phases/09-elopement.md](./phases/09-elopement.md)); `tryStartScheme` rejects `Seduction` with `{ kind: "SeductionAlreadyActiveForAggressor", activeSchemeId }` when an aggressor already owns an Active Seduction. Functionally per-house at v1 (`selectAggressor` returns the head for Seduction); future-proof for later phases that may widen the aggressor pool. Reopens if v1 play surfaces the constraint as too restrictive. |
| 25 | On elopement win with one party already married, mint marriage or apply rep-halve only? | **Rep-halve always; marriage minted only if both unmarried (or widow/widower remarriage)** (Q3 verdict). **Resolved at P9** ([phases/09-elopement.md](./phases/09-elopement.md)); `resolveElopementTerminal` Won-branch's marriage-mint predicate uses `isAvailableForRemarriage` (harmonized with `applyProposalPure` gates 10/11 — null marriageId OR the referenced marriage is dissolved). Preserves the affair-archetype Seduction gameplay tone while avoiding bigamous state shape. Future P-later "Abandonment" / "Divorce" action can model explicit dissolution-then-remarriage with its own cost surface. |
| 26 | Should ticks advance during an active elopement sprint? | **Suspend** — rule-layer gate on every tick-advancing and mutation action when `state.elopement !== null` (Q4 verdict). **Resolved at P9** ([phases/09-elopement.md](./phases/09-elopement.md)); the gate publishes `ElopementBlocked` on `elopementBus` for `advanceTick` / `runYearPass` / `proposeMarriage` and returns a typed `{ kind: "ElopementInProgress" }` rejection on every other player-elected wrapper. See CLAUDE.md "Modal-state rule-layer gate principle" pin. |

---

## TL;DR

> **React 19 + Vite + TS + Tailwind/shadcn + Zustand/Immer + XState v5 + Dexie + Zod + Google Gen AI SDK (context-cached personas, function-calling for structured output) + react-force-graph for the social web.** Localhost Node proxy holds the Gemini key — single-user dev only; no public backend. Pure-logic rules layer with seeded RNG round-tripping through versioned save migrations. Build in 19 phases (17 required + 2 optional), each independently shippable. P0 → P4 form the spine that proves determinism, separation, state machines, migrations, and the LLM round-trip; P7.5 relocated the LLM key off the browser. After that, every phase fills in rules and views over a sound foundation.
