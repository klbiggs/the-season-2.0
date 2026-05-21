# P4 — LLM Conversation & Ballroom

> ⚠️ **Post-P7 amendment**: the BYOK key flow described below was relocated to a localhost Node proxy at P7.5. See [`plans/phases/07-5-llm-relocation.md`](./07-5-llm-relocation.md) and [`plans/MASTER.md` §5.4](../MASTER.md#54-llm-integration-contract-5--p75-relocated-to-localhost-proxy) for the current architecture. This phase plan is preserved as the historical record of what shipped at the time, per CLAUDE.md "Don't edit closed phase plans" rule (the one-line callout above is a documented exception with rationale: post-ship architectural relocation).

> Part of [The Season Master Plan](../MASTER.md). Prior: [P3 — Strategy Map](./03-strategy-map.md). Next: [P5 — Schemes](./05-schemes.md).

**Goal.** The signature surface. At a high-society ball, the player sees up to 5 NPCs in a ring, selects a target, optionally pins a tactic, types a freeform message, and receives in-character dialogue + deterministic state deltas. P4 introduces the first non-deterministic subsystem (the LLM round-trip via Google's Gemini API through `@google/genai`) inside the project's existing determinism contract — the conversation layer must NOT advance the gameplay PRNG call-count, and the four enumerated failure paths (timeout / network / schema / missing-key) must each leave game state untouched while keeping every other system fully functional. P4 also introduces the first minimal NPC pool so the ballroom has actual cards to render.

This is the largest determinism-boundary phase in the project. It bumps the save format to v5, extends the schema↔projection↔selector triple, adds a new `src/llm/` module under boundary discipline (wrapping the Gemini SDK), defines the full conversation-combat tuning surface in `constants.ts`, and ships the ballroom UI as a sibling to the P3 map view. Conversation history is bounded per-pair to 3 most-recent exchanges and survives heir promotion via a `(playerHouseId, targetCharacterId)` composite pair key.

**In scope.**

- **Save format bump to v5.** Adds two state surfaces: `GameState.conversationHistory: Map<ConversationPairKey, Exchange[]>` and `Character.composure: number` / `Character.maxComposure: number` (composure is in spec §4 line 540 but was not added at P1 — P4 finally adds it because the combat math needs a persisted target composure and a session-local player composure that derives from this max).
- **Minimal NPC pool seeded at campaign start.** P4 introduces an `INDEPENDENT_HOUSE_ID` placeholder house ("London Society") and 5 baseline NPCs assigned to it. P8 ships rival-house NPCs; some of the P4 baseline pool may later migrate, but the schema doesn't care which house owns an NPC.
- **`src/llm/` module.** `client.ts` (Gemini SDK setup via `@google/genai`, BYOK, 15s `AbortController.signal.timeout()`, pre-flight key check), `tools.ts` (the `respond` `FunctionDeclaration`), `routing.ts` (`routeModel(history)` first-meeting decision), `prompts/persona.ts` (per-character persona block, used as the `systemInstruction` when creating a `CachedContent` resource), `cache.ts` (per-target context-cache lifecycle: lazy `caches.create` on first contact, TTL refresh on hit, miss-fallback to uncached system instruction), `types.ts` (Zod response schema + canonical types), `errors.ts` (typed error classes — TimeoutError, NetworkError, SchemaError, MissingKeyError, CancelledError).
- **Pure rule `src/game/rules/combat.ts`.** Affection/composure math per spec §3 "Conversation Combat Math" with full tactic↔trait↔mood bonus/penalty maps in `constants.ts`. Stance modifiers. Quality-multiplier clamp + classification fallback.
- **`src/runtime/conversationOrchestrator.ts`.** Owns the request lifecycle (Idle → Sending → Resolving → Done | Failed). Owns the `AbortController` and the `requestId` ref pattern — the orchestrator exposes a typed `send(input): Promise<ConversationOutcome>` and the React surface holds the cancel handle.
- **`src/runtime/events/conversation.ts`.** Typed event variants (`ConversationSent` / `ConversationResolved` / `ConversationFailed` / `FauxPasFired`). Single bus instance per CLAUDE.md's domain-partitioned event-bus discipline.
- **Ballroom UI (`src/ui/ballroom/`).** 5 portrait cards in a CSS-grid ring; tactic buttons (Flattery, WittyBanter, SlyGossip, DeepEmpathy) that double as prefill + intent pin; stance toggle (Wallflower / Mingle / TargetedPursuit); message input; chat history (3 most-recent per pair); session-local player-composure indicator; "thinking..." indicator during in-flight requests.
- **BYOK key input UX.** Sticky banner at `<TopBar />` when key absent, disables only the ballroom send affordance.
- **XState v5 conversation machine.** First XState user in the project; the machine lives in `src/game/machines/conversation.ts` and is held as an actor ref inside the conversation orchestrator.

**Out of scope.**
- Scheme buttons inside ballroom (P5 wires them in via `ConversationContextMenu`).
- `generateWhisper` tool call (P6 enables the tool variant; the `respond` tool's `toolCalls?: Array<...>` field is reserved at P4 as `z.array(z.never()).default([])`).
- Patroness veto on ball entry (P8 — at P4, balls are unconditionally accessible from `Capital`).
- Ball pre-composure penalty from wardrobe decay (P10 reads `wardrobeLastRefreshTick`).
- Rival-house NPCs at the ball (P8 — at P4 the 5 baseline NPCs all belong to `INDEPENDENT_HOUSE_ID`).
- Semantic memory / embedding-based history retrieval (P17 — at P4, the recency window of 3 is the only context).
- Persona prompt content authoring beyond the structural template (P18 — at P4, persona blocks are deterministically generated from trait + mood + role; P18 polishes the prose).
- NPC-initiated conversations, streaming dialogue, multi-tool surface (all locked to "deferred" — see Resolved decisions below).

**Spec refs.** §3 "Conversational Ballroom", "Stance Modifiers", "Conversation Combat Math", "Language-Model Quality Modulation", "Mood Transitions"; §4 "Core Entities" (Character composure, Chat Exchange); §5 "Remote Large-Language-Model Service"; §6 "Authentication & Authorization"; §7 "Mid-conversation view exit", "Heir promotion mid-conversation", "Mood-lock cascade prevention", "Conversation history orphan keys", "Embedding service failure during conversation start"; §8 conversation timeout NFR + conversation-history < 50 KB NFR.

**Resolved decisions (§10).** All four open-question defaults are locked at P4. MASTER.md §10 carries the "Resolved at P4" tag.

- **#5 — Model routing** is **first-meeting only**. The decision point is a single pure function `routeModel(history: readonly Exchange[]): Model`: empty history → Gemini Pro (`MODEL_FIRST_MEETING`); non-empty → Gemini Flash (`MODEL_DEFAULT`). No proposal / scheme-completion / duel / audience override seams ship at P4. The "pre-wired but not active" spec phrasing is satisfied by `routeModel`'s shape — a future phase widening it to take `actionContext` is a localized refactor, not a load-bearing P4 commitment.
- **#13 — Tool surface** is the **single structured `respond` tool**. No `generateWhisper` tool ships at P4 (whispers don't exist until P6). The `toolCalls?: Array<...>` field on the response schema is reserved at P4 as `z.array(z.never()).default([])` — schema-present, contents-empty. P6 widens the variant. Reserving the field at P4 prevents a SaveV5→SaveV6 bump just to widen a tuple — the payload shape is forward-compatible.
- **#14 — NPC-initiated conversations** are **deferred**. The conversation round-trip is strictly player-initiated. No "NPC speaks first" prompt path; no autonomous greeting state machine. The ballroom's idle state is the player choosing a target — not the NPC opening.
- **#15 — Streaming dialogue** is **NOT in v1**. The SDK call is the non-streaming `ai.models.generateContent(...)` form (NOT the `generateContentStream` variant the SDK also exposes). The UI displays a single-shot "..." indicator during `Sending → Resolving`. No partial-token render path; no mid-stream cancellation logic. Cancellation is via `AbortController.abort()` (signal passed in `config.abortSignal`) on the whole request — used for view-exit and timeout.

---

## Save format bump to v5

P4 extends `GameState` with **two** new top-level fields and extends `Character` with **two** new fields. SaveV5 is the new live format. Following the P3 cutover pattern verbatim, P4 ships these coordinated edits as a single atomic commit (see "Atomic commit step order" below for the typecheck-clean interleaving inside that commit).

**New `GameState` fields (two):**
- **`conversationHistory: Map<ConversationPairKey, Exchange[]>`** — bounded per pair to 3 most-recent entries (FIFO eviction at append time, not read time). Replay-relevant: lives in the hash projection. Empty by default on fresh state and on every legacy lift.
- **`affectionMap: Map<ConversationPairKey, number>`** — player-house→target affection scores. Clamped `[0, 100]` at every mutation site (CLAUDE.md non-negotiable §6). Pair-key shape is the same `\`${playerHouseId}|${targetCharacterId}\`` used by `conversationHistory`, so the orphan-prune cascade walks both collections in a single filter pass. Empty by default on fresh state and on every legacy lift.

**Why a top-level `affectionMap` (not `Character.affectionTo`):** at P4 the affection model is *player-house→target NPC*, not character→character. The player house is the subject; targets are individual NPCs. Heir promotion preserves affection naturally because the pair key is keyed on the player HOUSE, not the player CHARACTER (matches the conversation-history-survives-succession contract from spec §7). A top-level Map at GameState avoids loading Character with a per-target sub-Map and lets both pair-keyed collections share serialization + orphan-prune logic. Future phases that need NPC→NPC affection (P11 sibling-rival hostility is the closest analog) can introduce a separate registry; the player-house→target shape is the v1 model.

**New `Character` fields (two):**
- **`composure: number`** — clamped `[0, maxComposure]` at every mutation site. Defaults `100` on fresh-state seed and on legacy lift. Spec §4 line 540 ("current and max composure") — P1 deferred this; P4 cannot defer further because faux-pas math needs target composure and the combat resolver writes to it.
- **`maxComposure: number`** — uncapped above zero. Defaults `100`. Reserved as a per-character ceiling (later phases may grant trait-based bumps).

**Schema delta summary (the authoritative count):** GameState +2 fields, Character +2 fields. No other Character or House field changes at P4. Any plan paragraph below that contradicts this count is stale — flag for cleanup.

### `migrate_v4_to_v5` (`src/persist/migrations/v4-to-v5.ts`)

Pure function `(SaveV4) → SaveV5`. Body is the compose-with-helper-then-reserialize form pinned in "Caller list + integration pattern" below:
```ts
export function migrate_v4_to_v5(save: SaveV4): SaveV5 {
  const bare = fromSaveV4Bare(save);
  const playerSeed = save.rng.find(([id]) => id === PLAYER_HOUSE_ID)?.[1].seed;
  if (playerSeed === undefined) throw new Error("migrate_v4_to_v5: missing player RNG entry");
  const seeded = seedIndependentIntoLegacyState(bare, playerSeed);
  return toSaveV5(seeded);
}
```
The migration result is a SaveV5 (tuple-array form, satisfying the migration runner's contract). Effects:
- Adds `conversationHistory` and `affectionMap` (via the bare deserializer's defaults).
- Adds `composure: 100, maxComposure: 100` to existing characters (via `liftLegacyCharacters` inside Bare).
- Seeds the Independent house + 5 NPCs + Independent RNG (via `seedIndependentIntoLegacyState`).
- Re-serializes as SaveV5 tuple arrays (via `toSaveV5`).

Draw budget is **ZERO** — every default is a literal constant; the Independent NPCs all use constant deathAges from the fixture; the Independent RNG seed is derived deterministically from the player seed. A future migration that wants randomized starting composure MUST bump past v5. **Idempotence assertion** ships in `src/persist/migrations/v4-to-v5.idempotence.test.ts` using the existing `assertMigrationIdempotent` helper from `src/persist/migrations/__test-utils__/idempotence.ts` (P2). The test file follows the precedent of `v2-to-v3.idempotence.test.ts` — a thin file containing `assertMigrationIdempotent(migrate_v4_to_v5, fixtureSaveV4)` for a small set of SaveV4 fixtures.

**`fromSaveV1` / `fromSaveV2` / `fromSaveV3` / `fromSaveV4` legacy lifters** also need to seed Independent on direct-lift (bypassing the migration runner). The lifters' Independent-seeding logic is identical to the migration's — extract via a shared `seedIndependentIntoLegacyState` helper inside `src/persist/schema.ts` that the migration AND the lifters both call. **Helper specification:**

```ts
// src/persist/schema.ts (private to the lift/migrate boundary; not exported)
//
// Idempotent: if state.houses already contains INDEPENDENT_HOUSE_ID, returns
// the input unchanged. This lets the migration runner and the legacy lifters
// BOTH call this helper without double-seeding when both paths happen to
// fire (e.g., a future hot-load that runs a V4 save through both the
// migration runner AND fromSaveV4 in sequence).
//
// Mutates by returning a new GameState with three additions: the Independent
// house (built from literal defaults + Blackwood as head), the 5 baseline
// NPCs (built from BASELINE_NPCS via the per-NPC construction template, with
// composure/maxComposure already set), and the Independent RNG entry
// (deterministically derived from the player seed).
//
// Boundary impact: this function lives in src/persist/schema.ts which is in
// the persist ESLint element. It imports from src/game/fixtures/npcs.ts
// (game-fixtures element) — already permitted by the default-allow tier;
// no boundary widening needed.
function seedIndependentIntoLegacyState(
  state: GameState,
  playerSeed: string,  // The seed-string field of the player's RngState (NOT a serialized post-draw form). Must match exactly what createRngState's argument was at fresh-state construction so Independent's derived RNG is byte-identical across fresh-state and migration paths.
): GameState {
  // Idempotence: if Independent is already there, no-op
  if (state.houses.has(INDEPENDENT_HOUSE_ID)) return state;

  const houses = new Map(state.houses);
  houses.set(INDEPENDENT_HOUSE_ID, buildIndependentHouse());

  const characters = new Map(state.characters);
  for (const npcSeed of BASELINE_NPCS) {
    if (characters.has(npcSeed.id)) continue;  // idempotence at the NPC level too
    characters.set(npcSeed.id, buildBaselineNpcCharacter(npcSeed));
  }

  const rng = new Map(state.rng);
  if (!rng.has(INDEPENDENT_HOUSE_ID)) {
    rng.set(INDEPENDENT_HOUSE_ID, createRngState(`${playerSeed}|independent`));
  }

  return { ...state, houses, characters, rng };
}
```

**Caller list + integration pattern.** The migration runner expects each `migrate_vN_to_v{N+1}` to be a pure tuple-array transform `(SaveVN) → SaveV{N+1}` (consistent with v1-to-v2, v2-to-v3, v3-to-v4). But `seedIndependentIntoLegacyState` operates on `GameState` (Map form). The cleanest integration is to **split `fromSaveV4` into a "bare" core and a "seeded" wrapper**, then express the migration as `toSaveV5 ∘ helper ∘ fromSaveV4Bare`:

```ts
// src/persist/schema.ts — private to lift/migrate boundary
function fromSaveV4Bare(save: SaveV4): GameState {
  // Identical to the existing fromSaveV4 body but WITHOUT the
  // seedIndependentIntoLegacyState call. Pure deserialization:
  // liftLegacyCharacters + deserializeRegistry for rng/houses/marriages
  // + the two new GameState fields defaulted to empty Maps.
  return {
    tick: save.tick,
    rng: deserializeRegistry(save.rng) as GameState["rng"],
    houses: deserializeRegistry(save.houses) as GameState["houses"],
    characters: liftLegacyCharacters(save.characters),
    marriages: deserializeRegistry(save.marriages) as GameState["marriages"],
    campaignName: save.campaignName,
    era: save.era,
    conversationHistory: new Map(),
    affectionMap: new Map(),
  };
}

// Public fromSaveV4 — used by tests and any future direct-lift hot-paths.
// Composes Bare + helper.
export function fromSaveV4(save: SaveV4): GameState {
  const bare = fromSaveV4Bare(save);
  const playerSeed = save.rng.find(([id]) => id === PLAYER_HOUSE_ID)?.[1].seed;
  if (playerSeed === undefined) throw new Error("fromSaveV4: missing player RNG entry");
  return seedIndependentIntoLegacyState(bare, playerSeed);
}

// migrate_v4_to_v5 uses the same compose-with-helper-then-reserialize shape:
export function migrate_v4_to_v5(save: SaveV4): SaveV5 {
  const bare = fromSaveV4Bare(save);
  const playerSeed = save.rng.find(([id]) => id === PLAYER_HOUSE_ID)?.[1].seed;
  if (playerSeed === undefined) throw new Error("migrate_v4_to_v5: missing player RNG entry");
  const seeded = seedIndependentIntoLegacyState(bare, playerSeed);
  return toSaveV5(seeded);
}
```

**Same compose-with-helper-then-reserialize pattern applies to `fromSaveV1` / `fromSaveV2` / `fromSaveV3`** — each splits into `fromSaveVNBare` (no seeding) + `fromSaveVN` (calls Bare + helper). The Bare versions are private to `schema.ts`; the public lifters are unchanged in name. **The migration runner is unaffected** — its contract (`(unknown) → SaveV{N+1}`) is satisfied because `migrate_v4_to_v5` produces a SaveV5 (tuple-array form via `toSaveV5`).

**Idempotence note:** if a save somehow already contains Independent (e.g., a manually-edited V4 save), `seedIndependentIntoLegacyState`'s `state.houses.has(INDEPENDENT_HOUSE_ID)` check short-circuits — the helper is a no-op. The helper assumes "has-Independent-house implies has-all-baseline-NPCs"; future migrations that introduce intermediate states (e.g., splitting Independent into multiple houses, or removing some NPCs) must NOT call this helper or must add a stronger idempotence check.

**`fromSaveV5`** does NOT call the helper — V5 saves already contain Independent by schema. Calling it would be a defensive no-op via idempotence; skip it for clarity.

**`fromSaveV1` partial-state semantics.** A SaveV1 carries NO houses or characters (the V1 format predates them). Running through `fromSaveV1Bare → seedIndependentIntoLegacyState` produces a `GameState` with the Independent house + 5 NPCs but NO player house/character. This is semantically partial — but `fromSaveV1` is **test-only post-P4**: the production load path always routes through `runMigrations(save, 1, 5, MIGRATIONS)` which composes `migrate_v1_to_v2` (which seeds the player via `seedStartingFamily`) → `migrate_v2_to_v3` → `migrate_v3_to_v4` → `migrate_v4_to_v5` (which seeds Independent). The lifters' partial-state behavior is only ever observed by the migration-chain tests and the `v1-to-v2.parity.test.ts`/`callcount-passthrough.test.ts` regression gates, which already deal with this shape. Plain `Error` throws in the lifters (not `SaveLoadError`) are acceptable because production never reaches them.

**`save.rng` lookup uses find-by-id (NOT positional)** — `save.rng.find(([id]) => id === PLAYER_HOUSE_ID)` rather than `save.rng[0]`. V1 saves have player at index 0, but future migrations might reorder the array (lex-sort would place Independent first); the find-by-id is forward-compatible.

Register in `src/persist/migrations/index.ts` after the existing `v3-to-v4` entry; `assertMonotonic(MIGRATIONS)` catches misregistration at module load.

### `fromSaveV1` / `fromSaveV2` / `fromSaveV3` / `fromSaveV4` updated to default the v5 fields on lift

Mirrors the P3 discipline (every lifter defaults missing-in-source fields to the canonical default). The lift path is the parse-then-construct boundary; saves that bypass the migration runner (legacy parity tests, future hot-load paths) still need the defaults. Mirrors P2's `campaignName` and P3's House-field precedent.

- **`fromSaveV1` / V2** add BOTH `conversationHistory: new Map()` AND `affectionMap: new Map()`. Characters in V1/V2 saves are lifted via existing `deserializeRegistry` path; that path doesn't add composure. Add a `defaultCharacterV5Fields` helper alongside the existing `defaultHouseV4Fields` helper in `schema.ts`; apply it inside `liftLegacyCharacters` (new helper symmetric with `liftLegacyHouses`).
- **`fromSaveV3` / V4** also need the helper because V3 and V4 Character schemas don't have composure. Refactor: define `CharacterPreV5Schema` in `schema.ts` mirroring the `HousePreV4Schema` pattern; use it in `SaveV2Schema.characters`, `SaveV3Schema.characters`, `SaveV4Schema.characters`. The lifters all route through `liftLegacyCharacters`.

### Full edit list at `src/persist/schema.ts` and `src/persist/dexie.ts`

- **`src/persist/schema.ts:24`**: `SAVE_VERSION_CURRENT = 4 as const` → `SAVE_VERSION_CURRENT = 5 as const`. Legacy `toSaveV1` / `toSaveV2` / `toSaveV3` / `toSaveV4` retain their literal `version: N` writes per the P2/P3 precedent.

- **`src/persist/schema.ts` new helpers** (added before the SaveV1 block):
  ```ts
  // Legacy Character shape (without P4's composure/maxComposure). Derived
  // from live CharacterSchema via Zod's .omit() — automatic schema-drift
  // tracking: a future Character field addition only needs to extend the
  // .omit() argument list IF that future field is also added on a save bump.
  // Used by V2/V3/V4 schemas so legacy saves parse correctly. Lifters apply
  // defaultCharacterV5Fields per character on read. NOT exported — private
  // to the lift path.
  const CharacterPreV5Schema = CharacterSchema.omit({
    composure: true,
    maxComposure: true,
  });
  type CharacterPreV5 = z.infer<typeof CharacterPreV5Schema>;

  function defaultCharacterV5Fields(c: CharacterPreV5): Character {
    return { ...c, composure: 100, maxComposure: 100 };
  }

  function liftLegacyCharacters(
    serialized: ReadonlyArray<readonly [CharacterId, CharacterPreV5]>,
  ): GameState["characters"] {
    const out: GameState["characters"] = new Map();
    for (const [, c] of serialized) {
      out.set(c.id, defaultCharacterV5Fields(c));
    }
    return out;
  }
  ```
  **Why `.omit()` (Zod method) and not hand-rolled `z.object` or TS `Omit<>`:** Zod's `.omit()` produces BOTH a runtime parser AND a TS type from a single source — the live `CharacterSchema` — so future Character field additions don't require a parallel maintenance pass on `CharacterPreV5Schema`. The hand-rolled `HousePreV4Schema` in `schema.ts:31` predates this realization and could be refactored similarly; that's deferred polish, not P4 scope.

- **`src/persist/schema.ts` SaveV2Schema, SaveV3Schema, SaveV4Schema updates.** Each currently uses `CharacterSchema` for the characters tuple value (live shape). Change to `CharacterPreV5Schema` at the tuple value position so legacy saves parse with the legacy character shape. Then route each version's `fromSaveVN` through `liftLegacyCharacters(save.characters)` instead of `deserializeRegistry(save.characters)`.

- **`src/persist/schema.ts` append** — new `SaveV5Schema`, `toSaveV5`, `fromSaveV5`. Schema shape:
  ```ts
  export const SaveV5Schema = z.object({
    version: z.literal(5),
    tick: z.number().int().nonnegative(),
    rng: z.array(z.tuple([HouseIdSchema, RngStateSchema])),
    houses: z.array(z.tuple([HouseIdSchema, HouseSchema])),
    characters: z.array(z.tuple([CharacterIdSchema, CharacterSchema])), // LIVE shape, composure required
    marriages: z.array(z.tuple([MarriageIdSchema, MarriageRecordSchema])),
    campaignName: z.string(),
    era: z.enum(["Earlier", "Later"]),
    conversationHistory: z.array(z.tuple([ConversationPairKeySchema, z.array(ExchangeSchema)])),
    affectionMap: z.array(z.tuple([ConversationPairKeySchema, z.number().int().min(0).max(100)])),
  });
  export type SaveV5 = z.infer<typeof SaveV5Schema>;
  export function toSaveV5(state: GameState): SaveV5 {
    return SaveV5Schema.parse({
      version: SAVE_VERSION_CURRENT,
      tick: state.tick,
      rng: serializeRegistry(state.rng),
      houses: serializeRegistry(state.houses),
      characters: serializeRegistry(state.characters),
      marriages: serializeRegistry(state.marriages),
      campaignName: state.campaignName,
      era: state.era,
      conversationHistory: serializeRegistry(state.conversationHistory),
      affectionMap: serializeRegistry(state.affectionMap),
    });
  }
  export function fromSaveV5(save: SaveV5): GameState { /* deserializeRegistry for both new Maps; emit GameState directly */ }
  ```
  `ConversationPairKeySchema` and `ExchangeSchema` are defined in `src/game/conversation/types.ts` (the shared module — see "ConversationPairKey shape and discipline" below) and imported here. **Why the shared module (not `src/llm/types.ts` directly):** the rule layer also needs the pair-key parsing helpers (for the orphan-prune cascade in `aging.ts`), and the eslint boundary rule disallows `game-rules → llm` imports. Lifting the types into `src/game/conversation/types.ts` (a new ESLint element) lets both `game-rules` and `llm` import the shape via the boundary-permitted seam.

- **`src/persist/schema.ts` `fromSaveV4` lifter** — split into a private `fromSaveV4Bare` (pure deserialization, no Independent seeding) + a public `fromSaveV4` (composes Bare + `seedIndependentIntoLegacyState`). The Bare core: routes `save.characters` through `liftLegacyCharacters` (because SaveV4Schema now uses `CharacterPreV5Schema` at the tuple value); adds BOTH `conversationHistory: new Map()` AND `affectionMap: new Map()` to the returned `GameState`. The public wrapper extracts `playerSeed = save.rng.find(([id]) => id === PLAYER_HOUSE_ID)?.[1].seed` and calls `seedIndependentIntoLegacyState(bare, playerSeed)`. Same Bare-and-wrapped split applies to `fromSaveV1` / `fromSaveV2` / `fromSaveV3`. **Why split:** lets the migration `migrate_v4_to_v5` (which itself needs to deserialize V4 + seed + re-serialize) reuse `fromSaveV4Bare` without the helper running twice (idempotence would save us, but the split is cleaner). Full snippet under "Caller list + integration pattern" below.

- **`src/persist/dexie.ts` `SaveRecord.data` type union widening** (currently `dexie.ts:36`): widen from `SaveV1 | SaveV2 | SaveV3 | SaveV4` to `SaveV1 | SaveV2 | SaveV3 | SaveV4 | SaveV5`. Documentation-only per P2/P3 precedent.

- **`src/persist/dexie.ts` `load()` final-parse callsite** (symbol-grep `rg "SaveV4Schema.parse" src/persist/dexie.ts`): both occurrences (`:93` and `:101`) change to `SaveV5Schema.parse`. The runner's per-step Zod validation already validates each intermediate shape via the registered `outputSchema`; `load()`'s post-migration parse is the final assertion that the result matches the live format.

- **`src/persist/dexie.ts` `load()` return-type annotation** (`dexie.ts:71`): change `Promise<SaveV4 | undefined>` to `Promise<SaveV5 | undefined>`. The matching consumer change is at `src/ui/shared/SettingsMenu.tsx`'s Load handler (which currently calls `fromSaveV4(saved)` — bump to `fromSaveV5(saved)`).

- **`src/persist/dexie.ts:19`** (`toSaveV4` import) → add `toSaveV5` import; **`src/persist/dexie.ts:59`** `const data = toSaveV4(state)` → `const data = toSaveV5(state)`. This is the production write callsite.

- **`src/main.tsx` `__buildSaveV4ForTests` DEV helper** (currently at `src/main.tsx:7,18-55`). The helper exposes a Playwright-test-mode builder for valid SaveV4 records on `window.__buildSaveV4ForTests`. P4 cutover decision: **rename to `__buildSaveV5ForTests`, update the import to `toSaveV5`, and extend the overrides parameter with the two new GameState fields (`conversationHistory`, `affectionMap`) defaulted to empty Maps inside the function body**. The helper does NOT need to expose Character composure overrides at P4 — Playwright specs that touch composure can use targeted store actions instead. **Why rename rather than keep V4:** the helper's purpose is to construct valid CURRENT-version records for happy-path specs; using V4 means every spec consumes a record that immediately routes through `runMigrations` on load, exercising the migration path instead of the v5-current-version path. The Playwright spec that uses it (per SESSION-NOTES.md, currently unused as of P3 close-out) can be updated alongside the helper rename. Edit list:
  - `src/main.tsx:7` — `import { toSaveV4 }` → `import { toSaveV5 }`.
  - `src/main.tsx:18-21` — rewrite comment to reference V5.
  - `src/main.tsx:25` — type signature: `__buildSaveV5ForTests`.
  - `src/main.tsx:32` — window assignment: `w.__buildSaveV5ForTests`.
  - `src/main.tsx:54` — `return toSaveV5({ ...state, houses })`. The spread already inherits `conversationHistory` and `affectionMap` from `selectGameState(...)` (P4 extends the selector to emit both), so no inline defaults are needed.
  - Any consumer Playwright spec (grep `__buildSaveV4ForTests` in `tests/` or `e2e/`) — update to `__buildSaveV5ForTests`. **Audit:** `rg '__buildSaveV4ForTests' .` — expect zero hits post-cutover except in the file being renamed.

- **`src/persist/migrations/index.ts`** — register the v4→v5 entry after the existing v3→v4 entry; `assertMonotonic(MIGRATIONS)` catches misordering at module load. New entry shape: `{ from: 4, to: 5, migrate: (s: unknown) => migrate_v4_to_v5(SaveV4Schema.parse(s)), outputSchema: SaveV5Schema }`.

- **Audit during implementation:** `rg 'SaveV4|toSaveV4|fromSaveV4' src/` (symbol-grep) enumerates every callsite the cutover touches; expect zero hits in production code post-cutover and only legacy-version-test hits remain (v1→v4 chain mid-points, the `migrate_v3_to_v4` test, etc.).

- **Test-file edit list** — five test files import legacy V4 symbols and need explicit handling. Cross-references mirror P3's discipline:
  - **`src/persist/save-roundtrip.test.ts`** — currently imports `fromSaveV4` and uses it. Update both the import and the call to `fromSaveV5`. No semantic change.
  - **`src/persist/migrations/v1-to-v4-chain.test.ts`** — code change required. Uses positional `v4.houses[0]!` access at `:34`; change to find-by-id lookup. Also extend assertions to cover the Independent house's presence (`houses.find(...) === INDEPENDENT_HOUSE_ID`) and the 5 NPCs in `characters`.
  - **Add `src/persist/migrations/v1-to-v5-chain.test.ts`** — the full-chain regression test. Two narrow tests beat one wide one (per P3 precedent). **Parity-invariant assertion shape pinned:** mirrors the v1-to-v4 chain test — `expect(hashState(fromSaveV5(runMigrations(saveV1, 1, 5, MIGRATIONS)))).toBe(hashState(createInitialState(seed, DEFAULT_CAMPAIGN_NAME)))` for a fresh-state seed. The chain is the load-bearing proof that v1 saves round-trip into v5 with identical state.
  - **No `v3-to-v4.parity.test.ts` exists at P3** (verified by grep `rg -l "v3-to-v4.parity" src/persist/migrations/` → no hits). No edit needed.
  - **`src/persist/dexie.test.ts`** — semantics shift mirroring P3's B2 fix. The existing "fires when SaveV4 fields are malformed" test (constructs `{ version: 4, tick: "not-a-number", ... }`) needs:
    - **Add new fixture:** `it("fires InvalidSaveSchemaError when SaveV5 fields are malformed", ...)` — uses `version: 5` so the current-version path (SaveV5Schema.parse) still has InvalidSaveSchemaError coverage.
    - **Update existing test:** rename to `it("fires MigrationFailedError when migrating-from-V4 fails on malformed fields", ...)`; assert `MigrationFailedError`; keep the `version: 4` malformed fixture. Documents that "legacy-version + malformed" is now a migration-failure path.
    - **Add SaveV5-specific affection-corruption fixture:** `it("fires InvalidSaveSchemaError when SaveV5 affectionMap value is out of range", ...)` — constructs a SaveV5 with one `affectionMap` tuple value of `150` (or `-5`). Asserts the load throws `InvalidSaveSchemaError` (NOT `MigrationFailedError` — the current-version path). Covers the per-mutation-site-clamp invariant from the consumer side: if anyone ever bypasses the clamp at write time (e.g., a future phase mutates `state.affectionMap` directly without going through the store action), the load-time Zod validation catches it on next session.
    - **Add SaveV5-specific conversation-history-corruption fixture:** `it("fires InvalidSaveSchemaError when SaveV5 conversationHistory has malformed pair key", ...)` — constructs a SaveV5 with a `conversationHistory` tuple where the key string violates the `[^|]+\|[^|]+` regex (e.g., `"playerno-pipe-here"` or `"a|b|c"`). Asserts `InvalidSaveSchemaError`.

---

## ConversationPairKey shape and discipline

**Canonical home: `src/game/conversation/types.ts`** (a NEW shared module). Both the rule layer (`aging.ts` orphan-prune) and the LLM layer (`llm/client.ts`, `llm/routing.ts`, the orchestrator) import from this module. The `src/llm/types.ts` module re-exports the names so `llm/**` consumers have a single import surface — but the source of truth is the conversation/types module.

**`type ConversationPairKey = `${HouseId}|${CharacterId}`` — branded stringified composite.** The shape is a template-literal type that the TypeScript compiler can narrow; the runtime form is a plain string. Brand via cast: `\`${houseId}|${characterId}\` as ConversationPairKey`. Mirrors P0's `serializeRegistry` discipline (string-keyed Maps serialize to `Array<[string, V]>` tuples cleanly).

```ts
// src/game/conversation/types.ts  ← canonical home
import { z } from "zod";
import { CharacterIdSchema, HouseIdSchema, type CharacterId, type HouseId } from "../rng";

export type ConversationPairKey = `${HouseId}|${CharacterId}` & { __brand: "ConversationPairKey" };

export const ConversationPairKeySchema = z
  .string()
  .regex(/^[^|]+\|[^|]+$/, "ConversationPairKey must be 'houseId|characterId'")
  .transform((s) => s as ConversationPairKey);

export function makePairKey(houseId: HouseId, characterId: CharacterId): ConversationPairKey {
  // Defense-in-depth: assert neither half contains the separator. HouseId
  // and CharacterId are branded strings (`.transform`, not constrained),
  // so a future fixture rename or migration could in principle introduce
  // a `|`. The brand cast below would still succeed for malformed inputs;
  // the regex check ensures the key round-trips correctly through
  // ConversationPairKeySchema parse-then-deserialize.
  if (houseId.includes("|") || characterId.includes("|")) {
    throw new Error(`makePairKey: id contains "|" separator (houseId=${houseId}, characterId=${characterId})`);
  }
  return `${houseId}|${characterId}` as ConversationPairKey;
}

export function parsePairKey(key: ConversationPairKey): { houseId: HouseId; characterId: CharacterId } {
  // The schema regex guarantees exactly one '|' separator with non-empty halves;
  // the runtime split is therefore safe without further validation.
  const [h, c] = key.split("|") as [HouseId, CharacterId];
  return { houseId: h, characterId: c };
}

// Exchange + Speaker also live here (consumed by both the rules layer and
// the LLM layer).
export type Speaker = "house-head" | "other";
export const ExchangeSchema = z.object({
  speaker: z.enum(["house-head", "other"]),  // §4 line 552 wording — heir-promotion stable
  text: z.string(),
  classifiedTactic: z
    .enum(["Flattery", "WittyBanter", "SlyGossip", "DeepEmpathy"])
    .nullable(),  // null for player-side exchanges
  tick: z.number().int().nonnegative(),
});
export type Exchange = z.infer<typeof ExchangeSchema>;

// ConversationFailure — the five-variant discriminated union shared by the
// orchestrator return type, the event-bus payload, the store-action result,
// and the UI banner prose mapping. Lives here so game-store can import it
// without crossing into the runtime/events layer.
export type ConversationFailure =
  | { reason: "timeout" }
  | { reason: "network" }
  | { reason: "schema"; issues: ReadonlyArray<{ path: string; message: string }> }
  | { reason: "missing-key" }
  | { reason: "cancelled" };

// Re-export the brand types so llm/** consumers can reach them via this
// module (the llm layer is forbidden from importing game/rng directly per
// eslint rule b/c). CharacterId and HouseId are needed by ConversationRequest,
// PersonaCacheRegistry's cache-key composition, and the orchestrator's
// public types. The shared module is the canonical re-export site.
export type { CharacterId, HouseId } from "../rng";
```

**`src/llm/types.ts` re-exports**:
```ts
// Re-export to give the LLM layer a single import surface. The runtime/
// orchestrator + UI layers may import from either location; rule-layer
// files MUST import from src/game/conversation/types (the boundary config
// disallows game-rules → llm). Brand types (CharacterId, HouseId) also
// re-export so llm/** consumers reach them WITHOUT importing game/rng
// directly (which the llm boundary rule disallows).
export {
  ConversationPairKeySchema,
  type ConversationPairKey,
  type Speaker,
  ExchangeSchema,
  type Exchange,
  makePairKey,
  parsePairKey,
  type CharacterId,
  type HouseId,
} from "../game/conversation/types";
```

**Lex-sort discipline note.** `serializeRegistry` lex-sorts by branded-string key. Pair keys sort by the full composite string (including the `|` separator at byte 0x7C), NOT outer-by-house-then-inner-by-character. This is deterministic and stable; when a hash drift surfaces in debugging, the comparison is over the FULL key string, not over component fields. Document inline at the `makePairKey` declaration.

---

## Canonical types table

Every new type introduced by P4 with its canonical home pinned:

| Type | Home | Notes |
|---|---|---|
| `Tactic` | `src/game/constants.ts` | `(typeof TACTICS)[number]`; `TacticSchema = z.enum(TACTICS)`. |
| `Stance` | `src/game/constants.ts` | `(typeof STANCES)[number]`; `StanceSchema = z.enum(STANCES)`. |
| `Mood` | `src/game/fixtures/moods.ts` | Already exists at P1. |
| `ConversationPairKey` | `src/game/conversation/types.ts` | Branded stringified composite — see §"ConversationPairKey shape and discipline". |
| `Exchange` / `Speaker` | `src/game/conversation/types.ts` | Persisted in `state.conversationHistory`; serialized via the standard tuple form. |
| `Model` | `src/llm/types.ts` | `typeof MODEL_DEFAULT \| typeof MODEL_FIRST_MEETING`. |
| `ConversationRequest` | `src/llm/types.ts` | Built by `sendBallroomMessage`; consumed by `LlmClient.respond`. |
| `ConversationResponse` | `src/llm/types.ts` | The narrowed shape that flows into `resolveCombat`. |
| `ConversationResponseRaw` | `src/llm/types.ts` | The Zod-parsed shape (widened enums); narrowed via `resolveTactic` + `resolveMoodHint`. |
| `ConversationOutcome` | `src/runtime/conversationOrchestrator.ts` | `\| { kind: "Resolved"; response: ConversationResponse } \| { kind: "Failed"; failure: ConversationFailure }`. Returned by `orchestrator.send(...)`. **The orchestrator does NOT call `resolveCombat`** — combat resolution is the store action's responsibility (the store action holds the Immer draft scope where the combat-derived deltas are applied). The orchestrator's job ends at the validated `ConversationResponse`. |
| `ConversationFailure` | `src/game/conversation/types.ts` | Discriminated union with `reason: "timeout" \| "network" \| "schema" \| "missing-key" \| "cancelled"`. **Five reasons.** Lives in the shared conversation/types module (NOT in `runtime/events/conversation.ts`) so the orchestrator and the store action can both import it without crossing layer boundaries. The event-bus module re-imports the type from here. **Why shared (not runtime-local):** the `sendBallroomMessage` store action's return type references this — and `game/store.ts` cannot import from `runtime/events/*` cleanly under the boundary config. The shared types module is the canonical home. |
| `ConversationEvent` | `src/runtime/events/conversation.ts` | The bus event union (see §"`src/runtime/events/conversation.ts`"). |
| `BallSessionId` | `src/game/rng.ts` | Branded string, parallel to `HouseId` / `CharacterId`. **Tick-derived, ZERO RNG draws:** constructed via `makeBallSessionId(tick: number): BallSessionId` returning `\`ball-${tick}\` as BallSessionId`. The session ID is a debug/log key, not a security identifier — uniqueness across a save's lifetime is sufficient (every ball-entry is at a different tick, since the within-tick session must close before the next tick can advance). **Why tick-derived (not RNG-drawn):** keeps the bootstrap RNG budget at exactly 6 draws (1 player + 5 NPCs); zero RNG consumption keeps the replay-harness contract simple. |
| `BallEntryRejection` | `src/runtime/events/conversation.ts` | Discriminated union — at P4 the only variant is `{ kind: "WrongLocation"; current: LocationId }`. P8 adds `{ kind: "PatronessVeto"; patronessId: PatronessId }`. |
| `CombatInput` / `CombatOutcome` | `src/game/rules/combat.ts` | Per the combat-resolver section. |
| `BallroomMessageInput` | `src/game/store.ts` (with the new actions) | `{ targetCharacterId: CharacterId; pinnedTactic: Tactic \| null; stance: Stance; freeformMessage: string }`. |
| `resolveTactic` / `resolveMoodHint` / `narrowResponse` | `src/llm/types.ts` | Pure resolvers that narrow the Zod-parsed `ConversationResponseRaw` (widened enums) to the `ConversationResponse` shape. `resolveTactic(received: string, pinned: Tactic \| null): Tactic`. `resolveMoodHint(received: string \| undefined): Mood \| null`. `narrowResponse(raw: ConversationResponseRaw, pinned: Tactic \| null): ConversationResponse` composes both + clamps `qualityMultiplier` to `[QUALITY_MULTIPLIER_FLOOR, QUALITY_MULTIPLIER_CEIL]`. |

**Why this table belongs in the plan** (not lifted to a separate spec doc): every type listed is a P4 contribution; the homes are pinned so the implementer doesn't relitigate them. P5+ adds its own canonical types table per phase precedent.

---

**Why stringified composite (not nested `Map<HouseId, Map<CharacterId, Exchange[]>>`):**
- (a) `serializeRegistry` already handles `Map<BrandedString, V>` correctly; nested Maps need a custom serializer.
- (b) The hash projection's `Array<[K, V]>` tuple shape works without modification.
- (c) Orphan-prune at a character death is a single-pass `Array.from(history).filter(([key]) => parsePairKey(key).characterId !== deadId)` — nested-map equivalent would require a two-pass walk.
- (d) Pair-key lex-sort discipline (CLAUDE.md "lex-sort iteration over identifier Maps") works directly on the string form — no per-level sort needed.

**Why branded (not bare string):**
- The schema-projection-selector triple-sync test enforces type alignment between schema and projection; a bare string here would weaken the call-site contract. Brand surfaces use of `houseId + "|" + characterId` ad-hoc as a type error.

**Eviction discipline:** append-time, not read-time. After a successful conversation response, the orchestrator pushes the new exchange to the array and truncates to the 3 most-recent with `array.slice(-3)`. Save format always carries ≤3 entries per pair — the 50-KB-per-subsystem NFR (spec §8) holds for ~30 NPCs × 3 exchanges × ~500 bytes per exchange ≈ 45 KB worst case.

---

## Conversation history + affectionMap orphan-prune (§7 edge case)

**Where the prune happens.** Inside `src/game/rules/aging.ts`'s `applyAgingStep`. Spec §7 line 647 says "On character death, all conversation-history entries keyed on the dead character (as the target) must be pruned." `applyAgingStep` currently only ages and marks `alive: false` (verified at `src/game/rules/aging.ts:10-27`); the marriage-dissolution-on-head-death lives separately in `src/game/rules/succession.ts:45-58`'s `processDeadHead`. The orphan-prune is a **fresh extension** to `applyAgingStep` — it fires on EVERY character death (regardless of role), which matches the spec's "as the target" wording: the prune is target-side, fired whenever an NPC dies.

The "as the target" wording in spec §7 is satisfied by filtering on `parsePairKey(key).characterId` — which IS the TARGET half of the pair-key by construction (the player house is on the other half).

**Edit list:**
- **`src/game/rules/aging.ts` `applyAgingStep` extension.** After marking a character `alive: false` for the tick, walk BOTH `state.conversationHistory` and `state.affectionMap` and build new Maps containing only entries where `parsePairKey(key).characterId !== dead.id`. **Pure rule discipline:** return new `Map`s; never mutate inputs. **Determinism contract:** the prune consumes ZERO RNG draws (pure filter), so the existing `aging.test.ts:44` "no PRNG draws consumed (callCount unchanged)" invariant is preserved — the prune passes that test unchanged.
- **Heir-promotion safety:** the prune filters by `parsePairKey(key).characterId` (the target NPC's character ID), NOT by `houseId`. The pair-key's `houseId` half is the PLAYER's house (which persists across heir succession via the head-of-house transition); the `characterId` half is the TARGET NPC's character ID (which never changes on player-side succession). So when the PLAYER head dies, the cascade does NOT touch conversation history or affection — the heir inherits both. The cascade ONLY prunes when a TARGET NPC dies, which is the intended semantic.
- **Year-pass-bound timing.** `applyAgingStep` is invoked from `src/runtime/yearPass.ts`'s `runYearPassPure` composer, NOT from the per-tick `advanceTickPure`. So orphan-prune fires ONLY at year-pass, not on every tick. **At P4 this is fine** — there is no within-tick NPC-death mechanism. Future phases that introduce within-tick deaths (P8 rival assassination scheme completion, P9 elopement composure-zero death) MUST add their own prune trigger or convert the within-tick death into a year-pass-deferred death-flag pattern. Document this constraint inline at the rule.
- **Year-pass step order context:** `runYearPassPure` runs `applyAgingStep` BEFORE `processDeadHead` (succession). The orphan-prune fires in the aging step; the player-head's marriage-dissolution (if any) fires in the succession step. The two steps are independent — the orphan-prune semantic doesn't depend on whether marriage dissolution has fired yet.
- **Why in `aging.ts` (not the conversation layer):** the cascade fires from the rules layer on year-pass; conversation/affection state is GameState data, so the rules layer owns its lifecycle. The conversation layer never touches state directly — it returns deltas the orchestrator applies.
- **Boundary impact:** `aging.ts` is in `game-rules`; the rule needs to import `parsePairKey` from the shared module. The canonical location at `src/game/conversation/types.ts` (per "ConversationPairKey shape and discipline" above) is a new ESLint folder element; the `game-rules` allow list extends to include it. See "ESLint boundary edits" below for the eslint.config.js edits.

**Tests for the prune** ship at `src/game/rules/aging.test.ts`'s death-cascade suite:
- Fixture A: state with conversation entries AND affection entries keyed on an NPC who is about to die at year-pass. Post-cascade: both collections have no entries with that character ID.
- Fixture B: state where the PLAYER head is about to die (succession scenario). Post-cascade: conversation history and affection are UNCHANGED (the heir inherits both).
- Fixture C: NPC death with entries pointing at a different NPC: those entries are untouched (negative control).
- Fixture D: tick advance with conversation history present + NPC's `diedAtTick` equal to current tick (hypothetical within-tick death set externally for testing) — the prune does NOT fire on tick advance. Document the year-pass-only timing.
- **Preserved invariant:** the existing `aging.test.ts:44` "no PRNG draws consumed" test must continue to pass — the orphan-prune is a deterministic filter.

---

## Composure: per-character persisted + per-session player

**Spec §4 line 540** says Character carries "current and max composure." Spec §3 line 300 says faux-pas fires when "the player's composure crosses to zero or below." Reading the spec together: **the player's head-of-house has a persisted composure on `Character` like any other character; the conversation orchestrator initializes the per-session player composure from `state.characters.get(playerHeadId).composure` on ball entry and writes back the final value at ball exit.**

- **Within a ballroom session:** the player composure is mutated in session memory (a React `useState` in `BallroomView.tsx`). Each conversation round-trip resolves a composure delta, applies it to the session composure, and checks the faux-pas predicate.
- **At ball exit (player navigates away from the ballroom):** the session composure is committed back to `state.characters.get(playerHeadId).composure` via the `exitBallroom(playerComposureAtExit)` store action — NOT a separate `commitBallSession` action. (The earlier draft referenced a `commitBallSession` helper; that ghost is removed. The commit happens inline inside `exitBallroom`'s body.) This is the only path that persists ballroom session player-composure deltas across ticks.
- **Faux-pas predicate** fires when the post-resolution SESSION player composure is `<= 0`. The target's mood lock applies immediately to `state.characters.get(targetId).moodLockUntilTick` regardless of whether the session has committed (per spec §3 line 300, the mood shift is reactive and immediate).

**Why session-local for the player, persisted for the target:** the player walks INTO the ball with whatever composure they have; the session is a bounded venue where the player can recover or burn through composure across several exchanges. Persisting every intra-session decrement would force a store mutation per exchange — overkill for a value that's session-stable. The target's composure, by contrast, can be sabotaged later by P5 schemes; it's a persisted attribute. This split mirrors the spec's wording carefully: "player's composure" is the session value; "target's composure" is the persisted attribute.

**Faux-pas mood lock invariant:** when faux-pas fires on a target who is already `Defensive` with `moodLockUntilTick > state.tick`, extend the lock to `state.tick + FAUX_PAS_LOCK_DURATION_IN_TICKS` without firing a mood-change event (§7 "Mood-lock cascade prevention"). The pure rule in `combat.ts` returns a discriminated outcome that carries the lock duration; the orchestrator applies it via a store-action mutation; the mood-lock-cascade-prevention test asserts the second faux-pas does NOT publish a `MoodChanged` event when the lock was already active.

---

## NPC pool: `INDEPENDENT_HOUSE_ID` + 5 baseline society NPCs

**Decision:** P4 introduces a singleton "London Society" house and 5 baseline NPCs at campaign start. **One of the 5 NPCs (Lord Blackwood, the most senior name) serves as `INDEPENDENT_HOUSE_ID`'s `headOfHouseCharacterId`** — no sentinel character, no schema widening. The house has a real head-of-house who happens to also be one of the ballroom-ring NPCs. P8 later introduces rival-house NPCs; baseline society NPCs either stay as neutrals or migrate into rival houses (P8 owns that migration; if the head-of-house NPC migrates, P8 also reassigns Independent's head).

**`src/game/rng.ts`** — add `INDEPENDENT_HOUSE_ID`:
```ts
export const INDEPENDENT_HOUSE_ID = "independent" as HouseId;
```
Alongside the existing `PLAYER_HOUSE_ID`. Both are branded `HouseId` constants exported from `rng.ts` (the file the `game-rules` allow list permits) so any rule can reference them.

**Independent's RNG state.** The Independent house DOES receive its own `RngState` entry in `state.rng` at P4 — **required because `applyMoodDriftPhase` (at `src/game/rules/moods.ts:64`) iterates every house in `state.houses` and calls `getOrThrow(state.rng, houseId)`** which throws `RngNotRegisteredError` on missing keys. Without an Independent RNG entry, the first `advanceTick` post-P4 crashes.

**Independent's seed is deterministically derived from the player seed** so no second user-supplied seed is needed and the save format remains additive: `createRngState(\`${playerSeed}|independent\`)`. This keeps the bootstrap RNG contract: same player seed → same Independent seed → same Independent mood-drift draws across the 30-run replay harness.

**Bootstrap order pinned:** player RNG state is constructed FIRST (existing P3 behavior — `createRngState(seed)` then `seedStartingFamily(playerRng)`). The Independent RNG state is constructed SECOND. **NPC deathAges are PRE-ASSIGNED CONSTANTS in the `BASELINE_NPCS` fixture (NOT random draws).** This is a deliberate departure from the player-head pattern (which DOES roll deathAge via `LIFESPAN_RANGE`). **Why constants for NPCs:** keeps the bootstrap draw budget identical to P3 (one draw — player head only), eliminates the bootstrap-vs-migration parity headache, and ensures Independent NPCs have predictable lifespans across all campaigns (designer-tunable in the fixture; later phases can re-introduce random lifespans for rivals if the design wants it). Independent's RNG is consumed first at the next tick's mood-drift roll, NOT at bootstrap.

**Two-house RNG initialization happens in THREE places, all symmetric:**
- **`createInitialState`** (fresh-state path) — adds both player and Independent RNG entries to `state.rng`.
- **`migrate_v4_to_v5`** (legacy save upgrade path) — seeds Independent house + 5 NPCs + Independent RNG. **Zero draws** (deathAges are constants). Idempotent.
- **`fromSaveV1` / `fromSaveV2` / `fromSaveV3` / `fromSaveV4`** (direct-lift legacy paths) — also seed Independent. Used by tests that bypass the migration runner; production saves at P4 always route through the migration runner, so the lifters' Independent-seeding is redundant-but-safe (idempotent).

**Why three seeding sites (not one):** `createInitialState` is the fresh-state constructor; the migration is the on-disk transformation; the lifters are the parse-then-construct boundary. Tests and future hot-load paths may bypass any of these. Mirroring the discipline keeps every entry point producing the same GameState shape.

**`src/game/bootstrap.ts`** — extend `seedStartingFamily`. **Return shape changes from `{ rngState, house, character }` (singular) to `{ rngState, houses: ReadonlyArray<House>, characters: ReadonlyArray<Character> }` (plural).** The arrays are in deterministic order: `houses[0]` is always the player house; `houses[1]` is always the Independent house. `characters[0]` is always the player head; `characters[1..5]` are the 5 NPCs in lex-sort order (`npc-aldridge`, `npc-blackwood`, `npc-carrington`, `npc-dunmore`, `npc-ellsworth`).

**Consumer fanout — explicit pins:**
- **`src/persist/migrations/v1-to-v2.ts:28-36`** must update for the `seedStartingFamily` plural-array signature change, AND **MUST filter to PLAYER-ONLY** — V2 saves predate Independent, so the migration emits only the player house/character. Independent enters at `migrate_v4_to_v5`, NOT at v1-to-v2.
  ```ts
  // The new signature returns { rngState, houses, characters } with
  // houses[0] === player, houses[1] === Independent (per the deterministic
  // ordering from seedStartingFamily). Filter to player-only for V2 emission:
  const seeded = seedStartingFamily(legacyRngState);
  const playerHouse = seeded.houses.find((h) => h.id === PLAYER_HOUSE_ID);
  const playerChar = seeded.characters.find((c) => c.houseId === PLAYER_HOUSE_ID);
  // (Both must exist by construction — seedStartingFamily contract.)
  return {
    version: 2,
    tick: save.tick,
    rng: [[PLAYER_HOUSE_ID, seeded.rngState]],  // player RNG only
    houses: [[playerHouse!.id, stripHouseV4Fields(playerHouse!)]],
    characters: [[playerChar!.id, stripCharacterV5Fields(playerChar!)]],
    marriages: [],
  };
  ```
  For `characters`, **the migration emits SaveV2 tuples whose value shape is `CharacterPreV5Schema` (without `composure` / `maxComposure`)** — so the character emission strips the two new P4 fields via a `stripCharacterV5Fields` helper (private to `v1-to-v2.ts`, or shared with `toSaveV2` in `schema.ts`):
  ```ts
  function stripCharacterV5Fields(c: Character): CharacterPreV5 {
    const { composure: _co, maxComposure: _mc, ...legacy } = c;
    return legacy;
  }
  function stripHouseV4Fields(h: House): HousePreV4 {
    // Strip the 5 P3 House fields when emitting legacy V2 format. Same shape
    // as the existing toSaveV2's strip pattern at src/persist/schema.ts.
    const {
      currentLocation: _cl,
      consecutiveTicksAtCurrentLocation: _ct,
      lastAudienceTick: _la,
      wardrobeLastRefreshTick: _wr,
      blockadeBypassEarned: _bb,
      ...legacy
    } = h;
    return legacy;
  }
  ```
  Mirrors P3's `toSaveV2` / `toSaveV3` discipline (strip the 5 P3 House fields when emitting legacy formats). The migration's draw-budget pin comment block at the top of the file **stays at "1 deathAge total"** — NPC deathAges are constants from the fixture; bootstrap-via-this-migration consumes only the player-head draw, same as P3.
- **`src/game/store.ts:54` `createInitialState`** must update its Map-construction loop to iterate `seeded.houses` and `seeded.characters` arrays:
  ```ts
  const houses = new Map<HouseId, House>();
  for (const h of seeded.houses) houses.set(h.id, h);
  const characters = new Map<CharacterId, Character>();
  for (const c of seeded.characters) characters.set(c.id, c);
  ```

**Body extension to `seedStartingFamily`:**
1. The Independent house. `wealth: 0`, `reputation: 50`, `scandal: 0`, `headOfHouseCharacterId: "npc-blackwood"` (the canonical head NPC), `generation: 0`, `ancestorSummary: []`, `heirless: false` (Blackwood is a valid head), plus all five P3 House fields with their canonical defaults (`currentLocation: "Capital"`, `consecutiveTicksAtCurrentLocation: 0`, `lastAudienceTick: null`, `wardrobeLastRefreshTick: null`, `blockadeBypassEarned: false`). All literals, no RNG draws.
2. Five baseline NPCs assigned to `INDEPENDENT_HOUSE_ID`, with pre-assigned trait pairs AND pre-assigned deathAges (no random draws — all constants from the `BASELINE_NPCS` fixture). All NPC construction via `buildBaselineNpcCharacter(npcSeed)` so fresh-state and migration paths produce byte-identical NPCs.

**Draw order — explicitly pinned:** the PLAYER head's deathAge is drawn FIRST (callCount 0 → 1) — this is the ONLY bootstrap draw at P4. NPC deathAges are constants from the fixture; no draws. This preserves the P3 player-deathAge value for any given seed bit-for-bit — i.e., `state.characters.get("player-head").deathAge` is unchanged across the P3→P4 schema bump (parity invariant; the test asserts this).

**RNG draw budget at bootstrap.** **UNCHANGED from P3: 1 draw (player head's deathAge ONLY).** NPC deathAges are constants from the `BASELINE_NPCS` fixture — ZERO RNG draws for NPC construction. The Independent house also gets an `RngState` entry in `state.rng` (deterministically derived from the player seed, see above), but its first draw fires at the FIRST post-bootstrap tick's mood-drift, NOT at bootstrap. So `state.rng.get(PLAYER_HOUSE_ID).callCount === 1` and `state.rng.get(INDEPENDENT_HOUSE_ID).callCount === 0` immediately after `createInitialState`.

**Test fixtures — explicit enumeration:**
- `src/game/bootstrap.test.ts` — **player-RNG callCount assertion stays at 1** (unchanged from P3 — NPCs are constants, no draws). Add a separate assertion: `state.rng.get(INDEPENDENT_HOUSE_ID).callCount === 0` post-bootstrap. **Pre-and-post-P4 player-head-deathAge parity holds bit-for-bit** for a fixed seed — assert against the P3 value.
- `src/game/replay-harness.test.ts` — assertions derived from `hashState(createInitialState(...))` (not hardcoded); rerun and accept the new hashes (the addition of Independent + NPCs to GameState changes the hash). Verify by inspection.
- `src/persist/save-roundtrip.test.ts` — bumps the post-roundtrip hash if hardcoded; recomputes if derived.
- `src/persist/migrations/v1-to-v3-chain.test.ts` — **no positional `houses[0]` access** (verified at `:1-47`); only asserts `v3.campaignName` and `hashState(lifted) === hashState(createInitialState(seed, DEFAULT_CAMPAIGN_NAME))` parity. **The parity assertion at line :42-43 BREAKS** post-P4: `createInitialState` now produces a 2-house state (player + Independent); `fromSaveV3(v3)` produces a 1-house state (the v3 schema and its lifter know nothing of Independent). **Fix:** drop the hashState-parity assertion; assert only `v3.campaignName === DEFAULT_CAMPAIGN_NAME` + that the chain runs without throwing. Full structural parity moves to the new `v1-to-v5-chain.test.ts`.
- `src/persist/migrations/v1-to-v4-chain.test.ts` — **DOES use `v4.houses[0]!`** (verified at `:34`). Change to find-by-id lookup: `v4.houses.find(([id]) => id === PLAYER_HOUSE_ID)`. **Also drop the hashState-parity assertion** (same reason as v1-to-v3-chain — fresh state at P4 has 2 houses; chain-output at v4 has 1). Assert only that the chain runs without throwing + that v4-shape is schema-valid.
- `src/persist/migrations/v1-to-v5-chain.test.ts` — NEW. THIS is where parity lives: `hashState(fromSaveV5(runMigrations(saveV1, 1, 5, MIGRATIONS))) === hashState(createInitialState(seed, DEFAULT_CAMPAIGN_NAME))`. Both sides produce 2-house states; parity holds bit-for-bit.
- Audit grep at implementation time: `rg -n 'createInitialState|hashState\(' src/ --type=ts` — every callsite that builds an initial state and asserts on a derived value must be confirmed compatible. The list above is the AUTHORITATIVE pre-implementation list; the grep is a cross-check.

**`migrate_v1_to_v2`, `migrate_v2_to_v3`, `migrate_v3_to_v4` stay unchanged** with respect to Independent. They emit only what their target schema requires; Independent is added at v4-to-v5 (and at fresh-state via createInitialState) — NOT at earlier migration steps. Intermediate v2/v3/v4 shapes carry the player house only. This is the deliberate choice that keeps existing migrations untouched.

**Why all NPCs at tick 0 (not lazy-seed-on-first-ball-entry):** lazy seeding violates the "absolute end-tick" / "no relative scheduling" discipline AND introduces a non-deterministic surface (ball entry timing depends on player choice). All NPCs exist from tick 0 forward.

**Five baseline NPC names + traits + deathAges** — pinned in a new `src/game/fixtures/npcs.ts` registry. **All fields are pre-assigned constants — ZERO RNG draws involved in NPC construction**, which is the property that keeps fresh-state and migration paths in lockstep.

```ts
export type BaselineNpcSeed = {
  id: CharacterId;            // pre-assigned, stable across all campaigns
  name: string;
  role: Role;                 // "Dependent" — see role pinning below
  traitPicks: readonly TraitId[]; // 2 traits, pre-assigned (no RNG draws)
  startingMood: Mood;         // default "Receptive"
  deathAge: number;           // designer-pinned lifespan in [70, 95]; matches LIFESPAN_RANGE
};
export const BASELINE_NPC_HEAD_ID = "npc-blackwood" as CharacterId;  // Independent's head-of-house
export const BASELINE_NPCS: ReadonlyArray<BaselineNpcSeed> = [
  { id: "npc-aldridge" as CharacterId,   name: "Lady Aldridge",   role: "Dependent",   traitPicks: ["Witty",     "Sophisticated"] as TraitId[], startingMood: "Receptive", deathAge: 88 },
  { id: BASELINE_NPC_HEAD_ID,            name: "Lord Blackwood",  role: "HeadOfHouse", traitPicks: ["Cunning",   "Reserved"]      as TraitId[], startingMood: "Receptive", deathAge: 76 },
  { id: "npc-carrington" as CharacterId, name: "Miss Carrington", role: "Dependent",   traitPicks: ["Romantic",  "Frivolous"]     as TraitId[], startingMood: "Receptive", deathAge: 92 },
  { id: "npc-dunmore" as CharacterId,    name: "Mr. Dunmore",     role: "Dependent",   traitPicks: ["Empathetic","Generous"]      as TraitId[], startingMood: "Receptive", deathAge: 81 },
  { id: "npc-ellsworth" as CharacterId,  name: "Lady Ellsworth",  role: "Dependent",   traitPicks: ["Bold",      "Brash"]         as TraitId[], startingMood: "Receptive", deathAge: 73 },
];
```

**Blackwood is `role: "HeadOfHouse"`** (NOT `"Dependent"`) because he is `INDEPENDENT_HOUSE_ID`'s `headOfHouseCharacterId`. The existing `seedStartingFamily` precedent (`bootstrap.ts:40`) sets the seed head's role to `"HeadOfHouse"` upfront — the head's role must already be `"HeadOfHouse"` at seed time, NOT promoted by succession. (Succession at `succession.ts:99-111` sets `role: "HeadOfHouse"` only on heir promotion; it does not check pre-promotion role.) On Blackwood's eventual death, succession promotes one of the four other NPCs to "HeadOfHouse" via the existing rule. **The other four NPCs stay as `"Dependent"` until they become heir-and-promoted.**

**Per-NPC bootstrap construction** lives as a SHARED builder function in `src/game/fixtures/npcs.ts`, used by BOTH `seedStartingFamily` (fresh-state path) AND `seedIndependentIntoLegacyState` (migration/lifter path) so there's a single source of truth:
```ts
// src/game/fixtures/npcs.ts — alongside BASELINE_NPCS

export function buildBaselineNpcCharacter(seed: BaselineNpcSeed): Character {
  return {
    id: seed.id,
    houseId: INDEPENDENT_HOUSE_ID,
    name: seed.name,
    birthTick: 0,                      // same generation as player; no aging skew at start
    age: 25,                           // mirrors player head age
    deathAge: seed.deathAge,           // CONSTANT from fixture — no RNG draw
    alive: true,
    diedAtTick: null,
    mood: seed.startingMood,           // "Receptive" at P4
    moodLockUntilTick: 0,
    role: seed.role,                   // "Dependent" or "HeadOfHouse" (Blackwood)
    archetype: "None",
    traits: [...seed.traitPicks],      // copy from fixture, not reference
    marriageId: null,
    composure: 100,                    // P4 addition
    maxComposure: 100,                 // P4 addition
  };
}

export function buildIndependentHouse(): House {
  return {
    id: INDEPENDENT_HOUSE_ID,
    wealth: 0,
    reputation: 50,
    scandal: 0,
    headOfHouseCharacterId: BASELINE_NPC_HEAD_ID,
    generation: 0,
    ancestorSummary: [],
    heirless: false,
    currentLocation: "Capital",
    consecutiveTicksAtCurrentLocation: 0,
    lastAudienceTick: null,
    wardrobeLastRefreshTick: null,
    blockadeBypassEarned: false,
  };
}
```
Both `seedStartingFamily` and `seedIndependentIntoLegacyState` call these builders — no constants duplication between bootstrap.ts and schema.ts. The byte-identity test in `v4-to-v5.test.ts` confirms the wiring works correctly across both paths.

**Why NPCs share `birthTick: 0` + `age: 25` with the player head:** matches the "campaign-start head" precedent in `seedStartingFamily`. NPCs aging in lockstep with the player keeps the cast stable across the first 5-10 years of play, then natural aging produces mortality as the campaign matures. **NPC deathAges are constants from the fixture** so fresh-state and migration paths produce byte-identical NPCs; a future phase that wants randomized NPC lifespans must either bump the save format or accept different fresh-vs-migrated semantics.

**Role pinning:** baseline NPCs use the existing `"Dependent"` role from `roles.ts`. Adding a new role variant (e.g., `"SocietyMember"`) would force a save-format bump for an enum widening (CharacterSchema's `role: RoleSchema` is enum-typed); deferring it keeps the P4 schema delta minimal. P8 can introduce richer NPC roles if rival NPCs need them.

**Why pre-assigned trait pairs (not random rolls):** the spec's "deterministically picked" wording applies to picking which NPCs appear at a given ball; the underlying NPC POOL is design-curated. Random trait rolls would mean every campaign sees different NPC archetypes, which weakens campaign comparability and tutorial intuition. Pin the trait pairs; let location-bound trait acquisition (P3 Rustic / finishing-school) provide the player-side trait variance.

**At-the-ball selection** — at P4 there are exactly 5 baseline NPCs, so all 5 always appear at the ring. When P8 ships rival-house NPCs (and the spec's "up to 5 NPCs in a ring" becomes meaningful), the selection logic from a larger pool will live in a separate `src/game/rules/ballSelection.ts` — but at P4 the selection is trivial (return all 5 living NPCs assigned to Independent + any later phase's additions).

**Independent house participates in per-house rules.** Every existing per-house pure rule (`applyEconomyPhase`, `applyMoodDriftPhase`, `applyLocationEffectsPhase`, `applyAgingStep`, etc.) iterates `state.houses`. After P4, ALL of them iterate over the Independent house too:
- **Economy** (`economy.ts`): Independent's wealth starts at 0 (Solvent tier), so the Solvent tier's per-tick delta applies (currently `0, 0, 0`). At P4 there is no NET drift because Solvent emits zero deltas. Future tuning that puts positive deltas on Solvent will affect Independent — designer-tracked, not a bug. **Pin: Independent's wealth/reputation/scandal are NOT player-visible at P4** (the ledger view ships at P14); accept the drift.
- **Location effects** (`locationEffects.ts`): scopes to PLAYER_HOUSE_ID only (P3 — `iterates only state.houses.get(PLAYER_HOUSE_ID)`). Independent is naturally excluded; no edit needed.
- **Mood drift** (`moods.ts`): iterates every house's characters. Independent's RNG entry (added at bootstrap per the new pinning above) handles this correctly; the 5 NPCs roll mood drift every tick via the Independent RNG.
- **Aging** (`aging.ts`): iterates every character regardless of house. The 5 NPCs age via their `birthTick: 0` start; their `deathAge` rolls determine when they die. Succession on Blackwood's death uses the existing rule on Independent.
- **Future-phase rules** that need to exclude Independent will gate by `houseId === PLAYER_HOUSE_ID` per the locationEffects precedent. Document inline at the rule when needed.

---

## Constants + tuning maps (`src/game/constants.ts`)

Every numeric tuning and every static map lives in `constants.ts` per CLAUDE.md §10. New entries appended to the P3 set:

**Combat math constants:**
- **`COMBAT_BASE_AFFECTION = 10`** (spec §3 line 296: "Base = 10").
- **`COMBAT_BONUS_VALUE = 15`** (spec §3 line 296: "BonusValue = +15").
- **`COMBAT_PENALTY_VALUE = -10`** (spec §3 line 297: "PenaltyValue = -10").
- **`FLATTERY_VS_DEFENSIVE_COMPOSURE_DELTA = -20`** (spec §3 line 298: "instant-fail returning zero affection and -20 composure").
- **`FAUX_PAS_LOCK_DURATION_IN_TICKS = 5`** (spec §3 line 300: "locked for five ticks"). **Already exists at `src/game/constants.ts:19`** — P1 introduced it for the existing `applyFauxPasLock` in `moods.ts:52`. P4 reuses the same constant; no new constant needed. The plan's earlier drafts used `FAUX_PAS_LOCK_TICKS`; that name was a collision; reuse the existing name.
- **`QUALITY_MULTIPLIER_FLOOR = 0.5`** (spec §3 line 310).
- **`QUALITY_MULTIPLIER_CEIL = 1.5`** (spec §3 line 310).
- **`STANCE_WALLFLOWER_AFFECTION_MULT = 0.5`** (spec §3 line 304).
- **`STANCE_MINGLE_AFFECTION_MULT = 1.0`** (baseline).
- **`STANCE_TARGETED_PURSUIT_AFFECTION_MULT = 1.25`** (spec §3 line 306: "only when the player is acting against the explicitly selected target").
- **`STANCE_TARGETED_PURSUIT_SABOTAGE_COMPOSURE_MULT = 2.0`** (spec §3 line 306: "doubled composure damage when sabotaged" — unused at P4; P5 Sabotage consumes it).
- **`AFFECTION_PROPOSAL_THRESHOLD = 80`** — pinned for later use (P7 proposal logic); cited at P4 only as the affection clamp ceiling reference.
- **`COMPOSURE_DEFAULT = 100`** — fresh-state composure for every character. Matches the duel-resolution starting value (spec §3 line 366).

**Tactic registry:**
- **`TACTICS = ["Flattery", "WittyBanter", "SlyGossip", "DeepEmpathy"] as const`** — single source of truth. Type `Tactic = (typeof TACTICS)[number]`. Zod: `TacticSchema = z.enum(TACTICS)`.

**Stance registry:**
- **`STANCES = ["Wallflower", "Mingle", "TargetedPursuit"] as const`** — type `Stance`, schema `StanceSchema`.

**Tactic↔mood bonus map** (`TACTIC_BONUS_MOOD`):
- One bonus mood per tactic per spec §3's conversation math (the spec describes the structure; the mappings below are designer picks consistent with the Regency-flavor archetypes).
- **`TACTIC_BONUS_MOOD: ReadonlyMap<Tactic, Mood>`**:
  | Tactic | Bonus Mood | Rationale |
  |---|---|---|
  | `Flattery` | `Receptive` | flattery lands on someone already inclined to like the player |
  | `WittyBanter` | `Receptive` | wit needs a willing audience; a Receptive target laughs along |
  | `SlyGossip` | `Jealous` | gossip thrives among the resentful |
  | `DeepEmpathy` | `Grieving` | empathy meets grief; this is the only tactic that lands on a Grieving target (Grieving is narrative-only otherwise) |
- **Inverse penalty mappings** (instant-fail or zero-yield branches per spec §3 lines 298):
  | Tactic | Mood | Branch |
  |---|---|---|
  | `Flattery` | `Defensive` | INSTANT-FAIL: 0 affection, −20 composure, faux-pas flag |
  | `WittyBanter` | `Distracted` | ZERO-YIELD: 0 affection, 0 composure (no faux-pas) |

**Tactic↔trait bonus/penalty maps** — the largest tuning surface; pinned in `constants.ts` as two registries:

```ts
// Each trait, for each tactic where it grants a bonus. Empty array = no bonus
// for that trait. Multi-tactic entries are allowed (a trait can bonus more than
// one tactic).
export const CONVERSATION_TRAIT_BONUSES: ReadonlyMap<TraitId, ReadonlyArray<Tactic>>;

// Each trait, for each tactic where it incurs a penalty. Empty array = no
// penalty. A trait may appear in BOTH bonuses and penalties for different
// tactics (e.g., `Brash` bonuses WittyBanter but penalizes DeepEmpathy).
export const CONVERSATION_TRAIT_PENALTIES: ReadonlyMap<TraitId, ReadonlyArray<Tactic>>;
```

**Designer mapping table** (the v1 tuning pass; baseline play-balance is a P4 implementation deliverable, expected iteration before merge):

| Trait | Bonus tactics | Penalty tactics |
|---|---|---|
| `Cunning` | SlyGossip | DeepEmpathy |
| `Observant` | SlyGossip | — |
| `Charming` | Flattery, WittyBanter | — |
| `Witty` | WittyBanter | — |
| `Empathetic` | DeepEmpathy | SlyGossip |
| `Intellectual` | WittyBanter | Flattery |
| `Sophisticated` | Flattery, WittyBanter | — |
| `Polyglot` | WittyBanter | — |
| `Rustic` | DeepEmpathy | Flattery, SlyGossip |
| `Vain` | Flattery | DeepEmpathy |
| `Frivolous` | WittyBanter | DeepEmpathy |
| `Romantic` | Flattery, DeepEmpathy | SlyGossip |
| `Jaded` | SlyGossip | Flattery |
| `Melancholic` | DeepEmpathy | WittyBanter |
| `Dull` | — | Flattery, WittyBanter |
| `Greedy` | SlyGossip | DeepEmpathy |
| `Devout` | DeepEmpathy | SlyGossip |
| `Pious` | DeepEmpathy | Flattery |
| `Brash` | WittyBanter | DeepEmpathy |
| `Reserved` | — | Flattery |
| `Ambitious` | Flattery | DeepEmpathy |
| `ImpoverishedNobility` | Flattery | — |
| `Generous` | DeepEmpathy | SlyGossip |
| `Suspicious` | — | Flattery, DeepEmpathy |
| `Loyal` | DeepEmpathy | SlyGossip |
| `Treacherous` | SlyGossip | DeepEmpathy |
| `Bold` | WittyBanter | — |
| `Cautious` | — | WittyBanter |
| `Eloquent` | Flattery, WittyBanter | — |
| `Reclusive` | — | Flattery, WittyBanter |
| `Hedonistic` | Flattery | DeepEmpathy |
| `Ascetic` | DeepEmpathy | Flattery |

**Why this exact mapping:** each tactic gets a coherent designed identity (Flattery rewards Charm + status-anxiety traits; WittyBanter rewards quick-wit / education; SlyGossip rewards cynicism / observation; DeepEmpathy rewards sincerity / emotional honesty). The penalty axis is symmetric — traits opposite to the tactic's spirit penalize it. **The map is designer-iterable;** the v1 baseline above is the implementation deliverable. Document inline that playtest may shift specific entries within the v1 window; the WHICH-tactics-are-tunable list lives in this table, not scattered across rules.

**Naming:** the **dual-registry shape** (bonuses + penalties separately) is preferred over a single `Map<TraitId, { bonus: Tactic[], penalty: Tactic[] }>` because:
- (a) Most traits have an empty array on one of the two axes; the dual-map shape encodes this efficiently.
- (b) Rule-layer iteration is one direction (given a tactic + a character's traits, count bonuses for THAT tactic) — a `Set`-style lookup `bonuses.get(traitId)?.includes(tactic)` is what the combat math needs, and the registry shape matches that.
- (c) Future widening (e.g., per-trait quality-multiplier nudges) can ship a third map without bumping the registry shape.

**Conversation-history bounds:**
- **`CONVERSATION_HISTORY_LIMIT_PER_PAIR = 3`** — append-time eviction. Bound from spec §3 line 597 ("bounded to three most-recent exchanges") and the 50-KB NFR.

**Gemini model identifiers** (`@google/genai` model strings as of 2026-05):
- **`MODEL_DEFAULT = "gemini-3.5-flash" as const`** — Gemini's cost-effective tier; the default for all non-first-meeting conversations.
- **`MODEL_FIRST_MEETING = "gemini-3.1-pro-preview" as const`** — Gemini's higher-quality tier; used only on first-meeting per Resolved decision #5. **`-preview` suffix indicates a preview/RC channel** at the time of P4 ship; mandatory Context7 lookup at implementation time confirms current availability and whether a stable `gemini-3.1-pro` alias has been promoted (if so, update the constant and the plan in the same commit). Reserving Pro for first-meetings only (a small fraction of conversations) keeps the budget for higher-impact "key moments" available without committing to additional model spend at P4. Future phases that ship the Pro-routed key moments (proposal / scheme completion / duel / monarch's audience — all deferred per spec §5) can reuse `MODEL_FIRST_MEETING` directly or introduce a separate `MODEL_KEY_MOMENT` constant.
- **Mandatory Context7 lookup at implementation time** for live SDK shape verification + the canonical model name list (Gemini's `3.x` family is current as of 2026-05; `gemini-3.1-pro-preview` is a preview/RC channel — pin date-stamped forms if determinism stability requires them). See `Mandatory Context7 lookups` section below.

**LLM request budgets:**
- **`LLM_TIMEOUT_MS = 15_000`** — spec §5 line 599 "15-second budget".
- **`LLM_OUTPUT_TOKEN_BUDGET = 600`** — short in-character replies are the goal; spec §5 "capped output-token budget". Passed via `config.maxOutputTokens` on the `generateContent` call.
- **`LLM_SYSTEM_INSTRUCTION_TOKEN_BUDGET = 1500`** — spec §5 line 601 "under 1500 tokens". **At P4, this is a documentation-only constant** — `buildPersonaPrompt` keeps the templated persona under ~300 tokens (well under the budget), so a runtime check would never fire. P18 (which polishes persona prose via LLM-authored content) is the natural phase to add a runtime assertion that `buildPersonaPrompt(target).length / 4 < LLM_SYSTEM_INSTRUCTION_TOKEN_BUDGET` (the `/4` is a coarse char-to-token ratio for sanity-check purposes). At P4 the constant exists so future-phase consumers have a canonical reference; no runtime enforcement.
- **`BYOK_KEY_SHAPE_REGEX = /^AIza.+/`** — pre-flight key shape check per spec §5 line 621 / CLAUDE.md "LLM integration specifics" (`/^AIza/` shape-only). Google API keys conventionally start with `AIza` followed by 35 characters. Lives in `constants.ts` so the single source of truth is reachable from both `src/llm/client.ts` and any future SDK-adjacent code. **Document that the regex intentionally does NOT require the 35-char tail length** — preserves the "shape-only" no-network-roundtrip discipline; the actual key validity is determined by the Gemini API on first call.

**Context-cache constants:**
- **`PERSONA_CACHE_TTL_SECONDS = "3600s" as const`** — 1-hour TTL for per-character persona context caches. Passed via `config.ttl` to `caches.create(...)`. Gemini's caching contract is explicit and stateful (vs Anthropic's implicit `cache_control`); the TTL governs server-side expiration.
- **`PERSONA_CACHE_DISPLAY_NAME_PREFIX = "season-persona-"`** — used to construct the human-readable `displayName` for each persona cache (e.g., `"season-persona-npc-blackwood"`). Useful for debugging at the Gemini console.

---

## `src/llm/` module structure

New module. Every export is forward-compatible with P6's whisper tool. Boundary: `llm/**` must NOT import `game-rng`, `game-rules`, `game-store`, or `persist`. It MAY import `game-conversation-types` (the shared types module) and `game-constants` (model IDs, budgets). The orchestrator wires the LLM module's output through the rules layer.

**`src/llm/errors.ts` — NEW.** Typed error classes for the four SDK failure paths, plus the `cancelled` reason. Each extends `Error` with a literal `reason` field matching the `ConversationFailure` discriminated union. Mirrors `src/persist/errors.ts`'s pattern (introduced at P2).
```ts
// src/llm/errors.ts
export class MissingKeyError extends Error {
  readonly reason = "missing-key" as const;
  constructor() { super("Gemini API key absent or empty."); }
}
export class TimeoutError extends Error {
  readonly reason = "timeout" as const;
  constructor() { super("Conversation request exceeded 15-second budget."); }
}
export class NetworkError extends Error {
  readonly reason = "network" as const;
  constructor(cause?: unknown) { super("Network or SDK error during conversation request.", { cause }); }
}
export class SchemaError extends Error {
  readonly reason = "schema" as const;
  constructor(public readonly issues: Array<{ path: string; message: string }>) {
    super("Model response failed schema validation.");
  }
}
export class CancelledError extends Error {
  readonly reason = "cancelled" as const;
  constructor() { super("Conversation request cancelled (user or view exit)."); }
}
export type LlmError = MissingKeyError | TimeoutError | NetworkError | SchemaError | CancelledError;

// Helper used by LlmClient.respond's Zod-parse catch: converts a thrown
// ZodError into the issues array shape SchemaError expects. Non-Zod errors
// (which would be a programming error inside our own response handling)
// surface as a single generic issue. Lives here (not in client.ts) so the
// types module owns the conversion alongside the SchemaError class.
import { z } from "zod";
export function zodIssuesFrom(cause: unknown): Array<{ path: string; message: string }> {
  if (cause instanceof z.ZodError) {
    return cause.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
  }
  return [{ path: "(unknown)", message: cause instanceof Error ? cause.message : String(cause) }];
}
```

**Note: `TimeoutError` is exported by `errors.ts` (the orchestrator references it in code comments + future phases may use it) but is NOT imported by `client.ts`.** The client never throws `TimeoutError` — that's the orchestrator's job (it inspects the `timedOut` flag and re-maps `CancelledError` → `{ reason: "timeout" }`). The class is kept in errors.ts for symmetry with the five-reason `ConversationFailure` union.
The orchestrator catches these and returns a `ConversationOutcome { kind: "Failed", failure: { reason: err.reason } }` to its caller (the `sendBallroomMessage` store action). The store action then publishes `ConversationFailed { reason }` AFTER its `set` body returns (per the bus-publishing discipline). The `reason` field is the discriminator — `LlmError["reason"]` equals `ConversationFailure["reason"]` by construction, so the mapping from caught error to publish payload is mechanical.

**`src/llm/client.ts`:**
```ts
import { GoogleGenAI, FunctionCallingConfigMode, type GenerateContentResponse } from "@google/genai";
import { LLM_OUTPUT_TOKEN_BUDGET, BYOK_KEY_SHAPE_REGEX } from "../game/constants";
import { RESPOND_TOOL } from "./tools";
import { ConversationResponseSchema } from "./types";
import type { ConversationRequest, ConversationResponseRaw } from "./types";
import {
  CancelledError,
  MissingKeyError,
  NetworkError,
  SchemaError,
  zodIssuesFrom,
} from "./errors";

export class LlmClient {
  // public so the orchestrator can reach the GoogleGenAI instance for
  // caches.create lookups via PersonaCacheRegistry. Read-only — callers
  // cannot reassign.
  public readonly ai: GoogleGenAI;
  constructor(apiKey: string) {
    if (!isValidKeyShape(apiKey)) throw new MissingKeyError();
    // The Gemini SDK's GoogleGenAI client is browser-safe by default for
    // the Gemini Developer API path (apiKey-based) — no explicit "allow
    // browser" opt-in needed (contrast with Anthropic's
    // dangerouslyAllowBrowser flag). The key is held in-memory only —
    // never sessionStorage, never localStorage, never IndexedDB. See
    // `BYOK key storage` section below for the React-state discipline.
    this.ai = new GoogleGenAI({ apiKey });
  }

  async respond(req: ConversationRequest, abort: AbortSignal): Promise<ConversationResponseRaw> {
    // Compose: system instruction (persona — cached via caches.create);
    // contents (the dynamic suffix: recency window + freeform message);
    // tools (the respond FunctionDeclaration); toolConfig (force respond).
    // The non-streaming generateContent returns the full result in one
    // promise. The AbortSignal is passed in config.abortSignal — note
    // per the SDK docs: "AbortSignal is a client-only operation. Using
    // it to cancel an operation will not cancel the request in the
    // service. You will still be charged usage for any applicable
    // operations." Acceptable per the BYOK + dev-cost framing.
    // Mutually exclusive: pass cachedContent OR systemInstruction, never both
    // (per Gemini SDK contract). The orchestrator passes cacheName !== null
    // when getOrCreatePersonaCache succeeded; otherwise it passes the persona
    // text directly and the SDK runs uncached for this turn.
    const cachingConfig = req.cacheName !== null
      ? { cachedContent: req.cacheName }
      : { systemInstruction: req.persona };
    let response: GenerateContentResponse;
    try {
      response = await this.ai.models.generateContent({
        model: req.model,
        contents: buildContents(req),
        config: {
          ...cachingConfig,
          tools: [{ functionDeclarations: [RESPOND_TOOL] }],
          toolConfig: {
            functionCallingConfig: {
              mode: FunctionCallingConfigMode.ANY,
              allowedFunctionNames: ["respond"],
            },
          },
          maxOutputTokens: LLM_OUTPUT_TOKEN_BUDGET,
          abortSignal: abort,
        },
      });
    } catch (cause) {
      // The SDK throws DOMException("AbortError") when abortSignal fires.
      // The client CANNOT distinguish timeout-source from user-cancellation
      // (both abort the same signal). The CLIENT always re-throws as
      // CancelledError — neutral. The ORCHESTRATOR holds the per-request
      // "was-timeout" flag and re-maps CancelledError → TimeoutError when
      // its own timeout source fired the abort. This keeps the client
      // single-responsibility (it doesn't know why abort fired).
      if (cause instanceof DOMException && cause.name === "AbortError") {
        throw new CancelledError();
      }
      throw new NetworkError(cause);
    }

    // The forced function call returns a single functionCall in the response.
    // SDK accessor: response.functionCalls?.[0] (array form because the
    // model could request multiple — but we force allowedFunctionNames:
    // ["respond"], so exactly one is expected).
    const call = response.functionCalls?.[0];
    if (call === undefined || call.name !== "respond") {
      throw new SchemaError([{ path: "functionCalls[0]", message: "missing respond call" }]);
    }
    try {
      return ConversationResponseSchema.parse(call.args);
    } catch (cause) {
      // Re-throw as SchemaError with field-level issues
      throw new SchemaError(zodIssuesFrom(cause));
    }
  }
}

export function isValidKeyShape(key: string): boolean {
  // Spec §5 line 621: "validate shape ... no network roundtrip."
  // Per CLAUDE.md "LLM integration specifics" — `/^AIza/` shape-only.
  // The regex itself lives in constants.ts so it has a single source of
  // truth (CLAUDE.md §10 "Designer constants in one canonical location each").
  return BYOK_KEY_SHAPE_REGEX.test(key);
}

function buildContents(req: ConversationRequest): string {
  // Concatenate recency window (history) + player freeform message into a
  // single contents string. Gemini's `contents` accepts string OR an array
  // of structured Content objects; at P4 we use the string form for
  // simplicity AND determinism (a stable string format means the mock SDK's
  // request-hash is reproducible across replay-harness runs).
  //
  // CANONICAL FORMAT (pinned for determinism — DO NOT vary this string
  // shape without bumping the save format AND coordinating with the mock
  // SDK's hash input):
  //   `<exchanges joined by "\n">\n<player freeform message>`
  // where each exchange is rendered as:
  //   - speaker "house-head" → `Player: <text>`
  //   - speaker "other"      → `NPC: <text>`
  // No trailing newline. Empty history (first-meeting) → just the freeform
  // message with no preceding newline.
  const transcript = req.history
    .map((ex) => (ex.speaker === "house-head" ? `Player: ${ex.text}` : `NPC: ${ex.text}`))
    .join("\n");
  return transcript === "" ? req.freeformMessage : `${transcript}\n${req.freeformMessage}`;
}
```

**`src/llm/tools.ts`:**
```ts
import type { FunctionDeclaration } from "@google/genai";

// Single FunctionDeclaration: `respond`. Forces structured output via
// Gemini's function-calling API. P6 widens this with a `generateWhisper`
// declaration (additional element in the same functionDeclarations array;
// the toolConfig.functionCallingConfig switches allowedFunctionNames to
// permit both, with the orchestrator selecting which to force per
// request). Spec §5 line 600 "model routing pre-wired but not active for
// proposal/scheme/duel/audience" — those wirings ship at their owning
// phases, not P4.
export const RESPOND_TOOL_NAME = "respond" as const;
export const RESPOND_TOOL: FunctionDeclaration = {
  name: RESPOND_TOOL_NAME,
  description: "Reply in-character to the player's message and classify their tactic.",
  parametersJsonSchema: {
    type: "object",
    properties: {
      dialogue: { type: "string" },
      classifiedTactic: {
        type: "string",
        enum: ["Flattery", "WittyBanter", "SlyGossip", "DeepEmpathy"],
      },
      qualityMultiplier: { type: "number" },
      moodHint: {
        type: "string",
        enum: ["Receptive", "Defensive", "Distracted", "Jealous", "Grieving"],
      },
      toolCalls: { type: "array", items: { type: "object" } },  // P6 widens
    },
    required: ["dialogue", "classifiedTactic", "qualityMultiplier"],
  },
};
```

**`src/llm/routing.ts`:**
```ts
import type { Exchange } from "./types";
import { MODEL_DEFAULT, MODEL_FIRST_MEETING } from "../game/constants";
import type { Model } from "./types";

// Spec §5 line 600 + Resolved decision #5. Pure function — takes the slice of
// history for the (houseId, targetCharId) pair the player is engaging, returns
// the model identifier. Empty history → first-meeting model. Used both at the
// initial request and at any future first-meeting routing decision.
//
// Crucially, history is NOT keyed on the actor — it's keyed on the player
// HOUSE — so after heir promotion (§7), `routeModel` sees the inherited
// history and stays on Gemini Flash. The function never reads state; the caller
// passes the already-resolved slice.
export function routeModel(history: readonly Exchange[]): Model {
  return history.length === 0 ? MODEL_FIRST_MEETING : MODEL_DEFAULT;
}
```

**`src/llm/prompts/persona.ts`:**
```ts
// Builds the system-instruction string for a target NPC. Consumed by the
// caches.create() call in src/llm/cache.ts (NOT passed directly to
// generateContent on each request — Gemini's caching is explicit: cache
// the persona once per (target, model) pair, then reference the cache
// name in subsequent generateContent calls).
//
// At P4 the persona is deterministically templated from { name, traits,
// mood, archetype, role }. The persona text is ALSO part of the request
// hash the mock SDK consumes, so its format MUST be stable across
// implementations (same as buildContents).
//
// CANONICAL FORMAT (pinned for determinism):
//   You are <name>, <role-label> of London Society.
//   Traits: <comma-joined trait labels, in array-order — NOT lex-sorted>.
//   Current mood: <mood>.
//   Archetype: <archetype | "None">.
//   Reply in character. Keep your replies brief and period-appropriate.
//
// The `<role-label>` mapping: HeadOfHouse → "a head", Dependent → "a member",
// Heir → "an heir", Spouse → "a spouse".
// No flavor LLM-generated content (P18 polishes); no embeddings retrieval (P17).
// Under ~300 tokens — well under the LLM_SYSTEM_INSTRUCTION_TOKEN_BUDGET.
export function buildPersonaPrompt(target: Character): string {
  const traitLabels = target.traits
    .map((id) => TRAITS.find((t) => t.id === id)?.label ?? id)
    .join(", ");
  const roleLabel = ROLE_LABELS[target.role];  // const map in the same file
  return [
    `You are ${target.name}, ${roleLabel} of London Society.`,
    `Traits: ${traitLabels}.`,
    `Current mood: ${target.mood}.`,
    `Archetype: ${target.archetype}.`,
    `Reply in character. Keep your replies brief and period-appropriate.`,
  ].join("\n");
}
```

**`src/llm/cache.ts`** — NEW. Owns the per-target context-cache lifecycle. Gemini's caching is stateful, so a registry maps `(targetCharacterId, modelName)` → `CachedContent.name` (the server-issued resource handle). **The ORCHESTRATOR (NOT the store action) calls `getOrCreatePersonaCache(target, model, abort)`** before each `generateContent`; the orchestrator owns the per-request AbortController so it can thread `abort` into the cache lookup. The function returns the cache name or `null` if cache creation fails (network error / unsupported model). The orchestrator sets `request.cacheName` based on the result and passes the (now-complete) ConversationRequest to `LlmClient.respond`. The client then either passes `config.cachedContent: cacheName` (cache hit path) OR passes `config.systemInstruction: personaText` (cache miss / unsupported / first-request path).

```ts
// src/llm/cache.ts
import type { GoogleGenAI } from "@google/genai";
import { PERSONA_CACHE_TTL_SECONDS, PERSONA_CACHE_DISPLAY_NAME_PREFIX } from "../game/constants";
import { buildPersonaPrompt } from "./prompts/persona";
import type { Character } from "../game/entities";
import type { Model, CharacterId } from "./types";  // CharacterId re-exported via game/conversation/types
import { CancelledError } from "./errors";

type CacheKey = `${CharacterId}|${Model}`;

export class PersonaCacheRegistry {
  // Maps (targetId, model) → server-issued cache name. In-memory only;
  // not persisted across page sessions. A fresh page session re-creates
  // caches lazily on first conversation per (target, model).
  private readonly cache = new Map<CacheKey, string>();

  async getOrCreatePersonaCache(
    ai: GoogleGenAI,
    target: Character,
    model: Model,
    abort: AbortSignal,
  ): Promise<string | null> {
    const key = `${target.id}|${model}` as CacheKey;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    try {
      const result = await ai.caches.create({
        model,
        config: {
          systemInstruction: buildPersonaPrompt(target),
          ttl: PERSONA_CACHE_TTL_SECONDS,
          displayName: `${PERSONA_CACHE_DISPLAY_NAME_PREFIX}${target.id}`,
          abortSignal: abort,
        },
      });
      const name = result.name;
      if (name === undefined) return null;  // SDK returned without a name; fall back to uncached
      this.cache.set(key, name);
      return name;
    } catch (cause) {
      // AbortError → re-throw as CancelledError (a typed LlmError class)
      // so the orchestrator's `instanceof CancelledError` branch handles it
      // correctly and re-maps to { reason: "cancelled" } (or "timeout" if
      // the orchestrator's timedOut flag is set). Re-throwing a raw
      // DOMException would fall through the orchestrator's typed catches
      // and silently surface as { reason: "network" } — wrong banner prose.
      // All other errors (network, unsupported model, quota) fall through
      // to null so the client falls back to passing systemInstruction
      // directly on this turn.
      if (cause instanceof DOMException && cause.name === "AbortError") {
        throw new CancelledError();
      }
      return null;
    }
  }

  // Invalidate cache entries for a dead target (called from the orphan-
  // prune cascade via a TargetCharacterDied event-bus subscription, NOT
  // directly from the rules layer).
  invalidateForTarget(targetId: CharacterId): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${targetId}|`)) this.cache.delete(key);
    }
  }

  // Clear all entries — called when the user rotates the BYOK API key.
  // The KeyContext provider's setKey wraps this so a key change drops the
  // local registry (the old cache names belong to the old key's project).
  clear(): void {
    this.cache.clear();
  }
}
// Module-level singleton exported by name so all consumers reach the
// same registry instance.
export const personaCacheRegistry = new PersonaCacheRegistry();
```

**Cache-vs-direct-system-instruction decision** at request time: if `getOrCreatePersonaCache` returns a non-null name, the `generateContent` call uses `config.cachedContent: cacheName` AND OMITS `config.systemInstruction`. If null, the call uses `config.systemInstruction: persona` AND OMITS `config.cachedContent`. The two paths are mutually exclusive per the Gemini SDK contract. Document this branching inline in `client.ts`.

**Cache invalidation on NPC death.** When NPCs die, the conversation event bus publishes a `TargetCharacterDied` event; a subscriber inside the orchestrator (registered at app boot) calls `personaCacheRegistry.invalidateForTarget(targetId)`.

**Publishing discipline for `TargetCharacterDied`.** Per CLAUDE.md non-negotiable "bus.publish fires from store-action wrappers ONLY, AFTER set returns", the event publishes from the `runYearPass` store-action wrapper, NOT from inside `applyAgingStep`. The wrapper diffs pre-state vs post-state to find newly-dead characters:
```ts
runYearPass: () => {
  const before = get();
  const after = runYearPassPure(before);
  set((state) => { overwriteFromGameState(state, after); });
  // Identify NPCs who died THIS year-pass and publish events for them.
  // CRITICAL: compare against `before.houses` (PRE-succession), not
  // `after.houses` — `runYearPassPure` runs `applySuccessionStep` AFTER
  // `applyAgingStep` (per src/runtime/yearPass.ts), so `after.houses[PLAYER]
  // .headOfHouseCharacterId` is already the heir's ID. Using `before`
  // correctly captures the dying player head's ID.
  const playerHeadIdBefore = before.houses.get(PLAYER_HOUSE_ID)?.headOfHouseCharacterId;
  for (const [id, c] of after.characters) {
    const wasAlive = before.characters.get(id)?.alive ?? false;
    if (wasAlive && !c.alive && id !== playerHeadIdBefore) {
      conversationBus.publish({ kind: "TargetCharacterDied", tick: after.tick, targetCharacterId: id });
    }
  }
},
```
**Why exclude the player head:** the player head dying triggers succession; conversation history under the player house's pair-keys remains valid (heir inherits). Only NPC deaths invalidate caches. The condition `id !== playerHeadIdBefore` ensures we don't fire the event for the dying player head.

**This `runYearPass` body change is a Step 8 edit (added to the atomic-commit step order — see below).** Step 8 already covers "Store actions + UI" generally; the explicit edit is: replace the existing one-line `runYearPass` body at `src/game/store.ts:123-125` with the diff-and-publish form above. The change is additive (the `set` body is unchanged; the publish loop runs AFTER set returns), so the determinism contract is preserved.

**Why event-bus (not direct call from the rule):** the prune lives in `game-rules` boundary; the cache lives in `llm` boundary; cross-boundary calls would violate eslint. The event bus is the canonical seam. The runYearPass wrapper is in `runtime` (well, `game-store`) which can import from both `game-rules` (to call the pure rules) and `runtime/events/conversation` (to publish).

**Best-effort semantics.** The cache invalidation is optimization, not correctness. If the orchestrator's subscriber misses an event (e.g., subscriber registers after the year-pass fires during init), the stale cache entry remains until its server-side TTL expires (1 hour). The next `generateContent` against the stale name will get a Gemini API error; the client's catch-and-fallback path (`SchemaError` or `NetworkError`) handles it gracefully. So the invalidate logic is forward-defensive; missing it doesn't break the happy path.

**`personaCacheRegistry` singleton wiring.**
- **Home:** `src/llm/cache.ts` exports `personaCacheRegistry: PersonaCacheRegistry` as a module-level constant (`export const personaCacheRegistry = new PersonaCacheRegistry();`).
- **Subscriber registration:** in `src/runtime/conversationOrchestrator.ts`'s module-load body, register the subscription:
  ```ts
  conversationBus.subscribe("TargetCharacterDied", (event) => {
    personaCacheRegistry.invalidateForTarget(event.targetCharacterId);
  });
  ```
  **Side-effect-only import at app root.** The orchestrator is not (yet) on the transitive import chain from `src/game/store.ts`. To ensure module-load runs at boot, `src/main.tsx` adds a side-effect-only import:
  ```ts
  // src/main.tsx — alongside existing imports
  import "./runtime/conversationOrchestrator";  // module-load registers TargetCharacterDied subscription
  ```
  The side-effect import has no exports to consume; its purpose is purely to trigger the subscription wiring. Document the import's purpose in a one-line proximity comment so future readers don't strip it as "unused."
- **API-key change invalidation:** the cache is keyed on `(targetId, model)`, NOT on the API key. A user rotating to a different Gemini API key WILL hit the old cache names (which were created under the old key). Two policy options:
  - (a) Accept stale-cache-name behavior: the new key's first `generateContent` against an old cache name fails (the cache resource belongs to the old key's project); the client's catch-and-fallback path drops to `systemInstruction` directly. One slow turn per (target, model) until the registry rebuilds.
  - (b) Clear the registry on every API-key change. Wire `KeyContext`'s `setKey` callback to call `personaCacheRegistry.clear()`. The orchestrator module exports a `clear()` method on the registry.
  - **PINNED: (b)** — clearer UX, no first-turn fallback drama on key rotation. The `clear()` call is a no-op if the registry is already empty.

**`src/llm/types.ts`** — defined above. Re-exports `ConversationPairKey` / `makePairKey` / `parsePairKey` from `src/game/conversation/types.ts` so `llm/**` consumers have a single import surface for conversation-shape types. Also exports:

```ts
export type Model = typeof MODEL_DEFAULT | typeof MODEL_FIRST_MEETING;

export type ConversationRequest = {
  targetCharacterId: CharacterId;
  playerHouseId: HouseId;
  pinnedIntent: Tactic | null;
  freeformMessage: string;
  history: readonly Exchange[];
  persona: string;            // system instruction (used when cacheName is null)
  cacheName: string | null;   // Gemini cache resource name from caches.create; null means cache-miss or first-call → use persona directly
  model: Model;
};

// Widen-and-validate: enum fields are parsed as z.string() so unknown values
// don't trigger SchemaError. The orchestrator's post-parse resolvers
// (resolveTactic / resolveMoodHint) apply the enum check + fallback.
// This is the uniform policy — see "Defensive clamping policy" below.
export const ConversationResponseSchema = z.object({
  dialogue: z.string().min(1),
  classifiedTactic: z.string(),                            // widened, resolved post-parse
  qualityMultiplier: z.number(),                           // clamped defensively post-parse
  moodHint: z.string().optional(),                         // widened, resolved post-parse to Mood | null
  toolCalls: z.array(z.never()).default([]),               // P6 widens
});
export type ConversationResponseRaw = z.infer<typeof ConversationResponseSchema>;

// The "resolved" response — what the orchestrator consumes after running
// resolveTactic + resolveMoodHint + qualityMultiplier clamp. This is the
// type that flows into resolveCombat.
export type ConversationResponse = {
  dialogue: string;
  classifiedTactic: Tactic;                                // narrowed via resolveTactic
  qualityMultiplier: number;                               // clamped to [0.5, 1.5]
  moodHint: Mood | null;                                   // narrowed via resolveMoodHint
  toolCalls: never[];                                      // P6 widens
};
```

**Defensive clamping policy — applied uniformly across all model-controlled enum/numeric fields** (per spec §7 line 664 "clamp out-of-range fields defensively rather than erroring"):

- **`qualityMultiplier`**: parsed as `z.number()` (no min/max). Post-parse, clamp to `[QUALITY_MULTIPLIER_FLOOR, QUALITY_MULTIPLIER_CEIL]`. Out-of-range receipt is logged at debug level. Never SchemaErrors.
- **`classifiedTactic`**: parsed as `z.string()` (widened from the enum). Post-parse, run `resolveTactic(received: string, pinned: Tactic | null): Tactic` — **PIN ALWAYS OVERRIDES**. If `pinned !== null`, return `pinned` (regardless of `received`). If `pinned === null`, return `received` when valid, else `"Flattery"`. **Spec §3 line 70 is the authoritative reading** ("A pinned explicit intent overrides any classification the language model produces"). Line 312's "fall back to pinned" wording is the edge case for when the model returns garbage AND no pin is set. Pin-overrides ensures the player's explicit declaration of intent controls which tactic↔trait/mood bonus map is applied, so the pin button isn't mechanically a no-op when the model returns a valid (but different) classification. Never SchemaErrors on this field.
- **`moodHint`**: parsed as `z.string().optional()` (widened from the enum). Post-parse, run `resolveMoodHint(received: string | undefined): Mood | null` — returns the enum value if `received` is a valid `Mood`, else `null` (drop-if-invalid). The orchestrator applies the mood SET via a store mutation only when the resolved value is non-null. **Pure assignment, NO PRNG draws.** Never SchemaErrors on this field.
- **Schema-error path (the third of four failure paths)** is reached when (a) the response is not valid JSON, (b) required top-level fields (`dialogue`, `classifiedTactic`, `qualityMultiplier`) are missing, or (c) `dialogue` is non-string / empty after `.min(1)`. The model-controlled enum/numeric fields are widened-and-validated specifically to avoid losing the response over a single bad field.

**Why uniform widen-and-validate (not field-by-field):** spec §7 line 664's "clamp out-of-range fields defensively" reads as a universal policy. Picking different strictness levels per field invites bugs when the model's response shape drifts.

**Mood-drift vs `moodHint` timing windows are disjoint, not racing.** Mood-drift fires in `applyMoodDriftPhase` inside `tickOrchestrator`'s PHASES (per-tick — verified at `src/runtime/tickOrchestrator.ts:44`); conversation `moodHint` fires at conversation-resolve within a tick. **A ballroom session does NOT advance ticks** (within-tick session — see "Tick semantics in the ballroom" below), so during a single ballroom session no mood-drift can fire — the most recent `moodHint` is always the freshest mood value on the target. When the player exits the ballroom and the next tick fires (via "stay another year" or travel), mood-drift may reroll. This is the spec's narrative flow (within-session conversations override; mood-drift refreshes on the next tick after exit).

---

## `src/runtime/conversationOrchestrator.ts`

Owns the request lifecycle: validates the request → builds the prompt → calls `LlmClient.respond` → applies deltas via the pure `combat.ts` rule → publishes events. Single bounded surface; React hooks subscribe to events and read store state but do NOT call the orchestrator directly — they call a store action that internally invokes the orchestrator.

**Lifecycle state machine (Conversation round-trip).** Five states: `Idle`, `Sending`, `Resolving`, `Done`, `Failed`. **No separate `Cancelled` state** — user-cancellation and view-exit aborts both flow through `Failed { reason: "cancelled" }`. This keeps the state machine's failure surface aligned with the canonical `ConversationFailure` discriminated union (5 reasons: timeout / network / schema / missing-key / cancelled).
- `Idle` → `Sending` (player sends message via `store.sendBallroomMessage(input)`).
- `Sending` → `Resolving` (LLM responds, schema-parsed; combat resolver about to run).
- `Resolving` → `Done` (state mutation committed + history append + event published).
- `Sending` → `Failed { reason: ConversationFailure }` (any of five failure paths). The four network/SDK paths fire when the SDK call rejects or returns malformed payload; `cancelled` fires when `abortBallroomRequest` OR `exitBallroom` aborts an in-flight request.
- `Failed` → `Idle` (player dismisses banner; UI re-enables).
- `Done` → `Idle` (player reads response; UI re-enables for next send).

**XState v5 implementation.** The machine lives at `src/game/machines/conversation.ts` (a NEW file; the `machines/` directory exists from P0 but is empty). XState v5 actor refs are held in the conversation orchestrator's module state, NOT in React component state — per CLAUDE.md "State machines are XState v5 actor refs held in the Zustand store. Don't inline state-machine logic in components."

```ts
// src/game/machines/conversation.ts
import { setup } from "xstate";
import type { ConversationRequest, ConversationResponse } from "../../llm/types";
import type { ConversationFailure } from "../conversation/types";

export const conversationMachine = setup({
  types: {} as {
    context: { request: ConversationRequest | null; response: ConversationResponse | null; failure: ConversationFailure | null };
    events:
      | { type: "send"; request: ConversationRequest }
      | { type: "resolved"; response: ConversationResponse }
      | { type: "failed"; failure: ConversationFailure }
      | { type: "cancel" }
      | { type: "dismiss" };
  },
}).createMachine({ /* ... */ });
```

**`requestId` ref pattern.** Spec §7 line 670 ("Asynchronous continuation against freed UI") + CLAUDE.md non-negotiable §7 ("post-await mutations check the request hasn't been superseded"). The orchestrator threads a monotonically increasing `requestId: number` through each request. The `Promise<ConversationOutcome>` resolves with `{ requestId, outcome }`; the orchestrator's post-await callback checks `if (requestId !== this.currentRequestId) return;` before applying mutations.

**Where the `requestId` lives:** in the orchestrator module's mutable state — NOT a React `useRef`. Specifically, `src/runtime/conversationOrchestrator.ts` exports a singleton orchestrator (an instance held in module-level state). The orchestrator has a private `currentRequestId: number = 0` field, incremented per `.send()` call. The React surface holds no request ID; the surface only knows whether the machine is in `Sending` / `Resolving` / `Done` / `Failed`.

**Why module-singleton (not store-held):** the orchestrator owns side effects (LLM calls, abort controllers, request IDs) — putting these in the Zustand store would force them through the immer draft, which doesn't compose with `AbortController` (immer drafts can't hold opaque external objects without becoming proxies). The pure GameState slice and the side-effecting orchestrator are intentionally siloed.

**Bus-publishing discipline.** The orchestrator does NOT directly publish `ConversationResolved` / `ConversationFailed` events — per CLAUDE.md non-negotiable "bus.publish fires from store-action wrappers ONLY, AFTER `set` returns." Instead, the orchestrator's `.send(request, apiKey)` returns a `Promise<ConversationOutcome>`; the `sendBallroomMessage` store action awaits that promise and publishes the event AFTER its `set` body completes. **The one exception is `TargetCharacterDied`**: subscribed BY the orchestrator (for `personaCacheRegistry.invalidateForTarget`), but PUBLISHED FROM the `runYearPass` store-action wrapper. The orchestrator only owns subscriptions; the store actions own publishes.

**AbortController + React StrictMode discipline:**
- React 19 StrictMode double-invokes effects in dev mode. A `useEffect` that calls `orchestrator.send()` will be invoked twice. The second invocation increments `currentRequestId` and aborts the first — the first call's HTTP request still fires (the SDK has already started fetching), but its response is discarded because the requestId check fails AND the AbortController has been aborted.
- **The cost in dev mode is one wasted LLM call per conversation send.** Document this as a known dev-only cost; the production build has no double-invocation.
- The orchestrator's public interface is exactly two methods: `.send(request, apiKey): Promise<ConversationOutcome>` and `.abortCurrent(): void`. There is no `.abort(requestId)` (request IDs are internal-only — the orchestrator's per-request bookkeeping) and no `.abortAll()` (at P4 only one request is ever in-flight at a time, so "current" and "all" are the same — call `abortCurrent`). When the user navigates away from the ballroom, the ballroom component's cleanup calls `orchestrator.abortCurrent()`.

**Orchestrator `send()` — full snippet** (every binding declared, no free variables):

```ts
// src/runtime/conversationOrchestrator.ts
import { LlmClient } from "../llm/client";
import { personaCacheRegistry } from "../llm/cache";
import {
  MissingKeyError,
  NetworkError,
  SchemaError,
  CancelledError,
} from "../llm/errors";
import { narrowResponse } from "../llm/types";
import type {
  ConversationRequest,
  ConversationResponseRaw,
} from "../llm/types";
import { LLM_TIMEOUT_MS } from "../game/constants";
import type { Character } from "../game/entities";
import type { BallSessionId } from "../game/rng";
import { makeBallSessionId } from "../game/rng";
import type { ConversationResponse } from "../llm/types";
import type { ConversationFailure } from "../game/conversation/types";
import { conversationBus } from "./events/conversation";

// ConversationOutcome is owned by this module — declared inline (NOT
// self-imported). External consumers import { ConversationOutcome } from
// "../runtime/conversationOrchestrator".
export type ConversationOutcome =
  | { kind: "Resolved"; response: ConversationResponse }
  | { kind: "Failed"; failure: ConversationFailure };

class ConversationOrchestrator {
  private currentRequestId = 0;
  private currentAbort: AbortController | null = null;

  abortCurrent(): void {
    if (this.currentAbort !== null) this.currentAbort.abort();
  }

  async send(
    request: ConversationRequest,
    apiKey: string,
    target: Character,    // passed by the store action; needed for cache lookup
  ): Promise<ConversationOutcome> {
    // Bump the request ID and capture it locally; any previous request's
    // post-await mutations bail via the stale-check below.
    const requestId = ++this.currentRequestId;

    // Fresh per-request AbortController. The previous request (if still
    // in-flight) was aborted by .abortCurrent() at the relevant call site
    // (exitBallroom or abortBallroomRequest); calling .abortCurrent() here
    // would be redundant.
    const abortController = new AbortController();
    this.currentAbort = abortController;

    // Per-request timeout. The flag distinguishes timeout-abort from
    // user-abort; the client always throws CancelledError on abort, and
    // only the orchestrator knows why it aborted.
    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      abortController.abort();
    }, LLM_TIMEOUT_MS);

    let response: ConversationResponseRaw;
    let client: LlmClient;
    try {
      // Construct fresh LlmClient per request so a key change between
      // sends takes effect on the next call (the API key is captured
      // here, not in module-level state).
      client = new LlmClient(apiKey);  // may throw MissingKeyError

      // Fill in cacheName. The orchestrator owns the AbortController, so
      // it threads abort into the cache lookup. Note: LlmClient.ai is
      // declared `public readonly` (NOT private) so this registry call
      // can reach the SDK instance.
      const cacheName = await personaCacheRegistry.getOrCreatePersonaCache(
        client.ai,
        target,
        request.model,
        abortController.signal,
      );
      const requestWithCache: ConversationRequest = { ...request, cacheName };

      response = await client.respond(requestWithCache, abortController.signal);
    } catch (err) {
      clearTimeout(timeoutHandle);
      this.currentAbort = null;
      // Stale-check: if a later send() has bumped the counter, this older
      // promise's resolution is discarded. The CALLER (store action) sees
      // the resolution but the post-await mutation block is also expected
      // to bail — see the store action's stale-check below.
      if (requestId !== this.currentRequestId) {
        return { kind: "Failed", failure: { reason: "cancelled" } };
      }
      // Map typed errors to the five ConversationFailure reasons
      if (err instanceof MissingKeyError) return { kind: "Failed", failure: { reason: "missing-key" } };
      if (err instanceof SchemaError)     return { kind: "Failed", failure: { reason: "schema", issues: err.issues } };
      if (err instanceof CancelledError) {
        return { kind: "Failed", failure: { reason: timedOut ? "timeout" : "cancelled" } };
      }
      if (err instanceof NetworkError)    return { kind: "Failed", failure: { reason: "network" } };
      return { kind: "Failed", failure: { reason: "network" } };
    }
    clearTimeout(timeoutHandle);
    this.currentAbort = null;
    if (requestId !== this.currentRequestId) {
      return { kind: "Failed", failure: { reason: "cancelled" } };
    }
    return { kind: "Resolved", response: narrowResponse(response, request.pinnedIntent) };
  }
}
export const conversationOrchestrator = new ConversationOrchestrator();

