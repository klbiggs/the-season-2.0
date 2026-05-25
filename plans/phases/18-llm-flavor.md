# P18 (Optional) — LLM Flavor Content (Generated, Persisted)

> Part of [The Season Master Plan](../MASTER.md). Prior: [P17 — Semantic Memory (Embedding Retrieval)](./17-semantic-memory.md). Next: [P19 — Pre-ship cleanup](./19-migration-ladder-cleanup.md).

**Goal.** Persist-once / generate-once flavor text for three content types — artifact backstories, NPC biographical notes, and a per-generation scandal-sheet gossip column. Each piece is authored by the model at most once at first encounter, falls back to a designer stub when generation fails, and is read back verbatim thereafter (the model is never re-invoked on save/load).

---

## Resolved design decisions (this session)

These resolve the skeleton's open-ended framing. All four were explicit user decisions this session.

1. **Scope = all three content types.** Artifact backstories (keyed by artifact *definition*), NPC biographical notes (keyed by `CharacterId` — the payoff surface, with P16's ~25 procedural society NPCs), and a per-generation scandal-sheet column. They are independently shippable but ship together as the coherent §3 "Generated Flavor Content" feature.

2. **Persistence = in the JSON save, in the replay hash, as a normal top-level `GameState` field.** This is the **central architectural call** and it diverges from P17's sidecar choice — deliberately, on a precedent.
   - **The decisive precedent is `conversationHistory`.** Conversation exchange text is *already* LLM-authored, non-deterministic content that lives in `GameState`, is serialized into the JSON save, AND is projected into `hashableState` (`src/game/hash.ts:102`). The 30-run replay harness stays green not because that text is excluded from the hash, but because **the harness never invokes the LLM** — so `conversationHistory` (and now `flavorText`) stay empty across all 30 runs and hash identically. Flavor text is the same *kind* of thing as conversation history: persisted LLM prose. It follows the same home.
   - **Why NOT a P17-style sidecar.** The vector index went sidecar because it is a *rebuildable derived cache* of large binary vectors, model-versioned and discard-on-mismatch. Authored flavor text is the opposite: it is canonical content that must read back **verbatim** (spec §3 line 270) and cannot be regenerated identically. It belongs *with* the save, not in a discardable cache. A sidecar would also force a parallel async persistence path (load-on-init, write-through, in-memory mirror) just so the synchronous ledger UI can read it — pure overhead the existing save/load machinery gives us for free.
   - **Why NOT excluded-from-hash.** The reserved `// excluded-from-hash` mechanism (SESSION-NOTES line 482) has never been used; the project's demonstrated bias (the `campaignName` decision) is "prefer in-hash simplicity unless there is a strong reason." There is no strong reason here: in-hash breaks no test (harness never generates flavor), and `conversationHistory` already establishes LLM text in the hash as normal. Using the novel excluded-from-hash sentinel for the first time at an *optional* phase would add machinery for no benefit.
   - **Consequence:** P18 bumps the save format to **V16** and extends the schema↔projection↔selector↔overwrite quad-sync — one new top-level field. The migration boilerplate is mechanical and P19 deletes the entire ladder anyway. This is the established P0–P18 save-discipline path (contrast the P14/P17 "reading-only / sidecar bumps nothing" precedents, which do not apply because flavor is genuine new persisted gameplay-adjacent state).

3. **Per-item generation trigger = auto on first encounter, fire-and-forget** (spec §3 line 268). NPC bio fires on the first *conversation* with that NPC; artifact backstory fires on first *equip*; the scandal column fires at *succession*. Each routes through a single flag-gated, deduped, already-persisted-checked entry point so re-fires are cheap no-ops and the subsystem is inert in tests/replay.

4. **Scandal-sheet cadence = per generation (at succession).** Matches the spec's "generational scandal-sheet columns" wording. One column per player-house head succession, aggregating notable events of the generation that just ended. There is **no pre-existing event log** in the codebase, so aggregation walks the existing tick-stamped state Maps (schemes/whispers/duels/deaths/marriages/blood feuds/forgeries) for the window — read-only, pure, no new event-log infrastructure.

---

## Architecture & data flow

Three trigger flows, one generation/persistence pipeline, three display surfaces. Everything is a **conversation-layer concern**: no pure-rule (`src/game/rules/**`) involvement, no gameplay PRNG draws. The *only* `GameState` mutation is the post-await `recordFlavorText` write, which never touches the PRNG and never fires unless the activation flag is on.

### The pipeline: `flavorOrchestrator.ensureFlavor`

A single runtime module `src/runtime/flavorOrchestrator.ts` owns generation. Mirrors `semanticIndex`'s inert-guard + `bindStore` injection pattern (avoids a store→runtime import cycle; `getState()` returns the full store *including actions*, so the orchestrator calls `readState().recordFlavorText(...)` without a static store import). **Accessor type — diverges from `semanticIndex`:** type the injected accessor `() => StoreState` (= `GameState & StoreActions`, `store.ts:394`), NOT `() => GameState`. `semanticIndex.ts:47` deliberately narrows its `readState` to `() => GameState` because it never calls an action; `recordFlavorText` IS a `StoreAction`, so the narrowed type would make `readState().recordFlavorText` a compile error. Zustand's `get()` returns `StoreState` at runtime — type the flavor accessor to match.

`ensureFlavor(id: FlavorContentId, kind, context): void` — fire-and-forget, idempotent:
1. **First statement:** `if (!flavorContentEnabled) return;` (the load-bearing inert guard — see Determinism contract).
2. `if (typeof fetch !== "function") return;` (defense-in-depth for non-browser env).
3. If `readState() === null` → return.
4. **Already-persisted check:** `if (readState().flavorText.has(id)) return;` (spec "produced at most once").
5. **In-flight dedupe:** if `id ∈ inFlight` set → return; else add to `inFlight`.
6. `void generate(id, kind, context)` — async: build wire request, fetch `/api/llm/flavor` under `FLAVOR_REQUEST_TIMEOUT_MS`, validate, and on **success** call `readState().recordFlavorText({ id, kind, text, generatedAtTick: readState().tick })`. On **any failure** (timeout/network/schema) log a structured miss and drop — nothing persisted, the stub keeps showing, a later encounter retries. `finally { inFlight.delete(id) }`.

**Failure ≠ persisted stub.** Storage only ever holds *successfully generated* text. The designer stub is a display-time fixture fallback (rendered whenever `flavorText.get(id)` is absent), not a persisted entry. So a transient outage shows the stub and silently retries next encounter; a success locks in verbatim forever. This satisfies both "play is uninterrupted" (stub shows instantly) and "produced at most once" (only successes persist).

**Publish-safety (determinism-adjacent, inherited from P17).** `bus.publish` has no try/catch around `sub(event)`, so a synchronously-throwing subscriber aborts the publish loop and desyncs the store/harness. The two bus subscribers (bio, scandal) MUST make the `flavorContentEnabled` early-return their literal first statement and wrap synchronous context-building in try/catch.

### Trigger 1 — NPC bio (first bio reveal, NOT a conversation)

UI-triggered via the **`revealNpcBio(characterId)` store action**, fired when the player opens an NPC's "Who is this?" bio expander (`PortraitCard`'s `<details onToggle>` → `PortraitRing` → `BallroomView` → `store.revealNpcBio`). The action resolves `getState().characters.get(characterId)`, skips player-house members (bios are for ballroom NPCs), and calls `ensureFlavor("bio:" + characterId, { kind: "NpcBio", character })`. Generating on the deliberate reveal — rather than gating behind a full conversation round-trip — means the bio is present when the player asks who someone is, and scopes generation to NPCs they actually inspect. (Superseded the original `conversationBus.subscribe("ConversationResolved")` trigger: requiring a conversation was wrong friction, and an NPC the player never conversed with would show only a stub forever.) Fire-and-forget + flag-gated + idempotent inside `ensureFlavor`, so it stays inert in tests/replay; the open `<details>` swaps the stub for generated text live when the store updates (~1–3s).

