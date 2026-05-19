# P3 — Strategy Map & Locations

> Part of [The Season Master Plan](../MASTER.md). Prior: [P2 — Save/Load & Migrations](./02-save-migrations.md). Next: [P4 — LLM Conversation & Ballroom](./04-ballroom-llm.md).

**Goal.** Make the game playable in a minimal sense — the player can travel between 7 locations, accumulate per-tick deltas at each, and trigger location-bound actions (monarch's audience, bankruptcy escape valve, wardrobe refresh, continental finishing-school trait acquisition, rural-estate trait acquisition). The strategy-map view (an SVG backdrop + 7 absolutely-positioned DOM pins) replaces the P0–P2 dev shell as the player-facing UI. A stub `era: "Earlier"` is introduced on `GameState` to support travel-gating logic that P13 will fully animate.

This phase is the first player-visible vertebra. P0–P2 proved determinism, per-tick draws, and forward-migratable saves; P3 puts a real UI on top and adds the first player-elected actions beyond `advanceTick` / `runYearPass`. The dev shell at `src/ui/dev/` is deleted; a new `src/ui/map/` and `src/ui/shared/` ship in its place, including a player-facing successor to `<CorruptSaveBanner />`. Save format bumps to v4 with the location/era/cooldown fields the new actions consume.

**In scope.**

- **Save format bump to v4 (`src/persist/schema.ts`).** SaveV4 extends SaveV3 with one new `GameState` field and five new `House` fields:
  - **`GameState.era: "Earlier" | "Later"`** — defaults `"Earlier"` (wartime). Transitions are P13; the field exists at P3 only to gate travel to `ForeignCapital`.
  - **`House.currentLocation: LocationId`** — non-nullable. Defaults `"Capital"` on migration; freshly seeded houses also default to `"Capital"` (per `seedStartingFamily`).
  - **`House.consecutiveTicksAtCurrentLocation: number`** — non-negative integer. Defaults `0`. Resets to `0` on travel; increments by 1 per tick spent at the current location during the location-effects phase.
  - **`House.lastAudienceTick: number | null`** — defaults `null` (no audience attempted yet). Set to `state.tick` on every audience attempt (success or denial-by-cooldown), so the cooldown gate uses a single source of truth.
  - **`House.wardrobeLastRefreshTick: number | null`** — defaults `null`. Set to `state.tick` on every wardrobe-refresh action. P10 consumes this to compute the pre-ball composure penalty; at P3 the field is write-only.
  - **`House.blockadeBypassEarned: boolean`** — defaults `false`. P5 Smuggling will flip it; at P3 the gate logic reads it but no path sets it (always false).

  - **Field-placement rationale.** Every field goes on the entity it most naturally belongs to. `era` is a campaign-wide global, so it lives on `GameState`, not on the player house. The four `currentLocation` / `consecutiveTicksAtCurrentLocation` / `lastAudienceTick` / `wardrobeLastRefreshTick` fields are per-house — at P3 only the player house exists, but P8 will introduce rival houses, and putting these fields on `House` is the natural shape regardless of who later mutates them (rivals don't travel or hold audiences in v1, but the data tier doesn't need to know that). `blockadeBypassEarned` is also per-house because Smuggling is per-house — a rival house earning a bypass would be P8's call.
  - **Why no `Character.currentLocation`.** Spec §3 talks about the player being at a location, not individual family members. The head of house's location is the household's location. If P7 introduces children traveling independently (it doesn't — children are family-pool roster members, not navigators), the field can be lifted to `Character` then. At P3 keep it on `House`.

- **`migrate_v3_to_v4` (`src/persist/migrations/v3-to-v4.ts`).** Pure function `(SaveV3) → SaveV4`. Defaults all new fields per the table above. Like `migrate_v2_to_v3`, the draw budget is **ZERO** — every default is a literal constant, never randomized. A future "procedurally place the player on a random starting location" change MUST bump past v4. Idempotence assertion (`assertMigrationIdempotent` from P2's helper) ships with the test file.

  Register in `src/persist/migrations/index.ts` after `migrate_v2_to_v3`. `assertMonotonic` catches misregistration at module load.

  **Migration's default `currentLocation: "Capital"`** is a load-bearing decision: legacy v3 saves have no notion of location, so any default must be a location that's always reachable. `Capital` is the high-society location (never era-gated) and the natural starting point for a new campaign — picking it for migrated saves matches the fresh-state default.

- **`fromSaveV1` / `fromSaveV2` / `fromSaveV3` updated to default the v4 fields on lift.** Mirrors P2's discipline (every lifter defaults missing-in-source fields to the canonical default). The v1→v2→v3→v4 chain test ships at `src/persist/migrations/v1-to-v4-chain.test.ts`, extending P2's v1→v3 chain test.

- **Save-version cutover — full edit list at `src/persist/schema.ts` and `src/persist/dexie.ts` (B3 fix).** SaveV4 is the new live format. Following the P2 cutover pattern verbatim, P3 ships these coordinated edits as a single atomic commit (the typecheck has no green midpoint between the schema add and the dexie/load updates):
  - **`src/persist/schema.ts:21`**: `SAVE_VERSION_CURRENT = 3 as const` → `SAVE_VERSION_CURRENT = 4 as const`. The legacy `toSaveV1` / `toSaveV2` / `toSaveV3` retain their literal `version: 1` / `2` / `3` writes (per the P2 precedent — only the current-version `toSaveVN` references `SAVE_VERSION_CURRENT`).
  - **`src/persist/schema.ts` append** — new `SaveV4Schema`, `toSaveV4`, `fromSaveV4` block following the SaveV3 block. Schema shape:
    ```ts
    export const SaveV4Schema = z.object({
      version: z.literal(4),
      tick: z.number().int().nonnegative(),
      rng: z.array(z.tuple([HouseIdSchema, RngStateSchema])),
      houses: z.array(z.tuple([HouseIdSchema, HouseSchema])),       // HouseSchema now contains the 5 new P3 fields
      characters: z.array(z.tuple([CharacterIdSchema, CharacterSchema])),
      marriages: z.array(z.tuple([MarriageIdSchema, MarriageRecordSchema])),
      campaignName: z.string(),
      era: z.enum(["Earlier", "Later"]),
    });
    export type SaveV4 = z.infer<typeof SaveV4Schema>;
    export function toSaveV4(state: GameState): SaveV4 { /* parse with SaveV4Schema; serialize maps via serializeRegistry; emit version: SAVE_VERSION_CURRENT */ }
    export function fromSaveV4(save: SaveV4): GameState { /* deserialize maps; emit GameState directly (no defaulting needed — every field is present in v4) */ }
    ```
    The `houses` array tuple value is `HouseSchema`, which gains the five new P3 fields automatically via the `entities.ts` schema extension — no per-field enumeration in the save schema.
  - **`src/persist/schema.ts` `fromSaveV1`, `fromSaveV2`, `fromSaveV3` lifters** (symbol-grep `rg "^export function fromSaveV" src/persist/schema.ts`; current locations as of cycle-4 verify: `:50`, `:95`, and `:133` respectively — but use the grep for the authoritative discovery since line numbers drift across implementation revisions). Each lifter gains two defaults: `era: "Earlier"` on the returned `GameState`, and the five new `House` fields defaulted via a helper applied across every entry in `houses` after `deserializeRegistry`. Helper signature: `function defaultHouseV4Fields(h: HousePreV4): House` (see `HousePreV4` declaration below) — sets `currentLocation: "Capital"`, `consecutiveTicksAtCurrentLocation: 0`, `lastAudienceTick: null`, `wardrobeLastRefreshTick: null`, `blockadeBypassEarned: false`. Lives in `src/persist/schema.ts` adjacent to the lifters that use it; not exported (private to the lift path). **Why default on every lift, not only in `migrate_v3_to_v4`:** the lift path is the parse-then-construct boundary; saves that bypass the migration runner (legacy parity tests, future hot-load paths) still need the defaults. Mirrors P2's `campaignName` defaulting precedent.
  - **`HousePreV4` type alias declaration (B3 fix).** Declared local-to-`schema.ts` immediately before `defaultHouseV4Fields`:
    ```ts
    // Lift-only private alias: the House shape as it appears in legacy saves
    // (V1/V2/V3) — i.e., House without the five P3-added fields. NOT exported;
    // consumed only by defaultHouseV4Fields on the deserialize path.
    type HousePreV4 = Omit<
      House,
      | "currentLocation"
      | "consecutiveTicksAtCurrentLocation"
      | "lastAudienceTick"
      | "wardrobeLastRefreshTick"
      | "blockadeBypassEarned"
    >;
    ```
    **Why `Omit<House, ...>` (derived) rather than a hand-rolled separate type:** the existing `HouseSchema` is the single source of truth for the live House shape; deriving the legacy shape via `Omit` means any future field addition to House automatically narrows the legacy alias correctly. A hand-rolled `HouseV3 = { id: ...; wealth: ...; ... }` parallel type would drift on every House field addition. **Why local to `schema.ts`, not a new module:** the alias is consumed only by the three lifters and the helper — all in the same file — so module-level scope is overkill. Document at declaration that the alias is intentionally not exported.
  - **`src/persist/dexie.ts` `SaveRecord.data` type union widening** (currently at `dexie.ts:33`; symbol-grep `rg "SaveRecord" src/persist/dexie.ts` finds it): widen from `SaveV1 | SaveV2 | SaveV3` to `SaveV1 | SaveV2 | SaveV3 | SaveV4`. Per P2's documentation comment, this widening is documentation-only — `record.data.tick` outside `load()` is structurally not safe to rely on. Preserve the inline comment from P2.
  - **`src/persist/dexie.ts` `load()` final-parse callsite** (symbol-grep `rg "Schema.parse" src/persist/dexie.ts`): the `SaveV3Schema.parse(migrated)` line at the bottom of `load()` becomes `SaveV4Schema.parse(migrated)`. The runner's per-step Zod validation already validates each intermediate shape via the registered `outputSchema`; `load()`'s post-migration parse is the final assertion that the result matches the live format.
  - **`src/persist/dexie.ts` `load()` return-type annotation** (`dexie.ts:70`, symbol-grep `rg "export async function load" src/persist/dexie.ts`): change `Promise<SaveV3 | undefined>` to `Promise<SaveV4 | undefined>`. **Without this edit, the new `<LoadButton />` in `src/ui/shared/` that calls `fromSaveV4(saved)` fails typecheck** because `saved` is typed as the unwidened `SaveV3 | undefined`. The return type widening is the contract-level edit that lets the typecheck chain through to the consumer. Per the P2 cutover pattern (which also widened `load()`'s return type from `SaveV2` to `SaveV3`), this is a single-line annotation change at the function signature.
  - **`src/persist/dexie.ts:18`** (`toSaveV3` import) → `toSaveV4` import. **`src/persist/dexie.ts:58`** `const data = toSaveV3(state);` → `const data = toSaveV4(state);`. This is the production write callsite — `save()` reads this value directly into IndexedDB. **B6 fix.** A grep audit `rg 'toSaveV3|fromSaveV3' src/` will surface this and the LoadButton callsite below; both must update in the same atomic commit as the schema add.
  - **NO change at "`dexie.ts:100`".** Earlier plan drafts referenced a `fromSaveV3` callsite inside `dexie.ts`; verified by grep that no such callsite exists. **`fromSaveV3` is consumed at `src/ui/dev/LoadButton.tsx:23`** (existing) — but P3 deletes the entire `src/ui/dev/` directory. The new `fromSaveV4` callsite is in the new player-facing Load affordance.
  - **New `<LoadButton />` callsite in `src/ui/shared/` (the player shell)** — the player-facing Load button (mounted inside `<SettingsMenu />` per the new `src/ui/shared/` layout) imports `fromSaveV4` from `src/persist/schema` and applies `replaceState(fromSaveV4(saved))` on a successful load. **B4 fix.** No `fromSaveV3` import survives the dev-shell deletion; the entire flow uses `fromSaveV4`.
  - **`src/persist/migrations/index.ts`** — register the v3→v4 entry after the existing v2→v3 entry; `assertMonotonic(MIGRATIONS)` at module load (already present from P2) catches misordering. The new entry's shape: `{ from: 3, to: 4, migrate: (s: unknown) => migrate_v3_to_v4(SaveV3Schema.parse(s)), outputSchema: SaveV4Schema }`.
  - **New `<SaveButton />` callsite in `src/ui/shared/` (player shell)** — calls `save(DEV_SLOT, selectGameState(store.getState()))`. The slot identifier renaming (from `DEV_SLOT` to a real-shell name) is deferred — P3 keeps the slot literal `"dev"` for save-file compatibility across the shell swap.
  - **Audit during implementation:** `rg 'SaveV3|toSaveV3|fromSaveV3' src/` (symbol-grep, not line-number based) enumerates every callsite the cutover touches; expect zero hits in production code post-cutover and only legacy-version-test hits remain (v1→v3 chain mid-points, the `migrate_v2_to_v3` test, etc.).
  - **Test-file edit list (B1 fix at cycle 3).** Three test files import legacy V3 symbols and need explicit handling — the production audit above (`rg ... src/`) catches them by symbol-grep, but the body must pin each disposition:
    - **`src/persist/save-roundtrip.test.ts`** (currently imports `fromSaveV3` at `:13`, applies it at `:38` to `loaded` from `load()`). After the `load()` widening, `loaded: SaveV4 | undefined`; the test must update to `fromSaveV4`. **Disposition:** update both the import and the call; no semantic change — the test exercises the round-trip happy path and is version-agnostic in intent.
    - **`src/persist/migrations/v1-to-v3-chain.test.ts`** (imports `SaveV1Schema`, `SaveV3`, `SaveV3Schema`, `fromSaveV3` at `:18`; runs `runMigrations(v1, 1, 3, MIGRATIONS)` at `:35`). **Disposition options considered:**
       - **(a) Keep as v1-to-v3 partial-chain test.** `runMigrations` accepts arbitrary `fromVersion`/`toVersion` so calling `(v1, 1, 3, MIGRATIONS)` is still legal at P3 — the runner walks v1→v2→v3 and stops. The test continues to assert the intermediate v3 shape. Useful as regression coverage for "every adjacent migration step still works in isolation."
       - **(b) Replace with v1-to-v4 full-chain test.** Already pinned as `src/persist/migrations/v1-to-v4-chain.test.ts` elsewhere in this plan.
       - **PINNED: ship BOTH.** Keep `v1-to-v3-chain.test.ts` as the partial-chain regression (no changes; still tests a valid `runMigrations` call), and ADD `v1-to-v4-chain.test.ts` as the full-chain test. Two narrow tests beat one wide one when one of them (the partial) is regression coverage and the other (the full) is the live-format proof.
    - **`src/persist/migrations/v2-to-v3.parity.test.ts`** (imports `fromSaveV3` + `toSaveV2` at `:12`; uses `fromSaveV3` at `:22`). **Disposition:** unchanged. The test asserts v2→v3 parity (hash equality between fresh-state lifted directly and fresh-state-serialized-as-V2-then-migrated-to-V3). v2→v3 parity is independent of v4; the test exercises a migration that still ships at P3. The `fromSaveV3` import is still legal because `fromSaveV3` still exists in `schema.ts` (only its production consumers move to v4 — the symbol is preserved for tests that need it).
  - **`src/persist/dexie.test.ts` semantics shift (B2 fix at cycle 3).** The existing test at `dexie.test.ts:57` "fires when SaveV3 fields are malformed" constructs `{ version: 3, tick: "not-a-number", ... }` and asserts `InvalidSaveSchemaError`. Before P3, `version: 3` is current and routes through `SaveV3Schema.parse(raw)` (the dexie.ts current-version branch), which throws ZodError → re-wrapped as `InvalidSaveSchemaError`. After P3, `version: 3` is no longer current; the record routes through `runMigrations(raw, 3, 4, MIGRATIONS)` whose v3→v4 migration wrapper calls `SaveV3Schema.parse(s)` internally — the ZodError is now caught and re-thrown as `MigrationFailedError` (per the runner's exception-rewrapping behavior). **Required test updates:**
    - **Add new fixture:** `it("fires InvalidSaveSchemaError when SaveV4 fields are malformed", ...)` — constructs `{ version: 4, tick: "not-a-number", ... }` so the current-version path (which now parses as SaveV4Schema) still has `InvalidSaveSchemaError` coverage. Preserves the original test's intent (current-version schema-violation → InvalidSaveSchemaError).
    - **Update existing test:** rename to `it("fires MigrationFailedError when migrating-from-V3 fails on malformed fields", ...)`; assert `MigrationFailedError` (not `InvalidSaveSchemaError`); keep the malformed `version: 3` fixture. This documents that "legacy-version + malformed" is now a migration-failure path, which is the correct semantic post-cutover.
    - **Why two tests instead of one:** P2's discipline (separate error classes per failure mode) only works if we have one test per failure mode. Conflating "current-version malformed" with "legacy malformed (migration fails)" loses that discipline.
  - **`src/main.tsx` edit list (B3 fix at cycle 3).** Three explicit edits, all in `src/main.tsx`:
    - **`src/main.tsx:7`** — change `import { DevApp } from "./ui/dev/DevApp";` to `import { App } from "./App";` (the new player shell). The `import` style mirrors P1's named-export pattern — `App` is exported by name, not default, so an implementer doesn't have to grep for the export convention.
    - **`src/main.tsx:29`** — change `<DevApp store={store} seed={DEFAULT_SEED} />` to `<App store={store} seed={DEFAULT_SEED} />`. Same prop signature: `store` (the `SeasonStore`) and `seed` (the original launch-time seed, threaded for the corrupt-save banner's "Start New Game" recovery path per P2 precedent).
    - **`src/main.tsx:19-22`** (the `__putRawForTests` dev-mode export block) — unchanged. The helper continues to live on `window` in DEV mode; the Playwright spec consumes it from there.
    - **`src/App.tsx` new file** (mentioned upstream in the plan but worth repeating here): exports `App` (named); accepts `{ store: SeasonStore; seed: string }` props matching the old `DevApp` shape so `main.tsx`'s render call is a one-line swap.

- **`src/game/fixtures/locations.ts` extended.** P1 shipped `LOCATIONS` + `TRANSIT_PAIRS`. P3 adds two more exports:
  - **`LOCATION_PIN_COORDS: Record<LocationId, { x: number; y: number }>`** — percentage coordinates (0–100) for the absolute-positioned DOM pins over the SVG backdrop. Source-of-truth lives in fixtures, not UI code (per CLAUDE.md §10 fixture registry rule). Tuning the visual layout edits one file. Provisional values land roughly per the geography hinted in location names (`Capital` upper-right, `Country` lower-right, `FinishingCapitalCultured` mid-left, etc.); P16 polish iterates.
  - **`LocationIdSchema = z.enum(LOCATIONS)`** — Zod-enum form of the `LocationId` literal-tuple type, needed so `HouseSchema.currentLocation` parses through Zod. Mirrors `RoleSchema = z.enum(ROLES)` from `fixtures/roles.ts`.

- **`src/game/constants.ts` extended.** New entries appended to the P1/P2 set:
  - **`LOCATION_DELTAS: Readonly<Record<LocationId, { wealth: number; reputation: number; scandal: number }>>`** — per-tick deltas applied by the location-effects phase. **Provisional v1 tuning, designer-iterable:**
    | Location | wealth | reputation | scandal |
    |---|---|---|---|
    | `Capital` | `0` | `+1` | `0` |
    | `Country` | `+1` | `0` | `0` |
    | `FinishingCapitalCultured` | `-2` | `+1` | `0` |
    | `FinishingCapitalPolitical` | `-2` | `+1` | `0` |
    | `CanalCity` | `0` | `0` | `+1` |
    | `RenaissanceCity` | `0` | `0` | `+1` |
    | `ForeignCapital` | `+2` | `0` | `+1` |
    - **Why these numbers:** they sketch a coherent economy where rural earns wealth, capital builds reputation, continental options are reputational investments (cultured) or risky lucrative plays (foreign capital), and the seduction cities passively raise scandal. They're inventions, not derived from spec text. Document inline that these are designer placeholders; expect P3-end playtest iteration.
  - **`RUSTIC_TRAIT_TICKS_AT_RURAL_ESTATE = 5`** — consecutive ticks at `Country` required to grant the `"Rustic"` trait to the player's head of house. Pin 5 (not stated by spec — "after a fixed threshold of consecutive ticks"). 5 is short enough to feel achievable in a single playthrough but long enough to be a real commitment versus a one-off visit.
  - **`FINISHING_SCHOOL_TRAIT_PROBABILITY = 0.2`** — spec §3 verbatim: "20% per tick chance".
  - **`FINISHING_SCHOOL_WEALTH_DRAIN_PER_TICK = -3`** — spec says "moderate per-tick wealth drain". `-3` is "moderate" relative to the location's `-2` baseline economy delta — together producing `-5 wealth/tick` while at a finishing school, which is meaningful pressure without being ruinous. **Applied as a SEPARATE delta from `LOCATION_DELTAS`** (the latter is universal location effects; this is trait-acquisition-only and would not apply if the trait was already acquired). On the tick that grants the trait, the drain still applies (the cost is the cost of being there). After the trait is acquired, future ticks at the same finishing school stop applying the drain (and stop rolling for the trait — re-acquiring an already-acquired trait is a no-op).
  - **`FINISHING_SCHOOL_TRAIT_MAP: ReadonlyMap<LocationId, TraitId>`** — canonical name and shape. Constructed at module load: `new Map<LocationId, TraitId>([["FinishingCapitalCultured", "Sophisticated" as TraitId], ["FinishingCapitalPolitical", "Polyglot" as TraitId]])`. Only the two finishing-school locations have entries; consumers use `FINISHING_SCHOOL_TRAIT_MAP.get(currentLocation)` and branch on `undefined`. **Why `ReadonlyMap` not `Readonly<Record<...>>`:** most locations have no entry, and `Map.get` returning `undefined` (vs. a `Record` lookup on an absent key returning `undefined` but via index access that fights `noUncheckedIndexedAccess`) is the cleanest signal. **`ReadonlyMap` (not `Map`) at the type position** so callers can't accidentally mutate the registry. **Resolves "which trait per school":** spec says "sophisticated / polyglot at continental finishing-schools" without binding which to which; `Cultured → Sophisticated` and `Political → Polyglot` are designer picks that align name-thematically. Step 4 of `applyLocationEffectsPhase` (below) references this exact identifier.
  - **`MONARCH_AUDIENCE_COOLDOWN_TICKS = 30`** (spec §3 verbatim).
  - **`MONARCH_AUDIENCE_REPUTATION_THRESHOLD = 30`** (spec).
  - **`MONARCH_AUDIENCE_FULL_SUCCESS_THRESHOLD = 50`** (spec).
  - **`MONARCH_AUDIENCE_WEALTH_COST = 50`** (spec: `-50 wealth`).
  - **`MONARCH_AUDIENCE_REPUTATION_COST = 10`** (spec: `-10 reputation`).
  - **`MONARCH_AUDIENCE_PARTIAL_SCANDAL_DELTA = 10`** (spec: partial-success applies `+10` scandal).
  - **`MONARCH_AUDIENCE_PATRONESS_BONUS = 5`** (spec; P3 stub — patronesses don't exist yet).
  - **`MONARCH_AUDIENCE_RIVAL_HOSTILITY_DROP = 5`** (spec; P3 stub — rivals don't exist yet).
  - **`BANKRUPTCY_ESCAPE_WEALTH_GAIN = 50`** (spec verbatim).
  - **`BANKRUPTCY_ESCAPE_SCANDAL_COST = 5`** (spec verbatim).
  - **`SEDUCTION_CITY_SCANDAL_PROBABILITY_MULTIPLIER = 2.0`** — spec says "higher probability that scandal-bearing whispers arrive". Pin `2.0` as the multiplier on top of the standard inbound-courier scandal-roll. **Unused at P3** (couriers ship in P6); pinned here so the constant has a canonical home and P6 picks it up. The mechanism applies at the courier-flow layer, not the location-effects phase — at P3 it's a documentation-only constant.
  - **`WARDROBE_REFRESH_WEALTH_COST = 20`** — spec says "fixed wealth cost"; `20` is in the range of other action costs (audience is 50, scheme costs in P5 will range 5–50).

  All new constants are designer-tuned values per CLAUDE.md §10 ("designer constants in one canonical location each"). Inline comments note which spec section motivates each value; the comments cite spec section names (`§3 "Monarch's-Audience Resolution"`) per CLAUDE.md.

- **`PLAYER_HOUSE_ID` relocation from `src/game/rng.seeds.ts` to `src/game/rng.ts` (B1 fix).** The constant moves from the test/replay-seeds file (which falls under the `game-other` ESLint element and is disallowed for `game-rules` imports per `eslint.config.js:84`) into `rng.ts` proper (the `game-rng` file-mode element, which `game-rules` is permitted to import from). The test/replay-only constants `DEFAULT_SEED`, `REPLAY_SEEDS`, `NEGATIVE_CONTROL_SEED` remain in `rng.seeds.ts` — they are consumed only by tests, where boundary rules are ignored. Edits this entails:
  - Move `export const PLAYER_HOUSE_ID = "player" as HouseId;` from `src/game/rng.seeds.ts:6` into `src/game/rng.ts` (alongside the existing `HouseId` brand declaration so the constant is colocated with its type).
  - Update all production-code import sites: `src/game/store.ts:21` (currently `import { PLAYER_HOUSE_ID } from "./rng.seeds";` → `import { PLAYER_HOUSE_ID } from "./rng";`), `src/game/bootstrap.ts` (same shape), and any other production file that imports it. Grep-audit during implementation: `rg "PLAYER_HOUSE_ID" --type=ts -l src/` enumerates the full call site list.
  - Update all test import sites that pull `PLAYER_HOUSE_ID` alongside other `rng.seeds.ts` symbols. Either split the imports (one `from "./rng"`, one `from "./rng.seeds"`) or — since tests aren't boundary-gated — keep test imports as-is via a re-export of `PLAYER_HOUSE_ID` from `rng.seeds.ts`. **Pin re-export approach:** in `rng.seeds.ts`, replace the `export const PLAYER_HOUSE_ID = ...` line with `export { PLAYER_HOUSE_ID } from "./rng";` so existing test imports continue to work without churn. **Rationale for re-export:** minimizes downstream test churn; the boundary rule cares about the source module of an import, not what re-exports it (boundaries plugin resolves through re-exports to the original module per `eslint-import-resolver-typescript`). However, production rules MUST import from `./rng` directly — re-exports through `rng.seeds.ts` do NOT launder the boundary because the boundaries plugin tracks the original-module element. So tests can re-import via `rng.seeds.ts` but production rule files must import directly from `rng.ts`. Document this asymmetry inline at the re-export line.

- **`src/game/rules/locationEffects.ts`** — NEW pure-rule file. Two exports:
  - **`applyLocationEffectsPhase(state: GameState): GameState`** — the new orchestrator phase. Iterates **only `state.houses.get(PLAYER_HOUSE_ID)`** (literal player-house identity check; not a flag-based gate). For that single house:
    1. Apply `LOCATION_DELTAS[house.currentLocation]` to wealth/rep/scandal (clamping rep+scandal to `[0, 100]` at the mutation site per CLAUDE.md non-negotiable §6; wealth uncapped).
    2. Increment `consecutiveTicksAtCurrentLocation` by 1.
    3. If `currentLocation === "Country"` AND head of house lacks the `"Rustic"` trait AND `consecutiveTicksAtCurrentLocation >= RUSTIC_TRAIT_TICKS_AT_RURAL_ESTATE`: grant `"Rustic"` to the head's `traits` array. **No PRNG draw** — the threshold is deterministic. **Idempotence:** the trait-check happens before the increment in this phase's same-tick logic, but the increment in step 2 happens first; that's fine because `>=` on the post-increment value catches the first tick at threshold. If the head already has `"Rustic"`, skip the grant (no-op).
    4. If `currentLocation` is in `FINISHING_SCHOOL_TRAIT_MAP` AND head lacks the corresponding trait: apply `FINISHING_SCHOOL_WEALTH_DRAIN_PER_TICK` to wealth; roll `drawNext(rngState)` and if `next < FINISHING_SCHOOL_TRAIT_PROBABILITY` grant the trait. **Single draw per finishing-school tick**, advanced on the player house's RNG. If the head already has the trait, the drain stops and no draw fires (the school is done with them).
    - **Why iterate only the player house at P3 (not all houses):** P8 will introduce rival houses with `currentLocation` set to their canonical home location for save-format simplicity, but rivals don't accrue location deltas, don't acquire traits passively, and don't track consecutive ticks. Iterating only the player house at P3 keeps the phase scoped to its real responsibilities; P8 doesn't need to refactor to add "isPlayerHouse" flags. **Naming-canonical:** the phase function is `applyLocationEffectsPhase`, not `applyPlayerLocationPhase` — its scope (player only at P3) is internal; the contract is "apply per-tick location effects to whichever houses earn them."
    - **`PLAYER_HOUSE_ID` import path:** imported from `src/game/rng.ts` (P3 relocates it there from `rng.seeds.ts`; see the dedicated relocation bullet above for full rationale). All five new P3 rule files (`locationEffects`, `travel`, `monarchsAudience`, `bankruptcyEscape`, `wardrobeRefresh`) import the constant from the same path.
    - **Phase ordering decision pinned:** location-effects runs AFTER economy and BEFORE courier-draining. Why after economy: bankruptcy-tier classification uses pre-location-effects wealth, so a Country-location wealth gain that flips Hemorrhaging back to Solvent doesn't suppress the same-tick economy penalty. Why before courier-draining: at P6, courier scandal will be a state of the system that should reflect this tick's location effects (e.g., scandal-bearing whispers arriving on the same tick the player is in a seduction city — but courier handling is its own ordering concern P6 owns). The PHASES array becomes:
      1. advance tick
      2. economy
      3. **location effects (NEW at P3)**
      4. courier draining (stub)
      5. scheme resolution (stub)
      6. global-event roll (stub)
      7. mood drift
      8. rival action (stub, always last)
    - **RNG identity:** finishing-school trait-roll draws come from `state.rng.get(PLAYER_HOUSE_ID)` (the only house at P3 anyway). Adheres to the P1 binding contract.
    - **Draw budget per `applyLocationEffectsPhase` call:** 0 (no finishing-school OR trait already acquired) or 1 (finishing-school location, trait not yet acquired). Document in a top-of-file comment so future phase reviewers know the count.
  - **`getLocationDelta(loc: LocationId): { wealth: number; reputation: number; scandal: number }`** — exported helper used by the location-details UI panel to display the per-tick deltas at a given location.

- **`src/game/rules/travel.ts`** — NEW pure-rule file. Exports:
  - **`canTravel(state: GameState, houseId: HouseId, to: LocationId): { ok: true } | { ok: false; reason: TravelRejection }`** — pure validator. `TravelRejection` discriminated union: `{ kind: "SameLocation" } | { kind: "EraBlockaded"; era: "Earlier"; target: LocationId }`. **No "wealth cost" rejection** — travel itself has no wealth cost in v1; the cost is the consumed tick. **No "in-flight scheme" rejection** — schemes are P5; even when P5 ships, traveling away from a scheme target doesn't cancel the scheme (verified per spec §3 "Schemes are wealth-costed multi-tick operations that resolve into deterministic state effects" — no location-tether).
  - **`applyTravel(state: GameState, houseId: HouseId, to: LocationId): GameState`** — pure mutation. **Assumes preconditions already validated by `canTravel` and `ok: true`.** The action-gating discipline (CLAUDE.md non-negotiable §5: validate first, deduct second, apply third) is enforced one layer up at the orchestrator/event handler; this function panics with `InvalidTravelError` if called against an unvalidated state (defense-in-depth, not for production gating).
    - Sets `currentLocation = to`.
    - **Resets `consecutiveTicksAtCurrentLocation = 0`** — the destination is a new location, so the counter starts over. (At the destination's next tick-orchestrator pass, the location-effects phase increments to 1.)
    - Does NOT advance the tick; tick consumption is the orchestrator's job.
  - **Travel-action atomic sequence (player flow):**
    1. Validate via `canTravel`; if `!ok`, surface rejection in the UI (no state mutation).
    2. Apply `applyTravel(state, PLAYER_HOUSE_ID, to)` to mutate `currentLocation` + reset counter.
    3. Run `advanceTickPure(state)` — the orchestrator's full phase chain fires from the destination. Location-effects phase applies the DESTINATION's deltas.
    - **First-tick-at-destination semantics pinned.** The tick consumed by travel earns the destination's deltas, not the origin's. **Why:** matches the spec's "consumes one tick" reading where the tick IS the travel duration; matches the player's intuition (clicking "travel to Capital" then immediately seeing the Capital pip increment); avoids a dead-tick scenario where neither location earns deltas. The alternative ("origin earns deltas, then teleport" or "neither earns") was rejected: origin-earns introduces the trap that traveling away from Country at consecutive-tick threshold = 4 nets the player no Rustic trait despite "spending" the 5th tick, and neither-earns drains pace without compensating progress. Document inline at `applyTravel`'s call site (the store-action wrapper) so the next reader doesn't reorder.
  - **Era gate at P3:** `canTravel` rejects `to === "ForeignCapital"` when `state.era === "Earlier"` AND `house.blockadeBypassEarned === false`. At P3 `blockadeBypassEarned` is always `false` (P5 sets it). At P3 era is always `"Earlier"` (P13 transitions it). So at P3 the ForeignCapital pin is always disabled, but the gate function correctly handles all four corners for forward-compatibility. **No same-location travel:** `canTravel` rejects `to === house.currentLocation` — silent no-op clicks on the current location are a footgun; the UI also disables the current location's pin visually, but the rule-layer gate is the source of truth.

- **`src/game/rules/monarchsAudience.ts`** — NEW pure-rule file. Exports:
  - **`canRequestAudience(state: GameState, houseId: HouseId): { ok: true } | { ok: false; reason: AudienceRejection }`** — `AudienceRejection`: `{ kind: "WrongLocation"; current: LocationId } | { kind: "InsufficientReputation"; reputation: number; required: number } | { kind: "CooldownActive"; lastAttemptTick: number; ticksUntilAvailable: number }`. **Reputation threshold check uses PRE-COST reputation** per spec §3 ("Outcome is keyed off pre-cost reputation").
  - **`applyAudience(state: GameState, houseId: HouseId): { state: GameState; outcome: AudienceOutcome }`** — pure resolver. `AudienceOutcome`: `{ kind: "Denied"; reason: AudienceRejection } | { kind: "Partial"; rep: number } | { kind: "FullSuccess"; rep: number }`. Atomic sequence inside the function:
    1. Re-validate via `canRequestAudience` (defense-in-depth). If denied, return `{ state, outcome: { kind: "Denied", reason } }` with state unchanged. **`lastAudienceTick` is NOT set on the denial path** — only successful (partial or full) attempts set the cooldown. Spec §3: "the cost is paid only on partial or full success"; the cooldown is part of the cost-bearing path. **Why this matters:** if cooldown updated on denial, a player at rep=29 could spam the audience action and lock themselves out for 30 ticks each click; the design intent is that denial is cost-free.
    2. Read `preCostReputation = house.reputation`. Classify outcome by `preCostReputation` band:
       - `>= 50` → `FullSuccess`
       - `30 <= preCostReputation < 50` → `Partial`
       - `< 30` would have been caught at step 1's revalidation; this branch is unreachable post-validation.
    3. Deduct cost: `wealth -= MONARCH_AUDIENCE_WEALTH_COST` (uncapped); `reputation -= MONARCH_AUDIENCE_REPUTATION_COST` (clamp to `[0,100]`).
    4. Apply outcome-specific effects:
       - `FullSuccess`: `scandal = 0` (wipe to zero per spec); `+5` to each patroness (P8 stub — empty loop at P3); `-5` rival hostility per rival (P8 stub — empty loop at P3).
       - `Partial`: `scandal += MONARCH_AUDIENCE_PARTIAL_SCANDAL_DELTA` (clamp).
    5. Set `house.lastAudienceTick = state.tick`.
    - **`lastAudienceTick` is set BEFORE `advanceTickPure` runs**, so the cooldown gate evaluates against the tick at which the audience fired (not the tick after the orchestrator advances). The audience action's orchestrator wrapper applies `applyAudience` first, then `advanceTickPure`, in that order — same pre-tick action shape as travel.
    - **Action atomic sequence reminder (CLAUDE.md non-negotiable §5):** Validation in step 1 runs BEFORE any mutation in step 3+. If validation passes, all of steps 2–5 execute atomically (single returned `GameState`). No partial-deduction failure mode exists.
    - **Same-tick monarch's audience and rival action (§7 edge case).** P3 owns the audience-fires-before-rival ordering. The mechanism: the audience action runs PRE-TICK (mutate state → advance via orchestrator), and the rival-action phase is phase 8 (always last) in the orchestrator. So the audience's `-5` rival-hostility (P8 stub at P3) lands BEFORE the rival's chance to retaliate this tick. At P3 the stub is an empty loop, but the ordering contract is wired correctly so P8 inherits it.
    - **Test strategy for the §7 edge case at P3 (B5 fix).** At P3 the `House` schema has no `hostility` field (P8 introduces rivals + hostility). The test in `monarchsAudience.test.ts` therefore CANNOT construct a synthetic "rival house" with hostility — there's no schema slot for it. **Two options considered, one pinned:**
       - **(a) Defer the §7 phase-ordering test entirely to P8.** Rejected: P3 owns the audience action, so P3 should own evidence that its design wires correctly with the orchestrator's rival phase position. Deferring loses test-coverage co-location.
       - **(b) PINNED — Order-of-operations assertion via call-tracking, not state assertion.** The P3 test asserts that the audience action's hostility-drop callback site fires BEFORE the orchestrator's rival phase, using a **spy/call-order test pattern**. Concretely: the test injects a tracking array; the audience's stub-hostility-drop pushes `"audience-drop"` into the array; the rival-action phase (in this test) is replaced with a phase that pushes `"rival-action"`. Assert `["audience-drop", "rival-action"]` order in the post-action array. **No House schema dependency.** The test exercises ordering contracts that don't depend on rivals' state shape. When P8 ships the real rival phase + hostility fields, the test extends naturally to assert effects (not just call order).
    - **Implementation locations and override mechanism (B6 + B7 fix).** Two coupled placements pin the test strategy without violating boundaries:
       - **Tracker module: `src/runtime/__test-utils__/phaseOrderTracker.ts`** (NOT `src/game/rules/__test-utils__/`). Rationale: the tracker imports `TickPhase` from `runtime-tick-orchestrator`. The `game-rules` allow list explicitly disallows `runtime-tick-orchestrator` per `eslint.config.js:70-83`; putting the tracker under `src/game/rules/` would either require widening the allow list (which breaks the determinism boundary) or fail `pnpm lint:boundaries`. Putting it under `src/runtime/__test-utils__/` resolves to the `runtime` folder element, which permits importing from `runtime-tick-orchestrator` (no `disallow` entry blocks `runtime → runtime-tick-orchestrator`; default-allow). The `__test-utils__` subdirectory pattern mirrors the existing `src/persist/migrations/__test-utils__/idempotence.ts` precedent — `src/game/rules/__test-utils__/` does NOT exist in the current codebase; the actual existing test-utils directories are `src/game/__test-utils__/factories.ts` and `src/persist/migrations/__test-utils__/idempotence.ts`.
       - **Phase-injection export: `runOrchestratorWithPhases(state: GameState, phases: readonly TickPhase[]): GameState`** — a NEW test-only export added to `src/runtime/tickOrchestrator.ts`. The production `advanceTickPure` still consumes the module-private `PHASES` constant directly (`PHASES.reduce(...)` form is preserved). The new export takes phases as an argument so the orchestrator's frozen `PHASES` array is untouched at runtime. Body signature:
         ```ts
         // Test-only: runs the same reduce-over-phases composition as
         // advanceTickPure, but with a caller-supplied phases array.
         // Production callers must use advanceTickPure (which reads the
         // module-private PHASES constant); this export is for ordering
         // tests that need to override or instrument the phase list.
         export function runOrchestratorWithPhases(
           state: GameState,
           phases: readonly TickPhase[],
         ): GameState {
           return phases.reduce<GameState>((acc, phase) => phase(acc), state);
         }
         ```
         **Why not export `PHASES` directly:** the CLAUDE.md "frozen `PHASES: readonly TickPhase[]`" non-negotiable says the array is the determinism contract; exporting it would let a future consumer mutate the iteration order at runtime. Exporting a function that consumes a caller-supplied array preserves the contract.
       - **Why not hand-roll the reduce inside the test:** the alternative ("hand-roll `phases.reduce(...)` inline in `monarchsAudience.test.ts`") would duplicate the orchestrator's composition logic; if `advanceTickPure` ever changes (e.g., to inject pre/post hooks), the duplicated test composition silently drifts. Centralizing the reduce in `runOrchestratorWithPhases` keeps one source of truth.
       - **No new ESLint boundary edges introduced.** The tracker is in `runtime`; the test that imports it is in `src/game/rules/monarchsAudience.test.ts` which is `.test.ts` and exempt from boundaries per `eslint.config.js:34` (`boundaries/ignore: ["**/*.test.ts", "**/*.test.tsx"]`). The `runOrchestratorWithPhases` export adds no new edge — `runtime-tick-orchestrator`'s consumers are unchanged. The B5 design now passes `pnpm lint:boundaries` cleanly.
  - **Outcome bands pinned (no off-by-one risk):** `>= 50` is full; `>= 30 && < 50` is partial; `< 30` denied at validation. The `<` boundary on partial is exclusive (50 is full, not partial). Spec §3 phrasing ("full success at ≥ 50; partial success at 30–49") supports this. Vitest fixtures hit `rep = 30` (partial: lowest), `rep = 49` (partial: highest), `rep = 50` (full: lowest), `rep = 100` (full: capped).

- **`src/game/rules/bankruptcyEscape.ts`** — NEW pure-rule file. Exports:
  - **`canEscapeBankruptcy(state: GameState, houseId: HouseId): { ok: true } | { ok: false; reason: EscapeRejection }`** — `EscapeRejection`: `{ kind: "WrongLocation"; current: LocationId } | { kind: "NotInsolvent"; wealth: number }`. Spec §3: "An escape-valve action is available only at the rural-estate location while wealth is negative." So validation requires `currentLocation === "Country"` AND `wealth < 0`.
  - **`applyBankruptcyEscape(state: GameState, houseId: HouseId): GameState`** — applies `+50 wealth, +5 scandal` (clamped). Returns the new state. No RNG draws.
  - **Action atomic sequence:** validate → mutate (deduct nothing — this is a gain action — but apply the +50/+5 deltas atomically) → advance tick. Like the audience, the escape action consumes a tick via the orchestrator.

- **`src/game/rules/wardrobeRefresh.ts`** — NEW pure-rule file. Exports:
  - **`canRefreshWardrobe(state: GameState, houseId: HouseId): { ok: true } | { ok: false; reason: WardrobeRejection }`** — `WardrobeRejection`: `{ kind: "WrongLocation"; current: LocationId }`. **Does NOT reject on insufficient wealth.** Spec §7 edge case ("Wardrobe refresh during bankruptcy"): "if the refresh wealth cost would drop the house from Solvent to a worse tier, the player must be warned but allowed to proceed (player agency takes precedence)." The warning is a UI concern; the rule layer always permits the action at Capital regardless of wealth. **Wealth check is informational, not gating.** Test fixture asserts the action succeeds even at `wealth = 0`.
  - **`applyWardrobeRefresh(state: GameState, houseId: HouseId): GameState`** — deducts `WARDROBE_REFRESH_WEALTH_COST = 20` from wealth (uncapped — wealth can go negative); sets `wardrobeLastRefreshTick = state.tick`. No RNG. **P3 ships the field-write; P10 reads it to compute the pre-ball composure penalty.** At P3 the wardrobe-refresh button is functional but has no in-game consequence beyond the wealth deduction.
  - **Action atomic sequence:** validate → mutate (deduct wealth, set tick) → advance tick.

- **`src/game/__test-utils__/playerLocationFixtures.ts`** — NEW shared test fixtures (the `src/game/__test-utils__/` directory already exists from P1; new file lives alongside `factories.ts`). Builders for synthetic-state shapes used across the P3 rule tests:
  - `playerHouseAt(location: LocationId, overrides?: Partial<House>): House`
  - `synthStateAt(location: LocationId, overrides?: Partial<GameState>): GameState`
  - **Why shared fixtures:** five new rule files all need to construct a single-house GameState at a specific location with specific wealth/rep/scandal/cooldown values. A single builder keeps fixture drift to one file. Pattern mirrors P1's `succession.test.ts` synthetic-state harness and the existing `src/game/__test-utils__/factories.ts`.

- **`src/runtime/tickOrchestrator.ts` extended.** Add `applyLocationEffectsPhase` to the PHASES array between `applyEconomyPhase` and the courier-draining stub:
  ```ts
  const PHASES: readonly TickPhase[] = [
    advanceTickPhase,         // 1. time advance
    applyEconomyPhase,        // 2. economy
    applyLocationEffectsPhase, // 3. location effects (NEW at P3)
    identityPhase,            // 4. courier draining (P1 stub)
    identityPhase,            // 5. scheme resolution (P1 stub)
    identityPhase,            // 6. global-event roll (P1 stub)
    applyMoodDriftPhase,      // 7. mood drift
    identityPhase,            // 8. rival-house action roll (P1 stub — ALWAYS last)
  ] as const;
  ```
  **Boundary impact:** the import from `../game/rules/locationEffects` is allowed by the existing `runtime-tick-orchestrator` element's `default: "allow"` posture. No `eslint.config.js` edit. Same shape as the existing `applyEconomyPhase` / `applyMoodDriftPhase` imports.

- **`src/runtime/events/`** — extended (one new file). The events directory exists from P1 (currently empty per `ls` output); P3 ships its first concrete event file:
  - **`src/runtime/events/location.ts`** — NEW. Defines the typed-event discriminated union for player-elected location actions. Variants: `TraveledTo`, `RequestedAudience`, `EscapedBankruptcy`, `RefreshedWardrobe`. Each event carries `{ tick: number; houseId: HouseId; ... }` plus action-specific payload (e.g., `RequestedAudience` carries `outcome: AudienceOutcome`). Subscribers register via React effects per CLAUDE.md non-negotiable §9; the publisher is a small typed event-bus. **At P3 the event-bus is single-file** (`src/runtime/events/bus.ts`, also new) — a typed publish/subscribe over a `Map<EventVariant["kind"], Set<Subscriber>>`. The bus itself doesn't fire across orchestrator boundaries; it's used inside the React tree by the map view to react to action completions (e.g., showing a transient "Audience denied" toast). **No god-file** — the bus is generic, the event types are partitioned per domain (P3 ships `location.ts`; P4 will add `conversation.ts`; P5 `scheme.ts`; etc.). Bus + first event file together are ~80 LOC. **The bus is event-bus light: it is NOT the orchestrator's substrate.** Orchestrator phase composition stays the pure `reduce`-over-`PHASES` form from P1; events fire from store actions (the wrappers around `apply*` calls) only. Document this clearly in `bus.ts`'s top-of-file comment.

- **`src/game/store.ts` extended with new player actions.** Adds four `StoreActions`:
  ```ts
  type StoreActions = {
    advanceTick: () => void;
    runYearPass: () => void;
    replaceState: (next: GameState) => void;
    // P3 additions:
    travel: (to: LocationId) => { ok: boolean; reason?: TravelRejection };
    requestAudience: () => { outcome: AudienceOutcome };
    escapeBankruptcy: () => { ok: boolean; reason?: EscapeRejection };
    refreshWardrobe: () => { ok: boolean; reason?: WardrobeRejection };
  };
  ```
  Each new action wires the validate → mutate → publish-event → advance-tick sequence:
  ```ts
  travel: (to: LocationId) => {
    const state = get();
    const check = canTravel(state, PLAYER_HOUSE_ID, to);
    if (!check.ok) return { ok: false, reason: check.reason };
    // Capture `from` BEFORE the mutate step so the bus.publish below uses the
    // pre-mutation origin location, not whatever happens to be in the draft
    // afterwards. Use getHouseOrThrow (util/lookups) — defense against the
    // PLAYER_HOUSE_ID-not-found programmer-error footgun, which the `!`
    // bang-cast hides.
    const from = getHouseOrThrow(state, PLAYER_HOUSE_ID).currentLocation;
    const afterTravel = applyTravel(state, PLAYER_HOUSE_ID, to);
    const afterTick = advanceTickPure(afterTravel);
    set((state) => {
      // replaceState-style overwrite, per P2 pattern. Parameter name `state`
      // matches the existing store-actions style (advanceTick, runYearPass,
      // replaceState all use `set((state) => ...)`). Do NOT rename to `draft`.
      state.tick = afterTick.tick;
      state.rng = afterTick.rng;
      state.houses = afterTick.houses;
      state.characters = afterTick.characters;
      state.marriages = afterTick.marriages;
      state.campaignName = afterTick.campaignName;
      state.era = afterTick.era;
    });
    bus.publish({ kind: "TraveledTo", tick: afterTick.tick, houseId: PLAYER_HOUSE_ID, from, to });
    return { ok: true };
  },
  ```
  Same pattern for `requestAudience`, `escapeBankruptcy`, `refreshWardrobe`. **Why return-by-value (not throw on rejection):** the UI needs to render rejection reasons; throwing would force every callsite into a try/catch and lose the typed `reason` payload. Return discriminated unions, render in UI.
  - **The `set` body must cover every `GameState` key** including `era` (added at P3) — the audit pattern from P2's `replaceState` is "if you add a `GameState` key, every `set`-style state copy must include it." A Vitest sanity test in `store.replace-state.test.ts` (extended from P2 if it exists, otherwise new) asserts via `Object.keys(GameStateSchema.shape)` matching the set body's keys.
  - **No new `replaceState`** — the existing `replaceState` action remains for full-state swaps (corrupt-save recovery, load). The four new actions are partial-flow wrappers that internally use the same all-keys overwrite.
  - **Existing set-bodies explicit edits (B2 fix).** P3 extends `GameState` with `era`, so every `set`-style state copy in `store.ts` must learn the new key. **Three explicit one-line edits** required in the same atomic commit as the schema add:
    - **`store.ts:103`** (`advanceTick`'s `set` body): add `state.era = next.era;` after `state.campaignName = next.campaignName;`.
    - **`store.ts:113`** (`runYearPass`'s `set` body): add `state.era = next.era;` after the matching `campaignName` line.
    - **`store.ts:122`** (`replaceState`'s `set` body): add `state.era = next.era;` after the matching `campaignName` line.
    The `store.replace-state.test.ts` audit catches the omission at test boot, but the audit is a **safety net**, not the implementation guide. Per the cross-plan pattern "Existing set-bodies forgotten when schema extends," the body edit list pins each line; the trip-wire test exists for the next phase's field additions.

- **`selectGameState` extension at `src/game/store.ts:130` (B5 fix).** `selectGameState(state: StoreState): GameState` is the canonical store-to-GameState projection consumed by `save()` (via `dexie.ts:58`'s `toSaveV4(selectGameState(store.getState()))`) and by the determinism harness. Currently returns 6 keys (`tick`, `rng`, `houses`, `characters`, `marriages`, `campaignName`); P3 adds `era: state.era` for the 7th key. **Without this addition, `save()` emits a record missing `era`, and `toSaveV4(state)`'s `SaveV4Schema.parse(...)` fails at write time with a Zod error.** The `hashable-state-extension.test.ts` invariant only enforces schema↔projection-keys equality — it does NOT catch a `selectGameState` drop. The schema↔hash↔selector triple is a three-surface extension contract; P3 makes all three sync.

- **`schema-projection-selector-extension.test.ts` (the trip-wire extension, B5 fix continued).** New test file at `src/game/schema-projection-selector-extension.test.ts` (sibling to `hashable-state-extension.test.ts`). Asserts a three-way invariant:
  ```ts
  it("schema keys == projection keys == selectGameState keys", () => {
    const schemaKeys = new Set(Object.keys(GameStateSchema.shape));
    const projectionKeys = new Set(Object.keys(hashableState(SAMPLE_STATE)));
    // Construct a StoreState with sentinel values via the existing store
    // bootstrap so we don't hand-roll a StoreState fixture (which would
    // itself drift). selectGameState reads only GameState fields, so the
    // store wrapper around SAMPLE_STATE works.
    const selectorKeys = new Set(Object.keys(selectGameState(SAMPLE_STORE_STATE)));
    expect(schemaKeys).toEqual(projectionKeys);
    expect(schemaKeys).toEqual(selectorKeys);
  });
  ```
  **Why a new file, not extension of `hashable-state-extension.test.ts`:** the latter's name already pins what it asserts; bolting on the third surface confuses future readers. Two files, two narrow invariants, both run on every `pnpm test`. **Why the trip-wire isn't optional:** P4 (LLM/ballroom) will add more `GameState` fields and hit the same forgotten-third-surface bug; pinning this discipline at P3 — the first phase that adds a third schema surface to track — gets it right from the start.

- **`src/ui/dev/` DELETED.** Per session notes from P2's close-out: the dev shell ships its last release at P2; P3 deletes it. Files deleted:
  - `src/ui/dev/DevApp.tsx`
  - `src/ui/dev/CorruptSaveBanner.tsx`
  - `src/ui/dev/HeadAgeReadout.tsx`
  - `src/ui/dev/LoadButton.tsx`
  - `src/ui/dev/SaveButton.tsx`
  - `src/ui/dev/SeedPrompt.tsx`
  - `src/ui/dev/TickButton.tsx`
  - `src/ui/dev/TickReadout.tsx`
  - `src/ui/dev/YearPassButton.tsx`
  - **Updated `src/main.tsx`** mounts the new `<App />` shell instead of `<DevApp />`. The `__putRawForTests` dev-mode export (from P2) is preserved (moved into `main.tsx`'s mounting block or into a tiny `src/dev-hooks.ts` module — pin: keep in `main.tsx` since it's already there).

- **`src/App.tsx` becomes the player shell** (`src/App.tsx` was untouched through P0–P2; was an empty stub or didn't exist). New content:
  - Mount `<CorruptSaveBanner />` (moved to `src/ui/shared/`) above the map.
  - Mount `<MapView />` (new, `src/ui/map/`) as the main surface.
  - Mount `<TopBar />` (new, `src/ui/shared/`) with the campaign name, current tick, head age, current location label, and a settings-menu button. The settings menu houses Save / Load / New Seed / Pass Year affordances (the actions that were free-floating in `<DevApp />`).
  - **No `<TickButton />` in the player UI.** Tick advancement is implicit in every player action (travel, audience, escape, refresh, year-pass). The "stay another tick" affordance lives as a button on the location-details panel labeled "Stay here a year" — internally calls `store.advanceTick()`. **Why:** the dev shell's bare `<TickButton />` doesn't fit the player narrative; binding tick advance to an in-fiction action ("stay at Country") matches the spec's framing.

- **`src/ui/shared/`** — NEW directory. Contains:
  - **`CorruptSaveBanner.tsx`** — moved/rewritten from `src/ui/dev/`. Same role/aria contract; same `<Alert>`-equivalent plain-Tailwind styling. The "Start New Game" handler re-routes to a campaign-start flow (at P3 just calls `replaceState(createInitialState(seed))` with the prop-threaded seed, identical to P2). Future phases polish; P3 ships at parity with P2.
  - **`TopBar.tsx`** — campaign-meta header. Reads from store: `tick`, `campaignName`, head age (via the same `s.houses → s.characters` two-step lookup pattern P2's `<HeadAgeReadout />` uses), `currentLocation` (label-mapped via `LOCATION_LABELS` map exported from `fixtures/locations.ts`).
  - **`SettingsMenu.tsx`** — dropdown with Save / Load / New Seed / Pass Year. Each is a `<button>` that fires the corresponding store action. **Save/Load buttons:** same typed-error catch pattern as P2's `<LoadButton />`; the catch surfaces to the `CorruptSaveBanner` via prop-callback.
  - **Why `shared/` not `map/`:** TopBar and SettingsMenu are not map-specific — P4's ballroom will reuse them. Future phases extending the player UI inherit them as the persistent chrome.

- **`src/ui/map/`** — NEW directory. Contains:
  - **`MapView.tsx`** — top-level map component. Renders the SVG backdrop, the 7 location pins, and the location-details panel. Listens for travel events via the bus and shows a transient toast on success.
  - **`MapBackdrop.tsx`** — the SVG/img background. Source asset (`/public/map.svg` or a hand-rolled SVG) is provisional; P16 polish iterates. **Inline placeholder backdrop at P3:** a styled `<div>` with subtle Tailwind gradient and printed location labels for layout reference — no real artwork. **Why a placeholder, not commissioning artwork:** unblocks the gameplay flow; the visual fidelity gate is P16's job. The pin positions still come from `LOCATION_PIN_COORDS` so the backdrop swap is artwork-only.
  - **`LocationPin.tsx`** — absolutely-positioned pin component. Props: `location: LocationId`, `coords: { x: number; y: number }`, `isCurrent: boolean`, `isReachable: boolean`, `rejectionReason?: TravelRejection`. Renders a styled button; disabled when `!isReachable` with hover-tooltip showing the rejection reason. On click: `store.travel(location)`.
  - **`LocationDetailsPanel.tsx`** — right-side panel showing the current location's name, description (from `fixtures/locations.ts` `LOCATION_DESCRIPTIONS` map — new), per-tick deltas (from `getLocationDelta`), available actions (gated by location identity), and the consecutive-tick counter (visible at Country to telegraph the Rustic-trait progression). Available actions render conditionally:
    - Always: "Stay here a year" button (calls `store.advanceTick()`).
    - At Country: "Liquidate Heirlooms" (only when `wealth < 0`).
    - At Capital: "Request Audience" (only when `canRequestAudience.ok`); "Refresh Wardrobe" (always available — wealth check is informational).
  - **`ActionRejectionToast.tsx`** — small toast that mounts when a travel attempt fails, showing the typed rejection reason in user-readable prose. Auto-dismisses after 3 seconds. **One toast component covers all four rejection paths** (Travel + Audience + Escape + Wardrobe rejections share a discriminated-union prop; the rendering switch is exhaustive with `assertNever`).
  - **`LOCATION_LABELS` / `LOCATION_DESCRIPTIONS`** — Maps in `fixtures/locations.ts` (additive to the existing `LOCATIONS` tuple). Labels are short ("The Capital", "The Country Estate", "Cultured Capital", ...); descriptions are one-sentence flavor text used by the panel. Both are designer-iterable and live in fixtures, not UI code.

- **`src/game/bootstrap.ts` extended.** `seedStartingFamily` currently produces the head + house with no location. P3 extends the House construction to include the five new fields with the same defaults the migration uses (`currentLocation: "Capital"`, `consecutiveTicksAtCurrentLocation: 0`, `lastAudienceTick: null`, `wardrobeLastRefreshTick: null`, `blockadeBypassEarned: false`). **Field-naming consistency:** identical names between bootstrap and migration ensures a v3-load-and-migrate-then-save and a fresh-start-then-save produce hash-equal states (a parity test, mirroring P2's v2→v3 parity test).

- **`src/game/store.ts` `createInitialState` extended (B8 fix).** The constructor at `store.ts:45-65` currently returns 6 keys; P3 adds `era: "Earlier"` as the 7th. Literal edit: insert `era: "Earlier",` between the `campaignName,` line (currently `store.ts:63`) and the closing brace at `store.ts:64`. **Why this edit cannot be deferred:** `hashable-state-extension.test.ts` parses a freshly-constructed state through `GameStateSchema` on every test boot — a constructor missing `era` fails Zod parse and breaks the trip-wire (and every other test that boots a fresh store). The edit lands in the same atomic commit as the `GameStateSchema.era` addition. **Symmetric "every constructor surface gets `era`" check:** `createInitialState` is THE fresh-state constructor; `fromSaveV1/V2/V3` are the legacy-save constructors (covered by the schema cutover bullet earlier in plan); `fromSaveV4` is the live-format constructor (also covered). No other path constructs a `GameState` literal in production code — the audit-test (`store.replace-state.test.ts` extended at P3) verifies this against `Object.keys(GameStateSchema.shape)` to catch a future "forgot another surface" footgun.

- **`src/game/entities.ts` extended.** Add the five `House` fields and one `GameState` field to the Zod schemas. The order in the schema dictates the order keys appear in canonical JSON, but the hash uses `canonicalJSON`'s lex-sort, so ordering inside the schema is editor-comfort, not hash-relevant. New schema entries (all required after migration applies):
  ```ts
  // HouseSchema additions (P3):
  currentLocation: LocationIdSchema,
  consecutiveTicksAtCurrentLocation: z.number().int().nonnegative(),
  lastAudienceTick: z.number().int().nullable(),
  wardrobeLastRefreshTick: z.number().int().nullable(),
  blockadeBypassEarned: z.boolean(),

  // GameStateSchema additions (P3):
  era: z.enum(["Earlier", "Later"]),
  ```
  All six new fields land in `hashableState`'s projection (`src/game/hash.ts`). The existing `hashable-state-extension.test.ts` invariant (schema keys ↔ projection keys equality) catches a forgotten projection addition — same trip-wire P2 relied on.

- **`src/game/hash.ts` projection extended.** Add `era: state.era` to the `hashableState` return shape. House-projected fields are already exhaustively spread via `serializeRegistry(state.houses)` so the five new `House` fields hash automatically through that pathway — no per-field addition needed.

**Out of scope.** Ball entry (P4 ballroom — Capital location grows a "Attend Ball" button at P4); Hyde Park promenade (P12 — Capital grows another action at P12); Smuggling era-gating that *sets* `blockadeBypassEarned` (P5 — Smuggling scheme completion flips it); railway research (P13 — Later-era action that halves courier transit, requires `state.era === "Later"`); artifact-equipped pre-ball composure penalty consuming `wardrobeLastRefreshTick` (P10 — P3 writes the field, P10 reads it); patronesses receiving `+5` from full-success audience (P8 — P3 audience action has an empty-loop stub at the patroness-update site); rival hostility dropping `-5` from full-success audience (P8 — same stub pattern); era transition mechanism (P13 — `state.era === "Earlier"` is hard-locked at P3); cross-house marriage with rivals affecting travel (P8 + spec §10 Q16, both deferred).

**Spec refs.** §3 "Strategy Map", "Location-Bound Trait Acquisition & Risk Asymmetry", "Monarch's-Audience Resolution", "Economy & Bankruptcy" (escape valve), "Wardrobe Decay & Pre-Ball Composure Penalty" (refresh write-only at P3); §7 "Same-tick monarch's audience and rival action", "Wardrobe refresh during bankruptcy"; §10 Q21 "Cultural-pivot before artifact registry" — N/A confirmation (P3 doesn't touch).

**Key rules / constants.**

- Monarch's audience: rep ≥ 30; 30-tick cooldown (`lastAudienceTick === null OR state.tick - lastAudienceTick >= 30`); full success at ≥ 50 wipes scandal to 0, +5 to all patronesses (stub), `-5` rival hostility per rival (stub); partial 30–49 applies `+10` scandal; both partial and full pay `-50 wealth, -10 reputation`; denial paths (rep < 30 OR cooldown active) cost nothing and do NOT update `lastAudienceTick`.
- Continental seduction-cities (`CanalCity`, `RenaissanceCity`): lower reputation penalty during Seduction (P5 owns the consumption; `SEDUCTION_CITY_SCANDAL_PROBABILITY_MULTIPLIER` pinned in `constants.ts`); higher inbound-courier scandal probability (P6 owns the consumption).
- Travel: changes `currentLocation` first, then advances tick. Destination's `LOCATION_DELTAS` apply during the same tick.
- Era gate at P3: `ForeignCapital` is always blockaded (era is always `"Earlier"`; `blockadeBypassEarned` is always `false`).
- Rustic trait acquisition: 5 consecutive ticks at `Country`. Counter resets on travel away.
- Finishing-school trait acquisition: 20% per-tick chance + `-3 wealth/tick` drain. Stops once the trait is acquired.
- Audience action sequence: validate → deduct cost → apply outcome effects → set `lastAudienceTick` → advance tick (orchestrator runs the rest of the phase chain).
- All four player-elected location actions follow the **pre-tick action pattern**: mutate `GameState` first, then `advanceTickPure`. This ensures the audience's hostility drop precedes the rival-action phase (§7 edge case) without requiring orchestrator-internal reordering.

**Machines.** None new. Travel is a single-shot action with no state-machine semantics (no multi-tick travel; no "in transit" state). Future phases may introduce travel-related machines (e.g., if pre-adulthood betrothals from §10 Q17 ever ship), but P3's data model is flat.

**Edge cases (§7).**

- **"Same-tick monarch's audience and rival action"** — audience must drop rival hostility before rival action phase fires on the same tick. Mechanism: audience is a pre-tick action (mutate state → advance via orchestrator); rival-action is the orchestrator's phase 8 (always last). The audience's hostility drop is wired as a stub (empty rival loop at P3); the ordering contract is in place for P8. Test: `monarchsAudience.test.ts` constructs a synthetic state with a stub rival entity and asserts the hostility-drop write happens before the rival phase fires.
- **"Wardrobe refresh during bankruptcy"** — refresh always succeeds at Capital regardless of wealth. The UI surfaces a warning ("This refresh will drop you into Hemorrhaging") when the deduction would cross a tier boundary; the rule layer enforces no gate. Tested both at the rule layer (refresh from `wealth = 0` succeeds with `wealth = -20` after) and at the UI layer (warning text appears when the deduction crosses a tier — verified via Playwright).
- **"Action gating bypassed by mid-flight scheme starts"** — N/A at P3 (no schemes ship until P5). The action-gating discipline (validate → deduct → apply) is already enforced for the four P3 actions and lays the precedent.
- **Travel to current location** — `canTravel` rejects with `SameLocation`; UI disables the current-location pin visually. Both safeguards land in P3.
- **Travel during finishing-school trait acquisition in progress** — the consecutive-tick counter resets on travel, so the player can interrupt a `Country` Rustic-trait pursuit by traveling away. **No special handling needed; reset is the right semantics.**

**Verification.**

- `pnpm test` — all Vitest suites green; new suites pass:
  - `src/game/rules/locationEffects.test.ts` — phase application across all 7 locations × delta correctness; consecutive-tick counter increment + reset; Rustic-trait grant at threshold (idempotent); finishing-school trait grant probability check via fixed-seed assertion (deterministic given seed + state); finishing-school drain stops after trait acquired; trait-acquired-but-still-rolls regression test.
  - `src/game/rules/travel.test.ts` — `canTravel` rejection paths × `applyTravel` mutation × travel atomicity. All four `TravelRejection` variants exercised.
  - `src/game/rules/monarchsAudience.test.ts` — all four outcome paths (denied: rep<30; denied: cooldown; partial: rep 30–49; full: rep ≥ 50); cost-paid-only-on-success invariant; scandal wipe on full only; `lastAudienceTick` set on partial/full but NOT on denial; phase-ordering test (audience drop happens before stub rival phase).
  - `src/game/rules/bankruptcyEscape.test.ts` — gate (`wealth < 0` AND `currentLocation === "Country"`); applies `+50 wealth, +5 scandal`; clamp at `+5` boundary.
  - `src/game/rules/wardrobeRefresh.test.ts` — gate (`currentLocation === "Capital"` only); always succeeds regardless of wealth; deducts 20; sets `wardrobeLastRefreshTick`.
  - `src/persist/migrations/v3-to-v4.test.ts` — happy path + idempotence (`assertMigrationIdempotent`).
  - `src/persist/migrations/v1-to-v4-chain.test.ts` — extends P2's chain test; v1 → v2 → v3 → v4 produces a SaveV4 whose hash equals a fresh `createInitialState` for the same seed.
  - `src/runtime/tickOrchestrator.test.ts` — extended to assert location-effects phase fires between economy and courier-draining. New synthetic-state fixture: post-orchestrator wealth includes both economy and location-effects deltas.
  - `src/game/replay-harness.test.ts` — extended with travel + audience flows in the 30-run harness. Each seeded run executes a fixed action sequence (travel Capital → Country → Capital → request audience → travel Country → stay 5 ticks → assert Rustic granted); final hash equal across all 30 runs.
  - `src/game/hashable-state-extension.test.ts` — automatically catches the schema-projection drift if `era` is added to schema but forgotten in projection. Same trip-wire P2 inherited.
  - `src/game/store.replace-state.test.ts` — NEW (or extended if P2 already created it). Asserts every `set`-style state copy in `store.ts` covers all `GameStateSchema.shape` keys via `Object.keys` introspection. Catches the "added a field, forgot to copy it" footgun.
- `pnpm lint` — Biome clean.
- `pnpm lint:boundaries` — ESLint boundaries clean. **No new ESLint elements introduced at P3:** the existing `ui` folder element already covers `src/ui/map/**` and `src/ui/shared/**` (folder-mode, matches anything under `src/ui`); `rng.seeds.ts` relocation moves the boundary-relevant symbol into the existing `game-rng` element (file-mode `rng.ts`). Cross-element imports introduced at P3:
  - `ui → game-store` (existing pattern, allowed).
  - `ui → game-fixtures` (for `LocationIdSchema`, `LOCATION_LABELS`, etc. — allowed by default).
  - `ui → runtime/events/*` (new at P3 for the event-bus subscribe pattern — allowed by default; `ui → runtime` is permissible per existing rules).
  - `runtime/events → game-entities` (event payloads carry typed entity references — allowed).
  - `game-rules → game-rng` for `PLAYER_HOUSE_ID` (newly imported by `rules/locationEffects.ts`, `rules/travel.ts`, `rules/monarchsAudience.ts`, `rules/bankruptcyEscape.ts`, `rules/wardrobeRefresh.ts`) — already in the `game-rules` allow list from P0/P1 (`drawNext`/`getOrThrow`/`createRngState` already cross this edge). The P3 relocation of `PLAYER_HOUSE_ID` from `rng.seeds.ts` to `rng.ts` is what makes this import legal; if the constant stayed in `rng.seeds.ts` (the `game-other` element), the import would fail because `game-rules → game-other` is explicitly disallowed at `eslint.config.js:84`.
  - **`game-entities → game-fixtures` for `LocationIdSchema`** (newly imported by `entities.ts` to type `HouseSchema.currentLocation`) — **this edge already exists** at P0/P1. `src/game/entities.ts:12-14` already imports `ArchetypeSchema`, `MoodSchema`, and `RoleSchema` from `./fixtures/*`. The new `LocationIdSchema` import follows the established pattern; no new boundary edge is created. No positive-control test addition required — P0/P1's existing `game-entities → game-fixtures` test cases cover it (or the existing imports would already be failing).
  - **No new `disallow` rules.** P3 does not introduce a determinism-sensitive boundary that P0–P2's rules don't already cover.
  - **Positive-control boundary tests** in `eslint/boundaries.test.ts` — add **four** new synthetic-source cases covering: (i) `ui → game-store` (extending P2's coverage if needed), (ii) `ui → game-fixtures`, (iii) `ui → runtime/events/*`, (iv) `runtime/events → game-entities`. The `game-rules → game-rng` for `PLAYER_HOUSE_ID` does NOT need a new positive-control case — P0/P1's existing `drawNext`-from-rules cases already exercise that edge. Pattern matches P1's 9-case addition.
  - **Negative-control boundary test** in `eslint/boundaries.test.ts` — add ONE new case: `game-rules → game-other` for an import of `rng.seeds.ts` (or any other `src/game/*.ts` file outside the allow-listed elements) MUST be rejected by ESLint. This guards against a future refactor that drops `PLAYER_HOUSE_ID` back into `rng.seeds.ts` without updating the elements list. Specifically asserts the ESLint error category is `boundaries/element-types` with the rule-(a) message.
- `pnpm typecheck` — strict TS clean. `SaveV1 | SaveV2 | SaveV3 | SaveV4` discriminated union narrows correctly via the `version` discriminator. The `Location` literal-tuple-derived type continues to narrow correctly in switches; `assertNever` exhaustive checks at the four action rejection-union switches.
- **Playwright spec (`tests/e2e/dev-smoke.spec.ts`).** **Rename to `tests/e2e/map-smoke.spec.ts`** since "dev" is no longer accurate. Covers:
  - **Mount + load:** map view renders with 7 pins; current-location pin visually distinct (e.g., highlighted ring).
  - **Travel happy path:** click `Country` pin → tick advances → `currentLocation` becomes `Country` → wealth pip shows `+1` for that tick.
  - **Travel rejection (era-blockade):** click `ForeignCapital` pin → travel rejected → rejection toast appears with prose mentioning the blockade.
  - **Travel rejection (same location):** click current-location pin → no toast, no state change (pin is visually disabled).
  - **Audience happy path:** force state into `rep = 60, currentLocation = "Capital"` via the same `_putRawForTests` setup helper (extended at P3 to put a full SaveV4 record), reload, click "Request Audience" → outcome is Full Success → scandal becomes 0, wealth and rep deducted.
  - **Audience cooldown:** request twice in succession → second click shows the cooldown-rejection toast.
  - **Bankruptcy escape:** force `wealth = -50, currentLocation = "Country"`, click "Liquidate Heirlooms" → wealth = 0, scandal +5.
  - **Wardrobe refresh:** at Capital with `wealth = 0`, click "Refresh Wardrobe" → wealth = -20, `wardrobeLastRefreshTick` set (verified via store readback).
  - **Corrupt save banner survives the dev-shell deletion.** P2's corruption flow re-runs at P3 against the new shell. Banner appears with same aria contract; "Start New Game" recovers.
  - **Why Playwright not Vitest:** these are user-flow assertions through the rendered UI; unit tests cover the pure-rule layer.
- **Forbidden-randomness walker test** continues to pass. No new files at P3 import `Math.random` or `crypto.getRandomValues`. The location-effects phase's finishing-school trait draw is via the per-house `RngState` from P1's contract.
- **CLAUDE.md updates.** Three new conventions appended under the existing "Coding conventions" section:
  > **Player-elected location actions follow the pre-tick action pattern.** All four P3 actions (travel, audience, escape, refresh) mutate `GameState` first via a pure-rule function, then call `advanceTickPure` through a store wrapper. This guarantees same-tick ordering invariants (notably the audience-drops-rival-hostility-before-rival-phase contract from §7) without requiring orchestrator phase reordering. New player-elected actions in later phases (P5 schemes, P8 reconciliation) follow this same shape.

  > **`currentLocation` and its companion fields (`consecutiveTicksAtCurrentLocation`, `lastAudienceTick`, `wardrobeLastRefreshTick`, `blockadeBypassEarned`) are per-house, not per-character.** At P3 only the player house has meaningful values; P8 rivals will set sensible defaults but the location-effects phase only mutates the player house's fields. Identity check is hard-coded against `PLAYER_HOUSE_ID`, which P3 relocates from `rng.seeds.ts` to `rng.ts` so that the `game-rules` boundary allow-list (`game-rng`) admits the import without an ESLint config edit.

  > **`state.era` is read-only at P3.** Hard-locked to `"Earlier"` until P13 ships the transition mechanism. Travel-gating logic that references `state.era` is in `src/game/rules/travel.ts`; the field exists for forward-compatibility, not because P3 mutates it.

  > **Event-bus is a typed `Map<EventVariant["kind"], Set<Subscriber>>` pub/sub at `src/runtime/events/bus.ts`.** Event types are partitioned per domain (`location.ts`; future phases add `conversation.ts`, `scheme.ts`, etc.). **`bus.publish` fires from store-action wrappers ONLY, AFTER `set` returns** — never from inside the orchestrator's phase chain (which must stay pure) and never from inside an Immer producer body. React subscribers register via `useEffect(() => bus.subscribe(kind, handler), [kind])` with cleanup; the canonical consumer hook is `useBusEvent<K>(kind, handler): void` exported from `src/runtime/events/useBusEvent.ts`. Future phases inherit this discipline.

**Convergence-applied refinements** (cycle 5 advisory triage):

- **Playwright SaveV4 record construction** — `src/main.tsx`'s DEV-mode block exposes a new `window.__buildSaveV4ForTests(partial: Partial<HouseV4Overrides>): SaveV4` helper that calls `toSaveV4(createInitialState("dev").merge(partial))` to produce valid records from partial specs. Playwright specs invoke this via `await page.evaluate((p) => window.__buildSaveV4ForTests(p), { rep: 60, currentLocation: "Capital" })` then feed the result into `__putRawForTests("dev", record)`. Choice rationale over hand-rolled JSON literals: the helper centralizes schema-validation guarantees, so a SaveV4 schema change automatically narrows the test fixtures.
- **Audience cooldown boundary tests** in `monarchsAudience.test.ts`: pin three fixtures: (1) `state.tick=10, lastAudienceTick=null` → audience allowed (first attempt); (2) audience at `tick=10` then `tick=39` → cooldown rejection (`39 - 10 = 29 < 30`); (3) audience at `tick=10` then `tick=40` → allowed (`40 - 10 = 30 >= 30`). Off-by-one on the `>=` comparator is load-bearing.
- **Head-trait access pattern in `applyLocationEffectsPhase`**: use `getCharacterOrThrow(state, house.headOfHouseCharacterId)` from `src/game/util/lookups.ts` for all three head-trait checks (Rustic threshold, finishing-school lookup, finishing-school grant). Avoid inline `state.characters.get(...)` because of `noUncheckedIndexedAccess` ambiguity.
- **`LOCATION_PIN_COORDS` percentage semantics**: CSS `%` (relative to the parent positioned container of `<MapView />`). The SVG backdrop is rendered separately and positions are NOT in viewBox coords. The wrapper div uses `position: relative` and each `<LocationPin />` uses `position: absolute; left: {x}%; top: {y}%`.
- **`LOCATION_LABELS` and `LOCATION_DESCRIPTIONS`** in `fixtures/locations.ts`: both typed as `Record<LocationId, string>` (exhaustive maps; every location has both a label and a description, no `undefined` fallback path). Use `Record` not `ReadonlyMap` since exhaustive enum-keyed lookups are TS-checkable.
- **`TickPhase` export**: add `export` to the type alias at `src/runtime/tickOrchestrator.ts:31` as part of the same atomic edit that adds `runOrchestratorWithPhases`. Without the export, `phaseOrderTracker.ts` cannot reference the type in its own helpers.
- **`defaultHouseV4Fields` body**: literal implementation is `return { ...h, currentLocation: "Capital" as LocationId, consecutiveTicksAtCurrentLocation: 0, lastAudienceTick: null, wardrobeLastRefreshTick: null, blockadeBypassEarned: false };`. The spread preserves branded-string `id` via TS structural typing.
- **`LocationPin.tsx` `rejectionReason` computation**: `<MapView />` precomputes `canTravel(state, PLAYER_HOUSE_ID, location)` for all 7 locations once per render (via `useMemo`) and threads `rejectionReason` as a prop. Each `<LocationPin />` receives the precomputed value; no per-pin store selector. Single state read, 7 validations per render — cheaper than 7 selector subscriptions.
- **`RequestedAudience` event publish-on-all-outcomes**: the bus publishes `RequestedAudience` on Denied, Partial, AND FullSuccess outcomes. The `ActionRejectionToast` subscribes and branches on `outcome.kind` to render appropriate prose. Avoids a separate `RequestedAudienceFailed` event variant. Matches the discriminated-union pattern used elsewhere.
- **`SAMPLE_STORE_STATE` and `SAMPLE_STATE` in `schema-projection-selector-extension.test.ts`**: factory source is `createStore({ seed: "test" }).getState()` for `SAMPLE_STORE_STATE` and `createInitialState("test")` for `SAMPLE_STATE`. Mirrors the existing `hashable-state-extension.test.ts` pattern.
- **Rule-layer relative import path for `PLAYER_HOUSE_ID`**: `src/game/rules/*.ts` imports via `import { PLAYER_HOUSE_ID } from "../rng";` (two-dots-up). All five new P3 rule files use this exact relative path.
- **Cutover safe-split point**: after `SaveV4Schema`, `toSaveV4`, `fromSaveV4`, and the v3→v4 migration are appended to `schema.ts` + `migrations/index.ts` + `entities.ts` (House field additions) + `hash.ts` (era projection) + `bootstrap.ts` (House field defaults) + `store.ts:create_initial_state era addition` but BEFORE the `selectGameState` extension and the `dexie.ts:18/58/70` swaps, the tree typechecks cleanly because legacy `toSaveV3` still has all its consumers. This is the recommended mid-sequence stash point.
- **Playwright spec testId carry-forward**: of the dev-shell testIds, three survive to the new shell: `corrupt-save-banner`, `corrupt-save-start-new`, `corrupt-save-dismiss` (the corrupt-save flow's banner moves to `src/ui/shared/CorruptSaveBanner.tsx` with identical attribute contract). The rest (`tick-button`, `tick-readout`, `head-age-readout`, `save-button`, `load-button`, `year-pass-button`, `status`) are replaced by new IDs on the player shell: `settings-menu-trigger`, `settings-menu-save`, `settings-menu-load`, `settings-menu-pass-year`, `location-pin-{LocationId}`, `location-details-stay`, `current-location-label`, `tick-readout` (preserved). The Playwright spec renames `tests/e2e/dev-smoke.spec.ts` → `tests/e2e/map-smoke.spec.ts` and rewrites all selectors against the new testIds; the corrupt-save block is the only carry-forward.

**Rollback.** Pre-merge: revert the branch. The save format goes back to v3; any v4 save written during testing throws `SaveVersionTooNewError` on the rolled-back client (matches P2's pattern). The dev shell at `src/ui/dev/` is recoverable from git history — but post-revert there's no "Stay Another Tick" affordance, so manual testing reverts to P2's dev shell. Post-merge with player saves: requires a forward-only `migrate_v4_to_v3` (downward — explicitly NOT supported per spec §8 compat rules); rollback strategy is "ship a fix forward, never reverse the migration."

**Close out.** When the gates and verification items above are green, run `/close-phase P3` to update phase status in `plans/MASTER.md` §6, append to `plans/SESSION-NOTES.md`, resolve any open questions answered during the work (P3 doesn't directly resolve a §10 master-plan open question, but resolves five P3-internal questions documented inline: trait-acquisition threshold, finishing-school drain magnitude, wardrobe-refresh cost, era-field placement, first-tick-at-destination semantics), apply any `CLAUDE.md` additions, and commit the changes (no push).

## Accumulated Risks & Suggestions

*Passively collected from review cycles. Not blockers. Triaged at convergence.*

- [C1] Save-version cutover gap: pin `SAVE_VERSION_CURRENT` bump from `3` to `4`, `toSaveV4` literal `version: 4` write, `SaveRecord` widening to `SaveV1|V2|V3|V4` in `dexie.ts:35`, and `load()`'s `SaveV4Schema` final parse at `dexie.ts:92,100`. [folded into body]
- [C1] `store.replace-state.test.ts` introspection details unpinned — claims `Object.keys(GameStateSchema.shape)` matches set-body keys but doesn't pin HOW the test extracts the set-body keys (string parsing? reflection? hand-curated parallel list?).
- [C1] New `runtime/events → game-entities` boundary path isn't in the positive-control list; also no positive control exists for `ui → runtime/events/*` because no such import exists in the current codebase.
- [C1] Travel-action snippet at line 180 reads `state.houses.get(PLAYER_HOUSE_ID)!.currentLocation` post-mutation timing is brittle to a `seedStartingFamily` change — compute `from` explicitly before the mutate step. [folded into body]
- [C1] `_putRawForTests` Playwright crafting of SaveV4 records is undefined — pin how the page-evaluate scope produces a valid SaveV4 without importing schemas (e.g., a helper module exposed via `window` in dev mode). [applied]
- [C1] `FINISHING_SCHOOL_WEALTH_DRAIN_PER_TICK` + `LOCATION_DELTAS` interaction post-graduation: once trait is acquired, drain stops but `LOCATION_DELTAS` still applies `-2 wealth, +1 reputation` — surface as intentional ("graduates still pay tuition") or tuning oversight.
- [C1] Audience cooldown post-tick semantics implicit — `lastAudienceTick = state.tick` set BEFORE `advanceTickPure`; pin a boundary test (T=10 audience → T=40 second audience OK; T=39 rejects). [applied]
- [C1] "Stay here a year" button is the only player action that fires the orchestrator WITHOUT a domain mutation; note this so a later phase doesn't refactor it into the wrapped shape for false consistency.
- [C1] PHASES snippet lists 8 entries; existing `tickOrchestrator.ts` uses 1-7 ordinals — confirm numbering alignment when implementing.
- [C1] Head-trait access pattern repeated 3x in `applyLocationEffectsPhase` — pin which helper (`getCharacterOrThrow` from `game/util/lookups.ts`? inline?) the new rules use, or accept inlining as intentional. [applied]
- [C1] `LOCATION_PIN_COORDS` percentage semantics — pin whether CSS `%` (relative to parent box) or SVG viewBox coordinates (transformed by SVG transform stack). [applied]
- [C1] Forbidden-randomness walker coverage for new UI files — confirm the path glob covers `src/ui/map/**` and `src/ui/shared/**` automatically vs. hardcoded path list.
- [C1] `TravelRejectionToast.tsx` name too narrow — renamed to `ActionRejectionToast.tsx` throughout. [applied]
- [C1] Event-bus pattern at `runtime/events/bus.ts` (~80 LOC, generic Map-based pub/sub) is a new project convention — add a CLAUDE.md note alongside the three "Coding conventions" additions. [applied]
- [C2] Convergence triage pass: the `[C1]` tail accumulates many items; per `patterns.md` "Triage-pass convergence works when explicit", recommend an explicit one-line-per-item triage with `[folded into <section>]` / `[deferred to <phase>: <reason>]` / `[still-open]` tags so unresolved items don't all carry forward identical urgency.
- [C3] Line numbers drift across revisions: plan claimed `fromSaveV1` at `schema.ts:46` and `fromSaveV2` at `schema.ts:92`; verified locations are `:50` and `:95`. `dexie.ts:35` `SaveRecord` claim is at `dexie.ts:33` in current source. Plan now uses symbol-grep guidance (`rg "SaveRecord" src/persist/dexie.ts`) instead — confirm during implementation. [folded into body]
- [C3] Store action snippet uses `set((draft) => ...)` but existing store uses `set((state) => ...)`. Cosmetic but worth pinning the immer-draft parameter name so an implementer copying the snippet verbatim doesn't introduce a one-bullet style break. [folded into body]
- [C3] `selectGameState` is the third schema-extension surface (alongside `GameStateSchema` and `hashableState`). P3 adds `schema-projection-selector-extension.test.ts` to enforce the triple-sync; future phases adding `GameState` fields must remember the third surface or trust the trip-wire.
- [C3] Asymmetric action return shapes across the 4 player actions: `travel` returns `{ ok: boolean; reason?: TravelRejection }` and `requestAudience` returns `{ outcome: AudienceOutcome }` (with denial folded into `AudienceOutcome.Denied`). UI rendering must branch on two patterns; consider a canonical `{ ok: true; data: T } | { ok: false; reason: R }` envelope.
- [C3] Edit-discovery via line numbers vs. symbol-grep: recommend `rg <symbol> src/` as the canonical edit-discovery mechanism since line numbers drift; pinned in the save-version cutover edit list, but worth lifting to a general convention.
- [C4] `createInitialState` (`src/game/store.ts:45`) extension not in explicit step list — add `era: "Earlier"` to its return object or fresh-construction fails the new schema parse and breaks the trip-wire on boot. Same omission risk for `seedStartingFamily` if it constructs `House` directly (already covered by the bootstrap extension bullet, but `createInitialState` is a separate surface). [folded into body]
- [C4] `HousePreV4` type unpinned: the `defaultHouseV4Fields(h: HousePreV4): House` helper signature references an undefined alias. Pin: `type HousePreV4 = Omit<House, "currentLocation" | "consecutiveTicksAtCurrentLocation" | "lastAudienceTick" | "wardrobeLastRefreshTick" | "blockadeBypassEarned">` and document its home (likely `src/persist/schema.ts` adjacent to the lifters). [folded into body]
- [C4] Existing `replaceState` action (`store.ts:115`) set-body lacks `era` — plan keeps the action as-is for full-state swaps but its body must learn the new key. Without explicit `state.era = next.era`, `replaceState(fromSaveV4(...))` produces a state missing `era`.
- [C4] `advanceTick` (`store.ts:96-103`) and `runYearPass` (`store.ts:106-113`) set-bodies also lack `era` — three existing actions need explicit edits, not just the new ones. The `store.replace-state.test.ts` audit catches the omission but the body should pin the edits.
- [C4] `SAMPLE_STORE_STATE` / `SAMPLE_STATE` derivation in the new triple-sync trip-wire test (`schema-projection-selector-extension.test.ts`) unpinned — pin the factory source. Existing trip-wire uses `createInitialState("seed")`; the new test should mirror that pattern (use `createStore({ seed: "test" }).getState()` for `SAMPLE_STORE_STATE`, or pass `createInitialState("test")` directly as a StoreState-compatible shape). [applied]
- [C4] Rule-layer relative import path for `PLAYER_HOUSE_ID` unpinned — `src/game/rules/*.ts` imports from `"../rng"` (not `"../rng.seeds"`). Pin the relative path in the relocation bullet to remove ambiguity for the implementer. [applied]
- [C5] Three existing set-bodies need `state.era = next.era;` added: `advanceTick` (`store.ts:96-103` — after `state.campaignName = next.campaignName;`), `runYearPass` (`store.ts:106-113`), `replaceState` (`store.ts:115-122`). The `store.replace-state.test.ts` audit catches the omission at run time, but explicit per-action edits would prevent the trip-wire from being the discovery mechanism. [folded into body]
- [C5] `game-store → game-util` boundary edge for `getHouseOrThrow` import in the travel-action snippet: verify this edge is permitted by the existing `eslint.config.js`. `runtime → game-util` is verified-allowed via `runtime/yearPass.ts`'s existing import of `getCharacterOrThrow`; the `game-store → game-util` edge is separate and should be confirmed clean (almost certainly allowed by `default: "allow"`, but worth a positive-control case if not already covered).
- [C6] Double-click idempotence for "Stay here a year" button — `store.advanceTick()` fires once per click; rapid double-click executes twice and applies location effects twice in a single visible UI gesture. Pin: UI-layer debounce or `busy` state during the action, OR document that double-tick is intentional (rapid traversal). The Rustic-trait `>=` post-increment check is correct under either semantic, but the player UX should be predictable.
- [C6] Pin safe-split points within the atomic v3→v4 cutover: the cutover has 10+ coordinated edits across `schema.ts`, `dexie.ts`, `migrations/index.ts`, `bootstrap.ts`, `entities.ts`, `hash.ts`, `store.ts`. Per the cross-plan "Large atomic commits without mid-sequence safe points" pattern, name explicit typecheck-clean midpoints: e.g., "after `SaveV4Schema` + `toSaveV4`/`fromSaveV4` are appended to `schema.ts` and the migration is registered but BEFORE `selectGameState` / `dexie.ts:58` swap, the tree typechecks cleanly because legacy `toSaveV3` still works." Lets the implementer stash + verify mid-sequence. [applied]
- [C6] `LOCATION_DESCRIPTIONS` and `LOCATION_LABELS` map shapes unpinned — Map vs Record. Pin `Record<LocationId, string>` since every location has both a label and a description (no `undefined` fallback path). [applied]
- [C7] B6/B7 joint resolution: tracker at `src/runtime/__test-utils__/phaseOrderTracker.ts` and `runOrchestratorWithPhases` test-only export from `tickOrchestrator.ts`. The `game-rules → runtime` reverse boundary issue is avoided because the phase-ordering test (in `src/game/rules/monarchsAudience.test.ts`) is `.test.ts` and exempt from boundaries per `eslint.config.js:34`. No new positive-control case needed.
- [C7] `TickPhase` type alias is currently module-private (`tickOrchestrator.ts:31` declares `type TickPhase = ...` without `export`). The new `runOrchestratorWithPhases` test-only export uses `TickPhase` in its signature; for `phaseOrderTracker.ts` to construct values of type `TickPhase`, the type itself must also be exported. Add `export` to the type alias as part of the same edit. [applied]
- [C7] `eslint.config.js` line-number cite drift: plan body cites `:34` for the test-file ignore; verified actual `ignores:` is at `:33` and `boundaries/ignore` is at `:45`. Both mechanisms exempt `.test.ts` files; the substance is correct but the line citation is off by one. Refresh during implementation or replace with symbol-grep.
- [C8] Playwright `dev-smoke.spec.ts` → `map-smoke.spec.ts` is not a rename — the existing file uses dev-shell testIds (`tick-readout`, `tick-button`, `head-age-readout`, `save-button`, `load-button`, `year-pass-button`, `status`, `corrupt-save-banner`, `corrupt-save-start-new`) that map to components being deleted. Pin which testIds carry forward to the new player shell (e.g., does `<SettingsMenu />`'s Load button expose `data-testid="load-button"` for corrupt-save spec parity?). [applied]
- [C8] Plan claims `src/game/rules/__test-utils__/` exists as a precedent for `src/runtime/__test-utils__/`. Verified: it does NOT exist. Actual precedent is `src/persist/migrations/__test-utils__/idempotence.ts`. Substance of design is sound; correct the cite. [applied]
- [C8] `selectGameState` extension is mentioned in a body bullet (B5 fix) but an implementer scanning "In scope" might miss the explicit-edit treatment. Consider hoisting selectGameState's edit to the same prominence as `createInitialState`'s.
- [C8] `store.replace-state.test.ts` name suggests it covers only `replaceState` — extend to `set-body-completeness.test.ts` (or similar) so the name signals coverage of all four set-bodies (advanceTick + runYearPass + replaceState + the four new player actions).
- [C8] Trip-wire `hashable-state-extension.test.ts` only checks top-level `GameState` keys. House fields project automatically via `serializeRegistry`. Worth a one-line comment in `hash.ts` (or the test) noting that House-field additions don't need projection edits — prevents a future reviewer from "fixing" a non-bug.
- [C9] Bus subscriber wiring is unpinned: `bus.publish` is called from store actions (sync, outside `set` body). React effect-based subscribers (`MapView` listening for `TraveledTo`) need an explicit "publish AFTER set returns" contract so subscribers reading `store.getState()` observe the committed mutation. Pin one of: (a) consumer hook `useBusEvent<EventKind>(kind, handler)` with internal `useEffect` + bus.subscribe + cleanup, (b) raw `useEffect` pattern documented at the consumer site. [applied]
- [C9] `<TopBar />` head-age rendering contract for post-succession state: when head dies and heir promotes, the two-step `s.houses → s.characters` lookup naturally returns the new head's age via the optional-chain pattern. Pin this rendering contract for the new shell (currently implicit-handled by the existing `<HeadAgeReadout />` pattern but worth documenting).
- [C9] `RequestedAudience` event variant publish on `Denied` outcomes is undefined — does the bus publish on Denied (so the toast shows the rejection reason) or only on Partial/Full (so the toast is success-only and rejection has a separate UI path)? Pin: publish on ALL outcomes (Denied/Partial/Full); the toast component branches on `outcome.kind` to render the appropriate prose. Matches the discriminated-union return-shape pattern used for other actions. [applied]
- [C9] Negative-control boundary test target verification: the test asserts `game-rules → game-other` is rejected for an import of `rng.seeds.ts`. Verify the file-mode patterns at `eslint.config.js:11-12` (`pattern: "src/game/rng.ts"`, file-mode) and at the test pattern (`pattern: "src/game/rng*.test.ts"`) do NOT match `rng.seeds.ts` — the test glob requires `.test.ts` extension, so `rng.seeds.ts` falls through to `game-other` folder fallback. Alternative target: import from `src/game/hash.ts` (its own `game-hash` file-mode element) to make the boundary edge unambiguous.
- [C9] `defaultHouseV4Fields(h: HousePreV4): House` body is unpinned. Pin the literal body: `return { ...h, currentLocation: "Capital" as LocationId, consecutiveTicksAtCurrentLocation: 0, lastAudienceTick: null, wardrobeLastRefreshTick: null, blockadeBypassEarned: false };`. The spread preserves branded-string `id` (TS structural typing preserves the brand through spread). No deep clone needed — the lift is the boundary where structural-clone semantics matter, not this helper. [applied]
- [C9] `LocationPin.tsx` `rejectionReason?: TravelRejection` computation: MapView precomputes `canTravel(state, PLAYER_HOUSE_ID, location)` for all 7 locations once per render and threads `rejectionReason` as a prop. Avoids per-pin store selectors. Matches the prop-driven leaf-component pattern. [applied]
- [C9] Phase-ordering test pattern (`runOrchestratorWithPhases` + `phaseOrderTracker`) becomes the template P8 inherits for the real rival-hostility-drop test. Document inline at the `monarchsAudience.test.ts` test pattern bullet so the P8 author finds the pattern by reading the P3 test, not by re-discovering it.