// Module-load: register the TargetCharacterDied subscription
conversationBus.subscribe("TargetCharacterDied", (event) => {
  personaCacheRegistry.invalidateForTarget(event.targetCharacterId);
});
```

**`narrowResponse(raw, pinnedIntent)`** is the resolver function that applies `resolveTactic` (post-parse string → Tactic) + `resolveMoodHint` (post-parse string → Mood | null) + `qualityMultiplier` clamp, producing the narrowed `ConversationResponse` shape.

**`LlmClient.ai` is `public readonly`** (NOT `private readonly` as the earlier client snippet had) so `personaCacheRegistry.getOrCreatePersonaCache(client.ai, ...)` reaches the underlying `GoogleGenAI` instance. The field is read-only — external callers cannot reassign it.

**Failure-path mapping** — exactly five reasons; each is observable via a distinct typed error class:

1. **Timeout**: the orchestrator's `setTimeout(LLM_TIMEOUT_MS)` callback sets `timedOut = true` and calls `abortController.abort()`. The SDK throws `AbortError` → client wraps as `CancelledError` → orchestrator inspects `timedOut` flag → returns `{ reason: "timeout" }`.
2. **Network**: any non-Abort error from `generateContent` → client wraps as `NetworkError` → orchestrator returns `{ reason: "network" }`.
3. **Schema**: Zod parse fails on `response.functionCalls[0].args` → client throws `SchemaError` with `issues` → orchestrator returns `{ reason: "schema", issues }`.
4. **Missing key**: client construction (`new LlmClient(apiKey)`) fails `isValidKeyShape` → throws `MissingKeyError` → orchestrator returns `{ reason: "missing-key" }`. The key validation happens BEFORE the network call.
5. **Cancelled**: user calls `orchestrator.abortCurrent()` while a request is in-flight (without `timedOut` being set) → client throws `CancelledError` → orchestrator returns `{ reason: "cancelled" }`.

**All five paths share this contract:**
- Do NOT mutate `state.tick`.
- Do NOT call `combat.ts`.
- Do NOT append to `state.conversationHistory`.
- Do NOT mutate `state.affectionMap` or `Character.composure`.
- DO re-enable UI controls (the machine transitions to `Failed` → `Idle` on `dismiss`).
- DO log a structured-log entry tagged `category: "conversation-failure"` carrying `reason` but NOT the player's freeform input verbatim (per spec §8 line 698).

**Why all four NETWORK/SDK failure paths must be tested at P4** (timeout / network / schema / missing-key — the spec §5 "four failure paths" originally enumerated): they are the determinism contract — a regression in any of them silently advances tick or mutates history. The fifth `cancelled` reason is a P4-introduced reason for user-initiated abort + view-exit; its test coverage is in the exit-ballroom / abort-request tests. Vitest fixtures (mocked SDK):
- `vi.mock("@google/genai")` returns a controllable mock. Each failure path has a dedicated mock setup (throws AbortError / throws generic Error / returns malformed `functionCalls` / orchestrator is constructed with empty key).
- Each test asserts: post-call state equals pre-call state (deep equal); no event of kind `ConversationResolved` was published; an event of kind `ConversationFailed` with the correct `reason` WAS published.

---

## `src/game/rules/combat.ts` — pure rule

Boundary: `game-rules` (already in the allow list). Imports `game-constants`, `game-fixtures`, `game-conversation-types` (for `Exchange` if needed; the rule mostly works at the delta-computation layer). NO LLM imports.

**Exports:**
```ts
export type CombatInput = {
  tactic: Tactic;
  stance: Stance;
  qualityMultiplier: number;            // already clamped to [0.5, 1.5] by the LLM layer
  targetMood: Mood;
  targetTraits: readonly TraitId[];
  isAgainstPinnedTarget: boolean;       // for TargetedPursuit's "explicitly selected target" branch
};

