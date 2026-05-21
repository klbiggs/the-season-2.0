# P9 — Elopement Sprint Overlay

> Part of [The Season Master Plan](../MASTER.md). Prior: [P8 — Rival Houses, Patronesses & Duels](./08-rivals-patronesses.md). Next: [P10 — Artifacts, Wardrobe, Forgery & Theft](./10-artifacts.md).

**Goal.** The discovered-Seduction interactive overlay: a 7-tile 1-D chase with three player actions (`Push`, `Fresh Horses`, `Surrender`), backed by a singleton `state.elopement: ElopementSprintState | null` field that survives save/load. Winning halves the player house's reputation AND, if both eloping character and target are unmarried at win-time, mints a new `MarriageRecord` with `viaElopement: true` (spec §4 line 546). Losing applies `+50 scandal`. Save format bumps to **v10** to carry the new top-level `state.elopement` field plus the new `MarriageRecord.viaElopement` boolean. P9 ALSO ships three rule-layer policy decisions that round out the Seduction → Elopement pipeline: (a) a per-aggressor `tryStartScheme` gate preventing concurrent player Seductions, (b) a per-action `ElopementInProgress` rejection on every player-elected mutation site (mirroring the P6 PlayerExile pattern), and (c) a new `pruneOrphanedConversationKeys` branch nulling `state.elopement` when the eloping character or target dies mid-sprint.

P9 is the project's first non-tick player-driven loop. Every prior player action either resolved within a single dispatch (free actions like `startScheme`/`weaponizeWhisper`) or consumed exactly one tick (pre-tick actions like `travel`/`requestAudience`). The elopement sprint occupies the player for multiple dispatches without advancing the gameplay clock — `state.tick` is FROZEN while `state.elopement !== null`, both by UX (the overlay replaces the Map) and by rule-layer enforcement (the new gate). This is a deliberate design choice driven by spec §3 line 46 ("An overlay mode (elopement sprint) suspends the underlying map without losing its state") and by the determinism contract: tick advancement consumes per-house mood-drift RNG, per-rival action RNG, and would resolve in-flight schemes — none of which is safe to fire while the player is mid-sprint in a state the saved-state replay must reproduce.

This phase also introduces the project's first SAME-PLAYER-ACTION self-replacing modal pattern. P4's ballroom overlay replaces the Map but the rule layer gates it at `enterBallroom` (one upstream check). P9's elopement overlay mounts AUTONOMOUSLY when `applySchemeResolutionPhase` flips a discovered Seduction into a sprint — there is no `enterElopement` action; the overlay appears as a side-effect of tick advancement. The Q4 verdict from the debate cycle codifies the principled axis: "Modal-state rule-layer gate principle: when a modal state suspends mutation affordances, gate at the rule layer when ANY of (a) the state persists across save/load, (b) free-action wrappers exist that bypass `advanceTickPure`, or (c) pre-tick mutation precedes `advanceTickPure` in any player-elected wrapper." Elopement satisfies all three: it persists across save/load (the spec requires resumable sprints), the P5/P6/P7/P8 free-action surface includes 13 mutation wrappers, and P3 pre-tick actions mutate `house.currentLocation` BEFORE `advanceTickPure`. The full rule-layer gate is therefore mandatory, not optional. This phase ALSO updates `CLAUDE.md` to memorialize the axis for future phases.

**What does NOT change (load-bearing — resolves cycle-1-iter-5 B1).** PHASES array length stays at **10** post-P9; year-pass STEPS length stays at **4**. P9 does NOT add a new tick-phase slot or year-pass step. The sprint mount happens as a SIDE-EFFECT inside `applySchemeResolutionPhase` (slot 5) when `resolveSeduction` hits the Discovered branch — the new `startElopementSprintFromDiscoveredSeduction` helper writes `state.elopement` from within the existing phase, NOT via a separate slot. Sprint actions (`push`/`freshHorses`/`surrender`) are non-tick free actions; they don't enter the phase chain at all. This matches the P7 "PHASES + STEPS array discipline" non-negotiable: arrays are append-only across phases, and P9 has no array additions.

**In scope.**

