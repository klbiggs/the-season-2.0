# P17 (Optional) — Semantic Memory (Embedding Retrieval)

> Part of [The Season Master Plan](../MASTER.md). Prior: [P16 — Procedural NPC Generation](./16-procedural-npcs.md). Next: [P18 — LLM Flavor Content (Optional)](./18-llm-flavor.md).

**Goal.** Surface deep historical context in conversation prompts beyond the 3-exchange recency window: at conversation start, embed the player's message, retrieve the top semantically-similar past entries (filtered by `(houseId, npcId)`), and ADD them to the prompt as a separate section. The recency window is preserved as the short-term anchor; semantic hits are additive.

---

## Resolved design decisions (this session)

These supersede the skeleton's open-ended framing and a few spec/tech-stack defaults. Where they diverge from a locked default, the divergence is an explicit user decision recorded here.

1. **Embedding provider = Gemini, not Voyage AI.** Reuses the existing `GEMINI_API_KEY` in `server/.env` via the localhost proxy (`ai.models.embedContent`). No Voyage account, no new credential, no second SDK. This **overrides** the locked tech-stack pick ("Voyage AI" under §2 Embeddings) and the skeleton's "Voyage AI client (or OpenAI fallback)" — recorded as a deliberate user decision. The §5 "pin a specific model, not a `latest` alias" requirement is honored by pinning a concrete Gemini embedding model id.
2. **Always-on, not key-gated opt-in.** Because `GEMINI_API_KEY` is *already required* for the conversation feature (`server/env.ts:validateEnv()`), semantic memory runs whenever conversation runs — no separate feature flag, no separate key-presence toggle. **Per-call** failures still degrade gracefully to recency-only (spec §7 line 657) — that is an error path, not an activation switch.
3. **Index lives in a sidecar, OUT of the replay hash.** The vector index is a **new Dexie object-store** keyed by save-slot, NOT part of the JSON game save. P17 adds **NO** `GameState` field, **NO** `SaveV16` bump, **NO** migration-ladder change, **NO** `hashableState` / `GameStateSchema` / `selectGameState` / `overwriteFromGameState` change, **NO** `PERSONA_CACHE_VERSION` bump. The schema-projection-selector trip-wire + 30-run replay harness must stay **green untouched** — that is the proof P17 added zero gameplay state. (Same "reading/side-storage-only phase bumps nothing" spirit as the P14 Ledger precedent, extended to a new sidecar store.) The embedding model id is pinned in the **sidecar metadata** (not the JSON save), so a model change is detectable on load.

**Why sidecar-out-of-hash is non-negotiable.** Embedding vectors are network-derived and non-deterministic; the conversation/LLM layer is the *only* sanctioned non-deterministic subsystem (§3 rule 3, spec §8) and must never perturb the gameplay PRNG call-count or the replay hash. The index is exactly analogous to the server-side persona cache and the LLM round-trip: a side store the determinism contract does not see.

---

## Architecture & data flow

Two independent flows. Both are **conversation-layer** concerns: no pure-rule (`src/game/rules/**`) involvement, no gameplay PRNG draws, no `GameState` mutation.

### Indexing (write path) — fire-and-forget, post-mutation

A single runtime module subscribes to the buses that already drive conversation history (§2 "Real Semantic Memory"). Subscribers fire **after** the store's `set` returns (same discipline as every diff-publisher), so a post-mutation `getState()` read sees the just-written text:

| Source event | Bus | Passage text resolved from | `houseId` filter | `npcId` filter |
|---|---|---|---|---|
| Exchange completion | `conversationBus` `ConversationResolved` | `getState().conversationHistory.get(pairKey)` — last player+NPC exchange pair | player house | target (from pairKey) |
| Whisper publication | `whisperBus` `WhisperCreated` | `getState().whispers.get(whisperId).text` | player house | `subjectCharacterId` |
| Scheme completion | `schemeBus` `SchemeCompleted` | synthesized: `"<kind> scheme against <targetName> completed at tick N"` | `ownerHouseId` | `targetCharacterId` |
| Casus belli recording | `schemeBus` `GrievanceRecorded` | synthesized: `"<source> grievance recorded against <victimHouse> at tick N"` | `perpetratorHouseId` | `null` (house-level) |
| Succession | `familyBus` `ArchetypeReclassified` (`trigger: "Succession"`) | synthesized: `"<name> succeeded as head; reclassified <from> → <to> at tick N"` | character's house | `characterId` |