export type CombatOutcome =
  | { kind: "Normal"; affectionDelta: number; composureDelta: number; synergy: boolean }
  | { kind: "InstantFail"; affectionDelta: 0; composureDelta: number; fauxPas: true; synergy: false }
  | { kind: "ZeroYield"; affectionDelta: 0; composureDelta: 0; synergy: false };

export function resolveCombat(input: CombatInput): CombatOutcome;
```

**Algorithm:**

1. **Override check** (spec §3 line 298):
   - If `tactic === "Flattery"` AND `targetMood === "Defensive"` → return `{ kind: "InstantFail", affectionDelta: 0, composureDelta: FLATTERY_VS_DEFENSIVE_COMPOSURE_DELTA, fauxPas: true, synergy: false }`. No further computation.
   - If `tactic === "WittyBanter"` AND `targetMood === "Distracted"` → return `{ kind: "ZeroYield", ... }`. No further computation.

2. **Trait/mood count gathering:**
   - Count bonus traits: `bonusCount = targetTraits.filter(t => CONVERSATION_TRAIT_BONUSES.get(t)?.includes(tactic)).length`.
   - Count penalty traits: `penaltyCount = targetTraits.filter(t => CONVERSATION_TRAIT_PENALTIES.get(t)?.includes(tactic)).length`.
   - Check mood bonus: `moodMatches = TACTIC_BONUS_MOOD.get(tactic) === targetMood` (binary).

3. **Synergy flag:** `synergy = bonusCount > 0 || moodMatches` (any positive contribution). Per spec §3 line 299, the synergy flag keys on the synergy-hit condition, NOT the post-modulation affection sign.

4. **Affection delta** (spec §3 line 296):
   - `baseAffection = COMBAT_BASE_AFFECTION + (bonusCount * COMBAT_BONUS_VALUE) + (moodMatches ? COMBAT_BONUS_VALUE : 0)`
   - Apply stance modifier: `stancedAffection = baseAffection * stanceAffectionMultiplier(stance, isAgainstPinnedTarget)`
   - Apply quality multiplier: `finalAffection = stancedAffection * qualityMultiplier`
   - Round to integer (per spec §4 "Affection between any two characters is clamped to [0,100]" implies integer-valued affection): `Math.round(finalAffection)`.

5. **Composure delta** (spec §3 line 297):
   - `composureDelta = penaltyCount * COMBAT_PENALTY_VALUE` (negative number when penalties present, zero otherwise).
   - **Quality multiplier NEVER modulates composure** (spec §3 line 310: "structural damage is phrasing-independent"). The composure value is exactly `penaltyCount * -10`.

6. **Return:** `{ kind: "Normal", affectionDelta: finalAffection, composureDelta, synergy }`.

**Stance modifier function** (private to `combat.ts`):
```ts
function stanceAffectionMultiplier(stance: Stance, isAgainstPinnedTarget: boolean): number {
  switch (stance) {
    case "Wallflower": return STANCE_WALLFLOWER_AFFECTION_MULT;       // 0.5, applies to every conversation
    case "Mingle": return STANCE_MINGLE_AFFECTION_MULT;                // 1.0
    case "TargetedPursuit": return isAgainstPinnedTarget ? STANCE_TARGETED_PURSUIT_AFFECTION_MULT : STANCE_MINGLE_AFFECTION_MULT;  // 1.25 vs pinned, 1.0 otherwise
  }
}
```

**Wallflower stance semantic (spec §3 line 304):** "Wallflower multiplies affection delta by 0.5, and grants a bonus whisper when SlyGossip produces a synergy hit." Read together with spec §3 line 65 (the player selects a target from up to 5 NPCs), the Wallflower stance applies its 0.5 multiplier to EVERY conversation in the session, not only to a specific pinned target. The player is "playing soft" across all engagements. The function above reflects this: `Wallflower` ignores the `isAgainstPinnedTarget` argument — every conversation under this stance halves affection. **TargetedPursuit's `isAgainstPinnedTarget` branch** is distinct because that stance has a "you're focused on one person" semantic in the spec (`×1.25 against pinned target`); Wallflower has no such pinned-target branch in the spec.

**Wallflower + SlyGossip synergy → bonus whisper (spec §3 line 304):**
- At P4 whispers don't exist. The combat outcome's `synergy: true` flag is the ONLY signal P4 emits; the consumer is a no-op at P4. P6's whisper layer will subscribe to `ConversationResolved` events and check `outcome.synergy && stance === "Wallflower" && tactic === "SlyGossip"` to generate the bonus whisper. **This is the explicit P4 deferral of the spec's "bonus whisper" branch** — recorded as a Verification item (no consumer at P4) and tracked in the §7 risks log.
- **At P4 the orchestrator publishes the synergy flag in the `ConversationResolved` event** so P6 can subscribe without re-resolving combat.

**Determinism contract:** `resolveCombat` is a pure function — same inputs always produce same outputs. NO PRNG draws. NO state reads beyond the input struct. The replay harness hashes through this function via the orchestrator's `Exchange` append, which IS in the hash projection (since `conversationHistory` is in `hashableState`).

**Test fixtures** at `src/game/rules/combat.test.ts`:
- One test per override branch (Flattery↔Defensive, WittyBanter↔Distracted).
- One test per stance × `isAgainstPinnedTarget` matrix.
- Bonus/penalty count tests covering 0, 1, and ≥2 traits.
- Mood bonus binary tests.
- Quality multiplier extremes (0.5, 1.0, 1.5) — assert affection scales linearly, composure is invariant.
- Synergy-flag tests covering bonusCount>0 / moodMatches / neither / both.

---

## Schema↔projection↔selector triple-sync — explicit edit list

P3 introduced the trip-wire test at `src/game/schema-projection-selector-extension.test.ts`. P4 adds TWO top-level GameState keys (`conversationHistory`, `affectionMap`); the triple-sync test catches forgotten surfaces, but the implementation guide pins the surfaces:

1. **`src/game/entities.ts` `GameStateSchema`** — add `conversationHistory: z.map(ConversationPairKeySchema, z.array(ExchangeSchema))` AND `affectionMap: z.map(ConversationPairKeySchema, z.number().int().min(0).max(100))`. Import `ConversationPairKeySchema` and `ExchangeSchema` from the shared module (`src/game/conversation/types.ts`).

2. **`src/game/hash.ts` `hashableState`** — add `conversationHistory: serializeRegistry(state.conversationHistory)` AND `affectionMap: serializeRegistry(state.affectionMap)`, plus matching return-type entries.

3. **`src/game/store.ts` `selectGameState`** — add `conversationHistory: state.conversationHistory` AND `affectionMap: state.affectionMap`.

4. **`src/game/store.ts` `createInitialState`** — add `conversationHistory: new Map<ConversationPairKey, Exchange[]>()` AND `affectionMap: new Map<ConversationPairKey, number>()`.

5. **`src/game/store.ts` `overwriteFromGameState`** — add `draft.conversationHistory = next.conversationHistory` AND `draft.affectionMap = next.affectionMap`. THIS IS THE LOAD-BEARING ONE for full-state overwrites — all P3 player-elected actions (`travel`, `requestAudience`, `escapeBankruptcy`, `refreshWardrobe`) plus the existing `advanceTick` / `runYearPass` / `replaceState` route through `overwriteFromGameState`, so a single edit here covers all callers. The audit pattern from P2 ("when you add a `GameState` key, every `set`-style state copy must include it") is satisfied by editing this one helper.

6. **`src/game/store.ts` new P4 conversation actions** — see "Store actions" below. **Two distinct mutation patterns:**
   - **Full-state-overwrite actions** (`enterBallroom`, `exitBallroom`): mutate Map values via the Immer draft and/or call `overwriteFromGameState` for the few fields they touch. `exitBallroom`'s session-composure commit mutates ONLY `state.characters.get(playerHeadId).composure` — a targeted Immer-draft mutation, NOT a full-state overwrite.
   - **Targeted-Immer-draft actions** (`sendBallroomMessage`): mutate specific Map values directly inside the `set` body (`state.characters.get(targetId).composure = ...`, `state.affectionMap.set(...)`, `state.conversationHistory.set(...)`). These actions do NOT go through `overwriteFromGameState` because they apply DELTAS, not a wholesale state replacement.
   - **Audit gap:** the trip-wire test (`schema-projection-selector-extension.test.ts`) catches forgotten projection fields; it does NOT catch targeted-mutation actions that forget to mutate a new field. **P4's `sendBallroomMessage` mutates all three new fields directly, by design.** Future ballroom-touching actions that add a new pair-keyed field must update BOTH `overwriteFromGameState` AND the `sendBallroomMessage` set body — there is no single source of truth here. Document this trade-off inline at the `sendBallroomMessage` action so the next reader doesn't strip "redundant" mutations.

7. **`src/persist/schema.ts` `fromSaveV5`** — already covered above (top of plan, save-format-bump section); the lift deserializes both new tuple arrays.

8. **Trip-wire test extension** — the existing `src/game/schema-projection-selector-extension.test.ts` should pass without modification because it iterates `Object.keys(GameStateSchema.shape)`. Verify after the schema edit lands.

---

## Store actions

New actions added to `StoreActions` in `src/game/store.ts`. Each follows the pre-mutation pattern: validate → mutate via pure rule → publish event. None of these actions advance the tick (a ballroom session is a within-tick interaction — see "Tick semantics in the ballroom" below).

```ts
// P4 additions:
sendBallroomMessage: (
  input: BallroomMessageInput,
  apiKey: string,        // read by the React caller via useContext(KeyContext) and threaded in
) => Promise<{ ok: true; outcome: ConversationOutcome } | { ok: false; reason: ConversationFailure }>;
enterBallroom: () => { ok: true; sessionId: BallSessionId } | { ok: false; reason: BallEntryRejection };
exitBallroom: (playerComposureAtExit: number) => void;
abortBallroomRequest: () => void;
```

**`sendBallroomMessage`** wires through to `conversationOrchestrator.send(...)`:
1. Validate: ball session is open via `conversationOrchestrator.currentSessionId() !== null` (if no session, return `{ ok: false, reason: { reason: "cancelled" } }` — calling `sendBallroomMessage` without an open session is treated as a "cancelled" failure path; the UI should never reach this state, so the rejection is defensive); player house has a head-of-house; target NPC exists and is alive; `apiKey` is non-empty (rejection: `ConversationFailure { reason: "missing-key" }` without ever touching the SDK). **Publish `ConversationSent` event** AFTER validation passes but BEFORE awaiting the LLM:
   ```ts
   conversationBus.publish({
     kind: "ConversationSent",
     tick: stateBefore.tick,
     pairKey,
     tactic: input.pinnedTactic,
     stance: input.stance,
   });
   ```
2. Build the `ConversationRequest`: history slice from `state.conversationHistory.get(pairKey)` (empty array if absent); persona from `buildPersonaPrompt(target)`; model from `routeModel(history)`. **`cacheName` is left as `null` at this stage** — the orchestrator fills it in via `personaCacheRegistry.getOrCreatePersonaCache(target, model, abort)` after constructing its internal AbortController. The store action does NOT call the cache registry directly (the cache lookup needs the AbortSignal that only the orchestrator owns).
3. Look up `target = stateBefore.characters.get(input.targetCharacterId)` (validation step 1 has guaranteed it's defined and alive); call `conversationOrchestrator.send(request, apiKey, target)`. **The orchestrator constructs its own per-request `AbortController` internally** (NOT passed in); the orchestrator's `.send()` takes (request, apiKey, target) and returns a `Promise<ConversationOutcome>`. It also exposes `.abortCurrent()` for external cancellation (used by `exitBallroom` and `abortBallroomRequest`). The orchestrator instantiates a fresh `LlmClient(apiKey)` for THIS request so a key change between sends takes effect on the next call without orchestrator re-init. The orchestrator owns request lifecycle; this action awaits the outcome.
4. On `Done`. The orchestrator returns `{ kind: "Resolved", response: ConversationResponse }`. The store action then performs the combat resolution + state mutation. **Full snippet showing every binding** (no free variables):
     ```ts
     // The store action begins with these bindings already in scope:
     // - input: BallroomMessageInput (function parameter)
     // - apiKey: string (function parameter)
     // - stateBefore: GameState (captured via `const stateBefore = get();` at function entry)
     // - targetId: CharacterId = input.targetCharacterId
     // - pairKey: ConversationPairKey = makePairKey(PLAYER_HOUSE_ID, targetId)
     // - target: Character = stateBefore.characters.get(targetId)! (validated alive in step 1; non-null asserted here)
     // - history: readonly Exchange[] = stateBefore.conversationHistory.get(pairKey) ?? []
     // - request: ConversationRequest = {
     //     targetCharacterId: targetId,
     //     playerHouseId: PLAYER_HOUSE_ID,
     //     pinnedIntent: input.pinnedTactic,   // rename: input.pinnedTactic → request.pinnedIntent
     //     freeformMessage: input.freeformMessage,
     //     history,
     //     persona: buildPersonaPrompt(target),
     //     cacheName: null,                    // orchestrator fills via getOrCreatePersonaCache
     //     model: routeModel(history),
     //   };
     //
     // After `const result = await conversationOrchestrator.send(request, apiKey, target);`:
     if (result.kind === "Failed") {
       conversationBus.publish({ kind: "ConversationFailed", tick: stateBefore.tick, pairKey, failure: result.failure });
       return { ok: false, reason: result.failure };
     }
     const response = result.response;

     // Resolve combat via the pure rule
     const outcome = resolveCombat({
       tactic: response.classifiedTactic,
       stance: input.stance,
       qualityMultiplier: response.qualityMultiplier,
       targetMood: target.mood,
       targetTraits: target.traits,
       isAgainstPinnedTarget: input.pinnedTactic !== null,
     });

     // Build the two Exchange records BEFORE the set body
     const playerExchange: Exchange = {
       speaker: "house-head",
       text: input.freeformMessage,
       classifiedTactic: response.classifiedTactic,
       tick: stateBefore.tick,
     };
     const npcExchange: Exchange = {
       speaker: "other",
       text: response.dialogue,
       classifiedTactic: null,
       tick: stateBefore.tick,
     };

     // Capture wasAlreadyLocked BEFORE the set body so the publish below
     // sees the pre-extension lock state.
     const wasAlreadyLocked = target.moodLockUntilTick > stateBefore.tick;
     const fauxPasFired = outcome.kind === "InstantFail";

     // Apply combat delta atomically in one set body. Immer draft scope;
     // enableMapSet() precondition is already satisfied at src/game/store.ts:45.
     set((state) => {
       // Target composure — Immer-draft mutation of a Map value.
       const t = state.characters.get(targetId);
       if (t !== undefined) {
         t.composure = clamp(t.composure + outcome.composureDelta, 0, t.maxComposure);
         if (fauxPasFired) {
           // Faux-pas mood lock takes precedence over any moodHint.
           t.moodLockUntilTick = state.tick + FAUX_PAS_LOCK_DURATION_IN_TICKS;
           if (!wasAlreadyLocked) t.mood = "Defensive";  // mood-lock-cascade-prevention: only set on first fire
         } else if (response.moodHint !== null && t.moodLockUntilTick <= state.tick) {
           // Apply the LLM's mood hint ONLY when no faux-pas fired AND the
           // target is not currently mood-locked. This is the documented
           // "freshest mood value" update — within-tick conversation
           // resolution overrides the prior year-pass mood-drift roll.
           // Pure assignment, NO PRNG draws.
           t.mood = response.moodHint;
         }
       }
       // Affection — Map.set (NOT Map.get-as-lvalue).
       const affPrev = state.affectionMap.get(pairKey) ?? 0;
       state.affectionMap.set(pairKey, clamp(affPrev + outcome.affectionDelta, 0, 100));
       // Conversation history append + truncate.
       const hist = state.conversationHistory.get(pairKey) ?? [];
       const nextHist = [...hist, playerExchange, npcExchange].slice(-CONVERSATION_HISTORY_LIMIT_PER_PAIR);
       state.conversationHistory.set(pairKey, nextHist);
     });

     // Publish AFTER set returns (per bus-publishing discipline)
     conversationBus.publish({
       kind: "ConversationResolved",
       tick: stateBefore.tick,
       pairKey,
       classifiedTactic: response.classifiedTactic,
       affectionDelta: outcome.affectionDelta,
       composureDelta: outcome.composureDelta,
       synergy: outcome.kind === "Normal" ? outcome.synergy : false,
       moodHint: response.moodHint,
     });
     if (fauxPasFired) {
       conversationBus.publish({
         kind: "FauxPasFired",
         tick: stateBefore.tick,
         targetCharacterId: targetId,
         lockUntilTick: stateBefore.tick + FAUX_PAS_LOCK_DURATION_IN_TICKS,
         wasAlreadyLocked,
       });
     }
     return { ok: true, outcome: result };
     ```
   - **`clamp` helper home pin.** `clamp(value, min, max)` — a generic 3-arg numeric clamp — is needed by both rules and store-actions. Pin it at `src/game/util/clamp.ts` (a NEW file inside the existing `src/game/util/` folder; the `game-util` ESLint element already permits imports from `game-rules` and other layers). Mirrors the existing `src/game/util/lookups.ts` precedent (`getHouseOrThrow`, etc.). Rule files (`combat.ts`, `aging.ts` for the prune's clamp-during-affection-mutation, etc.) import from `game-util`; store actions import from the same path via the runtime/store-→ ui import paths.
   - Publish `ConversationResolved` event with the resolved deltas.
   - If `outcome.kind === "InstantFail"` (faux-pas), ALSO publish `FauxPasFired` carrying `wasAlreadyLocked` (so the chat-log renders distinct prose).
5. On `Failed`:
   - State unchanged. Publish `ConversationFailed { reason }`.

**Immer Map mutation precondition.** `src/game/store.ts:45` already calls `enableMapSet()` (from P0). Without that call, Immer would silently no-op on Map-value mutations. The pattern `state.characters.get(targetId).composure = ...` and `state.affectionMap.set(pairKey, ...)` both rely on this; document inline at the mutation-site comment so future readers don't strip the call.

**Affection clamping is at the mutation site** (CLAUDE.md non-negotiable §6). The combat resolver's `affectionDelta` is the COMPUTED delta (uncapped — math can produce a value larger than 100); the clamp to `[0, 100]` happens when the delta is applied to the pair-keyed affection value. The combat resolver intentionally does NOT clamp its output because the same delta may apply against different starting values, and the clamp is mutation-site-specific. Test fixture: combat outcome with affectionDelta=120 applied against pair with previous value 50 → post-mutation value is `clamp(50 + 120, 0, 100) = 100`, NOT `clamp(120, 0, 100) + 50 = 200`.

**`enterBallroom`** — opens a session. P4 has no patroness-veto gate (P8); the only rejection at P4 is "wrong location" (player must be at `Capital`). Returns a session ID that subsequent `sendBallroomMessage` calls reference.

```ts
// Session state lives ON the conversationOrchestrator class (NOT in the Zustand
// store; sessionId is ephemeral — not save-relevant). The orchestrator exposes
// these session methods (alongside .send and .abortCurrent):
//   beginSession(tick: number): BallSessionId   — idempotent within-tick; returns existing if tickAtEntry == tick
//   endSession(): BallSessionId | null          — clears state and returns the closed sessionId
//   currentSessionId(): BallSessionId | null    — read-only accessor