### Trigger 2 — artifact backstory (first equip)

The `equipArtifact` store-action wrapper (`store.ts:1787`), **after** its successful `set`, calls `ensureFlavor`. **The wrapper signature is `(characterId, artifactInstanceId)` and the pure result is `{ ok, state }` — `definitionId`/`displayName`/`family` are NOT in scope at the call site; derive them:** `const definitionId = result.state.artifactInstances.get(artifactInstanceId).definitionId; const def = ARTIFACT_REGISTRY.get(definitionId);` then call `ensureFlavor("artifact:" + definitionId, "ArtifactBackstory", { definitionId, displayName: def.displayName, family: def.family })` (the `ArtifactsTab.tsx:186` registry-lookup pattern). Equipping is the deliberate "encounter" (wearing the heirloom to a ball). Store→runtime is an already-sanctioned edge (the store imports `semanticIndex`). The call is flag-gated inside `ensureFlavor`, so `equipArtifact` tests stay inert. Keyed by `definitionId` (the backstory is the *lore of the artifact*, shared across instances; 7 definitions at v1, widens automatically if P-later adds procedural artifacts).

### Trigger 3 — scandal column (succession)

`familyBus.subscribe("ArchetypeReclassified", ...)`. **The event carries only `characterId` (NO houseId — `family.ts:71-77`), and `publishArchetypeReclassificationsFromSuccession` iterates ALL characters** (`family.ts:182-201`), firing `trigger:"Succession"` for rival/Independent successions too. The filter is **correctness-critical, not efficiency**: resolve `getState().characters.get(event.characterId)?.houseId === PLAYER_HOUSE_ID` (exactly as `semanticIndex.ts:218-226` does) AND `event.trigger === "Succession"`. Without it, a rival/Independent succession mints a spurious column keyed `"scandal:" + <player's generation>` over the player's window — wrong content AND a colliding id. On match:
- `generationCount = getState().houses.get(PLAYER_HOUSE_ID).generation`; `id = "scandal:" + generationCount`.
- `priorTick = max(generatedAtTick across existing "scandal:" entries, else 0)`; `window = (priorTick, getState().tick]`.
- `eventSummaries = aggregateScandalEvents(getState(), priorTick)` — a **pure** helper (reads many state Maps, returns `string[]`, no RNG, no mutation). Notable events in-window: weaponized whispers (`weaponizedAtTick`), completed/failed schemes (`resolvedAtTick`, esp. Seduction/Sabotage), resolved duels (`resolvedAtTick`, with casualty), character deaths (`diedAtTick`), new marriages (`marriedAtTick`) + dissolutions (`dissolvedAtTick`), blood feuds opened (nested on `house.bloodFeuds` — an array per house, NOT a top-level Map; walk houses), forgeries surfaced (`surfacedAtTick`). **NOT a source: "resolved elopements" — `state.elopement` is a nullable singleton set back to `null` on resolution (P9 `pruneOrphanedConversationKeys` Branch 5), so there is no resolved-elopement archive to walk; the only surviving signal of a past elopement is its launching Seduction scheme in `state.schemes` (`resolvedAtTick`), already covered by the schemes source.** **Most of these tick fields are `.nullable()` (null = unresolved/in-progress); the window comparison MUST skip null before `priorTick < t <= now`, else a `null < n` coercion silently includes unresolved entries.**
- `ensureFlavor(id, "ScandalColumn", { generationCount, eventSummaries })`. Empty `eventSummaries` → a quiet-season column is still generated (the stub covers "nothing fit to print").

Aggregation runs **client/runtime-side** (it needs `getState()`); the server receives only the pre-built `string[]` summaries and never sees `GameState`.