- **Save format bump to v10.** Adds **one new top-level GameState field** + **one new field on `MarriageRecord`** + **one new entity schema**. Every field is hash-relevant; every new entry has a default and a strip-on-emit:
  - `GameState.elopement: ElopementSprintState | null` — singleton (NOT a Map) holding the active sprint, or `null` when no sprint is in flight. Fresh state and every legacy lift default to `null`. Hash-relevant when non-null (tile positions, fresh-horses count) — saved games mid-sprint round-trip exactly. CLAUDE.md schema↔projection↔selector↔overwriteFromGameState quad-sync applies (see Quad-sync section below).
  - `MarriageRecord.viaElopement: z.boolean().default(false)` — flag set true ONLY when the marriage was minted by an elopement win. Legacy V1-V9 marriages default to `false` via `.default(false)` (per P8 precedent for `House.hostility` / `House.factionId`); no Pre-shape strip cascade rebuild required for parse-side. Emit-side gets a strip helper for `toSaveV1..V9` marriages-tuple emit — **for defense-in-depth + round-trip byte-identity parity, NOT for parse-safety** (Zod's default `.strip()` mode would silently drop `viaElopement` at parse time anyway). See the "Strip cascade for legacy emit" subsection below for the full framing.
  - **MarriageRecord construction sites — P9 edit list (resolves cycle-1 B2).** With `viaElopement: z.boolean().default(false)` added to the schema, `z.infer<MarriageRecordSchema>` is `{ ..., viaElopement: boolean }` (output type — defaults applied). Strict TS rejects any object literal that does NOT include `viaElopement`. The three construction sites that build a literal `MarriageRecord` (NOT a spread of an existing one) MUST be extended:
    - **`src/game/rules/proposal.ts:196-203`** (`applyProposalPure` accepted-branch): the existing literal enumerates `id, spouseAId, spouseBId, marriedAtTick, dissolved, dissolvedAtTick`. P9 EDIT: append `viaElopement: false` (player-elected proposal mints a non-elopement marriage).
    - **`src/game/rules/elopement.ts:resolveElopementTerminal`** (NEW at P9): the elopement win branch's literal MUST set `viaElopement: true` (this is the load-bearing distinguisher per spec §4 line 546).
    - **`src/game/__test-utils__/factories.ts:97-107`** (`makeMarriage(overrides)` factory helper) — the body is a `MarriageRecord` literal that powers ~15 test files (`conception.test.ts`, `happiness.test.ts`, `proposal.test.ts`, `persona.test.ts`, etc.). MUST be extended with `viaElopement: false` (BEFORE the `...overrides` spread so overrides win). Touching this single factory cascades to every downstream test file — without it, the next factory call site touched by an unrelated PR fails strict TS. (Resolves cycle-1-iter-2 B1.)
    - **`src/game/fixtures/marriageIdFactory.test.ts:40,58`** (and any other test fixture that hand-builds a `MarriageRecord` literal): extend with `viaElopement: false` so the fixtures compile.
    - **Audit at P9 time (resolves cycle-1-iter-7 B8 + cycle-2-iter-1 B1 + cycle-2-iter-3 B1 expected-count truth-up).** `pnpm typecheck` IS the canonical audit — TypeScript's strict mode + the `.default()` schema means any literal missing `viaElopement: false` (or `true` for the elopement-win site) fails compile. The grep is SUPPLEMENTARY and incomplete:
      ```bash
      # Find LITERAL MarriageRecord constructions WITH TYPE ANNOTATION:
      rg -n ': MarriageRecord = \{' src/ --type ts
      # Pre-P9 returns 4 matches across 3 files (proposal.ts:196, succession.ts:70, marriageIdFactory.test.ts:40,58).
      # Post-P9 returns 5 matches across 4 files (adds the new elopement.ts literal).
      # The grep MISSES factories.ts:97-107 because makeMarriage(overrides) declares return type via the function signature
      # ("function makeMarriage(overrides: Partial<MarriageRecord> = {}): MarriageRecord { return { ... } }"), NOT via
      # `: MarriageRecord = {` annotation on the return literal.
      ```
      **Explicit edit sites (NOT all caught by grep)** — implementer audits via typecheck + this enumerated list:
      - `src/game/rules/proposal.ts:~196` (typed literal — grep catches it — EDIT: add `viaElopement: false`).
      - `src/game/rules/elopement.ts:NEW` (typed literal — grep catches it — INCLUDE `viaElopement: true` at construction).
      - `src/game/rules/succession.ts:~70` (typed literal, spread `...rec` — grep catches it — AUTO-OK; `rec.viaElopement` carries through).
      - `src/game/__test-utils__/factories.ts:~97-107` (UNTYPED literal in `makeMarriage` factory return — **grep MISSES** — EDIT: add `viaElopement: false` BEFORE the `...overrides` spread; TS-strict catches the omission at compile because the factory's signature pins `: MarriageRecord` return type).
      - `src/game/fixtures/marriageIdFactory.test.ts:40,58` (typed literals — grep catches them — EDIT).
      Total edit count post-P9: **5 sites need a `viaElopement` line added** (proposal + elopement + factories + marriageIdFactory ×2); 1 site is spread auto-OK (succession). The factories.ts site is the canonical "grep-misses, typecheck-catches" example.
    - **Spread-based construction sites** (e.g., `src/game/rules/succession.ts:74` per cycle-1 review) are AUTOMATICALLY OK — `{ ...existingMarriage, ...overrides }` carries `viaElopement` through unchanged. No edit needed.
  - **`ElopementSprintState` Zod schema** (new at P9 — declared in `src/game/entities.ts` next to the existing entity schemas). **Reference constants directly (resolves cycle-2-iter-4 B1 — earlier cycle-1-iter-9 module-load-cycle claim was incorrect).** Verified live: `entities.ts:23` already imports from `./constants` at runtime, and the previously-feared cycle does NOT exist because `constants.ts` uses `import type { BankruptcyTier }` from `./rules/economy` (compile-erased). Extend the existing import block at `entities.ts:11-23` with the two P9 constants. Use the named constants in `.max(...)` calls per CLAUDE.md "Designer constants in one place" §10:
    ```ts
    // src/game/entities.ts (P9 EDIT — extend existing constants.ts import block):
    import {
      // ... existing imports (COURIER_*, GRIEVANCE_SOURCES, etc.) ...
      ELOPEMENT_TRACK_LENGTH,           // NEW at P9
      ELOPEMENT_FRESH_HORSES_MAX_USES,  // NEW at P9
    } from "./constants";
    
    // src/game/entities.ts (NEW schema at P9):
    export const ElopementSprintStateSchema = z.object({
      // The originating Seduction whose Discovered branch launched this sprint.
      // Used by the diff-helper to publish ElopementResolved with provenance,
      // and by the win-time rule to identify the aggressor/target pair (the
      // sprint never caches them — the rule re-reads from state.characters
      // at win-time to honor the same-tick proposeMarriage ordering contract).
      schemeId: SchemeIdSchema,
      elopingCharacterId: CharacterIdSchema,    // = source scheme's aggressorCharacterId
      targetCharacterId: CharacterIdSchema,     // = source scheme's targetCharacterId
      playerTilePosition: z.number().int().min(0).max(ELOPEMENT_TRACK_LENGTH),
      fatherTilePosition: z.number().int().min(0).max(ELOPEMENT_TRACK_LENGTH),
      freshHorsesUsedCount: z.number().int().min(0).max(ELOPEMENT_FRESH_HORSES_MAX_USES),
      // Provenance anchor for the P14 ledger (sprint duration display); never
      // read by resolution logic (tile positions drive outcome). Hash-relevant
      // so mid-sprint save/load reproduces exactly.
      startedAtTick: z.number().int().nonnegative(),
    });
    export type ElopementSprintState = z.infer<typeof ElopementSprintStateSchema>;
    ```
    No mirror-constants assertion needed; the named constants are the single source of truth.
    **No `outcome` / `status` field.** The sprint state exists ONLY while running. Terminal resolution atomically applies the effect (rep halve or scandal+50, optional marriage mint) AND sets `state.elopement = null` in the same store-action body. This keeps the hash projection clean (no "Resolved" zombie sprints in `state.elopement`) and matches the P5 precedent that scheme entities flip status while elopement sprints simply terminate. The bus event `ElopementResolved` carries the outcome (`Won` / `Lost` — Surrender folds into `Lost` per spec §3 line 377; no separate `Surrendered` variant — resolves cycle-1-iter-10 B1) to the diff-helper for ledger/UI consumption — see "Bus events" section below.
  - **Why singleton (not `Map<ElopementId, ElopementSprintState>`)?** Spec §3 line 84-90 describes the sprint as a singular overlay route. Q2 verdict gates `tryStartScheme` per-aggressor so only one player Seduction can be Active at a time, making concurrent sprints unreachable by construction. Singleton matches the spec and the UI: one overlay route, one active sprint. The schema's `schemeId` field is enough to disambiguate provenance for the ledger.
  - **Strip cascade for legacy emit (resolves the MarriageRecord widening + state.elopement addition; aligned with P8 `.default()` precedent — resolves cycle-1-iter-2 B3):**
    - **Parse-side: NO Pre-shape rebuild needed.** Following the P8 precedent for `House.hostility` / `House.factionId` (which uses `.default()` and keeps the LIVE `HouseSchema` referenced from SaveV6/V7/V8 marriages-equivalent tuples — verified at `src/persist/schema.ts`), SaveV1..V9 `marriages` tuple values CONTINUE to reference the LIVE `MarriageRecordSchema`. Parsing a legacy V1..V9 marriages-tuple JSON object (which has no `viaElopement` field) succeeds because `.default(false)` auto-backfills at parse time. No `MarriagePreV10Schema = MarriageRecordSchema.omit(...)` is required. No `fromSaveV{N}Bare` lift-time backfill is required.
    - **Emit-side: strip helper — defense-in-depth + round-trip byte-identity parity (NOT "required" for parse-safety).** Zod's default parse mode is `.strip()` (no `.strict()` calls anywhere in `src/persist/schema.ts`), so `SaveV{1..9}Schema.parse(emittedLiteral)` silently drops `viaElopement` at parse time even WITHOUT the helper. The strip helper is still wanted for round-trip byte-identity tests AND explicit hygiene — but framing as "required" was incorrect. A new `stripViaElopementFromMarriagesForLegacyEmit(marriages: ReadonlyArray<[MarriageId, MarriageRecord]>): Array<[MarriageId, Omit<MarriageRecord, "viaElopement">]>` is applied at every `toSaveV1..V9` emit-site for the marriages tuple — same shape as P8's per-House strip helpers. The destructure-and-spread pattern: `marriages.map(([id, m]) => { const { viaElopement: _v, ...rest } = m; return [id, rest]; })`. Nine emit-site invocations (V1 through V9 — V10 emits with the live schema and DOES include `viaElopement`).
    - `state.elopement` is a TOP-LEVEL field; it lives ONLY in the new `SaveV10Schema`. Legacy `toSaveV1..V9` simply do NOT serialize it (omitted from the emit-side object literal). On load, legacy lifters default it to `null` via outer wrap (`{ ...result, elopement: null }`) per the "Bare+wrap lifter discipline" section below — NO new seeder helper needed; the wrap is one line per legacy lifter (8 wrappers × 1 line = 8 LOC).
  - **`SaveV10Schema` declaration** (new at P9 in `src/persist/schema.ts`):
    ```ts
    // src/persist/schema.ts (NEW at P9):
    export const SaveV10Schema = z.object({
      version: z.literal(10),
      tick: z.number().int().nonnegative(),
      rng: z.array(z.tuple([HouseIdSchema, RngStateSchema])),
      houses: z.array(z.tuple([HouseIdSchema, HouseSchema])),    // LIVE HouseSchema (post-P8 widening; includes hostility/factionId via .default())
      characters: z.array(z.tuple([CharacterIdSchema, CharacterSchema])),
      marriages: z.array(z.tuple([MarriageIdSchema, MarriageRecordSchema])),  // LIVE MarriageRecordSchema with viaElopement
      campaignName: z.string(),
      era: z.enum(["Earlier", "Later"]),
      conversationHistory: z.array(z.tuple([ConversationPairKeySchema, z.array(ExchangeSchema)])),
      affectionMap: z.array(z.tuple([ConversationPairKeySchema, z.number().int().min(0).max(100)])),
      schemes: z.array(z.tuple([SchemeIdSchema, SchemeSchema])),
      whispers: z.array(z.tuple([WhisperIdSchema, WhisperSchema])),
      couriers: z.array(z.tuple([CourierPayloadIdSchema, CourierPayloadSchema])),
      staff: z.array(z.tuple([StaffIdSchema, StaffMemberSchema])),
      proposalsLog: z.array(z.tuple([CharacterIdSchema, ProposalLogEntrySchema])),
      tutorAssignmentsLog: z.array(z.tuple([CharacterIdSchema, TutorAssignmentLogEntrySchema])),
      pendingTutorTraitChoices: z.array(z.tuple([CharacterIdSchema, PendingTutorTraitChoiceSchema])),
      patronesses: z.array(z.tuple([PatronessIdSchema, PatronessRecordSchema])),
      rivalActors: z.array(z.tuple([HouseIdSchema, RivalActorStateSchema])),
      factionTensions: z.array(z.tuple([FactionPairKeySchema, z.number().int().min(0).max(100)])),
      duels: z.array(z.tuple([DuelIdSchema, DuelSchema])),
      // P9 ADDITION — nullable singleton:
      elopement: ElopementSprintStateSchema.nullable(),
    });
    export type SaveV10 = z.infer<typeof SaveV10Schema>;
    ```
    `SAVE_VERSION_CURRENT` bumps from `9` → `10` at `src/persist/schema.ts:67`.

- **Schema↔projection↔selector↔overwriteFromGameState quad-sync (CLAUDE.md non-negotiable).** ONE new top-level GameState field (`elopement`) trips the keyset extension test at `src/game/schema-projection-selector-extension.test.ts`. Required edits to ALL FOUR surfaces PLUS the `createInitialState` constructor (5th surface — resolves cycle-1-iter-3 B7):
  1. `GameStateSchema` (`src/game/entities.ts`): append `elopement: ElopementSprintStateSchema.nullable()` after the P8 quartet.
  2. `hashableState` (`src/game/hash.ts`): extend the projection with the new key. When non-null, serialize the sprint state in field-declaration order (no Map → no `serializeRegistry`; just direct property serialization). When null, hash `null` literal. **`state.elopement` IS hash-relevant — NOT excluded.** Tile mutations advance the hash; mid-sprint save/load reproduces the exact tile state. This is the load-bearing replay contract: two sessions that diverge in sprint actions land at different hashes; two sessions that converge at the same terminal outcome AND nulled `state.elopement` produce identical hashes from the post-sprint state forward.
  3. `selectGameState` (`src/game/store.ts`): extend the selector with `elopement: state.elopement`.
  4. `overwriteFromGameState` (`src/game/store.ts:overwriteFromGameState`): extend with `draft.elopement = next.elopement`. **Forgetting this fourth surface silently CLEARS `state.elopement` on every tick-advancing store action** per the CLAUDE.md `overwriteFromGameState` warning. Since `state.elopement` is nullable and the only sprint-active actions are NON-tick-advancing (push/freshHorses/surrender are free actions; tick-advancing actions are blocked by the Q4 gate), the regression risk is bounded — but the test must still verify the field survives a tick-advance from `null` state (e.g., the orchestrator advancing tick on a non-sprint campaign).
  5. **`createInitialState` (`src/game/store.ts:152-183`)** — the fresh-state constructor builds a `GameState` literal; strict TS rejects any literal missing the new `elopement` field. Append `elopement: null` to the constructor's return literal (after the `duels` line). The state-extension test will fail at module-load until this is added.
  - `src/game/store.replace-state.test.ts` gains ONE new `it(...)` block: seed a synthetic `state.elopement` with non-null sprint state, fire `replaceState(stateWithSprint)`, assert the sprint survives. (The block exercises the LOAD path, not the tick-advance path — tick-advance with non-null elopement is rejected by the new gate, so that test would never see post-tick state.)
  - **NOTE**: when `state.elopement !== null`, tick-advancing actions return rejection (Q4 gate). The quad-sync test for elopement therefore exercises only the load-path mirror, not the tick-advance mirror. The pattern matches P6's exile-gated quad-sync tests.

- **`migrate_v9_to_v10` and lifter discipline.** Pure function `(SaveV9) → SaveV10` at `src/persist/migrations/v9-to-v10.ts`. Body follows the bare+wrap pattern:
  ```ts
  // src/persist/migrations/v9-to-v10.ts (NEW at P9):
  export function migrate_v9_to_v10(save: SaveV9): SaveV10 {
    const bare = fromSaveV9Bare(save);
    // No seeding helper required at P9 — the new state.elopement field is
    // nullable and defaults to null on every legacy lift; the new
    // MarriageRecord.viaElopement field is .default(false) on parse so legacy
    // marriages auto-backfill at Bare deserialization. The migration is a
    // pure shape transformation with one new field (elopement: null) added
    // at the top level + zero changes to nested entities (viaElopement is
    // already populated by the Bare lifter via the schema default).
    const withElopement = { ...bare, elopement: null };
    return toSaveV10(withElopement);
  }
  ```
  **Effects:**
  - Adds `state.elopement: null` to every legacy save.
  - Adds `viaElopement: false` to every legacy `MarriageRecord` via the `.default(false)` Zod backfill (no explicit migration step needed; no `MarriagePreV10Schema.transform` path — the `.default(false)` on the live `MarriageRecordSchema` is the SOLE backfill mechanism per the strip-cascade subsection above).
  - **Draw budget: ZERO.** No RNG consumed; the migration is a pure shape transformation. Asserted in `v9-to-v10.test.ts`: `expect(migrate_v9_to_v10(save).rng).toEqual(save.rng)`.
  - **Idempotence assertion** ships in `src/persist/migrations/v9-to-v10.idempotence.test.ts` via the `assertMigrationIdempotent` helper. Additional explicit assertions (resolves recurring R5/R6 byte-identity contract from cycles 1-2):
    - `expect(SaveV10Schema.shape.rng).toBe(SaveV9Schema.shape.rng)` — structural-equality assertion guarding against a future `RngStateSchema` widening that would silently break the rng byte-identity claim.
    - `expect(migrate_v9_to_v10(saveWithLegacyMarriage).marriages[0][1].viaElopement).toBe(false)` — explicit confirmation that the `.default(false)` parse-side backfill actually populates the field post-migration (NOT just that the rng round-trips).
    - `expect(migrate_v9_to_v10(save).rng).toEqual(save.rng)` — byte-identical rng (no draw consumed during migration).
  - **`MIGRATIONS` registry extension (resolves cycle-1-iter-4 B1 + cycle-2-iter-2 B2 shape fix).** `src/persist/migrations/index.ts:40` declares the canonical `MIGRATIONS: readonly Migration[]` registry (verified at `src/persist/migrations/index.ts:40` + `assertMonotonic(MIGRATIONS)` boot guard at `:91`). The live convention (per `:44-87`) is to WRAP each migrate function with an inline `(s: unknown) => migrate_vN_to_vM(SaveVNSchema.parse(s))` — the parse step is registry-side, not migration-body-side. P9 EDIT — append a new entry following the live shape exactly:
    ```ts
    // src/persist/migrations/index.ts (NEW at P9):
    {
      from: 9,
      to: 10,
      migrate: (s: unknown) => migrate_v9_to_v10(SaveV9Schema.parse(s)),
      outputSchema: SaveV10Schema,
    },
    ```
    plus the imports: `import { migrate_v9_to_v10 } from "./v9-to-v10";` and `import { SaveV9Schema, SaveV10Schema } from "../schema";`. Without this, `assertMonotonic(MIGRATIONS)` still passes (the chain stays monotonic 1→2→...→9) but the `runMigrations(saveAtV9, targetVersion: 10)` call has no step to compose and the load path fails with "no migration from 9 to 10."
  
  **Bare+wrap lifter discipline.** Required edits to the existing lifter chain at `src/persist/schema.ts`:
  - **NEW at P9**: `fromSaveV9Bare` (split off `fromSaveV9`) — pure deserialization, no seeding. Body mirrors the V8Bare pattern from P8 (deserialize all Maps; emit GameState directly with `elopement: null` default).
  - **`fromSaveV9` (refactored at P9)**: passthrough — no P9 seeding needed (V9 saves already have all post-P8 entities). Body: `return { ...fromSaveV9Bare(save), elopement: null }`.
  - **`fromSaveV1` through `fromSaveV8` public wrappers**: extend each to set `elopement: null` as the OUTERMOST default. Concrete shape:
    ```ts
    // src/persist/schema.ts — VERIFIED LIVE composition shape post-P8 (pre-P9):
    //   fromSaveV1: seedRivalsAndPatronesses(seedWhispersCouriersStaff(seedSchemesAndGrievances(seedIndependent(Bare, playerSeed)), playerSeed))
    //   fromSaveV2..V6: same skeleton with progressively-skipped seeders
    //   fromSaveV7: seedRivalsAndPatronesses(V7Bare, playerSeed)
    //   fromSaveV8: seedRivalsAndPatronesses(V8Bare, playerSeed)
    //
    // P9 EDITS — wrap each composition's return with `{ ...result, elopement: null }`:
    export function fromSaveV1(save: SaveV1): GameState {
      const result = seedRivalsAndPatronessesIntoLegacyState(
        seedWhispersCouriersStaffIntoLegacyState(
          seedSchemesAndGrievancesIntoLegacyState(
            seedIndependentIntoLegacyState(fromSaveV1Bare(save), extractPlayerSeed(save.rng)),
          ),
          extractPlayerSeed(save.rng),
        ),
        extractPlayerSeed(save.rng),
      );
      return { ...result, elopement: null };  // NEW at P9
    }
    // ... symmetric for fromSaveV2..V8 ...
    ```
    The wrapper edit pattern is mechanical: 1 line per wrapper, 8 wrappers, ~8 LOC total. No new helper required.
  - **`src/persist/migrations/v1-to-v10-chain.test.ts`** (NEW file — ADDED alongside the existing `src/persist/migrations/v1-to-v9-chain.test.ts`, NOT renamed/replaced — resolves cycle-1-iter-2 B2 + cycle-1-iter-3 B5 path): walks every legacy save through the full migration chain `(V1 → V2 → ... → V10)` and asserts the bootstrapped V10 state from `createInitialState(playerSeed)` equals the migrated V10 state byte-for-byte (same hash). The existing chain-test files at `src/persist/migrations/v1-to-v{3,4,5,6,7,8,9}-chain.test.ts` REMAIN on disk per the additive-chain-test convention. Parity contract holds because P9 adds no PRNG draws on either path.

- **New designer constants in `src/game/constants.ts`.** All eight values one place per CLAUDE.md non-negotiable §5.7. Sprint mechanics (spec §3 lines 84-90 + 372-379):
  ```ts
  // P9 additions — Elopement sprint:
  export const ELOPEMENT_TRACK_LENGTH = 7;                         // spec §3 line 88 — fixed 7-tile track
  export const ELOPEMENT_PLAYER_START_TILE = 2;                    // spec §3 line 88 — player starts two ahead
  export const ELOPEMENT_FATHER_START_TILE = 0;                    // father starts at tile 0
  export const ELOPEMENT_PUSH_PLAYER_ADVANCE = 1;                  // spec §3 line 89 — Push: +1 player
  export const ELOPEMENT_PUSH_FATHER_ADVANCE = 1;                  // spec §3 line 89 — Push: +1 father
  export const ELOPEMENT_PUSH_COMPOSURE_COST = 5;                  // spec §3 line 375 — Push: -5 composure
  export const ELOPEMENT_FRESH_HORSES_PLAYER_ADVANCE = 2;          // spec §3 line 376 — Fresh Horses: +2 player
  export const ELOPEMENT_FRESH_HORSES_WEALTH_COST = 10;            // spec §3 line 376 — Fresh Horses: -10 wealth
  export const ELOPEMENT_FRESH_HORSES_MAX_USES = 3;                // spec §3 line 376 — Fresh Horses capped 3
  export const ELOPEMENT_LOSS_SCANDAL_DELTA = 50;                  // spec §3 line 379 — +50 scandal on loss
  // Reputation halve has no constant — it's a formula: reputation = clamp(floor(reputation / 2), 0, 100).
  ```
  Module-load assertions (defensive — applied during advisory triage):
  ```ts
  if (ELOPEMENT_PLAYER_START_TILE >= ELOPEMENT_TRACK_LENGTH) {
    throw new Error("Player would start at/past finish line");
  }
  if (ELOPEMENT_FATHER_START_TILE >= ELOPEMENT_PLAYER_START_TILE) {
    throw new Error("Father would start ahead of or alongside the player");
  }
  ```
  Catches two classes of designer-tuning regression: (a) sprint trivially winnable on tile 0, (b) father-ahead-of-player making the chase pre-decided.

- **New pure-rule module `src/game/rules/elopement.ts`.** Five pure functions covering the sprint loop and resolution. All return new state via hand-rolled clones per CLAUDE.md pure-rule structural-sharing contract (no Immer inside `src/game/rules/**`).

  - **`startElopementSprintFromDiscoveredSeduction(state: GameState, scheme: Scheme): GameState`** — invoked from inside `resolveSeduction`'s discovery branch (current body at `src/game/rules/schemes.ts:429-462`). **EXTENDS — does not replace — the existing scandal+flipSchemeStatus body** (resolves cycle-1 B4). The current resolveSeduction discovery branch already applies the `+25` (or `+5` Temptation-discounted) scandal AND calls `flipSchemeStatus(stateWithScandal, scheme.id, "Failed", "Discovered")` at line 462. P9 refactor: extract the scandal+flip into the new helper's body so resolveSeduction's discovery branch becomes ONE call to the new helper, with all three effects co-located. Helper body (atomically, in this order):
    1. Apply the scandal delta to `ownerHouse.scandal` (lifted verbatim from the current lines 445-456 — preserves the temptation-discount branch + clamp).
    2. Set `state.elopement` to a new `ElopementSprintState { schemeId: scheme.id, elopingCharacterId: scheme.aggressorCharacterId, targetCharacterId: scheme.targetCharacterId!, playerTilePosition: ELOPEMENT_PLAYER_START_TILE, fatherTilePosition: ELOPEMENT_FATHER_START_TILE, freshHorsesUsedCount: 0, startedAtTick: state.tick }`.
    3. Call `flipSchemeStatus(stateWithScandalAndSprint, scheme.id, "Failed", "Discovered")` (lifted verbatim from current line 462).
    
    Concretely the existing resolveSeduction body at `:429-462` reduces from `~30 LOC` to: `if (discovered) { return startElopementSprintFromDiscoveredSeduction(baseState, scheme); }`. **No double-scandal regression** — the helper is the SINGLE site applying the discovery-time scandal post-P9.
    
    **Cross-file `flipSchemeStatus` access (resolves cycle-4-iter-1 B1).** `flipSchemeStatus` is currently MODULE-PRIVATE at `src/game/rules/schemes.ts:141` (no `export`); the new helper in `elopement.ts` cannot import it. P9 EDIT: add `export` to `flipSchemeStatus` at `schemes.ts:141` (and the two overload declarations at `:146` / `:152`). The function becomes part of the rules-layer public API — boundary-rule clean per CLAUDE.md non-negotiable #1 (rules may import from other rules). No alternative inline of the flip logic — that would duplicate scheme-state-machine code and violate the "single chokepoint for status transitions" precedent.
    
    **Pre-condition defensive throw** (resolves Q2 verdict's "concurrent sprint" edge case): at function entry, if `state.elopement !== null`, throw `Error(\`startElopementSprintFromDiscoveredSeduction: state.elopement already non-null for scheme ${state.elopement.schemeId}; concurrent sprints unreachable per Q2 gate\`)`. Catches future regressions that widen `tryStartScheme` to allow concurrent Seductions WITHOUT extending this resolver.
    
    **Helper location (resolves cycle-1 R7).** The helper lives in `src/game/rules/elopement.ts`, NOT `schemes.ts`. To allow `resolveSeduction` (in `schemes.ts`) to call it, `startElopementSprintFromDiscoveredSeduction` is `export`ed from `elopement.ts` AND `resolveSeduction` (currently module-private) stays module-private but gains a NEW import `import { startElopementSprintFromDiscoveredSeduction } from "./elopement";` at the top of `schemes.ts`. **This crosses two rule files but stays inside `src/game/rules/**`** — boundary-rule clean per the existing CLAUDE.md non-negotiable #1.

  - **`applyElopementPushPure(state: GameState): GameState | { ok: false; reason: ElopementActionRejection }`** — applies the Push action. Validates: `state.elopement !== null` else `{ kind: "NoActiveSprint" }`. Mutates: `playerTilePosition += ELOPEMENT_PUSH_PLAYER_ADVANCE`, `fatherTilePosition += ELOPEMENT_PUSH_FATHER_ADVANCE` (both clamped to `[0, ELOPEMENT_TRACK_LENGTH]`), then mutates the eloping character's `composure = clamp(c.composure - ELOPEMENT_PUSH_COMPOSURE_COST, 0, c.maxComposure)`. If post-mutation `playerTilePosition === ELOPEMENT_TRACK_LENGTH` OR `fatherTilePosition === ELOPEMENT_TRACK_LENGTH` OR eloping character `composure === 0`, calls `resolveElopementTerminal(state, outcome)` to atomically apply the terminal effect. **All numeric constants referenced via named imports — no inlined magic numbers in the implementation** (CLAUDE.md non-negotiable §10).

  - **`applyElopementFreshHorsesPure(state: GameState): GameState | { ok: false; reason: ElopementFreshHorsesRejection }`** (resolves cycle-4-iter-2 B1 — return type uses the WIDER rejection union) — applies Fresh Horses. Validates in order: (1) `state.elopement !== null` else `{ kind: "NoActiveSprint" }`; (2) `state.elopement.freshHorsesUsedCount < ELOPEMENT_FRESH_HORSES_MAX_USES` else `{ kind: "FreshHorsesExhausted" }`; (3) `player house wealth >= ELOPEMENT_FRESH_HORSES_WEALTH_COST` else `{ kind: "InsufficientWealth" }`. Mutates: `playerTilePosition += ELOPEMENT_FRESH_HORSES_PLAYER_ADVANCE` (clamped to `[0, ELOPEMENT_TRACK_LENGTH]`), `freshHorsesUsedCount += 1`, player house `wealth -= ELOPEMENT_FRESH_HORSES_WEALTH_COST` (unbounded — wealth can go negative per spec §3). If post-mutation `playerTilePosition === ELOPEMENT_TRACK_LENGTH`, calls `resolveElopementTerminal(state, "Won")`. **All numeric constants via named imports — no magic numbers** (CLAUDE.md non-negotiable §10). The wider rejection type is needed because `FreshHorsesExhausted` and `InsufficientWealth` only exist in `ElopementFreshHorsesRejection` (not `ElopementActionRejection`); the wrapper at `elopementFreshHorses` matches this same wider type per the store-actions section below.

  - **`applyElopementSurrenderPure(state: GameState): GameState`** — applies Surrender. Validates: `state.elopement !== null` else throw (the store-action wrapper guards against this; throw signals impossible state). Mutates: `fatherTilePosition = ELOPEMENT_TRACK_LENGTH` (father advances to finish), then calls `resolveElopementTerminal(state, "Lost")` atomically — Surrender is ALWAYS a loss; the father's tile being at 7 is the loss condition per spec §3 line 377.

  - **`resolveElopementTerminal(state: GameState, outcome: "Won" | "Lost"): GameState`** — terminal resolver. Atomically applies the effect based on `outcome`:
    - **Won branch.** Reads `aggressor = state.characters.get(state.elopement.elopingCharacterId)` AND `target = state.characters.get(state.elopement.targetCharacterId)` AT THIS MOMENT (NOT cached at sprint-start — Q3 verdict's same-tick proposeMarriage contract). Computes new `playerHouse.reputation = clamp(Math.floor(playerHouse.reputation / 2), 0, 100)`. THEN evaluates the marriage-mint predicate. **Predicate HARMONIZED with `applyProposalPure` widow-remarriage semantics (resolves cycle-4-iter-2 B2 divergence).** Per `proposal.ts:127-138`, gates 10/11 reject ONLY when `marriage !== undefined && !marriage.dissolved` — a widow with non-null `marriageId` pointing at a `dissolved: true` MarriageRecord IS allowed to re-marry. P9 uses the SAME predicate:
    ```ts
    function isAvailableForRemarriage(c: Character, state: GameState): boolean {
      if (c.marriageId === null) return true;
      const m = state.marriages.get(c.marriageId);
      return m !== undefined && m.dissolved === true;
    }
    if (isAvailableForRemarriage(aggressor, state) && isAvailableForRemarriage(target, state) && aggressor.alive && target.alive) {
      // mint new MarriageRecord with viaElopement: true ...
    }
    ```
    On mint: new `MarriageRecord { id: makeMarriageId(state, aggressor.id, target.id), spouseAId: lex_smaller, spouseBId: lex_larger, marriedAtTick: state.tick, dissolved: false, dissolvedAtTick: null, viaElopement: true }`; sets both characters' `marriageId` to the new id (REPLACES the prior dissolved `marriageId` on a remarrying widow; the prior MarriageRecord stays in `state.marriages` with `dissolved: true` per the "never delete; status flips" invariant); flips target's role from Spinster/Dependent → Spouse (mirrors `applyProposalPure` at `src/game/rules/proposal.ts:212-218`). Otherwise (either spouse in an Active marriage): skip marriage mint; rep-halve still fires; the result is a "win-without-union" — narratively, the elopement was caught up to fast enough that the abandonment scandal landed but the parties returned to the status quo ante. Sets `state.elopement = null` atomically with all of the above.
    - **Lost branch.** Reads `playerHouse = state.houses.get(PLAYER_HOUSE_ID)`. Computes new `playerHouse.scandal = clamp(playerHouse.scandal + ELOPEMENT_LOSS_SCANDAL_DELTA, 0, 100)`. Sets `state.elopement = null`. No marriage mint, no character mutations.

  **All five functions follow the hand-rolled-clone discipline** per CLAUDE.md "Pure-rule structural-sharing contract": `new Map(state.X)` + `.set(...)` + `{ ...state, X: newMap }`. No Immer inside `src/game/rules/elopement.ts`.

- **`tryStartScheme` widening: Q2 verdict per-aggressor Seduction gate.** Extend `StartSchemeRejection` (declared at `src/game/rules/schemes.ts:56-64` — the CURRENT live union; preserve every existing variant verbatim) with TWO new variants. Verified live union shape post-P8:
  ```ts
  // src/game/rules/schemes.ts (P9 EDIT — appending two variants; do NOT rewrite existing ones):
  export type StartSchemeRejection =
    | { kind: "InsufficientWealth"; have: number; need: number }
    | { kind: "MissingArchetype"; required: readonly Archetype[] }
    | { kind: "WrongEra"; required: "Earlier" | "Later"; current: "Earlier" | "Later" }
    | { kind: "UnclaimedSmugglingPass" }
    | { kind: "SmugglingPastEraEdge"; completionTick: number; eraTransitionTick: number }
    | { kind: "TargetIsDead"; targetId: CharacterId }
    | { kind: "SelfTarget"; targetId: CharacterId }
    | { kind: "PlayerExiled" }
    | { kind: "ElopementInProgress" }            // NEW at P9 (Q4 verdict — universal gate; matches P6 PlayerExiled precedent of "rule-layer variant for wrapper-return-type symmetry, even if currently only reachable via wrapper path")
    | { kind: "SeductionAlreadyActiveForAggressor"; activeSchemeId: SchemeId };  // NEW at P9 (Q2 verdict)
  ```
  **On the rule-layer `ElopementInProgress` placement (addresses cycle-1-iter-3 B6).** `tryStartScheme` is called from BOTH the player wrapper (`startScheme`) AND `applyRivalActionPhase` (rival-owned OpenSabotage). The wrapper-level gate fires first for the player path, so the rule-layer variant is unreachable through that path. For the rival path, rivals never have an active player elopement so `state.elopement` would never be non-null when `tryStartScheme` fires from rival action. **The variant is therefore wrapper-return-type-symmetry-only, NOT defense-in-depth.** Keeping it preserves the cleaner type contract: `startScheme: (...) => ... { ok: false; reason: StartSchemeRejection }` works without a wrapper-side union widening (`StartSchemeRejection | { kind: "ElopementInProgress" }`). This matches the live P6 `PlayerExiled` precedent at `src/game/rules/schemes.ts:62`. Type-symmetry wins over union-trim per project convention.
  **Gate insertion point** (resolves cycle-1 B1 + cycle-1-iter-9 R1 + cycle-2-iter-4 B2 line-cite tightening): the gate runs IMMEDIATELY AFTER the `selectAggressor` call at `src/game/rules/schemes.ts:272` (the line `const aggressorCharacterId = selectAggressor(state, ownerHouseId, kind);`) AND BEFORE the `newHouses` clone at `:273` (`const newHouses = new Map(state.houses);`). The wealth-deduction WRITE follows shortly after at `:279` (`newHouses.set(ownerHouseId, { ...ownerHouse, wealth: ownerHouse.wealth + wealthDelta });`); the `makeSchemeId` call is at `:281`. Reading the aggressor first is required because the gate's `&&` clause compares against `aggressorCharacterId`. The placement keeps atomic-gating intact (validation precedes deduction per CLAUDE.md non-negotiable §5):
  ```ts
  // src/game/rules/schemes.ts (NEW block inside tryStartScheme, INSERT BETWEEN line 272 selectAggressor call AND line 273 newHouses clone; wealth-deduction WRITE follows at :279):
  // ... existing code through line 272:
  // const aggressorCharacterId = selectAggressor(state, ownerHouseId, kind);
  
  // P9 GATE — per-aggressor Seduction concurrency check (Q2 verdict).
  // Inserted post-selectAggressor (so aggressorCharacterId is in scope) and
  // pre-wealth-deduction (atomic gating). Functionally per-house at P9
  // because selectAggressor returns the head for Seduction; future-proof
  // for later phases that may widen the aggressor pool.
  if (kind === "Seduction") {
    for (const existing of state.schemes.values()) {
      if (
        existing.kind === "Seduction" &&
        existing.status === "Active" &&
        existing.ownerHouseId === ownerHouseId &&
        existing.aggressorCharacterId === aggressorCharacterId
      ) {
        return { ok: false, reason: { kind: "SeductionAlreadyActiveForAggressor", activeSchemeId: existing.id } };
      }
    }
  }
  
  // ... existing code resumes at line 273 newHouses clone; wealth-deduction WRITE at :279
  ```
  **Why per-aggressor (not per-house):** Q2 R1 advocate-B's concession surfaced that the current `selectAggressor` for Seduction unconditionally returns the head, so per-house and per-aggressor are functionally identical TODAY. Per-aggressor is future-proof: when a later phase widens Seduction's aggressor pool (e.g., heir / sibling becoming eligible), the gate auto-narrows to "this character cannot have two concurrent Seductions" rather than silently breaking the narrative claim. **Cost of future-proofing: zero (the check is one extra `&&` clause).**
  
  **§10 OQ addition** (this phase is the owner): "Allow concurrent player Seductions per aggressor (one each), or stricter / looser?" Recommended default: **per-aggressor (P9 verdict)**. Documented PROVISIONALLY in the §10 table; reopens if play surfaces the constraint. Tooltip text on the Seduction button when the gate fires: "[Aggressor name] is already pursuing [active target]. Wait for the current Seduction to resolve."

- **Pre-tick ordering contract: same-tick proposeMarriage ↔ Seduction win.** Q3 verdict locks the deterministic answer regardless of other policy choices. Verified at `src/game/store.ts:1083-1104` (`proposeMarriage` wrapper) + `src/runtime/tickOrchestrator.ts:57` (PHASES chain ordering): the pre-tick action pattern means `applyProposalPure` mutates `state.marriages` and `character.marriageId` BEFORE `advanceTickPure` invokes `applySchemeResolutionPhase` (where `resolveSeduction`'s Discovered branch can fire `startElopementSprintFromDiscoveredSeduction`). The elopement-rule body MUST read `state.characters.get(...)` at the resolver entry point (NOT cached at sprint-start) so the win-time predicate observes post-`proposeMarriage` state. **No code change required** — the PHASES chain already enforces ordering — but the contract is documented in the `resolveElopementTerminal` body via inline comment: `// Re-read aggressor + target via state.characters.get(...) at this moment (NOT sprint-start) — same-tick proposeMarriage may have mutated marriageId between sprint-start and sprint-win per the §7 pre-tick ordering contract.`
  
  **Vitest fixture** (new at P9): `src/game/rules/elopement.test.ts` `describe("same-tick proposeMarriage races sprint win")` — **pure-resolver unit test** (NOT an end-to-end runYearPass / advanceTick scenario, because at P9 the player head is the only legal proposer AND the only legal Seduction aggressor; the multi-tick race scenario is structurally unreachable through the wrappers). Hand-build state with: (a) `state.elopement` set to a synthetic `ElopementSprintState` at the terminal-tile-7 position, (b) `state.characters.get(targetCharacterId).marriageId` non-null (a synthetic marriage record seeded directly), (c) `state.characters.get(elopingCharacterId).marriageId` non-null OR null per the test variant. Then directly call `resolveElopementTerminal(state, "Won")`. Assert: no `viaElopement: true` marriage record is created when target's `marriageId` is non-null at resolver entry; rep-halve still fires. The test exercises the resolver's read-at-win semantics independently of any wrapper path.

- **Rule-layer ElopementInProgress gate (Q4 verdict, full 15-typed + 3-void implementation — resolves cycle-2-iter-6 B1 header truth-up).** Every player-elected mutation action's rejection union extends with `| { kind: "ElopementInProgress" }`, and every action body's TOP adds the same early-return pattern. 15 typed-rejection wrappers + 3 void-publish wrappers (`advanceTick`, `runYearPass`, `proposeMarriage` — the last is dual-fire, both typed-return AND void-publish on the same wrapper); total 18 surfaces across 17 distinct wrappers:
  ```ts
  // src/game/store.ts — pattern injected at the top of every gated wrapper:
  if (state.elopement !== null) {
    return { ok: false, reason: { kind: "ElopementInProgress" as const } };
  }
  ```
  **Gated wrappers** (15 typed-rejection + 2 void-publish; all currently host the analogous `PlayerExiled` check):
  - **Tick-advancing (driver) — void publish on `elopementBus`** (resolves cycle-1-iter-9 B1 bus-target contradiction). P9 introduces a dedicated `elopementBus` (new module `src/runtime/events/elopement.ts` per no-god-files convention); `ElopementBlocked` is one of the `ElopementEvent` variants on that bus. This DIVERGES from the P6 `PlayerExileBlocked` precedent (which stays on `whisperBus` per `src/runtime/events/family.ts:10-11` cross-cutting convention) — the P9 trade-off prefers per-domain bus partitioning. Future modal-state `Blocked` events (e.g., P15 succession crisis) follow the elopement precedent, not the P6 cross-cutting one. Document this divergence in CLAUDE.md's "Modal-state rule-layer gate principle" pin:
    - `advanceTick` (`src/game/store.ts:373`)
    - `runYearPass` (`src/game/store.ts:397`)
  - **Pre-tick player-elected (P3) — typed `ElopementInProgress` rejection**:
    - `travel` (`src/game/store.ts:432`)
    - `escapeBankruptcy` (`src/game/store.ts:510`)
    - `refreshWardrobe` (`src/game/store.ts:540`)
  - **`requestAudience` — distinct rejection shape (resolves cycle-1-iter-4 B2).** `requestAudience` (`src/game/store.ts:468`) returns `{ outcome: AudienceOutcome }` (NOT `{ ok, reason }`). The existing P6 PlayerExiled gate at the wrapper constructs `AudienceOutcome.Denied { reason: AudienceRejection }`. P9 EDIT: extend `AudienceRejection` at `src/game/rules/monarchsAudience.ts:26-33` with `| { kind: "ElopementInProgress" }`; the wrapper's gate at the top constructs `{ outcome: { kind: "Denied", reason: { kind: "ElopementInProgress" as const } } }` (mirroring the existing PlayerExiled branch shape, NOT the typed `{ ok: false, reason }` shape used by the other three P3 wrappers).
  - **Free actions (P5/P6/P7/P8) — typed `ElopementInProgress` rejection** (note: `proposeMarriage` is listed below for ergonomic grouping with other P7/P8 wrappers but is technically a PRE-TICK action, not a free action — see its bullet body for the publisher consequence):
    - `startScheme` (`src/game/store.ts:909`)
    - `cancelScheme` (`src/game/store.ts:933`)
    - `weaponizeWhisper` (`src/game/store.ts:962`)
    - `dismissWhisper` (`src/game/store.ts:1002`)
    - `assignStaff` (`src/game/store.ts:1020`)
    - `spymasterIntercept` (`src/game/store.ts:1043`)
    - `proposeMarriage` (`src/game/store.ts:1088`) — **PRE-TICK ACTION** (not a free action; calls `advanceTickPure` after `applyProposalPure` per `store.ts:1101`; resolves cycle-1-iter-9 R7 mislabel). **Dual-fire pattern**, mirroring the existing P6 PlayerExile shape at this wrapper (resolves cycle-1-iter-6 B1). The current PlayerExile gate at `store.ts:1090` publishes `PlayerExileBlocked` to `whisperBus` AND returns the typed `PlayerExiled` rejection at `:1094`. P9 ElopementInProgress at proposeMarriage MUST publish `ElopementBlocked` to `elopementBus` (NOT whisperBus — see "elopementBus divergence from P6" above) + return the typed `{ ok: false, reason: { kind: "ElopementInProgress" } } as ProposalOutcome`. **Both fires; not one or the other.** Verification: `rg -n "PlayerExileBlocked" src/game/store.ts` returns 3 sites at advanceTick/runYearPass/proposeMarriage today; post-P9, `rg -n "ElopementBlocked"` should also return 3 matches at the same wrapper bodies (publishing to `elopementBus`).
    - `assignTutor` (`src/game/store.ts:1136`)
    - `chooseTutorBonusTrait` (`src/game/store.ts:1155`)
    - `demandSatisfaction` (`src/game/store.ts:1196`)
  - **`enterBallroom`** (`src/game/store.ts:569` — declaration at `:210`) — gates `sendBallroomMessage` upstream because `ConversationFailure` uses `reason:` string discriminator incompatible with `{kind}` (same exemption as P6 PlayerExile).
  - **Exempt** (mirror P6 PlayerExile exemptions): `replaceState` (load path — saved games with non-null `state.elopement` must load cleanly so the overlay re-mounts on next render), `exitBallroom`, `abortBallroomRequest`. Plus the three NEW sprint actions (`elopementPush`, `elopementFreshHorses`, `elopementSurrender`) which are the ONLY mutations allowed while elopement is active.
  
  **`ProposalOutcome`** (P7) is the proposeMarriage return type. The rule-layer rejection union it composes is `ProposalRejection` (declared at `src/game/rules/proposal.ts:42-55`, NOT on `ProposalOutcome` itself which composes it at line 65). P9 EDIT lands ON `ProposalRejection`: append `| { kind: "ElopementInProgress" }` (resolves cycle-1-iter-4 B3). The wrapper at `src/game/store.ts:1088` constructs `{ ok: false, reason: { kind: "PlayerExiled" } } as ProposalOutcome` today; the P9 ElopementInProgress branch follows the same shape. Same edit shape as the P8 `DemandSatisfactionRejection` extension at `src/game/store.ts:267-274`.
  
  **`ElopementBlocked` bus event variant** (new at P9 — declared in new `src/runtime/events/elopement.ts` module per CLAUDE.md no-god-files; published on a new `elopementBus` exported from the same module). Shape mirrors `PlayerExileBlocked`:
  ```ts
  | { kind: "ElopementBlocked"; tick: number; attemptedAction: "advanceTick" | "runYearPass" }
  ```
  No live subscriber at P9 (debug-trace only); P14 ledger or P17 telemetry owns subscription. The void-publish from `advanceTick` and `runYearPass` is the only emit site.
  
  **Vitest matrix** (new at P9 — `src/game/store.elopement-gate.test.ts`; resolves cycle-2-iter-3 B2 + cycle-2-iter-5 B1 + cycle-4-iter-4 B1 final recount). **Live PlayerExile parity counts (verified)**: `grep -c 'reason: { kind: "PlayerExiled"' src/game/store.ts` returns **15 typed-rejection construction sites**; `grep -c "exiled === true" src/game/store.ts` returns **16 gating sites** (the 16th is `demandSatisfaction`'s `victimHouse.exiled` check which produces `DefenderExiled`, not `PlayerExiled` — distinct rejection variant, same wrapper); `grep -c "PlayerExileBlocked" src/game/store.ts` returns **3 void-publish sites** (`advanceTick`, `runYearPass`, `proposeMarriage`). **The canonical count for P9 ElopementInProgress gate widening is by WRAPPER, not by count framing**:
  | Wrapper | Gate shape | Test-block assertions |
  |---|---|---|
  | `travel` | typed `{ ok: false, reason: { kind: "ElopementInProgress" } }` | 1 |
  | `requestAudience` | `{ outcome: { kind: "Denied", reason: { kind: "ElopementInProgress" } } }` (distinct from generic ok/reason) | 1 |
  | `escapeBankruptcy` | typed | 1 |
  | `refreshWardrobe` | typed | 1 |
  | `startScheme` | typed | 1 |
  | `cancelScheme` | typed | 1 |
  | `weaponizeWhisper` | typed | 1 |
  | `dismissWhisper` | typed | 1 |
  | `assignStaff` | typed | 1 |
  | `spymasterIntercept` | typed | 1 |
  | `assignTutor` | typed | 1 |
  | `chooseTutorBonusTrait` | typed | 1 |
  | `demandSatisfaction` | typed; gate inserted at the ABSOLUTE TOP of the wrapper (BEFORE GrievanceNotFound at `:1180`, GrievanceAlreadyResolved at `:1186`, LegacyGrievanceUnactionable at `:1190`, existing PlayerExiled at `:1196`, and victimHouse.exiled `DefenderExiled` at `:1203` — resolves cycle-5-iter-1 B1 line-cite truth-up + ordering pin) | 1 |
  | `enterBallroom` | typed-return at `:569`; gates `sendBallroomMessage` upstream | 1 |
  | `proposeMarriage` | **dual-fire**: typed + void-publish `ElopementBlocked` on `elopementBus` | 2 (single block, two assertions) |
  | `advanceTick` | void-publish only | 1 |
  | `runYearPass` | void-publish only | 1 |
  
  **17 wrappers; 17 test blocks; 18 total assertions** (proposeMarriage's block has 2). The 15-vs-16 grep counts above reconcile here: 13 typed-only + 1 dual-fire (proposeMarriage) + 1 upstream-gate (enterBallroom) = 15 typed-construction sites; demandSatisfaction's separate `victimHouse.exiled === true` check has its own `DefenderExiled` shape (gate placement BEFORE both existing checks).
  
  Each block seeds `state.elopement: <synthetic non-null sprint>`, dispatches the gated action, and asserts the row's expected shape.
  
  **Cumulative cost**: ~17 wrapper edits × 3 lines = ~51 LOC + 17 rejection-union extensions + ~17 Vitest cases. Bounded, mechanical, symmetric with P6.

- **CLAUDE.md update — new non-negotiable pin codifying the principled axis (Q4 verdict observation).** Add the following entry to the "Non-negotiable architectural rules" section of `CLAUDE.md`, AFTER the existing "Terminal-state exile gate" entry:
  ```markdown
  - **Modal-state rule-layer gate principle (P9 generalization of P6).** When a modal state (P6 exile, P9 elopement, future P15 succession crisis) suspends mutation affordances, gate at the rule layer when ANY of: (a) the state persists across save/load, (b) free-action wrappers exist that bypass `advanceTickPure`, or (c) pre-tick mutation precedes `advanceTickPure` in any player-elected wrapper. The earlier "terminal vs transient" framing is superseded by "wrapper-bypass + pre-tick-mutation surfaces." For elopement specifically: every tick-advancing and free-action wrapper returns `{ kind: "ElopementInProgress" }` (or void-publishes `ElopementBlocked`) when `state.elopement !== null`. Exempt actions: `replaceState` (load path), the three sprint actions (`elopementPush`/`elopementFreshHorses`/`elopementSurrender`), and the ballroom cleanup actions (`exitBallroom`/`abortBallroomRequest`). `sendBallroomMessage` is gated upstream at `enterBallroom`.
  ```

- **`pruneOrphanedConversationKeys` extension (NEW BRANCH at P9).** Per CLAUDE.md `pruneOrphanedConversationKeys` is the canonical death-cascade helper. If the eloping character or target dies during a sprint (currently unreachable in v1 because ticks are gated from advancing, so no aging/duel/assassination death can land mid-sprint — but the helper IS called from non-tick paths too, e.g., the P5 `resolveAssassination` death cascade), the sprint MUST be terminated. P9 adds branch 5.
  
  **Required import block diff for `src/game/rules/aging.ts:13-16` (resolves cycle-1 B3 + cycle-1-iter-8 R2 + cycle-3-iter-1 B1 explicit-diff).** Verified live current imports at `aging.ts:13-16`:
  ```ts
  // BEFORE P9:
  import { parsePairKey } from "../conversation/types";
  import type { Character, GameState, RivalActorState } from "../entities";
  import { RIVAL_HOUSE_IDS_SET } from "../fixtures/rivals";
  import type { CharacterId, HouseId } from "../rng";
  ```
  P9 extends:
  ```ts
  // AFTER P9:
  import { parsePairKey } from "../conversation/types";
  import type { Character, ElopementSprintState, GameState, House, RivalActorState } from "../entities";  // ADDED: ElopementSprintState, House
  import { ELOPEMENT_LOSS_SCANDAL_DELTA } from "../constants";  // NEW import line
  import { RIVAL_HOUSE_IDS_SET } from "../fixtures/rivals";
  import { PLAYER_HOUSE_ID } from "../rng";                       // ADDED to existing rng import (split to value-import; HouseId/CharacterId stay type-only)
  import type { CharacterId, HouseId } from "../rng";             // remains type-only for the two existing brands
  import { clamp } from "../util/clamp";                          // NEW import line
  ```
  Five new symbols added across three import lines: `ElopementSprintState`, `House` (joining the existing `entities` type-import), `ELOPEMENT_LOSS_SCANDAL_DELTA` (new line from `constants`), `PLAYER_HOUSE_ID` (new value-import from `rng`, split from existing type-only line), `clamp` (new line from `util/clamp`).
  
  Branch 5 body (resolves cycle-1-iter-2 B4 — accumulator threading explicit):
  ```ts
  // src/game/rules/aging.ts (in pruneOrphanedConversationKeys body):
  // BRANCH 5 (NEW at P9): elopement sprint cleanup.
  // The current helper body's accumulators are: histFiltered, affFiltered,
  // newWhispers + whispersChanged, newChars + charactersChanged,
  // newMarriages + marriagesChanged, newRivalActors. There is NO existing
  // newHouses accumulator. P9 ADDS THREE NEW SYMBOLS to the helper:
  //   - `let newHouses: Map<HouseId, House> | undefined = undefined;`
  //   - `let housesChanged = false;`
  //   - `let newElopement: ElopementSprintState | null | undefined = undefined;`  // undefined sentinel = "no change"; null = "cleared"
  //   - `let elopementChanged = false;`
  //
  // (Lazy-allocate newHouses on first match to preserve the existing
  // structural-sharing discipline — match the newRivalActors lazy-clone
  // precedent at lines ~140-150.)
  if (
    state.elopement !== null &&
    (newlyDeadCharIds.has(state.elopement.elopingCharacterId) ||
      newlyDeadCharIds.has(state.elopement.targetCharacterId))
  ) {
    if (newHouses === undefined) {
      newHouses = new Map(state.houses);
    }
    const playerHouse = newHouses.get(PLAYER_HOUSE_ID);
    if (playerHouse !== undefined) {
      newHouses.set(PLAYER_HOUSE_ID, {
        ...playerHouse,
        scandal: clamp(playerHouse.scandal + ELOPEMENT_LOSS_SCANDAL_DELTA, 0, 100),
      });
      housesChanged = true;
    }
    elopementChanged = true;
    newElopement = null;
  }
  ```
  **Final-return-block extension (load-bearing).** The helper's terminal return block (current shape at `aging.ts:~145-158`) builds the result via conditional spreads. P9 EDIT extends with two new conditional members:
  ```ts
  return {
    ...state,
    // ... existing conditional members for whispers / characters / marriages / rivalActors / etc.
    ...(housesChanged && newHouses !== undefined ? { houses: newHouses } : {}),
    ...(elopementChanged ? { elopement: newElopement } : {}),
    conversationHistory: histFiltered,
    affectionMap: affFiltered,
  };
  ```
  Single-branch addition; matches the P7 multi-branch shared-accumulator pattern + the P8 newRivalActors lazy-clone pattern. **P9 is the FIRST phase to route a `state.houses` mutation through `pruneOrphanedConversationKeys` (resolves cycle-2-iter-1 B3 scope-widening callout).** Every prior House mutation happened at the call site (P5 grievance append, P8 hostility raise, etc.); branch 5 introduces a new responsibility: the death-cascade helper now mutates House.scandal on player house when sprint termination triggers. Document this in CLAUDE.md as a new pin alongside the Modal-state rule-layer gate principle: **"`pruneOrphanedConversationKeys` is now also a modal-state-cleanup helper, not only a conversation-key prune. P11+ death-cascade branches that need to fire cleanup mutations on `state.houses` follow this lazy-clone precedent."**
  
  Today this branch is unreachable in `runYearPass` because the gate prevents aging while `state.elopement !== null`, AND `resolveAssassination` can't fire because scheme-resolution is in a gated tick-advance. **The branch ships regardless, for defense-in-depth and because the helper's contract is "every death cascade goes through here."** The Q3 verdict explicitly rejected auto-dissolution of prior marriages on elopement-win — branch 5 ONLY handles the death-of-active-sprint-character case, NOT a marriage-dissolution case.
  
  **Branch-5 test pin** (resolves cycle-2-iter-1 B3 reachability claim verification + cycle-4-iter-5 B1 wrapper-level publish coverage):
  
  1. **Pure-helper unit tests** at `src/game/rules/aging.test.ts` — new `describe("branch 5: elopement sprint cleanup on dead character")` block. Tests hand-build state with `state.elopement: <synthetic non-null sprint>`, mark the eloping-character (or target) as in the `newlyDeadCharIds` set, call `pruneOrphanedConversationKeys(state, newlyDeadCharIds)` DIRECTLY (NOT via runYearPass or any wrapper — branch 5 is unreachable end-to-end via the production runYearPass path because the Q4 gate blocks tick-advance while `state.elopement !== null`; direct helper invocation is the canonical PURE-helper test shape), assert `result.elopement === null` AND `result.houses.get(PLAYER_HOUSE_ID).scandal === oldScandal + ELOPEMENT_LOSS_SCANDAL_DELTA` (clamped at 100). Two test variants: (a) eloping character dies, (b) target dies. Both produce the same outcome.
  
  2. **No store-wrapper end-to-end test required at v1 for branch 5** (resolves cycle-4-iter-5 B1 + cycle-4-iter-6 B1 — closes the loop by removing the publisher from runYearPass). Branch 5 is genuinely unreachable end-to-end at v1: every tick-advancing wrapper has the Q4 ElopementInProgress gate at the top, so `state.elopement !== null` voids the wrapper before any aging/scheme-resolution/duel-resolution step runs. The pure-helper test at (1) is the load-bearing branch-5 coverage at v1; no integration test needed because no integration path exists. Future v1.5+ phases that relax the Q4 gate must ship the corresponding integration test alongside the gate relaxation.
  
  3. **Direct publisher diff-helper test** at `src/runtime/events/elopement.test.ts` — asserts that `publishElopementTransitions(beforeWithSprint, afterWithNullElopement)` (synthetic before/after states with the diff already applied) publishes `ElopementResolved` to `elopementBus`. Captures the publisher-side contract independently of the rule-layer branch-5 reachability concern.

  **Branch-5 scandal-delta rationale (resolves recurring R2/R3 from cycles 1-2).** Spec §3 line 379 enumerates loss conditions as "father reaches tile 7, or player composure reaches zero" with `+50 scandal`. Death-of-character is NOT literally enumerated. The P9 policy choice: **death-cascade-mid-sprint counts as a de-facto loss; +50 scandal applies by extrapolation.** Rationale: the eloping character or target dying mid-sprint produces the same narrative outcome a defeat would (the elopement was unsuccessful, the scandal lands publicly). The branch's defense-in-depth status means this policy never fires at v1; if/when the Q4 gate is relaxed in a future phase, this rationale documents the intentional choice. Alternative ("0 scandal on death-cascade") was considered and rejected because it would create a perverse incentive in v1.5+ where the player could prefer death-during-sprint over loss-during-sprint as a damage-reduction tactic.

- **Sprint store-action wrappers (new at P9).** Three free-action wrappers analogous to P5's `startScheme` / `cancelScheme` — they do NOT advance ticks; they mutate `state.elopement` and conditionally `state.houses[playerHouseId]` / `state.characters[elopingCharacterId]`. All three return discriminated unions.
  ```ts
  // src/game/store.ts (StoreActions interface extension at P9):
  // P9 sprint actions. FREE ACTIONS — no tick advance, no advanceTickPure call.
  // Each one validates state.elopement is non-null and runs the corresponding
  // pure rule. Rejection unions are typed; terminal resolution is folded into
  // the pure rule body (resolveElopementTerminal sets state.elopement = null
  // and applies effect atomically). Diff helper on elopementBus walks
  // before/after to publish ElopementStarted/Progressed/Resolved.
  elopementPush: () =>
    | { ok: true }
    | { ok: false; reason: ElopementActionRejection };
  elopementFreshHorses: () =>
    | { ok: true }
    | { ok: false; reason: ElopementFreshHorsesRejection };
  elopementSurrender: () => { ok: true };  // Surrender is always reachable when sprint is active; no rejection union beyond NoActiveSprint
  ```
  Where:
  ```ts
  export type ElopementActionRejection =
    | { kind: "NoActiveSprint" };
  
  export type ElopementFreshHorsesRejection =
    | { kind: "NoActiveSprint" }
    | { kind: "FreshHorsesExhausted" }
    | { kind: "InsufficientWealth"; required: number; have: number };
  ```
  **Note**: sprint actions do NOT include `{ kind: "PlayerExiled" }` or `{ kind: "ElopementInProgress" }` in their rejection unions — they're the ONLY actions allowed while elopement is active. Exile mid-sprint is unreachable (Scandal-Sheet attribution requires `weaponizeWhisper` which is gated by `ElopementInProgress`).
  
  **SaveV10 hand-craft invariant (resolves recurring R4/R5 from cycles 1-2).** A hand-crafted SaveV10 could in principle load with BOTH `house.exiled === true` AND `state.elopement !== null` (both `replaceState` exemptions). The P9 policy: this state is INVARIANT-VIOLATED and not a supported configuration. The `replaceState` load path does NOT validate the invariant (it accepts any well-formed SaveV10 per the existing CLAUDE.md "load path is exempt" rule); sprint actions DO NOT guard defensively. Pinning: "if a load surfaces this combination, the sprint proceeds; treat it as a test-only / dev-only state. Future P-later could ship a `validateSaveInvariants(save)` audit at the load path if save-corruption surfaces in real player data." This is documented dead-code-by-design.

- **Bus events: new partition `src/runtime/events/elopement.ts` (per CLAUDE.md no-god-files).** Variants:
  ```ts
  // src/runtime/events/elopement.ts (NEW at P9):
  export type ElopementEvent =
    | {
        kind: "ElopementStarted";
        tick: number;
        schemeId: SchemeId;
        elopingCharacterId: CharacterId;
        targetCharacterId: CharacterId;
      }
    | {
        kind: "ElopementProgressed";
        tick: number;
        schemeId: SchemeId;
        action: "Push" | "FreshHorses";
        playerTilePosition: number;
        fatherTilePosition: number;
        freshHorsesUsedCount: number;
      }
    | {
        kind: "ElopementResolved";
        tick: number;
        schemeId: SchemeId;
        outcome: "Won" | "Lost";   // Surrender folds into Lost — no separate variant per spec §3 line 377
        marriageMinted: boolean;   // true ONLY when both unmarried at win-time (Q3 verdict)
        reputationDelta: number;   // negative on Won; 0 on Lost
        scandalDelta: number;      // 0 on Won; +50 on Lost
      }
    | {
        kind: "ElopementBlocked";
        tick: number;
        attemptedAction: "advanceTick" | "runYearPass";
      };
  
  export const elopementBus = new EventBus<ElopementEvent>();
  ```
  
  **Publisher discipline** (load-bearing):
  - `startElopementSprintFromDiscoveredSeduction` is called from inside `resolveSeduction` which runs DURING `applySchemeResolutionPhase`. Direct publish is impossible from inside a pure-rule phase (rules can't touch the bus). Instead: diff helper `publishElopementTransitions(before, after)` is called from tick-advancing store wrappers AFTER `set` returns — walks `before.elopement === null && after.elopement !== null` to publish `ElopementStarted`.
  - `elopementPush` / `elopementFreshHorses` wrappers publish `ElopementProgressed` directly (single mutation, known action kind).
  - `elopementSurrender` and the terminal branches of Push/FreshHorses publish `ElopementResolved` directly when the sprint nulls.
  - `advanceTick` and `runYearPass` publish `ElopementBlocked` directly (gate-fired, void return, no diff walk).
  - `publishElopementTransitions` is added to the list of diff-helpers fired by every tick-advancing store wrapper AFTER `set` (mirroring the P5/P6/P7/P8 diff-helper roster). **Walks BOTH directions (resolves cycle-2-iter-2 B3):**
    - `before.elopement === null && after.elopement !== null` → publish `ElopementStarted` (fires from `applySchemeResolutionPhase`'s discovery branch; reachable on `advanceTick` + the 4 P3 wrappers + `proposeMarriage`).
    - `before.elopement !== null && after.elopement === null` → publish `ElopementResolved` (reachable on `advanceTick` via P5 assassination resolution + P8 duel resolution if either lands a sprint-character death; NOT reachable via `runYearPass` because the Q4 gate at the year-pass wrapper top prevents the year-pass STEPS from running while `state.elopement !== null`). **Wrapper-side dedup pattern (P6 3rd-arg skip-rule):** sprint terminal-resolve wrappers (`elopementPush`/`elopementFreshHorses`/`elopementSurrender`) DIRECT-PUBLISH `ElopementResolved` from their own bodies (no diff helper call — sprint wrappers don't advance ticks). Today's contract: the 6 tick-advancing wrappers (NOT runYearPass) call `publishElopementTransitions` with no skip-set; sprint wrappers direct-publish; no overlap.
  - **Explicit wrapper edit list (resolves cycle-2-iter-1 B2 + cycle-4-iter-3 B9 + cycle-4-iter-6 B1 publisher-scope tightening):** add `publishElopementTransitions(before, after)` to the post-`set` publisher list of: `advanceTick`, `travel`, `requestAudience`, `escapeBankruptcy`, `refreshWardrobe`, `proposeMarriage` — **6 wrappers total** (NOT 7; `runYearPass` is EXCLUDED — see below). Every wrapper that runs `advanceTickPure` (which invokes `applySchemeResolutionPhase`) MUST get the publisher; otherwise a discovered Seduction landing during a P3/P7 pre-tick wrapper's tick chain silently fails to emit `ElopementStarted`. **`runYearPass` is INTENTIONALLY EXCLUDED at v1**: branch 5 of `pruneOrphanedConversationKeys` is unreachable through `runYearPass` because the Q4 ElopementInProgress gate at the wrapper top returns BEFORE the year-pass STEPS run — `state.elopement !== null` ⇒ the wrapper voids out with `ElopementBlocked` publish, no aging step fires, no branch 5 fires. Adding `publishElopementTransitions` to `runYearPass` would wire a dead-code publisher whose covered transition (`non-null → null`) cannot land via this path at v1. A future v1.5+ phase that relaxes the Q4 gate would re-evaluate; until then, the year-pass wrapper does NOT carry this publisher.
  - **Publisher-count framing — P9 ADDS +1 publisher per tick-advancing wrapper** (not a "5/5/6 → 6/6/7" bump). The CLAUDE.md "5/5/6 publisher trio" pin is ALREADY STALE relative to live code: verified at `store.ts:455-461, 502-505, 532-535, 562-565`, the 4 P3 wrappers (`travel`/`requestAudience`/`escapeBankruptcy`/`refreshWardrobe`) fire only **3 publishers each today** — `publishMarriageTransitions` and `publishTemptationLatchTransitions` are MISSING despite the pin's claim. **The pin-drift fix is OUT OF SCOPE for P9**. P9 adds ONLY `publishElopementTransitions` per the explicit 6-wrapper list above.
  - **ElopementResolved is the SOLE UI/ledger signal for marriage-via-elopement mints (resolves cycle-2-iter-2 B1).** `publishMarriageTransitions` at `src/runtime/events/family.ts:88-120` emits ONLY on `dissolved: false → true` transitions; it does NOT emit on marriage MINT. The P7 `proposeMarriage` wrapper's marriage mint surfaces via a direct `familyBus.publish(ProposalAccepted)` (NOT via `publishMarriageTransitions`). P9 elopement-win marriages do NOT fire `ProposalAccepted` — the ONLY UI signal is `ElopementResolved.marriageMinted: true` on `elopementBus`. **UI/ledger consumers MUST subscribe to `elopementBus` to display elopement marriages**; there is no familyBus mirror at v1. A future P-later "marriage events unification" phase could ship a `MarriageMinted` variant on familyBus for symmetry, but that is not in P9 scope.
  
  **Bus-event partition tests** (new at P9 — `src/runtime/events/elopement.test.ts`): one `it(...)` per variant kind, exercise the publish path with synthetic state diffs.

- **View component: `src/ui/elopement/ElopementOverlay.tsx` (new at P9).** Mounts when `state.elopement !== null`. Top-level layout:
  - **7-tile horizontal track** rendered via DOM divs with Framer Motion layout transitions. Each tile is a `<div>` with `data-testid` for Playwright. Two tokens (player + father) animate between tile positions via `layoutId`-based reconciliation.
  - **Three action buttons** (`Push`, `Fresh Horses`, `Surrender`), each dispatching the corresponding store action via the prop-bound store hook: `store.getState().elopement{Push|FreshHorses|Surrender}()` (matches BallroomView's prop-bound pattern, not a bare `useStore` import). Rejection-toast rendering for `FreshHorsesExhausted` / `InsufficientWealth`.
  - **Disclosure card** (Q3 verdict surface): rendered when `aggressor.marriageId !== null || target.marriageId !== null`. Copy: `"Target [name] is already married — winning will not produce a marriage record; the reputation cost applies regardless."` Reads `state.characters.get(state.elopement.targetCharacterId).marriageId` to gate visibility.
  - **"Return to map" affordance** per spec §3 line 44 — but in P9, this is wired as `elopementSurrender()` (matches spec line 89: navigating away forfeits = loss; in-flight side-effects must check overlay still exists). Confirmation dialog: `"Returning to the map will surrender the sprint. Continue?"` Click-through fires `elopementSurrender()`.
  - **Status display**: current tile positions (player vs father), composure remaining on eloping character, fresh-horses uses remaining (out of 3), wealth remaining.
  - **Mount-lifecycle**: `useEffect` on `state.elopement` non-null transition focuses the first action button; on null transition (resolution), brief Framer Motion exit animation (~400ms), then App.tsx ternary unmounts the overlay.
  - **NO local React state for sprint progression** — the overlay is a pure render of `state.elopement`. All mutations go through the store actions. This honors CLAUDE.md "post-await mutations check the request hasn't been superseded" by construction (no async paths in sprint actions).

- **View routing in `src/App.tsx`.** Extend the existing `inBallroom` ternary at `src/App.tsx:58-62` into a 3-way conditional. **Use the prop-bound hook `store` per the BallroomView precedent at `src/ui/ballroom/BallroomView.tsx:32-34`** (NOT a bare `useStore` import — App receives the hook as a Props.store prop):
  ```tsx
  // src/App.tsx — read elopement via the prop-bound store hook at the component level:
  const elopement = store((s) => s.elopement);
  
  // ... then extend the existing ternary:
  {elopement !== null ? (
    <ElopementOverlay store={store} />
  ) : inBallroom ? (
    <BallroomView store={store} onExit={() => setInBallroom(false)} />
  ) : (
    <MapView store={store} onEnterBallroom={() => setInBallroom(true)} />
  )}
  ```
  The mount/unmount is reactive to `state.elopement` changes — when the discovered-Seduction branch fires inside a tick-advancing action, the post-`set` re-render mounts the overlay automatically.

- **§10 OQ additions to `plans/MASTER.md` (new at P9).** Three new rows in the §10 Open Questions table:
  - "Allow concurrent player Seductions per aggressor, or stricter / looser?" — Recommended default: **per-aggressor (one Seduction per aggressor character at a time)**. Resolved at P9 ([phases/09-elopement.md](./phases/09-elopement.md)) PROVISIONALLY; reopens if v1 play surfaces the constraint as too restrictive (e.g., players want to run parallel Seductions on different targets with the same aggressor).
  - "On elopement win with one party already married, mint marriage or apply rep-halve only?" — Recommended default: **rep-halve always; marriage minted only if both unmarried at win-time**. Resolved at P9 ([phases/09-elopement.md](./phases/09-elopement.md)); preserves spinster-affair gameplay tone while avoiding bigamous state shape. Future P-later "Abandonment" / "Divorce" action can model explicit dissolution-then-remarriage with its own cost surface.
  - "Should ticks advance during an active elopement sprint, or is sprint a session-scoped modal that suspends time?" — Recommended default: **suspend (rule-layer gate on every tick-advancing and mutation action when `state.elopement !== null`)**. Resolved at P9 ([phases/09-elopement.md](./phases/09-elopement.md)); see CLAUDE.md Modal-state rule-layer gate principle for the generalized framing.

- **Phase index status update.** P9's status in `plans/MASTER.md` §6 flips from `—` to `🚧 in progress` at phase start, `✅ done` at close-out.

**Out of scope.**

- **Multi-tick suspicion mechanic for Seduction discovery (§10 OQ #6 deferral).** P5's resolution pinned one-shot binary discovery at completion (`SEDUCTION_DISCOVERY_PROBABILITY = 0.2`). Per-tick rolls + NPC suspicion levels + mid-flight cancellation paths are explicitly deferred to v1.5; the `accumulatedAffection` field on `Scheme` already reserves shape for the transition.
- **Auto-dissolution of prior marriages on elopement win (Q3 verdict deferral).** P9 does NOT dissolve any pre-existing marriage when the eloping character or target is already married. A future explicit "Abandonment" or "Divorce" player action models this with its own consent UI, cost surface, and dependency on the §3 line 546 `viaElopement` flag combined with a NEW `viaAbandonment` field on `MarriageRecord` — out of scope for P9.
- **Multi-character / multi-target elopement sprints.** The singleton `state.elopement` does NOT support sibling-rivals, NPC-driven sprints, or rival-perpetrated sprints. P11 sibling-rivals may add a separate Map for cross-house sprints if the narrative demands it.
- **Replay-harness action-log shape extension.** P0's deterministic replay harness exists but does NOT yet record action sequences (only state hashes). P9 ensures sprint progression is hash-tracked (tile positions are in `state.elopement`, IN the hash), so a future action-log harness extension that records each sprint action (`Push`/`FreshHorses`/`Surrender`) will deterministically reproduce the same final state from the same input sequence. The harness extension itself ships in a later phase (likely P14 ledger or a dedicated determinism phase).
- **Concurrent rival Seductions and rival-driven elopement sprints.** P8 rivals ship OpenSabotage and LeakWhisper actions only; Seduction is not in the rival action pool. If a future phase widens rival actions to include Seduction, the singleton `state.elopement` would NOT host a rival sprint (the overlay is player-only). The Q2 gate is `ownerHouseId === input.ownerHouseId`, so rival Seductions (if/when shipped) get their own per-house slots and their own resolution semantics independent of the player overlay.
- **NPC-initiated elopement.** Spec §3 contemplates discovered Seductions only; an NPC eloping with an NPC target (no player aggressor) is out of scope at v1.
- **Pursuit speed modifiers via traits.** The Push / Fresh Horses action constants are global; a future phase could apply trait modifiers (e.g., "Sportsman" trait grants +1 to Fresh Horses advance), but P9 ships fixed values per spec §3.

**Spec refs.** §3 "Elopement Sprint" (lines 84-90, 372-379), §3 "View Routing Between Modes" (lines 41-46 — overlay suspends Map), §4 "Marriage Record" (line 546 — via-elopement flag), §4 "Elopement Sprint State" (line 551 — entity shape), §7 "Mid-conversation view exit" (lines under edge cases — leaving overlay = surrender), §9 "Lessons Learned" (the spec's mandate to gate at rule-layer, not just UX).

**Key constants (in `src/game/constants.ts`).** See "New designer constants" section above. Summary table:

| Constant | Value | Spec ref |
|---|---|---|
| `ELOPEMENT_TRACK_LENGTH` | 7 | §3 line 88 |
| `ELOPEMENT_PLAYER_START_TILE` | 2 | §3 line 88 |
| `ELOPEMENT_FATHER_START_TILE` | 0 | §3 line 88 |
| `ELOPEMENT_PUSH_PLAYER_ADVANCE` | 1 | §3 line 89 |
| `ELOPEMENT_PUSH_FATHER_ADVANCE` | 1 | §3 line 89 |
| `ELOPEMENT_PUSH_COMPOSURE_COST` | 5 | §3 line 375 |
| `ELOPEMENT_FRESH_HORSES_PLAYER_ADVANCE` | 2 | §3 line 376 |
| `ELOPEMENT_FRESH_HORSES_WEALTH_COST` | 10 | §3 line 376 |
| `ELOPEMENT_FRESH_HORSES_MAX_USES` | 3 | §3 line 376 |
| `ELOPEMENT_LOSS_SCANDAL_DELTA` | 50 | §3 line 379 |

**Machines.** Elopement sprint (Running → Won | Lost), implemented as a `state.elopement: ElopementSprintState | null` singleton field. NOT a literal XState v5 actor ref (same reasoning as P5's per-scheme actor decision and P8's per-rival actor decision: a singleton sprint with three transition actions doesn't justify the actor-ref overhead, and save/load serialization stays simpler). The pure resolver functions (`applyElopement{Push|FreshHorses|Surrender}Pure` + `resolveElopementTerminal`) ARE the state machine.

**Edge cases (§7).**

- **"Mid-conversation view exit" pattern (spec §7).** Player navigating away mid-sprint loses by default (Surrender). The Q4 rule-layer gate enforces this at the data layer: no tick-advancing action can fire while `state.elopement !== null`. The UI "return to map" affordance routes through `elopementSurrender()` per the View component spec above.
- **Save mid-sprint → load**: `state.elopement` is hash-relevant and serialized in `SaveV10`. On load, `App.tsx` re-mounts `ElopementOverlay` via the conditional check on `state.elopement !== null`. The sprint resumes from the exact tile state at which it was saved. **No special-case handling required** — the singleton field round-trips through `serializeRegistry`-free direct property serialization (it's a nullable object, not a Map).
- **Same-tick `proposeMarriage` race**: Q3 verdict locks the deterministic ordering. The `resolveElopementTerminal` body re-reads `state.characters.get(...)` at win-time, observing any same-tick `proposeMarriage` that landed via the pre-tick action pattern.
- **Eloping character or target dies mid-sprint**: `pruneOrphanedConversationKeys` branch 5 terminates the sprint as Lost with +50 scandal (no rep-halve). Unreachable in v1 because the Q4 gate prevents ticks from advancing, but the branch ships for defense-in-depth.
- **Concurrent player Seductions**: the Q2 per-aggressor `startScheme` gate prevents same-aggressor concurrent Seductions. Two DIFFERENT aggressors running Seductions in parallel is reachable today only if a later phase widens `selectAggressor` for Seduction beyond head-only — at which point both could discover same-tick. The `state.elopement` singleton field's behavior in that scenario: the FIRST one to fire `startElopementSprintFromDiscoveredSeduction` (lex order of schemeId, matching the two-pass resolver's deterministic walk in `applySchemeResolutionPhase`) wins the slot; the second's defensive throw catches the regression. (Position A's "lex-smallest wins" pattern is retained as the failsafe inside the resolver, even though the Q2 gate makes it unreachable at v1.)
- **`enterBallroom` while sprint is active**: gated upstream at `enterBallroom` per the existing PlayerExile pattern. Player cannot enter the ballroom from the elopement overlay; must surrender first.

**Verification.**

Before declaring P9 done, all the following gates must be green:

- `pnpm test` — all Vitest suites pass. New suites at P9:
  - `src/game/rules/elopement.test.ts` — pure resolver tests (~20 cases): Push tile math, FreshHorses tile math + wealth deduction + cap check, Surrender forces father to 7, terminal win applies rep-halve, terminal win mints marriage when both unmarried, terminal win skips marriage when either married, terminal loss applies +50 scandal, defensive throw on concurrent sprint. **NOTE on composure-zero loss path (applied during advisory triage)**: at default `ELOPEMENT_PLAYER_START_TILE=2`, the player wins in 5 Pushes (tile 2 → 7) consuming `5 × 5 = 25` composure. Default starting composure (100) never drains to zero in standard play. Testing the composure-zero loss branch (spec §3 line 379 — "player composure reaches zero") REQUIRES a hand-crafted low-composure character fixture (e.g., aggressor starts sprint with `composure ≤ 25` from prior P5/P6 mutations). The test must explicitly seed this state.
  - `src/runtime/tickOrchestrator.elopement-mount.test.ts` (resolves recurring R3 "phase-chain side-effect test for sprint mount" from cycles 1-2): positive-control phase-chain test. Seeds a Seduction at `endsAtTick` with discovery RNG primed to land discovered; fires `advanceTick`; asserts `state.elopement` transitions from `null` to a `ElopementSprintState` matching the source scheme's `aggressorCharacterId` / `targetCharacterId` / `schemeId` (and asserts `ElopementStarted` published on `elopementBus`). Pins the new `applySchemeResolutionPhase` responsibility against silent regression by a future phase moving the sprint-mount helper to a different slot.
  - `src/game/rules/elopement.same-tick-races.test.ts` — same-tick `proposeMarriage` ↔ sprint-win ordering contract.
  - `src/game/store.elopement-gate.test.ts` — 17-action gate matrix (one test per gated action).
  - `src/runtime/events/elopement.test.ts` — bus event partition tests (one per variant kind).
  - `src/persist/migrations/v9-to-v10.test.ts` — migration tests + idempotence.
  - `src/persist/migrations/v1-to-v10-chain.test.ts` — full migration-chain parity (ADDED alongside `v1-to-v9-chain.test.ts`; both files coexist per the additive-chain-test convention — NOT a rename or replacement).
- `pnpm lint` — Biome clean; boundary-rule clean. The new `src/game/rules/elopement.ts` may import only from `src/game/constants.ts`, `src/game/fixtures/**`, `src/game/rng.ts`, and other `src/game/rules/**` files (CLAUDE.md non-negotiable #1).
- `pnpm typecheck` — strict TS clean. Discriminated-union exhaustiveness checks pass for `ElopementEvent`, all rejection unions extended with `ElopementInProgress`, the new `ElopementSprintState` schema parses correctly, and the new `SaveV10Schema` round-trips.
- **Replay harness 30-run stability** — `state.elopement` is in the hash projection; sprint actions are deterministic (no PRNG); two campaigns with identical seeds + identical action logs produce identical hashes at every step, including mid-sprint.
- **Playwright e2e**: `tests/e2e/elopement.spec.ts` — launch a campaign, force a Seduction to discovery (test-only RNG override fixture), reach the sprint overlay, press Push until tile 7, assert `state.houses.get(PLAYER_HOUSE_ID).reputation` halved on the post-sprint store state. SECOND e2e: launch, Seduction → discovery → sprint → Surrender, assert `+50 scandal` on player house.
- **CLAUDE.md amendment** (the Modal-state rule-layer gate principle pin) is in place and `rg "Modal-state rule-layer gate principle" CLAUDE.md` returns a match.
- **§10 OQ updates** in `plans/MASTER.md` are committed.
- **Stale-comment cleanup**: `rg "PlayerExileBlocked" src/runtime/events/` returns matches in `whisper.ts` (the existing P6 site) AND `elopement.ts` is created (new bus partition). `rg "ElopementBlocked" src/` returns matches in `elopement.ts` (the variant declaration) and `store.ts` (the publish sites at `advanceTick` / `runYearPass`).
- **`src/persist/migrations/v1-to-v10-chain.test.ts` ADDED (NOT a rename; NOT a replacement — resolves cycle-1-iter-6 B2)**: new file added alongside `src/persist/migrations/v1-to-v9-chain.test.ts` per the additive-chain-test convention (every prior phase keeps its full-chain regression baseline on disk; `ls src/persist/migrations/` shows v1-to-v3 through v1-to-v9 all coexist). The existing v9-chain test file is NOT deleted. Walks V1 → V2 → ... → V10 and asserts bootstrap-vs-migrated parity at V10.

**Close out.** When the gates and verification items above are green, run `/close-phase P9` to update phase status in `plans/MASTER.md` §6, append to `plans/SESSION-NOTES.md`, resolve any open questions answered during the work, apply any `CLAUDE.md` additions, and commit the changes (no push).

## Accumulated Risks & Suggestions

*Passively collected from review cycles. Not blockers. Triaged at convergence.*

- [C1] Chain test rename contradicts established convention — every prior phase ADDED a new chain test (v1-to-v3, v4, v5, v6, v7, v8, v9 all coexist); plan's "rename" claim is anomalous.
- [C1] Same-tick proposeMarriage race test scenario as narrated is structurally unreachable at P9 — player head is the only legal proposer AND the only legal Seduction aggressor; reframe as a pure-resolver unit test using synthetic state.
- [C1] `useStore(s => s.elopement)` hook usage doesn't match codebase pattern — actual pattern is `store((s) => s.X)` direct on the hook bound via prop (cf. BallroomView.tsx:32-34).
- [C1] SaveV9Schema swap to MarriagePreV10Schema is a new "live-becomes-legacy" pattern affecting 8 emit sites — wider cascade than the plan's one-bullet treatment suggests.
- [C1] Idempotence assertion shape may be tightened — explicitly pin the byte-identity contract between SaveV9.rng and SaveV10.rng shapes.
- [C1] `applySchemeResolutionPhase` gains a side-effect (sprint mount via state.elopement) without explicit phase-chain test coverage — add a positive-control test for this new responsibility.
- [C1] `resolveSeduction` is module-private at schemes.ts:407 — must either export, or the new helper must live in schemes.ts; the plan should pin which (now addressed in B4 fix; this item is [likely addressed]).
- [C1] The CLAUDE.md "Modal-state rule-layer gate principle" entry is good but could be tabular — structuring as a table with examples (P6 exile, P9 elopement, hypothetical P15 succession crisis) would make future-phase application clearer.
- [C1] Consider whether `resolveElopementTerminal` should be public — has one caller per branch all in the same file; default to private; export only if test imports it.
- [C1] `ElopementSprintState.startedAtTick` is hash-relevant but never read by resolution logic — pin the provenance rationale inline.
- [C1] `ElopementBlocked` bus event has no live subscriber — matches P6 `PlayerExileBlocked` precedent; defer to P14 ledger / P17 telemetry is defensible.
- [C1] Plan body grew long; consider an "Accumulated Risks" tail style triage if revisions follow — later revisions will need explicit `[folded]` / `[deferred]` / `[still-open]` tags on review findings.
- [C1] `ProposalOutcome` widening edit not enumerated explicitly — `ProposalRejection` union at `proposal.ts:42-55` needs `| { kind: "ElopementInProgress" }` added; implementer following plan literally edits the wrapper but misses the union.
- [C1] `applySchemeResolutionPhase` gains a side-effect (mounts sprint via state.elopement) without explicit phase-chain test coverage — add a positive-control test pinning the new responsibility.
- [C1] ElopementInProgress gate parity claim needs audit — cross-walk `rg "kind: \"PlayerExiled\"" src/game/store.ts` to confirm 17-to-17 parity; some P6 PlayerExile checks may have been added at P7/P8.
- [C1] Module-load circular concern between `entities.ts` and `constants.ts` — `ElopementSprintStateSchema` in `entities.ts` references `ELOPEMENT_TRACK_LENGTH` / `ELOPEMENT_FRESH_HORSES_MAX_USES` from `constants.ts`; verify no reverse import (constants.ts already imports `Tactic`/`Stance`).
- [C1] Migration parity assertion correctness — confirm `createInitialState` initializes `state.elopement: null` alongside quad-sync surfaces AND no PRNG draws introduced.
- [C1] Document whether the P8 `seedRivalsAndPatronessesIntoLegacyState` seeder (layered outermost in legacy lifters) needs extension for `elopement: null`, OR if the wrap pattern `{...result, elopement: null}` is sufficient (it is; document seeder is unchanged).
- [C1] Pin that `pruneOrphanedConversationKeys` now extends to FIVE branches in CLAUDE.md — helper's role widens from "death cascade" to "modal-state cleanup on death"; P11 sibling-rival deaths inherit the pattern.
- [C1] v9-to-v10 idempotence test should assert migrated V10 marriages tuple includes `viaElopement: false` post-migration, not just byte-identical rng.
- [C1] Migration rng-shape assertion — add explicit `expect(SaveV10Schema.shape.rng).toBe(SaveV9Schema.shape.rng)` so future widenings of `RngStateSchema` don't silently fail the byte-identity check.
- [C1] Marriage-mint logic duplication between `resolveElopementTerminal`'s Won branch and `applyProposalPure` at `proposal.ts:190-218` — extract `mintMarriageRecord(state, aId, bId, viaElopement)` helper OR pin a CLAUDE.md note that the two sites must stay in sync.
- [C1] `resolveElopementTerminal` Won branch should defensively fall through to Lost if `aggressor === undefined || !aggressor.alive` (or target) — matches the orphan-prune defensive pattern and existing `selectAggressor` defense-in-depth throw.
- [C1] `enterBallroom` gate row should be added explicitly to the gated-wrappers list (currently parenthetical at line ~259).
- [C1] `ELOPEMENT_FATHER_START_TILE < ELOPEMENT_PLAYER_START_TILE` defensive guard — extend the module-load assertion to catch father-ahead-of-player regressions.
- [C1] CLAUDE.md pin codifying "tick-phase chain may write to nullable singleton modal-state fields; diff helper picks up the transition for bus events post-set" — useful precedent for P15 succession crisis / P18 dynasty rollover.