enterBallroom: () => {
  const state = get();
  const player = state.houses.get(PLAYER_HOUSE_ID);
  if (player === undefined || player.currentLocation !== "Capital") {
    return { ok: false, reason: { kind: "WrongLocation", current: player?.currentLocation ?? "Capital" } as const };
  }
  const sessionId = conversationOrchestrator.beginSession(state.tick);
  conversationBus.publish({
    kind: "BallroomEntered",
    tick: state.tick,
    houseId: PLAYER_HOUSE_ID,
    sessionId,
  });
  return { ok: true, sessionId };
},
```

**Orchestrator session methods** — these methods live INSIDE the `ConversationOrchestrator` class body shown above (NOT in a separate class or module). Add them alongside `send()` and `abortCurrent()`, before the closing brace. The class scope already covers them:
```ts
// Added to ConversationOrchestrator class body (alongside send / abortCurrent):
private currentSession: { sessionId: BallSessionId; tickAtEntry: number } | null = null;

beginSession(tick: number): BallSessionId {
  // P4 disallows concurrent sessions. Re-entering within the same tick
  // returns the existing sessionId (idempotent); a new tick replaces.
  if (this.currentSession !== null && this.currentSession.tickAtEntry === tick) {
    return this.currentSession.sessionId;
  }
  const sessionId = makeBallSessionId(tick);
  this.currentSession = { sessionId, tickAtEntry: tick };
  return sessionId;
}

