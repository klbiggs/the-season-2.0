# P5 — Schemes & Multi-Tick Operations

> Part of [The Season Master Plan](../MASTER.md). Prior: [P4 — LLM Conversation & Ballroom](./04-ballroom-llm.md). Next: [P6 — Whispers, Espionage & Staff](./06-whispers-espionage.md).

**Goal.** Six scheme types resolvable across ticks, with prerequisite gating, atomic cost deduction, and completion effects. Scheme launch surfaces as buttons on the ballroom target NPC (per spec §3 line 73) and as a "Active Schemes" inline ledger panel on the map. Save format bumps to v6 to carry `state.schemes` (top-level Map) and `house.grievances` (per spec §4 line 541 — Sabotage records grievances; full duel resolution ships in P8). P5 is the first phase that REPLACES a P1-stubbed `identityPhase` in the orchestrator's `PHASES` array (slot 5: scheme resolution), so the orchestrator finally has a non-stub scheme step.

This phase is the project's first multi-tick operation. Every prior gameplay action resolved within a single tick (travel = 1 tick consumed, audience = same-tick, conversation = same-tick). Schemes span 1–7 ticks (Chaperone is 1, Seduction is 7) with deterministic completion at an absolute end-tick. Every scheme stores `endsAtTick` (absolute, never a relative duration) per the spec §9 lesson learned and CLAUDE.md non-negotiable §2. The atomic gating discipline (validate → deduct wealth → register) follows CLAUDE.md non-negotiable §5; the §7 edge case "Action gating bypassed by mid-flight scheme starts" is honored — once paid, schemes are NOT retroactively invalidated by era flips, family deaths, or archetype loss between start and completion.

**In scope.**

- **Save format bump to v6.** Adds two replay-relevant surfaces:
  - **`GameState.schemes: Map<SchemeId, Scheme>`** — every active, completed, cancelled, or failed scheme (status is a field, not a separate collection). Empty by default on fresh state and on every legacy lift.
  - **`House.grievances: Grievance[]`** — list of grievances the house holds against other houses (the house is the *victim*, the perpetrator is referenced by `perpetratorHouseId`). Empty by default. Spec §4 line 541 places `social grievances` on House; P5 owns the schema introduction because Sabotage is the first recorder. P4 fauxPas events also "may record a grievance" per spec §3 line 122, but P4 deferred that to P5 — P5 wires the recorder for both Sabotage (completion-time) and any fauxPas-driven grievances surfaced via the existing `FauxPasFired` event in `runtime/events/conversation.ts`.

  **Literal `GameStateSchema` extension (in-memory shape, NOT save-format shape).** `entities.ts:85-101` currently declares `GameStateSchema` with the 9 existing top-level keys; P5 appends `schemes` as a 10th key using `z.map(...)` (matching the existing `rng`/`houses`/`characters`/`marriages` shape — in-memory consumers like rules-layer code call `state.schemes.get(schemeId)`, so the in-memory schema MUST use `z.map`, NOT `z.array(z.tuple(...))`):
  ```ts
  // entities.ts:85-101 BEFORE (verbatim):
  export const GameStateSchema = z.object({
    tick: z.number().int().nonnegative(),
    rng: z.map(HouseIdSchema, RngStateSchema),
    houses: z.map(HouseIdSchema, HouseSchema),
    characters: z.map(CharacterIdSchema, CharacterSchema),
    marriages: z.map(MarriageIdSchema, MarriageRecordSchema),
    campaignName: z.string(),
    // P3: read-only at this phase, hard-locked to "Earlier". P13 ships the
    // transition mechanism.
    era: z.enum(["Earlier", "Later"]),
    // P4 additions: conversation history + affection map, both keyed on
    // ConversationPairKey = `${HouseId}|${CharacterId}`. Shared key shape
    // lets the orphan-prune cascade in aging.ts walk both collections in
    // a single filter pass on NPC death.
    conversationHistory: z.map(ConversationPairKeySchema, z.array(ExchangeSchema)),
    affectionMap: z.map(ConversationPairKeySchema, z.number().int().min(0).max(100)),
  });

  // entities.ts AFTER (P5 appends `schemes` as a new top-level key):
  export const GameStateSchema = z.object({
    tick: z.number().int().nonnegative(),
    rng: z.map(HouseIdSchema, RngStateSchema),
    houses: z.map(HouseIdSchema, HouseSchema),
    characters: z.map(CharacterIdSchema, CharacterSchema),
    marriages: z.map(MarriageIdSchema, MarriageRecordSchema),
    campaignName: z.string(),
    era: z.enum(["Earlier", "Later"]),
    conversationHistory: z.map(ConversationPairKeySchema, z.array(ExchangeSchema)),
    affectionMap: z.map(ConversationPairKeySchema, z.number().int().min(0).max(100)),
    // P5 addition: scheme registry. In-memory `z.map(K, V)` so rules can
    // call `state.schemes.get(schemeId)`; save-format `SaveV6Schema` uses
    // `z.array(z.tuple([SchemeIdSchema, SchemeSchema]))` (see below);
    // bridged by serializeRegistry/deserializeRegistry. Never copy the
    // array shape into GameStateSchema (CLAUDE.md non-negotiable).
    schemes: z.map(SchemeIdSchema, SchemeSchema),
  });
  ```
  **In-memory `z.map` vs save-format `z.array(z.tuple(...))` (CLAUDE.md non-negotiable).** GameStateSchema uses `z.map` so rules can call `state.schemes.get(schemeId)`. `SaveV6Schema` (declared in `src/persist/schema.ts`) uses `z.array(z.tuple(...))` for stable on-disk serialization (same shape as SaveV1/V2/V3/V4/V5 do for their existing Map fields). The two forms bridge via `serializeRegistry` / `deserializeRegistry`. Copying the array shape into `GameStateSchema` would break `state.schemes.get(...)` at runtime AND violate the documented bridge pattern. **House.grievances stays inside `HouseSchema`** — extended via the entities.ts House definition below; no separate top-level addition to `GameStateSchema` because grievances are scoped per-house.