### Generation endpoint `/api/llm/flavor` (server, thin relay)

Modeled on `server/embeddings.ts` (the simplest existing handler). `server/flavor.ts:handleFlavor(req, res)`:
- Parse → `FlavorRequestSchema.safeParse` → 422 on failure.
- `validateEnv()` → `new GoogleGenAI(...)` (fresh per request, per existing pattern).
- `server/prompts/flavor.ts:buildFlavorPrompt(request)` composes a period-voice system instruction + the per-kind user prompt (server owns prompts, exactly as `server/prompts/persona.ts` does — the sanctioned `server → src/llm/types` edge carries the typed context).
- `ai.models.generateContent({ model: FLAVOR_MODEL, contents: prompt, config: { systemInstruction, thinkingConfig: { thinkingBudget: 0 }, maxOutputTokens: FLAVOR_OUTPUT_TOKEN_BUDGET, abortSignal } })` under an `EMBED_SERVER_TIMEOUT_MS`-style composite controller (`FLAVOR_SERVER_TIMEOUT_MS`). **Thinking is DISABLED** (`thinkingBudget: 0`) — flavor is creative prose with no reasoning step, and on Gemini 2.5/3.x flash models thinking tokens are deducted from `maxOutputTokens`, so a tight cap would otherwise be eaten by thinking and truncate the visible prose mid-sentence. With thinking off, the whole budget feeds prose (also faster + cheaper).
- **Plain prose, NOT function-calling.** Read `response.text`; if empty/missing → 422. Return `{ text }`.
- Same failure→HTTP mapping as `conversation.ts`/`embeddings.ts`: 408 timeout / 502 network / 422 schema / 500 internal.

### Display surfaces (read persisted-or-stub)

Each surface reads `store(s => s.flavorText)`, looks up by id; present → render generated text; absent → render the designer stub.
- **Artifact backstory** → inline expandable in `src/ui/ledger/tabs/ArtifactsTab.tsx` artifact row (`artifact-row-{inst.id}`); look up `"artifact:" + inst.definitionId`.
- **NPC bio** → expandable under the portrait in `src/ui/ballroom/PortraitCard.tsx`; look up `"bio:" + character.id`. (The Family Tree tab is player-house-only per the P16 trip-hazard, so it is NOT the bio surface — bios are for ballroom NPCs.)
- **Scandal sheet** → a NEW read-only ledger tab `ScandalSheetTab.tsx` (10th tab), listing `"scandal:"` entries newest-first (generation + tick + body). Read-only; no game-state mutation (spec §3 line 271).

---

## Data shapes

Single new top-level field (one quad-sync entry, not three):

```ts
// src/game/rng.ts — branded id (companion Zod via .transform, per the HouseId pattern)
type FlavorContentId = string & { __brand: "FlavorContentId" };
// id forms: "artifact:<definitionId>" | "bio:<CharacterId>" | "scandal:<generationCount>"
// The keyed types (CharacterId, artifact definitionId, generationCount) are all ":"-free
// TODAY, so composites can't collide. But the codebase DOES mint ":"-bearing ids elsewhere
// (e.g. MarriageId = "alice:bob:7:0"), so ship a module-load assertion at the factory site
// that the underlying id contains no ":" — cheap insurance against a future ":"-bearing key type.

// src/game/entities.ts
const FlavorContentEntrySchema = z.object({
  id: FlavorContentIdSchema,
  kind: z.enum(["ArtifactBackstory", "NpcBio", "ScandalColumn"]),
  text: z.string().min(1),
  generatedAtTick: z.number().int().nonnegative(),
});
// GameStateSchema gains:
flavorText: z.map(FlavorContentIdSchema, FlavorContentEntrySchema)
```

```ts
// src/llm/types.ts — wire (shared client/server)
const FlavorContextSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ArtifactBackstory"), definitionId: z.string(), displayName: z.string(), family: z.string() }),
  z.object({ kind: z.literal("NpcBio"), character: CharacterSchema }),
  z.object({ kind: z.literal("ScandalColumn"), generationCount: z.number().int().nonnegative(), eventSummaries: z.array(z.string()) }),
]);
const FlavorRequestSchema = z.object({ context: FlavorContextSchema });
const FlavorResponseSchema = z.object({ text: z.string().min(1) });
```

---

## Generation specifics (verify exact SDK shape via Context7 at implementation)

- **Model (pinned):** `FLAVOR_MODEL = "gemini-3.5-flash"` — flavor prose does not need the Pro first-meeting model; cheap + fast. A concrete id, not a `latest` alias.
- **Token budget:** `FLAVOR_OUTPUT_TOKEN_BUDGET = 512` — a generous SAFETY CEILING, NOT the length control. Length is steered by the prompt (`buildUserPrompt` caps each kind: backstory/bio "at most 3 complete sentences, under 70 words"; scandal column "at most 5 complete sentences, under 110 words") + the system instruction's "always finish your final sentence", so the model completes naturally (`finishReason: STOP`) instead of being cut off at the wall (`finishReason: MAX_TOKENS`). Paired with thinking disabled (above). Tune at playtest.
- **Timeouts (fire-and-forget, so generous):** `FLAVOR_REQUEST_TIMEOUT_MS = 14_000` (client, via `AbortSignal.timeout`), `FLAVOR_SERVER_TIMEOUT_MS = 12_000` (server composite). Generation never blocks the tick or a conversation, so a long budget is harmless.
- **No persona cache, no function-calling, no tools** — single-shot plain `generateContent` with a per-kind system instruction.

---

## In scope