endSession(): BallSessionId | null {
  const id = this.currentSession?.sessionId ?? null;
  this.currentSession = null;
  return id;
}

currentSessionId(): BallSessionId | null {
  return this.currentSession?.sessionId ?? null;
}
```

**`BallroomMessageInput` declaration** (lives in `src/game/store.ts` alongside the action types):
```ts
// src/game/store.ts — P4 additions to the action surface
export type BallroomMessageInput = {
  targetCharacterId: CharacterId;
  pinnedTactic: Tactic | null;
  stance: Stance;
  freeformMessage: string;
};
```
The `sendBallroomMessage` snippet above references this type plus several others; the full `src/game/store.ts` import additions for the P4 action bodies:
```ts
// Added to src/game/store.ts (alongside the existing P3 imports):
import { conversationOrchestrator } from "../runtime/conversationOrchestrator";
import type { ConversationOutcome } from "../runtime/conversationOrchestrator";
import { conversationBus } from "../runtime/events/conversation";
import type { ConversationFailure } from "./conversation/types";
import { makePairKey } from "./conversation/types";
import type { Exchange } from "./conversation/types";
import { resolveCombat } from "./rules/combat";
import { clamp } from "./util/clamp";
import { type BallSessionId } from "./rng";
import {
  CONVERSATION_HISTORY_LIMIT_PER_PAIR,
  FAUX_PAS_LOCK_DURATION_IN_TICKS,
  type Tactic,
  type Stance,
} from "./constants";
import { buildPersonaPrompt } from "../llm/prompts/persona";
import { routeModel } from "../llm/routing";
// BallEntryRejection ships from runtime/events/conversation.ts; since game/store.ts
// is in the game-store ESLint element, importing from runtime/events is permitted
// by default (runtime is in the default-allow tier).
import type { BallEntryRejection } from "../runtime/events/conversation";
```

**`exitBallroom`** — commits session player composure to the CURRENT head-of-house; closes the session; publishes `BallroomExited`.

```ts
exitBallroom: (playerComposureAtExit: number) => {
  const sessionId = conversationOrchestrator.currentSessionId();
  if (sessionId === null) return;  // no-op if not in a session
  // Abort any in-flight conversation before committing composure (per
  // "In-flight request handling on exit" above).
  conversationOrchestrator.abortCurrent();
  const stateBefore = get();
  // Re-fetch playerHeadId at commit time — defense-in-depth against
  // future async-tick triggers (within-tick ball session shouldn't see
  // succession at P4, but the re-fetch costs nothing).
  const playerHeadId = stateBefore.houses.get(PLAYER_HOUSE_ID)?.headOfHouseCharacterId;
  set((state) => {
    if (playerHeadId === undefined) return;  // defensive — bootstrap invariant says head exists
    const head = state.characters.get(playerHeadId);
    if (head === undefined) return;
    head.composure = clamp(playerComposureAtExit, 0, head.maxComposure);
  });
  conversationOrchestrator.endSession();  // clears currentSession after commit
  conversationBus.publish({
    kind: "BallroomExited",
    tick: stateBefore.tick,
    houseId: PLAYER_HOUSE_ID,
    sessionId,
    finalPlayerComposure: playerComposureAtExit,
  });
},
```

**`playerHeadId` re-fetch at exit.** The session opens by capturing `playerHeadId` at `enterBallroom` time. **At `exitBallroom`, the head ID is re-fetched** from `state.houses.get(PLAYER_HOUSE_ID).headOfHouseCharacterId` (NOT the captured value). If a year-pass during the ball session triggered succession (the spec doesn't currently allow this — tick advance is player-elected and ball sessions are within-tick — but a defensive re-fetch costs nothing and prevents a stale-id bug if a future phase introduces async tick triggers). If the re-fetched head differs from the captured head, the commit goes to the NEW head; the session composure was tracked by the player's HOUSE, not by the specific character, so the heir inherits the composure value naturally.

**Defense-in-depth:** the orchestrator's per-request `requestId` discipline catches the more dangerous case (in-flight request resolves AFTER succession). Plan §"`sendBallroomMessage`" already pins the resolved exchange writing to `makePairKey(PLAYER_HOUSE_ID, targetId)` — `PLAYER_HOUSE_ID` is a constant, so the pair key is succession-stable.

**In-flight request handling on exit.** If a conversation request is in-flight when `exitBallroom` is called:
1. The orchestrator's `abortCurrent()` is called BEFORE composure is committed.
2. The in-flight request's response (if it eventually arrives) is discarded — the requestId check fails on resolve.
3. The composure value committed is the SESSION composure at the moment of exit — i.e., the composure as it stood BEFORE the in-flight request was sent. The in-flight request had not yet applied any delta (deltas only apply on `Done`, not on `Sending` / `Resolving`).
4. The conversation history is NOT extended for the in-flight request (history append only fires on `Done`).
5. The affection map is NOT modified for the in-flight request (same reason).
- **Why exit is instantaneous (not "wait for in-flight to settle"):** the four failure paths' "do NOT advance tick / do NOT mutate state" contract already means an unresolved request has no game-state cost. Treating exit as a forced abort is a fifth path that shares this contract. The player's intuition — "leaving the room cancels what I was saying" — matches the engineering shape.

**`abortBallroomRequest`** — cancels the active conversation send without exiting the ballroom (a "user pressed cancel" button). Calls `orchestrator.abortCurrent()`. Identical state-mutation semantics to a network failure: no tick advance, no history append, no affection mutation, no composure mutation. Publishes `ConversationFailed { reason: "cancelled" }` (the fifth `ConversationFailure` reason — see "Canonical types table" above). **Four-failure-paths test contract is preserved:** the four documented "do NOT advance / do NOT mutate" failure-path tests (timeout/network/schema/missing-key) all still cover their respective triggers; the `cancelled` reason is an explicit fifth reason for user-initiated abort + view-exit, observationally distinct from the four network/SDK paths. Future subscribers (e.g., a retry-on-network-fail UX) can distinguish cancel from genuine failure.

---

## `src/runtime/events/conversation.ts`

```ts
import type { BallSessionId, CharacterId, HouseId } from "../../game/rng";
import type { LocationId } from "../../game/fixtures/locations";
import type { ConversationPairKey } from "../../game/conversation/types";
import type { Tactic, Stance } from "../../game/constants";  // Tactic/Stance live in constants.ts (canonical types table)
import type { Mood } from "../../game/fixtures/moods";
import { EventBus } from "./bus";