Each subscriber: (a) **returns immediately unless semantic memory is explicitly enabled** (the `semanticMemoryEnabled` activation flag — see the Determinism contract; this is the load-bearing inert-in-test/replay guard, with `typeof fetch` / `typeof indexedDB` checks as defense-in-depth); (b) **filters to the player house** (`houseId === PLAYER_HOUSE_ID`) — rival/Independent internal events are not indexed (bounds volume + honors "cross-house retrieval out of scope"); (c) builds the passage (resolving id → display name via the bound `getState()` accessor — see "id-resolution per source" below); (d) embeds it (`taskType: "RETRIEVAL_DOCUMENT"`) via the proxy; (e) appends a `VectorIndexEntry` to the slot's index, FIFO-evicting by tick when over the cap; (f) persists. Embedding failures are caught, logged, and dropped (the passage is simply not indexed; spec §5 line 608). (g) **serializes the per-slot read-modify-write** behind a per-slot promise chain / mutex — a single tick can fire 3+ indexed events (scheme + grievance + succession) and concurrent load-append-persist on the same slot record is last-write-wins, silently dropping entries.

**Publish-safety (determinism-adjacent).** `bus.publish` (`bus.ts:23-27`) has NO try/catch around `sub(event)`, so a subscriber that throws SYNCHRONOUSLY aborts the publish loop mid-iteration → the store action partially fails → harness hash desync. Therefore each subscriber MUST make the `semanticMemoryEnabled` early-return its literal first statement, and MUST wrap the synchronous passage-build in try/catch (not only the `await`), so it can never throw synchronously back into `bus.publish`.