- **Six scheme kinds** with §3-pinned costs, durations, and effects (table below). Prerequisite gating uses the canonical archetype names from spec §3 "Family Archetype Auto-Classification": `Spymaster`, `BohemianRake`, `Tutor`, `CountryExile` (plus the `None` sentinel for unclassified characters). (Spec §3's Scheme table uses the legacy phrase "spinster archetype" for Chaperone — that phrase is the *role* Spinster, not an archetype name. Spec §2 line 227 is the canonical reading: "Spymaster for Chaperone, Bohemian Rake for Assassination/Forgery, Country Exile as deniable proxy." The archetype enum at `src/game/fixtures/archetypes.ts` ships 5 values including `None` as the unclassified sentinel; prerequisite checks match against the per-scheme `acceptable` subset, NEVER against the full enum.)

  **Archetype-launch gating at P5 (load-bearing acknowledgement).** `classifyArchetype` in `src/game/fixtures/archetypes.ts:17-19` is stubbed to return `"None"` until P7; the bootstrap path at `src/game/bootstrap.ts:51` and the baseline NPC seeds at `src/game/fixtures/npcs.ts:90` all initialize `archetype: "None"`. **Therefore at P5, no living character in any fresh save has a Spymaster / BohemianRake / CountryExile archetype.** Chaperone (requires Spymaster) and Assassination (requires BohemianRake or CountryExile) are **functionally unlaunchable from the live UI at P5** — the `SchemeButtons` for those two kinds render disabled with the tooltip "Requires Spymaster archetype in family — available after P7" (or the corresponding archetype). Courting, Sabotage, Seduction, and Smuggling all have empty `acceptable` arrays and launch normally. **P5 SHIPS the rule layer's prerequisite-check logic fully** — the gate function correctly accepts a Spymaster when one exists — and tests it via synthetic Vitest fixtures that hand-construct characters with the required archetypes (no archetype-mutation action; the test fixture sets the field directly via factory builders). The live-UI dead-state is the expected behavior at P5; P7 ships `classifyArchetype` and the buttons begin to enable themselves as classification produces real archetypes. **NO P5-only archetype override** in `bootstrap.ts` or `seedStartingFamily` — that would be load-bearing fake-classification debt that P7 has to undo.

- **Scheme entity shape and `SchemeId` brand.** Branded `SchemeId = string & { __brand: "SchemeId" }` **exported** from `src/game/rng.ts` alongside the existing `CharacterId` / `HouseId` / `MarriageId` / `TraitId` brands. The companion `SchemeIdSchema` (using `.transform` per CLAUDE.md) is ALSO **exported** from `rng.ts` — mirrors the existing `HouseIdSchema` / `CharacterIdSchema` / `MarriageIdSchema` exports verified at `rng.ts:34-37`. The `GrievanceId` brand and `GrievanceIdSchema` (introduced later in this plan) follow the same export discipline: both exported from `rng.ts`.

  **Literal rng.ts edits (adjacent to lines 34-37 — verified state below).** Current `rng.ts:34-37`:
  ```ts
  // Branded-string Zod schemas use `.transform` (not `.brand`) to match the
  // existing GameStateSchema `rng` map-key form at store.ts.
  export const HouseIdSchema = z.string().transform((s) => s as HouseId);
  export const CharacterIdSchema = z.string().transform((s) => s as CharacterId);
  export const MarriageIdSchema = z.string().transform((s) => s as MarriageId);
  export const TraitIdSchema = z.string().transform((s) => s as TraitId);
  ```
  P5 appends two new brand-schema declarations + their TS type aliases (the type aliases live in the brand-declaration block earlier in rng.ts — symmetric with the existing brand declarations):
  ```ts
  // src/game/rng.ts: ADD adjacent to existing brand-type declarations:
  export type SchemeId = string & { __brand: "SchemeId" };
  export type GrievanceId = string & { __brand: "GrievanceId" };

  // src/game/rng.ts: ADD after the existing brand-schema block (post-line 37):
  export const SchemeIdSchema = z.string().transform((s) => s as SchemeId);
  export const GrievanceIdSchema = z.string().transform((s) => s as GrievanceId);
  ```
  **Without these explicit `export` keywords, the `SaveV6Schema` body referencing `SchemeIdSchema` (and the migrations referencing both brand schemas) fails to compile at the import site.** The `.transform` form (not `.brand`) matches the inline comment's discipline at rng.ts:32-33.

  **`src/game/entities.ts` import extension (literal edit).** The existing import at `entities.ts:17-23` carries `CharacterIdSchema, HouseIdSchema, MarriageIdSchema, RngStateSchema, TraitIdSchema` from `"./rng"`. P5 extends to include the two new brand schemas:
  ```ts
  // entities.ts:17-23 BEFORE:
  import {
    CharacterIdSchema,
    HouseIdSchema,
    MarriageIdSchema,
    RngStateSchema,
    TraitIdSchema,
  } from "./rng";

  // entities.ts:17-25 AFTER (P5 adds two imports — alphabetical order):
  import {
    CharacterIdSchema,
    GrievanceIdSchema,    // NEW at P5
    HouseIdSchema,
    MarriageIdSchema,
    RngStateSchema,
    SchemeIdSchema,       // NEW at P5
    TraitIdSchema,
  } from "./rng";
  ```
  **No circular import risk.** `entities.ts` already imports from `./rng`; adding two more brand schemas via the same import statement extends the existing edge. The rng → entities direction does NOT need to be added (rng.ts defines the brand schemas; entities.ts consumes them — the dependency is one-way).

  Scheme shape lives in `src/game/entities.ts` and follows spec §4 line 543 + §6 line 567 — the entity references BOTH the aggressor character AND the aggressor's owning house:
  ```ts
  export const SCHEME_KINDS = [
    "Courting", "Sabotage", "Seduction", "Chaperone", "Smuggling", "Assassination",
  ] as const;
  export type SchemeKind = (typeof SCHEME_KINDS)[number];
  export const SchemeKindSchema = z.enum(SCHEME_KINDS);

  export const SCHEME_STATUSES = ["Active", "Completed", "Cancelled", "Failed"] as const;
  export type SchemeStatus = (typeof SCHEME_STATUSES)[number];
  export const SchemeStatusSchema = z.enum(SCHEME_STATUSES);

  export const SCHEME_FAILURE_REASONS = ["TargetDied", "Discovered", "EraFlipped"] as const;
  export type SchemeFailureReasonKind = (typeof SCHEME_FAILURE_REASONS)[number];
  export const SchemeFailureReasonKindSchema = z.enum(SCHEME_FAILURE_REASONS);

  export const SchemeSchema = z.object({
    id: SchemeIdSchema,
    kind: SchemeKindSchema,
    ownerHouseId: HouseIdSchema,            // aggressor's house — owns the scheme per spec §6 line 567 (P5: always PLAYER_HOUSE_ID)
    aggressorCharacterId: CharacterIdSchema, // the family member running the scheme per spec §4 line 543 + §6 line 567
    targetCharacterId: CharacterIdSchema.nullable(), // null for Smuggling only
    startedAtTick: z.number().int().nonnegative(),
    endsAtTick: z.number().int().nonnegative(),     // ABSOLUTE end-tick (CLAUDE.md non-negotiable §2)
    status: SchemeStatusSchema,
    resolvedAtTick: z.number().int().nonnegative().nullable(), // null while Active; set on terminal transition
    failureReason: SchemeFailureReasonKindSchema.nullable(), // null when status !== "Failed"; one of TargetDied/Discovered/EraFlipped on Failed
    accumulatedAffection: z.number().int().nonnegative(), // spec §4 line 543; dead data at v1 (see note below)
  });
  export type Scheme = z.infer<typeof SchemeSchema>;
  ```

  **Why `failureReason` is on the entity, not threaded through the orchestrator.** The diff-publish wrapper at `store.ts` walks `before.schemes` vs `after.schemes` to emit transition events. For Seduction in particular, `status === "Failed"` corresponds to TWO bus events: `SeductionDiscovered` (P9 listens) and `SchemeFailed { reason: TargetDiedDuringFlight }` (P14 ledger listens). The diff helper has no signal to distinguish these from before/after `status` alone — both paths produce identical status. Storing the reason on the entity gives the diff helper a deterministic discriminator: `if (after.kind === "Seduction" && after.status === "Failed" && after.failureReason === "Discovered") publish SeductionDiscovered`. The alternative — threading `SchemeTransition[]` from `applySchemeResolutionPhase` up through `advanceTickPure` to the store wrapper — breaks the `TickPhase` signature contract `(GameState) => GameState`, forcing every other phase function to grow a return type it doesn't use. The on-entity field is the smaller delta. **At v1 the field is also exposed in the ledger UI** (P14 will surface "Failed: target died" vs "Failed: discovered" recap prose); P5's inline `ActiveSchemesPanel` doesn't render failed schemes (filter is `status === "Active"`), so the field is invisible until P14 — but it's correct from day one.

  **Round-trip contract for `failureReason: "Discovered"`.** The Seduction discovery path writes `failureReason: "Discovered"` to the entity via `flipSchemeStatus(state, scheme.id, "Failed", "Discovered")`; the field PERSISTS on the entity from that point forward (it is hash-relevant, ledger-relevant for P14, and survives save/load). The diff helper at `publishSchemeTransitions` reads `failureReason === "Discovered"` in the Seduction-failed branch BEFORE invoking `mapFailureReasonToPayload`, so the helper's `throw new Error("Discovered fires SeductionDiscovered, not SchemeFailed")` is structurally unreachable from the diff helper's call path. **The throw is defense-in-depth against a future maintainer calling `mapFailureReasonToPayload(scheme)` from another site without first checking `failureReason === "Discovered"`.** `"Discovered"` IS the on-entity contract; do NOT redirect Seduction-discovered schemes to write `failureReason: null` or to a different sentinel. The hash projection covers the field; replay determinism depends on its presence.
  **`accumulatedAffection` is hash-relevant but dead data at v1.** Spec §4 line 543 lists `accumulated affection` as part of the Active Scheme entity. At v1, Seduction discovery is one-shot at completion (OQ #6 resolved at P5 with `SEDUCTION_DISCOVERY_PROBABILITY = 0.2`), so no scheme accumulates affection mid-flight — the field is always `0` for the entire scheme lifecycle. The field is included to (a) honor the spec entity contract without a save-version-divergence delta, (b) reserve the slot for the v1.5 multi-tick suspicion mechanic (OQ #6's deferred alternative), and (c) keep replay-harness hashes stable across the eventual P5→v1.5 transition (a save-version bump is required to write a non-zero value, since v1.5 would change the semantics, but the on-disk shape stays compatible). **`startScheme` initializes the field to `0`; no resolver branch mutates it at P5.** Initialized in the `tryStartScheme` structural-sharing snippet (next subsection) alongside the other Scheme fields.
  **Why `aggressorCharacterId` is load-bearing now (not deferable):** spec §6 line 567 makes the aggressor character a first-class reference, and the archetype-prerequisite rule semantically applies to a SPECIFIC family member — "the Spymaster aunt is running this Chaperone" is more meaningful than "some family member with Spymaster archetype exists at start time." P5's prerequisite check resolves to the aggressor at start (picks the first lex-sort-by-character-id qualifying family member when multiple match — pinned deterministically). The aggressor field is hash-relevant (`Scheme` is in the hash projection via `state.schemes`). Future phases that need per-aggressor consequences — Patroness veto evaluating per-character favor, Duel resolution where the aggressor is the duelist, Treason Framing whose aggressor is the specific BohemianRake forger — all read this field. **At P5 the aggressor is mechanically a passenger** (no scheme effect varies by aggressor identity), but the field's presence is the spec contract.

  **Aggressor selection at start time (deterministic).** For schemes with non-empty `acceptable` archetypes (Chaperone, Assassination): the validator walks `state.characters.values()` filtered by `c.houseId === ownerHouseId AND c.alive === true AND acceptable.includes(c.archetype)`, then picks the LEX-SMALLEST `CharacterId` among the matches as the aggressor. For schemes with empty `acceptable` (Courting/Sabotage/Seduction/Smuggling): the aggressor defaults to the owner house's `headOfHouseCharacterId`. **Why lex-sort-by-id (not by age, archetype, etc.):** matches the project's existing lex-sort-by-id discipline (CLAUDE.md "lex-sort iteration over identifier Maps") and keeps the determinism contract simple. The player has no UI affordance at P5 to pick a specific aggressor; future phases that add an aggressor-selector UI must explicitly bump the save version because the lex-sort default would shift to an explicit player choice.
  - **Why `Map<SchemeId, Scheme>` vs `Array<Scheme>`:** matches the project's existing entity-registry discipline (characters, houses, marriages all use Maps). Lex-sort iteration over `SchemeId` follows the same pattern (`new Map(state.schemes)` clone, `.set(...)`, spread on mutation per CLAUDE.md pure-rule structural-sharing contract). The ledger view and any cross-scheme query (e.g., "find all in-flight Seductions targeting char X" for Chaperone completion) walks `state.schemes.values()` in lex-sort order.
  - **Why `targetCharacterId: CharacterId | null`:** Smuggling has no target character (it targets the *blockade*, not a person); using `null` keeps the shape uniform without introducing a discriminated union on the value type. Cancellation never deletes — status flips to `"Cancelled"` per CLAUDE.md non-negotiable. Completed/Cancelled/Failed schemes accumulate in `state.schemes` indefinitely (matches "characters/houses/marriages never deleted" invariant). UI ledger filters by `status === "Active"` for the inline panel; "History" tab in P14 ledger view shows the full set.
  - **Why `resolvedAtTick` on the entity:** answers "when did this scheme terminate" for the future P14 ledger view without forcing a sidecar event log. P5 sets it on Completed/Cancelled/Failed transitions. The hash projection covers it like any other field.

- **Grievance entity shape and `GrievanceId` brand.** Branded `GrievanceId = string & { __brand: "GrievanceId" }` exported from `src/game/rng.ts` (companion `GrievanceIdSchema` with `.transform`). Grievance shape in `src/game/entities.ts`:
  ```ts
  export const GRIEVANCE_SOURCES = ["Sabotage", "FauxPas"] as const;
  export type GrievanceSource = (typeof GRIEVANCE_SOURCES)[number];
  export const GrievanceSourceSchema = z.enum(GRIEVANCE_SOURCES);

  export const GrievanceSchema = z.object({
    id: GrievanceIdSchema,
    perpetratorHouseId: HouseIdSchema,
    source: GrievanceSourceSchema,
    schemeId: SchemeIdSchema.nullable(),     // non-null when source === "Sabotage"; null for FauxPas
    recordedAtTick: z.number().int().nonnegative(),
    resolved: z.boolean(),                    // P8 ships duel resolution flow that flips this
  });
  export type Grievance = z.infer<typeof GrievanceSchema>;
  ```
  - **Why on `House` (not top-level on `GameState`):** spec §4 line 541 puts "social grievances" on the House entity. Each grievance belongs to the *victim* house's list; the perpetrator is referenced by id. P14 ledger view flattens across all houses; P8 "demand satisfaction" action reads from the player house's list. Stored as `Grievance[]` (array, not Map) because the holding house is the natural key — the array is per-house and never crosses house boundaries. Lex-sort on iteration: P8's resolution actions sort by `recordedAtTick` ascending for FIFO display; mutation sites append, never insert at index.
  - **Mid-array ordering invariant + save/load round-trip contract.** `serializeRegistry` (in `src/game/rng.ts`) lex-sorts by Map *key* only — it does NOT recurse into entity inner arrays. So `House.grievances: Grievance[]` serializes in array order as-is, and `deserializeRegistry(new Map(array))` preserves that order through the round-trip (JSON arrays are insertion-ordered). **Contract: the grievances array is hash-relevant in INSERTION ORDER.** P5 appends to the end on Sabotage completion + on FauxPas (via `sendBallroomMessage`'s post-`set` block). P8 may flip `resolved` in place but never reorders. **Lex-sort by `GrievanceId` happens at UI render time only**, never in the rule layer or at save time. If P15 needs a per-grievance "favored victim" reordering of the persisted array, it must bump the save version because the order is part of the hash via `serializeRegistry` and grievances are stored on hash-relevant Houses.
  - **Why P5 owns introduction (not P8):** P5 has the first writer (Sabotage completion). Deferring to P8 would mean Sabotage records into nothing for one phase — a stub limbo that produces dead test fixtures. The shape is small enough to fully specify now; P8 extends only the *resolution* mechanism, not the entity shape.

- **`migrate_v5_to_v6` and lifter discipline.** Pure function `(SaveV5) → SaveV6` at `src/persist/migrations/v5-to-v6.ts`. Body follows the compose-with-helper-then-reserialize pattern from P4:
  ```ts
  export function migrate_v5_to_v6(save: SaveV5): SaveV6 {
    const bare = fromSaveV5Bare(save);                       // pure deserialize
    const seeded = seedSchemesAndGrievancesIntoLegacyState(bare);
    return toSaveV6(seeded);
  }
  ```
  Effects:
  - Adds `schemes: new Map()` to `GameState` (via the bare deserializer's defaults).
  - Adds `grievances: []` to every House (via a new `liftLegacyHouses` helper symmetric with P4's `liftLegacyCharacters`).
  - Re-serializes as SaveV6 tuple arrays.
  - Draw budget: **ZERO** — every default is a literal constant; no RNG calls. A future migration that wants randomized starting schemes (synthetic NPC plotting) MUST bump past v6.
  - Idempotence assertion ships in `src/persist/migrations/v5-to-v6.idempotence.test.ts` via `assertMigrationIdempotent` (the P2 helper).

  **`seedSchemesAndGrievancesIntoLegacyState` helper** lives in `src/persist/schema.ts` (private to lift/migrate boundary). Idempotent: walks `state.houses` and adds `grievances: []` only to houses where the field is absent (structural-not-contents check — a house with `grievances: []` already present is left as-is). For schemes: it cannot reach `state` to check existence on the schemes side because schemes is a new top-level field at V6; the helper unconditionally returns a new `state` with `schemes: state.schemes ?? new Map()` (so already-set schemes are preserved; missing schemes are seeded to empty). The idempotence assertion in test is the strong contract: `equal(helper(s), helper(helper(s)))`.

  **Bare+wrap lifter discipline (CLAUDE.md).** P4 introduced the full Bare-split pattern for V1–V4: `fromSaveV1Bare` (`schema.ts:156`), `fromSaveV2Bare` (`:218`), `fromSaveV3Bare` (`:278`), `fromSaveV4Bare` (`:331`) — all composed with `seedIndependentIntoLegacyState` in their public wrappers. Crucially: **V2Bare and V3Bare ALREADY call `liftLegacyHouses(save.houses)`** (`:222` and `:282` respectively, verified). They do NOT need any houses-tuple change. **Only V4Bare uses `deserializeRegistry(save.houses)` (`:335`)** and needs a route swap. **Only V5 gets a genuinely NEW Bare-split** (V5 was the live format at P4, so no Bare-split was needed yet). The migration `migrate_v5_to_v6` consumes the new `fromSaveV5Bare`.

  **Legacy alias inventory at `src/persist/schema.ts` (verified state, then P5 edits):**
  - **Existing**: `HousePreV4Schema` (`:37`, omits the 5 P3-added House fields) — used by `SaveV2Schema` (`:182`) and `SaveV3Schema` (`:242`) at their houses tuple positions. These two save schemas are NOT touched by P5; their houses tuple stays `HousePreV4Schema`.
  - **Existing**: `defaultHouseV4Fields(h: HousePreV4): House` (`:49`) — currently fills the 5 P3 fields and returns a live `House`. **P5 widens this helper's body** to also default `grievances: []` so its output remains a V6-compatible `House` after the `HouseSchema` gains the `grievances` field. The function name stays; only the returned object literal gains `grievances: []`. Literal widened body:
    ```ts
    // src/persist/schema.ts:49 BEFORE (verbatim):
    function defaultHouseV4Fields(h: HousePreV4): House {
      return {
        ...h,
        currentLocation: "Capital",
        consecutiveTicksAtCurrentLocation: 0,
        lastAudienceTick: null,
        wardrobeLastRefreshTick: null,
        blockadeBypassEarned: false,
      };
    }

    // schema.ts:49 AFTER (P5 — one field added to the returned object):
    function defaultHouseV4Fields(h: HousePreV4): House {
      return {
        ...h,
        currentLocation: "Capital",
        consecutiveTicksAtCurrentLocation: 0,
        lastAudienceTick: null,
        wardrobeLastRefreshTick: null,
        blockadeBypassEarned: false,
        grievances: [],   // NEW at P5
      };
    }
    ```
  - **Existing**: `liftLegacyHouses(serialized: ReadonlyArray<readonly [HouseId, HousePreV4]>): GameState["houses"]` (`:60`) — applies `defaultHouseV4Fields` per house. With the helper widened above, V2/V3 paths automatically produce V6-shape houses. No body edit to `liftLegacyHouses` itself.
  - **NEW at P5**: `HousePreV6Schema` + `HousePreV6` TS alias, declared together at `src/persist/schema.ts` adjacent to the existing `HousePreV4Schema` / `HousePreV4` pair (mirroring the P3 precedent at `schema.ts:37,47`). Literal declaration:
    ```ts
    // src/persist/schema.ts (NEW at P5, adjacent to HousePreV4Schema):
    //
    // Legacy alias for V4/V5 saves: the House shape AFTER the P3-added
    // fields land BUT BEFORE the P5-added `grievances` field. Used only by
    // SaveV4Schema + SaveV5Schema at their houses tuple value positions
    // post-P5 cutover. Symmetric with HousePreV4Schema (which omits the
    // P3 fields). NOT exported — private to the lift/migrate boundary.
    const HousePreV6Schema = HouseSchema.omit({ grievances: true });
    type HousePreV6 = z.infer<typeof HousePreV6Schema>;
    ```
    Used ONLY by `SaveV4Schema` (currently `:302` uses live `HouseSchema`) and `SaveV5Schema` (currently `:358` uses live `HouseSchema`). P5 swaps both V4/V5 schemas' houses tuple value from `HouseSchema` to `HousePreV6Schema`. **Without the `HousePreV6` TS type alias**, every reference to `HousePreV6` in helper signatures (`defaultHouseV6Fields(h: HousePreV6): House`, `liftLegacyHousesFromV6Pre(serialized: ReadonlyArray<readonly [HouseId, HousePreV6]>)`) is unresolved at typecheck — the alias declaration is load-bearing.
  - **NEW at P5**: `defaultHouseV6Fields(h: HousePreV6): House` — small helper that returns `{ ...h, grievances: [] }`. Symmetric with `defaultHouseV4Fields` but for the narrower input shape (P3 fields already present; only `grievances` missing).
  - **NEW at P5**: `liftLegacyHousesFromV6Pre(serialized: ReadonlyArray<readonly [HouseId, HousePreV6]>): GameState["houses"]` — applies `defaultHouseV6Fields` per house. Used by V4Bare and V5Bare ONLY. **Why a second lifter rather than overloading `liftLegacyHouses`:** input types are distinct (`HousePreV4` lacks both the 5 P3 fields AND grievances; `HousePreV6` has the P3 fields and lacks only grievances). A union-typed helper would need runtime discrimination; two narrow helpers are clearer and let the typechecker verify each lifter's input shape statically.

  **Explicit per-lifter edit list (verified against current `schema.ts`):**
  - **`fromSaveV1Bare` (`:156`, existing)**: NO houses-tuple change — V1 has no houses; `houses: new Map()` already at `:161`. **`fromSaveV1` (existing public wrapper)**: extend the composition from `Bare → seedIndependentIntoLegacyState` to `Bare → seedIndependentIntoLegacyState → seedSchemesAndGrievancesIntoLegacyState`.
  - **`fromSaveV2Bare` (`:218`, existing)**: NO houses-tuple change — already uses `liftLegacyHouses(save.houses)` at `:222`. With `defaultHouseV4Fields` widened above to default grievances, V2 lifts automatically produce V6 Houses. **`fromSaveV2` (existing public wrapper at `:233`)**: extend composition to include `seedSchemesAndGrievancesIntoLegacyState` after `seedIndependentIntoLegacyState`.
  - **`fromSaveV3Bare` (`:278`, existing)**: NO houses-tuple change — already uses `liftLegacyHouses(save.houses)` at `:282`. **`fromSaveV3` (existing public wrapper at `:293`)**: extend composition as for V2.
  - **`fromSaveV4Bare` (`:331`, existing)**: **WIDEN the houses tuple call** — change `deserializeRegistry(save.houses) as GameState["houses"]` (`:335`) to `liftLegacyHousesFromV6Pre(save.houses)`. This is the only Bare that genuinely needs a route swap. **`fromSaveV4` (existing public wrapper at `:346`)**: extend composition from `Bare → seedIndependentIntoLegacyState` to `Bare → seedIndependentIntoLegacyState → seedSchemesAndGrievancesIntoLegacyState`.
  - **`fromSaveV5Bare` (NEW at P5)**: split the existing `fromSaveV5` body into a Bare core that does pure deserialization. The houses tuple call is `liftLegacyHousesFromV6Pre(save.houses)`. Other fields retain their existing handling (rng/characters/marriages via existing helpers; the two existing GameState fields `conversationHistory`/`affectionMap` already present at V5; `schemes: new Map()` as the V5→V6 default). **`fromSaveV5` (existing public function, refactored)**: composes `Bare → seedSchemesAndGrievancesIntoLegacyState`. No `seedIndependentIntoLegacyState` — V5 saves already contain Independent by schema.
  - **`fromSaveV6` (NEW at P5)**: pure deserialize directly via `deserializeRegistry(save.houses) as GameState["houses"]` — V6 saves contain live `HouseSchema` houses. NO Bare-split, NO seeding helper applies.

  **Bare-core export discipline (per existing P4 precedent).** `fromSaveV4Bare` is currently `export function` at `schema.ts:331` (verified) with an explicit comment at `:328` documenting why it is exported. **P5 follows the V4 precedent: `fromSaveV5Bare` is ALSO exported.** Rationale: the migration runner does NOT consume public `fromSaveVN` wrappers — it composes individual migration steps via `migrate_vN_to_vN+1` — but the Bare cores serve test fixtures and any future direct-lift hot-path that wants to bypass the seeding helpers. Making V5Bare private to `schema.ts` would force `migrate_v4_to_v5` to consume the public wrapper, which would double-invoke `seedIndependentIntoLegacyState` and break the idempotence assertion. **`fromSaveV1Bare`, `fromSaveV2Bare`, `fromSaveV3Bare` are NOT currently exported** (they remain private). P5 does not change their export status — only V4Bare (already exported at P4) and V5Bare (new at P5) carry the public Bare API. The public lifters retain their existing exported names so consumers (tests, production load path) don't churn. **The migration runner is unaffected** — its `(SaveVN) → SaveVN+1` contract is satisfied because each `migrate_vN_to_vN+1` produces a tuple-array form via `toSaveVN+1`.

  **Why both helpers (`seedIndependent` and `seedSchemesAndGrievances`) on every legacy public lifter:** the public lifters are consumed by tests and any future direct-lift hot-path; bypassing the migration runner means they must produce the same shape the runner would produce. The two helpers in series, both idempotent, give the same V6 GameState regardless of entry point. **Migration runner discipline preserved:** `migrate_v5_to_v6 = toSaveV6 ∘ seedSchemesAndGrievances ∘ fromSaveV5Bare` (no Independent seeder needed because V5 saves already contain Independent).

  Register in `src/persist/migrations/index.ts` after the existing `v4-to-v5` entry; `assertMonotonic(MIGRATIONS)` catches misregistration at module load.

- **Save-version cutover — full edit list at `src/persist/schema.ts` and `src/persist/dexie.ts`.** SaveV6 is the new live format. Following the P3/P4 cutover pattern verbatim:
  - **`src/persist/schema.ts:34`**: `SAVE_VERSION_CURRENT = 5 as const` → `SAVE_VERSION_CURRENT = 6 as const`. Legacy `toSaveV1` / `toSaveV2` / `toSaveV3` / `toSaveV4` / `toSaveV5` retain their literal `version: N` writes per the P2/P3/P4 precedent.
  - **`src/persist/schema.ts` append** — new `SaveV6Schema`, `toSaveV6`, `fromSaveV6` block following the SaveV5 block. Schema shape:
    ```ts
    export const SaveV6Schema = z.object({
      version: z.literal(6),
      tick: z.number().int().nonnegative(),
      rng: z.array(z.tuple([HouseIdSchema, RngStateSchema])),
      houses: z.array(z.tuple([HouseIdSchema, HouseSchema])),       // HouseSchema gains `grievances: Grievance[]`
      characters: z.array(z.tuple([CharacterIdSchema, CharacterSchema])),
      marriages: z.array(z.tuple([MarriageIdSchema, MarriageRecordSchema])),
      campaignName: z.string(),
      era: z.enum(["Earlier", "Later"]),
      conversationHistory: z.array(z.tuple([ConversationPairKeySchema, z.array(ExchangeSchema)])),
      affectionMap: z.array(z.tuple([ConversationPairKeySchema, z.number().int().min(0).max(100)])),
      schemes: z.array(z.tuple([SchemeIdSchema, SchemeSchema])),    // NEW at P5
    });
    export type SaveV6 = z.infer<typeof SaveV6Schema>;
    export function toSaveV6(state: GameState): SaveV6 { /* serializeRegistry for state.schemes; emit version: SAVE_VERSION_CURRENT */ }
    export function fromSaveV6(save: SaveV6): GameState { /* deserializeRegistry for state.schemes; emit GameState directly */ }
    ```
  - **Houses tuple value at each save schema (verified state, then P5 edits):**
    - `SaveV1Schema`: no houses tuple (V1 has no houses) — no edit.
    - `SaveV2Schema` (`:182`) + `SaveV3Schema` (`:242`): already use `HousePreV4Schema` at the houses tuple value — NO edit. Their Bare cores already call `liftLegacyHouses` (which now produces V6-shape houses via the widened `defaultHouseV4Fields`).
    - `SaveV4Schema` (`:302`) + `SaveV5Schema` (`:358`): currently use live `HouseSchema` at the houses tuple value. P5 changes both to `HousePreV6Schema`. Their Bare cores route through `liftLegacyHousesFromV6Pre` (V4 widening + new V5 Bare per the Bare+wrap section above).
    - `SaveV6Schema` (NEW): uses live `HouseSchema` at the houses tuple value (V6 saves contain full live `House` with `grievances` present).

  - **`toSaveV4` and `toSaveV5` emitter cascade (LOAD-BEARING).** After the schema widening above, `SaveV4Schema` and `SaveV5Schema` expect houses to match `HousePreV6Schema` (no `grievances` field). But the existing `toSaveV4` and `toSaveV5` bodies call `serializeRegistry(state.houses)`, which emits the live `House` shape — and P5 widens `HouseSchema` to include `grievances`. The result: post-P5 `toSaveV4(state)` and `toSaveV5(state)` produce houses WITH grievances; `SaveV4Schema.parse` / `SaveV5Schema.parse` would reject them. **Critical paths affected:**
    - `migrate_v4_to_v5`'s `outputSchema: SaveV5Schema` validation at the migration runner: V4→V5 emits via `toSaveV5` (current implementation), which post-P5 produces houses-with-grievances; the runner's `SaveV5Schema.parse` rejects it. **The V5→V6 migration in the runner chain fails immediately.**
    - `migrate_v3_to_v4`'s `outputSchema: SaveV4Schema`: same shape — `toSaveV4` post-P5 emits houses-with-grievances; `SaveV4Schema.parse` rejects.
    - Any test using `__buildSaveV5ForTests` (renamed at P5 to V6, but tests of legacy formats remain): also affected.

    **Required edit at `toSaveV4` and `toSaveV5`:** strip the `grievances` field from each house tuple value before parsing. Two implementation options:
    ```ts
    // Option A (explicit destructure-and-drop): the most readable.
    // V4/V5 emitters target HousePreV6 (live House minus grievances).
    function stripGrievancesForLegacyEmit(
      entries: ReadonlyArray<readonly [HouseId, House]>,
    ): Array<[HouseId, HousePreV6]> {
      return entries.map(([id, h]) => {
        const { grievances: _drop, ...rest } = h;
        return [id, rest as HousePreV6];
      });
    }

    // V2/V3 emitters target HousePreV4 (live House minus grievances AND
    // the 5 P3-added fields). Composes the V4/V5 strip with the existing
    // P3-field destructure — single destructure that drops all 6 fields.
    function stripV6FieldsForLegacyEmit(
      entries: ReadonlyArray<readonly [HouseId, House]>,
    ): Array<[HouseId, HousePreV4]> {
      return entries.map(([id, h]) => {
        const {
          grievances: _g,                              // NEW at P5
          currentLocation: _cl,                        // P3 field
          consecutiveTicksAtCurrentLocation: _cttcl,   // P3 field
          lastAudienceTick: _lat,                      // P3 field
          wardrobeLastRefreshTick: _wlrt,              // P3 field
          blockadeBypassEarned: _bbe,                  // P3 field
          ...rest
        } = h;
        return [id, rest as HousePreV4];
      });
    }

    // toSaveV4 / toSaveV5 (existing bodies, edited — use V6-pre strip):
    export function toSaveV4(state: GameState): SaveV4 {
      return SaveV4Schema.parse({
        version: 4,
        // ... other fields unchanged ...
        houses: stripGrievancesForLegacyEmit(serializeRegistry(state.houses)),
        // ... other fields ...
      });
    }
    // toSaveV5: identical pattern with version: 5 + SaveV5Schema.parse.

    // toSaveV2 / toSaveV3 (existing bodies, edited — use V4-pre strip).
    // The existing inline destructure-strip pattern at schema.ts:192-202
    // (toSaveV2) and :250-260 (toSaveV3) — already dropping the 5 P3 fields —
    // is REPLACED with the shared helper call. Net change per emitter is
    // -10 lines (inline destructure) + 1 line (helper call) = -9 lines each.
    export function toSaveV2(state: GameState): SaveV2 {
      return SaveV2Schema.parse({
        version: 2,
        // ... other fields unchanged ...
        houses: stripV6FieldsForLegacyEmit(serializeRegistry(state.houses)),
        // ... other fields ...
      });
    }
    // toSaveV3: identical pattern with version: 3 + SaveV3Schema.parse.
    ```
    ```ts
    // Option B (Zod-driven strip via HousePreV6Schema.parse):
    // Zod's default behavior is .strip() — unknown keys are silently
    // dropped at parse time. Pass each live House through HousePreV6Schema.parse:
    houses: serializeRegistry(state.houses).map(
      ([id, h]) => [id, HousePreV6Schema.parse(h)] as [HouseId, HousePreV6],
    ),
    ```
    **Pin Option A** for P5 (explicit destructure-and-drop). Rationale: (a) avoids an extra Zod parse pass per house at every legacy-version emit; (b) the literal `{ grievances: _drop, ...rest }` makes the field-strip explicit at the call site so a future reader doesn't wonder why grievances vanish; (c) the helper colocates with `defaultHouseV6Fields` (its inverse) for readability — both live in `schema.ts` adjacent to `HousePreV6Schema`.

    **This edit applies to FOUR legacy emitters: `toSaveV2`, `toSaveV3`, `toSaveV4`, AND `toSaveV5`.** Verified state of current `src/persist/schema.ts`: `toSaveV2` (`:192-202`) and `toSaveV3` (`:250-260`) already destructure-strip the 5 P3 House fields when emitting their houses tuple values (they target `HousePreV4Schema`, which omits the P3 fields). Once `HouseSchema` widens to include `grievances`, those existing destructures don't drop the new field — they would emit houses-with-grievances into the V2/V3 record. **Zod's default `.strip()` mode would silently drop the unknown `grievances` key at re-parse time, so this would not crash** — but the migration runner's `outputSchema.parse(SaveV2Schema)` step would silently mutate the result, breaking the migration's purity claim (output != input even on identity-mapping migrations). **Cleaner fix:** extend the destructure-strip pattern of every V2/V3 emitter to also drop grievances, mirroring the new V4/V5 strip. P5 ships a single shared helper `stripV6FieldsForLegacyEmit(h: House): HousePreV4` (used by V2/V3 emitters; strips the P3 fields AND grievances) alongside `stripGrievancesForLegacyEmit(h: House): HousePreV6` (used by V4/V5 emitters; strips ONLY grievances). The two helpers compose: the V2/V3 helper IS the V4/V5 helper followed by the existing P3-field destructure.

    **Migration runner correctness post-edit:** every legacy `migrate_vN_to_vN+1` step that composes via `toSaveV{N+1}` produces output that parses clean against the post-P5 `SaveV{N+1}Schema` without silent .strip()-mutation. Specifically:
    - `migrate_v1_to_v2 → toSaveV2`: strips grievances + P3 fields cleanly.
    - `migrate_v2_to_v3 → toSaveV3`: same.
    - `migrate_v3_to_v4 → toSaveV4`: strips grievances only (P3 fields are present at V4).
    - `migrate_v4_to_v5 → toSaveV5`: same as V4.
    - `migrate_v5_to_v6 → toSaveV6`: no strip (V6 is the live format; grievances ARE expected).
    The full chain V1→V2→V3→V4→V5→V6 runs to completion, with V5→V6's `seedSchemesAndGrievancesIntoLegacyState` adding grievances back during the lift to V6 in-memory state. The `v1-to-v6-chain.test.ts` exercises every step and would catch any per-step .parse() failure.
  - **`src/persist/dexie.ts`** — `SaveRecord.data` union widening from `SaveV1 | ... | SaveV5` to `... | SaveV6` (documentation-only per P3/P4). `load()` final-parse callsite changes to `SaveV6Schema.parse`; return-type annotation changes to `Promise<SaveV6 | undefined>`. Import `toSaveV6`, replace `toSaveV5` in the production write callsite. Same audit pattern: `rg 'SaveV5|toSaveV5|fromSaveV5' src/` post-cutover; expect only legacy-version-test hits.
  - **`src/main.tsx` `__buildSaveV5ForTests`** rename to `__buildSaveV6ForTests` per the P4 rename precedent. **Five reference sites must update in `src/main.tsx`** (enumerated to prevent silent stale-ref drift; verified against current file at 65 lines total):
    - **`main.tsx:7`** — import statement `import { toSaveV5 } from "./persist/schema";` updates to `import { toSaveV6 } from "./persist/schema";`.
    - **`main.tsx:18`** — comment line referencing `__buildSaveV5ForTests`; update the comment text.
    - **`main.tsx:25`** — TypeScript type annotation `(...): SaveV5 => ...` updates to `SaveV6`; the function name in the type annotation updates.
    - **`main.tsx:33`** — window assignment `w.__buildSaveV5ForTests = ...` updates to `w.__buildSaveV6ForTests = ...`.
    - **`main.tsx:54`** — function body call `return toSaveV5({ ...state, houses });` updates to `return toSaveV6({ ...state, houses });`.

    The spread in the function body already inherits `schemes` from `selectGameState(...)` (P5 extends the selector to emit it), so no inline default needed. Audit: `rg '__buildSaveV5ForTests' .` post-cutover expects zero hits anywhere; `rg 'toSaveV5' src/main.tsx` post-cutover expects zero hits (without all five edits, the file fails to compile because `toSaveV5` no longer exists after the schema cutover); `rg '__buildSaveV6ForTests' .` expects the renamed sites enumerated above.
  - **`src/persist/migrations/index.ts`** — three coupled edits:
    1. **Imports.** The existing import line carries `SaveV1Schema, SaveV2Schema, SaveV3Schema, SaveV4Schema, SaveV5Schema`. Add `SaveV6Schema` to the same import (alphabetical-by-version preserves the existing pattern).
    2. **Migration import.** Add `import { migrate_v5_to_v6 } from "./v5-to-v6";` after the existing `import { migrate_v4_to_v5 } from "./v4-to-v5";`.
    3. **Registration.** The `MIGRATIONS` array currently ends with the `{ from: 4, to: 5, migrate: ..., outputSchema: SaveV5Schema }` entry. P5 appends one more entry AFTER it (and before the closing `]`):
       ```ts
       { from: 5, to: 6, migrate: (s: unknown) => migrate_v5_to_v6(SaveV5Schema.parse(s)), outputSchema: SaveV6Schema },
       ```
    `assertMonotonic(MIGRATIONS)` (runs at module load) catches misordering and missing intermediate steps. Position-after-v4-to-v5 preserves the lex order on `from`.
  - **Test-file edit list** — three test files import legacy V5 symbols and need explicit handling:
    - **`src/persist/save-roundtrip.test.ts`** — currently imports `fromSaveV5`. Update both import and call to `fromSaveV6` (the test exercises the current-version round-trip, which becomes V6 at the P5 cutover). **Why a V6 round-trip is symmetric where a V5 round-trip would not be:** `toSaveV5` post-P5 strips grievances (Option A `stripGrievancesForLegacyEmit`), but `fromSaveV5` post-P5 composes `Bare + seedSchemesAndGrievances` which restores grievances as `[]` on every house. A roundtrip via V5 of state with non-empty grievances would NOT preserve them. By contrast `toSaveV6` and `fromSaveV6` both operate on the live `HouseSchema` shape — no strip, no seed — so the V6 roundtrip is byte-identical for any valid input state. The rename to V6 is the load-bearing edit; semantics are preserved.
    - **`src/persist/migrations/v1-to-v5-chain.test.ts`** (added at P4) — code change required. Extend the chain assertion to `runMigrations(saveV1, 1, 6, MIGRATIONS)` and lift via `fromSaveV6`. Also add the new full-chain regression file `src/persist/migrations/v1-to-v6-chain.test.ts`. **Parity-invariant assertion pinned:** `expect(hashState(fromSaveV6(runMigrations(saveV1, 1, 6, MIGRATIONS)))).toBe(hashState(createInitialState(seed, DEFAULT_CAMPAIGN_NAME)))` for a fresh-state seed. **Hash-equivalence claim load-bearing pieces:** (a) `createInitialState` initializes EVERY house's `grievances: []` (empty array); (b) `seedSchemesAndGrievancesIntoLegacyState` ALSO initializes every house's `grievances: []` via `defaultHouseV6Fields`; (c) both paths produce identical empty grievance arrays in identical insertion order (zero entries). The hash projection serializes via `serializeRegistry(state.houses)` which lex-sorts by `HouseId` — the deterministic outer ordering is preserved across both paths. (d) `state.schemes` is `new Map()` in both paths (fresh-state and migrated). (e) The `Independent` house is seeded in both paths (fresh via `seedStartingFamily`; migrated via `seedIndependentIntoLegacyState`); with identical fields including `grievances: []`. (f) `accumulatedAffection: 0` is never populated by migrations (no in-flight schemes in legacy saves). Together these conditions make the hash-equivalence claim strict equality, not "structurally equivalent."
    - **`src/persist/dexie.test.ts`** — semantics shift mirroring the P3/P4 pattern. Add "fires InvalidSaveSchemaError when SaveV6 fields are malformed" (current-version path). Rename the existing SaveV5-malformed test to "fires MigrationFailedError when migrating-from-V5 fails on malformed fields". Add SaveV6-specific corruption fixtures: scheme with `endsAtTick: -1` (out of `nonnegative` range) → `InvalidSaveSchemaError`; grievance with `perpetratorHouseId: ""` (empty string fails brand transform) → `InvalidSaveSchemaError`.

- **`src/game/constants.ts` extended.** New entries appended to the P1/P2/P3/P4 set:
  - **Module-load assertion** in `src/game/constants.ts` adjacent to `SCHEME_KINDS` declaration:
    ```ts
    // Guards against P10's Treason Framing addition (or any future 7th kind)
    // landing without a save-version bump. SCHEME_KINDS additions are hash-
    // relevant (SchemeKindSchema = z.enum(SCHEME_KINDS) serializes by string
    // value, AND SchemeId factories embed kind as a substring), so an
    // unannounced addition silently corrupts SaveV6 records. The assertion
    // triggers at module load — first import in any code path. Symmetric
    // assertion exists for SCHEME_FAILURE_REASONS additions per the
    // save-version-bump checklist.
    if (SCHEME_KINDS.length !== 6) {
      throw new Error(`SCHEME_KINDS length changed (${SCHEME_KINDS.length} !== 6) without save-version bump — bump SAVE_VERSION_CURRENT and add migration`);
    }
    ```
  - **`SCHEME_TUNING: Readonly<Record<SchemeKind, { wealthCost: number; durationTicks: number }>>`** — pinned from spec §3 "Scheme Costs, Durations & Requirements":
    | SchemeKind | wealthCost | durationTicks |
    |---|---|---|
    | `Courting` | `10` | `5` |
    | `Sabotage` | `15` | `3` |
    | `Seduction` | `25` | `7` |
    | `Chaperone` | `5` | `1` |
    | `Smuggling` | `20` | `4` |
    | `Assassination` | `50` | `6` |
  - **`SCHEME_EFFECT_TUNING`** (split-table for completion effects so the resolver doesn't reach into a single fat record):
    - **`COURTING_AFFECTION_DELTA = 40`** — spec §3.
    - **`SABOTAGE_COMPOSURE_DELTA = -30`** — spec §3.
    - **`SEDUCTION_AFFECTION_DELTA_ON_SUCCESS = 80`** — spec §3 ("+80 affection or discovery → elopement").
    - **`SEDUCTION_DISCOVERY_PROBABILITY = 0.2`** — **NEW pin at P5.** Spec §3 says "discovery roll" without a numeric. Pinned at `0.2` (20% per completion) so 4-of-5 Seductions complete normally and 1-of-5 trigger an Elopement Sprint. The Seduction wealth cost (25) and duration (7 ticks) make 20% feel like a meaningful risk premium without being unforgiving; alternatives considered: 10% (Seductions become rote — discovery is the interactive payoff and 1-in-10 is too rare), 33% (one-third failure rate against a 7-tick commitment is punishing for new players). Document inline that this is a designer-tunable knob open to playtest revision. **Future trait modifiers:** P15 dynasty perks include a "seduction perk" that "halves the discovery-scandal penalty" (spec line 252) but does NOT halve the discovery roll itself; P15's tuning hook reads `SEDUCTION_DISCOVERY_PROBABILITY` and applies its multiplier downstream. Reserved Seduction-perk hook for P15 — at P5, the constant is consumed directly.
    - **`ASSASSINATION_SCANDAL_DELTA = 25`** — spec §3 ("+25 scandal").
  - **`SCHEME_PREREQUISITES: Readonly<Record<SchemeKind, readonly Archetype[]>>`** — archetype prerequisites pinned. The value is a tuple of acceptable archetypes; `[]` means "no archetype prerequisite". Spec §2 line 227 + §3 schemes-table reading:
    | SchemeKind | acceptable archetypes |
    |---|---|
    | `Courting` | `[]` |
    | `Sabotage` | `[]` |
    | `Seduction` | `[]` |
    | `Chaperone` | `["Spymaster"]` |
    | `Smuggling` | `[]` |
    | `Assassination` | `["BohemianRake", "CountryExile"]` |
    - Prerequisite check semantics: the owner house must contain at least one LIVING family member whose `archetype` is in the per-scheme `acceptable` array. Walk `state.characters.values()` filtered by `c.houseId === ownerHouseId AND c.alive === true AND acceptable.includes(c.archetype)`. **Do NOT use `ARCHETYPES.includes(c.archetype)`** — that admits the `"None"` sentinel for unclassified family, which is not the intent. The `acceptable` value comes straight from `SCHEME_PREREQUISITES[kind]`; for kinds with `acceptable.length === 0` (Courting/Sabotage/Seduction/Smuggling), the prerequisite-check branch is skipped entirely. If `acceptable.length > 0` and no character matches, return `{ kind: "MissingArchetype", required: acceptable }`.
  - **`SCHEME_ERA_REQUIREMENTS: Readonly<Record<SchemeKind, "Earlier" | null>>`** — `Smuggling: "Earlier"`; all others `null`. Smuggling can only START in the Earlier era (P13's later era transitions one-way; the rule still applies post-flip but no path will pass the era check then).
  - **All new constants are designer-tuned values per CLAUDE.md §10.** Inline comments cite spec section names (`§3 "Scheme Costs, Durations & Requirements"`) per CLAUDE.md.

- **`src/game/fixtures/schemeIdFactory.ts`** — NEW fixture-adjacent helper. The scheme id generator. **Determinism contract:** scheme ids are deterministic identifiers derived from `(ownerHouseId, kind, startedAtTick, schemeIndexOnThisTick)` where `schemeIndexOnThisTick` is the count of schemes already started by the owner on this same tick (so two same-tick Courting schemes against different targets get distinct ids). Format: ``${ownerHouseId}:${kind}:${startedAtTick}:${index}`` cast to `SchemeId`. **Why a deterministic id, not a UUID:** schemes participate in the hash projection; non-deterministic ids would break the replay-harness 30-run stability NFR (§8). The replay-harness Vitest suite asserts identical hashes — UUID-based ids would diverge across runs even with identical seed.

  **Literal export:**
  ```ts
  // src/game/fixtures/schemeIdFactory.ts
  import type { GameState } from "../entities";
  import type { HouseId, SchemeId } from "../rng";
  import type { SchemeKind } from "../entities";

  export function makeSchemeId(
    state: GameState,
    ownerHouseId: HouseId,
    kind: SchemeKind,
  ): SchemeId {
    // Count existing schemes (Active OR terminal — schemes are never deleted
    // per CLAUDE.md; status flips only) matching (owner, kind, this-tick).
    // The kind partition matters: two same-tick Sabotages against different
    // targets get index 0 and 1; a same-tick Sabotage + Courting both get
    // index 0 for their respective kinds. NO status filter — Completed/
    // Cancelled/Failed schemes accumulate forever and count toward the index.
    let index = 0;
    for (const s of state.schemes.values()) {
      if (s.ownerHouseId === ownerHouseId && s.kind === kind && s.startedAtTick === state.tick) {
        index += 1;
      }
    }
    return `${ownerHouseId}:${kind}:${state.tick}:${index}` as SchemeId;
  }
  ```
  **Imports the helper requires:** `GameState` from `../entities`; `HouseId` / `SchemeId` from `../rng`; `SchemeKind` from `../entities`. Boundary: this file resolves to `game-fixtures` per the existing element pattern; `game-rules` (the schemes.ts resolver consumer) is permitted to import from `game-fixtures` per `eslint.config.js` (verified via existing `import { LOCATION_PIN_COORDS } from "../fixtures/locations"` precedents). **Consumer import in `src/game/rules/schemes.ts`:** `import { makeSchemeId } from "../fixtures/schemeIdFactory";`.
  - **`schemeIndexOnThisTick`** is computed live by counting `state.schemes.values()` filter `(s) => s.ownerHouseId === owner AND s.startedAtTick === tick AND s.kind === kind`. The kind partition matters: if a player starts a Sabotage and a Courting on the same tick, both get index `0` for their respective kinds. Two same-tick Sabotages get `0` and `1`. This indexing is part of the determinism contract — never reorder.
  - **Why not `(owner, target, kind, tick)` as the natural-key form:** Smuggling has no target. The factory pins `schemeIndexOnThisTick` so the id is always well-defined regardless of target presence.

- **Pure rule `src/game/rules/schemes.ts`** — the scheme resolver module. **File-header imports (load-bearing):**
  ```ts
  // src/game/rules/schemes.ts
  import { clamp } from "../util/clamp";                          // canonical helper — DO NOT duplicate-local
  import { getHouseOrThrow, getCharacterOrThrow, getRngStateOrThrow, getSchemeOrThrow } from "../util/lookups";
  import { drawNext } from "../rng";
  import { makeSchemeId } from "../fixtures/schemeIdFactory";
  import { SCHEME_TUNING, SCHEME_PREREQUISITES, SCHEME_ERA_REQUIREMENTS, SEDUCTION_AFFECTION_DELTA_ON_SUCCESS, SEDUCTION_DISCOVERY_PROBABILITY, COURTING_AFFECTION_DELTA, SABOTAGE_COMPOSURE_DELTA, ASSASSINATION_SCANDAL_DELTA, ERA_TRANSITION_TICK } from "../constants";
  import { pruneOrphanedConversationKeys } from "./aging";        // rule-to-rule import; permitted (aging already imports from ../conversation/types)
  import { makePairKey } from "../conversation/types";
  // ... entity / brand type imports ...
  ```
  **`clamp` policy (resolves C13):** `src/game/util/clamp.ts` exists and is on the `game-rules → game-util` allowed boundary per `eslint.config.js`. Existing rules duplicate `function clamp` locally (`bankruptcyEscape.ts:22`, `economy.ts:18`, `locationEffects.ts:29`, `monarchsAudience.ts:34`) — that pattern is technical debt, not a precedent to extend. **P5's `schemes.ts` imports `clamp` from `../util/clamp`** — centralization breaks the duplicate-local drift. A cleanup pass converting the four existing rule files to import-from-util is OUT OF SCOPE for P5 (separate refactor commit; tracked in C-tail).
  **Module-wide lookup convention (load-bearing):** every `state.houses.get(...)`, `state.characters.get(...)`, `state.schemes.get(...)`, and `state.rng.get(...)` call site uses typed lookup helpers from `src/game/util/lookups.ts` per the `travel.ts:46` / `locationEffects.ts` / `monarchsAudience.ts` precedent. The existing helpers cover Character/House/Marriage; P5 adds two more for full coverage:
  ```ts
  // src/game/util/lookups.ts — P5 ADDITIONS adjacent to existing helpers:
  export function getRngStateOrThrow(state: GameState, id: HouseId): RngState {
    const r = state.rng.get(id);
    if (r === undefined) throw new RngNotRegisteredError(id);
    return r;
  }
  export function getSchemeOrThrow(state: GameState, id: SchemeId): Scheme {
    const s = state.schemes.get(id);
    if (s === undefined) throw new SchemeNotFoundError(id);
    return s;
  }
  ```
  Companion typed errors `RngNotRegisteredError` and `SchemeNotFoundError` ship in `src/game/util/errors.ts` mirroring the existing `HouseNotFoundError` / `CharacterNotFoundError` precedent (verified at `errors.ts`). **NEVER use the non-null assertion `state.houses.get(...)!`** even for "houses never deleted" invariant cases — the helper carries a typed error message and the consistency across the module prevents subtle defense drift between branches. Boundary `game-rules → game-util` is allowed per `eslint.config.js:80`. Exports:
  - **`tryStartScheme(state: GameState, ownerHouseId: HouseId, input: StartSchemeInput): StartSchemeResult`** — pure validator + state-mutator. **`ownerHouseId` is threaded from the store-action wrapper**, NOT included in `StartSchemeInput` (which stays UI-shaped — target only). At P5 the wrapper hardcodes `PLAYER_HOUSE_ID`; P8 introduces rival-owned schemes by passing different owners. Atomic gating (CLAUDE.md non-negotiable §5):
    1. **Validate** (in order, first-fail-wins). **Ordering rationale (load-bearing — defines the player-visible toast prose contract):** the order is (a) precondition asserts that throw (programmer-error inputs), (b) resource-availability checks (cheap, structural, owner-house-scoped), (c) era/archetype checks (state-scoped, may degrade as state evolves but cheap to re-evaluate), (d) target-state checks (require dereferencing the target character — done LAST among non-throw cases so a malformed input dies in step (a) before we look up a target that might not exist). **Why InsufficientWealth before TargetIsDead:** wealth is the player's own resource and the most-checked failure mode in actual play (every scheme costs wealth; only a fraction target dead/self characters). Surfacing "Insufficient wealth (need 25, have 12)" as the top error matches player expectation — when the player has the resources but targeted wrong, they get the more-actionable error. Alternative ordering ("target rejections first") was considered and rejected because it would surface generic "Target is deceased" prose even when the cheaper "Insufficient wealth" error would be the real blocker after a stale UI lookup. The rationale is documented inline in the validation block so a future maintainer reordering doesn't break the UX contract silently.
       - `MissingTarget`: kind !== `"Smuggling"` AND `targetCharacterId === null`. Programmer-error from a malformed `StartSchemeInput` — throw `Error` (typed rejection variant not emitted because the UI never submits null for a targeted scheme; the input shape itself documents the requirement). **Why this check runs first:** subsequent target-related checks (`TargetNotFound`, `TargetIsDead`, `SelfTarget`) all dereference `targetCharacterId`; null-narrowing here lets the remaining target checks treat the id as non-null without per-check guards.
       - `TargetNotFound`: kind !== `"Smuggling"` AND target character id doesn't exist in `state.characters`. Programmer-error case; throw `Error`, not a typed rejection.
       - `InsufficientWealth`: owner house wealth < `SCHEME_TUNING[kind].wealthCost`.
       - `MissingArchetype`: prerequisites non-empty AND no living family member matches.
       - `WrongEra`: kind has era requirement AND `state.era` doesn't match.
       - `UnclaimedSmugglingPass`: kind === `"Smuggling"` AND owner house already has `blockadeBypassEarned === true`.
       - `SmugglingPastEraEdge`: kind === `"Smuggling"` AND completion tick (`state.tick + SCHEME_TUNING.Smuggling.durationTicks`) > the canonical era-transition tick. **The era-transition tick is a P13 constant (`ERA_TRANSITION_TICK`) — but P5 references it now.** P5 introduces the constant in `src/game/constants.ts` with the literal export:
         ```ts
         // src/game/constants.ts (P5 addition; P13 owns era-progression semantics):
         //
         // Designer-tunable per-build constant. NOT in hashableState — lives
         // in constants.ts, not on GameState. P13 may revise the value
         // without a save-version bump; replay-harness fixtures rebuild
         // against the live value at test-run time. Spec §3 "Era Progression"
         // mandates a fixed tick threshold; the placeholder 200 corresponds
         // to ~10 in-game years at the project's ~20 ticks/year cadence.
         export const ERA_TRANSITION_TICK = 200 as const;
         ```
         The §7 edge case ("Era-flip during a Smuggling scheme") is honored: a Smuggling scheme that would COMPLETE past the threshold is rejected at start. A Smuggling scheme already in flight when the era flips is NOT cancelled — it proceeds to completion, but the completion path is a no-op on the bypass flag (see "Completion-time effect resolution" below). **Hash-irrelevance Vitest assertion**: ship a structural test in `src/game/constants.test.ts` (NEW or extend existing) that hashes a state, then mutates the imported constant via a `vi.mock(...)` of `constants.ts` to a different value, re-imports, and asserts `hashState(state) === hashState(state)` (same input state, same hash regardless of constant value). This locks the hash-irrelevance claim structurally; without it, a P13 maintainer adding `ERA_TRANSITION_TICK` to `hashableState` silently invalidates the replay-harness across builds.
       - `TargetIsDead`: kind !== `"Smuggling"` AND target character is `alive === false`. (`MissingTarget` + `TargetNotFound` above null-narrowed `targetCharacterId` to a valid live-or-dead character id — this check is now safe.) Schemes against corpses are rejected at start. (Mid-flight death is NOT a retroactive rejection per §7.)
       - `SelfTarget`: kind !== `"Smuggling"` AND target character is in the owner house. (Sabotage/Seduction/Assassination/Chaperone against your own family are nonsensical; Courting on family is also rejected for v1 simplicity.) **Courting/Sabotage/Seduction/Chaperone/Assassination all reject self-targets;** Smuggling has no target so the check is skipped.
    2. **Deduct wealth + register scheme atomically (single new-state return).** Per CLAUDE.md's pure-rule structural-sharing contract, the rule layer NEVER mutates input Maps. Both mutations land in the SAME returned state via hand-rolled shallow Map clones. Literal shape:
       ```ts
       const cost = SCHEME_TUNING[kind].wealthCost;
       const durationTicks = SCHEME_TUNING[kind].durationTicks;
       // getHouseOrThrow matches selectAggressor's defense pattern (consistent
       // across the same module). Imports from src/game/util/lookups.ts —
       // boundary game-rules → game-util allowed per eslint.config.js:80.
       const ownerHouse = getHouseOrThrow(state, ownerHouseId);
       // Aggressor selection: lex-smallest qualifying CharacterId for archetype-gated kinds,
       // otherwise the head of house. SCHEME_PREREQUISITES[kind] drives the branch.
       const aggressorCharacterId = selectAggressor(state, ownerHouseId, kind);
       const newHouses = new Map(state.houses);
       newHouses.set(ownerHouseId, { ...ownerHouse, wealth: ownerHouse.wealth - cost });
       const schemeId = makeSchemeId(state, ownerHouseId, kind);
       const newScheme: Scheme = {
         id: schemeId, kind, ownerHouseId, aggressorCharacterId, targetCharacterId,
         startedAtTick: state.tick, endsAtTick: state.tick + durationTicks,
         status: "Active", resolvedAtTick: null, failureReason: null,
         accumulatedAffection: 0,  // spec §4 line 543; dead data in v1 (one-shot discovery)
       };
       const newSchemes = new Map(state.schemes);
       newSchemes.set(schemeId, newScheme);
       return { ok: true, schemeId, state: { ...state, houses: newHouses, schemes: newSchemes } };
       ```
       Wealth is uncapped (can go negative — bankruptcy-tier classification picks it up next tick per P3's economy phase). Both Map clones happen before the `.set(...)` calls; the new GameState spreads the new Maps in a single returned object. **Never** `state.houses.set(...)` or `state.schemes.set(...)` on the input — both would mutate the caller's state and break the rule-layer immutability contract.

       **`selectAggressor` helper (private to `src/game/rules/schemes.ts`):**
       ```ts
       function selectAggressor(
         state: GameState,
         ownerHouseId: HouseId,
         kind: SchemeKind,
       ): CharacterId {
         const acceptable = SCHEME_PREREQUISITES[kind];
         if (acceptable.length === 0) {
           // No archetype gate → aggressor defaults to the owner's head of house.
           // Uses getHouseOrThrow per the project's lookup-defense convention
           // (travel.ts:46, locationEffects.ts, monarchsAudience.ts all use the
           // same helper). Throws InvalidLookupError on missing house — symmetric
           // with the tryStartScheme snippet's lookup which ALSO uses
           // getHouseOrThrow (NOT the non-null assertion `state.houses.get(...)!`).
           const ownerHouse = getHouseOrThrow(state, ownerHouseId);
           const head = state.characters.get(ownerHouse.headOfHouseCharacterId);
           if (head === undefined || !head.alive) {
             // At P5 the player head is always alive at start-of-tick (no tick-phase
             // succession path exists). Future phases adding tick-phase head mortality
             // (e.g., P11 sibling-rival actions, P13 WarEffort officer deaths) must
             // either gate scheme starts on `head.alive` upstream OR widen this
             // selector to fall back to the next-in-line successor. The defensive
             // throw catches the bug before a scheme silently binds to a dead head.
             throw new Error(`selectAggressor: head ${ownerHouse.headOfHouseCharacterId} of ${ownerHouseId} is not alive — scheme cannot select an aggressor`);
           }
           return ownerHouse.headOfHouseCharacterId;
         }
         // Archetype-gated kind → lex-smallest CharacterId among living
         // family members whose archetype is in `acceptable`. This MUST
         // match the candidate set the prereq-check at tryStartScheme's
         // validation step inspects — both branches walk
         // state.characters.values() with the same filter.
         const matches: CharacterId[] = [];
         for (const c of state.characters.values()) {
           if (c.houseId === ownerHouseId && c.alive && acceptable.includes(c.archetype)) {
             matches.push(c.id);
           }
         }
         matches.sort();  // lex-sort by CharacterId; deterministic across replay
         if (matches.length === 0) {
           // Programmer-error: tryStartScheme's validation should have
           // already returned MissingArchetype. Reaching here means the
           // caller bypassed validation.
           throw new Error(`selectAggressor: no qualifying family member in ${ownerHouseId} for kind=${kind}`);
         }
         return matches[0]!;
       }
       ```
       **Invariant:** the same character set is walked at validation (`MissingArchetype` check) and at aggressor selection — so a non-empty `acceptable` filter either rejects the entire scheme at start OR returns at least one match here. The throw is defense-in-depth against future refactors that decouple the two walks.
    - Return shape (success variant carries the new `GameState` because the store wrapper applies it via `overwriteFromGameState(draft, result.state)`; mirrors P3's pre-tick action result shape):
      ```ts
      type StartSchemeResult =
        | { ok: true; schemeId: SchemeId; state: GameState }
        | { ok: false; reason: StartSchemeRejection };
      type StartSchemeRejection =
        | { kind: "InsufficientWealth"; have: number; need: number }
        | { kind: "MissingArchetype"; required: readonly Archetype[] }
        | { kind: "WrongEra"; required: "Earlier" | "Later"; current: "Earlier" | "Later" }
        | { kind: "UnclaimedSmugglingPass" }
        | { kind: "SmugglingPastEraEdge"; completionTick: number; eraTransitionTick: number }
        | { kind: "TargetIsDead"; targetId: CharacterId }
        | { kind: "SelfTarget"; targetId: CharacterId };
        // P8+ forward-compat reservation: when rival heads can die mid-tick
        // (P11 sibling-rival action paths, P13 WarEffort officer deaths), add
        // `| { kind: "HeadOfHouseDead"; ownerHouseId: HouseId }` to this union
        // AND convert selectAggressor's defense-in-depth throw at the
        // head.alive check into a typed rejection. At P5 the throw is correct
        // because the player head is always alive at start-of-tick (no
        // tick-phase succession exists yet) — the typed rejection variant
        // can be added incrementally.
      ```
    - **No PRNG draws** in `tryStartScheme`. The start path is deterministic in shape AND in draw budget (zero). Future phases that add randomized start outcomes MUST bump past v6 because the determinism contract would change.

  - **`cancelScheme(state: GameState, schemeId: SchemeId): CancelSchemeResult`** — pure mutator. Player-initiated cancellation. Validate:
    - `SchemeNotFound`: id not in `state.schemes`.
    - `SchemeNotActive`: status !== `"Active"`. (Cancelling an already-Completed/Cancelled/Failed scheme is a player-visible rejection, not a silent no-op — surfaces "this scheme already ended".)
    - On valid cancel: flip status to `"Cancelled"`, set `resolvedAtTick = state.tick`, NO wealth refund (per spec line 362).
    - Return shape (mirrors `StartSchemeResult` — success variant carries the new `GameState`):
      ```ts
      type CancelSchemeResult =
        | { ok: true; state: GameState }
        | { ok: false; reason: CancelSchemeRejection };
      type CancelSchemeRejection =
        | { kind: "SchemeNotFound"; schemeId: SchemeId }
        | { kind: "SchemeNotActive"; schemeId: SchemeId; currentStatus: SchemeStatus };
      ```

  - **`applySchemeResolutionPhase(state: GameState): GameState`** — the orchestrator phase function. Replaces the P1 `identityPhase` at PHASES slot 5 ("scheme resolution"). **TWO-PASS resolver** per spec §7 line 642 (Chaperone "preempts" in-flight Seduction): pass 1 walks Chaperones (which may flip same-tick Seductions to `Cancelled` BEFORE pass 2 sees them); pass 2 walks all other resolving schemes. Both passes are left-folds with lex-sort-by-SchemeId within their kind partition. Transitions returned by the resolver are discarded at the phase level — the post-fold state's `failureReason`/`status` fields are the diff-helper's source of truth. Literal body:
    ```ts
    export function applySchemeResolutionPhase(state: GameState): GameState {
      // (1) Filter FIRST, then partition by kind, then lex-sort within each
      //     partition. state.tick has already advanced via phase 1; this
      //     tick's resolving schemes are those whose endsAtTick === state.tick.
      const chaperoneIds: SchemeId[] = [];
      const otherIds: SchemeId[] = [];
      for (const [id, scheme] of state.schemes) {
        if (scheme.status !== "Active" || scheme.endsAtTick !== state.tick) continue;
        if (scheme.kind === "Chaperone") {
          chaperoneIds.push(id);
        } else {
          otherIds.push(id);
        }
      }
      chaperoneIds.sort(); // lex-sort by SchemeId within Chaperone partition
      otherIds.sort();     // lex-sort by SchemeId within other-kinds partition

      // (2) Pass 1: Chaperones. May flip same-tick Seductions to "Cancelled"
      //     BEFORE pass 2 sees them. Preserves spec §7 "Chaperone preempts"
      //     semantics regardless of owner-house lex-ordering — P8 introduces
      //     rival-owned schemes where the SchemeId-only lex-sort would
      //     interleave Chaperone and Seduction starts; this partition
      //     guarantees Chaperone-first deterministically.
      const afterChaperones = chaperoneIds.reduce<GameState>((acc, id) => {
        const scheme = acc.schemes.get(id);
        if (scheme === undefined || scheme.status !== "Active") return acc;
        return resolveSchemeCompletion(acc, scheme).state;
      }, state);

      // (3) Pass 2: all other kinds. Reads each scheme from acc.schemes.get(id)
      //     (not from a captured ref) so a pass-1 Chaperone's cancel of a
      //     same-tick Seduction is visible — the Seduction's resolver
      //     short-circuits on status !== "Active".
      return otherIds.reduce<GameState>((acc, id) => {
        const scheme = acc.schemes.get(id);
        if (scheme === undefined || scheme.status !== "Active") return acc;
        return resolveSchemeCompletion(acc, scheme).state;
      }, afterChaperones);
    }
    ```
    - **Why two passes rather than a single ordering convention.** At P5, lex-sort by SchemeId happens to put `Chaperone` before `Seduction` alphabetically (and the only owner is `PLAYER_HOUSE_ID`), so a single-pass left-fold would yield the same outcome. But at P8 with rival-owned schemes, the SchemeId format `${ownerHouseId}:${kind}:${tick}:${index}` lex-sorts by owner FIRST — a `rivalHouseA:Chaperone:5:0` sorts AFTER `playerHouse:Seduction:5:0`, and the player's Seduction would resolve (firing its discovery roll, advancing PRNG, possibly completing) before the rival's preemptive Chaperone. The two-pass split makes Chaperone-preempts-Seduction a structural contract, not a lex-sort coincidence.
    - **Draw budget per phase call:** 1 per `Active Seduction` resolving on this tick that survives pass 1 (Chaperones may cancel some Seductions in pass 1; cancelled Seductions do NOT fire their discovery draw in pass 2 because the resolver short-circuits on `status !== "Active"`). At P5 with single-owner, every Chaperone targets a specific character so only Seductions on that character get cancelled; other Seductions resolve normally. The draw count is deterministic across replay because the pass-1 cancellations are deterministic (lex-sort within Chaperone partition).
    - **No transition array threading.** Per resolver returns `{state, transition}`; the phase consumes only `state` and discards `transition`. The store wrapper's `publishSchemeTransitions(before, after)` diff helper re-derives transitions from the on-entity `status` + `failureReason` fields — the events are emitted post-fold, not mid-fold.

  - **`resolveSchemeCompletion(state, scheme): { state, transition }`** — per-scheme resolver invoked from the phase. Pure function. Returns the new state AND a `SchemeTransition` discriminated union (the orchestrator's wrapper emits this to the event bus on the publish step). **`SeductionDiscovered` is its OWN terminal transition, not a sub-variant of `Failed`** — this avoids double-publish to P9 (which subscribes only to `SeductionDiscovered`) and keeps the failure-reason set tight (other failure modes don't overlap with discovery):
    ```ts
    type SchemeTransition =
      | { kind: "Completed"; schemeId: SchemeId }
      | { kind: "Cancelled"; schemeId: SchemeId } // emitted from cancelScheme, never from the resolution phase
      | { kind: "Failed"; schemeId: SchemeId; reason: SchemeFailureReason }
      | { kind: "SeductionDiscovered"; schemeId: SchemeId; targetCharacterId: CharacterId };
    type SchemeFailureReason =
      | { kind: "TargetDiedDuringFlight"; targetId: CharacterId }
      | { kind: "EraFlippedDuringSmuggling" };
    ```
    **Status-field mapping**: every terminal transition flips `Scheme.status` exclusively to one of `"Completed" | "Cancelled" | "Failed"` — `SeductionDiscovered` transitions write `status: "Failed"` to the scheme entity (the player's scheme did NOT succeed at planting affection), but the *event* surfaced to subscribers is `SeductionDiscovered` (so P9 wires its elopement-sprint kickoff against the discovery event specifically, NOT against the generic `SchemeFailed` event). The `Failed` status-field value is the recap shown in the ledger; the bus event tells P9 what to do. **No `SchemeFailed` event fires on the discovery path** — only `SeductionDiscovered`. Single-publish contract.

  - **Shared resolver helpers (private to `src/game/rules/schemes.ts`).** Two small utilities consumed by every per-kind branch:
    ```ts
    // Clones state.schemes, mutates one entry's status + resolvedAtTick +
    // failureReason, returns new GameState. NEVER mutates input. Caller
    // passes the prior baseState (which may already carry other mutations
    // from earlier in the per-kind branch — e.g., affectionMap or rng
    // changes); this helper only touches state.schemes. resolvedAtTick is
    // set to baseState.tick. failureReason is required for newStatus ===
    // "Failed" (typed reason), null otherwise. Completed/Cancelled set
    // failureReason: null.
    function flipSchemeStatus(
      baseState: GameState,
      schemeId: SchemeId,
      newStatus: "Completed" | "Cancelled",
    ): GameState;
    function flipSchemeStatus(
      baseState: GameState,
      schemeId: SchemeId,
      newStatus: "Failed",
      failureReason: SchemeFailureReasonKind,
    ): GameState;
    // Implementation signature: failureReason is REQUIRED (no default) so
    // the 3-arg form fails to typecheck for Failed. The overload-3 default-
    // null variant from earlier plan drafts is DROPPED — the bug class
    // `flipSchemeStatus(state, id, "Failed")` (missing reason → stored null
    // → mapFailureReasonToPayload throws state-corruption) cannot occur
    // because the implementation signature requires `failureReason`.
    function flipSchemeStatus(
      baseState: GameState,
      schemeId: SchemeId,
      newStatus: Exclude<SchemeStatus, "Active">,
      failureReason: SchemeFailureReasonKind | null,
    ): GameState {
      const scheme = baseState.schemes.get(schemeId);
      if (scheme === undefined) {
        throw new Error(`flipSchemeStatus: scheme ${schemeId} not found`);
      }
      const newSchemes = new Map(baseState.schemes);
      newSchemes.set(schemeId, {
        ...scheme, status: newStatus, resolvedAtTick: baseState.tick,
        failureReason: newStatus === "Failed" ? failureReason : null,
      });
      return { ...baseState, schemes: newSchemes };
    }
    ```
    **All non-Failed call sites pass `null` explicitly:** `flipSchemeStatus(state, id, "Completed", null)` and `flipSchemeStatus(state, id, "Cancelled", null)`. The two overload signatures preserve the documented contract (Failed REQUIRES reason; Completed/Cancelled do NOT carry a reason), but the implementation enforces it via the required parameter. **Update per-kind resolver call sites accordingly:** every `flipSchemeStatus(state, id, "Completed")` becomes `flipSchemeStatus(state, id, "Completed", null)`; every `flipSchemeStatus(state, id, "Cancelled")` becomes `flipSchemeStatus(state, id, "Cancelled", null)`. The Seduction `Failed` paths already pass the 4-arg form with the reason — no change.
    **`makePairKey` import home pinned**: import from `src/game/conversation/types.ts` (the shared module that lives in the `game-conversation-types` ESLint element, which the `game-rules` element is permitted to import from per `eslint.config.js:26`). Mirrors the existing `aging.ts` import pattern (`import { parsePairKey } from "../conversation/types";` at `aging.ts:16`).

  - **Completion-time effect resolution per `SchemeKind`:**
    - **Courting** — apply `+40 affection` to `state.affectionMap[(ownerHouseId, targetCharacterId)]` (clamped `[0, 100]` at the mutation site). Transition: `Completed`. Status-flip call site (literal): `flipSchemeStatus(stateWithAffection, scheme.id, "Completed", null)` — explicit `null` for the failureReason 4th arg per the impl signature. If target died mid-flight: `flipSchemeStatus(state, scheme.id, "Failed", "TargetDied")`, no affection mutation. Hash-projection-relevant.
    - **Sabotage** — apply `−30 composure` to `state.characters[targetCharacterId].composure` (clamped `[0, maxComposure]` per CLAUDE.md non-negotiable §6). Append a new `Grievance` to the TARGET's `house.grievances` array: `{ id, perpetratorHouseId: ownerHouseId, source: "Sabotage", schemeId, recordedAtTick: state.tick, resolved: false }`. Grievance id factory: ``${perpetratorHouseId}:Sabotage:${schemeId}`` cast to `GrievanceId` (deterministic, derived from scheme id which is itself deterministic). Transition: `Completed`. Status-flip call site (literal): `flipSchemeStatus(stateWithGrievance, scheme.id, "Completed", null)` after all six mutation surfaces are applied (owner.wealth handled at start; target.composure clone; target's house.grievances append clone; scheme.status flip; scheme.resolvedAtTick set; scheme.failureReason: null — all in one returned state via shallow Map clones). If target died: `flipSchemeStatus(state, scheme.id, "Failed", "TargetDied")`, no composure mutation, no grievance recorded.
    - **Seduction** — discovery roll FIRST: draw from the owner's per-house RNG. The same Map-clone + set discipline as `moods.ts` applies — the rng Map is cloned, the post-draw `RngState` is recorded via `.set(ownerHouseId, postDraw)`, and the new GameState carries the updated rng Map. Literal shape:
      ```ts
      // Inside resolveSchemeCompletion's Seduction branch:
      const target = state.characters.get(scheme.targetCharacterId!)!;
      if (!target.alive) {
        // Target-dead branch: NO draw, NO mutation beyond status flip.
        // Preserves the per-house RNG call-count invariant.
        return {
          state: flipSchemeStatus(state, scheme.id, "Failed", "TargetDied"),
          transition: { kind: "Failed", schemeId: scheme.id, reason: { kind: "TargetDiedDuringFlight", targetId: scheme.targetCharacterId! } },
        };
      }
      // RngState lookup helper: there is NO existing `getOrThrow` for arbitrary
      // Maps in this project. The existing lookup helpers at
      // src/game/util/lookups.ts cover Character/House/Marriage; P5 introduces
      // `getRngStateOrThrow(state, houseId)` alongside them with the same shape:
      // returns RngState or throws RngNotRegisteredError (NEW typed error class
      // in src/game/util/errors.ts, mirroring HouseNotFoundError precedent).
      // Implementation lives in `src/game/util/lookups.ts`; consumed by every
      // rules-layer site that reads state.rng (moods.ts already inlines an
      // equivalent throw pattern at lines 31-33 — P5's lookups.ts addition
      // optionally subsumes that pattern in a follow-up cleanup; P5 itself
      // ships ONLY the addition + schemes.ts consumption).
      const rngState = getRngStateOrThrow(state, scheme.ownerHouseId);
      // drawNext returns { next: number; rngState: RngState } per src/game/rng.ts:71.
      // Rename via destructure: { next, rngState: postDraw } — using "state" as the
      // rename target would shadow the outer state and produce undefined.
      const { next, rngState: postDraw } = drawNext(rngState);
      const discovered = next < SEDUCTION_DISCOVERY_PROBABILITY;
      const newRng = new Map(state.rng);
      newRng.set(scheme.ownerHouseId, postDraw);
      const baseState = { ...state, rng: newRng };
      if (discovered) {
        const stateWithStatus = flipSchemeStatus(baseState, scheme.id, "Failed", "Discovered");
        return { state: stateWithStatus, transition: { kind: "SeductionDiscovered", schemeId: scheme.id, targetCharacterId: scheme.targetCharacterId! } };
      }
      // Not-discovered: apply +80 affection (clamped), flip to Completed.
      const newAffection = new Map(baseState.affectionMap);
      const key = makePairKey(scheme.ownerHouseId, scheme.targetCharacterId!);
      const current = newAffection.get(key) ?? 0;
      newAffection.set(key, clamp(current + SEDUCTION_AFFECTION_DELTA_ON_SUCCESS, 0, 100));
      const stateWithAffection = { ...baseState, affectionMap: newAffection };
      const stateWithStatus = flipSchemeStatus(stateWithAffection, scheme.id, "Completed", null);
      return { state: stateWithStatus, transition: { kind: "Completed", schemeId: scheme.id } };
      ```
      Discovery semantics: if `discovered`, the bus emits exactly ONE event — `SeductionDiscovered`, NEVER `SchemeFailed`. The scheme's `status` field flips to `"Failed"` (so the ledger shows it as failed) while the bus event tells P9 to launch the elopement sprint. **The elopement-sprint overlay is NOT launched from this phase** — P9's overlay listens for `SeductionDiscovered` on `runtime/events/scheme.ts`. P5 emits the event but does not render the overlay.
      **RNG threading invariant:** the target-dead branch returns WITHOUT touching the rng Map — that preserves the per-house call-count invariant (a Seduction completing against a dead target does NOT advance the draw count, so replay-harness 30-run stability is unaffected). Only the live-target branch advances the count by exactly 1.
    - **Chaperone** — find ALL active Seductions targeting the same character: `state.schemes.values().filter(s => s.kind === "Seduction" AND s.status === "Active" AND s.targetCharacterId === chaperoneTargetCharacterId)`. **Lex-sort the matched seductions by `SchemeId`** before flipping their status (determinism — the cancellation order doesn't affect outcomes, but the resolution order is part of the contract). Flip each matched Seduction via `flipSchemeStatus(state, matchedSeductionId, "Cancelled", null)` (NOT `Failed` — the Chaperone is a pre-emptive defensive cancel, semantically distinct from discovery). The Chaperone itself transitions via `flipSchemeStatus(stateAfterCancels, scheme.id, "Completed", null)`. **No wealth refund** to the seducing house (consistent with player-initiated cancellation; spec line 362 generalizes). **Target lex-sort consideration:** a Chaperone "on" target X means the chaperone protects X from Seductions; the target is the *protected character*. The acceptable target characters: any character in any house — the spec doesn't restrict by house, and the rule layer doesn't either. (Realistically, the player chaperones their own family members against rivals' Seductions — but the rule layer is target-id-only.) If chaperone target died mid-flight: `flipSchemeStatus(state, scheme.id, "Failed", "TargetDied")`, no matching seductions cancelled. If no matching seductions exist: `flipSchemeStatus(state, scheme.id, "Completed", null)` (the chaperone was vigilant for nothing — still resolves cleanly; spec doesn't define a "wasted chaperone" semantics, so default to completed).
    - **Smuggling** — completion-time era check FIRST: if `state.era !== "Earlier"` (era flipped between start and completion despite the start-time guard — only possible if `ERA_TRANSITION_TICK` is mutated by P13 *after* the Smuggling started, which the v1 P13 doesn't do, but the defensive check is required by spec §7): transition `Failed { EraFlippedDuringSmuggling }`, no flag set. Otherwise: set `house.blockadeBypassEarned = true` via a Map clone. Literal shape:
      ```ts
      // Inside resolveSchemeCompletion's Smuggling branch:
      if (state.era !== "Earlier") {
        return {
          state: flipSchemeStatus(state, scheme.id, "Failed", "EraFlipped"),
          transition: { kind: "Failed", schemeId: scheme.id, reason: { kind: "EraFlippedDuringSmuggling" } },
        };
      }
      // Use getHouseOrThrow per the module's lookup-defense convention
      // (consistent with tryStartScheme + selectAggressor — see B16 rationale).
      const ownerHouse = getHouseOrThrow(state, scheme.ownerHouseId);
      const newHouses = new Map(state.houses);
      newHouses.set(scheme.ownerHouseId, { ...ownerHouse, blockadeBypassEarned: true });
      const baseState = { ...state, houses: newHouses };
      const stateWithStatus = flipSchemeStatus(baseState, scheme.id, "Completed", null);
      return { state: stateWithStatus, transition: { kind: "Completed", schemeId: scheme.id } };
      ```
      (Smuggling has no target character; the `TargetDiedDuringFlight` branch is not reachable. No PRNG draws.)
    - **Assassination** — set `state.characters[targetCharacterId].alive = false` and `state.characters[targetCharacterId].diedAtTick = state.tick`. Apply `+25 scandal` to the OWNER house (clamped `[0, 100]`). The character entity is NOT removed (CLAUDE.md "Characters/Houses/Marriages are never deleted; status flips only"). **Death-cascade pure-rule call (NEW at P5).** Assassination is the first tick-phase path that can kill a character. The existing `applyAgingStep` (`src/game/rules/aging.ts`) inlines the conversation-history + affection-map orphan-prune logic at lines 41-54 (verified: `let conversationHistory = state.conversationHistory;` at `:41`, `let affectionMap = state.affectionMap;` at `:42`, `if (newlyDead.size > 0) { ... }` block at `:43-54`), but `applyAgingStep` runs ONLY in `runYearPass`, NOT in any tick phase. P5 therefore EXTRACTS the orphan-prune body into a shared pure helper `pruneOrphanedConversationKeys(state: GameState, newlyDeadCharIds: ReadonlySet<CharacterId>): GameState` in `src/game/rules/aging.ts` (alongside `applyAgingStep`, NOT in a separate file — keeps the death-cascade logic colocated). The Assassination resolver branch calls this helper with `new Set<CharacterId>([scheme.targetCharacterId!])` after flipping alive=false, in the same returned state. `applyAgingStep` is refactored to delegate to the same helper for its existing orphan-prune body — symmetry between tick-phase deaths and year-pass deaths. **Type-narrow at aging.ts call site (literal edit):** the existing line `aging.ts:22` reads `const newlyDead = new Set<string>();` — explicit `string` generic. Under strict TS the call `pruneOrphanedConversationKeys(state, newlyDead)` fails because the helper expects `ReadonlySet<CharacterId>` (branded). The literal edit is:
```ts
// BEFORE (aging.ts:22):
const newlyDead = new Set<string>();
// AFTER (P5):
const newlyDead = new Set<CharacterId>();
```
The downstream `newlyDead.add(charId)` typechecks because `sortedCharIds: CharacterId[]` (the result of `[...state.characters.keys()].sort()` on a `Map<CharacterId, Character>`); `state.characters.keys()` returns `IterableIterator<CharacterId>` already. No `as CharacterId` casts needed.

**`pruneOrphanedConversationKeys` literal body and `applyAgingStep` refactor (per CLAUDE.md heir-inheritance preservation).** The helper OWNS all orphan-prune state synthesis — `conversationHistory`, `affectionMap`, and the returned GameState's identity. `applyAgingStep` no longer manages those Maps directly; it just builds `newlyDead` and delegates. Literal pair:
```ts
// src/game/rules/aging.ts (NEW helper, exported alongside applyAgingStep):
//
// === VERBATIM MIGRATION of the heir-promotion safety block from
// applyAgingStep's top-of-function comment (aging.ts:8-14 before P5). The
// invariant moves with the body; the original 7-line comment is preserved
// word-for-word so future maintainers reading the helper see the same
// rationale that drove the original P4 design: ===
//
// P4: extended with conversation-history + affection-map orphan-prune. When
// an NPC dies (alive: true → false in this step), entries in
// state.conversationHistory and state.affectionMap keyed on that NPC's
// character ID are removed. Heir-promotion safety: the prune filters by
// parsePairKey(key).characterId (the TARGET half), NOT by houseId — so
// when the PLAYER head dies, conversation history and affection are
// preserved (heir inherits both via the pair-key's stable houseId half).
//
// === END VERBATIM MIGRATION. P5 additions below (NOT in the original): ===
//
// Pure rule; never mutates inputs. Future "simplifications" of the filter
// shape break heir succession — this comment block is load-bearing.
export function pruneOrphanedConversationKeys(
  state: GameState,
  newlyDeadCharIds: ReadonlySet<CharacterId>,
): GameState {
  if (newlyDeadCharIds.size === 0) return state;
  const histFiltered = new Map(state.conversationHistory);
  for (const key of histFiltered.keys()) {
    if (newlyDeadCharIds.has(parsePairKey(key).characterId)) histFiltered.delete(key);
  }
  const affFiltered = new Map(state.affectionMap);
  for (const key of affFiltered.keys()) {
    if (newlyDeadCharIds.has(parsePairKey(key).characterId)) affFiltered.delete(key);
  }
  return { ...state, conversationHistory: histFiltered, affectionMap: affFiltered };
}

// applyAgingStep AFTER P5 (replaces the inline prune block at :41-54):
export function applyAgingStep(state: GameState): GameState {
  const sortedCharIds = [...state.characters.keys()].sort();
  const characters = new Map(state.characters);
  const newlyDead = new Set<CharacterId>();
  for (const charId of sortedCharIds) {
    const char = characters.get(charId);
    if (char === undefined || !char.alive) continue;
    const nextAge = char.age + 1;
    const dies = nextAge >= char.deathAge;
    const updated: Character = {
      ...char, age: nextAge, alive: !dies,
      diedAtTick: dies ? state.tick : char.diedAtTick,
    };
    characters.set(charId, updated);
    if (dies) newlyDead.add(charId);
  }
  // Delegate orphan-prune to the helper. Passing { ...state, characters }
  // forwards the already-aged characters Map; the helper owns the
  // conversationHistory/affectionMap synthesis and returns the full new state.
  return pruneOrphanedConversationKeys({ ...state, characters }, newlyDead);
}
```
**Lines to delete from current aging.ts:** the `let conversationHistory = state.conversationHistory;` setup at `:41`, the `let affectionMap = state.affectionMap;` at `:42`, the `if (newlyDead.size > 0) { ... }` block at `:43-54`, and the existing `return { ...state, characters, conversationHistory, affectionMap };` at `:56`. Replace with the single `return pruneOrphanedConversationKeys(...)` call shown above. The heir-inheritance comment block at `:8-14` migrates verbatim into the new helper's top-of-function comment (the load-bearing invariant moves with the body). **Heir-inheritance comment preservation (load-bearing):** the comment block at `aging.ts:8-14` ("Heir-promotion safety: the prune filters by `parsePairKey(key).characterId` (the TARGET half), NOT by houseId") encodes a non-obvious invariant about why heir succession preserves conversation history — that comment MUST migrate with the extracted body into `pruneOrphanedConversationKeys`'s top-of-function block, NOT remain stranded in `applyAgingStep`. Without it, a future maintainer "simplifying" the filter shape could silently break heir inheritance. **Why a pure rule helper, not an event listener:** the prune is a state mutation (removes keys from Maps); event listeners can't mutate game state without going through the store, and that breaks the rule-layer pure-function contract. **Important:** Assassination completing on this tick means the target died THIS tick, AFTER the location-effects/mood-drift phases have already run (those run earlier in the orchestrator). So the target's per-tick mood-drift draws fired normally on the death tick. Transition: `Completed`. Status-flip call site (literal): `flipSchemeStatus(stateAfterKillAndPrune, scheme.id, "Completed", null)` after the alive=false flip, scandal mutation, and `pruneOrphanedConversationKeys` call have all built up the final state. If target died from another source (sibling rival action, natural causes, duel) between start and completion: `flipSchemeStatus(state, scheme.id, "Failed", "TargetDied")`, no kill applied, no orphan-prune (target's keys already pruned at original death). The +25 scandal is NOT applied on Failed.
  - **Returning structural-sharing:** every per-kind branch follows the CLAUDE.md hand-rolled shallow Map clone pattern. The resolver returns a new GameState; never mutates input. P5's resolver test asserts input-state immutability via `Object.isFrozen` checks on the input maps after the call (cheap and high-signal).

- **`src/runtime/tickOrchestrator.ts` extended.** PHASES slot 5 changes from `identityPhase` to `applySchemeResolutionPhase`:
  ```ts
  const PHASES: readonly TickPhase[] = [
    advanceTickPhase,            // 1. time advance
    applyEconomyPhase,           // 2. economy
    applyLocationEffectsPhase,   // 3. location effects (P3)
    identityPhase,               // 4. courier draining (P1 stub)
    applySchemeResolutionPhase,  // 5. scheme resolution (P5 — NEW)
    identityPhase,               // 6. global-event roll (P1 stub)
    applyMoodDriftPhase,         // 7. mood drift
    identityPhase,               // 8. rival-house action roll (P1 stub — ALWAYS last)
  ] as const;
  ```
  **Boundary impact:** the import from `../game/rules/schemes` is allowed by the existing `runtime-tick-orchestrator` element's `default: "allow"` posture. No `eslint.config.js` edit. Same shape as the existing `applyEconomyPhase` / `applyLocationEffectsPhase` / `applyMoodDriftPhase` imports.

  **Phase ordering rationale (P5-specific):** schemes resolve at phase 5 (after location-effects, courier-draining; before global-event roll, mood-drift, rival-action). The reasoning:
  - **After location-effects** so a Sabotage-completing-this-tick reads the post-location target composure (e.g., the target is at a wardrobe-decay-penalty location and lost composure THIS tick from the decay — the Sabotage's −30 applies to the already-decayed value).
  - **Before mood-drift** so the discovery/death/composure consequences of completions are visible to the mood-drift roll on the SAME tick. A Sabotage-driven composure drop should be eligible to trigger a Defensive mood lock in the same tick's mood-drift pass. (P5 doesn't wire composure-driven mood transitions — that's an edge condition in the existing P4 faux-pas mechanic — but the ordering preserves the option for future phases.)
  - **Before rival-action** so the rival house's per-tick reaction (P8) sees the scheme outcomes on this tick. A rival who just got Sabotaged should be eligible to retaliate immediately (P8 reads `state.houses.get(rivalId).grievances` to weight retaliation).
  - The CLAUDE.md "rivals always run last" rule is preserved: phase 8 is still the rival action phase.

- **`src/game/store.ts` extended with new player actions.** Adds three `StoreActions`:
  ```ts
  type StoreActions = {
    // ... existing actions ...
    // P5 additions:
    startScheme: (input: StartSchemeInput) =>
      | { ok: true; schemeId: SchemeId }
      | { ok: false; reason: StartSchemeRejection };
    cancelScheme: (schemeId: SchemeId) =>
      | { ok: true }
      | { ok: false; reason: CancelSchemeRejection };
  };
  ```
  **`StartSchemeInput` shape:**
  ```ts
  type StartSchemeInput = {
    kind: SchemeKind;
    targetCharacterId: CharacterId | null;  // null only for Smuggling
  };
  ```
  **Schemes do NOT advance the tick on start.** The pre-tick-action pattern from P3 (`travel`/`requestAudience`/`escapeBankruptcy`/`refreshWardrobe`) consumes a tick — but schemes are different: starting a scheme is a free action (the wealth cost IS the cost; no tick consumed at start). Spec §3 line 73: "Each ballroom session also surfaces buttons to start any of six schemes against the selected target..." — schemes launch mid-ballroom alongside conversation actions, none of which advance the tick. The tick advances via the existing tick-consuming actions (travel, audience, "wait one tick"). The orchestrator's scheme-resolution phase (slot 5) fires on every tick advance.

  **Literal `endsAtTick` math trace (Courting, 5-tick duration):**
  - Player calls `startScheme({kind: "Courting", target: X})` at state.tick = 5. `tryStartScheme` registers the scheme with `startedAtTick: 5, endsAtTick: 5 + 5 = 10`. State.tick stays at 5 (no advance).
  - Player calls `travel(...)` later (or any tick-consuming action). The orchestrator's phase chain runs: phase 1 advances state.tick from 5 → 6. Phase 5 runs `applySchemeResolutionPhase(state)` with state.tick=6; the filter `s.endsAtTick === state.tick` does NOT match (10 !== 6). No resolution.
  - Player calls more tick-consuming actions. Each one advances state.tick by 1 via phase 1, then phase 5 checks. The Courting scheme stays Active while state.tick is 6, 7, 8, 9.
  - When state.tick advances from 9 → 10 (phase 1 of some tick-advancing action's orchestrator pass), phase 5 sees state.tick === 10 === scheme.endsAtTick → the filter matches → `resolveSchemeCompletion` fires → +40 affection applied → status flips to "Completed".
  
  **Off-by-one prevention:** `endsAtTick = state.tick + durationTicks` is set at start with state.tick equal to the PRE-advance tick (state.tick hasn't moved since `startScheme` is a free action). Resolution check uses `===` against the POST-advance tick. So a 5-tick scheme started at tick=5 resolves at tick=10 (5 + 5), spending 5 full tick-advances between launch and resolution. Equivalent player-time: 5 tick-consuming actions after the launch.

  Action shape (block-form `set` matching `advanceTick` precedent at `store.ts:177-180`):
  ```ts
  startScheme: (input) => {
    const state = get();
    // At P5: owner is always PLAYER_HOUSE_ID. P8 will route rival-owned
    // schemes through a different entry point that passes a different owner.
    const result = tryStartScheme(state, PLAYER_HOUSE_ID, input);
    if (!result.ok) return { ok: false, reason: result.reason };
    set((draft) => {
      // LOAD-BEARING INVARIANT: startScheme NEVER calls advanceTickPure.
      // Starting a scheme is a FREE ACTION (wealth cost IS the cost; no
      // tick is consumed at start). DO NOT add advanceTickPure by analogy
      // with the P3 pre-tick action pattern (travel/audience/escape/refresh
      // — those consume a tick; schemes do NOT). Adding it would mutate
      // endsAtTick semantics: a Courting started at tick=5 with duration=5
      // has endsAtTick=10, but if the tick advances to 6 immediately, the
      // scheme has 4 ticks remaining instead of 5. See Vitest invariant
      // assertion below: `before.tick === after.tick` after startScheme.
      overwriteFromGameState(draft, result.state);
    });
    // SchemeStarted's tick === result.state.tick === pre-set state.tick ===
    // scheme.startedAtTick. The three are equal by the no-tick-advance
    // invariant above; lock the equivalence in a Vitest assertion so a
    // future maintainer can't break it silently.
    schemeBus.publish({
      kind: "SchemeStarted", tick: result.state.tick, schemeId: result.schemeId,
      schemeKind: input.kind, ownerHouseId: PLAYER_HOUSE_ID,
      targetCharacterId: input.targetCharacterId,
      endsAtTick: result.state.schemes.get(result.schemeId)!.endsAtTick,
    });
    return { ok: true, schemeId: result.schemeId };
  },
  cancelScheme: (schemeId) => {
    const state = get();
    const result = cancelScheme(state, schemeId);
    if (!result.ok) return { ok: false, reason: result.reason };
    set((draft) => {
      overwriteFromGameState(draft, result.state);   // NO advanceTickPure
    });
    // Look up the cancelled scheme on the BEFORE state. P5 INVARIANT:
    // cancellation ONLY mutates `status` and `resolvedAtTick`; kind/owner/
    // targetCharacterId remain unchanged, so reading from the pre-set
    // snapshot is equivalent to reading from result.state for those fields.
    // **LOAD-BEARING CONVENTION FOR FUTURE PHASES:** if any future phase
    // extends cancelScheme to mutate wealth (e.g., "P8 partial-rebate on
    // player-initiated cancel"), composure, scandal, or any other side-
    // mutation, this read MUST switch to post-set reads (`get().schemes.get(...)`
    // after the `set` returns) to publish post-rebate values. The current
    // pre-set read is correct ONLY because cancellation is currently a
    // pure status flip with no side-mutations.
    const cancelled = state.schemes.get(schemeId)!; // SchemeNotFound was rejected above
    schemeBus.publish({
      kind: "SchemeCancelled", tick: result.state.tick, schemeId,
      schemeKind: cancelled.kind, ownerHouseId: cancelled.ownerHouseId,
      targetCharacterId: cancelled.targetCharacterId, cancelSource: "Player",
    });
    return { ok: true };
  },
  ```
  - **Atomic gating:** `tryStartScheme` is the validate-deduct-register entry point. The store-action wrapper just gates on `result.ok` and applies the mutation atomically via `overwriteFromGameState`. No partial-state path exists.
  - **Event publication:** `schemeBus.publish` fires AFTER `set` returns, per the CLAUDE.md "event-bus fires from store-action wrappers ONLY, AFTER set returns" discipline.

- **`src/runtime/events/scheme.ts`** — NEW event bus module. Defines the typed-event discriminated union for scheme lifecycle events. Variants:
  ```ts
  export type SchemeEvent =
    | { kind: "SchemeStarted"; tick: number; schemeId: SchemeId; schemeKind: SchemeKind; ownerHouseId: HouseId; targetCharacterId: CharacterId | null; endsAtTick: number }
    | { kind: "SchemeCancelled"; tick: number; schemeId: SchemeId; schemeKind: SchemeKind; ownerHouseId: HouseId; targetCharacterId: CharacterId | null; cancelSource: "Player" | "Chaperone" }
    | { kind: "SchemeCompleted"; tick: number; schemeId: SchemeId; schemeKind: SchemeKind; ownerHouseId: HouseId; targetCharacterId: CharacterId | null }
    | { kind: "SchemeFailed"; tick: number; schemeId: SchemeId; schemeKind: SchemeKind; ownerHouseId: HouseId; reason: SchemeFailureReason }
    | { kind: "SeductionDiscovered"; tick: number; schemeId: SchemeId; ownerHouseId: HouseId; targetCharacterId: CharacterId }
    | { kind: "GrievanceRecorded"; tick: number; grievanceId: GrievanceId; perpetratorHouseId: HouseId; victimHouseId: HouseId; source: GrievanceSource };
  export const schemeBus = new EventBus<SchemeEvent>();
  ```
  - **Publisher discipline (full path-to-event matrix, pinned to avoid future ambiguity):**
    | Source path | Transitions published | How |
    |---|---|---|
    | `startScheme` wrapper | `SchemeStarted` | direct publish in the store-action wrapper after `set` returns |
    | `cancelScheme` wrapper | `SchemeCancelled` | direct publish in the store-action wrapper after `set` returns; NO diff helper (cancel is asymmetric with tick-driven transitions — single scheme touched, known schemeId, no need for diff walk) |
    | `advanceTick` / `travel` / `requestAudience` / `escapeBankruptcy` / `refreshWardrobe` (every store-action wrapper that invokes `advanceTickPure`) | `SchemeCompleted`, `SchemeCancelled` (Chaperone-driven Active→Cancelled per spec §7), `SchemeFailed`, `SeductionDiscovered`, `GrievanceRecorded` (when Sabotage completes); ALSO `TargetCharacterDied` on `conversationBus` (when Assassination completes — heir-promotion safety: skip if the dead id is the player house's pre-tick head, mirroring `runYearPass`'s diff-publish at `store.ts:194-204`) | `publishSchemeTransitions(before, after)` + `publishCharacterDeaths(before, after)` — two diff helpers called after `set` returns. Both walk before/after Maps; the death helper is shared with the `runYearPass` wrapper to avoid duplicate per-call-site loops. |
    | `runYearPass` | (nothing) | `runYearPassPure` (in `src/runtime/yearPass.ts`) does NOT advance the tick and does NOT invoke the scheme-resolution phase — succession/aging/conception are year-pass-only effects. Therefore `runYearPass` is INTENTIONALLY ABSENT from the diff-publish enumeration. Wrapping it would be dead code (no scheme could transition during a year-pass). If a future phase introduces scheme transitions inside year-pass logic, it must add the diff-publish wrapper at that time. |
    | `sendBallroomMessage` wrapper (P5 extends — see "Sabotage / fauxPas grievance recorder wiring" below) | `GrievanceRecorded` (when faux-pas fires) | direct publish in `sendBallroomMessage`'s post-`set` step; this is the only non-tick path that records a grievance |
    | `replaceState` (`store.ts:206-209`) | **NOTHING** — explicit no-emit on atomic state swap | Load-path-only convention: `replaceState` is invoked by `load()` and by `replaceState`-style test fixtures to swap the ENTIRE GameState atomically. Firing diff helpers on `replaceState` would emit a flood of `SchemeStarted`/`GrievanceRecorded`/`TargetCharacterDied` events for every entity in the loaded save — UI subscribers that mount post-load query state directly via Zustand selectors, NOT via bus events. **Inline comment to add at `store.ts:206-209`:** `// replaceState atomically swaps GameState (load path). NO event emits: load-path UIs query state directly. If a future phase needs load-time event hydration, prefer a separate "rehydrate" event variant on schemeBus/conversationBus rather than reusing the diff-helper path.` |

    Why the asymmetry is acceptable: `cancelScheme` mutates exactly one known `schemeId` to a known terminal status; a diff walk would re-derive what the wrapper already knows. The diff helper is the right pattern only for paths that fan out (one tick = N possible completions/failures). **A future phase that introduces another non-tick scheme mutation must pin its own direct-publish path** in this matrix, OR refactor to route through the diff helper.

    **`advanceTick` requires an arrow→block refactor.** The existing wrapper at `store.ts:177-180` is an arrow-expression form WITHOUT a `before` snapshot capture:
    ```ts
    // BEFORE (store.ts:177-180, verbatim):
    advanceTick: () =>
      set((state) => {
        overwriteFromGameState(state, advanceTickPure(get()));
      }),

    // AFTER (P5 — refactor to block-form WITH before snapshot; adds three lines):
    advanceTick: () => {
      const before = get();
      const after = advanceTickPure(before);
      set((draft) => { overwriteFromGameState(draft, after); });
      // BOTH diff helpers fire per tick-advance. publishCharacterDeaths
      // detects Assassination kills (Active→alive=false in characters Map);
      // publishSchemeTransitions detects scheme status transitions and
      // grievance-array growth.
      publishCharacterDeaths(before, after);
      publishSchemeTransitions(before, after);
    },
    ```
    **Per-wrapper diff-helper wiring (literal table — variable names vary because each existing wrapper has its own snapshot-capture convention):**
    | Wrapper | Existing snapshot capture (verified file:line) | New diff-helper call lines |
    |---|---|---|
    | `advanceTick` (`store.ts:177-180`) | NONE — P5 adds `const before = get()` per the BEFORE→AFTER above | `publishCharacterDeaths(before, after); publishSchemeTransitions(before, after);` |
    | `travel` (`store.ts:211+`) | `const stateBefore = get();` | `publishCharacterDeaths(stateBefore, afterTick); publishSchemeTransitions(stateBefore, afterTick);` (where `afterTick` is the existing post-`advanceTickPure` snapshot already in scope) |
    | `requestAudience` (`store.ts:239+`) | `const stateBefore = get();` | same shape as travel: pass `(stateBefore, afterTick)` |
    | `escapeBankruptcy` (`store.ts:265+`) | `const stateBefore = get();` | same shape as travel: pass `(stateBefore, afterTick)` |
    | `refreshWardrobe` (`store.ts:289+`) | `const stateBefore = get();` | same shape as travel: pass `(stateBefore, afterTick)` |
    | `runYearPass` (`store.ts:181-205`) | `const before = get(); const after = runYearPassPure(before);` (existing) | `publishCharacterDeaths(before, after);` ONLY — **NO `publishSchemeTransitions` call** (resolved per B21: `runYearPassPure` does not transition any scheme statuses and does not append to any house's grievances; calling the helper would be dead code) |

    **Why `runYearPass` does NOT call `publishSchemeTransitions`** (resolves B21): `runYearPassPure` composes `applyAgingStep + applySuccessionStep + applyConceptionStep` (verified at `yearPass.ts:27-31`); none of those steps touch `state.schemes` or `house.grievances`. The publisher discipline matrix already pins `runYearPass` as INTENTIONALLY ABSENT from the diff-publish enumeration. Adding the symmetric call would be dead code; **dropped from the AFTER snippet at line 1001 of earlier plan drafts.** A Vitest assertion locks the invariant structurally: `expect(runYearPassPure(state).schemes).toBe(state.schemes)` (Object.is identity preserved across year-pass) AND `for each house: expect(after.houses.get(h.id).grievances).toBe(before.houses.get(h.id).grievances)` — both pass via `runYearPassPure`'s pure-function discipline because none of its steps walk those collections. **Why centralize in store actions rather than embedding event-publishing in the resolver:** rules layer can't import from `runtime/events/**` (boundary rule). The resolver returns the new state; the store-action wrapper, which is the only layer that can see both pre and post, walks the diff and publishes.
    **`publishSchemeTransitions(before, after)`** is a new helper in `src/runtime/events/scheme.ts`. Signature: `(before: GameState, after: GameState) => void`. Body: for each schemeId in `after.schemes`, find the matching id in `before.schemes`; if `before.schemes.has(id) === false` (the id is new) `continue` — start-path events publish from `startScheme`'s wrapper directly. Otherwise, if statuses differ, publish the matching event variant. The diff handles only Active → terminal transitions.

    Body (literal shape — the implementer should match this verbatim modulo formatting; the schemes loop AND grievance loop both live inside the SAME exported function):
    ```ts
    export function publishSchemeTransitions(before: GameState, after: GameState): void {
      // (1) Walk scheme status transitions.
      for (const [id, afterScheme] of after.schemes) {
        const beforeScheme = before.schemes.get(id);
        if (beforeScheme === undefined) continue;             // new-scheme, owned by startScheme wrapper
        if (beforeScheme.status !== "Active") continue;       // already terminal in before
        if (afterScheme.status === "Active") continue;        // no transition this tick
        // Active → terminal. Exhaustive switch on (kind, status, failureReason).
        switch (afterScheme.status) {
          case "Completed":
            schemeBus.publish({
              kind: "SchemeCompleted", tick: after.tick, schemeId: id,
              schemeKind: afterScheme.kind, ownerHouseId: afterScheme.ownerHouseId,
              targetCharacterId: afterScheme.targetCharacterId,
            });
            break;
          case "Cancelled":
            // Active → Cancelled in the tick-advance diff fires from EXACTLY
            // ONE resolver path at P5: Chaperone completion flips matched
            // in-flight Seductions to Cancelled (per spec §7 "Cancellation
            // of in-flight Seduction by Chaperone"). The cancelScheme store
            // action also produces Active → Cancelled but publishes from its
            // own wrapper, NOT through this diff helper (cancelScheme's
            // mutation doesn't go through advanceTickPure).
            // Both paths emit the same SchemeCancelled event variant.
            schemeBus.publish({
              kind: "SchemeCancelled", tick: after.tick, schemeId: id,
              schemeKind: afterScheme.kind, ownerHouseId: afterScheme.ownerHouseId,
              targetCharacterId: afterScheme.targetCharacterId,
              cancelSource: "Chaperone",
            });
            break;
          case "Failed":
            // failureReason is the discriminator. Seduction-Discovered fires
            // SeductionDiscovered (not SchemeFailed); all other failure modes
            // fire SchemeFailed with a reason payload.
            if (afterScheme.kind === "Seduction" && afterScheme.failureReason === "Discovered") {
              schemeBus.publish({
                kind: "SeductionDiscovered", tick: after.tick, schemeId: id,
                ownerHouseId: afterScheme.ownerHouseId,
                targetCharacterId: afterScheme.targetCharacterId!, // non-null by Seduction invariant
              });
            } else {
              schemeBus.publish({
                kind: "SchemeFailed", tick: after.tick, schemeId: id,
                schemeKind: afterScheme.kind, ownerHouseId: afterScheme.ownerHouseId,
                reason: mapFailureReasonToPayload(afterScheme),
              });
            }
            break;
        }
      } // end of schemes for-loop

      // (2) Walk grievance arrays for GrievanceRecorded events. Each house's
      // grievances list is hash-relevant in insertion order; a new appended
      // entry shows up at the END. So compare lengths per house; if
      // after.length > before.length, emit GrievanceRecorded for each new
      // suffix entry.
      for (const [houseId, afterHouse] of after.houses) {
        const beforeHouse = before.houses.get(houseId);
        const beforeLen = beforeHouse?.grievances.length ?? 0;
        for (let i = beforeLen; i < afterHouse.grievances.length; i++) {
          const newGrievance = afterHouse.grievances[i]!;
          schemeBus.publish({
            kind: "GrievanceRecorded", tick: after.tick,
            grievanceId: newGrievance.id,
            perpetratorHouseId: newGrievance.perpetratorHouseId,
            victimHouseId: houseId,
            source: newGrievance.source,
          });
        }
      } // end of houses for-loop
    } // end of publishSchemeTransitions

    // Maps the on-entity SchemeFailureReasonKind enum to the bus event's
    // discriminated-union reason payload. Pure mapping; no state reads.
    // Private to src/runtime/events/scheme.ts.
    function mapFailureReasonToPayload(scheme: Scheme): SchemeFailureReason {
      switch (scheme.failureReason) {
        case "TargetDied":
          // Smuggling has no target (targetCharacterId === null), but
          // Smuggling never lands in this branch — its only failure mode
          // is EraFlipped. Asserting non-null here is the spec contract.
          return { kind: "TargetDiedDuringFlight", targetId: scheme.targetCharacterId! };
        case "EraFlipped":
          // Defensive guard: EraFlipped is currently Smuggling-only at v1.
          // A future scheme kind that adopts EraFlipped (e.g., P10 era-gated
          // forgery, P13 era-conditional schemes) would mis-route through the
          // Smuggling-specific event variant. The kind-gate makes the
          // assumption explicit; future adopters must extend the switch.
          if (scheme.kind !== "Smuggling") {
            throw new Error(`mapFailureReasonToPayload: EraFlipped on non-Smuggling kind ${scheme.kind} — extend switch and event variants`);
          }
          return { kind: "EraFlippedDuringSmuggling" };
        case "Discovered":
          throw new Error("mapFailureReasonToPayload: Discovered fires SeductionDiscovered, not SchemeFailed");
        case null:
          throw new Error(`mapFailureReasonToPayload: scheme ${scheme.id} has status=Failed but failureReason=null (state corruption)`);
        default:
          // Exhaustiveness check: any future addition to SCHEME_FAILURE_REASONS
          // (e.g., "Smuggling: pirates intercept") must update this switch.
          // assertNever provides a TS compile-time error rather than a silent
          // fall-through. Adding a reason without extending the switch fails
          // typecheck — the save-version-bump checklist must include this site.
          return assertNever(scheme.failureReason);
          // assertNever imports from src/game/util/assertNever.ts (verified
          // home). Boundary impact: runtime/events/scheme.ts importing from
          // game/util/ is permitted via the game-other element default-allow.
          // The eslint boundary positive-control test (see Verification) covers
          // this edge so a future ESLint config tightening doesn't break it.
      }
    }
    ```
    **Why walk grievances inside the same helper:** Sabotage completion mutates BOTH `scheme.status` AND the target's `house.grievances`. They live on different state surfaces but are tightly coupled — emitting `SchemeCompleted` and `GrievanceRecorded` from the same diff-pass keeps the two consistent for any subscriber that wants to react to both.

    **`publishCharacterDeaths(before, after)`** is a NEW shared helper in `src/runtime/events/conversation.ts` (colocated with the existing `TargetCharacterDied` event variant). Extracts the loop currently inlined at `store.ts:194-204`. Literal body:
    ```ts
    // src/runtime/events/conversation.ts (NEW exported helper):
    export function publishCharacterDeaths(before: GameState, after: GameState): void {
      // Read the player-head id from BEFORE so heir promotion (which flips
      // the old head's alive=false during runYearPass's succession step)
      // does NOT fire a stale TargetCharacterDied. For tick-advancing
      // paths the BEFORE head and AFTER head are the same identity, so
      // this branch is trivially-satisfied — but the shared signature
      // keeps both call sites symmetric.
      const playerHeadIdBefore = before.houses.get(PLAYER_HOUSE_ID)?.headOfHouseCharacterId;
      for (const [id, c] of after.characters) {
        const wasAlive = before.characters.get(id)?.alive ?? false;
        if (wasAlive && !c.alive && id !== playerHeadIdBefore) {
          conversationBus.publish({
            kind: "TargetCharacterDied",
            tick: after.tick,
            targetCharacterId: id,
          });
        }
      }
    }
    ```
    **Literal `runYearPass` body change in `store.ts:181-205` (after extraction):**
    ```ts
    // BEFORE (store.ts:181-205):
    runYearPass: () => {
      const before = get();
      const after = runYearPassPure(before);
      set((state) => { overwriteFromGameState(state, after); });
      // P4: detect newly-dead NPCs and publish TargetCharacterDied so
      // PersonaCacheRegistry can invalidate stale entries. Use
      // BEFORE.houses to capture the dying player head's ID...
      const playerHeadIdBefore = before.houses.get(PLAYER_HOUSE_ID)?.headOfHouseCharacterId;
      for (const [id, c] of after.characters) {
        const wasAlive = before.characters.get(id)?.alive ?? false;
        if (wasAlive && !c.alive && id !== playerHeadIdBefore) {
          conversationBus.publish({ kind: "TargetCharacterDied", tick: after.tick, targetCharacterId: id });
        }
      }
    },
    // AFTER (P5 — DELETE the inline for-loop at store.ts:195-204 AND the
    // playerHeadIdBefore capture at :194; replace with two helper calls.
    // Keeping the inline loop while ALSO adding publishCharacterDeaths
    // produces a double-publish of TargetCharacterDied for every death):
    runYearPass: () => {
      const before = get();
      const after = runYearPassPure(before);
      set((state) => { overwriteFromGameState(state, after); });
      publishCharacterDeaths(before, after);
      // NO publishSchemeTransitions call: runYearPassPure never mutates
      // state.schemes or house.grievances (verified yearPass.ts:27-31 composes
      // aging + succession + conception, none of which touch those surfaces).
      // Vitest assertion in src/runtime/yearPass.test.ts locks the no-op
      // invariant via Object.is identity preservation across the year-pass.
    },
    ```
    **Explicit deletion checklist for the implementer:** when applying the AFTER form, remove ALL of (a) `const playerHeadIdBefore = ...` at `store.ts:194`, (b) the entire `for (const [id, c] of after.characters)` loop body at `:195-204`, including the inner `if (wasAlive && !c.alive && id !== playerHeadIdBefore)` branch and the `conversationBus.publish` call. The new helper `publishCharacterDeaths` is the sole source of `TargetCharacterDied` events post-cutover.
    Called from BOTH the `runYearPass` store action (replacing the inlined loop) AND from every tick-advancing store action's post-`set` step. Heir-promotion safety preserved by the `before` snapshot capture.
  - **Subscriber discipline:** React surfaces (ledger panel, scheme history view in P14) subscribe via `useBusEvent(schemeBus, "SchemeCompleted", handler)` per the CLAUDE.md hook pattern. P5 doesn't ship listeners for `SeductionDiscovered` — P9 owns the elopement-sprint kickoff. P5 ships the event variant on the bus so P9's wiring at its phase boundary is a pure additive listener registration with no schema-level coupling.
  - **Bus instance:** `schemeBus` is exported from `src/runtime/events/scheme.ts`. Singleton per CLAUDE.md "event-bus is a typed Map<EventVariant["kind"], Set<Subscriber>> pub/sub" rule. Constructed via `new EventBus<SchemeEvent>()` — the `EventBus<E>` class is exported from `src/runtime/events/bus.ts:20` (added at P3). Mirrors the existing `conversationBus = new EventBus<ConversationEvent>()` precedent at `src/runtime/events/conversation.ts:79`. No factory function exists; instantiation is direct.

- **`src/game/hash.ts` extension.** Adds `schemes` to the `hashableState` projection:
  ```ts
  export function hashableState(state: GameState): {
    tick: number; rng: Array<[HouseId, RngState]>; houses: Array<[HouseId, House]>;
    characters: Array<[CharacterId, Character]>; marriages: Array<[MarriageId, MarriageRecord]>;
    campaignName: string; era: "Earlier" | "Later";
    conversationHistory: Array<[ConversationPairKey, Exchange[]]>;
    affectionMap: Array<[ConversationPairKey, number]>;
    schemes: Array<[SchemeId, Scheme]>;    // NEW at P5
  } {
    return {
      ...existing fields,
      schemes: serializeRegistry(state.schemes),
    };
  }
  ```
  **House.grievances projects automatically** via `serializeRegistry(state.houses)` — no per-House-field edit needed. The `hashable-state-extension.test.ts` trip-wire catches forgetting to add `schemes` to this projection.

- **`src/game/store.ts` selector AND helper extension.** Two coupled edits, both shown literally:
  - **`selectGameState` (at `store.ts:495-508`)** — add the new key to the returned object literal. The existing function spreads explicitly named keys (tick, rng, houses, characters, marriages, campaignName, era, conversationHistory, affectionMap); P5 adds `schemes`:
    ```ts
    // BEFORE (store.ts:495-508, verbatim):
    export function selectGameState(state: StoreState): GameState {
      return {
        tick: state.tick,
        rng: state.rng,
        houses: state.houses,
        characters: state.characters,
        marriages: state.marriages,
        campaignName: state.campaignName,
        era: state.era,
        // P4 additions — schema↔projection↔selector triple-sync.
        conversationHistory: state.conversationHistory,
        affectionMap: state.affectionMap,
      };
    }
    // AFTER (P5 — append schemes line BELOW affectionMap; keep the existing
    // P4 comment marker in place. P5 does NOT replace the comment block;
    // a future P5+ comment marker for `schemes` is unnecessary because the
    // triple-sync test enforces presence, not annotations.):
    export function selectGameState(state: StoreState): GameState {
      return {
        tick: state.tick,
        rng: state.rng,
        houses: state.houses,
        characters: state.characters,
        marriages: state.marriages,
        campaignName: state.campaignName,
        era: state.era,
        // P4 additions — schema↔projection↔selector triple-sync.
        conversationHistory: state.conversationHistory,
        affectionMap: state.affectionMap,
        schemes: state.schemes,   // NEW at P5
      };
    }
    ```
    The `schema-projection-selector-extension.test.ts` trip-wire enforces this — adding `schemes` to `GameStateSchema` without updating `selectGameState` fails the test at module load.
  - **`overwriteFromGameState` (at `store.ts:158-171`)** — private helper used by every store action that produces a new GameState via pure rules + orchestrator (`advanceTick`, `runYearPass`, `replaceState`, `travel`, `requestAudience`, `escapeBankruptcy`, `refreshWardrobe`, plus the two new P5 actions). P5 adds one line after the existing `draft.affectionMap = next.affectionMap;`:
    ```ts
    // BEFORE (store.ts:158-171, verbatim — the 3-line P4 comment block at
    // :166-168 is load-bearing documentation; P5 PRESERVES it in place):
    function overwriteFromGameState(draft: GameState, next: GameState): void {
      draft.tick = next.tick;
      draft.rng = next.rng;
      draft.houses = next.houses;
      draft.characters = next.characters;
      draft.marriages = next.marriages;
      draft.campaignName = next.campaignName;
      draft.era = next.era;
      // P4 additions — pair-keyed collections shared by the orphan-prune
      // cascade in aging.ts. Schema↔projection↔selector triple-sync gate
      // (schema-projection-selector-extension.test.ts) enforces this.
      draft.conversationHistory = next.conversationHistory;
      draft.affectionMap = next.affectionMap;
    }

    // AFTER (P5 — single new line appended after draft.affectionMap; the
    // P4 comment block at :166-168 stays in place; grievances ride along
    // inside next.houses, no separate per-field edit):
    function overwriteFromGameState(draft: GameState, next: GameState): void {
      draft.tick = next.tick;
      draft.rng = next.rng;
      draft.houses = next.houses;
      draft.characters = next.characters;
      draft.marriages = next.marriages;
      draft.campaignName = next.campaignName;
      draft.era = next.era;
      // P4 additions — pair-keyed collections shared by the orphan-prune
      // cascade in aging.ts. Schema↔projection↔selector triple-sync gate
      // (schema-projection-selector-extension.test.ts) enforces this.
      draft.conversationHistory = next.conversationHistory;
      draft.affectionMap = next.affectionMap;
      draft.schemes = next.schemes;        // NEW at P5
    }
    ```
    **Without the `draft.schemes` line, every tick-advancing action silently clears `state.schemes` to whatever the Immer draft started with (empty Map from `createInitialState`).** The trip-wire test (`src/game/schema-projection-selector-extension.test.ts`) does NOT catch this — it only enforces schema/projection/selector keyset equality, not the Immer-draft helper's writes. Mitigation: add a Vitest case in the existing `src/game/store.test.ts` file (it already exists per P3/P4 precedent) using the existing `createStore({ seed })` factory pattern — NO new test harness. Test body:
    ```ts
    it("startScheme + advanceTick preserves the scheme in state.schemes", () => {
      const store = createStore({ seed: DEFAULT_SEED });
      const result = store.getState().startScheme({ kind: "Courting", targetCharacterId: someBaselineNpcId });
      expect(result.ok).toBe(true);
      const schemeId = (result as { ok: true; schemeId: SchemeId }).schemeId;
      store.getState().advanceTick();
      expect(store.getState().schemes.has(schemeId)).toBe(true);
    });
    ```
    This catches the silent-clearing-on-advance class without introducing new test infrastructure.
  - **P4 ballroom actions exception**: `enterBallroom` / `exitBallroom` / `sendBallroomMessage` / `abortBallroomRequest` mutate fields IN-PLACE via Immer draft (`set((state) => { state.someField = ... })`) — they do NOT call `overwriteFromGameState`. Immer auto-preserves untouched fields including `schemes` and `house.grievances`. **No edit needed for these four actions; document the asymmetry inline in `overwriteFromGameState`'s top-of-function comment** so a future reader doesn't try to "fix" it by routing ballroom actions through the helper.

- **`createInitialState` + `seedStartingFamily` literal edits.** Both fresh-state and migrated-state paths must produce byte-identical V6 GameStates (per the v1-to-v6-chain hash-equivalence claim). Two coupled edits in two files:

  **`createInitialState` (at `src/game/store.ts:70-100`).** Verified the function lives in `store.ts` (NOT `bootstrap.ts` — earlier plan drafts misattributed). P5 adds one line to the returned object literal:
  ```ts
  // store.ts:88-99 BEFORE (verbatim):
  return {
    tick: 0,
    rng,
    houses,
    characters,
    marriages: new Map<MarriageId, MarriageRecord>(),
    campaignName,
    era: "Earlier",
    // P4: empty per-pair-key collections on fresh state.
    conversationHistory: new Map<ConversationPairKey, Exchange[]>(),
    affectionMap: new Map<ConversationPairKey, number>(),
  };

  // store.ts AFTER (P5 — one line added; SchemeId import also added to the
  // existing import block at store.ts:1-30 for the Map type argument):
  return {
    tick: 0,
    rng,
    houses,
    characters,
    marriages: new Map<MarriageId, MarriageRecord>(),
    campaignName,
    era: "Earlier",
    conversationHistory: new Map<ConversationPairKey, Exchange[]>(),
    affectionMap: new Map<ConversationPairKey, number>(),
    schemes: new Map<SchemeId, Scheme>(),    // NEW at P5
  };
  ```

  **`seedStartingFamily` (at `src/game/bootstrap.ts:58-74`).** The player house and Independent house construction must default `grievances: []` so the fresh-state House shape equals the migrated-state House shape (the V6 lift adds `grievances: []` to every house). Two literal edits in `bootstrap.ts`:
  ```ts
  // bootstrap.ts:58-74 BEFORE (verbatim — player house):
  const playerHouse: House = {
    id: PLAYER_HOUSE_ID,
    wealth: 100,
    reputation: 50,
    scandal: 0,
    headOfHouseCharacterId: STARTING_HEAD_CHARACTER_ID,
    generation: 0,
    ancestorSummary: [],
    heirless: false,
    // P3 additions — defaults match migrate_v3_to_v4's lift values so a
    // fresh-state + serialized-to-v4 hash equals a migrated-v3-to-v4 hash.
    currentLocation: "Capital",
    consecutiveTicksAtCurrentLocation: 0,
    lastAudienceTick: null,
    wardrobeLastRefreshTick: null,
    blockadeBypassEarned: false,
  };

  // bootstrap.ts AFTER (P5 — one line added to the playerHouse object):
  const playerHouse: House = {
    id: PLAYER_HOUSE_ID,
    wealth: 100,
    reputation: 50,
    scandal: 0,
    headOfHouseCharacterId: STARTING_HEAD_CHARACTER_ID,
    generation: 0,
    ancestorSummary: [],
    heirless: false,
    currentLocation: "Capital",
    consecutiveTicksAtCurrentLocation: 0,
    lastAudienceTick: null,
    wardrobeLastRefreshTick: null,
    blockadeBypassEarned: false,
    grievances: [],                            // NEW at P5
  };
  ```

  **Independent house's grievance default lives in `buildIndependentHouse()` at `src/game/fixtures/npcs.ts`** (NOT bootstrap.ts) — P5 also adds `grievances: []` to that builder's returned House literal. This keeps the player and Independent paths symmetric: fresh-state, V5→V6 migration, and V1→V6 chain all produce houses with `grievances: []` in byte-identical insertion order. Audit: `rg 'House\s*=\s*\{' src/game/` enumerates every House constructor to verify each gains the field.

- **`src/game/rules/travel.ts` update — Smuggling bypass consumption.** Currently the travel rule reads `house.blockadeBypassEarned` to gate `ForeignCapital` travel but doesn't consume it. P5 adds consumption: when `applyTravel` succeeds for a destination of `ForeignCapital` AND `state.era === "Earlier"` AND `house.blockadeBypassEarned === true`, the bypass flag flips back to `false` on the SAME `houses.set(...)` call as the location update — NOT a second follow-up mutation against a stale clone. **Literal edit at `src/game/rules/travel.ts:43-56`:** the existing body has one `houses.set(houseId, { ...house, currentLocation: to, consecutiveTicksAtCurrentLocation: 0 })`. P5 extends the object literal to include the conditional flag flip:
  ```ts
  // src/game/rules/travel.ts (P5-extended applyTravel body — the existing
  // canTravel precondition + InvalidTravelError throw at lines 44-45 are
  // PRESERVED verbatim; P5 ONLY extends the houses.set object literal).
  export function applyTravel(state: GameState, houseId: HouseId, to: LocationId): GameState {
    const check = canTravel(state, houseId, to);             // UNCHANGED at P5
    if (!check.ok) throw new InvalidTravelError(check.reason); // UNCHANGED at P5
    const house = getHouseOrThrow(state, houseId);
    const houses = new Map(state.houses);
    const shouldConsumeBypass =
      to === "ForeignCapital" &&
      state.era === "Earlier" &&
      house.blockadeBypassEarned === true;
    houses.set(houseId, {
      ...house,
      currentLocation: to,
      consecutiveTicksAtCurrentLocation: 0,                   // UNCHANGED at P5
      blockadeBypassEarned: shouldConsumeBypass ? false : house.blockadeBypassEarned, // NEW at P5
    });
    return { ...state, houses };
  }
  ```
  **DO NOT drop the `canTravel`/`InvalidTravelError` guard.** The pre-condition check is the rule layer's defense-in-depth against malformed calls (callers should validate via `canTravel` first per the player-elected action sequence, but the function panics on misuse). P5's edit is purely the conditional `blockadeBypassEarned` flip merged into the existing `houses.set` body.
  **Why on use, not on completion:** spec line 357 says "Sets a one-shot blockade bypass flag" + line 360 says "cannot start if a previous Smuggling pass is still unclaimed" — "unclaimed" implies the flag is consumed at the *claim* point. Traveling to the foreign capital IS the claim; the flag carries the player through the blockade. **Edge case:** traveling to `ForeignCapital` when era is `"Later"` does NOT consume the flag (the blockade isn't active; the flag is irrelevant). Test fixtures: travel to ForeignCapital in Earlier era with flag=true → success + flag flips to false; travel to ForeignCapital in Later era with flag=true → success + flag stays true; travel to anywhere-else with flag=true → success + flag stays true. **Why the spec asymmetry is acceptable:** P13 transitions the era one-way, so a player who completes a Smuggling pass in Earlier era and waits to travel until Later era keeps the unspent flag forever. The flag is functionally dead in Later era (the gate is era-bypassed). This is a small piece of dead state; refactoring it out is out of scope.

- **Sabotage / fauxPas grievance recorder wiring.** P4 already ships the `FauxPasFired` event variant in `src/runtime/events/conversation.ts`. Spec §3 line 122 says "Sabotage success and public faux-pas record formal grievances against the offending house." P5 owns the wiring for BOTH sources:
  - **Sabotage**: recorded in `resolveSchemeCompletion` (the pure rule layer) when a Sabotage transitions Active → Completed, per the per-kind logic above. The `GrievanceRecorded` event is fired from the tick-advancing store-action wrapper via `publishSchemeTransitions`'s diff helper (which detects the new grievance on the target's house and emits the event).
  - **FauxPas**: recorded in `src/game/store.ts`'s `sendBallroomMessage` action — specifically, inside the `set((state) => { ... })` body, when the combat-resolver outcome carries `fauxPasFired === true`. The append site is the SAME `set` body that mutates `state.conversationHistory`, `state.affectionMap`, and `state.characters[target].composure` — all four mutations land atomically (per CLAUDE.md "every mutation site clamps independently / no partial-state failure paths"). **`fauxPasIndexOnThisTick` MUST be captured BEFORE the `set` block** (not inside it) — the index is a function of the pre-mutation state.houses arrays; reading it inside Immer's draft producer after appending the current grievance would double-count. Literal shape:
    ```ts
    sendBallroomMessage: async (input, apiKey) => {
      // ... existing send/await/parse logic ...
      const stateBefore = get();
      // Pre-existing target lookup (matches existing P4 store.ts:367-371 shape):
      const target = getCharacterOrThrow(stateBefore, input.targetCharacterId);
      const targetHouseId = target.houseId;  // NEW at P5: used by FauxPas grievance below
      // ... combat resolve, fauxPasFired determination ...
      let fauxPasGrievanceId: GrievanceId | null = null;
      let fauxPasGrievance: Grievance | null = null;
      if (fauxPasFired) {
        // PRE-set capture: walk all houses' grievances arrays, filter
        // FauxPas entries at this tick. Count is the index for THIS tick's
        // NEW grievance. Lex-sort by houseId outer / recordedAtTick inner
        // to keep the index deterministic across rival-house additions in P8.
        let fauxPasIndex = 0;
        const sortedHouseIds = [...stateBefore.houses.keys()].sort();
        for (const hid of sortedHouseIds) {
          const grievances = stateBefore.houses.get(hid)!.grievances;
          for (const g of grievances) {
            if (g.source === "FauxPas" && g.recordedAtTick === stateBefore.tick) fauxPasIndex += 1;
          }
        }
        fauxPasGrievanceId = `${PLAYER_HOUSE_ID}:FauxPas:${stateBefore.tick}:${fauxPasIndex}` as GrievanceId;
        fauxPasGrievance = {
          id: fauxPasGrievanceId, perpetratorHouseId: PLAYER_HOUSE_ID,
          source: "FauxPas", schemeId: null,
          recordedAtTick: stateBefore.tick, resolved: false,
        };
      }
      set((state) => {
        // ... existing P4 mutations (conversationHistory, affectionMap, composure) ...
        if (fauxPasGrievance !== null) {
          // Immer in-place push on the draft's House.grievances array. This
          // preserves the hash-relevant INSERTION ORDER pinned in §"Grievance
          // entity shape" — push-at-end matches the contract; cloning via
          // grievances: [...h.grievances, newGrievance] would also work but
          // breaks the existing Immer-draft style at this set site.
          const targetHouse = state.houses.get(targetHouseId);
          if (targetHouse !== undefined) {
            targetHouse.grievances.push(fauxPasGrievance);
          }
        }
      });
      if (fauxPasGrievance !== null) {
        schemeBus.publish({
          kind: "GrievanceRecorded", tick: stateBefore.tick,
          grievanceId: fauxPasGrievanceId!,
          perpetratorHouseId: PLAYER_HOUSE_ID, victimHouseId: targetHouseId,
          source: "FauxPas",
        });
      }
      // ... existing return ...
    },
    ```
    **NOT** in `src/runtime/conversationOrchestrator.ts` — that module is the LLM-call layer and doesn't mutate game state; the store action is the orchestrator wrapper. **Why Immer in-place push and not clone-and-set:** matches the existing P4 ballroom-action mutation style (which already does in-place writes on `state.affectionMap`, `state.conversationHistory`, `state.characters[target].composure`). Mixing styles in the same `set` body is error-prone.
  - **P5 Independent-house pooling caveat.** Per P4, all NPCs at P5 belong to `INDEPENDENT_HOUSE_ID` (rival-house NPCs ship in P8). This means: every FauxPas grievance accumulates under the SAME house (Independent's `grievances` array), all with `perpetratorHouseId: PLAYER_HOUSE_ID`. This is expected and correct — the spec's "grievances against the offending house" reading scopes them to the victim's collection. P8's rival-house wiring will naturally partition grievances across the new rival houses. Test fixtures at P5 must lex-sort Independent's grievances array deterministically; later phases that add cross-house grievances will inherit the same lex-sort invariant.
  - **Both paths emit a `GrievanceRecorded` event on `schemeBus`** so the future P8 grievance-ledger UI can passively accumulate. The Sabotage path emits from the diff helper; the FauxPas path emits from `sendBallroomMessage`'s post-`set` block (directly, since this is a non-tick mutation — matches the "non-tick mutations publish directly" matrix entry above).

- **`src/ui/ballroom/SchemeButtons.tsx`** — NEW UI component. Sits adjacent to `TacticButtons.tsx` in the ballroom view's target selection panel. Six buttons, one per scheme kind. Per-button display:
  - **Disabled states** (no click possible, but tooltip explains why):
    - Owner house wealth < `SCHEME_TUNING[kind].wealthCost` → "Insufficient wealth (need 25, have 12)".
    - Prerequisite archetype absent → "Requires Spymaster archetype in family".
    - Smuggling-specific: era is `"Later"` → "Smuggling only available in wartime era"; existing unclaimed pass → "Previous Smuggling pass not yet claimed"; would complete past era transition → "Would complete after era flip — try sooner".
    - Target is `null` (player hasn't selected a target) and kind requires target → button disabled.
    - Target is dead → "Target is deceased".
  - **Enabled state**: click fires `store.startScheme({ kind, targetCharacterId })`. On `ok: false`, the rejection reason mounts as a transient toast banner (reuses the existing P3 banner pattern from rejected travel actions).
  - **Smuggling target selection**: Smuggling has no target. The button is independent of the selected NPC; it always reads `targetCharacterId: null`. Pinning: render Smuggling outside the target panel as a separate "Strategic actions" sub-section.
  - **Chaperone target semantics**: Chaperone's target is "the character being protected" — typically a player-family member at risk of being seduced. In v1 the UI lets the player chaperone any character (including non-family), with a soft hint: "Most useful for protecting your own family members." This matches the rule layer's permissive target check.

- **`src/ui/ledger/ActiveSchemesPanel.tsx`** — NEW inline ledger panel. Renders as a collapsible section on the strategy-map view (NOT a full ledger view — P14 owns the full ledger). Shows active schemes only (filter `status === "Active"`):
  - Per-row: scheme kind icon, target character name (resolved via `state.characters.get(...)`), `ticksRemaining = Math.max(0, endsAtTick - state.tick)` (`Math.max(0, ...)` clamp at render is defensive against a brief post-resolution flash before the panel re-filters), Cancel button.
  - **Reactive subscription pattern (load-bearing for perf):** `ticksRemaining` is reactive to BOTH `state.tick` AND `state.schemes`. Zustand auto-subscribes to the full state by default, but two independent `useStore` selectors trigger two re-renders per tick. Use `useShallow` (or the explicit selector-tuple form) to bundle the subscription:
    ```tsx
    // src/ui/ledger/ActiveSchemesPanel.tsx
    import { useShallow } from "zustand/react/shallow";
    // ...
    const { tick, schemes } = useStore(useShallow((s) => ({ tick: s.tick, schemes: s.schemes })));
    const active = useMemo(() => [...schemes.values()].filter((sc) => sc.status === "Active"), [schemes]);
    // ...
    ```
    Without `useShallow`, every tick advance re-renders the panel twice (one for `tick`, one for the new `schemes` Map identity).
  - Cancel button click → `store.cancelScheme(schemeId)`. Confirmation modal: "Cancel this Courting? No wealth refund." (No refund warning per spec.)
  - Empty state: "No active schemes."
  - Component sits in the existing map-view sidebar area (the right-side info panel). At P14 the full ledger view absorbs it; the inline panel persists as a sticky summary.
  - **Why a panel, not a full view at P5:** spec line 153–156 describes a full tabbed ledger view (Whispers, Schemes, Family Tree, Patronesses, Grievances, Rivals, Staff). That view is P14's responsibility — all seven tabs are owned by one phase so the tabbed shell stays coherent. P5's inline panel is the minimum surface needed to expose the scheme lifecycle for testing and play; it's not a half-baked tab.

**Out of scope.** Treason Framing (P10 — artifact-dependent, the 7th scheme kind reserved at spec §3 line 80); elopement sprint overlay UI (P9 — listens to `SeductionDiscovered` event); duel resolution (P8 — reads `house.grievances`, ships "demand satisfaction" action and the 12-exchange duel resolver); full ledger view with all 7 tabs (P14); rival-house scheme launching (P8 — at P5, only `PLAYER_HOUSE_ID` ever owns schemes); patroness veto on Assassination (P8 — at P5, Assassination's only gate is wealth + archetype); LLM routing for scheme outcomes (deferred per OQ #5 resolved at P4 — the structured `respond` tool covers ballroom conversation only); semantic memory of scheme history (P17 optional); dynasty perk modifiers to scheme outcomes (P15 — at P5, scheme effects are constants, not modifier-driven).

**Spec refs.** §2 "Schemes" (the capability overview at line 75–82); §2 line 227 (archetype-to-scheme prerequisite mapping — canonical reading); §3 "Schemes" (line 349–362 — the cost/duration/effect table); §4 "Core Entities" House line 541 (`social grievances`); §7 line 640 "Era-flip during a Smuggling scheme"; §7 line 642 "Cancellation of in-flight Seduction by Chaperone"; §7 line 673 "Action gating bypassed by mid-flight scheme starts"; §8 line 681 (the determinism contract that scheme draws must not violate); §9 (lessons learned that all of the above structure honors).

**Resolved decisions (§10).** All open-question defaults relevant to P5 are pinned at P5. MASTER.md §10 carries the "Resolved at P5" tag for question #6.

- **#6 — Seduction discovery** is a **one-shot binary at completion** with `SEDUCTION_DISCOVERY_PROBABILITY = 0.2`. The multi-tick suspicion mechanic considered by the spec is a v1.5 candidate — its surface area (per-tick rolls, NPC suspicion levels, mid-flight cancellation paths) doesn't fit the v1 elopement-sprint scope and would force a save-format change. The one-shot mechanic gives the elopement sprint its natural trigger and lets the conversation surface remain the only place where Seduction risk is communicated to the player.

**Key rules / constants.**

| Scheme | Cost | Ticks | Effect on completion | Archetype prereq | Other prereqs |
|---|---|---|---|---|---|
| Courting | 10 | 5 | `+40` affection (clamped) | — | target alive |
| Sabotage | 15 | 3 | `−30` composure (clamped); grievance recorded against owner | — | target alive |
| Seduction | 25 | 7 | discovery roll 20%; on no-discovery `+80` affection (clamped); on discovery → `SeductionDiscovered` event for P9 | — | target alive |
| Chaperone | 5 | 1 | flips ALL active Seductions targeting same character to `Cancelled` | `Spymaster` | target alive |
| Smuggling | 20 | 4 | sets `house.blockadeBypassEarned = true` | — | era `"Earlier"`; completion before era transition; no unclaimed prior pass; no target character |
| Assassination | 50 | 6 | `alive = false`, `diedAtTick = state.tick`; `+25` scandal on owner (clamped) | `BohemianRake` OR `CountryExile` | target alive |

**Machines.** Scheme (`Active → Completed | Cancelled | Failed`). Per CLAUDE.md, machines are XState v5 actor refs held in the Zustand store — but the scheme state is small (one enum) and per-scheme, not per-game. **P5 implements the scheme state as a field on the `Scheme` entity, not as an XState actor.** Rationale: an XState actor per scheme would multiply state-actor-refs by N-active-schemes, complicate save/load serialization (XState actors have internal state that's awkward to persist), and offer no behavioral benefit over a plain status enum. The `Scheme.status` field is the machine. Transitions are gated by the pure resolver in `applySchemeResolutionPhase` and `cancelScheme`; no parallel XState definition. The XState catalog in MASTER.md §5.2 lists "Scheme (Active → Completed | Cancelled | Failed)" — interpret that entry as a logical state machine (the status field), not a literal XState actor.

**Edge cases (§7).**

- **"Era-flip during a Smuggling scheme":** start-time rejection (`SmugglingPastEraEdge`) catches the planned case. Completion-time no-op (`EraFlippedDuringSmuggling` → `Failed`) catches the impossible-in-v1-but-defensive case where P13 mutates the transition tick mid-flight.
- **"Cancellation of in-flight Seduction by Chaperone":** Chaperone completion finds all active Seductions on the same target character and flips them to `Cancelled`. Lex-sort by `SchemeId` for determinism. No wealth refund to the seducing house.
- **"Action gating bypassed by mid-flight scheme starts":** start-time gates (wealth, archetype, era) are NOT re-checked at completion. Family member who carried the required archetype dying mid-flight does NOT invalidate the Assassination/Chaperone. Era flipping mid-flight does NOT invalidate the Smuggling. The only completion-time check that fires is "target alive" — and that's a defensive no-op on the effect, not a retroactive cost refund.
- **"Affection/Composure mutation from multiple sites":** Sabotage's −30 composure and Courting/Seduction's affection deltas all clamp at the mutation site per CLAUDE.md non-negotiable §6. Sabotage's grievance record is appended in the same transactional pass as the composure mutation — no partial state.

**Verification.**

- **Vitest unit tests at `src/game/rules/schemes.test.ts`:**
  - Per-scheme happy path: start → tick to completion → status `Completed`, effects applied, no PRNG drift outside the documented draws.
  - Per-scheme rejection path: each `StartSchemeRejection` variant covered by a fixture (insufficient wealth, missing archetype, wrong era, unclaimed Smuggling pass, Smuggling past era edge, dead target, self-target).
  - Cancellation: cancel an Active scheme → status `Cancelled`, no wealth refund, no scheme effects applied.
  - Cancel an already-cancelled scheme → `SchemeNotActive` rejection.
  - Cancel a non-existent scheme id → `SchemeNotFound` rejection.
  - Chaperone vs multiple in-flight Seductions: two Seductions on character X, one Chaperone on X → both Seductions flip to `Cancelled`.
  - Chaperone vs no matching Seductions: `Completed`, nothing else changes.
  - Smuggling era-edge rejection: tick = `ERA_TRANSITION_TICK - 3`, Smuggling duration 4 → rejected at start.
  - Smuggling completion sets `blockadeBypassEarned = true`; subsequent travel to ForeignCapital consumes it back to `false`.
  - Seduction discovery determinism: identical seed across 30 runs produces identical discover/no-discover sequence (replay-harness integration).
  - Seduction discovery: when `next < 0.2`, transition is `SeductionDiscovered` + `Failed`. When `next ≥ 0.2`, transition is `Completed` + `+80 affection`.
  - Target-dies-mid-flight: Assassination → start, then target dies from another source on tick 3 of 6 → completion is `Failed { TargetDiedDuringFlight }`, no double-kill, no scandal applied.
  - Atomic gating: rejection paths leave state byte-identical to the input (assert via hash equality).
  - **`startScheme` does NOT advance the tick:** `const before = store.getState().tick; store.getState().startScheme({kind: "Courting", targetCharacterId: someNpcId}); expect(store.getState().tick).toBe(before);`. Locks the load-bearing free-action invariant against a future "harmonize with P3 pre-tick pattern" refactor.
  - **`SchemeStarted` event tick equals `startedAtTick`:** subscribe to `schemeBus`, start a scheme, assert the published event's `tick` field equals the scheme entity's `startedAtTick` field AND both equal the pre-set `state.tick`. Locks the three-way equivalence.
  - **`aggressorCharacterId` hash-relevance:** construct two `Scheme` entities with identical `kind/ownerHouseId/targetCharacterId/startedAtTick/endsAtTick/status/failureReason/resolvedAtTick/accumulatedAffection` but distinct `aggressorCharacterId`; insert each into separate `state.schemes` Maps; assert `hashState(state1) !== hashState(state2)`. Locks the field as load-bearing against a future "cleaning unused fields" refactor.
  - **`accumulatedAffection` hash-relevance:** symmetric to above with `accumulatedAffection` as the only differentiating field. Locks the dead-data-at-v1 slot against removal.
  - **`selectAggressor` validation-walk-equals-aggressor-walk invariant:** construct a state where MissingArchetype validation passes (one Spymaster present) but the aggressor-walk filter is artificially diverged (test-only fixture); assert the defensive throw fires. Locks the contract structurally.
  - **`pruneOrphanedConversationKeys` idempotence over disjoint id sets:** invoke twice with non-overlapping `newlyDead` sets; assert the post-second-call state equals applying the union in a single call. Locks multi-Assassination same-tick correctness.
  - **`pruneOrphanedConversationKeys` extraction parity:** construct a state with a multi-NPC year-pass death scenario; assert that the post-extraction `applyAgingStep(state)` output Object.is-equals the pre-extraction inline-loop output for `conversationHistory` and `affectionMap` Maps. Locks the refactor as semantics-preserving.
  - **`runYearPass` `TargetCharacterDied` event count parity:** with N NPCs hitting their `deathAge` on the same year-pass (heir excluded), the wrapper fires exactly N events. Locks the `publishCharacterDeaths` refactor against the inlined-loop precedent.
  - **`runYearPassPure` schemes/grievances no-op invariant:** `expect(runYearPassPure(state).schemes).toBe(state.schemes)` (Object.is identity preserved) AND `for (const [id, h] of state.houses) expect(runYearPassPure(state).houses.get(id)!.grievances).toBe(h.grievances)`. Locks the dead-call-omission rationale at the `runYearPass` wrapper.
  - **Tick-advance never flips the player head's `alive` flag:** for each of `advanceTick`/`travel`/`requestAudience`/`escapeBankruptcy`/`refreshWardrobe`, assert `before.houses.get(PLAYER_HOUSE_ID).headOfHouseCharacterId === after.houses.get(PLAYER_HOUSE_ID).headOfHouseCharacterId` AND `state.characters.get(headId)!.alive === true`. Locks the `publishCharacterDeaths` heir-skip-guard's trivial-satisfaction at P5.
  - **`fauxPasIndexOnThisTick` save/load round-trip:** trigger two same-tick FauxPas events → grievance ids `:0` and `:1` appended to Independent's grievances; `save()`/`load()`/`advanceTick`; assert the grievances survive in insertion order with ids unchanged. Locks the insertion-order-through-serializeRegistry invariant.
  - **`Object.is(input, result.state)` identity preservation on rejection paths:** every `StartSchemeRejection` variant produces `result.state === input` (referential equality). Locks the no-partial-mutation contract tighter than hash equality alone.
  - **`ERA_TRANSITION_TICK` hash-irrelevance** (new file `src/game/constants.test.ts`): `vi.mock('./constants', ...)` overrides the constant to a different value; assert `hashState(state)` is identical before and after the mock. Locks the per-build-tunable claim against a future P13 maintainer adding it to `hashableState`.
- **Migration tests:**
  - `src/persist/migrations/v5-to-v6.test.ts`: a SaveV5 fixture migrates to SaveV6 with `schemes: []` and every house gaining `grievances: []`.
  - `src/persist/migrations/v5-to-v6.idempotence.test.ts`: `assertMigrationIdempotent`.
  - `src/persist/migrations/v1-to-v6-chain.test.ts`: full-chain regression — v1 save through every migration to v6 produces a hash identical to a fresh-state v6 created with the same seed.
- **Hash/projection tests:**
  - `src/game/hash.test.ts`: new test asserts a state with one active scheme has a different hash from the same state with that scheme cancelled.
  - `src/game/schema-projection-selector-extension.test.ts`: the existing trip-wire automatically catches forgetting to add `schemes` to either `hashableState` or `selectGameState`.
- **Orchestrator phase test at `src/runtime/tickOrchestrator.test.ts`:**
  - `applySchemeResolutionPhase` runs at slot 5; the existing phase-order tracker can assert call order if the test extends to track all 8 phases.
- **Event tests:**
  - `src/runtime/events/scheme.test.ts`: every transition publishes the correct event variant; subscribers receive events post-`set`; the bus is the same singleton across re-renders.
- **Replay harness:**
  - The existing 30-run replay harness extends to a campaign that launches one of each scheme kind on tick 0; the final hash is identical across all 30 runs.
- **Boundary tests:**
  - `eslint/boundaries.test.ts` extends with a snippet asserting `src/game/rules/schemes.ts` cannot import from `src/runtime/**` or `src/ui/**` (negative test).
- **UI smoke (Playwright spec, optional polish):**
  - Launch a Courting scheme from the ballroom; advance ticks; observe the Active Schemes panel decrementing `ticksRemaining`; on completion, observe the affection delta in the conversation UI.

**Commit boundary discipline (during implementation).** The save-version cutover spans five coupled surfaces (`schema.ts` + `migrations/` + `dexie.ts` + `main.tsx` + tests); typecheck does not pass without all five edited together. Recommended commit shape:
- **Commit 1 (schema cutover, atomic):** all literal edits to `entities.ts` (GameStateSchema + brand imports), `rng.ts` (SchemeIdSchema + GrievanceIdSchema + type aliases), `schema.ts` (HousePreV6Schema/alias + defaultHouseV4Fields widening + strip helpers + Bare+wrap edits + SaveV6Schema + dexie integration), `migrations/v5-to-v6.ts` + `index.ts` registration, `main.tsx` (all 5 site rename), `bootstrap.ts` + `store.ts` (`createInitialState` + `overwriteFromGameState` + `selectGameState` extensions). Production code typecheck-clean at this commit boundary.
- **Commit 2 (rule layer + orchestrator):** `src/game/rules/schemes.ts` (full resolver + factory), `src/game/fixtures/schemeIdFactory.ts`, `src/game/util/lookups.ts` (getRngStateOrThrow + getSchemeOrThrow additions), `src/game/util/errors.ts` (typed-error additions), `tickOrchestrator.ts:42` (one-line PHASES swap), `aging.ts` (pruneOrphanedConversationKeys extraction + Set<CharacterId> narrowing). Per-action store wrappers (startScheme/cancelScheme) + diff-publish helpers (`src/runtime/events/scheme.ts` + `publishCharacterDeaths` in `conversation.ts`) + advanceTick arrow→block refactor + per-tick-wrapper diff calls.
- **Commit 3 (UI):** `src/ui/ballroom/SchemeButtons.tsx` + `src/ui/ledger/ActiveSchemesPanel.tsx`.
- **Commit 4 (tests):** all Vitest + Playwright additions. Test-only commit avoids mid-sequence partial-test green/red oscillation.

**Close out.** When the gates and verification items above are green, run `/close-phase P5` to update phase status in `plans/MASTER.md` §6, append to `plans/SESSION-NOTES.md`, resolve open question #6 in MASTER.md §10 with the "Resolved at P5" tag, apply any CLAUDE.md additions (the bare+wrap migration pattern with grievance/schemes seed is a P5 confirmation of the P4-introduced pattern — no new note needed unless implementation surfaces a wrinkle), update MASTER.md §5.2 XState catalog entry "Scheme (Active → Completed | Cancelled | Failed)" to clarify "logical state machine, not literal XState actor — uses `Scheme.status` field" (per C25 tail), and commit the changes (no push).

## Accumulated Risks & Suggestions

*Passively collected from review cycles. Not blockers. Triaged at convergence.*

- [C1] `ERA_TRANSITION_TICK = 200` becomes hash-load-bearing if P13 changes it mid-campaign; clarify whether constant is per-campaign frozen or per-build applied to all saves.
- [C1] Scheme-id factory `schemeIndexOnThisTick` is O(N) per start (walks `state.schemes.values()` cumulatively); benign correctness but worth a perf note for hot replay-harness loops.
- [C1] `applyTravel` consuming `blockadeBypassEarned` not specified atomically — the houses.set body must explicitly include the flag flip on consumption. `[likely addressed]`
- [C1] Validation order in `tryStartScheme` re-ordered to MissingTarget → TargetNotFound → InsufficientWealth → ... → TargetIsDead → SelfTarget (now addressed inline).
- [C1] `tryStartScheme`'s `targetCharacterId: CharacterId | null` includes explicit `MissingTarget` check for non-Smuggling kinds (now addressed inline).
- [C1] `selectGameState` extension misses P4 ballroom actions in the enumeration; verify whether enterBallroom/exitBallroom/sendBallroomMessage/abortBallroomRequest need explicit schemes/grievances preservation or rely on the trip-wire test.
- [C1] Idempotence check for `seedSchemesAndGrievancesIntoLegacyState` is a structural-not-contents check; pin the exact form (`state.schemes ?? new Map()` and per-house `grievances ?? []`).
- [C1] Chaperone cancellation across rival owners not regression-tested at P5; forward-compatible fixture exercising a Chaperone vs manually-constructed rival Seduction would lock in P8-ready behavior.
- [C1] Cancel-already-cancelled idempotence (double-click race) not pinned as a Vitest case explicitly.
- [C1] UI ledger panel `ticksRemaining` requires React subscription on BOTH `state.tick` AND `state.schemes`; Zustand selectors don't auto-bundle — recommend explicit subscription pattern.
- [C1] Add explicit Patroness-Veto deferral comment in `tryStartScheme` validation order so P8 implementer knows where the veto inserts.
- [C1] Add Vitest behavioral test for `selectGameState` covering `schemes` field preservation across `set` actions (beyond the Object.keys trip-wire).
- [C1] Clarify whether P10's Treason Framing (7th scheme kind) bumps save version or reserves the name in `SCHEME_KINDS` at P5.
- [C1] Boundary-rule test should add positive-control case for `runtime/tickOrchestrator.ts → game/rules/schemes` and pin the boundary element for `src/runtime/events/scheme.ts`.
- [C1] UI: "Active Schemes" panel progress affordance (progress-bar overlay for ticks-remaining/duration ratio) — optional polish.
- [C1] `SchemeId` factory uniqueness regression test for same-owner same-tick same-kind distinct ids.
- [C2] `ERA_TRANSITION_TICK` is a tuning constant NOT in hash state; pin this hash-irrelevance fact so P13 can adjust without save-version bump.
- [C2] Pin determinism contract for phase-5 draw budget: player-house RNG call-count = baseline + 1 per resolving Seduction; replay-harness assertion should cover.
- [C2] `SchemeTransition` discriminated union includes `Cancelled` though Cancelled is emitted only from cancelScheme; either narrow resolver return type or document the dual-path coverage.
- [C2] Migration test naming convention varies across v1-to-v2 / v3-to-v4 (folded) vs v2-to-v3 / v4-to-v5 / v5-to-v6 (separate `.idempotence.test.ts`); confirm consistency.
- [C2] Add `assert(SCHEME_KINDS.length === 6)` at module load to catch the P10-adds-enum-but-forgets-version-bump footgun. `[applied]`
- [C2] Pin `useBusEvent` cleanup discipline reference for the React subscriber pattern.
- [C2] Include a Sabotage in the 30-run replay-harness fixture so the grievance recorder path is replay-tested (only grievance-writing scheme).
- [C2] Confirm `__buildSaveV5ForTests` → `__buildSaveV6ForTests` rename includes the import change in `src/main.tsx`.
- [C3] Pin a test asserting `fromSaveV1Bare → seedSchemesAndGrievancesIntoLegacyState` produces empty-houses outcome (no player) so future implementers aren't tempted to "fix" the partial state.
- [C3] `schemeIndexOnThisTick` filter walks ALL schemes (Active + terminal) — pin the absence of status filter explicitly since Completed/Cancelled/Failed schemes accumulate forever.
- [C3] Seduction discovery roll RNG threading: pin in literal code that the resolver `new Map(state.rng) + .set(ownerHouseId, postDrawRngState)` records the draw advancement.
- [C4] `selectGameState` literal `schemes: state.schemes` line — show the exact addition to the function body, not just narrative.
- [C4] `TickPhase` return type vs `resolveSchemeCompletion` return type: pin explicit shape boundary between resolver-level `{state, transition}` and phase-level `GameState`-only return.
- [C4] `ERA_TRANSITION_TICK = 200` rationale should tie to spec §3 "Era Progression" or mark explicitly P13-overridable with a TODO comment.
- [C5] `startScheme` / `cancelScheme` store-action `set` callbacks should use block form `{ overwriteFromGameState(...); }` not arrow-expression form to match the `advanceTick`/`runYearPass` precedent at `store.ts:177-179`.
- [C5] Target-dies-mid-flight Seduction Vitest case: start Seduction → target killed via Assassination at completion tick → assert owner rng `callCount` unchanged AND transition is `Failed{TargetDiedDuringFlight}`.
- [C5] Lex-sort by SchemeId at P5 means sort key is effectively `kind:tick:index` (single owner); P8 adds `ownerHouseId` prefix and shifts iteration order — flag cross-phase determinism for replay-harness re-validation.
- [C5] One literal trace example for `SmugglingPastEraEdge` math: "startScheme at tick 5 with 4-tick Smuggling → endsAtTick=9 → resolves when tick advances to 9 during phase 5."
- [C6] `fauxPasIndexOnThisTick` per-tick lex-sort discipline: pin "lex-sort houseId outer, recordedAtTick inner; FauxPas count for THIS tick across all houses is the index" — important for P8 forward-compatibility when rival houses may emit FauxPas grievances.
- [C7] Phase-5 ordering "Sabotage reads post-location target composure" is forward-looking at P5 (all NPCs in single INDEPENDENT_HOUSE; location-effects only apply to player); call out the rationale's P8-relevance vs P5-trivial-truth status.
- [C7] `tryStartScheme` validation order should explicitly split into two phases: (1) precondition asserts that throw (`MissingTarget`, `TargetNotFound`), (2) validation steps that return typed rejections (starting at `InsufficientWealth`).
- [C7] Sabotage cross-house mutation pattern: pin that player house pays the wealth cost, but the target's house (INDEPENDENT at P5) takes the composure damage AND receives the grievance — call out this cross-house pattern explicitly for P8 inheritance.
- [C7] Chain regression test naming: existing pattern is `v1-to-v5-chain.test.ts`; plan adds `v1-to-v6-chain.test.ts`. Pin whether the V5 chain test supersedes or coexists with the V6 chain test.
- [C7] Lex-sort comparator for grievance arrays: insertion-order at storage (hash-relevant), lex-sort by `GrievanceId` at UI render time. Pin both with code-snippet examples so the implementer doesn't reorder on save.
- [C8] `pruneOrphanedConversationKeys` signature: aging.ts currently builds `newlyDead = new Set<string>()`; pin whether the new helper accepts `ReadonlySet<string>` or `ReadonlySet<CharacterId>` to avoid a strict-TS rejection.
- [C8] `advanceTick` store action currently lacks a `before` snapshot; pin literal `const before = get()` capture at the top of the wrapper for `publishSchemeTransitions` / `publishCharacterDeaths` consumption.
- [C8] Chaperone resolution timing clarification: the matching-Seductions filter walks `state.schemes` at Chaperone's completion tick (not at Seduction's end-tick); pin to avoid implementer trying to coordinate across phase-pass timing.
- [C8] Idempotence literal form for `seedSchemesAndGrievancesIntoLegacyState`: pin `h.grievances ?? []` (preserves existing array contents; treats undefined as empty) so the implementer doesn't pick a structurally-different form like `'grievances' in h`.
- [C8] Heir-inheritance comment preservation: the load-bearing comment at `aging.ts:8-14` explaining "filter by `parsePairKey(key).characterId` not by `houseId`" MUST move with the extracted body into `pruneOrphanedConversationKeys`; without it, a future maintainer could break heir inheritance.
- [C8] Vitest case: Assassination of player house's own head (SelfTarget catches it at P5; forward-compatible regression bait for P8's rival-owned schemes).
- [C8] Chaperone "no wealth refund" extrapolation from spec line 362 (player-initiated cancellation); pin the extrapolation explicitly since Chaperone is third-party preemption, not seducer self-cancel.
- [C9] `publishSchemeTransitions` body sketch should pin the exhaustive switch on `(scheme.kind, beforeStatus, afterStatus)` — e.g., Seduction Active→Failed could be either `SeductionDiscovered` or `Failed{TargetDiedDuringFlight}`; the helper needs to peek at the failure reason path (perhaps stored transiently in a side-channel, or re-derived from state shape).
- [C9] `EraFlippedDuringSmuggling` completion-time branch needs a literal code snippet showing the status flip to `"Failed"` via `flipSchemeStatus` and the `SchemeFailed` event publish.
- [C9] Spec §4 line 543 Active Scheme includes an `accumulated affection` field; plan omits it. Either add as `accumulatedAffection: number` (default 0; mutated only by future suspicion mechanics in v1.5) OR explicitly defer with note that one-shot discovery makes it dead data for v1.
- [C9] Clamp coverage at every mutation site (CLAUDE.md non-negotiable §6) — pin explicit "clamp applied here" Vitest assertions for Sabotage composure, Courting/Seduction affection, Assassination scandal.
- [C9] `ActiveSchemesPanel.tsx` subscription pattern: pin `useShallow` (or equivalent) for the combined `(state.tick, state.schemes)` selector to avoid double re-render. `[applied]`
- [C10] `publishSchemeTransitions` Seduction-Failed disambiguation: status field alone can't distinguish `SeductionDiscovered` from `TargetDiedDuringFlight`; either (a) store failure reason on the Scheme entity, or (b) thread the `SchemeTransition[]` array from the resolver phase up through `advanceTickPure` to the store wrapper. Pick one in body.
- [C10] Stale line reference: plan says `src/persist/schema.ts:24` for `SAVE_VERSION_CURRENT` but actual is `:34`; fix.
- [C10] Filter-vs-sort order in `applySchemeResolutionPhase`: pin "filter first (active + endsAtTick===tick), THEN lex-sort by SchemeId" — not the reverse — to lock the documented contract.
- [C10] `before = get()` snapshot enumeration per action: `advanceTick` (`store.ts:177-180`) currently has no capture and needs one; `travel`/`requestAudience`/`escapeBankruptcy`/`refreshWardrobe` use `stateBefore`; `runYearPass` uses `before`. Pin which variable name each new wrapper reuses vs adds.
- [C11] `publishCharacterDeaths` heir-promotion guard trivially-satisfied for tick-phase deaths at P5 (Assassination rejects self-target at start; no succession in tick phases). Pin so future maintainers don't "simplify" the guard.
- [C11] `applyTravel` widening at travel.ts must preserve the existing precondition check (the `canTravel`-validated assumption + `InvalidTravelError` throw); the plan's literal snippet should keep that surrounding context.
- [C11] Consolidate schema-extension edits into a single "atomic-edit" snippet block (`GameStateSchema` + `hashableState` + `selectGameState` + `overwriteFromGameState` + `createInitialState`) rather than spread across 4 prose sections.
- [C11] `SCHEME_KINDS` declared-order at constants.ts is hash-relevant (the enum order participates in `SchemeKindSchema = z.enum(SCHEME_KINDS)` and downstream `serializeRegistry` lex-sort of `state.schemes` keys); pin as part of the contract. **[skipped: superseded by C18 — C11 claim is incorrect. `state.schemes` lex-sorts on `SchemeId` strings (which embed `kind` as a substring), not on the array-declaration index. `z.enum(SCHEME_KINDS)` serializes by string value, not by index. The array-declaration order is NOT hash-relevant; ADDING to the enum IS hash-relevant; reordering is safe.]**
- [C11] P7 forward-compat test path: once `classifyArchetype` ships, Chaperone/Assassination buttons begin enabling — pin a P7 integration test to assert the dead-state transitions to live correctly.
- [C11] Replay-harness fixture (line 638) launches one of each scheme kind on tick 0; 2 of 6 kinds (Chaperone, Assassination) need synthetic archetype overrides — pin whether the fixture uses synthetic archetype-bypass or 4 launchable kinds + 2 fixture-only kinds.
- [C12] `store.ts:194-203` reference is one line off (actual `:194-204`); minor line-pin drift.
- [C12] Show the extracted `pruneOrphanedConversationKeys` body verbatim in the plan (signature is pinned but body is elided; 17-line lift from `aging.ts:38-54`).
- [C12] Restructure §Verification as a per-`(scheme, condition, assert)` table for easier completeness tracking.
- [C13] Boundary impact for new `src/runtime/events/scheme.ts`: verify its imports from `game-entities`/`game-rng`/`game-rules` resolve clean against the `runtime` ESLint element (mirror existing `conversation.ts` precedent).
- [C13] `clamp` helper home for `src/game/rules/schemes.ts`: existing rules duplicate `function clamp` locally (`bankruptcyEscape.ts:22`, `economy.ts:18`, `locationEffects.ts:29`, `monarchsAudience.ts:34`). Pin: follow the duplicate-local-fn pattern OR centralize in `src/game/util/clamp.ts` (which exists but isn't currently imported by rules). `[applied]`
- [C13] Seduction +80 affection saturates silently when starting affection > 20; pin a Vitest case for the saturation scenario AND a designer note that the +80 magic number is a designer tradeoff.
- [C13] Validation order in `tryStartScheme` lists `InsufficientWealth` BEFORE `TargetIsDead`; UX-wise the implementer may prefer surfacing "target is dead" prose first. Pin the ordering rationale (or accept "wealth first" as documented).
- [C13] `__buildSaveV6ForTests` should expose an overrides slot for a sample scheme entry so test fixtures can construct valid SaveV6 records with non-empty schemes.
- [C14] `pruneOrphanedConversationKeys` import in `src/game/rules/schemes.ts`: pin the literal import path as `import { pruneOrphanedConversationKeys } from "./aging";` (rule-to-rule import, permitted by existing precedent — aging.ts already imports `parsePairKey` from `../conversation/types`).
- [C14] `publishCharacterDeaths` home: confirm whether to keep it colocated in `src/runtime/events/conversation.ts` (current pin) OR split into `src/runtime/events/deaths.ts` for separation-of-concerns. Either works; commit to one to prevent the implementer from inventing a third.
- [C14] `mapFailureReasonToPayload` defensive throws on `null` failureReason — add a Zod refinement to `SchemeSchema` enforcing "null iff status !== Failed" so the defensive throws are theoretically unreachable.
- [C14] `publishSchemeTransitions` defensive assertion: throw when `after.schemes.size - before.schemes.size > 1` per tick advance (only one start path per store action).
- [C14] `__buildSaveV5ForTests` rename fanout: enumerate the three reference sites in `src/main.tsx` (lines 18, 25, 33) explicitly so the implementer audits all three.
- [C14] `__buildSaveV6ForTests` should be added to the cutover audit list alongside the existing `rg 'toSaveV5|fromSaveV5'` audit; expect 4 callsite hits (the renamed function + 3 references in `main.tsx`).
- [C15] `aggressorCharacterId` is hash-relevant but has zero behavioral observation at P5 (no per-aggressor effect varies the outcome); silent determinism regression hazard — pin a synthetic-fixture Vitest assertion that two schemes with different aggressors produce different hashes. `[applied]`
- [C15] Sabotage grievance id factory format `${perpetratorHouseId}:Sabotage:${schemeId}` double-embeds the perpetrator-house and the source kind (since schemeId already encodes both); pin intentional or strip to `Grievance:${schemeId}` for simplicity.
- [C15] Pin hashState equality assertion for byte-identical-rejection-safe contract: when `tryStartScheme` returns `{ok: false, reason}`, the returned state field is the SAME object identity as input — assert `hashState(stateBefore) === hashState(stateAfterRejection)` to lock the no-partial-mutation contract. `[applied]`
- [C15] Mood-drift → scheme-resolution ordering at P5 is forward-compatible (Sabotage's composure delta lands BEFORE mood-drift's chance to react), but at P5 NPCs only roll mood-drift from the weighted pool and don't read composure — pin as "forward-compatible, no observable effect at P5" so the implementer doesn't worry about adding a P5-only test.
- [C16] `flipSchemeStatus` overload signatures + defaulted-parameter form: pin in body that the runtime check (`newStatus === "Failed" ? failureReason : null`) is the contract; overloads are documentation. `flipSchemeStatus(state, id, "Failed")` without reason compiles via overload 3 but violates the runtime invariant — flag as a programmer-error case.
- [C16] Multi-Assassination same-tick prune cost: two Assassinations completing on the same tick call `pruneOrphanedConversationKeys` twice in series (each cloning conversationHistory + affectionMap Maps). Functionally correct (idempotent over disjoint key sets); pin "accept the per-call cost; aggregation deferred."
- [C16] Non-null assertions on `state.houses.get(scheme.ownerHouseId)!` in Smuggling/Assassination branches — sound per CLAUDE.md "Houses never deleted; status flips only" but pin inline comment near each `!` referencing the never-deleted contract so a future maintainer doesn't "defensively" strip them.
- [C17] `tryStartScheme` validation completes with early-returns before `selectAggressor` invocation — pin "selectAggressor's throw is defense-in-depth only; upstream MissingArchetype rejection has already filtered candidates" so implementer doesn't wrap in defensive try/catch.
- [C17] `SCHEME_PREREQUISITES` shape is hash-relevant; pin save-version-bump requirement parallel to `SCHEME_KINDS.length === 6` assertion.
- [C17] `fauxPasIndexOnThisTick` is mechanically always `0` at P5 (single-threaded ballroom + Independent house only); pin "P5: index always 0; forward-compatible for P8 rival faux-pas" so implementer doesn't defensively guard against impossible race conditions.
- [C17] `SCHEME_FAILURE_REASONS` additions require synchronous extension of `mapFailureReasonToPayload`'s switch AND a save-version bump; document as a save-version-bump checklist item alongside `SCHEME_KINDS.length === 6`.
- [C17] Restructure `publishSchemeTransitions` discussion with "(1) Schemes diff" / "(2) Grievances diff" sub-headings since the body reads like two functions stapled together.
- [C17] Promote C7 Sabotage cross-house mutation pattern (player pays wealth, target's house takes composure damage AND grievance) into body — load-bearing for P8 inheritance.
- [C18] `selectAggressor` uses explicit `state.houses.get(ownerHouseId)` undefined-check throw; `tryStartScheme` snippet at the corresponding callsite uses non-null assertion. Pin one defense pattern — recommend `getHouseOrThrow(state, ownerHouseId)` per `travel.ts:46` precedent.
- [C18] "Validation walk == aggressor walk" invariant is enforced only by code comment; add a Vitest fixture constructing a decoupled state (validation passes, aggressor walk fails) and assert the `selectAggressor` throw fires — locks the contract structurally. `[applied]`
- [C18] C11 claim "SCHEME_KINDS declared-order is hash-relevant via Map lex-sort" is incorrect — `state.schemes` lex-sorts on SchemeId strings (which embed kind as a substring), not on the array declaration order. Either correct C11 or ship a regression test pinning what is actually load-bearing. `[applied]`
- [C18] Key-rules table Assassination row omits the `pruneOrphanedConversationKeys` cascade effect; add to the row.
- [C18] Default `.sort()` on branded-string arrays (selectAggressor matches, aging.ts charIds) is the established codebase convention; pin in CLAUDE.md or constants comment.
- [C18] `pruneOrphanedConversationKeys` idempotence over disjoint id sets — add a Vitest assertion structurally locking the multi-Assassination same-tick contract. `[applied]`
- [C18] Verification: add `Object.is(input.state.schemes, result.state.schemes)` identity check on rejection paths (same object identity, not just structural equality) — locks no-partial-mutation tighter than hash equality alone. `[applied]`
- [C18] Pin invariant: `runYearPassPure` never mutates `state.schemes` and never appends to `house.grievances` — the symmetric `publishSchemeTransitions(before, after)` call inside `runYearPass`'s wrapper depends on this being a no-op at P5. `[applied]`
- [C19] Chaperone vs same-tick Seduction completion ordering: if both `endsAtTick === state.tick`, the resolver phase's lex-sort by `SchemeId` determines which runs first. If Chaperone runs first → Seduction is still Active and gets cancelled. If Seduction runs first → Seduction completes (possibly with discovery) and Chaperone walks an empty match set. Pin one (recommend Chaperone-wins per spec's "preempts" reading — either sort Chaperone schemes first OR filter Chaperone matches against `Active OR Completed` Seductions on same tick).
- [C19] Show literal `defaultHouseV4Fields` widened body — plan says "P5 widens the helper's body to also default `grievances: []`" but doesn't show the snippet. Symmetric with `stripGrievancesForLegacyEmit`. `[applied]`
- [C20] SchemeId factory lex-sort across mixed-kind ids is alphabetical-by-kind-name (`Assassination` < `Chaperone` < `Courting` < `Sabotage` < `Seduction` < `Smuggling`), NOT first-started-first — pin the implementer's intuition.
- [C20] selectAggressor sorts by CharacterId, not by archetype priority — pin the sort-key intent.
- [C20] publishSchemeTransitions grievance walk is O(houses × grievances) per tick — fine at P5 (Independent + player only); flag for forward-scaling note at P8+.
- [C20] Add inline comment near `selectGameState` discouraging top-level `state.grievances` field (grievances ride inside houses; trip-wire won't catch a misplaced top-level addition).
- [C20] Pin Vitest regression: tick-advance paths NEVER flip the player head's alive flag (heir-promotion only happens in `runYearPass`); the `publishCharacterDeaths` heir-skip guard relies on this. `[applied]`
- [C20] `applyTravel` rejection paths return input state unchanged; pin that flag flip only happens on success path (defense against future refactor).
- [C20] `fromSaveV4Bare` is currently `export function` at `schema.ts:331` — contradicts plan's "All Bare cores are private to schema.ts" claim. Either correct the prose or accept the existing public export (test files may need to import it).
- [C21] `fauxPasIndexOnThisTick` save/load round-trip: pin Vitest fixture covering "two same-tick FauxPas → ids `:0` and `:1` survive save/load AND advanceTick" — locks the insertion-order-through-serializeRegistry invariant. `[applied]`
- [C21] selectAggressor structural test asserting "validation passes, aggressor walk fails" can never occur (catches future maintainer decoupling the two walks).
- [C21] `__buildSaveV5ForTests` rename: ALSO audit `main.tsx:7` (import) and `:54` (`return toSaveV5(...)` call body) — five total sites, not three.
- [C21] `SchemeTransition` dead-field in phase context: resolver returns `{state, transition}` but phase discards transition. Either narrow resolver signature to `(state, scheme) => GameState` mirroring TickPhase, or use the transitions for something concrete at P5.
- [C21] `aggressorCharacterId` hash-relevance Vitest assertion: two schemes with same kind/owner/target but different aggressorCharacterId → distinct hashes (locks the field as load-bearing). `[applied]`
- [C21] Pin the death-cascade extraction as a safe commit checkpoint independent of the Assassination resolver wiring — implementer can land `pruneOrphanedConversationKeys` + `Set<CharacterId>` narrowing + aging.ts refactor + heir-comment migration as a green-tests intermediate before continuing.
- [C22] `accumulatedAffection` is hash-relevant but mechanically dead at v1 — without a Vitest asserting slot visibility, a maintainer "cleaning unused fields" silently bumps the hash. Pin a hash-projection-slot Vitest. `[applied]`
- [C23] `defaultHouseV4Fields` name becomes semantically misleading after P5 widening (V4 helper produces V6 shape). Consider renaming at P5 to `defaultHouseLegacyFields` or accept the name-vs-behavior drift with an inline comment.
- [C23] `ERA_TRANSITION_TICK` hash-irrelevance Vitest: pin one file path explicitly (NEW `src/game/constants.test.ts` vs extending existing — file does not currently exist; ship as new at P5). `[applied]`
- [C23] `EraFlippedDuringSmuggling` defensive branch is structurally unreachable in v1 (no mid-flight era flip path) — either ship a synthetic test that constructs `state.era === "Later"` with in-flight Smuggling, or drop the defensive branch and rely on start-time guard alone.
- [C23] Split `publishSchemeTransitions` into two helpers (`publishSchemeStatusTransitions` + `publishGrievanceAppends`) OR keep one helper but add explicit "(1) Schemes diff / (2) Grievances diff" sub-headings inside the body sketch.
- [C24] `selectAggressor` head-of-house default for `acceptable.length === 0` stays bound to a dead head if heir promotion runs mid-flight; not load-bearing at P5 (no behavioral observation by aggressor) but conceptually loose for P15+.
- [C24] Spec §3 line 122 says "PUBLIC faux-pas" records grievances; pin whether P4's `fauxPasFired` event semantics covers PUBLIC-only or any faux-pas (if ANY, private flubs accumulate trivial grievances against the player house — possible spec contract violation).
- [C24] `ERA_TRANSITION_TICK` test-fixture brittleness: replay-harness fixtures testing `SmugglingPastEraEdge` embed `200` implicitly; pin "test fixtures construct synthetic tick values relative to `ERA_TRANSITION_TICK`" so P13 retuning doesn't break P5 replay tests.
- [C24] `flipSchemeStatus` 3-arg overload form (`flipSchemeStatus(state, id, "Failed")` without reason) compiles but stores `null` → `mapFailureReasonToPayload` throws state-corruption. Pin "always 4-arg form for Failed transitions" inline.
- [C24] `accumulatedAffection` field name implies per-tick accumulation that v1 doesn't ship; add inline schema comment `// v1: always 0; v1.5 future-suspicion mechanic increments per tick`.
- [C24] Pin Vitest asserting `pruneOrphanedConversationKeys` extraction produces byte-identical output for the legacy single-call path (year-pass aging); locks the refactor as semantics-preserving. `[applied]`
- [C24] Promote "publisher discipline matrix" to a top-level structural section — other phases benefit from this pattern.
- [C25] PHASES snippet in plan over-states edit surface: only `tickOrchestrator.ts:42` changes (one-line `identityPhase` → `applySchemeResolutionPhase`). Pin "edit line 42 only; preserve lines 37-41 and 43-46."
- [C25] MASTER.md §5.2 catalog entry "Scheme (Active → Completed | Cancelled | Failed)" needs update to clarify "logical state machine, not literal XState actor — uses `Scheme.status` field." Add to close-out checklist. `[applied]`
- [C25] `selectAggressor` head-of-house alive-gate uses `throw new Error` (defense-in-depth); at P8+ when rival heads can die mid-tick, convert to typed `HeadOfHouseDead` rejection in `StartSchemeRejection` union so store-action wrapper returns `{ok: false, reason}` rather than propagating uncaught exception.
- [C25] `accumulatedAffection: 0` invariant unenforced at schema level — either a Zod `.refine(...)` OR a Vitest "no resolver branch mutates accumulatedAffection" assertion in schemes.test.ts.
- [C25] `mapFailureReasonToPayload` is private to publishSchemeTransitions; add inline "do not call from cancel paths" comment to prevent future maintainer re-routing.
- [C25] `publishSchemeTransitions` size-jumping delta assertion: at P5 only one start per store action — add `expect(after.schemes.size - before.schemes.size).toBeLessThanOrEqual(1)` defensive assertion.
- [C25] Consolidate two ad-hoc grievance-id factories (Sabotage / FauxPas) into `makeGrievanceId({source, perpetrator, scheme?, tick?, index?})` helper.
- [C25] `useShallow` (or equivalent) for `ActiveSchemesPanel.tsx`'s combined `(state.tick, state.schemes)` selector — without it, every tick re-renders the panel.
- [C25] `__buildSaveV5ForTests` Playwright/e2e spec audit: also `rg '__buildSaveV5ForTests' tests/ e2e/` at impl time for any spec files that invoke `window.__buildSaveV5ForTests(...)`.
- [C26] `publishSchemeTransitions(before, after)` call inside `runYearPass` is dead code at P5 — either drop until a future phase legitimately needs it OR ship a Vitest assertion locking `runYearPassPure` byte-identical-output for `state.schemes` and `state.houses.grievances`.
- [C26] `applyTravel` snippet adds two lines (hoisted `shouldConsumeBypass` + conditional field); plan prose says "ONLY extends the houses.set object literal" — pin "two-line edit: hoist for readability" or accept inline.
- [C26] `__buildSaveV6ForTests` overrides parameter should expose a `schemes` injection path for Playwright specs exercising V6 load-time scheme resumption.
- [C26] Pin `sendBallroomMessage` await-serialization dependency: `fauxPasIndex` pre-set walk assumes single-flight invocation; React-strict-mode double-effect or multi-tab would collide on grievance id. P4 orchestrator IS single-flight; add inline comment.
- [C26] Migrate the `runYearPassPure` no-op-for-schemes invariant into the top-of-function comment of `pruneOrphanedConversationKeys` so a future maintainer extending the helper sees the dependency.
- [C26] Save-version cutover commit-boundary pin: commit 1 = schema+migrations+main.tsx (typecheck unsatisfied without all three); commit 2 = test-file updates. Pin to prevent partial-commit drift. `[applied]`
- [C27] Sabotage six-state-surface enumeration: pin "Sabotage mutates owner.wealth, target.composure, target's house.grievances, scheme.status, scheme.resolvedAtTick, target's grievances insertion-order — all in one returned state via shallow Map clones."
- [C27] `HeadOfHouseDead` typed-rejection: add to `StartSchemeRejection` union for P8 forward-compat (rival heads can die mid-tick). `[applied]`
- [C27] Five-callsite before/after capture enumeration: advanceTick/travel/requestAudience/escapeBankruptcy/refreshWardrobe — pin which wrapper gets new `const before = get()` capture vs reuses existing `stateBefore`.
- [C27] Boundary positive-control for `runtime/events/scheme.ts → game/util/assertNever.ts` (folder fallback to `game-util`).
- [C27] Schema-Extension Atomic-Edit subsection (consolidate GameStateSchema + HouseSchema + hashableState + selectGameState + overwriteFromGameState + createInitialState + seedStartingFamily + buildIndependentHouse into one literal block).
- [C28] Per-kind resolver completion-flip call sites for Chaperone/Courting/Assassination should pin literal `flipSchemeStatus(state, id, "Completed", null)` form (only Seduction/Smuggling currently show literals; TypeScript catches the 3-arg form but slows implementation).
- [C28] SchemeId factory `schemeIndexOnThisTick` perf-comment at factory body: "no concern at P5; revisit at P14 ledger UI if N grows large."
- [C28] Resolve C11 vs C18 SCHEME_KINDS hash-relevance contradiction explicitly — C18 correct (state.schemes lex-sorts on SchemeId strings, not enum array index).
- [C28] `__buildSaveV6ForTests` schemes/grievances injection override — pin extension OR defer to P14.
- [C29] rng.ts literal edit block: add `SchemeIdSchema` + `GrievanceIdSchema` via `.transform`, mirroring lines 33-36 precedent. Pin both schema declarations AND companion TS type aliases adjacent.
- [C29] `mapFailureReasonToPayload` EraFlipped case: add `if (scheme.kind !== "Smuggling") throw new Error(...)` defense — symmetric with existing Discovered defensive throw. `[applied]`
- [C29] `publishSchemeTransitions` grievance walk: pin "houses Map keyset is monotonic" invariant inline at loop head, OR defensively walk `before.houses` outer.
- [C29] `defaultHouseV4Fields` widened body literal snippet — symmetric with `stripGrievancesForLegacyEmit`. `[applied]`
- [C29] Vitest: two schemes with identical kind/owner/target but different `aggressorCharacterId` → distinct hashes (locks aggressorCharacterId hash-relevance structurally). `[applied]`
- [C29] Vitest: `runYearPass` with N same-year deaths fires exactly N `TargetCharacterDied` events (heir excluded) — locks `publishCharacterDeaths` refactor correctness. `[applied]`
- [C29] Vitest: synthetic-archetype `selectAggressor` archetype-gated branch coverage (forward-compat regression bait for P7's classifyArchetype activation). `[applied]`