// ConversationFailure lives in src/game/conversation/types.ts (shared module).
// The events module both IMPORTS the type for local use in ConversationEvent
// AND re-exports it so consumers have a single import surface.
import type { ConversationFailure } from "../../game/conversation/types";
export type { ConversationFailure };

// BallEntryRejection — the typed-discriminated-union returned by enterBallroom
// when validation fails. At P4 the only variant is WrongLocation; P8 will add
// PatronessVeto as a second variant once patronesses ship.
export type BallEntryRejection =
  | { kind: "WrongLocation"; current: LocationId };

export type ConversationEvent =
  | { kind: "ConversationSent"; tick: number; pairKey: ConversationPairKey; tactic: Tactic | null; stance: Stance }
  | {
      kind: "ConversationResolved";
      tick: number;
      pairKey: ConversationPairKey;
      classifiedTactic: Tactic;
      affectionDelta: number;
      composureDelta: number;
      synergy: boolean;             // P6's whisper-generation hook subscribes to this
      moodHint: Mood | null;
    }
  | { kind: "ConversationFailed"; tick: number; pairKey: ConversationPairKey; failure: ConversationFailure }
  | { kind: "FauxPasFired"; tick: number; targetCharacterId: CharacterId; lockUntilTick: number; wasAlreadyLocked: boolean }
  | { kind: "BallroomEntered"; tick: number; houseId: HouseId; sessionId: BallSessionId }
  | { kind: "BallroomExited"; tick: number; houseId: HouseId; sessionId: BallSessionId; finalPlayerComposure: number }
  | { kind: "TargetCharacterDied"; tick: number; targetCharacterId: CharacterId };  // published from the runYearPass store-action wrapper (NOT from aging.ts); PersonaCacheRegistry subscribes