- **Server endpoint** `POST /api/llm/flavor` (`server/flavor.ts` + `server/prompts/flavor.ts`, routed in `server/index.ts`). Thin `generateContent` relay reusing `GEMINI_API_KEY`; same 408/502/422/500 failure mapping as `server/conversation.ts`.
- **Client wrapper** `src/llm/flavor.ts`: `fetchFlavorText(context, signal): Promise<string>`. Fetch `/api/llm/flavor`, validate `FlavorResponseSchema`, return `text`; HTTP-status → typed `errors.ts` failure mapping (mirrors `src/llm/embeddings.ts`). Element `llm` — imports only constants + `llm/types` + `llm/errors` (boundary rule c clean).
- **Runtime orchestrator** `src/runtime/flavorOrchestrator.ts`: `ensureFlavor(...)`, `enableFlavorContent()` (flips the activation flag — called once from `main.tsx`), `__setFlavorContentEnabledForTests(boolean)`, `bindStore(getState)`, the two bus subscriptions (conversation→bio, family→scandal), the in-flight dedupe set, and the pure `aggregateScandalEvents(state, sinceTick): string[]` helper.
- **Designer stub fixtures** `src/game/fixtures/flavorStubs.ts`: `ARTIFACT_BACKSTORY_STUBS: Map<definitionId, string>` (7 entries), `npcBioStub(character): string` (archetype/trait-templated — per-character stubs infeasible for procedural NPCs), `scandalColumnStub(generationCount): string`. Plus a `flavorStubFor(id, ...)` resolver used by every display surface.
- **Wire format** (`src/llm/types.ts`): `FlavorContextSchema` / `FlavorRequestSchema` / `FlavorResponseSchema`.
- **GameState field** (`src/game/entities.ts`): `flavorText` Map + `FlavorContentEntrySchema`; `FlavorContentId` brand + `FlavorContentIdSchema` in `src/game/rng.ts`.
- **Quad-sync + store action** (`src/game/store.ts`): `flavorText` added to `selectGameState`, `overwriteFromGameState`, `createInitialState` (`new Map()`); new free action `recordFlavorText(entry)` (Immer `set`, no tick advance, no publisher fan-out, no modal-state gate — flavor is gameplay-inert); `bindStore` + subscription import; `equipArtifact` post-set `ensureFlavor` call.
- **Hash** (`src/game/hash.ts`): `flavorText: serializeRegistry(state.flavorText)` added to `hashableState` (normal in-hash field, per `conversationHistory`).
- **Save V16** (`src/persist/schema.ts`): `SaveV16Schema` (= V15 + `flavorText: z.array(z.tuple([...]))`), `toSaveV16`, `fromSaveV16Bare`, `fromSaveV16`, `SAVE_VERSION_CURRENT = 16`. **No strip-cascade needed** — `flavorText` is a top-level field explicitly listed per emitter, so legacy `toSaveV1..V15` naturally omit it (strip helpers are only for fields embedded in House/Character that `serializeRegistry` would otherwise catch). Legacy `fromSaveV1..V15` defaults `flavorText` to `new Map()` — the field ORIGINATES in each Bare/direct-construction lifter's return literal (`fromSaveV1Bare`..`fromSaveV14Bare` + the V15 direct literal), exactly as `elopement: null` and `globalEvents: new Map()` are defaulted today (e.g. `fromSaveV4Bare`). Public wrappers inherit it via the seed-helper spread chain (`seedIndependentIntoLegacyState` etc. return `{ ...state, … }`), so it is NOT a separate "outermost lifter" seed step. The TS compiler enforces this — `flavorText` becomes a required `GameState` key, so any missed Bare literal fails typecheck (clarity, not a silent break).
- **V15 Bare/wrap split (REQUIRED prerequisite for the migration — do NOT skip).** `src/persist/schema.ts` today defines only `fromSaveV15` (the live loader, which inlines the `bootstrapNpcMountFamily` mount seed); there is **no `fromSaveV15Bare`**. Because V15 is the *current live* version, it never needed a Bare half before. The migration below consumes `fromSaveV15Bare`, so this phase must first create the split — mirror the existing `fromSaveV13Bare`/`fromSaveV13` pair: `fromSaveV15Bare` = pure `deserializeRegistry` of every field (no mount seed), and `fromSaveV15` = `bootstrapNpcMountFamily(fromSaveV15Bare(save))` (public wrapper preserves current loader behavior). This is genuine implementer work, not a rename.
- **Migration** `src/persist/migrations/v15-to-v16.ts`: `migrate_v15_to_v16 = (save) => toSaveV16({ ...fromSaveV15Bare(save), flavorText: new Map() })` (uses the **Bare** half — the migration runner does its own seed/mount steps, so the public mount-seeding wrapper would double-seed, per the P4 bare+wrap lesson); idempotence test via `assertMigrationIdempotent`. **Register in `src/persist/migrations/index.ts`** (NOT `runner.ts`) as a registry entry of the established form `{ from: 15, to: 16, migrate: (s) => migrate_v15_to_v16(SaveV15Schema.parse(s)), outputSchema: SaveV16Schema }` (mirror the v14→v15 entry at `index.ts:132-135`). `outputSchema` is a **registry-entry field**, not an export from the migration file. Forgetting the entry fails `assertMonotonic` at module-load.
- **Live-version consumer swaps (REQUIRED, easily missed — the recurring save-bump crash).** Bumping `SAVE_VERSION_CURRENT` 15 → 16 demotes V15 to legacy. Every non-schema reference to the *current* version must move to V16, or `save()` throws on every call (the `toSaveV15` emitter would write `version: 16` against `SaveV15Schema`'s `version: z.literal(15)` — the identical P13/P16 crash). This swap has been forgotten on every prior save-bump phase; enumerate it explicitly. The full sweep (`grep -rn 'SaveV15|fromSaveV15|toSaveV15' src/`, excluding `schema.ts`/`migrations/`):
  - `src/persist/dexie.ts:28-30` — import `SaveV16`/`SaveV16Schema`/`toSaveV16` (replacing the V15 imports).
  - `src/persist/dexie.ts:63` — add `| SaveV16` to the `SaveRecord.data` union.
  - `src/persist/dexie.ts:99` — the **live save emitter** flips `toSaveV15(state)` → `toSaveV16(state)`.
  - `src/persist/dexie.ts:111` — `load()` return type → `Promise<SaveV16 | undefined>`.
  - `src/persist/dexie.ts:133,141` — the current-version equality branch + post-migration parse → `SaveV16Schema.parse(...)`.
  - `src/ui/shared/SettingsMenu.tsx:5,46` — load path → `fromSaveV16`.
  - `src/persist/save-roundtrip.test.ts:12,37` — → `fromSaveV16`.
  - `src/persist/dexie.test.ts:57-64` — the "current-version malformed" case → keyed to V16, INCLUDING flipping the in-payload `version: 15` literal (line 64) to `16`, else the test silently routes through the legacy migration path instead of `SaveV16Schema.parse`.
- **Constants** (`src/game/constants.ts`, near the `LLM_*`/`EMBED_*` block): `FLAVOR_MODEL`, `FLAVOR_OUTPUT_TOKEN_BUDGET`, `FLAVOR_REQUEST_TIMEOUT_MS`, `FLAVOR_SERVER_TIMEOUT_MS`.
- **UI**: `ScandalSheetTab.tsx` (+ register in `LedgerView.tsx` tab union/list); backstory expandable in `ArtifactsTab.tsx`; bio expandable in `PortraitCard.tsx`. UI-local constants (expand/collapse, etc.) stay co-located per the P14 UI-constants rule.
- **`main.tsx`**: `enableFlavorContent()` + `flavorOrchestrator.bindStore` wiring at app entry (the ONLY production caller that flips the flag), alongside the existing `enableSemanticMemory()` block.
- **Test infra**: extend `vitest.setup.ts` global fetch stub with a `/api/llm/flavor` branch (deterministic `{ text }`); extend `__mocks__/@google/genai.ts` `generateContent` to also return a deterministic `.text` field (currently only returns `functionCalls`), so `server/flavor.test.ts` can read `response.text`.

## Out of scope

- **Streaming token rendering** (spec §10 OQ — DEFERRED). Single-shot only.
- **Per-character authored bios / artifact backstory editing** — generation + stub only; no in-game authoring UI.
- **Re-generation / regenerate button** — produced at most once; a successful entry is permanent for the campaign.
- **NPC bios for player-house members / a "Society / Ton" view** — bios surface on the ballroom PortraitCard only; the broader non-player roster view is the standing v1.5 candidate (MASTER §10 row V1.5).
- **A persistent event-log subsystem** — scandal aggregation reads existing state Maps; no new timeline entity.
- **Scandal columns mutating game state** — strictly read-only display (spec §3 line 271).

## Spec refs

§3 "Generated Flavor Content (LLM-Authored, Persisted)" (lines 264–271); §4 line 553 (Artifact Definition fields the backstory context draws on), line 540 (Character fields for the bio); §5 "Remote Large-Language-Model Service" failure behavior (line 599 — degrade gracefully); §3 line 70 / §8 (determinism boundary — LLM never touches the PRNG).

## Edge cases

- **Generation failure at first encounter** (spec §3 line 269): nothing persisted; display shows the designer stub; a later encounter retries. Game state, tick, PRNG all unaffected.
- **Re-encounter after success** (spec §3 line 270): `ensureFlavor` returns at the already-persisted check; the persisted text reads back verbatim. Model not re-invoked.
- **Save/load**: `flavorText` round-trips via the V16 schema like any Map; the model is not invoked on load (the orchestrator only fires from triggers, never from `replaceState`).
- **NPC dies between conversation and bio landing**: the post-await `recordFlavorText` still persists (bio of a now-dead NPC is fine — it is historical flavor); the PortraitCard simply stops rendering once the NPC leaves the roster. No cascade prune needed (flavor is never orphaned-by-death — keyed text, not a live reference).
- **Concurrent same-id triggers** (e.g., two fast conversations): in-flight dedupe set drops the second; the already-persisted check drops re-fires after success.
- **Quiet generation (empty scandal window)**: still produces a column; stub covers "a season without remark."
- **Non-browser env (Vitest/replay)**: `flavorContentEnabled` defaults false; every entry point returns on its first line; `typeof fetch` guard as defense-in-depth.

## Determinism contract (the load-bearing section)

- **`flavorText` is in the hash, exactly like `conversationHistory`.** The 30-run replay harness stays green because it **never invokes the LLM** — `flavorText` stays empty (`new Map()`) across all 30 runs and hashes identically. This is the same mechanism that already keeps `conversationHistory` in the hash without breaking replay. Add a harness assertion that `flavorText` is empty after a harness run.
- **Activation flag is the load-bearing inert-guard (per P17).** `flavorContentEnabled` (module-level, default `false`) is flipped `true` ONLY by `enableFlavorContent()` in `src/main.tsx`. The harness DOES drive `advanceTick`/`runYearPass`, and `runYearPass` fires the `familyBus` succession publisher — so the **bio/scandal bus subscribers ARE reached** during the harness (the equip trigger is NOT — the harness never calls `equipArtifact`; only `advanceTick`/`runYearPass`). The reached subscribers stay side-effect-free because the flag is off (first-statement early-return), NOT because of absence-of-`fetch`. The `typeof fetch` check is defense-in-depth only. Tests opt in via `__setFlavorContentEnabledForTests(true)` and MUST reset to `false` in `afterEach`/`finally`.
- **`recordFlavorText` never fires in tests/replay** — it is only called from `ensureFlavor`'s flag-gated success path. It advances the hash in real play (legitimate post-tick state change, like equipping an artifact), never touches the PRNG, and carries no publisher fan-out.
- **`recordFlavorText` deliberately does NOT gate on modal state** (exile / `elopement !== null`) — a **conscious divergence** from the P9 "every free-action wrapper gates" pin, documented here for the modal-state-gate ledger (mirrors the P12 `sendPromenadeMessage` precedent, which reasoned about the identical post-await-write race). Rationale: `recordFlavorText` is NOT a player-elected action (no UI affordance calls it — only `ensureFlavor`'s post-await success path), and its write is purely additive keyed text with no tick, no PRNG, and no gameplay mutation. If exile or elopement is entered during the in-flight round-trip, landing the flavor entry afterward is harmless. The next phase that audits the modal-state-gate ledger should treat this as an intentional exemption, not a missed gate.
- **No pure-rule change**: `src/game/rules/**` untouched. `aggregateScandalEvents` is a pure helper in the runtime flavor module (reads state, returns strings) — not a gameplay rule, never imported by `rules/**`.
- **Quad-sync trip-wire (`schema-projection-selector-extension.test.ts`) stays green** with `flavorText` added to all four surfaces — that is the proof the field is wired completely.
- **`lint:boundaries`** stays at the known baseline of exactly 2 pre-existing errors (P14 carve-out). A 3rd is a regression.

## New files

- `server/flavor.ts` (+ `server/flavor.test.ts`)
- `server/prompts/flavor.ts` (+ `server/prompts/flavor.test.ts`)
- `src/llm/flavor.ts` (+ `src/llm/flavor.test.ts`)
- `src/runtime/flavorOrchestrator.ts` (+ `src/runtime/flavorOrchestrator.test.ts`)
- `src/game/fixtures/flavorStubs.ts` (+ `src/game/fixtures/flavorStubs.test.ts`)
- `src/persist/migrations/v15-to-v16.ts` (+ `src/persist/migrations/v15-to-v16.test.ts`)
- `src/ui/ledger/tabs/ScandalSheetTab.tsx` (+ test)

## Touched files

- `server/index.ts` — route `/api/llm/flavor`.
- `src/llm/types.ts` — `FlavorContextSchema` / `FlavorRequestSchema` / `FlavorResponseSchema`.
- `src/game/rng.ts` — `FlavorContentId` brand + `FlavorContentIdSchema`.
- `src/game/entities.ts` — `FlavorContentEntrySchema` + `flavorText` on `GameStateSchema`.
- `src/game/hash.ts` — `flavorText` in `hashableState`.
- `src/game/store.ts` — `selectGameState`, `overwriteFromGameState`, `createInitialState`; `recordFlavorText` + `revealNpcBio` actions; `equipArtifact` `ensureFlavor` call; `flavorOrchestrator.bindStore` + subscription import.
- `src/game/store.replace-state.test.ts` — add a per-field block for `flavorText` (the 7th `overwriteFromGameState` write-side surface, the trip-wire's blind spot). The load-bearing variant: assert `advanceTick` PRESERVES a seeded `flavorText` entry (since `recordFlavorText` is the only mutator and never runs inside a tick, the real risk is a later tick CLEARING a previously-recorded entry — exactly the "silently destroys runtime state" failure CLAUDE.md warns about). Mirror the P9 elopement "5th surface" / P13 globalEvents "6th surface" blocks.
- `src/game/constants.ts` — flavor constants.
- `src/persist/schema.ts` — V16 schema + lifters + `SAVE_VERSION_CURRENT = 16`; empty-Map default in each Bare/direct lifter literal.
- `src/persist/migrations/index.ts` — register the `migrate_v15_to_v16` registry entry (`{ from, to, migrate, outputSchema }`).
- `src/persist/dexie.ts` — live-version consumer swap (imports, `SaveRecord.data` union, `toSaveV16` emitter, `load()` return type, two `SaveV16Schema.parse` sites — see the "Live-version consumer swaps" In-scope item).
- `src/ui/shared/SettingsMenu.tsx` — load path → `fromSaveV16`.
- `src/persist/save-roundtrip.test.ts` + `src/persist/dexie.test.ts` — re-key the current-version cases to V16 (including the `version: 15` → `16` in-payload literal in the malformed-current-version test).
- `src/ui/ledger/LedgerView.tsx` — register the Scandal Sheet tab: add to the `TabKey` union AND the `TABS` array, and update the stale `// P14: the canonical 8-tab Ledger view` header comment to `10-tab` (it was already stale at 9 after P15's Dynasty tab).
- `src/ui/ledger/tabs/ArtifactsTab.tsx` — backstory expandable.
- `src/ui/ballroom/PortraitCard.tsx` — bio expandable.
- `src/main.tsx` — `enableFlavorContent()` + `bindStore` wiring. **NOTE — `SettingsMenu.tsx` (load path) is touched but `CorruptSaveBanner.tsx` is deliberately NOT** (unlike mirrored-P17, which wired all three bootstrap entry points for its per-slot lore seed): P18's triggers are purely event-driven, so there is no per-slot bootstrap init for `CorruptSaveBanner` to call — only `main.tsx` flips the flag + binds the store. This is intentional, not a missed init site.
- `vitest.setup.ts` — `/api/llm/flavor` fetch-stub branch.
- `__mocks__/@google/genai.ts` — deterministic `.text` on `generateContent`.

## Verification

- **`pnpm test`** — all suites pass. New suites: server flavor handler (success + 408/502/422 mapping); client `fetchFlavorText` (text round-trip + HTTP-status → failure mapping); flavorOrchestrator (ensureFlavor already-persisted short-circuit, in-flight dedupe, flag-gated inertness, success → `recordFlavorText`, failure → no persist; `aggregateScandalEvents` window/selection; the two subscribers fire only when enabled); flavorStubs (shape/non-empty/per-id resolution); v15→v16 migration (round-trip + idempotence + `outputSchema` parse).
- **`buildFlavorPrompt`** test: each kind produces a distinct, period-voiced prompt; the scandal kind renders `eventSummaries`.
- **Determinism (must stay green)**: `schema-projection-selector-extension.test.ts` + `hashable-state-extension.test.ts` now include `flavorText` (4-surface sync); `store.replace-state.test.ts` gains the `flavorText` 7th-surface block (advanceTick preserves a seeded entry); the **30-run replay harness** passes with a new assertion that `flavorText` is empty post-run (proof the harness never generated flavor).
- **Persisted-verbatim (spec §3 line 270)**: a test that calls `ensureFlavor` twice for the same id invokes the endpoint once; a save→load round-trip returns the stored text byte-identical and invokes the model zero times.
- **Publish-boundary safety**: assert `bus.publish` survives a synchronously-throwing flavor subscriber AND that the `flavorContentEnabled` early-return is each subscriber's first statement.
- **Activation-flag teardown**: every opt-in test resets the flag to `false` in `afterEach`/`finally`.
- **`pnpm lint`** — Biome clean. **`pnpm lint:boundaries`** — exactly the 2 baseline errors.
- **`pnpm typecheck`** — strict clean.
- **LLM failure paths exercised** (not just happy path): flavor request timeout / network / schema all degrade to the stub with nothing persisted.
- **Manual (dev server)**: with a real `GEMINI_API_KEY`, equip an artifact → backstory appears in the Artifacts tab; open an NPC's "Who is this?" expander in the ballroom → a complete (non-truncated) bio generates without any conversation; advance to a succession → a scandal column appears in the Scandal Sheet tab; save → reload → load → all three read back verbatim with no model call. Pull the network mid-generation → the stub shows and play continues. If the UI/LLM path can't be exercised, say so explicitly. **(Verified this session: artifact backstory on equip, bio on reveal, save/load verbatim — all complete, non-truncated. Scandal generation at succession remains test-covered only.)**

## Close out

When the gates and verification items above are green, run `/close-phase 18`:
- **`plans/MASTER.md` §6** — P18 status row → done.
- **`plans/MASTER.md` §10** — resolve the streaming-dialogue flavor OQ note as DEFERRED (no v1 change); record the four resolved decisions (scope=all three, persistence=in-save/in-hash, trigger=auto-on-first-encounter, cadence=per-generation) — and explicitly the **in-save/in-hash divergence from P17's sidecar**, justified by the `conversationHistory` precedent.
- **`plans/SESSION-NOTES.md`** — append the phase summary.
- **`CLAUDE.md`** additions: (a) the `flavorText`-in-hash-like-`conversationHistory` rationale and why it diverges from the P17 sidecar (authored content vs rebuildable cache); (b) the `flavorContentEnabled` activation-flag inert-guard + `recordFlavorText` flag-gated write discipline; (c) `flavorText` is the V16 quad-sync addition with NO strip-cascade (top-level field, legacy emitters omit it, legacy lifters default empty-Map); (d) the three first-encounter triggers and the single `ensureFlavor` funnel; (e) the `server → /api/llm/flavor` edge reusing the Gemini key with server-owned prompts.

Then commit the changes (no push).

---

## Accumulated Risks & Suggestions

*Passively collected from review cycles. Not blockers. Triaged at convergence.*

- (seed) [C1: correctness-critical, sharpened] [likely addressed — folded into Trigger 3 body] Scandal trigger's player-house filter is NOT just efficiency. `familyBus` `ArchetypeReclassified` carries only `characterId` (NO houseId — `family.ts:71-77`), and `publishArchetypeReclassificationsFromSuccession` iterates ALL characters, firing `trigger:"Succession"` for rival/Independent houses too (`family.ts:182-201`). The subscriber MUST resolve `getState().characters.get(characterId).houseId === PLAYER_HOUSE_ID` before minting a column — otherwise a rival/Independent succession mints a spurious column keyed `"scandal:" + <player's generation>` over the player's window (wrong content + colliding id). `semanticIndex` already does this houseId resolution.
- (seed) [C1: confirmed by reviewer] The genai mock's `generateContent` `.text` addition is safe — `server/conversation.ts:71` reads `response.functionCalls?.[0]` (optional-chained), so adding a sibling `.text` field doesn't break conversation tests. Keep both fields on the mock return.
- (seed) [C1: confirmed by reviewer] The store→`flavorOrchestrator` edge (from `equipArtifact`) and the runtime→`llm` edge are permitted: eslint `default: "allow"`, no `from: ["runtime"]` disallow block; store already imports `semanticIndex` (`store.ts:442`), runtime already imports `../llm/embeddings` (`semanticIndex.ts:29`).
- (seed) [C1: confirmed by reviewer] `recordFlavorText` as no-op-if-present (`flavorText.has(id)`) is the right call — honors "produced at most once" even if a race slips past `ensureFlavor`'s check.
- (seed) `FlavorContentId` is a free-form composite (`"bio:" + CharacterId`); ensure the `:` separator can't collide with any id that itself contains `:` (brand-cast at one factory site; add a module-load assertion if any underlying id type permits `:`). `[applied]` — promoted to the Data-shapes body.
- [C1] [likely addressed — folded into pipeline body] flavorOrchestrator's store accessor must be typed `() => StoreState` (= `GameState & StoreActions`, `store.ts:394`), NOT `() => GameState` — do NOT literally mirror `semanticIndex`'s `readState: () => GameState` (`semanticIndex.ts:47`), which deliberately narrows to state-only because it never calls actions. `recordFlavorText` is a `StoreAction`, so the narrowed type makes `readState().recordFlavorText` a compile error. Zustand's `get()` returns `StoreState` at runtime; type the accessor accordingly.
- [C1] [likely addressed — folded into Trigger 1 body] Bio trigger: `ConversationResolved` carries `pairKey` (a `ConversationPairKey`), NOT a target `CharacterId` (`conversation.ts:52-60`, `store.ts:1236`). The subscriber must decompose the pairKey via `parsePairKey` to get the target before building `"bio:" + T`. CORRECTION: `parsePairKey`'s canonical home is `src/game/conversation/types` (what `semanticIndex.ts:24` imports); `llm/types.ts` only re-exports it. A runtime module imports from `game/conversation/types`.
- [C1] [likely addressed — folded into Trigger 2 body] Artifact trigger: `equipArtifact`'s wrapper signature is `(characterId, artifactInstanceId)` and its pure result is `{ ok, state }` — none of `definitionId`/`displayName`/`family` are in scope at the call site. Derive them: `result.state.artifactInstances.get(artifactInstanceId).definitionId` → `ARTIFACT_REGISTRY.get(definitionId)` for `displayName`/`family` (the `ArtifactsTab.tsx:186` pattern). Build the `ensureFlavor` context from these.
- [C1] [likely addressed — folded into Trigger 3 body] `aggregateScandalEvents` source shapes: all source Maps carry tick fields (schemes `resolvedAtTick`, whispers `weaponizedAtTick`, duels `resolvedAtTick`, marriages `marriedAtTick`/`dissolvedAtTick`, forgeries `surfacedAtTick`, deaths `diedAtTick`). NOTE: blood feuds are nested on `house.bloodFeuds` (an array, `entities.ts:184`), NOT a top-level `state.bloodFeuds` Map — the helper walks houses for those, not a Map. Most tick fields are `.nullable()` — skip null before the window comparison (a `null < n` coercion silently includes unresolved entries).
- [C1] Scandal tab registration: the plan's "10th tab" is correct (`TABS` has 9 entries, `LedgerView.tsx:35`), but the file's own header comment still says "8-tab" (stale since P15's Dynasty tab). When registering `ScandalSheetTab`, update the `TabKey` union, the `TABS` array, AND that stale header comment. `[applied]` — folded into the `LedgerView.tsx` touched-files line.
- [C2] [likely addressed — folded into Save V16 in-scope] Migration backfill wording: `flavorText: new Map()` ORIGINATES in each Bare/direct lifter return literal (like `elopement`/`globalEvents`), NOT a single "outermost lifter" seed step; public wrappers inherit via the seed-helper spread chain. TS enforces it (required `GameState` key).
- [C2] [likely addressed — folded into Determinism contract] `recordFlavorText` no-modal-gate is a conscious divergence from the P9 "every free-action wrapper gates" pin (mirrors the P12 `sendPromenadeMessage` post-await-race precedent); documented as an intentional exemption (not player-elected; additive keyed text, no tick/PRNG/gameplay mutation).
- [C2] Consider explicit per-file ESLint boundary positive-control assertions for the three new cross-element files (`server/flavor.ts`, `src/llm/flavor.ts`, `src/runtime/flavorOrchestrator.ts`). All edges hand-verified clean (server allow-list, llm allow-list, runtime no-disallow), so low priority — P17 omitted them too and was accepted.
- [C1] [likely addressed — folded into Migration in-scope + touched-files] Migration registry site is `src/persist/migrations/index.ts` (NOT `runner.ts`); the registry entry is `{ from, to, migrate, outputSchema }` (mirror v14→v15 at `index.ts:132-135`). `outputSchema` is a registry-entry field, not a migration-file export; forgetting the entry fails `assertMonotonic` at module-load.
- [C3] [likely addressed — corrected in Trigger 3 body] "Resolved elopements" was a phantom aggregation source: `state.elopement` is a nullable singleton nulled on resolution (P9 Branch 5), so there is no archive to walk — the launching Seduction scheme in `state.schemes` is the only surviving signal (already covered by the schemes source).
- [C3] [likely addressed — added to Touched + Verification] `overwriteFromGameState` is the 7th write-side surface, not covered by the 3-surface trip-wire; `store.replace-state.test.ts` needs a `flavorText` per-field block (advanceTick preserves a seeded entry) or a later tick silently clears recorded flavor.
- [C3] [likely addressed — corrected in Determinism contract] Determinism wording overstated harness coverage: `replay-harness.test.ts` calls only `advanceTick`/`runYearPass` (reaches the bio/scandal bus subscribers via the succession publisher), NOT `equipArtifact` — the equip trigger isn't harness-exercised (conclusion unaffected; the flag-gate keeps all paths inert).
- [C4] `server/flavor.ts` borrows `server/embeddings.ts`'s skeleton (parse → `validateEnv` → `AbortController` → error-mapping) but the SDK CALL diverges: `generateContent({ contents, config: { systemInstruction, maxOutputTokens, abortSignal }})` reading `response.text`, vs embeddings' `embedContent`. The "verify exact SDK shape via Context7" note is load-bearing, not boilerplate.
- [C4] Add a one-line note that `CorruptSaveBanner.tsx` is deliberately NOT a touched file (unlike mirrored-P17): P18's triggers are event-driven, so there is no per-slot bootstrap init for it to call — only `main.tsx` wires `enableFlavorContent()` + `bindStore`. Pre-empts a "missed init site" misread. `[applied]` — added to the `main.tsx` touched-files line.
- [C4] Pin `FLAVOR_OUTPUT_TOKEN_BUDGET` to a concrete value (e.g. `300`) — currently "~300" while the other three flavor constants are exact; "designer constants in one place" wants a literal. `[applied]` — pinned to `300` in Generation specifics.
- [C4] (sharpens the `:`-separator item) `MarriageId` DOES embed `:` (e.g. `alice:bob:7:0`), proving the codebase mints `:`-bearing ids — but the keyed types here (`CharacterId`, artifact `definitionId`, `generationCount`) are all `:`-free, so composites are safe TODAY. The module-load assertion is cheap insurance worth promoting from tail to body.