**id-resolution per source** (bus events carry ids, not display text — resolve via the post-mutation `getState()` accessor). The **written** `VectorIndexEntry.houseId` is `PLAYER_HOUSE_ID` for every indexed player event (so retrieval's `entry.houseId === queryHouseId` matches), distinct from the per-event field used to *decide* whether the event belongs to the player:

- `ConversationResolved` → `conversationHistory.get(pairKey)` last player+NPC pair; npc = target from `pairKey`.
- `WhisperCreated` → `whispers.get(whisperId).text` for the passage; npc = `subjectCharacterId`; the player-event decision is `destinationHouseId === PLAYER_HOUSE_ID` (the event carries no plain `houseId`).
- `SchemeCompleted` → `schemeKind` on the event; `targetCharacterId` is `CharacterId | null` and the null case is **Smuggling ONLY** (`schemes.ts:65,223-224`; Sabotage/OpenSabotage are guaranteed non-null). Non-null → `characters.get(id).name` + `npcId = targetCharacterId`; null (Smuggling) → a **house-level** entry (`npcId: null`) with a target-less passage (e.g. `"Smuggling run completed at tick N"`).
- `GrievanceRecorded` → `houses.get(victimHouseId).displayName`; `source` on the event; `npcId: null` (house-level).
- `ArchetypeReclassified` → `characters.get(characterId).name`; `from`/`to`/`trigger` on the event; npc = `characterId`; the player-house decision derives from `characters.get(characterId).houseId` (the event carries NO house id).

A missing lookup (dead/pruned id) skips that passage rather than indexing a placeholder; a legitimately-null Smuggling target is NOT a missing lookup — emit the house-level entry.

**One-time lore-corpus pass.** `seedLoreCorpus(slot)` embeds the pre-authored lore passages (`src/game/fixtures/lore.ts`, `entryType: "Lore"`, `houseId: null`, `npcId: null`) and seeds them. It is invoked from every init site (clean launch, load, new campaign) per the "Active-slot binding + lore seeding" contract below — NOT from the retrieval path. Idempotent: guarded by an index-empty / "lore already present" check so it runs once per slot. Also gated by the `semanticMemoryEnabled` activation flag, so it is inert in tests/replay.

### Retrieval (read path) — inline, at conversation start, non-blocking

In `sendBallroomMessage` / `sendPromenadeMessage`, **before** building the proxy request:

1. Call `semanticIndex.retrieve(npcId, freeformMessage)` (v1 hardcodes `queryHouseId = PLAYER_HOUSE_ID` internally — everything is player-house-bound — so it stays off the signature):
   - Embed the player's freeform message (`taskType: "RETRIEVAL_QUERY"`) via the proxy, under a **short client timeout** (`EMBED_RETRIEVAL_TIMEOUT_MS`, distinct from and smaller than the 15s conversation budget — retrieval must never eat the conversation timeout). Note: `retrieve` is `await`ed in the same async action *before* the conversation round-trip, so this timeout is ADDITIVE to the user-perceived "thinking" wait (sequential, not overlapped) — hence the small budget.
   - Load the slot's index; keep entries where `(entry.houseId === null || entry.houseId === queryHouseId) && (entry.npcId === null || entry.npcId === queryNpcId)` (lets house-level + global-lore entries through; NPC-specific entries only for that NPC).
   - Rank by cosine similarity (= dot product over L2-normalized vectors); take the top `SEMANTIC_RETRIEVAL_TOP_K` above `SEMANTIC_SIMILARITY_THRESHOLD`. Deterministic tiebreak: higher score first, then higher tick, then entry id.
   - Return `string[]` of source texts (already chronological-stable by the tiebreak).
   - **Any failure** (embed timeout/network/schema, IndexedDB read error, no index) → return `[]` and log a structured miss. The conversation proceeds with the recency window only (spec §7 line 657).
2. Pass the result as a new `semanticContext: string[]` field on `ProxyConversationRequest`.
3. The server's `buildContents` renders it as a **separate section** (rides on per-turn `contents`, NOT `systemInstruction` — P12 lesson: `cachedContent` + `systemInstruction` are mutually exclusive, so a cached persona would drop a systemInstruction prefix). Empty array → no section emitted. Ordering when the Promenade `[Setting:...]` mode-frame prefix is also present (`conversation.ts:110-115`): **`[Setting:]` mode-frame → `[Relevant past events:]` → transcript → message**.

```
[Setting: ...]            (Promenade only)
[Relevant past events:]
- <hit 1 text>
- <hit 2 text>

<recency transcript>
<player freeform message>
```

---

## Embedding specifics (Gemini, verify exact ids via Context7 at implementation)

- **Model (pinned):** `EMBEDDING_MODEL = "gemini-embedding-001"` — a concrete id, not a `latest` alias (§5 pinning).
- **Dimensions:** `EMBEDDING_DIMENSIONS = 768` via `config.outputDimensionality`. `gemini-embedding-001` defaults to 3072 and truncates from the end when reduced; reduced vectors are **not** pre-normalized, so we **always L2-normalize client-side** after receiving values (makes cosine = dot product and removes the pre/post-normalization subtlety regardless of model).
- **Task types:** `RETRIEVAL_DOCUMENT` at index time, `RETRIEVAL_QUERY` at retrieval time (`config.taskType`).
- **SDK shape:** `ai.models.embedContent({ model, contents: string[], config: { outputDimensionality, taskType } })` → `response.embeddings[i].values: number[]`. Confirmed via Context7 (`/websites/googleapis_github_io_js-genai`).
- **Server timeout:** `EMBED_SERVER_TIMEOUT_MS` composite `AbortController` (embeddings are fast; budget smaller than conversation's 13s).
- **Pinned constant values (v1 starting points, tune at playtest):** `VECTOR_INDEX_MAX_ENTRIES = 500`, `SEMANTIC_RETRIEVAL_TOP_K = 4`, `SEMANTIC_SIMILARITY_THRESHOLD = 0.55` (cosine), `EMBED_RETRIEVAL_TIMEOUT_MS = 5000`, `EMBED_SERVER_TIMEOUT_MS = 8000`.
- **Byte ceiling (spec §8 L687):** 768-dim Float32 = 3072 B/vector; + ~0.5 KB source text ≈ ~3.6 KB/entry × `VECTOR_INDEX_MAX_ENTRIES` (500) ≈ **~1.8 MB per slot** — large but bounded, well under any practical IndexedDB quota. The FIFO entry-count cap IS the byte bound (fixed-dim vectors); raise `MAX_ENTRIES` only with this product re-checked.

---

## In scope

- **Server embed endpoint** `POST /api/llm/embed` (`server/embeddings.ts`, routed in `server/index.ts`). Thin relay over `ai.models.embedContent` using the existing `GEMINI_API_KEY`. Batched (`contents: string[]`). Same failure-mapping discipline as `server/conversation.ts` (408 timeout / 502 network / 422 schema / 500 internal).
- **Client embeddings wrapper** `src/llm/embeddings.ts`: fetch `/api/llm/embed`, validate response (Zod), L2-normalize → `Float32Array[]`; plus pure `cosineSimilarity` / `l2normalize` helpers. Element `llm` — imports only constants + `llm/types` + `llm/errors` (boundary rule c clean).
- **Vector index sidecar** `src/persist/vectorIndex.ts`: new Dexie object-store `vectorIndex` keyed by `slot`; record `{ slot, modelId, dimensions, entries: VectorIndexEntry[] }`. CRUD + FIFO-eviction-by-tick at `VECTOR_INDEX_MAX_ENTRIES` + **model-id mismatch handling on read** (stored `modelId !== EMBEDDING_MODEL` → discard the index and re-accumulate going forward). `VectorIndexEntry` per spec §4 line 561: `{ id, vector, sourceText, entryType, houseId|null, npcId|null, tick }`. Vectors stored as `Float32Array` (IndexedDB structured-clone native) for size.
- **Runtime orchestration** `src/runtime/semanticIndex.ts`: bus subscriptions (indexing), `retrieve(...)` (retrieval), `seedLoreCorpus(...)` (one-time lore pass), `setActiveSlot(...)`, `enableSemanticMemory()` (flips the `semanticMemoryEnabled` activation flag — called from `src/main.tsx`), `__setSemanticMemoryEnabledForTests(boolean)` (test-only opt-in), and a `bindStore(getState)` accessor set once by the store at init (avoids a store→runtime import cycle; the subscribers genuinely call `getState()` to resolve passage text — this is a NEW injection, unlike `conversationOrchestrator` which only reacts to event payloads and never reads `getState()`).
- **Lore corpus fixture** `src/game/fixtures/lore.ts`: ~12–20 short pre-authored passages (per-location color + founding-house lore). `entryType: "Lore"`, null filters (global context).
- **Wire format** (`src/llm/types.ts`): `EmbedRequestSchema` / `EmbedResponseSchema` (shared client/server) + `semanticContext: z.array(z.string()).default([])` added to `ProxyConversationRequestSchema`.
- **Prompt render** (`server/conversation.ts`): `buildContents` prepends the `[Relevant past events:]` section when `semanticContext` is non-empty.
- **Constants** (`src/game/constants.ts`, near the existing `LLM_*` block): `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`, `VECTOR_INDEX_MAX_ENTRIES`, `SEMANTIC_RETRIEVAL_TOP_K`, `SEMANTIC_SIMILARITY_THRESHOLD`, `EMBED_RETRIEVAL_TIMEOUT_MS`, `EMBED_SERVER_TIMEOUT_MS`.
- **Dexie schema** (`src/persist/dexie.ts`): bump `DEXIE_SCHEMA_VERSION` 1 → 2, add the `vectorIndex` store (Dexie object-store version — distinct from save-format version, which does NOT change).
- **Store integration** (`src/game/store.ts`): call `semanticIndex.retrieve` + thread `semanticContext` in `sendBallroomMessage` / `sendPromenadeMessage`; import `semanticIndex` to register subscriptions; call `bindStore` once.
- **Active-slot binding + lore seeding (pins B5 + B6 — the slot the write path indexes to / the read path queries, and the one-time lore pass).** `semanticIndex` holds an active-slot field defaulting to `DEV_SLOT` (the only v1 slot). The uniform ordering contract at every init site is **`[createStore | replaceState]` → `setActiveSlot(slot)` → `seedLoreCorpus(slot)`** (the last two are idempotent / cheap on repeat):
  - **Clean first launch** — `src/main.tsx` after `createStore({ seed })` (module-load default path; the common case). This is the load-bearing seed site.
  - **Load** — `src/ui/shared/SettingsMenu.tsx:45` after `replaceState(fromSaveV15(saved))`.
  - **New campaign (corrupt-save recovery)** — `src/ui/shared/CorruptSaveBanner.tsx:22` after `replaceState(createInitialState(seed))`.
  Because the only v1 slot is `DEV_SLOT`, the default makes slot-binding correct-by-construction even if a call site is missed; the explicit calls forward-proof a multi-slot future. `seedLoreCorpus` is NOT triggered from the retrieval path (retrieval returns `[]` on an empty index — it never seeds).

## Out of scope

- **Cross-house retrieval** (spec §2 line 286 — explicitly out for the initial implementation). Enforced by the player-house-only index filter + the `(houseId, npcId)` retrieval filter.
- **OpenAI / Voyage providers.** Provider is abstracted behind `POST /api/llm/embed`; a second provider is a later server-side swap.
- **Re-embedding / re-ranking with a newer model.** On model-id mismatch we discard and re-accumulate; we do NOT re-embed historical passages.
- **Any JSON-save / hash / migration change** (see Resolved decision 3).
- **NPC-initiated use of retrieval, streaming, or new LLM tools** (owned elsewhere / deferred).

## Spec refs

§2 "Real Semantic Memory"; §4 line 561 "Vector Index Entry"; §5 "Optional Embedding Service" (purpose, failure-drop, pinning); §7 line 657 (embedding failure at conversation start); §8 line 687 (capped FIFO index, bounded embedding-bearing save).

## Edge cases

- **Embedding service failure during conversation start** (§7 line 657): retrieval returns `[]`, prompt built with recency window only, structured log entry records the miss. Conversation is NOT blocked, tick is NOT affected, history is NOT touched.
- **Indexing failure** (§5 line 608): the passage is dropped (not indexed); future prompts use whatever the index has accumulated. Game state unaffected.
- **Index at/over cap**: FIFO eviction by tick (oldest first, id tiebreak) keeps entry count ≤ `VECTOR_INDEX_MAX_ENTRIES`.
- **Model-id mismatch on load**: stored `modelId !== EMBEDDING_MODEL` → discard the sidecar index for that slot, re-accumulate going forward (no stale-vector cross-ranking).
- **Non-browser env** (Vitest/node/replay harness): all index + retrieval calls are `typeof fetch` / `typeof indexedDB` guarded and inert.
- **NPC death between index and retrieval**: NPC-filtered entries for a dead target simply stop being queried (no conversation occurs with the dead NPC); no cascade prune required (sidecar, not GameState — orphaned entries age out via FIFO).

## Determinism contract (the load-bearing section)

- **No `GameState` change**: P17 touches none of `GameStateSchema`, `hashableState`, `selectGameState`, `overwriteFromGameState`, `createInitialState`, or any `set`-body state copy. The `schema-projection-selector-extension.test.ts` trip-wire and the 30-run replay harness pass **unmodified** — this is an explicit verification item, the proof the phase added zero deterministic state.
- **No PRNG involvement**: embedding + cosine are not PRNG draws; nothing in P17 imports `src/game/rng.ts`. No `Math.random`.
- **No pure-rule change**: `src/game/rules/**` is untouched. `lore.ts` is a fixture (rules *may* import fixtures, but no rule reads the index or embeddings).
- **Activation flag is the load-bearing inert-guard (corrects a naive "the harness never reaches this code" assumption).** The replay harness DOES invoke the indexing subscribers: `src/game/replay-harness.test.ts:24-26` calls the store wrappers `advanceTick()` / `runYearPass()`, which fire `publishSchemeTransitions` + `publishArchetypeReclassificationsFromSuccession` after `set` — so `semanticIndex`'s `schemeBus`/`familyBus` subscribers run during the harness. What keeps them side-effect-free is an **explicit module-level boolean** `semanticMemoryEnabled` (default `false`) in `semanticIndex.ts`, flipped `true` ONLY by `enableSemanticMemory()` called from the browser app entry (`src/main.tsx`). The harness and every Vitest suite import the store (registering subscriptions at module-load) but NEVER call `enableSemanticMemory()`, so every subscriber returns on its first line. This is robust **independent of `fetch`/`indexedDB` global state** — which matters because `vitest.setup.ts:50` stubs `fetch` process-wide (so `typeof fetch` is always truthy in tests) and `fake-indexeddb/auto` assigns `globalThis.indexedDB` process-wide; an absence-of-global guard would hold only by Vitest's *default* `pool:"forks"` + `isolate:true` (no explicit pool/isolate config pins it, so a future `--no-isolate` speed tweak could leak a polyfilled `indexedDB` into the harness worker). The `typeof fetch` / `typeof indexedDB` checks remain as defense-in-depth, but the explicit flag — not absence-of-global — is the contract. Indexing/retrieval tests opt in via a test hook (`__setSemanticMemoryEnabledForTests(true)`) + injected fakes.
- **`lint:boundaries`** stays at the known baseline of exactly 2 pre-existing errors (P14 carve-out). A 3rd error is a regression.

## New files

- `server/embeddings.ts` (+ `server/embeddings.test.ts`)
- `src/llm/embeddings.ts` (+ `src/llm/embeddings.test.ts`)
- `src/persist/vectorIndex.ts` (+ `src/persist/vectorIndex.test.ts`)
- `src/runtime/semanticIndex.ts` (+ `src/runtime/semanticIndex.test.ts`)
- `src/game/fixtures/lore.ts` (+ `src/game/fixtures/lore.test.ts`)

## Touched files

- `server/index.ts` — route `/api/llm/embed`.
- `server/conversation.ts` — `buildContents` renders `semanticContext`. **Widen `buildContents`'s param** from `{ history, freeformMessage, mode }` (conversation.ts:105) to also carry `semanticContext`, and confirm the call site `buildContents(request)` (conversation.ts:52) passes it (the whole `request` already flows in, so this is a param-type + destructure change, not a call-site rewire).
- `src/llm/types.ts` — `EmbedRequestSchema` / `EmbedResponseSchema`; `semanticContext` on `ProxyConversationRequestSchema`.
- `src/game/store.ts` — retrieval call + `semanticContext` thread in both send actions; `bindStore`; subscription registration import.
- `src/persist/dexie.ts` — `DEXIE_SCHEMA_VERSION` → 2 + `vectorIndex` store. **Dexie version chaining is additive**: keep the existing `.version(1).stores({ saves: "slot" })` and CHAIN `.version(2).stores({ saves: "slot", vectorIndex: "slot" })` — do NOT replace the v1 declaration (Dexie needs the full version ladder to upgrade existing DBs).
- `src/game/constants.ts` — embedding/retrieval constants.
- `src/main.tsx` — at browser app entry, UNCONDITIONALLY (NOT inside the `import.meta.env.DEV` block at line 23; near the `createRoot(...).render(...)` at line 62): `enableSemanticMemory()` (the ONLY production caller that flips the activation flag on), then `semanticIndex.setActiveSlot(DEV_SLOT)`, then `seedLoreCorpus(DEV_SLOT)`. **This is the load-bearing seed site (pins B6)**: the clean first-launch path is `createStore({ seed })` at `main.tsx:13` (module-load) — NOT a `replaceState` — so wiring lore only to the `replaceState` callers would leave the lore corpus dead on the common path. `seedLoreCorpus` is idempotent (index-empty / "lore already present" guard), so the redundant calls from the other init sites are no-ops. The `seedLoreCorpus(DEV_SLOT)` promise MUST be `void`-ed / `.catch()`-ed (main.tsx does no async at module scope today — avoid an unhandled rejection).
- `src/ui/shared/SettingsMenu.tsx` (load) + `src/ui/shared/CorruptSaveBanner.tsx` (new-campaign) — each call `semanticIndex.setActiveSlot(slot)` immediately after their `replaceState(...)`, then `seedLoreCorpus(slot)` (idempotent — backfills lore for a save created before the corpus existed, and re-points the slot for a multi-slot future).
- **Test infrastructure (required, else new suites fail):**
  - `__mocks__/@google/genai.ts` — extend the genai mock with `models.embedContent` (currently only `generateContent` / `generateContentStream` / `caches.create`), else `server/embeddings.test.ts` can't exercise the handler.
  - `vitest.setup.ts` — add an `/api/llm/embed` branch to the global `fetch` stub (which currently THROWS on any path other than `/api/llm/conversation` and `/api/llm/persona/invalidate`), returning a deterministic mock embedding, so suites that don't locally mock fetch don't throw on the new route.

## Verification

- **`pnpm test`** — all Vitest suites pass. New suites: server embed handler (success + 408/502/422 failure mapping), client embeddings (cosine correctness, L2-normalization, HTTP-status → failure mapping), vector index (CRUD round-trip, FIFO eviction at cap, model-id-mismatch discard), semanticIndex (passage build per source, player-house-only filter, retrieval filter `(houseId, npcId)`, retrieval-failure → `[]`, lore-seed idempotence), lore fixture (shape/non-empty).
- **`buildContents`** test: `semanticContext` non-empty → `[Relevant past events:]` section present and ordered before the transcript; empty → absent.
- **Determinism (must stay green untouched)**: `schema-projection-selector-extension.test.ts`, `hashable-state-extension.test.ts`, and the 30-run replay harness — proof P17 added zero gameplay state. The harness stays inert specifically because it never calls `enableSemanticMemory()` (the subscribers it DOES invoke return on their first line); add a targeted assertion that `semanticMemoryEnabled` is `false` by default and that the subscribers no-op when it is.
- **Publish-boundary safety (named test)**: assert `bus.publish` survives a synchronously-throwing subscriber (the loop completes, all other subscribers fire) AND that each `semanticIndex` subscriber's `semanticMemoryEnabled` early-return is its first statement — a synchronous throw from an indexing subscriber must never desync a store action / the harness hash.
- **Activation-flag teardown**: every opt-in test using `__setSemanticMemoryEnabledForTests(true)` resets it to `false` in `afterEach`/`finally`, so a left-true flag can't leak into the replay-harness file under a future `--no-isolate` tweak.
- **`pnpm lint`** — Biome clean. **`pnpm lint:boundaries`** — exactly the 2 baseline errors, no 3rd.
- **`pnpm typecheck`** — strict clean.
- **LLM failure paths exercised** (not just happy path): retrieval embed timeout / network / schema all degrade to recency-only; indexing embed failure drops the passage.
- **Manual (dev server)**: with a real `GEMINI_API_KEY`, run a campaign, hold several conversations, confirm a semantic hit observable on a later prompt (log/inspect the `semanticContext` section) and that pulling the network mid-retrieval still lets the conversation complete on recency only. If the UI/LLM path can't be exercised, say so explicitly.

## Close out

When the gates and verification items above are green, run `/close-phase 17`. Beyond the standard status/session-notes/commit steps, this phase requires extra doc propagation because it overrides locked defaults:
- **`plans/MASTER.md` §6** — P17 status row → done.
- **`plans/MASTER.md` §2** — the Embeddings row (line ~47, currently `Embeddings (optional, deferred) | Voyage AI`) → Gemini (`gemini-embedding-001` via the localhost proxy), no longer deferred.
- **`plans/MASTER.md` §4 directory tree** — the comments at lines ~137/142 (`embeddings.ts ... Voyage client (deferred)` / `vectorIndex.ts ... embedding sidecar`) → drop "Voyage"/"deferred"; note Gemini-backed, shipped at P17.
- **`plans/MASTER.md` §10 #12** — Deferred-to-v1.5 → **shipped in v1** as an always-on, Gemini-backed, sidecar subsystem; record the Voyage→Gemini and deferred→active deviations as explicit user decisions (per CLAUDE.md's open-question surfacing rule).
- **`plans/SESSION-NOTES.md`** — append the phase summary.
- **`CLAUDE.md`** additions: sidecar-out-of-hash discipline (a non-deterministic side store the replay hash never sees, gated by an explicit `semanticMemoryEnabled` flag — not absence-of-global); the `server → /api/llm/embed` proxy edge reusing the Gemini key; embedding model-id pinning in sidecar metadata + discard-on-mismatch.

Then commit the changes (no push).

---

## Accumulated Risks & Suggestions

*Passively collected from review cycles. Not blockers. Triaged at convergence.*

- [C1] buildContents signature + call site (server/conversation.ts:52,105) must be widened from `{ history, freeformMessage, mode }` to also carry `semanticContext`. `[applied]`
- [C1] Whisper houseId filter field is ambiguous — WhisperCreated carries `sourceCharacterId`/`subjectCharacterId`/`destinationHouseId`, no plain `houseId`; pin `destinationHouseId === PLAYER_HOUSE_ID` for the player-index filter. [likely addressed]
- [C1] Synthesized passages need `getState()` id→display-name lookups (SchemeCompleted/GrievanceRecorded/ArchetypeReclassified carry ids only). [likely addressed]
- [C1] The `bindStore` precedent is overstated — `conversationOrchestrator` never reads `getState()`; the indexing subscribers genuinely do, so this injection is new. [likely addressed]
- [C1] First `src/runtime/* → src/persist/*` import edge — lint-allowed by default but a new cross-element coupling worth noting. `[note: advisory — verified lint-clean during convergence]`
- [C1] Byte-ceiling (spec §8 L687) is unaddressed — compute 768-dim Float32 × `VECTOR_INDEX_MAX_ENTRIES` and state it against a defined ceiling; the plan caps entry count only. `[applied]`
- [C1] Dexie version bump must be additive-chained (keep `.version(1)`, chain `.version(2)`). [likely addressed]
- [C1] This phase flips MASTER §10 #12 (deferred→shipped) and overrides the §2 locked Voyage pick (→Gemini); both are explicit user decisions made this session, recorded in "Resolved design decisions." [likely addressed]
- [C1] Pin concrete values for `EMBED_RETRIEVAL_TIMEOUT_MS`, `SEMANTIC_RETRIEVAL_TOP_K`, `SEMANTIC_SIMILARITY_THRESHOLD`, `VECTOR_INDEX_MAX_ENTRIES` (currently named but unvalued). `[applied]`
- [C1] Verify `gemini-embedding-001` + `outputDimensionality:768` via Context7 at implementation (already flagged in the plan; good). `[note: advisory — verify-at-impl, already in Embedding-specifics section]`
- [C1] `SchemeCompleted.targetCharacterId` is `CharacterId | null`, and per `schemes.ts:65,223-224` the null case is **Smuggling ONLY** (Sabotage/OpenSabotage require a non-null target — an earlier note here wrongly said Sabotage). A null (Smuggling) target should produce a house-level entry (`npcId: null`), NOT be skipped; and Smuggling has no target name, so the `"<kind> scheme against <targetName>"` template needs a Smuggling-specific branch (e.g., `"Smuggling run completed at tick N"`). `[applied]`
- [C1] Activation-flag teardown must be pinned: every opt-in test using `__setSemanticMemoryEnabledForTests(true)` MUST reset to `false` in `afterEach`/`finally`, else a left-true flag leaks into the harness under a future `--no-isolate` tweak. `[applied]`
- [C1] Per-event async IndexedDB read-modify-write can clobber: a single tick can fire 3+ indexed events (scheme + grievance + succession); concurrent load-append-persist on the same slot record is last-write-wins. Serialize the write path (per-slot queue/mutex). `[applied]`
- [C1] Note the additive retrieval latency: `retrieve` is `await`ed before the conversation round-trip in the same async action, so `EMBED_RETRIEVAL_TIMEOUT_MS` adds to the user-perceived "thinking" wait (sequential, not overlapped). `[applied]`
- [C1] Close-out doc propagation is broader than §10 #12: also edit MASTER §2 line 47 ("Embeddings (optional, deferred) | Voyage AI"), the directory-tree comments (MASTER ~lines 137/142: "Voyage client (deferred)" / "embedding sidecar"), and the §6 P17 status row. `[applied]`
- [C1] `ArchetypeReclassified` carries no house id (only `characterId`/`from`/`to`/`trigger`) — the id-resolution enumeration must add `characters.get(characterId).houseId` to derive the player-house filter for the succession source. `[applied]`
- [C2] Publish-boundary fragility (determinism-adjacent): `bus.publish` (`bus.ts:23-27`) has NO try/catch around `sub(event)`, so a subscriber that throws SYNCHRONOUSLY aborts the publish loop and the store action → harness hash mismatch. Each `semanticIndex` subscriber must make the `semanticMemoryEnabled` guard its literal first statement AND wrap the synchronous passage-build in try/catch (not only the `await`), so it can NEVER throw synchronously back into `bus.publish`. `[applied]`
- [C2] Pin the ordering of the `[Relevant past events:]` section vs the Promenade `[Setting:...]` framing prefix in `buildContents` (`conversation.ts:110-115`) — decide which leads (recommend: `[Setting:]` mode-frame first, then `[Relevant past events:]`, then transcript). `[applied]`
- [C3] Pin the WRITTEN value: `VectorIndexEntry.houseId = PLAYER_HOUSE_ID` for indexed player events (distinct from the `destinationHouseId` *filter* field on the source event) so retrieval's `entry.houseId === queryHouseId` matches. `[applied]`
- [C3] `retrieve()` signature at line 47 is `retrieve(npcId, freeformMessage)` but the filter references `queryHouseId` — v1 hardcodes `queryHouseId = PLAYER_HOUSE_ID` internally (everything is player-house-bound); state it in one line. `[applied]`
- [C3] `seedLoreCorpus(DEV_SLOT)` at `main.tsx:62` is async IndexedDB work at module scope (main.tsx does no async at module scope today) — `void`/`.catch()` the promise to avoid an unhandled rejection. `[applied]`
- [C3] Promote C2 (publish-loop synchronous-throw fragility) into the Verification list as a NAMED test: assert `bus.publish` survives a throwing subscriber AND that the `semanticMemoryEnabled` early-return is the literal first statement of each subscriber. `[applied]`