export const conversationBus = new EventBus<ConversationEvent>();
```

**Publishing discipline:**
- `ConversationSent`: published from `store.sendBallroomMessage` BEFORE awaiting the LLM. Captures the pinned intent + stance the player chose.
- `ConversationResolved` / `ConversationFailed`: published from `store.sendBallroomMessage` AFTER the orchestrator returns. NEVER published from inside the orchestrator's send body (the orchestrator returns, the store action then publishes — matches P3's bus discipline).
- `FauxPasFired` / `BallroomEntered` / `BallroomExited`: published from their respective store actions.

**`wasAlreadyLocked`** on `FauxPasFired`: surfaces the §7 mood-lock-cascade-prevention case. If `true`, the lock was extended but no `MoodChanged` event fired. Subscribers (the chat-log UI) render different prose for the two cases.

---

## Ballroom UI (`src/ui/ballroom/`)

NEW directory. The ballroom is a sibling surface to the strategy map; entry is via a button on the `LocationDetailsPanel` when the player is at `Capital`.

**Components:**

- **`BallroomView.tsx`** — top-level. Holds the session-local state: player composure (initialized from `state.characters.get(playerHeadId).composure` on entry), selected target character ID, pinned tactic, current stance. Subscribes to `conversationBus` for the chat-log render.
- **`PortraitRing.tsx`** — CSS grid placing 5 portrait cards in a ring. Each `<PortraitCard />` shows the NPC's name, current mood (visible — at P4 moods are NOT hidden per spec design intent), and a click target. Selection sets `selectedTargetId` in the parent.
- **`PortraitCard.tsx`** — single portrait. Tailwind-styled placeholder art at P4 (P16 polish iterates).
- **`TacticButtons.tsx`** — 4 buttons (Flattery / WittyBanter / SlyGossip / DeepEmpathy). Each click both pins the intent AND prefills the message input with a designer-authored prompt (e.g., Flattery prefill: "I must say, you look radiant tonight.").
- **`StanceToggle.tsx`** — 3 buttons (Wallflower / Mingle / TargetedPursuit). Mutually exclusive; default Mingle.
- **`MessageInput.tsx`** — text input + Send button. Disabled while `Sending` / `Resolving`. On Send: reads the key via `useContext(KeyContext)` and calls `store.sendBallroomMessage({ targetCharacterId: selectedTargetId, pinnedTactic, stance, freeformMessage }, key)`. Field name is `targetCharacterId` (matches `BallroomMessageInput`), not the local `selectedTargetId` shorthand — explicit `key: value` form. If the key context yields `null`, the button is disabled (mirroring the `MissingKeyBanner` discipline).
- **`ChatLog.tsx`** — renders the 3-most-recent exchange history for the currently selected `(playerHouseId, targetId)` pair. Reads from `state.conversationHistory.get(pairKey)`.
- **`ComposureBar.tsx`** — visual indicator of session player composure (`[0, maxComposure]`). Reflects post-resolution session composure.
- **`ThinkingIndicator.tsx`** — single-shot "..." dot during `Sending` / `Resolving`. Per Resolved decision #15, no token-by-token streaming.
- **`ConversationFailureBanner.tsx`** — banner that mounts when a `ConversationFailed` event fires; shows the failure reason in user-readable prose ("The conversation took too long." / "We couldn't reach the dialogue service." / "The dialogue service returned an unexpected response." / "No API key configured — see settings."). Auto-dismissable.
- **`MissingKeyBanner.tsx`** — sticky banner at `<TopBar />`-adjacent location that reads `useContext(KeyContext)` and shows when the key is null or empty. Disables only the `<MessageInput />` send button, NOT the rest of the ballroom (player can still browse history, change stance, etc.).

**BYOK key UX** — `src/ui/shared/KeyEntryPanel.tsx` (new). Inside the `<SettingsMenu />`, a panel with a password-masked input for the Gemini API key (label: "Google AI Studio API key"). On save: stored in a React context (`KeyContext`) holding the key in a `useState`. **NEVER persists** — no `sessionStorage`, no `localStorage`, no `IndexedDB`. **Module-singleton orchestrator → React context seam:** the orchestrator (module-level singleton, not a React component) cannot call `useContext` directly. Instead, the `sendBallroomMessage` store action reads the key from `KeyContext` via a tiny accessor function — defined in the App root provider — that returns the current key value or `null`. The store action then passes the key (along with the request and the target Character) as parameters into `conversationOrchestrator.send(request, apiKey, target)`. The orchestrator constructs a fresh `LlmClient` per request (cheap — just wraps the SDK constructor) so a key change between calls takes effect on the next call without orchestrator re-initialization. Page refresh = key lost = re-enter. Documented in the UI prose.

**The `MissingKeyBanner.tsx`** reads from the `KeyContext` via `useContext(KeyContext)` (NOT from `state.byokKey` — the key never lives in the Zustand store per the BYOK rule above).

**Why React context (not Zustand store)** for the key: Zustand state is shared across the whole app; the key isn't game state — it's an auth credential per spec §6. Holding it in a tiny React context (with a single provider at App root) keeps it out of `selectGameState` and therefore out of the save serialization path. The context's value is `{ key: string | null, setKey: (k: string) => void, clearKey: () => void }`.

**Why not Zustand state with explicit exclusion from `selectGameState`:** that would force the trip-wire test (`schema-projection-selector-extension.test.ts`) to special-case the key. Keeping the key outside the store keeps the trip-wire invariant simple.

---

## Tick semantics in the ballroom

**Decision: a ballroom session is WITHIN-tick.** No conversation exchange advances `state.tick`. Multiple exchanges happen within a single tick. Tick advancement is the player's choice via the "stay another tick" / "leave ballroom and stay another tick" affordance.

**Why within-tick:**
- (a) Spec §3 line 65 ("Conversational Ballroom") describes the ring as a venue; it doesn't say each exchange consumes a tick. Spec §3 line 48 ("Tick-Driven Time Advancement") describes ticks as discrete world-state advances; conversations are continuous within a venue.
- (b) Within-tick conversations let the player explore multiple NPCs at a ball without aging the world between every dialogue exchange.
- (c) Mood-drift fires at tick boundaries (15% reroll). If every exchange advanced a tick, moods would shuffle mid-ball — breaking the player's ability to read the room.

**At ball exit**, the player can elect to advance the tick via the existing "Stay here a year" affordance (in `LocationDetailsPanel`). The ballroom doesn't auto-advance — exit is exit-without-tick-advance.

**Mood lock applies immediately** on faux-pas (target's `moodLockUntilTick` set to `state.tick + 5`). Since the tick doesn't advance during the session, locked targets remain `Defensive` for 5 future ticks — the same semantic as outside the ballroom.

**`MoodChanged` event — vacuity at P4.** The mood-lock-cascade-prevention test (per Verification) asserts that a second faux-pas on a locked-Defensive target does NOT publish a `MoodChanged` event. **At P4 there is no `MoodChanged` event variant** — the conversation event union (lines above) carries `FauxPasFired`, `ConversationResolved`, etc., but not `MoodChanged`. The mood-drift rule at P1 mutates `Character.mood` without emitting an event (P1's mood-drift is silent). **So the test assertion at P4 is structurally vacuous** (no such event can fire) — the test still ships as a guard against a future phase introducing a `MoodChanged` event that fires from mood-drift OR `moodHint` application. Document this inline in the test: "At P4 this assertion is vacuous; reserved as a guard for future phases."

---

## ESLint boundary edits

**Three coordinated edits in `eslint.config.js`:**

1. **Add `game-conversation-types` folder element** (new):
   ```js
   { type: "game-conversation-types", pattern: "src/game/conversation", mode: "folder" },
   ```
   Placed in the elements array BEFORE `game-other` so first-match-wins.

2. **Extend `game-rules` allow list** to include `game-conversation-types`:
   ```js
   from: ["game-rules"],
   allow: [
     "game-rules", "game-constants", "game-fixtures", "game-rng",
     "game-entities", "game-util",
     "game-conversation-types",  // P4 — for pair-key parsing in aging.ts orphan prune
   ],
   ```

3. **Add explicit `llm` boundary rule** restricting `llm` imports:
   ```js
   {
     from: ["llm"],
     // llm/** is forbidden from importing the rules, store, persist, ui layers.
     // It MAY import game-conversation-types (the shared pair-key shape) and
     // game-constants (model IDs, budgets), and other llm files.
     disallow: ["game-rules", "game-rng", "game-store", "game-hash", "game-bootstrap", "persist", "ui", "runtime", "runtime-tick-orchestrator"],
     message: "src/llm/** must not import gameplay state — route through the orchestrator (rule c)",
   },
   ```
   The orchestrator imports both `llm` and `game-rules` (it's the bridge); the boundary rule allows `runtime → llm` and `runtime → game-rules` by default.

**Boundary-rule test extension at `eslint/boundaries.test.ts`** — add synthetic source-string fixtures (per CLAUDE.md "Boundary-rule tests use `ESLint.lintText`"):
- `llm/foo.ts` importing `game/rules/combat` → error.
- `llm/foo.ts` importing `game/conversation/types` → allowed.
- `game/rules/aging.ts` importing `game/conversation/types` (`parsePairKey`) → allowed.
- `game/rules/aging.ts` importing `src/llm/types` → error.

---

## Mandatory Context7 lookups

P4 introduces the first SDK that has a network surface AND a function-calling API contract. **The lookups below MUST be performed BEFORE writing the first line of `src/llm/client.ts`, `src/llm/cache.ts`, or `src/game/machines/conversation.ts`** — not opportunistically during implementation, not after a typecheck failure. The plan's code snippets are illustrative; the SDK and XState surfaces evolve, and the Context7 lookup is the source of truth.

- **`@google/genai`** — `GoogleGenAI({ apiKey })` constructor; `ai.models.generateContent({...})` signature; `ai.caches.create({...})` signature + `CachedContent` shape; `config.cachedContent` consumption pattern for cache-hit calls; `config.toolConfig.functionCallingConfig.mode` enum (`AUTO` / `ANY` / `NONE`); `tools: [{ functionDeclarations: [...] }]` shape with `parametersJsonSchema`; `response.functionCalls?.[0].args` accessor for the forced-call result; `config.abortSignal` integration; `config.maxOutputTokens` budget; usage-metadata fields on the response for cache-hit verification.
- **Live model identifiers** — verify `gemini-3.5-flash` and `gemini-3.1-pro-preview` are valid against the Gemini API model list AT THE TIME OF P4 IMPLEMENTATION. The pins in `constants.ts` are the canonical reference; if the model API surface shifts (e.g., a `gemini-3.5-flash-001` date-stamped form becomes preferred for determinism), update both the constant and this plan in the same commit.
- **Gemini caching contract** — confirm `caches.create` returns a `CachedContent` resource with a `name` field; confirm subsequent `generateContent` calls pass the name via `config.cachedContent` (NOT `config.systemInstruction` — the two are mutually exclusive); confirm the TTL string format (`"3600s"` not `"1h"`); confirm cache-hit billing is reflected in the response's `usageMetadata`.
- **XState v5** — `setup()` + `createMachine()` form; actor refs (`createActor`); `subscribe()` for React integration; `getSnapshot()` for state reads. P0 listed XState in the stack; P4 is the first user. The plan's machine snippet uses `setup({ types: {} as { ... } }).createMachine({ ... })` — this is a v5-RC form that may have shifted in the released v5 surface. Look it up before writing.
- **Vitest `vi.mock` + `__mocks__/` auto-discovery semantics** — verify the repo-root `__mocks__/<package>` path is correct for npm-package mocks; verify a bare `vi.mock("@google/genai")` activates the default mock without a factory.

Mirrors P0's "Mandatory Context7 lookups" framing for Tailwind v4 + seedrandom.

---

## Test strategy

**Pure-rule tests** (`src/game/rules/combat.test.ts`): ~100% coverage of the combat math. Synthetic states; no mocking needed.

**Pair-key tests** (`src/game/conversation/types.test.ts`): round-trip `makePairKey` ↔ `parsePairKey`; schema parse of valid + invalid forms.

**Orchestrator tests** (`src/runtime/conversationOrchestrator.test.ts`): mock the Gemini SDK via `vi.mock("@google/genai")`; per failure path, assert state immutability + correct event publication.

**Save round-trip tests** (`src/persist/save-roundtrip.test.ts` extended): a fresh state with seeded conversation history → save → load → assert identical hash. A heir-promotion scenario: pending conversation history under `(houseId, oldHeadId)` survives across `runYearPass`-triggered succession (history is keyed on `houseId`, NOT actor).

**Cache-hit verification** (Verification claim from spec §8): pin as a **dev-mode manual check**, not an automated CI test. The orchestrator logs the response's `usageMetadata` (specifically `cachedContentTokenCount` per Gemini's metadata shape) at debug level on every response; the developer manually inspects the log on the second turn against the same NPC and confirms the cached-token count is non-zero. **Why manual:** automated cache-hit testing requires a real Gemini API call (the SDK mock cannot simulate Gemini's cache state), which violates the offline-deterministic test contract. The dev-mode log is sufficient evidence for the merge gate. Note that Gemini's caching has a `caches.create` step that the dev can also inspect via the Gemini console.

**Replay-harness extension**: the existing `src/game/replay-harness.test.ts` runs 30 identical-seed campaigns. P4 adds a conversation-history dimension: each campaign runs the SAME sequence of mocked LLM responses (the mock's response sequence is deterministic given the seed); the 30 final-state hashes must remain identical. **The LLM mock IS in the replay harness's contract** — without it, conversations can't fire; with it, the mock's deterministic sequence is part of the replay seed.

**§7 edge case tests:**
- **Mid-conversation view exit**: open ballroom → send message (mock pending) → call `exitBallroom` → assert orchestrator's `currentRequestId` increments and the pending request's resolve is no-op.
- **Heir promotion mid-conversation**: open ballroom → send message (mock pending) → trigger succession via aging cascade → assert post-succession conversation history under `(houseId, npcId)` carries the pre-resolution exchange (when the response arrives, it routes to the SAME pair key, which is now associated with the new heir's character ID via the player house).
- **Mood-lock cascade prevention**: faux-pas on a target who is already locked-Defensive → assert `wasAlreadyLocked: true` in the `FauxPasFired` event and NO `MoodChanged` event fires.
- **Conversation history orphan keys**: kill an NPC via the aging cascade → assert their conversation history entries are pruned.

**Test fixtures (`src/game/__test-utils__/ballroomFixtures.ts`)** — NEW. Mirrors P3's `playerLocationFixtures.ts` pattern:
- `mockConversationResponse(overrides?)` — builds a valid `ConversationResponse` for orchestrator tests.
- `makeBallroomState(opts?)` — synthetic GameState with the player at Capital, 5 baseline NPCs alive, and (optionally) seeded conversation history.
- `mockGeminiClient({ behavior: "ok" | "timeout" | "network" | "schema" })` — preset SDK mock for each failure path.

---

## Phase-order discipline

The conversation orchestrator does NOT add a new tick-orchestrator phase. Conversation lifecycle is independent of the tick chain (per the within-tick decision above). The existing PHASES array is unchanged at P4.

The aging cascade DOES gain a step (conversation-history orphan prune) — but this is an extension of the death-cascade subroutine in `aging.ts`, not a new tick phase.

---

## CLAUDE.md additions (apply during /close-phase P4)

P4 introduces conventions that future phases inherit. Add to the project CLAUDE.md "Non-negotiable architectural rules" or "Coding conventions" section:

1. **Conversation-history pair key shape.** `type ConversationPairKey = \`${HouseId}|${CharacterId}\`` — branded stringified composite. Constructed via `makePairKey(houseId, characterId)` and parsed via `parsePairKey(key)`. Lives in `src/game/conversation/types.ts` so both the rules layer and the LLM layer can import it. **Both `state.conversationHistory` and `state.affectionMap` share this key shape**, so the orphan-prune cascade walks both collections in a single filter pass.
2. **LLM-layer determinism boundary.** `src/llm/**` MUST NOT import `src/game/rng.ts`, any file in `src/game/rules/**`, `src/game/store.ts`, or `src/persist/**`. The LLM layer is the only non-deterministic subsystem; routing its output through the orchestrator (which calls rules) is the only legal path. Enforced by `eslint-plugin-boundaries` rule (c).
3. **AbortController + requestId discipline.** Every conversation round-trip uses a `requestId: number` threaded through the request lifecycle. Post-await mutations check `if (requestId !== orchestrator.currentRequestId) return;` before committing. The orchestrator owns the requestId; React surfaces never hold one. CLAUDE.md non-negotiable §7 extended with this exact phrasing.
4. **BYOK key storage rule.** Gemini API keys live ONLY in a React context (`KeyContext`) for the lifetime of the page session. NEVER in `sessionStorage`, NEVER in `localStorage`, NEVER in IndexedDB, NEVER in the Zustand store. Page refresh = key cleared = user re-enters. Documented behavior; not a bug.
5. **`respond` function-declaration location.** The `respond` FunctionDeclaration's `parametersJsonSchema` lives in `src/llm/tools.ts`. P6 widens this by adding the `generateWhisper` FunctionDeclaration alongside `respond` in the same `functionDeclarations` array; `toolConfig.functionCallingConfig.allowedFunctionNames` selects which is forced per request.
6. **Gemini context-cache discipline.** Per-character persona blocks are cached via `ai.caches.create({ model, config: { systemInstruction, ttl: PERSONA_CACHE_TTL_SECONDS } })` ONCE per `(target, model)` pair; subsequent `generateContent` calls reference the cache via `config.cachedContent: cache.name`. The `config.systemInstruction` and `config.cachedContent` options are MUTUALLY EXCLUSIVE — on cache-hit, omit systemInstruction; on cache-miss / failure, pass systemInstruction directly. Dynamic suffixes (recency window + player message) go in `contents`, NOT cached. Cache-hit verification is a dev-mode manual check via the SDK's response `usageMetadata` (cache-hit reduces input token count).
7. **Within-tick ballroom session.** A ballroom session is within-tick; no exchange advances `state.tick`. Ball entry/exit and tick advancement are separate triggers (like P1's year-pass vs tick-advance distinction).
8. **Defensive widen-and-validate for model-controlled enum fields.** LLM response schemas widen `classifiedTactic` and `moodHint` to `z.string()` at parse time; enum membership is checked in post-parse resolver functions (`resolveTactic` / `resolveMoodHint`). Unknown values fall back to a pinned default (or `null` for `moodHint`) rather than triggering a schema failure. Schema-failure path is reserved for missing required fields, malformed JSON, or empty `dialogue`.
9. **Affection clamping at mutation site, not at math layer.** The combat resolver returns the raw (uncapped) `affectionDelta`; the clamp to `[0, 100]` is applied where the delta meets the persisted affection value (typically `state.affectionMap.set(pairKey, clamp(prev + delta, 0, 100))`). This pattern lets the same delta apply against different starting values correctly.
10. **Vitest mock-SDK pattern.** External-network SDKs (npm packages) are mocked via `<repo-root>/__mocks__/<package-name>.ts` files auto-discovered by `vi.mock("<package-name>")` (NO factory). Vitest's `__mocks__` auto-discovery for npm packages uses the project-root `__mocks__/` directory; nested `src/**/__mocks__/` does NOT auto-discover for package mocks. Per-test factory overrides use `vi.mock("<package-name>", () => ({...}))` inside the test file, which shadows the default for that file's scope only. Replay-harness tests inherit the default deterministic mock via a bare `vi.mock(...)` call.

---

## Rollback

**Pre-merge revert** (trivial): `git revert <P4 commit>` restores SaveV4 as current. Tests pass; no IndexedDB compatibility issue (in-flight data was SaveV4 anyway).

**Post-merge IndexedDB state where v5 saves exist** (non-trivial):
- A v5 save in IndexedDB cannot be auto-rolled back to v4 because the v5 → v4 reverse migration would discard `conversationHistory` and the new `Character` fields (lossy).
- **Rollback strategy:** if a P4 hotfix-revert is needed, ship a one-time "downgrade dialog" in the prior version's UI that detects v5 saves at load time (`version > SAVE_VERSION_CURRENT` already throws `SaveVersionTooNewError`) and offers the user a "start new game" path. No silent data destruction.
- **Alternative:** ship the reverse migration `migrate_v5_to_v4` as a documented one-way escape hatch alongside P4 — used only in the rollback emergency. P4 does NOT ship the reverse migration in the regular migration runner.

**Files needing revert in a hotfix-revert scenario:**
- `src/persist/schema.ts` (SaveV5 schema + `SAVE_VERSION_CURRENT` bump + lifter updates)
- `src/persist/dexie.ts` (load return type + final-parse callsite)
- `src/persist/migrations/v4-to-v5.ts` (delete)
- `src/persist/migrations/index.ts` (unregister)
- `src/game/entities.ts` (GameState + Character schema edits)
- `src/game/hash.ts` (projection extension)
- `src/game/store.ts` (selector + overwriteFromGameState + new actions)
- `src/game/bootstrap.ts` (NPC seeding revert)
- `src/game/rules/combat.ts` (delete)
- `src/game/rules/aging.ts` (orphan-prune revert)
- `src/game/conversation/types.ts` (delete)
- `src/llm/**` (delete entire directory)
- `src/runtime/conversationOrchestrator.ts` (delete)
- `src/runtime/events/conversation.ts` (delete)
- `src/ui/ballroom/**` (delete entire directory)
- `src/ui/shared/KeyEntryPanel.tsx` (delete)
- `eslint.config.js` (boundary edits revert)
- `src/game/constants.ts` (P4 constants revert)
- Tests under each of the above paths

---

## Atomic commit — explicit step order

P4 ships as a single atomic commit (the typecheck has no green midpoint between the schema add and the dexie/load cutover) — but within that commit, the implementer follows a precise step order so each intermediate step is typecheck-clean inside the working tree. The grouping below pins the order:

1. **Foundation (no boundary impact; typecheck-clean as a standalone step):**
   - Add `INDEPENDENT_HOUSE_ID` to `src/game/rng.ts`.
   - Add `BallSessionId` branded type + `makeBallSessionId(tick)` helper to `src/game/rng.ts`.
   - Create `src/game/conversation/types.ts` (canonical `ConversationPairKey` + `Exchange` + `ConversationFailure` exports).
   - Create `src/game/fixtures/npcs.ts` (the BASELINE_NPCS registry).
   - Create `src/game/util/clamp.ts` (the generic 3-arg numeric clamp helper used by combat resolver, aging orphan-prune affection clamp, and the sendBallroomMessage set body).
   - Add P4 constants to `src/game/constants.ts` (COMBAT_*, STANCE_*, TACTICS, STANCES, TACTIC_BONUS_MOOD, CONVERSATION_TRAIT_BONUSES, CONVERSATION_TRAIT_PENALTIES, FAUX_PAS_LOCK_DURATION_IN_TICKS, QUALITY_MULTIPLIER_*, LLM_*, MODEL_*, CONVERSATION_HISTORY_LIMIT_PER_PAIR, COMPOSURE_DEFAULT, BYOK_KEY_SHAPE_REGEX, PERSONA_CACHE_TTL_SECONDS, PERSONA_CACHE_DISPLAY_NAME_PREFIX). Export `Tactic` / `Stance` types from constants.ts.
   - Add the `game-conversation-types` element + extended `game-rules` allow list to `eslint.config.js`.
   - **At this point: `pnpm test`, `pnpm lint`, `pnpm typecheck` all pass.** The new exports are unconsumed.

2. **Schema extension:**
   - Extend `CharacterSchema` in `src/game/entities.ts` with `composure` + `maxComposure`.
   - Extend `GameStateSchema` in `src/game/entities.ts` with `conversationHistory` + `affectionMap`.
   - **At this point: `pnpm typecheck` FAILS at every existing constructor / lifter / mutator that builds a `GameState` or `Character` — by design.** Specifically failing call sites: `createInitialState` (`src/game/store.ts`); `seedStartingFamily` (`src/game/bootstrap.ts`); `hashableState` (`src/game/hash.ts`); `selectGameState` (`src/game/store.ts`); `overwriteFromGameState` (`src/game/store.ts`); `fromSaveV1` / `fromSaveV2` / `fromSaveV3` / `fromSaveV4` (`src/persist/schema.ts`); the `migrate_v1_to_v2.ts` consumer; the test fixture builders. The remaining steps fix each callsite.

3. **Constructor + projection + selector + migration updates** (all read from the schema; all must update in one cluster to restore typecheck-cleanness):
   - Extend `seedStartingFamily` in `src/game/bootstrap.ts` — return shape goes from `{ rngState, house, character }` to `{ rngState, houses, characters }` (per "Consumer fanout" above).
   - Update `src/persist/migrations/v1-to-v2.ts` to consume the new return shape (spread `seeded.houses.map(...)` and `seeded.characters.map(...)` into the SaveV2 tuple arrays).
   - Update `createInitialState` in `src/game/store.ts` to iterate the new arrays into Maps.
   - Add `composure: 100, maxComposure: 100` to the bootstrap-time Character build inside `seedStartingFamily`.
   - Extend `hashableState` in `src/game/hash.ts` with the 2 new GameState fields.
   - Extend `selectGameState` in `src/game/store.ts` with the 2 new GameState fields.
   - Extend `overwriteFromGameState` in `src/game/store.ts` with the 2 new GameState fields.
   - **At this point: `pnpm typecheck` is clean again.** Test outcomes:
     - `bootstrap.test.ts` FAILS on the 8+ `seeded.house.*` / `seeded.character.*` singular-property-access usages (the new return shape is plural arrays) — fixed in step 4. **callCount stays at 1** (NPCs are constants, no draws). The test's hardcoded player-head-deathAge value remains correct (parity invariant preserved).
     - `v1-to-v3-chain.test.ts` FAILS on the hashState-parity assertion at `:42-43` — fresh `createInitialState` has 2 houses but `fromSaveV3(v3)` has 1. Fixed in step 4 (drop the parity assertion; keep the campaignName check).
     - `v1-to-v4-chain.test.ts` FAILS on (a) positional `houses[0]` lookup (`:34`) AND (b) hashState-parity assertion — same reason as v1-to-v3. Fixed in step 4 (find-by-id lookup + drop parity assertion).
     - `replay-harness.test.ts` FAILS only if it hardcodes hashes (it doesn't — assertions are derived); recompute is implicit.
     - All other tests pass.

4. **Test fixture recompute:**
   - `src/game/bootstrap.test.ts` — **callCount assertion stays at 1** (player head deathAge only — NPCs are constants). Add Independent-RNG assertion (`callCount === 0`). **In addition: every existing test that accesses `seeded.house.*` or `seeded.character.*` (singular property access) MUST migrate to the new plural form.** Per the iter-15 audit, the existing test file (verified at `src/game/bootstrap.test.ts:13-34`) carries 8+ such accesses (`seeded.house.id`, `seeded.character.deathAge`, `seeded.character.name`, `seeded.character.role`, etc.). Rewrite pattern: `seeded.houses.find((h) => h.id === PLAYER_HOUSE_ID)!.id` (or destructure: `const [playerHouse] = seeded.houses; playerHouse.id`). Same shape for the character accesses, using `STARTING_HEAD_CHARACTER_ID` as the find key. The audit grep: `rg "seeded\\.(house|character)\\." src/game/bootstrap.test.ts` enumerates every callsite at implementation time.
   - `src/persist/migrations/v1-to-v4-chain.test.ts` — change positional `houses[0]` lookup (at `:34`) to `find-by-id`. **Drop the hashState-parity assertion at `:42-43`** — that parity holds only at v5 (where the fresh state has Independent), NOT at v4 (where the migration chain stops before adding Independent). Keep the campaignName check + no-throw assertion. Full structural parity moves to `v1-to-v5-chain.test.ts`.
   - `src/persist/migrations/v1-to-v3-chain.test.ts` — **Drop the hashState-parity assertion** for the same reason. Keep only the campaignName check.
   - `src/game/replay-harness.test.ts` — rerun, accept new hashes (derived).
   - `src/persist/save-roundtrip.test.ts` — rerun, accept new hashes (derived).
   - `src/game/schema-projection-selector-extension.test.ts` — auto-passes because it iterates `Object.keys`.
   - `src/game/hashable-state-extension.test.ts` — same.
   - **At this point: existing test suite passes again.** Schema is live; SaveV5 not yet wired.

5. **Save-format SaveV5 ship:**
   - Refactor `CharacterPreV5Schema` in `src/persist/schema.ts` via `CharacterSchema.omit({...})`.
   - Route `SaveV2Schema.characters` / `SaveV3Schema.characters` / `SaveV4Schema.characters` through `CharacterPreV5Schema`.
   - Add `liftLegacyCharacters` + `defaultCharacterV5Fields` helpers.
   - Add `seedIndependentIntoLegacyState` helper (per the spec above — idempotent; seeds Independent house + 5 NPCs + Independent RNG into a `GameState`).
   - **Split each lifter into a Bare core + a public wrapper** per the canonical iter-4 pattern. The Bare cores (`fromSaveV1Bare`, `fromSaveV2Bare`, `fromSaveV3Bare`, `fromSaveV4Bare`) are PRIVATE to `schema.ts`; the public `fromSaveVN` wrappers compose Bare + `seedIndependentIntoLegacyState`. The Bare cores route `save.characters` through `liftLegacyCharacters` (where applicable) and default the two new GameState fields (`conversationHistory: new Map()`, `affectionMap: new Map()`). The public wrappers extract `playerSeed = save.rng.find(([id]) => id === PLAYER_HOUSE_ID)?.[1].seed` (find-by-id, NOT positional `save.rng[0]`) and call `seedIndependentIntoLegacyState(bare, playerSeed)` before returning.
   - Append `SaveV5Schema`, `toSaveV5`, `fromSaveV5` to `src/persist/schema.ts`.
   - Create `src/persist/migrations/v4-to-v5.ts` — calls `seedIndependentIntoLegacyState` via the deserialize-then-re-serialize pattern documented above.
   - Register the v4→v5 entry in `src/persist/migrations/index.ts`.
   - **Add `src/persist/migrations/v4-to-v5.idempotence.test.ts`** — uses `assertMigrationIdempotent(migrate_v4_to_v5, fixtureSaveV4)` per the existing `v2-to-v3.idempotence.test.ts` precedent (P2's `__test-utils__/idempotence.ts`). One file per migration; symmetric with the existing migration test layout.
   - **Add `src/persist/migrations/v4-to-v5.test.ts`** — asserts that `migrate_v4_to_v5`'s Independent construction is byte-identical to `seedStartingFamily`'s output for the same player seed. Explicit assertion shape:
     ```ts
     const seed = "test-seed";
     const v4 = /* construct a SaveV4 with one rng entry (player) and one player character */;
     const v5 = migrate_v4_to_v5(v4);
     const fresh = createInitialState(seed, DEFAULT_CAMPAIGN_NAME);
     // Byte-identity check at the Independent house level:
     const migratedIndependentHouse = v5.houses.find(([id]) => id === INDEPENDENT_HOUSE_ID)?.[1];
     const freshIndependentHouse = fresh.houses.get(INDEPENDENT_HOUSE_ID);
     expect(migratedIndependentHouse).toEqual(freshIndependentHouse);
     // Byte-identity check at each baseline NPC (loop variable renamed
     // from `seed` to avoid shadowing the outer test-seed binding):
     for (const npcSeed of BASELINE_NPCS) {
       const migrated = v5.characters.find(([id]) => id === npcSeed.id)?.[1];
       const freshChar = fresh.characters.get(npcSeed.id);
       expect(migrated).toEqual(freshChar);
     }
     // Independent RNG entry:
     const migratedIndRng = v5.rng.find(([id]) => id === INDEPENDENT_HOUSE_ID)?.[1];
     const freshIndRng = fresh.rng.get(INDEPENDENT_HOUSE_ID);
     expect(migratedIndRng).toEqual(freshIndRng);
     ```
     Closes R6 (cycle 2 iter 3) and R4 (cycle 2 iter 4) — explicit shape catches drift between migration and bootstrap Independent construction.
   - **Existing `v1-to-v2.parity.test.ts` and `v1-to-v2.callcount-passthrough.test.ts`** — these tests assert `hashState(fresh) === hashState(fromSaveV2(migrate_v1_to_v2(saveV1)))` and player-RNG callCount passthrough respectively. After P4, both sides have 2 houses + 5 NPCs + Independent RNG (because both `createInitialState` and `fromSaveV2` invoke `seedIndependentIntoLegacyState` to seed Independent). The tests pass UNCHANGED if and only if the helper's construction is byte-identical to `createInitialState`'s — this is the regression-bait gate for the helper's correctness. **List explicitly: no code change needed; passes are the contract.**

6. **Save-format cutover at dexie + UI:**
   - `src/persist/schema.ts:24` — `SAVE_VERSION_CURRENT = 5 as const`.
   - `src/persist/dexie.ts:19` — import `toSaveV5`; `:59` — `const data = toSaveV5(state)`.
   - `src/persist/dexie.ts:71` — return type to `Promise<SaveV5 | undefined>`.
   - `src/persist/dexie.ts:93` and `:101` — `SaveV4Schema.parse` → `SaveV5Schema.parse`.
   - `src/persist/dexie.ts:36` — widen `SaveRecord.data` union.
   - `src/ui/shared/SettingsMenu.tsx` Load handler — `fromSaveV4(saved)` → `fromSaveV5(saved)`.
   - Audit: `rg 'SaveV4|toSaveV4|fromSaveV4' src/` → zero production hits remain.
   - Test edits per the test-file edit list above.

7. **Pure rule + orchestrator + LLM module:**
   - Ship `src/game/rules/combat.ts` with full algorithm + tests.
   - Ship `src/game/rules/aging.ts` orphan-prune extension + tests.
   - Ship `src/llm/types.ts`, `src/llm/client.ts`, `src/llm/tools.ts`, `src/llm/routing.ts`, `src/llm/prompts/persona.ts`.
   - Ship `src/llm/__mocks__/sdk.ts` (test-mode SDK mock — see "Mock SDK location" below).
   - Ship `src/game/machines/conversation.ts` (XState machine).
   - Ship `src/runtime/conversationOrchestrator.ts`.
   - Ship `src/runtime/events/conversation.ts`.

8. **Store actions + UI:**
   - Extend `StoreActions` type in `src/game/store.ts` with the four new action signatures FIRST (separate from bodies). This sets the type-widening surface so the immer `set` body type-checks against the broader action set; UI consumers waiting for the bodies can already reference the types.
   - Add value imports at the top of `src/game/store.ts`: `import { conversationOrchestrator } from "../runtime/conversationOrchestrator";` and `import { conversationBus } from "../runtime/events/conversation";` (both needed by `runYearPass`'s diff-and-publish body and by the four new actions). The `conversationOrchestrator` import additionally guarantees the orchestrator's module-load TargetCharacterDied subscription runs by the time the first conversation fires (before the side-effect import in main.tsx — defense-in-depth against import-order surprises).
   - Add the four new store action bodies (`sendBallroomMessage`, `enterBallroom`, `exitBallroom`, `abortBallroomRequest`).
   - **Replace `runYearPass`'s body** (symbol-grep `runYearPass` in `src/game/store.ts` for the authoritative location) with the diff-and-publish form (publish `TargetCharacterDied` for each newly-dead NPC, comparing pre-state vs post-state with `before.houses` for the player-head exclusion check).
   - Ship `src/ui/ballroom/**` components.
   - Ship `src/ui/shared/KeyEntryPanel.tsx` + the `KeyContext` provider (with `setKey` that calls `personaCacheRegistry.clear()`).
   - Wire the "Enter Ballroom" button into `LocationDetailsPanel`.
   - Add the side-effect-only import to `src/main.tsx`: `import "./runtime/conversationOrchestrator";` (registers the `TargetCharacterDied` subscription at module-load — redundant with the value import in store.ts but harmless and explicit).

9. **Final verification:**
   - `pnpm test` / `pnpm lint` / `pnpm typecheck` clean.
   - Manual UI walkthrough (key entry, send message, observe deltas, exercise failure paths).
   - Dev-mode cache-hit log inspection.

**Why this step order:** each step's working-tree state after completion is independently typecheck-valid (or, for step 2, explicitly typecheck-broken with a known set of compile errors). The implementer can pause between steps without the working tree in an unrecoverable intermediate state.

**Line-number pin drift.** This plan cites a handful of `:N` source-line pins (e.g., `src/game/store.ts:45`, `:122-125`; `src/persist/schema.ts:24`; `src/persist/dexie.ts:19`, `:36`, `:59`, `:71`, `:93`, `:101`; `src/main.tsx:7`). These numbers reflect the source at plan-write time and WILL drift as P4 edits land. **At implementation time, treat the `:N` references as breadcrumbs and rely on symbol-grep for authoritative discovery** (e.g., `rg "SAVE_VERSION_CURRENT" src/persist/schema.ts`, `rg "overwriteFromGameState" src/game/store.ts`). The plan's cited pins remain useful as starting points; the symbol IS the contract.

---

## Mock SDK location for replay-harness determinism

**`__mocks__/@google/genai.ts`** at the **project root** (NOT under `src/`). Per Vitest's documented `__mocks__` auto-discovery semantics (Context7-verified, May 2026): "Vitest searches alongside the mocked file for local mocks, or in the project root for dependency mocks." Since `@google/genai` is an npm dependency, the auto-discovery path is the **project-root `__mocks__/` directory** with the file path mirroring the package name (so the file lives at `<repo-root>/__mocks__/@google/genai.ts`).

A `vi.mock("@google/genai")` call (with NO factory) in any test file then activates this default mock. The auto-discovery is package-name-mirrored, so the `@google/` directory at the repo root is intentional, not a typo.

```ts
// <repo-root>/__mocks__/@google/genai.ts
// Deterministic mock replacing @google/genai in test environments. The
// response for a given request is a pure function of the request's hash:
// identical requests always produce identical responses. This makes the
// LLM layer compatible with the 30-run replay-harness determinism contract.
//
// Test files needing per-test override (e.g., the four failure-path tests
// in conversationOrchestrator.test.ts) replace this default mock with a
// vi.mock("@google/genai", () => ({...})) factory override inside the
// test file's scope. The replay harness uses the default deterministic-by-
// hash mock unchanged via a bare vi.mock("@google/genai").

import { canonicalJSON } from "../../src/game/hash";  // path relative to repo root

export class GoogleGenAI {
  constructor(_opts: unknown) {}
  models = {
    generateContent: async (params: unknown) => {
      const requestHash = createHashFromString(canonicalJSON(params));
      return deterministicResponseFromHash(requestHash);
    },
    generateContentStream: async () => {
      throw new Error("Stream API is not used at P4 — bare vi.mock should not hit this branch.");
    },
  };
  caches = {
    create: async (params: { config?: { displayName?: string } } = {}) => {
      // Deterministic cache name derived from displayName + a counter held
      // in a module-level closure (initialized at module load; survives
      // within a test file, resets between test files).
      const name = `mock-cache-${params.config?.displayName ?? "untitled"}`;
      return { name };
    },
  };
}

function deterministicResponseFromHash(hash: string): {
  functionCalls: Array<{ name: string; args: Record<string, unknown> }>;
  usageMetadata: { cachedContentTokenCount?: number; promptTokenCount: number; candidatesTokenCount: number };
} {
  // Hex-derived selection: deterministic given the input hash.
  // First digit → tactic index (0-3); second digit → quality multiplier (0.5..1.5);
  // third digit → mood hint index (0-4); fourth digit → dialogue template index.
  const tactics = ["Flattery", "WittyBanter", "SlyGossip", "DeepEmpathy"] as const;
  const moods = ["Receptive", "Defensive", "Distracted", "Jealous", "Grieving"] as const;
  const dialogues = [
    "A measured response, in character.",
    "Indeed, the season grows more eventful by the week.",
    "One must always be careful what one says in such company.",
    "I find your candor refreshing.",
  ];
  const tacticIdx = parseInt(hash[0] ?? "0", 16) % 4;
  const qualityNudge = parseInt(hash[1] ?? "0", 16) / 15;  // 0..1
  const moodIdx = parseInt(hash[2] ?? "0", 16) % 5;
  const dialogueIdx = parseInt(hash[3] ?? "0", 16) % 4;
  return {
    functionCalls: [{
      name: "respond",
      args: {
        dialogue: dialogues[dialogueIdx],
        classifiedTactic: tactics[tacticIdx],
        qualityMultiplier: 0.5 + qualityNudge,  // in [0.5, 1.5]
        moodHint: moods[moodIdx],
        toolCalls: [],
      },
    }],
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
  };
}

function createHashFromString(input: string): string {
  // Simple deterministic hash for mock purposes (not crypto). The replay-
  // harness contract requires same-input → same-output; any pure string-→-
  // hex function suffices. Use a fnv1a-like fold.
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h = ((h ^ input.charCodeAt(i)) * 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export const FunctionCallingConfigMode = {
  AUTO: "AUTO",
  ANY: "ANY",
  NONE: "NONE",
} as const;
```

**Per-test override pattern** for the four failure-path tests:
```ts
// inside src/runtime/conversationOrchestrator.test.ts
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    constructor() {}
    models = {
      generateContent: () => Promise.reject(
        Object.assign(new DOMException("aborted", "AbortError"), { name: "AbortError" }),
      ),
    };
    caches = { create: () => Promise.resolve({ name: "mock-cache" }) };
  },
  FunctionCallingConfigMode: { ANY: "ANY", AUTO: "AUTO", NONE: "NONE" },
}));
```
The per-test factory override shadows the default `__mocks__/@google/genai.ts` for that file only. Each of the four failure paths gets its own factory: timeout (reject with AbortError), network (reject with a generic Error), schema (resolve with malformed `functionCalls`), missing-key (orchestrator constructs without key).

**Why repo-root `__mocks__/` (not nested under `src/llm/__mocks__/`):**
- (a) Vitest's `__mocks__` auto-discovery for **npm packages** specifically uses the **project-root** `__mocks__/` directory; nested folders under `src/` are not auto-discovered for package mocks.
- (b) Nested `src/llm/__mocks__/genai.ts` would only auto-discover for a relative-path import, not for `@google/genai`. Misplacing the mock means `vi.mock("@google/genai")` without a factory silently does nothing — the test silently fires real HTTP requests (or fails on missing API key in test environment).
- (c) The pattern is documented at Vitest's `vi.mock` doc page; this lookup IS a mandatory Context7 verification point at implementation time (added to the lookups section).

**Replay-harness extension:** the existing `replay-harness.test.ts` extends to ALSO fire scripted conversation sends via `store.sendBallroomMessage(...)` between tick advances. Each of the 30 replays uses the same script; the mock's hash-based determinism ensures identical responses across all 30 → identical conversation state → identical final hash. **The mock IS the determinism contract for the LLM boundary** — without it, the 30-run replay harness skips the conversation surface and the contract is unverified at the LLM seam. The replay harness's test file uses a bare `vi.mock("@google/genai")` to opt into the deterministic default mock.

---

## ESLint boundary positive-controls — full test extension

Beyond the 4 cases in the existing `eslint/boundaries.test.ts`, P4 adds:
- `llm/foo.ts` importing `game/rules/combat` → error (the new rule c).
- `llm/foo.ts` importing `game/conversation/types` → allowed.
- `llm/foo.ts` importing `game/constants` → allowed.
- `game/rules/aging.ts` importing `game/conversation/types` → allowed (game-rules allow-list extension).
- `game/rules/aging.ts` importing `src/llm/types` → error (game-rules disallows llm).
- `runtime/conversationOrchestrator.ts` importing `game/rules/combat` → allowed.
- `runtime/conversationOrchestrator.ts` importing `src/llm/client` → allowed.
- `persist/schema.ts` importing `game/conversation/types` → allowed (needed for SaveV5Schema's exchange + pair-key tuples).
- `ui/ballroom/BallroomView.tsx` importing `game/conversation/types` → allowed.

Each case ships as a `ESLint.lintText` test against a synthetic source string, per CLAUDE.md "Boundary-rule tests use ESLint.lintText against synthetic source strings."

---

## Verification

- **`pnpm test`** — all suites green. Specifically: combat-resolver tests (~100% line coverage); orchestrator failure-path tests (all four paths); pair-key round-trip; save-roundtrip with seeded conversation history; replay harness's 30 identical-seed campaigns produce identical hashes; orphan-prune test in `aging.test.ts`; mood-lock-cascade-prevention test.
- **`pnpm lint`** — Biome clean; `eslint-plugin-boundaries` clean (especially the new `llm` rule).
- **`pnpm typecheck`** — strict TS clean.
- **All four failure paths exercised in tests** (timeout, network, schema, missing key). Each asserts: tick unchanged; combat resolver NOT called (mock spy); conversation history unchanged; `ConversationFailed` event published with correct `reason`.
- **Cache-hit verification (dev-mode manual)** — start dev server with a real Gemini API key; send two messages to the same NPC; inspect the `usageMetadata.cachedContentTokenCount` log line on the second response — assert non-zero.
- **§7 "Heir promotion mid-conversation"** — automated test in `save-roundtrip.test.ts`: pending conversation under `(houseId, oldHeadId)` survives a forced succession; the new heir inherits the history under the same pair key; `routeModel` returns `MODEL_DEFAULT` (Gemini Flash) for the inherited pair (no "first-meeting" re-trigger).
- **§7 "Mid-conversation view exit"** — automated test in `conversationOrchestrator.test.ts`: pending request gets aborted on `exitBallroom`; the discarded response's resolution does not mutate state.
- **§7 "Conversation history orphan keys"** — automated test in `aging.test.ts`: NPC death cascades to pruning of conversation entries AND affection entries keyed on that NPC. PLAYER-side succession does NOT prune (heir inherits both maps via the playerHouseId-stable pair-key half).
- **§7 "Mood-lock cascade prevention"** — automated test: a second faux-pas on a locked-Defensive target extends the lock without firing a `MoodChanged` event.
- **§7 "Embedding service failure during conversation start"** — at P4 the embedding service is absent (P17); the orchestrator's conversation-start path does NOT reference any embedding hook. Test: the conversation-start succeeds with the embedding-absent harness — no thrown error, no skipped persona, prompt builds from recency window only.
- **Manual UI walkthrough** in dev server: enter ballroom from Capital → select target → pick stance → pin tactic → send message → observe response and deltas applied. Exercise the "no API key" banner (clear key from context → assert send button disabled). Exercise the timeout banner (mock the SDK to never resolve → wait 15s → assert banner appears, ballroom stays open, no state mutated).

- **Mutation-coverage audit (manual at implementation time).** Run `rg "set\\(\\(state\\)" src/game/store.ts` to enumerate every `set` body in store.ts; visually verify each one either (a) calls `overwriteFromGameState(state, next)` for full-state replacement, OR (b) explicitly mutates every P4-relevant field that the action SHOULD touch (`conversationHistory`, `affectionMap`, `Character.composure`, `Character.mood` for moodHint, `Character.moodLockUntilTick` for faux-pas). This catches the documented two-mutation-pattern gap (full-state-overwrite vs targeted-Immer-draft) at the action level. Future ballroom-touching actions that add a new pair-keyed field MUST update both `overwriteFromGameState` (for the audit's coverage of full-state actions) AND the relevant targeted-mutation action bodies.

- **Mock-hash stability check.** Verify `buildContents(req)` and `buildPersonaPrompt(target)` are pure functions of their inputs (no `Date.now()`, no `Math.random()`, no `state.tick` read inside persona unless explicitly intended). The mock SDK's `canonicalJSON(params)`-hashed response only stays deterministic if these two formatters are pure-by-input. The replay-harness's 30-run-identical-hashes assertion proves this transitively, but a one-off unit test (`buildPersonaPrompt(SAME_INPUT) === buildPersonaPrompt(SAME_INPUT)` after stable trait-array ordering) makes the contract explicit.

---

## Close out

When the gates and verification items above are green, run `/close-phase P4`. This will:

1. Run `pnpm test`, `pnpm lint`, `pnpm typecheck` and walk the Verification list above.
2. Update P4 status in `plans/MASTER.md` §6 from `—` to `✅ done`.
3. Append a section to `plans/SESSION-NOTES.md` documenting the actual implementation outcomes (especially: any v1 tuning iterations on `CONVERSATION_TRAIT_BONUSES`; the actual final post-bootstrap RNG callCount value after the 5-NPC seed; any cache-hit dev-mode observations).
4. Apply the CLAUDE.md additions above to `/Users/kylebiggs/Workspace/the-season-2.0/CLAUDE.md`.
5. Resolve open questions #5 / #13 / #14 / #15 in `plans/MASTER.md` §10 (already marked "Resolved at P4" pre-implementation).
6. Commit (no push).

## Accumulated Risks & Suggestions

*Passively collected from review cycles. Not blockers. Triaged at convergence.*

- [C1] R1. Plan length collapse vs P3 — under-specification suggests author moved on without folding in same level of detail. [likely addressed]
- [C1] R2. bus.publish discipline for conversation events unaddressed; need `runtime/events/conversation.ts` with typed variants. [likely addressed]
- [C1] R3. AbortController lifecycle vs React 19 StrictMode unaddressed — double-invoke effects fire two SDK calls. [likely addressed]
- [C1] R4. Pre-flight key check regex shape (`/^sk-ant-/` vs `/^sk-ant-api03-/` etc.) ambiguous in master plan + phase plan. [likely addressed]
- [C1] R5. BYOK key storage path unaddressed — sessionStorage vs in-memory vs React context.  [likely addressed]
- [C1] R6. "Cache hit observable on second turn" verification mechanism unspecified — real network or mock-with-cache-headers. [likely addressed]
- [C1] R7. `routeModel(history)` first-meeting routing — pure vs state-reading shape, post-succession routing. [likely addressed]
- [C1] R8. Wallflower + SlyGossip "bonus whisper" at P4 has no consumer (whispers ship at P6) — pin behavior or defer. [likely addressed]
- [C1] R9. `moodHint` response field could trigger PRNG draws if implementer applies via mood-drift rule — silent replay-break risk. [likely addressed]
- [C1] R10. `eslint-plugin-boundaries` config widening for the LLM layer not addressed. [likely addressed]
- [C1] R11. `toolCalls?: z.array(z.never()).default([])` — confirm response shape persistence in history (full response or just dialogue + tactic).
- [C1] R12. Verification test "Conversation history survives forced succession" requires fixture/mocking strategy pin (MSW vs vi.mock). [likely addressed]
- [C1] R13. Tactic-to-trait/mood bonus map is the largest hidden design surface and fully unspecified. [likely addressed]
- [C1] R14. CLAUDE.md update commitment missing — new conventions will be reinvented in later phases. [likely addressed]
- [C1] R15. `claude-api` skill reference + Context7 mandatory lookup at P4 implementation time not explicit. [likely addressed]
- [C1] R16. Rollback section missing — P0/P1/P2/P3 each had one; P4 introduces IndexedDB collection + save bump with rollback implications. [likely addressed]
- [C1] R17. Tick semantics in conversation unclear — does exchange consume a tick, does ball-session count as one tick. [likely addressed]
- [C1] R18. requestId ref pattern is React-component-local but plan places lifecycle in runtime/conversationOrchestrator (pure layer) — seam blurred. [likely addressed]
- [C1] R19. Conversation history bounded to 3 — eviction at append-time vs read-time. [likely addressed]
- [C1] S1. Add "Save format bump to v5" section mirroring P3's pattern (full lifter chain, dexie cutover, test edits). [likely addressed]
- [C1] S2. Add a "Canonical types table" listing new types this phase introduces (Tactic, Stance, ConversationPairKey, Exchange, response schema). [likely addressed]
- [C1] S3. Pin `CONVERSATION_TRAIT_BONUSES` map by listing all 32 traits with tactic-bonus/tactic-penalty tuples. [likely addressed]
- [C1] S4. Add explicit "Mandatory Context7 lookups" bullet for SDK, model IDs, XState v5. [likely addressed]
- [C1] S5. Add a "Test strategy" subsection pinning mock strategy + cache-hit verification mechanism + deterministic-replay impact. [likely addressed]
- [C1] S6. Pin `ConversationPairKey` as `${HouseId}|${CharacterId}` branded type, matches `serializeRegistry` discipline. [likely addressed]
- [C1] S7. Define `runtime/events/conversation.ts` analogous to `location.ts`, with explicit event variants. [likely addressed]
- [C1] S8. Add a Rollback section distinguishing pre-merge revert from post-merge IndexedDB state where v5 saves exist. [likely addressed]
- [C1] S9. Explicitly list `overwriteFromGameState` as the single shared mutation site for store-action state copies. [likely addressed]
- [C1] S10. Move "Resolved decisions (§10)" rationale into the body, not just citations. [likely addressed]
- [C1] S11. Reference `__test-utils__/factories.ts` precedent for synthetic-state test fixtures (`makeBallroomState`, etc.). [likely addressed]
- [C1] S12. Add a CLAUDE.md additions list at phase end. [likely addressed]
- [C1] R20. `isValidKeyShape` regex shape — CLAUDE.md vs plan-internal mismatch (8+ char suffix vs prefix-only). [likely addressed]
- [C1] R21. `CharacterPreV5Schema` hand-rolled vs `.omit()` derivation; future drift on Character field additions. [likely addressed]
- [C1] R22. `moodHint` Zod validation contradiction (strict vs widen-and-validate) — picked widen-and-validate uniformly. [likely addressed]
- [C1] R23. Conversation-history serialization lex-sort key order undocumented; pinned as full-string sort. [likely addressed]
- [C1] R24. `affectionTo` clamp at every mutation site unstated; combat resolver did not clamp. [likely addressed via affectionMap relocation + mutation-site clamp pinning]
- [C1] R25. `runYearPass` orphan-prune ripple — clarified safety of prune across heir-promotion (player-house pair-key half is stable). [likely addressed]
- [C1] R26. XState v5 `setup()` signature not Context7-verified; strengthened lookup gate to "before writing". [likely addressed]
- [C1] R27. `SettingsMenu.tsx` callsite enumeration — covered by the audit grep in the step-order section. [likely addressed]
- [C1] R28. NPC `birthTick` unspecified — pinned at 0 (same generation as player). [likely addressed]
- [C1] R29. `exitBallroom` racy contract with in-flight conversation — pinned as forced-abort, no delta applied. [likely addressed]
- [C1] R30. Wallflower stance multiplier — pinned as applies to every conversation under the stance. [likely addressed]
- [C1] S13. Atomic-commit step order pinned in a dedicated section. [likely addressed]
- [C1] S14. `CharacterPreV5Schema` uses Zod's `.omit()` per R21. [likely addressed]
- [C1] S15. Step-by-step file creation order — partial coverage via the step-order section + boundary positive-control test extension. [likely addressed]
- [C1] S16. `affectionTo` deferral — REJECTED on re-analysis; affection persistence is required at P4 because the combat resolver produces affection deltas that must accumulate. Resolved instead by relocating to top-level `affectionMap: Map<ConversationPairKey, number>` (S6-style pair-key reuse). Cleaner orphan-prune than per-character map.
- [C1] S17. Boundary positive-control case for `src/game/conversation/types.ts` added to test extension. [likely addressed]
- [C1] S18. Pattern updates for `patterns.md` — out-of-scope for the plan body; the reviewer agent owns its own memory.
- [C1] S19. `INDEPENDENT_HOUSE_ID` RNG state — pinned as "no separate RNG state at P4; player RNG drives all NPC draws via lex-sort iteration". [likely addressed]
- [C1] S20. `__test-utils__/factories.ts` precedent — referenced for the ballroomFixtures path; mock SDK location revised to `<repo-root>/__mocks__/@anthropic-ai/sdk.ts` after Context7 verification.
- [C3] R31. Mock SDK location was at `src/llm/__mocks__/sdk.ts`; Vitest auto-discovery for npm packages uses repo-root `__mocks__/`. [likely addressed]
- [C3] R32 / S23. RNG draw order between player head and 5 NPCs unpinned. Pinned: player head first, then NPCs in lex-sort order. [likely addressed]
- [C3] R33. `ConversationResponseSchema` snippet used `MoodSchema.optional()` / `TacticSchema` (narrow enums) but the prose said widen-and-validate. Snippet now uses `z.string()` for both fields, with explicit resolver step. [likely addressed]
- [C3] R34 / S24. `enableMapSet()` precondition for Immer-mutating Map-stored characters — confirmed already called at `src/game/store.ts:45`. Documented inline at the mutation site. [likely addressed]
- [C3] R35 / S22. `createInitialState` test-surface list was under-counted (missing v1-to-v3 chain, v1-to-v4 chain). Now explicitly enumerated. [likely addressed]
- [C3] R36 / S27. `"Dependent"` role membership — verified against `src/game/fixtures/roles.ts:8` (ROLES = ["HeadOfHouse", "Heir", "Dependent", "Spouse"]). FALSE POSITIVE on re-verification.
- [C3] R37 / S26. Step 3 typecheck-clean claim conflicted with `migrate_v1_to_v2` consumer. Step 3 now folds in the v1-to-v2 update; expected test outcomes per step enumerated. [likely addressed]
- [C3] R38. Heir-promotion during ball session — `playerHeadId` captured at entry stale on exit. Now pins re-fetch from `state.houses.get(PLAYER_HOUSE_ID).headOfHouseCharacterId` at exit time. [likely addressed]
- [C3] S21. `seedStartingFamily` signature pin — return shape changes to `{ rngState, houses, characters }`. [likely addressed]
- [C3] S25. BYOK regex moved to `constants.ts` as `BYOK_KEY_SHAPE_REGEX`. [likely addressed]
- [C3] S28. Mock SDK location verification — Context7 lookup completed (Vitest's `__mocks__` for npm packages uses repo root). [likely addressed]
- [C4] R39. `commitBallSession` ghost reference removed; commit happens inline in `exitBallroom`. [likely addressed]
- [C4] R40. mood-drift vs moodHint timing reframed as disjoint windows (year-pass vs within-tick). [likely addressed]
- [C4] R41. Orphan-prune year-pass-bound timing pinned; future within-tick-death phases must add their own trigger. [likely addressed]
- [C4] R42. `affectionMap` dual-layer clamp policy (in-memory schema + mutation-site clamp) documented.
- [C4] R43. `conversationHistory` per-pair `.max(3)` schema enforcement — append-time discipline kept (schema-level `.max` adds a useful but redundant layer; left as-is for now).
- [C4] R44. User-cancellation now publishes `ConversationFailed { reason: "cancelled" }` (5th reason); four-path test contract unaffected. [likely addressed]
- [C4] R45. `v1-to-v5-chain.test.ts` parity-invariant assertion shape pinned. [likely addressed]
- [C4] R46. `aging.test.ts:44` "no PRNG draws" invariant preservation noted explicitly. [likely addressed]
- [C4] S29. Canonical types table added between pair-key section and orphan-prune section. [likely addressed]
- [C4] S30. orphan-prune year-pass-only test fixture (D) added to aging.test.ts plan. [likely addressed]
- [C4] S31. Rollback via existing `SaveVersionTooNewError` — documented behavior; the "downgrade dialog" is the user-facing surface that ALREADY exists per P2's `CorruptSaveBanner`. The Rollback section's "ship a one-time downgrade dialog" wording is forward-looking; P2's banner is the current surface.
- [C4] S32. `succession.test.ts` audit — included via the test-file edit list in the step-order section.
- [C4] S33. Vitest `vi.mock` semantics already in Mandatory Context7 lookups (added in iter-3); now reinforced.
- [C4] S34. `EventBus` import path verified — `src/runtime/events/bus.ts` exists from P3.
- [C4] S35. Orphan-prune "as the target" spec-wording match documented explicitly. [likely addressed]
- [C5] R47. `playerExchange` / `npcExchange` construction now explicit before the `set` body. [likely addressed]
- [C5] R48. `clamp` helper pinned at `src/game/util/clamp.ts` (new file). [likely addressed]
- [C5] R49. `BallSessionId` switched to tick-derived deterministic ID (zero RNG draws). [likely addressed]
- [C5] R50. Bus event `sessionId` field now typed as `BallSessionId` (branded). [likely addressed]
- [C5] R51. LLM error classes pinned in `src/llm/errors.ts` (mirrors P2's `src/persist/errors.ts`). [likely addressed]
- [C5] R52. `v4-to-v5.idempotence.test.ts` pinned with the `assertMigrationIdempotent` precedent. [likely addressed]
- [C5] R53. `MoodChanged` event vacuity at P4 documented; reserved as a future-phase guard. [likely addressed]
- [C5] R54. `sessionAbortController` ownership pinned: orchestrator owns its own per-request AbortController. [likely addressed]
- [C5] R55. `liftLegacyCharacters` key signature corrected to `CharacterId` (branded). [likely addressed]
- [C5] R56. Sonnet (vs Opus) rationale pinned: cost-effective for the high-volume first-meeting path; Opus reserved for future key moments. [likely addressed]
- [C5] B21. Cancellation as 5th `Failed` reason (no separate `Cancelled` state); state machine reconciled with `ConversationFailure` type. [likely addressed]
- [C5] B22. `__buildSaveV4ForTests` cutover pinned (rename to V5, update all references). [likely addressed]
- [C5] B23. `v1-to-v3-chain.test.ts` mis-claim corrected: no positional access exists; only the parity assertion. [likely addressed]
- [C6] **PIVOT: LLM provider switched from Anthropic to Google's Gemini API via `@google/genai`.** Per user direction during iter-6 review. Plan + MASTER.md + CLAUDE.md updated for: SDK package name; model IDs (`claude-haiku-4-5` → `gemini-3.5-flash`, `claude-sonnet-4-6` → `gemini-3.1-pro-preview`); BYOK key shape (`/^sk-ant-/` → `/^AIza/`); structured-output mechanism (tool-use → function-calling); context caching (implicit per-message `cache_control` → explicit `caches.create` resource with TTL); mock SDK location (`__mocks__/@anthropic-ai/sdk.ts` → `__mocks__/@google/genai.ts`); error classes; module-singleton → KeyContext seam pinning. The conversion preserves all architectural decisions (determinism boundary, four failure paths, atomic-commit step order, save-format bump, NPC seeding, schema↔projection↔selector triple-sync, etc.).
- [C6] B24 (iter-6 finding). `MissingKeyBanner` referenced `state.byokKey` (Zustand store access) contradicting the React-context rule. Fixed in the same pivot pass: banner reads `useContext(KeyContext)`. [likely addressed]
- [C7] B25. `TargetCharacterDied` publish-source contradicted in three comments; reconciled to the `runYearPass` store-action wrapper. [likely addressed]
- [C7] B26. `runYearPass` snippet's player-head exclusion used `after.houses` (post-succession) instead of `before.houses`. Fixed to use `before`. [likely addressed]
- [C7] B27. `ConversationRequest` shape gained `cacheName: string | null`; client.ts now branches on it (mutually exclusive `cachedContent` vs `systemInstruction`). [likely addressed]
- [C7] B28. `migrate_v1_to_v2`'s character emit now strips `composure` / `maxComposure` to match `CharacterPreV5Schema` legacy shape. [likely addressed]
- [C7] R62. `personaCacheRegistry` singleton wiring pinned: module-level `export const` in `cache.ts`; subscriber registered at orchestrator module-load. [likely addressed]
- [C7] R63. Client-side abort cause: client always throws `CancelledError`; orchestrator re-maps to `TimeoutError` when its own timeout fired. [likely addressed]
- [C7] R64. `runYearPass` body restructure mentioned at the publish-discipline section; step 8 covers store actions including the runYearPass body edit.
- [C7] R65. Orchestrator publishes events — contradiction reconciled: orchestrator RETURNS outcome; store action PUBLISHES events from its `set`-completed body. [likely addressed]
- [C7] R66. `sendBallroomMessage` signature now `(input, apiKey)`; MessageInput reads key via `useContext(KeyContext)`. [likely addressed]
- [C7] R67. PersonaCacheRegistry cross-API-key invalidation: `KeyContext.setKey` callback calls `personaCacheRegistry.clear()`. [likely addressed]
- [C7] R68. `caches.create` catch now re-throws AbortError (preserves cancellation signal); other errors fall through to null. [likely addressed]
- [C7] R69. Orchestrator's catch-and-return snippet pinned via the `ConversationOutcome` discriminated union return + the store-action publish pattern. [likely addressed]
- [C7] R70. `caches.create` field `displayName` — included in Mandatory Context7 lookups for verification at impl time.
- [C7] R71. `ConversationFailure` relocated to `src/game/conversation/types.ts` (shared module); `runtime/events/conversation.ts` re-exports. [likely addressed]
- [C7] R72. Subscription registration site pinned: in `src/runtime/conversationOrchestrator.ts` module-load body. [likely addressed]
- [C8] B29. Abort API surface narrowed: only `.abortCurrent()` is public (no `.abort(requestId)` or `.abortAll()` — internal-only). [likely addressed]
- [C8] B30. `getOrCreatePersonaCache` caller pinned as the orchestrator (NOT the store action) — the orchestrator owns the AbortController. [likely addressed]
- [C8] B31. `sendBallroomMessage` snippet expanded to a full self-contained block — every binding declared in-scope (no free variables). [likely addressed]
- [C8] R73 (recurrence of R64). `runYearPass` body restructure now explicit in step 8's edit list. [likely addressed]
- [C8] R74. `caches.create config.abortSignal` field — added to Mandatory Context7 lookups.
- [C8] R75. Orchestrator catch-and-dispatch snippet now shown with all five reason branches. [likely addressed]
- [C8] R76. Orchestrator's `timedOut` flag + CancelledError → TimeoutError remap shown with full snippet. [likely addressed]
- [C8] R77. `personaCacheRegistry.clear()` method declared in the class body + module-level singleton export. [likely addressed]
- [C8] R78. `ConversationOutcome.Resolved` no longer carries `combat: CombatOutcome` — combat is the store action's responsibility (single owner). [likely addressed]
- [C8] R79. Side-effect-only import at `src/main.tsx` registers the orchestrator's subscription at app boot. [likely addressed]
- [C8] R80. `wasAlreadyLocked` capture pattern now shown in the full snippet — captured before the `set` body and passed to the post-set publish. [likely addressed]
- [C9] B32. Orchestrator `send()` snippet expanded — AbortController declaration, currentRequestId increment, post-await stale-check all explicit. [likely addressed]
- [C9] B33. Orchestrator now calls `personaCacheRegistry.getOrCreatePersonaCache(client.ai, target, model, abort)` inside its `send()` body; threads cacheName into a fresh ConversationRequest. `LlmClient.ai` switched to `public readonly` for registry access. [likely addressed]
- [C9] B34. `Tactic` / `Stance` imports in `runtime/events/conversation.ts` now correctly source from `../../game/constants` (per canonical types table). [likely addressed]
- [C9] R81. `currentRequestId` increment + stale-check now explicit in orchestrator snippet. [likely addressed]
- [C9] R82. `enterBallroom` body snippet added with session-state location + sessionId construction + publish. [likely addressed]
- [C9] R83. `exitBallroom` body snippet added with abort-before-commit + playerHeadId re-fetch + clamp + publish. [likely addressed]
- [C9] R84. `src/game/util/clamp.ts` added to Step 1's foundation edit list. [likely addressed]
- [C9] R85. Line-number drift documented at the step-order section's footer with the "symbol-grep is authoritative" framing. [likely addressed]
- [C9] R86. Two-mutation-pattern split documented at triple-sync edit #6: full-state overwrites vs targeted-Immer-draft mutations. [likely addressed]
- [C9] R87. Step 2's typecheck-broken intermediate now enumerates the specific failing callsites, including `selectGameState`. [likely addressed]
- [C10] B35. orchestrator.send() callsites updated to pass the third `target: Character` argument; prose at lines 1220, 1230, 1464 reconciled with the signature. [likely addressed]
- [C10] B36. `currentSession` mutable state moved onto `ConversationOrchestrator` class (NOT free module variable); accessed via `beginSession` / `endSession` / `currentSessionId` methods. [likely addressed]
- [C10] B37. `BallEntryRejection` type declaration added to `runtime/events/conversation.ts` body alongside `ConversationEvent`. [likely addressed]
- [C10] B38. `moodHint` now applied to `t.mood` inside the `sendBallroomMessage` set body (only when no faux-pas + not locked); pure assignment, no PRNG draws. [likely addressed]
- [C10] R88. `narrowResponse` / `resolveTactic` / `resolveMoodHint` homes pinned at `src/llm/types.ts` in the canonical types table. [likely addressed]
- [C10] R89. `BallSessionId` + `LocationId` imports added to events module body. [likely addressed]
- [C10] R90. Orchestrator snippet now ships an explicit import block. [likely addressed]
- [C10] R91. Step 8 adds value imports (`conversationOrchestrator`, `conversationBus`) to `src/game/store.ts` BEFORE the action bodies. [likely addressed]
- [C10] R92. Step 8 sequences StoreActions type-widen BEFORE the action bodies so UI consumers can already reference types. [likely addressed]
- [C10] R93. Mock SDK `deterministicResponseFromHash` body now fully implemented with hex-digit-based deterministic selection. [likely addressed]
- [C11] B39. Orchestrator self-import of `ConversationOutcome` removed; inline declaration is the canonical home; imports `ConversationResponse` + `ConversationFailure` for the body. [likely addressed]
- [C11] B40. Duplicate `const target` removed; preamble pins target as already-in-scope (non-null asserted at the orchestrator call). [likely addressed]
- [C11] R94. Orchestrator imports widened (response + failure types). [likely addressed]
- [C11] R95. `sendBallroomMessage` snippet's identifier dependencies enumerated as an explicit `src/game/store.ts` import list. [likely addressed]
- [C11] R96. `BallroomMessageInput` shape declaration shown alongside the action signatures. [likely addressed]
- [C11] R97. Session methods explicitly described as living inside the same `ConversationOrchestrator` class body. [likely addressed]
- [C12] B41. `zodIssuesFrom` helper declared in `src/llm/errors.ts` alongside the error classes. [likely addressed]
- [C12] B42. `client.ts` import block updated: `CancelledError` + `zodIssuesFrom` imported; `TimeoutError` removed (client never throws it). [likely addressed]
- [C12] R98. "Four paths share this contract" → "Five paths share this contract"; added `affectionMap` + `Character.composure` to the must-not-mutate list. [likely addressed]
- [C12] R99. Duplicate failure-path enumeration deleted; single canonical list with five reasons remains. [likely addressed]
- [C12] R100. `LLM_SYSTEM_INSTRUCTION_TOKEN_BUDGET` demoted to documentation-only with P18 deferral pin. [likely addressed]
- [C12] R101. `let response: GenerateContentResponse` typed annotation added. [likely addressed]
- [C13] B43. `runtime/events/conversation.ts` now imports `ConversationFailure` for local use alongside the re-export. [likely addressed]
- [C13] R102. `sendBallroomMessage` preamble extended to show `history` and `request` construction, including the `pinnedTactic` → `pinnedIntent` rename. [likely addressed]
- [C13] R103. `MessageInput.tsx` send-call now uses explicit `targetCharacterId: selectedTargetId` field form (no shorthand). [likely addressed]
- [C13] R104. Mood-drift timing-window prose corrected: per-tick (via `applyMoodDriftPhase` in PHASES), not year-pass. Within-tick ballroom session prevents racing regardless. [likely addressed]
- [C13] S103. Lifter description at line 73 updated to mention both new GameState fields. [likely addressed]
- [C14] B44. Brand types (`CharacterId`, `HouseId`) now re-exported from `src/game/conversation/types.ts` so `llm/**` can reach them without violating the `llm → game-rng` boundary. Mirrored in `src/llm/types.ts`'s re-export list. [likely addressed]
- [C14] R105. `src/llm/cache.ts` snippet now explicitly imports `CharacterId` from `./types` (the re-exported brand). [likely addressed]
- [C14] R106. `src/game/store.ts` import additions extended with `ConversationOutcome` (from orchestrator module) and `BallSessionId` (from rng). [likely addressed]
- [C14] R107. Stale `/ v3-to-v4` idempotence-test reference dropped from line 65; only the valid `v2-to-v3.idempotence.test.ts` precedent remains. [likely addressed]
- [C15] B45. `bootstrap.test.ts` test-fixture edit list expanded to cover the 8+ `seeded.house.*` / `seeded.character.*` singular-property-access rewrites alongside the callCount bump. [likely addressed]
- [C15] R108. `conversationMachine` snippet now imports `ConversationFailure` from `../conversation/types`. [likely addressed]
- [C15] R109. Stale Anthropic prose ("Sonnet" / "Haiku") replaced with Gemini equivalents at lines 35, 763, 2005. [likely addressed]
- [C16] B1 (cycle 2). `applyMoodDriftPhase` crash via Independent's missing RNG entry — fixed by seeding Independent RNG state at bootstrap (deterministic derivation from player seed). [likely addressed]
- [C16] B2 (cycle 2). Lord Blackwood role corrected to `"HeadOfHouse"` (not `"Dependent"`) — matches `seedStartingFamily` precedent and the head-of-house invariant. [likely addressed]
- [C16] B3 (cycle 2). `cache.ts` now wraps DOMException AbortError as `CancelledError` before re-throwing — orchestrator catch handles correctly. [likely addressed]
- [C16] R1. `FAUX_PAS_LOCK_TICKS` name collision with existing `FAUX_PAS_LOCK_DURATION_IN_TICKS` resolved by reusing the existing constant name everywhere. [likely addressed]
- [C16] R2. Independent house's wealth/reputation/scandal participation in per-house rules documented (Solvent tier drift is zero at P4 baseline; future tuning is designer-tracked, not a bug). [likely addressed]
- [C16] R3. `makePairKey` now asserts neither half contains `|` before brand cast (defense-in-depth). [likely addressed]
- [C16] R4. `buildContents` format pinned for determinism — explicit "Player: X\nNPC: Y" turn-by-turn shape. [likely addressed]
- [C16] R5. `buildPersonaPrompt` format pinned for determinism — explicit five-line template; trait labels rendered in array-order (not lex-sorted). [likely addressed]
- [C16] R6. Mock-hash stability documented as a Verification item; transitively proved by replay-harness 30-run assertion + a one-off unit test. [likely addressed]
- [C16] R7. `__buildSaveV4ForTests` rename rationale — pinned that no Playwright consumer hunt is needed at P4 (no consumers exist as of P3 close-out).
- [C16] R8. Mutation-coverage audit added as a Verification item — `rg "set\\(\\(state\\)" src/game/store.ts` audit pattern documented. [likely addressed]
- [C17] B1 (cycle 2 iter 2). `migrate_v1_to_v2` Independent-RNG-emission gap eliminated by relocating Independent introduction to `migrate_v4_to_v5` (single seeding site for all legacy paths through migration). [likely addressed]
- [C17] B2 (cycle 2 iter 2). Pre-P4 saves loaded into P4 now get Independent + 5 NPCs + Independent RNG via `migrate_v4_to_v5` seeding logic + symmetric `fromSaveVN` legacy-lifter seeding via `seedIndependentIntoLegacyState`. No empty-ballroom upgrade scenario. [likely addressed]
- [C17] Bootstrap RNG draw budget simplified: NPC deathAges are CONSTANTS in the `BASELINE_NPCS` fixture; bootstrap consumes only the player-head deathAge draw (1 total, unchanged from P3). Fresh-state and migrated-state paths produce byte-identical Independent + NPC shapes. Eliminates the bootstrap-vs-migration parity puzzle.
- [C17] `v1-to-v3-chain.test.ts` and `v1-to-v4-chain.test.ts` parity-invariant assertions dropped (the fresh state at P4 has 2 houses; v3/v4 intermediate shapes have 1; assertion can't hold). Full parity moves to the new `v1-to-v5-chain.test.ts` where both sides produce 2-house states.
- [C18] B1 (cycle 2 iter 3). `migrate_v1_to_v2` consumer-fanout now explicitly FILTERS to player-only (V2 saves predate Independent). Stale "6 deathAge total" comment-bump dropped — bootstrap stays at 1 draw. [likely addressed]
- [C18] B2 (cycle 2 iter 3). `seedIndependentIntoLegacyState` helper fully spec'd: signature, idempotence check, caller list, boundary impact, full 50-line body. [likely addressed]
- [C18] R1 (iter 3). `fromSaveV4` lifter pin extended to mention BOTH `conversationHistory` AND `affectionMap`, plus the `seedIndependentIntoLegacyState` call. [likely addressed]
- [C18] R3 / R4 (iter 3). Step-3 typecheck-broken intermediate enumeration reconciled with the iter-2 NPC-constants decision: bootstrap.test.ts callCount stays at 1; chain tests drop parity assertions in step 4. [likely addressed]
- [C18] R6 (iter 3). `v4-to-v5.test.ts` added to step 5's edit list — asserts byte-identical Independent construction vs `seedStartingFamily`. [likely addressed]
- [C19] B1 (cycle 2 iter 4). `migrate_v4_to_v5` integration shape fully pinned via `fromSaveV4Bare` split: `migrate_v4_to_v5(save) = toSaveV5(seedIndependentIntoLegacyState(fromSaveV4Bare(save), playerSeed))`. Same pattern for `fromSaveV1`/V2/V3 — Bare core + helper-wrapping public. [likely addressed]
- [C19] R4 (iter 4). `v4-to-v5.test.ts` assertion shape pinned as explicit code snippet (house byte-identity + each NPC byte-identity + Independent RNG byte-identity). [likely addressed]
- [C19] R5 (iter 4). `v1-to-v2.parity.test.ts` and `v1-to-v2.callcount-passthrough.test.ts` explicitly enumerated as no-code-change-passes-are-the-contract gates. [likely addressed]
- [C20] B1 (iter 5). Step 5's lifter instruction reconciled with the Bare+wrap canonical spec — explicit "split each lifter into Bare core + public wrapper" + find-by-id seed extraction. [likely addressed]
- [C20] R1 (iter 5). `v4-to-v5.idempotence.test.ts` added to step 5 alongside `v4-to-v5.test.ts`. [likely addressed]
- [C20] R2 (iter 5). Test snippet inner-loop `seed` → `npcSeed` to avoid shadowing the outer test-seed variable. [likely addressed]
- [C20] R3 (iter 5). Independent house + NPC construction extracted to shared `buildIndependentHouse()` + `buildBaselineNpcCharacter(seed)` builders in `src/game/fixtures/npcs.ts`; both `seedStartingFamily` and `seedIndependentIntoLegacyState` call them. Single source of truth. [likely addressed]
- [C20] R4 (iter 5). `fromSaveV1` partial-state semantics documented as test-only-post-P4 with plain `Error` throws acceptable. [likely addressed]
- [C20] R5 (iter 5). `toSaveV5` body inlined explicitly. [likely addressed]
- [C20] R6 (iter 5). V1/V2/V3 Bare bodies — pinned in the canonical Bare+wrap section that introduces fromSaveV4Bare with a full snippet; V1/V2/V3 Bare bodies mirror that pattern with the standard P3 / P2 / P1 lift-then-wrap chain. The cross-cutting pattern note covers all four.
- [C20] R7 (iter 5). `Error` throw vs `SaveLoadError` contract: documented as test-only-post-P4, plain Error is acceptable.
- [C21] R1 (cycle 2 iter 6). Stale "One deathAge roll per NPC" text at line 524 contradicts the NPC-constants decision. `[applied]` — rewrote to reference `buildBaselineNpcCharacter` + constant deathAges.
- [C22] R2 (cycle 3 iter 1). Independent RNG `playerSeed` parameter shape clarification — backstop for parity contract between fresh-state and migration paths.
- [C22] R3 (cycle 3 iter 1). `fromSaveV1Bare`'s partial-state semantics — verified caller-list scope (only V1 chain tests; production routes through V5).
- [C22] R4 (cycle 3 iter 1). Two-mutation-pattern footgun for P5+ — may need CLAUDE.md promotion.
- [C22] S1 (cycle 3 iter 1). One-line invariant comment at `seedIndependentIntoLegacyState` clarifying `playerSeed` is the seed-string field of `RngState`. `[applied]` — added inline param comment.
- [C22] S2 (cycle 3 iter 1). Promote two-mutation-pattern trade-off to CLAUDE.md addition. `[deferred: applied at /close-phase P4]` — CLAUDE.md additions already pin this discipline in the phase-end list; the /close-phase script applies them at merge time.
- [C22] S3 (cycle 3 iter 1). Accumulated-tail triage pass. `[applied]` — this triage pass is the resolution.
- [C23] Cycle 4 S2. `sendBallroomMessage` import list missing `buildPersonaPrompt` + `routeModel`. `[applied]` — both added to the canonical store.ts import block.
- [C23] Cycle 4 S3. `sendBallroomMessage` "no session open" rejection contract. `[applied]` — documented as defensive `{ reason: "cancelled" }` return; UI should never reach this state.
- [C23] Cycle 4 S4. `ConversationSent` event publish missing from post-await snippet. `[applied]` — explicit publish snippet added to step 1's post-validation block.
- [C23] Cycle 4 S6. `migrate_v1_to_v2` snippet's `/* strip P3 fields */` placeholder. `[applied]` — `stripHouseV4Fields` helper inlined; mirrors `stripCharacterV5Fields` shape.
- [C23] Cycle 4 S1. `createInitialState` Independent RNG construction snippet. `[note for implementer]` — typecheck catches divergence; canonical helper (`createRngState`) already pinned. No edit; informational.
- [C23] Cycle 4 S5. Stale "One deathAge roll per NPC" duplicate of C21-R1; `[applied]` via the same edit.
