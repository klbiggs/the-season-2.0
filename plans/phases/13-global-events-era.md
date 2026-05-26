# P13 — Global Events & Era Progression

> Part of [The Season Master Plan](../MASTER.md). Prior: [P12 — Hyde Park Promenade](./12-promenade.md). Next: [P14 — Ledger View & Social Web Visualization](./14-ledger-social-web.md).

**Goal.** Three named global events (WarEffort, MarketCrash, MonarchsMood) with per-tick deltas applied uniformly across every house, plus the one-way `Earlier → Later` era transition at the reserved `ERA_TRANSITION_TICK`. Save format bumps **v12 → v13** to carry one new top-level `state.globalEvents: Map<GlobalEventId, GlobalEvent>` field plus one new `House.courierResearchEarned: boolean` field. P13 also widens `TRAITS` from 32 → 33 (new `MilitaryOfficer` trait used by WarEffort death rolls and Seduction multiplier) and replaces the `identityPhase` stub at orchestrator slot 6 with `applyGlobalEventPhase`. The Later-era research action ships as a wealth-costed free-action store wrapper (`researchFastCouriers`).

P13 is the first phase whose **per-tick rule consumes RNG draws every single tick** (the 5%/tick trigger roll burns one player-house draw unconditionally — earlier per-tick rolls like P10 forgery surfacing and P10 thief notice are conditional on entities existing in the relevant Map). It is also the first phase whose per-tick effects **iterate every house in `state.houses` for clamped delta application** (prior multi-house iteration patterns — economy, location effects — already exist, but global events extend the set with mid-tick uniform pressure). The publisher set widens from the P11 baseline of **10/10/9 → 11/11/9** with the addition of `publishGlobalEventTransitions` to every tick-advancing wrapper EXCEPT `runYearPass` (year-pass STEPS doesn't include `applyGlobalEventPhase`, so global-event transitions cannot emit during year-pass).

**What does NOT change (load-bearing).** `PHASES` count stays at **14** — slot 6's `identityPhase` is REPLACED by `applyGlobalEventPhase` (not inserted alongside). The non-negotiable "rivals always run last" stays at slot 14 (`applyRivalActionPhase`). Year-pass `STEPS` length stays at **5** (no year-pass-driven global-event mutations — era transition and event rolls are tick-phase only). `PERSONA_CACHE_VERSION` stays at `"v4"` (no persona-prompt format change). `RIVAL_HOUSE_IDS_SET` / `RIVAL_CHARACTER_IDS_SET` are READ during per-tick effects (rivals are NOT exempted from WarEffort/MarketCrash/MonarchsMood deltas — they participate in macro-economic pressure exactly like the player) but neither set is widened. `ERA_TRANSITION_TICK = 200` (declared at P3 / `src/game/constants.ts:395`) STAYS at 200 — P13 ships the transition mechanism that reads the existing constant. The era enum on `GameStateSchema` (`era: z.enum(["Earlier", "Later"])` at `src/game/entities.ts:496`, present since SaveV4) is READ and MUTATED; the schema declaration itself is untouched. `House.blockadeBypassEarned` (declared P5), `SCHEME_ERA_REQUIREMENTS.Smuggling = "Earlier"` (P5), the `EraBlockaded` rejection in `TravelRejection` (P3/P5), the `EraFlippedDuringSmuggling` scheme failure (P5), and `resolveSmuggling`'s defensive `state.era !== "Earlier"` branch (P5) are all PRE-WIRED — P13 makes them live by flipping `state.era` to `"Later"` at the threshold tick. The schema↔projection↔selector↔overwriteFromGameState quad-sync surface widens by ONE Map field (`globalEvents`); `createInitialState` gains one literal initializer.

**In scope.**

- **Save format bump to v13.** Adds **ONE new top-level GameState Map** + **ONE new `House` field** + **ONE new `TraitId` enum entry**. Every field is hash-relevant; every new entry has a default; the new top-level Map participates in the strip cascade for legacy emit:
  - `GameState.globalEvents: Map<GlobalEventId, GlobalEvent>` — per spec §3 line 392 ("Events terminate at an absolute end-tick recorded at start so save/load preserves their lifecycle"). Empty Map on fresh state and every legacy lift. Three discriminated-union variants: WarEffort, MarketCrash, MonarchsMood (with `favoredFamily: ArtifactFamily`).
  - `House.courierResearchEarned: z.boolean().default(false)` — Later-era research-action one-shot latch. `.default(false)` parses every legacy SaveV1-V12 `HouseSchema` payload cleanly (P8/P9 precedent for `House.hostility: 0` / `House.factionId: "faction-crown"` / `MarriageRecord.viaElopement: false`).
  - `TraitId` widens to include `"MilitaryOfficer"` — used by WarEffort per-tick death rolls AND Seduction-affection multiplier. NO character starts with this trait at bootstrap or in any legacy save. **The trait ships wired-but-inert at v1**: no v1 acquisition path produces an officer-tagged character (see "wired-but-inert" design intent in the `TRAITS` widening bullet below). **(see P16 correction — superseded by P21 §11.3-4: P16's BohemianRake society profile is the first *designed* officer acquisition path, and the conception novelty slot reaches it incidentally too; the "inert at v1" framing recurs throughout this plan but CLAUDE.md's P16 pin is authoritative. The officer mechanics are NO LONGER strictly inert once P16 ships.)** The WarEffort officer-death and officer-Seduction mechanics fire ZERO times across a v1 campaign. Tests seed officer-tagged characters via fixture literals to exercise the otherwise-dormant rule branches. Spec line 390 framing: "any family character carrying a 'military officer' trait or role" — we route via trait (vs role) because `Roles` are mutually-exclusive (HeadOfHouse/Heir/Dependent/Spouse/Spinster/Exile/Bohemian) and an officer can legitimately be Heir-AND-Officer simultaneously.

- **`SaveV13Schema` declaration** (NEW at P13 in `src/persist/schema.ts`):
  ```ts
  // src/persist/schema.ts (NEW at P13):
  export const SaveV13Schema = z.object({
    version: z.literal(13),
    tick: z.number().int().nonnegative(),
    rng: z.array(z.tuple([HouseIdSchema, RngStateSchema])),
    houses: z.array(z.tuple([HouseIdSchema, HouseSchema])),  // LIVE HouseSchema — includes courierResearchEarned via .default(false)
    characters: z.array(z.tuple([CharacterIdSchema, CharacterSchema])),  // LIVE CharacterSchema — traits[] can now contain "MilitaryOfficer"
    marriages: z.array(z.tuple([MarriageIdSchema, MarriageRecordSchema])),
    campaignName: z.string(),
    era: z.enum(["Earlier", "Later"]),  // unchanged shape; P13 flips the value at threshold
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
    elopement: ElopementSprintStateSchema.nullable(),
    artifactInstances: z.array(z.tuple([ArtifactInstanceIdSchema, ArtifactInstanceSchema])),
    forgeries: z.array(z.tuple([ForgeryIdSchema, ForgeryRecordSchema])),
    thiefAttempts: z.array(z.tuple([ThiefAttemptIdSchema, ThiefAttemptSchema])),
    // P13 ADDITION — one new top-level Map:
    globalEvents: z.array(z.tuple([GlobalEventIdSchema, GlobalEventSchema])),
  });
  export type SaveV13 = z.infer<typeof SaveV13Schema>;
  ```
  `SAVE_VERSION_CURRENT` bumps from `12` → `13` at `src/persist/schema.ts:73`.

  **`toSaveV13` live emitter body** (NEW at P13 in `src/persist/schema.ts`, alongside `SaveV13Schema`). Mirrors the live `toSaveV12` shape at `schema.ts:1728-1755` plus the one new field. ONLY live emitter to reference `SAVE_VERSION_CURRENT` (every other emitter pins its literal version):
  ```ts
  // src/persist/schema.ts (NEW at P13):
  export function toSaveV13(state: GameState): SaveV13 {
    return SaveV13Schema.parse({
      version: SAVE_VERSION_CURRENT,  // = 13 (live emitter); legacy emitters pin literal versions
      tick: state.tick,
      rng: serializeRegistry(state.rng),
      houses: serializeRegistry(state.houses),  // LIVE HouseSchema — includes courierResearchEarned
      characters: serializeRegistry(state.characters),  // LIVE — traits[] may contain "MilitaryOfficer"
      marriages: serializeRegistry(state.marriages),
      campaignName: state.campaignName,
      era: state.era,
      conversationHistory: serializeRegistry(state.conversationHistory),
      affectionMap: serializeRegistry(state.affectionMap),
      schemes: serializeRegistry(state.schemes),
      whispers: serializeRegistry(state.whispers),
      couriers: serializeRegistry(state.couriers),
      staff: serializeRegistry(state.staff),
      proposalsLog: serializeRegistry(state.proposalsLog),
      tutorAssignmentsLog: serializeRegistry(state.tutorAssignmentsLog),
      pendingTutorTraitChoices: serializeRegistry(state.pendingTutorTraitChoices),
      patronesses: serializeRegistry(state.patronesses),
      rivalActors: serializeRegistry(state.rivalActors),
      factionTensions: serializeRegistry(state.factionTensions),
      duels: serializeRegistry(state.duels),
      elopement: state.elopement,
      artifactInstances: serializeRegistry(state.artifactInstances),
      forgeries: serializeRegistry(state.forgeries),
      thiefAttempts: serializeRegistry(state.thiefAttempts),
      // P13 ADDITION:
      globalEvents: serializeRegistry(state.globalEvents),
    });
  }
  ```
  `SaveV13Schema.parse({...})` wrap matches the live `toSaveV12` shape at `schema.ts:1729` — runtime Zod validation guards against malformed emit payloads (defense-in-depth: every emit site validates against its own schema before write). No strip helper applied at live emit — `houses` ships with the live `HouseSchema` (which includes `courierResearchEarned`) and `globalEvents` ships directly via `serializeRegistry`. Future V14 demotion (next save bump) will switch `toSaveV13`'s version line to a literal `13` per the precedent above.

  **`fromSaveV13` live load function** (NEW at P13). Live load wrapper consumed by `dexie.ts:load()` and `SettingsMenu` import-replace. Mirrors the live `fromSaveV12` shape (extract `characters` + `artifactInstances` locals, invoke void-mutating `bootstrapNpcMountFamily`, construct GameState literal):
  ```ts
  // src/persist/schema.ts (NEW at P13):
  export function fromSaveV13(save: SaveV13): GameState {
    // V13 is the live format at P13. No Bare/wrap split (V13 has no migration
    // target yet — that comes at P14 demotion). Mirrors fromSaveV12's
    // extract-locals-then-mutate pattern for bootstrapNpcMountFamily (void).
    const characters = deserializeRegistry(save.characters) as GameState["characters"];
    const artifactInstances = deserializeRegistry(save.artifactInstances) as GameState["artifactInstances"];
    bootstrapNpcMountFamily(characters, artifactInstances, save.tick);  // mutates in place
    return {
      tick: save.tick,
      rng: deserializeRegistry(save.rng) as GameState["rng"],
      houses: deserializeRegistry(save.houses) as GameState["houses"],
      characters,
      marriages: deserializeRegistry(save.marriages) as GameState["marriages"],
      campaignName: save.campaignName,
      era: save.era,
      conversationHistory: deserializeRegistry(save.conversationHistory) as GameState["conversationHistory"],
      affectionMap: deserializeRegistry(save.affectionMap) as GameState["affectionMap"],
      schemes: deserializeRegistry(save.schemes) as GameState["schemes"],
      whispers: deserializeRegistry(save.whispers) as GameState["whispers"],
      couriers: deserializeRegistry(save.couriers) as GameState["couriers"],
      staff: deserializeRegistry(save.staff) as GameState["staff"],
      proposalsLog: deserializeRegistry(save.proposalsLog) as GameState["proposalsLog"],
      tutorAssignmentsLog: deserializeRegistry(save.tutorAssignmentsLog) as GameState["tutorAssignmentsLog"],
      pendingTutorTraitChoices: deserializeRegistry(save.pendingTutorTraitChoices) as GameState["pendingTutorTraitChoices"],
      patronesses: deserializeRegistry(save.patronesses) as GameState["patronesses"],
      rivalActors: deserializeRegistry(save.rivalActors) as GameState["rivalActors"],
      factionTensions: deserializeRegistry(save.factionTensions) as GameState["factionTensions"],
      duels: deserializeRegistry(save.duels) as GameState["duels"],
      elopement: save.elopement,
      artifactInstances,
      forgeries: deserializeRegistry(save.forgeries) as GameState["forgeries"],
      thiefAttempts: deserializeRegistry(save.thiefAttempts) as GameState["thiefAttempts"],
      // P13 ADDITION:
      globalEvents: deserializeRegistry(save.globalEvents) as GameState["globalEvents"],
    };
  }
  ```

- **Live consumer edits — `src/persist/dexie.ts`** (verified line numbers from grep against the live file). 8 in-file edits, all mechanical V12 → V13 substitutions:
  ```ts
  // src/persist/dexie.ts — P13 EDITS:

  // Line 25-27 — import block. BEFORE:
  //   type SaveV12,
  //   SaveV12Schema,
  //   toSaveV12,
  // AFTER:
  type SaveV13,
  SaveV13Schema,
  toSaveV13,

  // Line 39 — JSDoc comment. BEFORE:
  //   // P11: data widens to include SaveV12.
  // AFTER: // P13: data widens to include SaveV13.

  // Line 54 — data union. BEFORE: `| SaveV12;` → AFTER: `| SaveV13;`

  // Line 76-78 — save() body. BEFORE:
  //   // P11: toSaveV12 is the live emitter (was toSaveV11 pre-P11). Sync prep:
  //   const data = toSaveV12(state);
  // AFTER:
  // P13: toSaveV13 is the live emitter (was toSaveV12 pre-P13). Sync prep:
  const data = toSaveV13(state);

  // Line 83-87 — load() JSDoc. BEFORE: "SaveV12 final shape" → AFTER: "SaveV13 final shape"

  // Line 90 — load() signature. BEFORE:
  //   export async function load(slot: string): Promise<SaveV12 | undefined> {
  // AFTER:
  export async function load(slot: string): Promise<SaveV13 | undefined> {

  // Line 112 + 120 — Zod parse calls. BEFORE: `SaveV12Schema.parse(...)` (×2) → AFTER: `SaveV13Schema.parse(...)` (×2)
  ```

- **Live consumer edits — `src/ui/shared/SettingsMenu.tsx`** (verified live at lines 5, 45). 2 edits:
  ```ts
  // src/ui/shared/SettingsMenu.tsx — P13 EDITS:

  // Line 5 — import. BEFORE:
  //   import { fromSaveV12 } from "../../persist/schema";
  // AFTER:
  import { fromSaveV13 } from "../../persist/schema";

  // Line 45 — load callback. BEFORE:
  //   store.getState().replaceState(fromSaveV12(saved));
  // AFTER:
  store.getState().replaceState(fromSaveV13(saved));
  ```

- **Save-roundtrip test fixture extension** (`src/persist/save-roundtrip.test.ts` or equivalent — verify exact filename via grep). Existing test asserts V12 save round-trip; extend to V13. Test setup creates a non-empty `state.globalEvents` Map (one of each kind) + `state.houses[player].courierResearchEarned = true` + one character with `MilitaryOfficer` trait, calls `toSaveV13` → `SaveV13Schema.parse` → `fromSaveV13` → asserts deep equality with the original state.

- **Strip cascade for legacy emit.** The single new top-level `globalEvents` Map is OMITTED from every legacy `toSaveV{N}` for N < 13 by construction (the V1-V12 emit literals do not carry a `globalEvents` key). The new `House.courierResearchEarned` field uses Zod `.default(false)` for parse-time backfill, BUT round-trip byte-identity requires explicit strip on legacy emit. The strip helper follows the GENERIC pattern established by `stripEquippedArtifactsForLegacyEmit<T extends { equippedArtifactIds: unknown }>` at `src/persist/schema.ts:393` — generic over the input House-tuple value type so it composes cleanly with the existing strip cascade (`stripP11FieldsForLegacyEmit` returns `HousePreV12Pre11`; chaining requires either a generic outer strip or a type cast):
  ```ts
  // src/persist/schema.ts — NEW helper at ~line 280 (alongside stripP11FieldsForLegacyEmit).
  // Generic input type per the stripEquippedArtifactsForLegacyEmit precedent.
  function stripCourierResearchForLegacyEmit<T extends { courierResearchEarned: unknown }>(
    entries: ReadonlyArray<readonly [string, T]>,
  ): Array<[string, Omit<T, "courierResearchEarned">]> {
    return entries.map(([id, h]) => {
      const { courierResearchEarned: _c, ...rest } = h;
      return [id, rest];
    });
  }
  ```
  **Composition order at every legacy emit site (outer-most = most-recently-added P13 strip).** Resolution pick: **widen `stripP11FieldsForLegacyEmit`, `stripGrievancesForLegacyEmit`, `stripV6FieldsForLegacyEmit`, and `stripExiledForLegacyEmit` to GENERIC `<T extends {...}>`** matching the `stripEquippedArtifactsForLegacyEmit<T extends { equippedArtifactIds: unknown }>` precedent at `schema.ts:393`. The generic-widen path prevents future field-shape drift from being silently masked by a cast (a cast accepts any value-shaped tuple array; the generic enforces that the input actually carries the field being stripped). Concrete composition per emit target:
  - **`toSaveV12`** (V12 becomes legacy at P13): `stripCourierResearchForLegacyEmit(serializeRegistry(state.houses))` — input `Array<[string, House]>`, output `Array<[string, HousePreV13]>` (where `HousePreV13 = HouseSchema.omit({ courierResearchEarned: true })` — declared inline at P13 alongside `HousePreV12Pre11Schema`). Single strip; no chain.
  - **`toSaveV7..V11`**: chained `stripP11FieldsForLegacyEmit(stripCourierResearchForLegacyEmit(serializeRegistry(state.houses)))` — P13 strip runs first (outer); the now-generic `stripP11FieldsForLegacyEmit<T extends { siblingRivals: unknown; inheritedSecrets: unknown; bloodFeuds: unknown }>` accepts the post-P13-strip type and drops the P11 fields.
  - **`toSaveV2..V6`**: chained `stripGrievancesForLegacyEmit(stripCourierResearchForLegacyEmit(serializeRegistry(state.houses)))` or `stripV6FieldsForLegacyEmit(stripCourierResearchForLegacyEmit(serializeRegistry(state.houses)))` per the emit target's prior-phase requirements. Same generic-input pattern.
  - **`toSaveV1`**: no prior strip; `stripCourierResearchForLegacyEmit(serializeRegistry(state.houses))` outputs `Array<[string, HousePreV13]>` which subsequent V1-specific shape transforms consume.

  Twelve emit-site invocations total. `MilitaryOfficer` widening needs NO strip helper — `traits` is `z.array(TraitIdSchema)` and legacy saves cannot contain a `"MilitaryOfficer"` entry by construction (the trait didn't exist when those saves were written). Post-P13 saves CAN contain `"MilitaryOfficer"` in traits arrays; these round-trip through every emitter as raw strings. Forward-compat caveat: a hypothetical pre-P13 build trying to load a post-P13 save containing `"MilitaryOfficer"` would fail parse if `TraitIdSchema` was previously a `z.enum` with the closed set — accepted v1 behavior (greenfield, no installed-base concern).

  **`toSaveV12` demotion-to-legacy edit (load-bearing — without this, V12 saves silently corrupt on bump).** Live `toSaveV12` at `src/persist/schema.ts:1730` emits `version: SAVE_VERSION_CURRENT`. When P13 bumps the constant from `12` → `13`, this line silently writes V12 saves with `version: 13`, which fails `SaveV12Schema.parse` (`z.literal(12)`). Symmetric with the P10/P11 precedent (schema.ts:1495-1496 for V10 demotion, 1615-1616 for V11 demotion). Concrete edit:
  ```ts
  // src/persist/schema.ts — P13 EDIT to toSaveV12 (header comment + version literal):

  // BEFORE P13 (toSaveV12 was live):
  //   export function toSaveV12(state: GameState): SaveV12 {
  //     return {
  //       version: SAVE_VERSION_CURRENT,
  //       // ... 24 field emissions ...
  //     };
  //   }

  // AFTER P13 (V12 demoted to legacy):
  // V12 demoted from live → legacy at P13. Header comment updated; version
  // literal pinned to 12 (not SAVE_VERSION_CURRENT, which is now 13). Houses
  // strip applies stripCourierResearchForLegacyEmit per the cascade above.
  export function toSaveV12(state: GameState): SaveV12 {
    return SaveV12Schema.parse({
      version: 12,  // P13 literal pin (was SAVE_VERSION_CURRENT pre-P13)
      tick: state.tick,
      rng: serializeRegistry(state.rng),
      houses: stripCourierResearchForLegacyEmit(serializeRegistry(state.houses)),  // P13 strip
      // ... rest unchanged ...
    });
  }
  ```
  `SaveV12Schema.parse({...})` wrap preserves the live `toSaveV12` shape (was already present at `schema.ts:1729` pre-P13). Same wrap pattern applies to every `toSaveV{N<12}` legacy emitter — P13 makes no changes to the wrap discipline, only swaps the version literal and inserts the P13 strip-cascade chain.
  ONLY the new live `toSaveV13` references `SAVE_VERSION_CURRENT`. Every prior `toSaveV{N<13}` already uses the literal `version: N` per the same pattern.

- **`defaultHouseV4Fields` / `defaultHouseV6Fields` / `defaultHouseV7Fields` widening** (`src/persist/schema.ts:93/140/177`). After P13 widens `HouseSchema`, the `: House` return type annotation on each of these three lift helpers requires every literal-construction site to include `courierResearchEarned: false`. Strict-TS catches the omission at compile time. Concrete edit (single line per helper):
  ```ts
  // src/persist/schema.ts — P13 EDITS (3 sites, identical addition):

  // defaultHouseV4Fields at line 93 — append after the P11 ledger fields:
  function defaultHouseV4Fields(h: HousePreV4): House {
    return {
      ...h,
      // ... existing P3/P5/P6/P8/P11 defaults ...
      siblingRivals: [],
      inheritedSecrets: [],
      bloodFeuds: [],
      courierResearchEarned: false,  // P13 ADDITION
    };
  }

  // Same one-line addition in defaultHouseV6Fields (line 140) and
  // defaultHouseV7Fields (line 177). All three are pure literal constructors
  // called from V1/V2/V3 (V4Fields), V4/V5 (V6Fields), V6 (V7Fields) lift paths.
  ```
  The post-P11 `liftLegacyHousesFromV12Pre11` at schema.ts:293-306 also constructs House literals — verify the spread `...h` includes `courierResearchEarned` (it does NOT — the input type `HousePreV12Pre11` doesn't carry the field by construction). Add `courierResearchEarned: false` to the literal in this helper too.

- **`migrate_v12_to_v13` and lifter discipline.** Pure function `(SaveV12) → SaveV13` at `src/persist/migrations/v12-to-v13.ts`. Body follows the bare+wrap pattern. ZERO draws (additive shape transformation only):
  ```ts
  // src/persist/migrations/v12-to-v13.ts (NEW at P13):
  import { SaveV12Schema, SaveV13Schema, fromSaveV12Bare, toSaveV13 } from "../schema";
  import type { GlobalEvent } from "../../game/entities";
  import type { GlobalEventId } from "../../game/rng";  // branded ID home per CLAUDE.md convention

  export function migrate_v12_to_v13(save: SaveV12): SaveV13 {
    // Pure shape transformation — zero PRNG draws, zero seed helpers, zero
    // intermediate spreads. Mirrors the v11-to-v12 minimal precedent at
    // migrations/v11-to-v12.ts:15-17: `return toSaveV12(fromSaveV11Bare(save))`.
    // The new globalEvents Map is constructed empty INSIDE fromSaveV12Bare
    // (see the Bare-body snippet above) so the migration body needs no extra
    // step. House.courierResearchEarned defaults via Zod .default(false) inside
    // HouseSchema parse.
    return toSaveV13(fromSaveV12Bare(save));
  }
  ```
  **Effects:**
  - Adds `state.globalEvents` populated as an empty Map. No active global events on the post-migration tick.
  - Adds `courierResearchEarned: false` to every legacy `House` via the `.default(false)` Zod backfill (applied at SaveV12Schema parse time before the migration body runs — `fromSaveV12Bare`'s `deserializeRegistry<HouseId, House>(save.houses)` walks the live `HouseSchema` parser which carries the default).
  - **Draw budget: ZERO.** Pure shape transformation. Asserted in `v12-to-v13.test.ts`: `expect(migrate_v12_to_v13(save).rng).toEqual(save.rng)`.
  - **Idempotence assertion** ships in `src/persist/migrations/v12-to-v13.idempotence.test.ts` via the `assertMigrationIdempotent` helper from `src/persist/migrations/__test-utils__/idempotence.ts`.

- **`MIGRATIONS` registry extension** (`src/persist/migrations/index.ts`) — explicit top-level edit-list item per cross-plan "forgotten registry entry on save-format bump" guard. Concrete diff:
  ```ts
  // src/persist/migrations/index.ts — P13 EDIT (append one entry + the import):

  // BEFORE P13 (last entry — P12's v11→v12):
  //   import { migrate_v11_to_v12 } from "./v11-to-v12";
  //   ...
  //   export const MIGRATIONS: ReadonlyArray<MigrationStep> = [
  //     ...,
  //     { from: 11, to: 12, migrate: (s: unknown) => migrate_v11_to_v12(SaveV11Schema.parse(s)), outputSchema: SaveV12Schema },
  //   ];

  // AFTER P13:
  import { migrate_v12_to_v13 } from "./v12-to-v13";  // NEW import line
  // ...
  export const MIGRATIONS: ReadonlyArray<MigrationStep> = [
    ...,
    { from: 11, to: 12, migrate: (s: unknown) => migrate_v11_to_v12(SaveV11Schema.parse(s)), outputSchema: SaveV12Schema },
    // P13 ADDITION:
    { from: 12, to: 13, migrate: (s: unknown) => migrate_v12_to_v13(SaveV12Schema.parse(s)), outputSchema: SaveV13Schema },
  ];
  ```
  The `assertMonotonic(MIGRATIONS)` boot guard at `migrations/index.ts` enforces the ordering. Without this MIGRATIONS edit, the runner cannot apply v12→v13 (the `runMigrations(state, fromVersion, toVersion)` composition iterates the registry; a missing step produces `MissingMigrationStep` errors at load-time).

- **`fromSaveV12Bare` extraction + wrap refactor (resolves the new-legacy-format Bare/wrap split per the P10 / P11 demotion-to-legacy precedent).** Live `fromSaveV12` at `src/persist/schema.ts:1763` currently has NO Bare/wrap split because V12 was LIVE from P12 ship-date through pre-P13 (Bare splits exist for V4-V11 — each demoted to legacy at successive phase ships). V12 ships its Bare split as part of P13's demotion-to-legacy work.

  **CRITICAL — `bootstrapNpcMountFamily` is void-returning, NOT state-returning.** Verified live signature at `src/game/bootstrap.ts:282`:
  ```ts
  export function bootstrapNpcMountFamily(
    characters: Map<CharacterId, Character>,
    artifactInstances: Map<ArtifactInstanceId, ArtifactInstance>,
    tick: number,
  ): void  // ← mutates Maps in place; does NOT return GameState
  ```
  The live `fromSaveV12` pattern (schema.ts:1763-1801) extracts `characters` + `artifactInstances` to locals BEFORE the return literal, invokes the helper as a side-effecting statement, then constructs the GameState literal referencing those locals. P13's Bare/wrap refactor MUST preserve this pattern. Concrete diff:
  ```ts
  // src/persist/schema.ts — P13 EDITS (extract Bare from live V12, refactor wrap):

  // AFTER P13 — Bare body (pure deserialization; no NPC-mount seeding):
  export function fromSaveV12Bare(save: SaveV12): GameState {
    return {
      tick: save.tick,
      rng: deserializeRegistry(save.rng) as GameState["rng"],
      houses: deserializeRegistry(save.houses) as GameState["houses"],  // courierResearchEarned defaults via Zod .default(false)
      characters: deserializeRegistry(save.characters) as GameState["characters"],
      marriages: deserializeRegistry(save.marriages) as GameState["marriages"],
      campaignName: save.campaignName,
      era: save.era,
      conversationHistory: deserializeRegistry(save.conversationHistory) as GameState["conversationHistory"],
      affectionMap: deserializeRegistry(save.affectionMap) as GameState["affectionMap"],
      schemes: deserializeRegistry(save.schemes) as GameState["schemes"],
      whispers: deserializeRegistry(save.whispers) as GameState["whispers"],
      couriers: deserializeRegistry(save.couriers) as GameState["couriers"],
      staff: deserializeRegistry(save.staff) as GameState["staff"],
      proposalsLog: deserializeRegistry(save.proposalsLog) as GameState["proposalsLog"],
      tutorAssignmentsLog: deserializeRegistry(save.tutorAssignmentsLog) as GameState["tutorAssignmentsLog"],
      pendingTutorTraitChoices: deserializeRegistry(save.pendingTutorTraitChoices) as GameState["pendingTutorTraitChoices"],
      patronesses: deserializeRegistry(save.patronesses) as GameState["patronesses"],
      rivalActors: deserializeRegistry(save.rivalActors) as GameState["rivalActors"],
      factionTensions: deserializeRegistry(save.factionTensions) as GameState["factionTensions"],
      duels: deserializeRegistry(save.duels) as GameState["duels"],
      elopement: save.elopement,
      artifactInstances: deserializeRegistry(save.artifactInstances) as GameState["artifactInstances"],
      forgeries: deserializeRegistry(save.forgeries) as GameState["forgeries"],
      thiefAttempts: deserializeRegistry(save.thiefAttempts) as GameState["thiefAttempts"],
      // P13 ADDITION — Bare emits empty Map; wrap-half does NOT need a seed step
      // (globalEvents on legacy load = no active events, which is the correct semantic).
      globalEvents: new Map<GlobalEventId, GlobalEvent>(),
    };
  }

  // Public wrapper — preserves the live V12 "extract-locals-then-mutate" pattern
  // because bootstrapNpcMountFamily mutates Maps in place (void return).
  export function fromSaveV12(save: SaveV12): GameState {
    const characters = deserializeRegistry(save.characters) as GameState["characters"];
    const artifactInstances = deserializeRegistry(save.artifactInstances) as GameState["artifactInstances"];
    bootstrapNpcMountFamily(characters, artifactInstances, save.tick);  // mutates in place
    // Bare deserializes its own characters/artifactInstances Maps; OVERRIDE them
    // with the post-bootstrap locals (cheaper than re-deserializing inside Bare).
    return {
      ...fromSaveV12Bare(save),
      characters,
      artifactInstances,
      // globalEvents already empty Map from Bare; no override needed.
    };
  }
  ```
  `bootstrapNpcMountFamily` IS idempotent per its P12 contract (lines 290-294: skips when NPC already equips any mount-family instance). The migration runner via `migrate_v12_to_v13` does NOT invoke `bootstrapNpcMountFamily` — it only emits the empty `globalEvents` Map and lets the post-migration save's next load through `fromSaveV13` (when V13 becomes legacy) preserve the bootstrap-equip state. At P13 ship, the V12 → V13 migration is the LAST migration step; V13 is live, so the load-path uses a future `fromSaveV13` that handles its own seeding directly.

- **`fromSaveV1` through `fromSaveV11` public wrappers** + **V1-V3 single-function wrappers**: extend each to include `globalEvents: new Map()` in the GameState shape they produce. The edit shape is NOT uniform — V11/V10/V9 each have DIFFERENT wrap composition shapes (verified at schema.ts):
  - **`fromSaveV11(save)` (schema.ts:1689)** — delegates to Bare: `return fromSaveV11Bare(save)`. Add `globalEvents` INSIDE `fromSaveV11Bare` (the Bare body builds the GameState shape).
  - **`fromSaveV10(save)` (schema.ts:1569)** — composes one helper: `return bootstrapPlayerArtifactsForMigration(fromSaveV10Bare(save))`. Add `globalEvents` INSIDE `fromSaveV10Bare` (helper passes state through).
  - **`fromSaveV9(save)` (schema.ts:1446)** — composes + spreads: `return bootstrapPlayerArtifactsForMigration({ ...fromSaveV9Bare(save), elopement: null, artifactInstances: ..., forgeries: ..., thiefAttempts: ... })`. Add `globalEvents` to the spread literal OR inside `fromSaveV9Bare`.
  - **`fromSaveV4Bare`..`fromSaveV8Bare`** — symmetric to V10/V11 Bare bodies. Add `globalEvents: new Map()` to each Bare body.
  - **`fromSaveV1`/`fromSaveV2`/`fromSaveV3` (schema.ts:637/722/802)** — NO Bare/wrap split exists for these (V1-V3 are single-function wrappers). Add `globalEvents: new Map()` to each function's return literal directly.

  **Canonical edit pattern**: add `globalEvents: new Map<GlobalEventId, GlobalEvent>()` to whatever GameState-shaped literal each function produces (Bare body for V4-V11; public function body for V1-V3; new field in V12's Bare per the snippet above). 12 functions total need the edit — 11 single-line additions + the V12 refactor above. TS strict mode catches any miss at compile time.

- **`src/persist/migrations/v1-to-v13-chain.test.ts`** (NEW file — ADDED alongside the existing `v1-to-v{3,4,5,6,7,8,9,10,11,12}-chain.test.ts` files per the additive-chain-test convention pinned at P10): walks every legacy save through the full migration chain `(V1 → V2 → ... → V13)` and asserts the bootstrapped V13 state from `createInitialState(playerSeed)` equals the migrated V13 state byte-for-byte (same hash). Parity holds because P13 adds NO PRNG draws on either path (the trigger-roll is a tick-phase draw that only fires once `advanceTick` runs — `createInitialState` produces a tick=0 state that has not yet run any tick-phase). Per-step `outputSchema.parse(step.migrate(prev))` validation inside the chain test (P10 pin).

- **Schema↔projection↔selector↔overwriteFromGameState quad-sync + createInitialState (CLAUDE.md non-negotiable).** ONE new top-level GameState field trips the keyset extension test at `src/game/schema-projection-selector-extension.test.ts`. Required edits to ALL FIVE surfaces:
  1. `GameStateSchema` (`src/game/entities.ts`): append `globalEvents: z.map(GlobalEventIdSchema, GlobalEventSchema)` after the P10 `thiefAttempts` line.
  2. `hashableState` (`src/game/hash.ts`): extend the projection with `globalEvents: serializeRegistry(s.globalEvents)`. The Map serializes via `serializeRegistry` (matches P0 lex-sort discipline). Hash-relevant (no exclusion ledger entry; event start, expiry, and the cultural-pivot favored-family roll all advance the hash).
  3. `selectGameState` (`src/game/store.ts:2051+`): extend the selector with `globalEvents: s.globalEvents`.
  4. `overwriteFromGameState` (`src/game/store.ts:444+`): extend with `draft.globalEvents = next.globalEvents`. **Forgetting this fourth surface silently CLEARS the Map on every tick-advancing store action** per the CLAUDE.md `overwriteFromGameState` warning. Critical because `advanceTick` triggers `applyGlobalEventPhase` (slot 6) which mutates `state.globalEvents`; without the overwriteFromGameState write the new event entries get discarded on the very next set body.
  5. **`createInitialState` (`src/game/store.ts:140-225`)** — the fresh-state constructor builds a `GameState` literal; strict TS rejects any literal missing the new field. Concrete edit: append `globalEvents: new Map<GlobalEventId, GlobalEvent>()` to the return literal (no bootstrap seed helper — fresh state has no active events).
  - `src/game/store.replace-state.test.ts` gains ONE new `it(...)` block: seed a synthetic state with non-empty `globalEvents` (one of each kind), fire `replaceState(stateWithEvents)`, assert the Map survives AND that an immediately-following `advanceTick()` preserves the entries (verifies the `overwriteFromGameState` mirror write AND that `applyGlobalEventPhase`'s expire/start cycle reads the seeded events correctly).

- **New branded ID** (`src/game/rng.ts` — per CLAUDE.md "branded-string Zod schema homes" convention):
  ```ts
  // src/game/rng.ts — P13 ADDITION:
  export type GlobalEventId = string & { readonly __brand: "GlobalEventId" };
  export const GlobalEventIdSchema = z.string().transform((s) => s as GlobalEventId);
  ```
  Plus one deterministic-id factory per P6 precedent (`makeWhisperId` / `makeCourierPayloadId`). Declared in `src/game/rules/globalEvents.ts` (the rule module that creates events):
  ```ts
  // Index-counted via state-walk per the P6 deterministic-id pattern. Walks
  // existing globalEvents.values() to find the next index for the given kind.
  // NO Date.now() / Math.random() — pure function of state. Format:
  //   globalevent-WarEffort-0, globalevent-WarEffort-1, globalevent-MarketCrash-0, ...
  // (per-kind index so duplicate-kind skips don't perturb other-kind indices).
  export function makeGlobalEventId(state: GameState, kind: GlobalEventKind): GlobalEventId {
    let maxIdx = -1;
    for (const e of state.globalEvents.values()) {
      if (e.kind !== kind) continue;
      const idx = parseGlobalEventIndex(e.id, kind);
      if (idx > maxIdx) maxIdx = idx;
    }
    return `globalevent-${kind}-${maxIdx + 1}` as GlobalEventId;
  }
  ```
  The factory walks the LIVE state.globalEvents Map (not an accumulator) because `applyGlobalEventPhase` mints at most ONE event per tick (the 5% trigger roll fires once, picks one kind, and either spawns or skips). The per-iteration multi-Map accumulator pattern (P6) is therefore NOT needed — there is no inner loop spawning multiple events same-tick.

- **`GlobalEventSchema` discriminated union** (`src/game/entities.ts`). Lives alongside the P10 `ThiefAttemptSchema`:
  ```ts
  // src/game/entities.ts (P13 ADDITION):

  // Discriminated union by `kind`. Per spec §3 line 392, every active event
  // carries its absolute start and end ticks so save/load preserves lifecycle.
  // MonarchsMood uniquely carries the cultural-pivot favored-family rolled at
  // start (per spec line 391, "at start, a 'favored culture' (one of a small
  // fixed set) is rolled"). The "small fixed set" maps to ARTIFACT_FAMILIES
  // directly (user-resolved P13 design decision — see "Cultural-pivot favored-
  // family mapping" rationale below).
  export const GlobalEventSchema = z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("WarEffort"),
      id: GlobalEventIdSchema,
      startTick: z.number().int().nonnegative(),
      endTick: z.number().int().nonnegative(),
    }),
    z.object({
      kind: z.literal("MarketCrash"),
      id: GlobalEventIdSchema,
      startTick: z.number().int().nonnegative(),
      endTick: z.number().int().nonnegative(),
    }),
    z.object({
      kind: z.literal("MonarchsMood"),
      id: GlobalEventIdSchema,
      startTick: z.number().int().nonnegative(),
      endTick: z.number().int().nonnegative(),
      favoredFamily: z.enum(ARTIFACT_FAMILIES),  // imported from src/game/fixtures/artifacts.ts
    }),
  ]);
  export type GlobalEvent = z.infer<typeof GlobalEventSchema>;
  ```

- **`HouseSchema` widening** (`src/game/entities.ts:128-172` — append after `blockadeBypassEarned`):
  ```ts
  // src/game/entities.ts — HouseSchema P13 EDIT (append field):
  courierResearchEarned: z.boolean().default(false),
  ```
  `.default(false)` parses every legacy SaveV1-V12 `HouseSchema` payload cleanly. New code paths set the field explicitly in their House literal (the `.default(false)` is the legacy-parse safety net; explicit-in-source is preferred for new construction per the P8/P9 precedent).

  **Construction-site enumeration** (verified via `grep -rn 'blockadeBypassEarned' src/`). Each site that constructs a `House` literal needs `courierResearchEarned: false` added or TS strict-mode compilation fails:
  1. `src/game/bootstrap.ts:124` — player-house literal inside `createInitialState`'s seeded family bootstrap.
  2. `src/game/fixtures/npcs.ts:125` — `buildIndependentHouse` Independent-house seed (P4).
  3. `src/game/fixtures/rivals.ts:233` — `buildRivalHouse` rival-house factory (P8).
  4. `src/game/__test-utils__/factories.ts:110` — `makeHouse` test factory (used widely across the test suite).
  5. `src/game/rules/duel.test.ts:109` — inline test-fixture House literal.

  **Production schema lift paths**: the legacy lift helpers (`defaultHouseV4Fields` / `defaultHouseV6Fields` / `defaultHouseV7Fields` / `liftLegacyHousesFromV12Pre11`) DO need explicit `courierResearchEarned: false` additions in their returned-literal bodies (the `: House` return type forces it). Zod `.default(false)` covers parse-time backfill ONLY for paths that parse a raw save into `HouseSchema` directly; the lift helpers parse into `HousePreV4`/`PreV6`/`PreV7`/`PreV12Pre11` (which omit the field) and then construct a `House` literal — TS strict mode catches the missing key. See the "defaultHouseV*Fields widening" bullet above for the concrete edits.

- **`TRAITS` widening to 33 entries** (`src/game/fixtures/traits.ts`). Single-entry append matching the live `ReadonlyArray<{ id: TraitId; label: string }>` shape (verified at `src/game/fixtures/traits.ts:6` — the file is NOT a string-array; every entry is an object literal with `id` + `label`):
  ```ts
  // src/game/fixtures/traits.ts — P13 EDIT (append one entry to the 32-entry array):
  export const TRAITS: ReadonlyArray<{ id: TraitId; label: string }> = [
    // ... 32 existing entries unchanged ...
    { id: "Ascetic" as TraitId, label: "Ascetic" },
    // P13 ADDITION (entry #33):
    { id: "MilitaryOfficer" as TraitId, label: "Military Officer" },
  ];
  ```
  The derived `TRAITS_ALL: readonly TraitId[] = TRAITS.map((t) => t.id)` (live at `traits.ts:45`) auto-includes the new id; the persona-prompt consumer at `server/prompts/persona.ts:40` (`TRAIT_LABEL_BY_ID = new Map(TRAITS.map(t => [t.id, t.label]))`) auto-picks up the `"Military Officer"` label so any future officer-tagged character surfaces with the human-readable label in LLM persona prompts. Per CLAUDE.md "Persona prompt format version bump" pin, this is NOT a persona-prompt FORMAT change (the prompt template is unchanged — only a new entry in the existing trait-id-to-label Map); `PERSONA_CACHE_VERSION` STAYS at `"v4"`. A cache hit against a returning save that suddenly contains an officer character will still produce a coherent prompt because the persona-prompt body iterates the live trait array at build time.

  Module-load assertion is added paralleling the `SCHEME_KINDS` / `TACTICS` precedent:
  ```ts
  if (TRAITS.length !== 33) {
    throw new Error(
      `TRAITS length changed (${TRAITS.length} !== 33) without phase plan + (where needed) save-version bump`,
    );
  }
  ```
  `TraitId` (the inferred union type) auto-widens. Static-exhaustiveness consumers that must acknowledge the new value:
  - **Trait-pool fixtures** (`src/game/fixtures/npcs.ts` baseline-NPC trait sampler, `src/game/fixtures/archetypes.ts` archetype-classification rules, `src/game/fixtures/traits.ts` finishing-school grants, the consecutive-tick `Country → Rustic` rule, conception inheritance, artifact-granted traits) — the new trait is NOT included in ANY of these acquisition paths at P13 ship. Verified: `ARCHETYPE_MATURATION_TRAIT_POOL` (`fixtures/archetypes.ts:74`) ships 2-trait pairs for Spymaster/BohemianRake/Tutor/CountryExile/None — none cover `MilitaryOfficer`. `FINISHING_SCHOOL_TRAIT_MAP` (`constants.ts:68`) grants only `Sophisticated`/`Polyglot`. No conception or artifact path grants it either.

    **Design intent: `MilitaryOfficer` ships at v1 as wired-but-inert scaffolding.** The trait exists in `TRAITS`, threads through every consumer (Character, persona, save round-trip), and gates the WarEffort officer-death + WarEffort × Seduction multiplier rule branches — BUT no v1 acquisition path produces an officer-tagged character. The mechanics fire ZERO times across a v1 campaign. Rationale: shipping the scaffolding (trait + rule branches + tests) at v1 means the gameplay surface activates trivially when a later phase introduces the acquisition path (e.g., P16's procedural NPC widening, or a v1.5 phase that adds a `MilitaryAcademy` location or `OfficerCommission` scheme). Without P13 shipping the scaffolding now, that later phase would also need to bump SAVE_VERSION_CURRENT to widen `TRAITS` AND wire the rule branches AND bump persona cache. By shipping inert at v1, the acquisition-path phase becomes a single-table edit.

    **Verification matrix #4 / #14 / #30 acknowledge this**: tests EXPLICITLY seed officer-tagged characters via `traits: [..., "MilitaryOfficer" as TraitId]` literal in their fixtures to exercise the death-roll and Seduction-multiplier paths. This is the ONLY production-shape way to surface a `MilitaryOfficer`-tagged character at v1 (no live code produces one). Pin this in the test plan so the test suites don't pass vacuously.

    Bootstrap inventory + every legacy lift starts with ZERO `MilitaryOfficer`-tagged characters by construction.
  - **`CONVERSATION_TRAIT_BONUSES`** + **`CONVERSATION_TRAIT_PENALTIES`** — same pattern: no `MilitaryOfficer`-keyed entry. The trait does NOT modulate ballroom-combat tactic outcomes at P13 (would re-introduce orthogonal mood/tactic interactions and contradict the "officer hits WarEffort-Seduction multiplier and per-tick death-roll" scope).
  - **Acquisition paths** — NONE at P13 ship. The "wired-but-inert" design-intent pin above is binding: `MilitaryOfficer` is NOT added to `ARCHETYPE_MATURATION_TRAIT_POOL` (`fixtures/archetypes.ts:74`), NOT in `FINISHING_SCHOOL_TRAIT_MAP` (`constants.ts:68`), NOT a location-grant target, NOT in any conception or artifact path. Acquisition-path additions are explicitly OUT of scope for P13 (see "Out of scope" section — deferred to v1.5).

- **New constants (`src/game/constants.ts`).** Twelve entries grouped into a new `// ── Global Events & Era (P13) ──...` section. Per CLAUDE.md "Designer constants in one place" non-negotiable, NUMERIC tunings live in `constants.ts` but IDENTITIES (event kinds via `GLOBAL_EVENT_KINDS`) live alongside the type union (rule-module-local for the per-phase identity register, exported for shared consumption):
  ```ts
  // src/game/constants.ts — P13 ADDITIONS (append after P12 promenade section):

  // ── Global Events & Era (P13) ─────────────────────────────────────────────
  // Spec §3 "Global Events" (lines 386-392) + "Era Progression" (lines 394-398)
  // + §7 line 658 "Cultural-pivot Monarch's Mood against no-artifact house"
  // (negative-surge-branch suppression pin). Pure designer constants; tune via
  // playtest. The 5%/tick trigger is the spec line 388 value verbatim. WarEffort
  // and MarketCrash duration deltas track spec line 389 verbatim. WarEffort
  // officer-death and MonarchsMood favored-family surge values are NEW tuning
  // (spec only specifies "small per-tick chance of dying" + "fixed per-tick
  // reputation surge" — concrete numbers ship per the P13 design decisions).

  export const GLOBAL_EVENT_TRIGGER_PROBABILITY_BASIS_POINTS = 500;  // 5%/tick; spec line 388
  // Probability stored as basis points (× 10000) per CLAUDE.md P6 pin —
  // engine-stable integer comparison via Math.floor(roll * 10000) < threshold.

  // WarEffort (spec line 389-390: 10 ticks, +1 reputation, -2 wealth per tick)
  export const WAR_EFFORT_DURATION_TICKS = 10;
  export const WAR_EFFORT_REPUTATION_PER_TICK = 1;     // applied to EVERY house
  export const WAR_EFFORT_WEALTH_PER_TICK = -2;        // applied to EVERY house
  export const WAR_EFFORT_OFFICER_DEATH_PROBABILITY_BASIS_POINTS = 100;
  //   ↑ 1%/tick per MilitaryOfficer character. Across a 10-tick WarEffort,
  //   expected death rate per officer ≈ 9.6% (1 - 0.99^10). At v1 cohort
  //   sizes (0-2 officers per house once the trait propagates via tutor
  //   paths), this is one casualty per ~5 WarEffort events on average.
  //   Death follows the canonical pruneOrphanedConversationKeys cascade.
  export const WAR_EFFORT_SEDUCTION_AFFECTION_MULTIPLIER = 1.5;
  //   ↑ Multiplies the success-branch affection delta (SEDUCTION_AFFECTION_DELTA_ON_SUCCESS = 80)
  //   for MilitaryOfficer aggressors only, while a WarEffort is active.
  //   Discovery-roll probability is NOT modified — positive-outcome buff only
  //   (uniforms-and-glory framing). Composes into resolveSeduction; the v1.5
  //   P15 dynasty-seduction-perk hook will compose in the same way.

  // MarketCrash (spec line 389: 5 ticks, -3 wealth per tick)
  export const MARKET_CRASH_DURATION_TICKS = 5;
  export const MARKET_CRASH_WEALTH_PER_TICK = -3;      // applied to EVERY house

  // MonarchsMood (spec line 389 + 391: 5 ticks; favored-family rolled at start)
  export const MONARCHS_MOOD_DURATION_TICKS = 5;
  export const MONARCHS_MOOD_FAVORED_FAMILY_REPUTATION_SURGE_PER_TICK = 2;
  //   ↑ Per-tick rep surge for houses with ≥1 equipped artifact whose family
  //   matches the event's favoredFamily. +2 keeps the surge meaningful (a
  //   full MonarchsMood cycle = +10 rep) without trivializing the existing
  //   reputation ladder. The match check iterates every alive character in
  //   the house — matches the "any house with at least one equipped artifact"
  //   spec framing (vs head-only).
  export const MONARCHS_MOOD_SNUB_SCANDAL_PER_TICK = 1;
  //   ↑ Per-tick scandal hit for houses WITHOUT a matching equipped artifact.
  //   Spec §7 line 658 pin: no-match branch is +1 scandal ONLY; the cultural-
  //   surge branch must NOT fire negatively (no scandal doubling, no penalty
  //   stacking). Implementation gates the surge-branch entry on "house has at
  //   least one matching equipped artifact"; the snub-branch fires in the
  //   else-arm — the two branches are mutually exclusive per-house.

  // Later-era courier research (spec line 397-398)
  export const COURIER_RESEARCH_WEALTH_COST = 30;
  //   ↑ One-shot wealth cost to unlock fast couriers. Mirrors mid-range scheme
  //   costs (Smuggling=20, Sabotage=30). Halves NEW courier transit times only;
  //   in-flight couriers retain their absolute arrivalTick (the absolute-end-tick
  //   discipline per CLAUDE.md non-negotiable §2 — past commitments don't retro-
  //   adjust). Floor of 1 tick per the spec "floor 1" framing.

  // ERA_TRANSITION_TICK already declared at constants.ts:395 (P3 reservation; P13
  // makes live). Value stays at 200 ≈ 10 in-game years at ~20 ticks/year.

  // Identity register (per CLAUDE.md identities-in-fixtures convention; lives
  // alongside the type union in the rule module, exported via fixtures barrel):
  // see src/game/rules/globalEvents.ts:GLOBAL_EVENT_KINDS for the canonical
  // 3-entry frozen array + module-load assertion (parallels SCHEME_KINDS).
  ```

- **New rule module `src/game/rules/globalEvents.ts`.** Pure-rules layer; same import restrictions as other rules. Single exported entry point `applyGlobalEventPhase` + the `GlobalEventKind` identity register + module-private sub-functions. Composes era-flip → active-event tick effects → expiry → trigger roll in that order:
  ```ts
  // src/game/rules/globalEvents.ts (NEW at P13):
  import {
    COURIER_RESEARCH_WEALTH_COST,
    ERA_TRANSITION_TICK,
    GLOBAL_EVENT_TRIGGER_PROBABILITY_BASIS_POINTS,
    MARKET_CRASH_DURATION_TICKS,
    MARKET_CRASH_WEALTH_PER_TICK,
    MONARCHS_MOOD_DURATION_TICKS,
    MONARCHS_MOOD_FAVORED_FAMILY_REPUTATION_SURGE_PER_TICK,
    MONARCHS_MOOD_SNUB_SCANDAL_PER_TICK,
    WAR_EFFORT_DURATION_TICKS,
    WAR_EFFORT_OFFICER_DEATH_PROBABILITY_BASIS_POINTS,
    WAR_EFFORT_REPUTATION_PER_TICK,
    WAR_EFFORT_WEALTH_PER_TICK,
  } from "../constants";
  // NOTE: NO MIN/MAX clamp-bound constants exist for wealth/rep/scandal.
  // Established codebase pattern (verified at economy.ts:60-62, whispers.ts,
  // schemes.ts:571): reputation + scandal use literal `clamp(value, 0, 100)`;
  // wealth is UNBOUNDED (z.number() on HouseSchema, can go arbitrarily
  // negative — bankruptcy tier "Ruined" is wealth <= -500 per economy.ts).
  // Wealth deltas are added WITHOUT clamping; rep/scandal deltas use literals.
  import type { GameState, GlobalEvent, House } from "../entities";  // GlobalEvent schema home is entities.ts
  import { ARTIFACT_FAMILIES, ARTIFACT_REGISTRY, type ArtifactFamily } from "../fixtures/artifacts";
  import {
    type CharacterId,
    type GlobalEventId,  // branded ID home per CLAUDE.md "branded-string Zod schema homes" convention
    type HouseId,
    PLAYER_HOUSE_ID,
    drawInt,
    drawNext,
    getOrThrow,  // for state.rng lookup (typed `Map<HouseId, RngState>` at rng.ts:179)
  } from "../rng";
  import type { TraitId } from "../rng";  // for "MilitaryOfficer" as TraitId casts below
  import { pruneOrphanedConversationKeys } from "./aging";
  import { clamp } from "../util/clamp";

  // ── Identity register ────────────────────────────────────────────────────

  export const GLOBAL_EVENT_KINDS = ["WarEffort", "MarketCrash", "MonarchsMood"] as const;
  export type GlobalEventKind = (typeof GLOBAL_EVENT_KINDS)[number];

  if (GLOBAL_EVENT_KINDS.length !== 3) {
    throw new Error(
      `GLOBAL_EVENT_KINDS length changed (${GLOBAL_EVENT_KINDS.length} !== 3) without phase plan + (where needed) save-version bump`,
    );
  }

  // ── Deterministic ID factory ─────────────────────────────────────────────

  export function makeGlobalEventId(state: GameState, kind: GlobalEventKind): GlobalEventId {
    let maxIdx = -1;
    for (const e of state.globalEvents.values()) {
      if (e.kind !== kind) continue;
      const tail = e.id.slice(`globalevent-${kind}-`.length);
      const idx = parseInt(tail, 10);
      if (!Number.isFinite(idx)) {
        throw new Error(`makeGlobalEventId: malformed id "${e.id}" for kind ${kind}`);
      }
      if (idx > maxIdx) maxIdx = idx;
    }
    return `globalevent-${kind}-${maxIdx + 1}` as GlobalEventId;
  }

  // ── Phase entry point ────────────────────────────────────────────────────

  // Composes era-flip → per-tick effects of active events → expiry → 5%/tick
  // trigger roll. Order is load-bearing:
  //   1. Era flip MUST come first so any cultural-pivot active event sees the
  //      post-flip era (event behavior is era-agnostic but consumers like the
  //      travel.ts gate read state.era — phase order keeps cross-rule reads
  //      consistent within the tick).
  //   2. Active-event effects run BEFORE expiry so an event applies its final
  //      tick on the tick === endTick boundary, then expires. Without this
  //      ordering, an event spawned at tick=100 with endTick=110 would apply
  //      effects at ticks 100..109 only — 10 ticks of effects vs spec's
  //      duration framing (start tick is inclusive of effects).
  //   3. Trigger roll runs LAST so a newly-spawned event does NOT apply its
  //      first-tick effects on the spawn tick (effects begin next tick).
  //      Without this ordering, a same-tick spawn-and-apply would silently
  //      double-count the first tick.
  export function applyGlobalEventPhase(state: GameState): GameState {
    let acc = maybeFlipEra(state);
    acc = applyActiveEventTickEffects(acc);
    acc = expireFinishedEvents(acc);
    acc = maybeFireNewEvent(acc);
    return acc;
  }

  // ── Era transition (one-shot at threshold) ──────────────────────────────

  // Pure. Reads state.tick and state.era; mutates state.era only. Single
  // mutation; no RNG consumption.
  function maybeFlipEra(state: GameState): GameState {
    if (state.era === "Earlier" && state.tick >= ERA_TRANSITION_TICK) {
      return { ...state, era: "Later" };
    }
    return state;
  }

  // ── Per-tick effects of active events ───────────────────────────────────

  function applyActiveEventTickEffects(state: GameState): GameState {
    // Iterate events in lex-sorted id order so determinism holds across
    // arbitrary insertion sequences. At v1 only one event of each kind can
    // be active simultaneously (duplicate-kind skip in maybeFireNewEvent),
    // so max 3 iterations.
    const sortedEvents = [...state.globalEvents.values()].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    let acc = state;
    for (const event of sortedEvents) {
      switch (event.kind) {
        case "WarEffort":
          acc = applyWarEffortTick(acc);
          break;
        case "MarketCrash":
          acc = applyMarketCrashTick(acc);
          break;
        case "MonarchsMood":
          acc = applyMonarchsMoodTick(acc, event.favoredFamily);
          break;
      }
    }
    return acc;
  }

  // WarEffort per-tick: +1 rep / -2 wealth on EVERY house (player + rivals +
  // Independent), then per-officer death roll. Reputation clamped at mutation
  // site per CLAUDE.md "Clamp at every mutation site" non-negotiable.
  // Wealth is INTENTIONALLY UNCLAMPED — matches the economy.ts:60 precedent
  // (bankruptcy tier "Ruined" requires wealth <= -500; clamping at a min
  // would mask the tier transition).
  //
  // NOTE: RIVAL_HOUSE_IDS_SET intentionally NOT consulted — rivals participate
  // in macro-economic pressure (per the user-resolved P13 design decision
  // "all houses get hit"). Future refactor should NOT add a rival-skip gate
  // here without revising the design decision.
  function applyWarEffortTick(state: GameState): GameState {
    // House-wide deltas first (no RNG).
    const newHouses = new Map<HouseId, House>();
    for (const [id, h] of state.houses) {
      newHouses.set(id, {
        ...h,
        reputation: clamp(h.reputation + WAR_EFFORT_REPUTATION_PER_TICK, 0, 100),
        wealth: h.wealth + WAR_EFFORT_WEALTH_PER_TICK,  // UNCLAMPED — see header note
      });
    }
    let acc: GameState = { ...state, houses: newHouses };

    // Officer death roll. Lex-sorted (houseId outer, characterId inner) per
    // CLAUDE.md "Lex-sort iteration over identifier Maps" non-negotiable.
    // Single rng stream (PLAYER_HOUSE_ID per the canonical campaign-wide draw
    // pool — per-house officer death is determined by the player-house seeded
    // stream same as forgery surfacing / thief notice / global-event trigger).
    const sortedHouseIds = [...acc.houses.keys()].sort((a, b) => a.localeCompare(b));
    let nextRng = getOrThrow(acc.rng, PLAYER_HOUSE_ID);
    const newlyDead = new Set<CharacterId>();
    for (const houseId of sortedHouseIds) {
      const charIdsInHouse = [...acc.characters.values()]
        .filter((c) => c.houseId === houseId && c.alive && c.traits.includes("MilitaryOfficer" as TraitId))
        .map((c) => c.id)
        .sort((a, b) => a.localeCompare(b));
      for (const charId of charIdsInHouse) {
        const { next: roll, rngState: r } = drawNext(nextRng);
        nextRng = r;
        if (Math.floor(roll * 10000) < WAR_EFFORT_OFFICER_DEATH_PROBABILITY_BASIS_POINTS) {
          newlyDead.add(charId);
        }
      }
    }
    acc = { ...acc, rng: new Map(acc.rng).set(PLAYER_HOUSE_ID, nextRng) };

    if (newlyDead.size === 0) {
      return acc;  // RNG advanced (per-officer rolls always burn), no deaths
    }

    // Flip alive=false then route through the canonical death-cascade helper.
    // Per CLAUDE.md "Every caller of pruneOrphanedConversationKeys MUST flip
    // Character.alive = false BEFORE invoking" pin.
    const newChars = new Map(acc.characters);
    for (const id of newlyDead) {
      const c = newChars.get(id);
      if (c === undefined) continue;  // unreachable — id came from the iteration above; defense-in-depth
      newChars.set(id, { ...c, alive: false });
    }
    return pruneOrphanedConversationKeys(
      { ...acc, characters: newChars },
      newlyDead,
    );
  }

  // MarketCrash per-tick: -3 wealth on EVERY house. No RNG. No deaths.
  // Wealth UNCLAMPED per the WarEffort header note.
  // NOTE: RIVAL_HOUSE_IDS_SET intentionally NOT consulted (same rationale as
  // applyWarEffortTick — rivals participate in macro-economic pressure).
  function applyMarketCrashTick(state: GameState): GameState {
    const newHouses = new Map<HouseId, House>();
    for (const [id, h] of state.houses) {
      newHouses.set(id, {
        ...h,
        wealth: h.wealth + MARKET_CRASH_WEALTH_PER_TICK,  // UNCLAMPED
      });
    }
    return { ...state, houses: newHouses };
  }

  // MonarchsMood per-tick: per-house, check if any alive character equips an
  // artifact whose family matches favoredFamily. Match → +2 rep surge; no
  // match → +1 scandal. Per §7 line 658 pin, no-match branch is +1 scandal
  // ONLY (no doubling, no negative-surge branch). No RNG.
  //
  // NOTE: RIVAL_HOUSE_IDS_SET intentionally NOT consulted — rivals ship with
  // equippedArtifactIds: [] (fixtures/rivals.ts:212) at v1, so they hit the
  // snub branch on every tick of every MonarchsMood. Intentional macro-
  // pressure pin per the [C2] R27 design call (rivals carry +1 scandal/tick
  // pressure same as the player). Out-of-scope for P13: a rival-only artifact
  // bootstrap path; intent revisit at v1.5 if rivals become too brittle.
  function applyMonarchsMoodTick(state: GameState, favoredFamily: ArtifactFamily): GameState {
    const newHouses = new Map<HouseId, House>();
    for (const [houseId, h] of state.houses) {
      if (houseHasFamilyEquipped(state, houseId, favoredFamily)) {
        newHouses.set(houseId, {
          ...h,
          reputation: clamp(
            h.reputation + MONARCHS_MOOD_FAVORED_FAMILY_REPUTATION_SURGE_PER_TICK,
            0,
            100,
          ),
        });
      } else {
        newHouses.set(houseId, {
          ...h,
          scandal: clamp(h.scandal + MONARCHS_MOOD_SNUB_SCANDAL_PER_TICK, 0, 100),
        });
      }
    }
    return { ...state, houses: newHouses };
  }

  // Read-side projection. Iterates alive characters in the house and returns
  // true on the first equipped artifact whose definition.family matches.
  // Pure; no state mutation; no RNG.
  export function houseHasFamilyEquipped(
    state: GameState,
    houseId: HouseId,
    family: ArtifactFamily,
  ): boolean {
    for (const c of state.characters.values()) {
      if (c.houseId !== houseId) continue;
      if (!c.alive) continue;
      for (const instId of c.equippedArtifactIds) {
        const inst = state.artifactInstances.get(instId);
        if (inst === undefined) continue;
        const def = ARTIFACT_REGISTRY.get(inst.definitionId);
        if (def === undefined) continue;
        if (def.family === family) return true;
      }
    }
    return false;
  }

  // ── Expiry ──────────────────────────────────────────────────────────────

  // Events whose endTick is <= state.tick are dropped (drop predicate uses
  // <=, NOT <). Combined with the apply-before-expire ordering above, this
  // yields EXACTLY `DURATION_TICKS` effect applications per event:
  //
  //   Example: WarEffort spawned at tick=100 with endTick=100+10=110.
  //   - Tick 100: trigger-roll spawns the event LAST in slot 6; no effects this tick.
  //   - Tick 101: active-effects applies (#1). Expire: 110 <= 101 → false → keep.
  //   - ...
  //   - Tick 110: active-effects applies (#10). Expire: 110 <= 110 → TRUE → drop.
  //   - Tick 111: event no longer in Map; no apply.
  //   - Total: 10 effect applications across ticks 101-110 (matches spec
  //     "WarEffort lasts 10 ticks" framing — 10 applications, 10-tick lifespan).
  //
  // The <= predicate (vs <) is the load-bearing choice that resolves the
  // off-by-one: with <, the tick=110 apply would precede expiry-at-tick=111
  // and yield 11 applications across 10 ticks. Pinned by verification matrix #9.
  function expireFinishedEvents(state: GameState): GameState {
    let changed = false;
    const newEvents = new Map<GlobalEventId, GlobalEvent>();
    for (const [id, e] of state.globalEvents) {
      if (e.endTick <= state.tick) {
        changed = true;
        continue;  // drop
      }
      newEvents.set(id, e);
    }
    return changed ? { ...state, globalEvents: newEvents } : state;
  }

  // ── Trigger roll (5%/tick) ──────────────────────────────────────────────

  // Per CLAUDE.md "Cooldown burns on ALL outcomes (P8)" — the trigger roll
  // burns ONE player-rng draw every single tick regardless of outcome. This
  // is the only per-tick UNCONDITIONAL draw in the game (P10 forgery / thief
  // rolls are conditional on registry-entry existence). Tests pin the
  // draw-count contract.
  function maybeFireNewEvent(state: GameState): GameState {
    const playerRng = getOrThrow(state.rng, PLAYER_HOUSE_ID);
    const { next: triggerRoll, rngState: r1 } = drawNext(playerRng);

    // No-event path: commit the trigger-roll draw and return.
    if (Math.floor(triggerRoll * 10000) >= GLOBAL_EVENT_TRIGGER_PROBABILITY_BASIS_POINTS) {
      return { ...state, rng: new Map(state.rng).set(PLAYER_HOUSE_ID, r1) };
    }

    // Pick event kind (uniform across GLOBAL_EVENT_KINDS — 3 entries).
    const { next: kindIdx, rngState: r2 } = drawInt(r1, GLOBAL_EVENT_KINDS.length);
    const candidateKind = GLOBAL_EVENT_KINDS[kindIdx];
    if (candidateKind === undefined) {
      // ts noUncheckedIndexedAccess defense — unreachable.
      throw new Error(`maybeFireNewEvent: drawInt returned out-of-range index ${kindIdx}`);
    }

    // Duplicate-type skip per spec line 388. Burns the kind-pick draw but
    // NOT a favored-family draw (the favored-family roll is gated on a
    // successful spawn — otherwise idle MonarchsMood-blocked ticks would
    // silently advance the rng more than active ticks).
    const alreadyActive = [...state.globalEvents.values()].some((e) => e.kind === candidateKind);
    if (alreadyActive) {
      return { ...state, rng: new Map(state.rng).set(PLAYER_HOUSE_ID, r2) };
    }

    // Mint the event. MonarchsMood needs a third draw for favored-family.
    let event: GlobalEvent;
    let finalRng = r2;
    if (candidateKind === "MonarchsMood") {
      const { next: famIdx, rngState: r3 } = drawInt(r2, ARTIFACT_FAMILIES.length);
      finalRng = r3;
      const favoredFamily = ARTIFACT_FAMILIES[famIdx];
      if (favoredFamily === undefined) {
        throw new Error(`maybeFireNewEvent: drawInt returned out-of-range family index ${famIdx}`);
      }
      event = {
        kind: "MonarchsMood",
        id: makeGlobalEventId(state, "MonarchsMood"),
        startTick: state.tick,
        endTick: state.tick + MONARCHS_MOOD_DURATION_TICKS,
        favoredFamily,
      };
    } else if (candidateKind === "WarEffort") {
      event = {
        kind: "WarEffort",
        id: makeGlobalEventId(state, "WarEffort"),
        startTick: state.tick,
        endTick: state.tick + WAR_EFFORT_DURATION_TICKS,
      };
    } else {
      // MarketCrash
      event = {
        kind: "MarketCrash",
        id: makeGlobalEventId(state, "MarketCrash"),
        startTick: state.tick,
        endTick: state.tick + MARKET_CRASH_DURATION_TICKS,
      };
    }

    const newEvents = new Map(state.globalEvents);
    newEvents.set(event.id, event);
    return {
      ...state,
      globalEvents: newEvents,
      rng: new Map(state.rng).set(PLAYER_HOUSE_ID, finalRng),
    };
  }

  // ── Courier-research action (pure rule, called from store wrapper) ──────

  export type ResearchFastCouriersRejection =
    | { kind: "PlayerExiled" }
    | { kind: "ElopementInProgress" }
    | { kind: "EraNotYetLater" }
    | { kind: "AlreadyResearched" }
    | { kind: "InsufficientWealth"; have: number; need: number };

  // Free-action pure rule (no tick advance). Caller (store wrapper) composes
  // modal-state gates → this rule → overwriteFromGameState → direct-publish.
  export function applyResearchFastCouriers(
    state: GameState,
  ): { ok: true; nextState: GameState } | { ok: false; reason: ResearchFastCouriersRejection } {
    const player = state.houses.get(PLAYER_HOUSE_ID);
    if (player === undefined || player.exiled) {
      return { ok: false, reason: { kind: "PlayerExiled" } };
    }
    if (state.elopement !== null) {
      return { ok: false, reason: { kind: "ElopementInProgress" } };
    }
    if (state.era !== "Later") {
      return { ok: false, reason: { kind: "EraNotYetLater" } };
    }
    if (player.courierResearchEarned) {
      return { ok: false, reason: { kind: "AlreadyResearched" } };
    }
    if (player.wealth < COURIER_RESEARCH_WEALTH_COST) {
      return {
        ok: false,
        reason: { kind: "InsufficientWealth", have: player.wealth, need: COURIER_RESEARCH_WEALTH_COST },
      };
    }
    // Deduct wealth + flip the latch. Per CLAUDE.md "Action gating is atomic"
    // — validation above, deduction here, no partial paths.
    const newHouses = new Map(state.houses);
    newHouses.set(PLAYER_HOUSE_ID, {
      ...player,
      // Wealth UNCLAMPED — the InsufficientWealth precondition above guarantees
      // player.wealth >= COURIER_RESEARCH_WEALTH_COST, so the subtraction is
      // always >= 0. No need to clamp at the high end either (wealth is unbounded
      // per HouseSchema).
      wealth: player.wealth - COURIER_RESEARCH_WEALTH_COST,
      courierResearchEarned: true,
    });
    return { ok: true, nextState: { ...state, houses: newHouses } };
  }
  ```

- **Orchestrator slot 6 wire-up (`src/runtime/tickOrchestrator.ts`).** Replace the `identityPhase` stub with `applyGlobalEventPhase`. PHASES count stays at 14. Concrete diff:
  ```ts
  // src/runtime/tickOrchestrator.ts — P13 EDIT:

  // BEFORE P13:
  //   import { identityPhase } from "./identityPhase";  // P1 stub
  //   const PHASES = [
  //     advanceTickPhase,           // 1
  //     applyEconomyPhase,          // 2
  //     ...
  //     applySchemeResolutionPhase, // 5
  //     identityPhase,              // 6. global-event roll (P1 stub)
  //     applyMoodDriftPhase,        // 7
  //     ...
  //   ] as const;

  // AFTER P13:
  import { applyGlobalEventPhase } from "../game/rules/globalEvents";
  const PHASES = [
    advanceTickPhase,           // 1
    applyEconomyPhase,          // 2
    applyLocationEffectsPhase,  // 3
    applyCourierAndStaffPhase,  // 4
    applySchemeResolutionPhase, // 5
    applyGlobalEventPhase,      // 6. global-event roll + era transition (P13)
    applyMoodDriftPhase,        // 7
    applyHappinessPhase,        // 8
    applyPatronessErosionPhase, // 9
    applyForgerySurfacingPhase, // 10
    applyThiefNoticePhase,      // 11
    applySiblingRivalActionPhase, // 12
    applyInheritedSecretSurfacingPhase, // 13
    applyRivalActionPhase,      // 14. ALWAYS LAST
  ] as const;
  ```
  The inline `function identityPhase(state: GameState): GameState { return state; }` at `src/runtime/tickOrchestrator.ts:34-36` is REMOVED (it is NOT a separate file — verified at the live source). The slot-6 array entry switches to `applyGlobalEventPhase` via the new import from `../game/rules/globalEvents`. Test-side `phaseOrderTracker` (verifies "rivals always run last" via function-reference identity at the terminal slot — per CLAUDE.md P7 pin) continues to pass because `applyRivalActionPhase` stays at the terminal slot. A new Vitest assertion at `src/runtime/tickOrchestrator.test.ts` verifies `applyGlobalEventPhase` occupies slot 6 (function-reference identity check, NOT numeric-index check per the same P7 pin convention).

- **Seduction multiplier composition (`src/game/rules/schemes.ts:567-573` — the success-branch affection write inside the `else` arm of the `if (discovered)` branch; verified live).** Extend `resolveSeduction` to read `state.globalEvents` for an active WarEffort, check the aggressor's `MilitaryOfficer` trait, and multiply the success-branch affection delta. Discovery-branch logic (lines 533-565) is UNCHANGED — the multiplier is positive-outcome-only per the design pin. Concrete diff:
  ```ts
  // src/game/rules/schemes.ts — P13 EDIT to resolveSeduction success branch:

  // BEFORE P13 (success branch):
  //   // ... discovery check failed; apply success affection ...
  //   const newAffection = new Map(state.affectionMap);
  //   const pairKey = makePairKey(scheme.targetCharacterId, scheme.aggressorCharacterId);
  //   const current = newAffection.get(pairKey) ?? 0;
  //   newAffection.set(pairKey, clamp(current + SEDUCTION_AFFECTION_DELTA_ON_SUCCESS, 0, 100));

  // AFTER P13:
  // P13: Composes the WarEffort × MilitaryOfficer multiplier into the success
  // affection delta. Pure read of state.globalEvents + the aggressor character.
  // Multiplier defaults to 1.0 when either condition is absent. The discovery
  // roll is NOT modified — multiplier is positive-outcome-only (uniforms-and-
  // glory framing per the design pin).
  //
  // Future P15 dynasty-seduction-perk hook composes IN THE SAME WAY (multi-
  // plicative compose: warEffortMultiplier × dynastyPerkMultiplier × baseDelta).
  // Per CLAUDE.md "Designer constants in one place" — the multiplier constant
  // lives at constants.ts:WAR_EFFORT_SEDUCTION_AFFECTION_MULTIPLIER.
  const aggressor = state.characters.get(scheme.aggressorCharacterId);
  const isOfficer = aggressor !== undefined && aggressor.traits.includes("MilitaryOfficer" as TraitId);
  const hasActiveWarEffort = [...state.globalEvents.values()].some((e) => e.kind === "WarEffort");
  const seductionMultiplier = isOfficer && hasActiveWarEffort
    ? WAR_EFFORT_SEDUCTION_AFFECTION_MULTIPLIER
    : 1.0;
  const baseDelta = SEDUCTION_AFFECTION_DELTA_ON_SUCCESS;
  const finalDelta = Math.round(baseDelta * seductionMultiplier);
  // Match the live site at schemes.ts:569 — pairKey is (ownerHouseId, targetId).
  // Plan-snippet variable `targetId` mirrors the live name; do NOT pass two
  // CharacterIds — makePairKey's signature is (HouseId, CharacterId).
  const newAffection = new Map(state.affectionMap);
  const key = makePairKey(scheme.ownerHouseId, targetId);
  const current = newAffection.get(key) ?? 0;
  newAffection.set(key, clamp(current + finalDelta, 0, 100));
  ```
  Note on the clamp: `Math.round(80 × 1.5) = 120`; the `clamp(current + 120, 0, 100)` caps the final stored value at 100. Verification #14 below pins the POST-clamp value (delta is recorded as 100 in the affection map; the multiplier's effect is the "ceiling-reach" framing, not a literal +120 storage). Future v1.5 phases that want the multiplier to fire "above the cap" would need a different mechanic (e.g., a separate `seductionBonusReserve` field on Character).
  Vitest: extend `src/game/rules/schemes.test.ts` with three cases — (a) baseline (no WarEffort): delta = 80; (b) WarEffort active, non-officer aggressor: delta = 80; (c) WarEffort active, officer aggressor: delta = 120 (Math.round(80 × 1.5) = 120). The "officer-but-no-WarEffort" case asserts the multiplier does NOT fire (delta = 80) — guards against the trait-only branch silently always-buffing Seduction.

- **Courier transit halving (`src/game/rules/courier.ts:26-31`).** The current pure signature `transitTicks(from, to)` widens to `transitTicks(state, originatorHouseId, from, to)` to read the per-house research flag. Concrete diff:
  ```ts
  // src/game/rules/courier.ts — P13 EDIT:

  // BEFORE P13:
  //   export function transitTicks(from: LocationId, to: LocationId): number {
  //     if (from === to) return 0;
  //     const ticks = TRANSIT_TABLE.get(canonicalKey(from, to));
  //     if (ticks === undefined) throw new UnknownLocationPairError(from, to);
  //     return ticks;
  //   }

  // AFTER P13:
  // Pure lookup with optional per-house halving. The state parameter is read
  // for the originator house's courierResearchEarned flag (set true by the
  // P13 researchFastCouriers action). When the flag is true AND the originator
  // is the source-side house of the courier, the lookup result halves with
  // floor 1 (per spec "halves new courier transit times (floor 1)"). The
  // halving applies only to the SOURCE-side perspective — the receiver's
  // research does NOT halve incoming transit (matches the spec's "fast
  // couriers" framing: the player's research speeds up THEIR outbound mail).
  //
  // Per CLAUDE.md non-negotiable "Every scheduled event stores an absolute
  // end-tick, never a relative duration" — this function is consulted ONLY
  // at courier-creation time to compute `arrivalTick = state.tick + transitTicks(...)`.
  // In-flight couriers retain their absolute arrivalTick regardless of any
  // subsequent research action.
  export function transitTicks(
    state: GameState,
    originatorHouseId: HouseId,
    from: LocationId,
    to: LocationId,
  ): number {
    if (from === to) return 0;
    const base = TRANSIT_TABLE.get(canonicalKey(from, to));
    if (base === undefined) throw new UnknownLocationPairError(from, to);
    const originator = state.houses.get(originatorHouseId);
    if (originator !== undefined && originator.courierResearchEarned) {
      return Math.max(1, Math.ceil(base * 0.5));
    }
    return base;
  }
  ```
  **Caller updates** (mechanical signature thread):
  - `src/game/rules/whispers.ts:141` — the SOLE in-repo caller of `transitTicks` (verified via `grep -n 'transitTicks(' src/`). The caller is `generateWhisperCourier` at `whispers.ts:133-145`. The function ALREADY hardcodes `originHouseId: PLAYER_HOUSE_ID` at line 142 (live comment: "at v1 only PLAYER_HOUSE_ID originates couriers"). P13's edit threads the same constant into the widened signature:
    ```ts
    // BEFORE P13 (whispers.ts:141):
    //   const arrivalTick = state.tick + transitTicks(originLocation, destinationLocation);
    // AFTER P13:
    const arrivalTick = state.tick + transitTicks(state, PLAYER_HOUSE_ID, originLocation, destinationLocation);
    ```
    Direct constant pass — no closure-scope lookup, no widening of `generateWhisperCourier`'s signature. Matches the function's documented "v1 single-originator" framing. Future v1.5 phases that introduce rival-originated couriers widen `generateWhisperCourier` to take an explicit `originatorHouseId` parameter and forward it here.
  - **No other callers**: `staff.ts` does NOT call `transitTicks` directly (verified via grep — staff cadence outputs courier payloads, but the courier-emit factory itself lives in `whispers.ts`'s P6-introduced helpers, which P13's caller-update covers).
  - **Test impact**: `src/game/rules/courier.test.ts` extends with two new cases — (i) baseline transit (no research, no halving), (ii) post-research transit (research flag true, halved with floor 1). The existing transit tests update to pass the new `(state, originatorHouseId)` parameters.

- **New `globalEventBus` (`src/runtime/events/globalEvent.ts`).** New event module per CLAUDE.md "Topically-partitioned event modules" non-negotiable. Lives alongside the existing `events/` modules. Five variants:
  ```ts
  // src/runtime/events/globalEvent.ts (NEW at P13):
  import type { CharacterId, GlobalEventId, HouseId } from "../../game/rng";  // branded-string Zod schema home per CLAUDE.md convention
  import type { GlobalEvent } from "../../game/entities";  // discriminated-union entity home
  import type { GlobalEventKind } from "../../game/rules/globalEvents";
  import { EventBus } from "./bus";

  export type GlobalEventVariant =
    | { kind: "EraTransitioned"; tick: number; from: "Earlier"; to: "Later" }
    | { kind: "GlobalEventStarted"; tick: number; event: GlobalEvent }
    | { kind: "GlobalEventExpired"; tick: number; eventId: GlobalEventId; eventKind: GlobalEventKind }
    | { kind: "CourierResearchUnlocked"; tick: number; houseId: HouseId };
    // NOTE: NO "OfficerKilledInWar" variant — character deaths are already
    // emitted via publishCharacterDeaths (the canonical diff helper). Consumers
    // wanting to distinguish WarEffort officer deaths from other deaths can
    // cross-reference state.globalEvents + the dead character's traits at
    // the tick of death.

  export const globalEventBus = new EventBus<GlobalEventVariant>();

  // ── Diff helper (rides on tick-advancing wrappers) ──────────────────────

  export function publishGlobalEventTransitions(before: GameState, after: GameState): void {
    // Era transition (one-shot, Earlier → Later).
    if (before.era === "Earlier" && after.era === "Later") {
      globalEventBus.publish({ kind: "EraTransitioned", tick: after.tick, from: "Earlier", to: "Later" });
    }
    // New events spawned this tick.
    for (const [id, event] of after.globalEvents) {
      if (!before.globalEvents.has(id)) {
        globalEventBus.publish({ kind: "GlobalEventStarted", tick: after.tick, event });
      }
    }
    // Events expired this tick.
    for (const [id, event] of before.globalEvents) {
      if (!after.globalEvents.has(id)) {
        globalEventBus.publish({
          kind: "GlobalEventExpired",
          tick: after.tick,
          eventId: id,
          eventKind: event.kind,
        });
      }
    }
  }
  ```
  Bus subscription discipline: every React subscriber pairs with a cleanup `unsubscribe()` per CLAUDE.md §5.6 / the §9 "Static event-bus subscriber leakage" rule. The `useBusEvent<K>(globalEventBus, kind, handler)` hook (existing at `src/runtime/events/useBusEvent.ts`) services this via the standard pattern.

- **New courier-research store action (`src/game/store.ts`).** Free-action wrapper following the P10 `commissionForgery` / `thwartTheft` precedent. Modal-state gates at top per CLAUDE.md "Modal-state rule-layer gate principle (P9 generalization of P6)":
  ```ts
  // src/game/store.ts — StoreActions interface P13 ADDITION:
  researchFastCouriers: () =>
    | { ok: true }
    | { ok: false; reason: ResearchFastCouriersRejection };

  // src/game/store.ts — create-store body P13 ADDITION (placed alongside
  // commissionForgery / thwartTheft at ~line 1759-1803):
  researchFastCouriers: () => {
    const stateBefore = get();  // local name matches the commissionForgery/thwartTheft precedent
    const result = applyResearchFastCouriers(stateBefore);
    if (!result.ok) {
      // Modal-state and validation rejections — UI surfaces the typed reason.
      // No bus publish on rejection (P10 commissionForgery precedent — only
      // ok-true mutations emit events).
      return { ok: false, reason: result.reason };
    }
    set((draft) => {
      overwriteFromGameState(draft, result.nextState);
    });
    globalEventBus.publish({
      kind: "CourierResearchUnlocked",
      tick: stateBefore.tick,  // free action — no tick advance; matches commissionForgery/thwartTheft precedent
      houseId: PLAYER_HOUSE_ID,
    });
    return { ok: true };
  },
  ```
  Free action: NO `advanceTickPure`, NO 11-publisher set (CourierResearchUnlocked is the only direct-publish per the P10 free-action precedent). The wealth deduction + flag flip + bus publish happen atomically within one `set` body.

- **Publisher set widening to 11/11/9 (CLAUDE.md update).** Add `publishGlobalEventTransitions(stateBefore, afterTick)` to:
  - `advanceTick` (was 10, now 11) at `src/game/store.ts:557+`
  - 4 P3 wrappers — `travel` / `requestAudience` / `escapeBankruptcy` / `refreshWardrobe` (each was 10, now 11)
  - `proposeMarriage` (was 10, now 11)
  - `reconcileSibling` (was 10, now 11)
  - `exitPromenade` (was 10, now 11) — per the P12 "tick-on-exit" pattern
  - NOT added to `runYearPass` (stays at 9): year-pass STEPS does NOT include `applyGlobalEventPhase`, so global-event transitions cannot emit during year-pass. Era transition is tick-driven (`state.tick >= ERA_TRANSITION_TICK`); year-pass does not advance `state.tick`.

  CLAUDE.md pin update: REPLACE the existing "P11 publisher set is 10/10/9" pin (CLAUDE.md line ~117) in full — NOT a substring-replace. Per the cross-plan "Publisher trio N/N/N pin substring-replace obscures membership differences" pattern (P10 retrospective), the full pin including its per-wrapper membership sub-bullets must be updated. Concrete replacement:
  ```
  // BEFORE P13 (existing pin verbatim):
  //   - **P11 publisher set is 10/10/9 across tick-advancing wrappers, superseding the P10 truth-up of 7/7/6.** Three new publishers (`publishSiblingRivalTransitions`, `publishInheritedSecretTransitions`, `publishBloodFeudTransitions`) ride on EVERY tick-advancing wrapper INCLUDING `runYearPass` — year-pass IS the accumulation site (succession step) AND the promotion site (STEPS slot 4). Group memberships: `proposeMarriage` = 10 (existing 7 + 3 new); `advanceTick` + 4 P3 wrappers + `reconcileSibling` = 10 each (existing 7 + 3 new); `runYearPass` = 9 (existing 6 + 3 new).

  // AFTER P13 (full pin replacement):
  - **P13 publisher set is 11/11/9 across tick-advancing wrappers, superseding the P11 truth-up of 10/10/9.** One new publisher (`publishGlobalEventTransitions`) rides on EVERY tick-advancing wrapper EXCEPT `runYearPass` — year-pass STEPS doesn't include `applyGlobalEventPhase`, so the diff helper would emit zero events; era transition is tick-driven and year-pass does not advance `state.tick`. Group memberships:
    - `proposeMarriage` (11): proposalOutcome direct + marriageTransitions + temptationLatchTransitions + characterDeaths + whisperTransitions + elopementTransitions + artifactTransitions + siblingRivalTransitions + inheritedSecretTransitions + bloodFeudTransitions + **globalEventTransitions (NEW at P13)**. No schemeTransitions.
    - `advanceTick` + 4 P3 wrappers (`travel`/`requestAudience`/`escapeBankruptcy`/`refreshWardrobe`) + `reconcileSibling` + `exitPromenade` (11 each): characterDeaths + schemeTransitions + whisperTransitions + marriageTransitions + temptationLatchTransitions + elopementTransitions + artifactTransitions + siblingRivalTransitions + inheritedSecretTransitions + bloodFeudTransitions + **globalEventTransitions (NEW at P13)**.
    - `runYearPass` (9 — unchanged): characterDeaths + whisperTransitions + marriageTransitions + temptationLatchTransitions + childMaturationTransitions + archetypeReclassificationsFromSuccession + siblingRivalTransitions + inheritedSecretTransitions + bloodFeudTransitions. **globalEventTransitions does NOT ride on runYearPass** (year-pass STEPS does not include `applyGlobalEventPhase`).

    Free actions (`commissionForgery`, `thwartTheft`, P13's new `researchFastCouriers`) DO NOT fire the publisher set — they direct-publish their own wrapper-owned events (`ForgeryCreated`, `TheftResolved`, `CourierResearchUnlocked`).
  ```

- **UI (minimal at P13 — ledger ships at P14).** Two UI surfaces ship at P13:
  - **Active-event banner at MapView header** (`src/ui/map/MapView.tsx` — small extension). **Placement**: right-aligned chip row in the existing MapView header (alongside the tick counter / wealth / reputation displays). One `<EventChip>` per active `state.globalEvents` entry, lex-sorted by `event.id` for stable visual order across renders. Format strings: `"WarEffort (4 ticks left)"`, `"MarketCrash (2 ticks left)"`, `"MonarchsMood: sapphires favored (3 ticks left)"`. Tick-countdown computed live as `event.endTick - state.tick + 1` (inclusive of current tick — matches the apply-before-expire `<=` predicate at `expireFinishedEvents`). **Per-kind color tokens** (use Tailwind class names matching the existing UI palette — verify against `tailwind.config.ts` at implementation): `WarEffort` → `bg-rose-700 text-rose-50` (martial red), `MarketCrash` → `bg-amber-700 text-amber-50` (economic warning amber), `MonarchsMood` → `bg-violet-700 text-violet-50` (regal violet). NO React re-render storms — the existing tick-store subscription handles the per-tick redraw. The chip surfaces visual differentiation only; no inline action affordance.
  - **Courier-research button at Capital `LocationDetailsPanel`** (`src/ui/map/LocationDetailsPanel.tsx` — small extension). Visible ONLY when `state.era === "Later"` AND `state.houses.get("player").courierResearchEarned === false`. Disabled when player wealth < 30. Click invokes `store.researchFastCouriers()`. Success: button vanishes (flag flipped). Failure: toast banner with the typed-rejection message (`InsufficientWealth` / `PlayerExiled` / `ElopementInProgress` / `AlreadyResearched` / `EraNotYetLater`).
  - Full ledger tab for global-event history + research-action history is **deferred to P14** per the existing Ledger View scope.

- **`§10` Q21 resolution update (`plans/MASTER.md` row 21).** P13 ship resolves Q21 ("Cultural-pivot before artifact registry ships?") definitively. Update the row's "Default for v1" cell to reference the live P13 implementation (replacing the prior "N/A" placeholder):
  ```
  | 21 | Cultural-pivot before artifact registry ships? | **N/A** — P10 (artifacts) ships before P13 (events). **Resolved at P13** ([phases/13-global-events-era.md](./phases/13-global-events-era.md)); MonarchsMood's favored-family roll picks from ARTIFACT_FAMILIES (7 entries) directly; `houseHasFamilyEquipped(state, houseId, favoredFamily)` is the per-house match check used by `applyMonarchsMoodTick`. No new `Culture` enum or per-family `culturalAffinity` tag — the artifact-family axis IS the cultural axis at v1. v1.5 candidate: introduce a coarser `Culture` enum if playtest reveals the 7-family axis too granular. |
  ```

- **CLAUDE.md additions (P13).** Six new pins follow the existing per-phase pin convention:
  1. Publisher-set update from 10/10/9 → 11/11/9 (text above).
  2. **`MilitaryOfficer` trait ships wired-but-inert at v1 (P13)**: the trait exists in `TRAITS`, threads through every consumer (Character / persona / save round-trip), and gates the WarEffort officer-death + WarEffort × Seduction multiplier rule branches — BUT NO v1 acquisition path produces an officer-tagged character (verified: not in `ARCHETYPE_MATURATION_TRAIT_POOL`, not in `FINISHING_SCHOOL_TRAIT_MAP`, not in any conception / artifact / location path). The mechanics fire ZERO times across a v1 campaign. Tests at P13 seed officer-tagged characters via fixture literals to exercise the dormant-at-runtime branches. Future v1.5 phases that add an acquisition path (P16 procedural NPC widening; future `OfficerCommission` scheme; future `MilitaryAcademy` location) activate the gameplay surface by SINGLE-TABLE EDIT — no `TRAITS` widening, no rule-branch wiring, no save-version bump, no persona-cache bump.
  3. **Unconditional per-tick player-rng draw (P13)**: `applyGlobalEventPhase` consumes ONE player-rng draw EVERY tick for the 5%/tick trigger roll, regardless of outcome (cooldown-burns-on-all-outcomes per the P8 pin). This is the first per-tick draw that fires unconditionally — P10's forgery/thief rolls are conditional on registry-entry existence. Replay-harness fixtures and per-tick-rng-budget tests pin the draw-count contract; any future phase that adds a similar always-on roll must thread its draw through the player-rng stream same-tick.
  4. **`transitTicks` signature widened to `(state, originatorHouseId, from, to)` (P13)**: the per-house `courierResearchEarned` halving requires state access. Every caller threads `state` + the originating-house id explicitly. Pure-rule contract preserved (no module-private state, no side effects). Future per-house transit modulation (e.g., trait-based courier-speed perks at P15+) composes into this signature.
  5. **`applyGlobalEventPhase` is the canonical mid-tick global-event entry point (P13)**: composes era-flip → active-event tick effects → expiry → trigger roll in that order. Phase order is load-bearing — moving the trigger roll AHEAD of active-event effects would silently double-count the spawn-tick. Future v1.5 global-event widenings (additional event kinds, mid-event mutations) extend the `GlobalEventKind` register and the per-kind switch in `applyActiveEventTickEffects`; the four-step composition stays.
  6. **MonarchsMood no-match branch is `+1 scandal` ONLY, no negative-surge branch (P13)**: per §7 line 658 pin, the cultural-surge branch is gated on `houseHasFamilyEquipped(state, houseId, favoredFamily) === true` and the snub-branch fires in the strict else-arm. The two branches are mutually exclusive per-house per-tick. The `MONARCHS_MOOD_SNUB_SCANDAL_PER_TICK = 1` constant is NOT doubled; no negative reputation hit; no scandal penalty stacking. Implementation verifies this via the `applyMonarchsMoodTick` if/else structure (NOT a max/min composition that could accidentally fire both branches).

**Out of scope.**
- Per-tick rival economy gameplay beyond the uniform WarEffort/MarketCrash deltas (e.g., a rival "war profiteer" archetype that gains wealth during WarEffort) — v1.5 candidate.
- Additional global event types beyond the three (e.g., royal funeral, ducal wedding, peasant revolt) — v1.5 candidate.
- Cultural-pivot `Culture` enum + per-family `culturalAffinity` tag — v1 uses ARTIFACT_FAMILIES directly per the design decision.
- Officer cohort bootstrap seeding — no characters start with `MilitaryOfficer` trait at P13 (intentional inert-scaffolding scope; see TRAITS widening bullet for the design-intent pin).
- `MilitaryOfficer` acquisition path (tutor/maturation/location/conception/artifact) — deferred to v1.5 phase (P16 procedural NPC widening is the most likely fit; future `OfficerCommission` scheme or `MilitaryAcademy` location are alternative homes).
- Mid-event end-tick mutation (e.g., player-elected "extend WarEffort" or "end MarketCrash early") — events terminate strictly at their absolute end-tick.
- Per-event UI ledger tab (history, expired-event-log, favored-family timeline) — deferred to P14.
- WarEffort "draftable archetypes" affordance (e.g., player elects which of their officer characters serve at the front) — every officer is exposed to the per-tick death roll; no player toggle.
- Era-flip animation / UI celebration — at v1 the flip is silent except for the bus event; future polish (P16) may add a banner.
- Multi-tick research-action sequence (e.g., "research courier improvements over 5 ticks") — research is a single atomic free action.
- Per-house courier-research halving for non-player houses — at v1 the action wrapper is gated on `PLAYER_HOUSE_ID`; the `transitTicks` halving reads the per-house flag for any house (architectural support), but the only UI affordance is player-facing.

**Spec refs.** §3 "Global Events" (lines 386-392): 5%/tick trigger, three named event types, absolute end-tick lifecycle. §3 "Era Progression" (lines 394-398): one-way Earlier → Later transition, foreign-capital blockade unless Smuggling bypass, later-era research action halving courier times. §7 line 658: "Cultural-pivot Monarch's Mood against no-artifact house" — `+1 scandal` ONLY, no negative-surge branch. §3 line 390: WarEffort officer trait gates Seduction multiplier and per-tick death roll. §10 Q21: resolved by P13 (artifacts ship at P10 before events at P13; cultural-pivot positive branch always has artifacts to match).

**Key constants summary table.**

| Constant | Value | Spec ref |
|---|---|---|
| `GLOBAL_EVENT_TRIGGER_PROBABILITY_BASIS_POINTS` | `500` (5%/tick) | §3 line 388 |
| `WAR_EFFORT_DURATION_TICKS` | `10` | §3 line 389 |
| `WAR_EFFORT_REPUTATION_PER_TICK` | `+1` | §3 line 390 |
| `WAR_EFFORT_WEALTH_PER_TICK` | `-2` | §3 line 390 |
| `WAR_EFFORT_OFFICER_DEATH_PROBABILITY_BASIS_POINTS` | `100` (1%/tick) | §3 line 390 |
| `WAR_EFFORT_SEDUCTION_AFFECTION_MULTIPLIER` | `1.5` | §3 line 390 |
| `MARKET_CRASH_DURATION_TICKS` | `5` | §3 line 389 |
| `MARKET_CRASH_WEALTH_PER_TICK` | `-3` | §3 line 389 |
| `MONARCHS_MOOD_DURATION_TICKS` | `5` | §3 line 389 |
| `MONARCHS_MOOD_FAVORED_FAMILY_REPUTATION_SURGE_PER_TICK` | `+2` | §3 line 391 |
| `MONARCHS_MOOD_SNUB_SCANDAL_PER_TICK` | `+1` | §3 line 391, §7 line 658 |
| `COURIER_RESEARCH_WEALTH_COST` | `30` | §3 line 397-398 |
| `ERA_TRANSITION_TICK` | `200` (declared P3, made-live P13) | §3 line 396 |

**Machines.** Era (Earlier → Later); Global event (Active → Expired). The Era machine is a one-shot triggered by `state.tick >= ERA_TRANSITION_TICK` inside `applyGlobalEventPhase`; the Active → Expired transition is end-tick-driven (Active at `tick ∈ [startTick, endTick]`, Expired at `tick > endTick`). Per MASTER.md §5.2 catalog, both machines are simple two-state transitions; no XState actor refs required (state lives directly on `GameState.era` and `GameState.globalEvents` entries — the "machine" abstraction is conceptual, not literal).

**Edge cases (§7).**
- **Cultural-pivot Monarch's Mood against no-artifact house** (§7 line 658): explicit pin. `applyMonarchsMoodTick`'s if/else gates the surge-branch on `houseHasFamilyEquipped === true` and the snub-branch fires in the strict else-arm. Two-branch mutual exclusion per-house per-tick. Vitest covers: (a) match → +2 rep, no scandal; (b) no-match → +1 scandal, no rep change; (c) no negative-surge branch fires regardless of family/equip combinations.
- **Era-flip during in-flight Smuggling scheme**: pre-wired at P5. `SCHEME_ERA_REQUIREMENTS.Smuggling = "Earlier"` blocks new Smuggling starts post-flip; `resolveSmuggling` defensive `state.era !== "Earlier"` branch flips status to `Failed/EraFlipped` on completion if the era flipped mid-flight. P13 phase order: slot 5 (`applySchemeResolutionPhase`) runs BEFORE slot 6 (`applyGlobalEventPhase`), so a Smuggling scheme completing AT the era-transition tick resolves in `"Earlier"` era and completes successfully. The era flip happens AFTER scheme resolution within the same tick.
- **Same-tick global-event spawn AND active event of same kind**: duplicate-kind skip per spec line 388. `maybeFireNewEvent`'s `alreadyActive` check covers it.
- **Same-tick officer death AND officer aggressor in completing Seduction**: phase order resolves it. Slot 5 (schemes) runs BEFORE slot 6 (global events). Seduction completes → aggressor still alive → success affection applied with the WarEffort multiplier (if WarEffort was active from prior ticks). Slot 6 then rolls officer death; aggressor dies. Next tick: dead aggressor, no further scheme/conversation paths.
- **Same-tick era flip AND new event trigger**: phase order resolves it. `applyGlobalEventPhase`'s internal order: (1) era flip → (2) active-event tick effects → (3) expiry → (4) trigger roll. The new event spawn (if any) happens AFTER the era flip; the event's behavior is era-agnostic (deltas don't differ by era).
- **MonarchsMood favored-family equals no real artifact**: cannot happen — favored-family is drawn from `ARTIFACT_FAMILIES` which is exhaustive. The match check `houseHasFamilyEquipped` returns false for every house without that family equipped; the snub-branch fires for every house.
- **WarEffort officer death of player heir**: `pruneOrphanedConversationKeys` cascade handles it. P7 succession step (year-pass) promotes the next heir; the dead heir's `equippedArtifactIds` and conversation history are pruned per the existing cascade. No special-case logic needed.
- **MarketCrash + WarEffort simultaneously active**: both event types can coexist (duplicate-kind skip is per-kind, not cross-kind). Each tick: WarEffort applies +1 rep / -2 wealth, then MarketCrash applies -3 wealth. Per-house wealth delta total: -5/tick. Wealth UNCLAMPED (matches `economy.ts:60` pattern) — sustained co-active WarEffort + MarketCrash drives the house through Solvent → Hemorrhaging → Embarrassed → Ruined bankruptcy tiers (per `economy.ts:18`'s wealth bands) on schedule.
- **Courier research action during in-flight courier transit**: the in-flight courier retains its absolute `arrivalTick` (CLAUDE.md non-negotiable §2). Only NEW couriers spawned post-research are halved. Vitest covers: research-then-spawn a fresh courier → halved; research-while-courier-in-flight → in-flight courier unchanged.
- **Same-tick WarEffort officer death + MonarchsMood favored-family equip check**: within `applyActiveEventTickEffects`, events iterate lex-sorted by `event.id`. With both kinds active, MarketCrash sorts before MonarchsMood sorts before WarEffort alphabetically — but the per-tick officer death from WarEffort applies LAST inside the loop. MonarchsMood's `houseHasFamilyEquipped` already ran for the tick by the time the officer dies; the dead officer's equipped artifacts ALREADY counted toward the favored-family match on that tick (`c.alive` filter saw `true` mid-tick). Next tick, the officer is dead → `c.alive` filter excludes them → equipped artifacts no longer count. Acceptable semantic: the killed officer "represented" the house for one final MonarchsMood tick before dying.
- **Same-tick WarEffort officer death + officer-as-elopement-sprint-target**: when a `MilitaryOfficer`-tagged character is the active elopement sprint character AND WarEffort kills them, `pruneOrphanedConversationKeys` Branch 5 (P9) fires the elopement cleanup: `state.elopement = null` + scandal bump on player house. The bump composes with WarEffort's own `+1 rep` on the same house (sequential mutations within `applyWarEffortTick`'s death-cascade call). Both writes land; UI surfaces the death via `publishCharacterDeaths` AND the elopement-aborted state via the next-tick `publishElopementTransitions`.
- **Same-tick WarEffort officer death + in-flight duel**: duels resolve synchronously at action time (per `store.ts:1618` precedent — duels are NOT a tick-phase). An officer cannot die mid-tick AND be a live duel participant the same tick. If a duel was queued via player action AND the officer dies in the SAME tick via the global-event phase, the duel-resolution player action would have already completed (or rejected) before the tick-phase chain ran. No interaction surface.
- **All 3 event types simultaneously active**: per-tick player-rng draw budget = 1 trigger + 3 × (0 if no MarketCrash/WarEffort officer roll, else N for WarEffort officer-rolls). Replay-harness fixtures must seed enough RNG headroom for the campaign-max scenario (e.g., 5 officers + 3 simultaneously-active events × 5-tick cycle = ~25-50 draws/cycle worst case). The trigger roll skips spawn on every duplicate-kind tick, so the budget is bounded by `1 + N` per tick (N = total alive `MilitaryOfficer`-tagged characters).

**Verification.**
- `pnpm test` — all Vitest suites pass; deterministic replay harness produces identical state hashes across 30 runs of any campaign that crosses the era boundary and fires at least one event of each kind.
- `pnpm lint` — Biome clean; `eslint-plugin-boundaries` clean (`globalEvents.ts` imports stay within the permitted rules-layer set: `constants`, `entities`, `fixtures/artifacts`, `rng`, `util/clamp`, `aging` for the death-cascade helper).
- `pnpm typecheck` — strict TS clean (the `GameStateSchema` literal in `createInitialState` rejects any missing `globalEvents` field; the `GlobalEventSchema` discriminated union narrows correctly via TS exhaustiveness in the per-kind switch).
- **Per-phase Vitest coverage matrix:**
  1. `applyGlobalEventPhase` composes the 4 sub-steps in the documented order — assert via spy-on-each-substep test that ordering matches `era → active → expire → trigger`.
  2. `maybeFlipEra` fires exactly once at `state.tick === ERA_TRANSITION_TICK`; idempotent on subsequent ticks (era stays `"Later"`); never reverts.
  3. `applyWarEffortTick` applies +1 rep / -2 wealth on every house; rivals + Independent participate; reputation clamped at literal `100`; wealth is UNCLAMPED (matches `economy.ts:60` pattern — wealth can go arbitrarily negative for bankruptcy tier transitions).
  4. `applyWarEffortTick` officer-death roll iterates lex-sorted houses/characters. **Test setup MUST explicitly seed `MilitaryOfficer`-tagged characters via fixture literal** (`traits: [..., "MilitaryOfficer" as TraitId]`) — bootstrap produces zero officers per the wired-but-inert design, so without explicit seeding the test passes vacuously. Assert PLAYER_HOUSE_ID rng advances by N (N = total alive seeded officers) every active-WarEffort tick; deaths route through `pruneOrphanedConversationKeys`. Cover N=0 (no rng advance), N=1 (one draw), N=3 (three draws in lex-sort order).
  5. `applyMarketCrashTick` applies -3 wealth on every house; wealth UNCLAMPED.
  6. `applyMonarchsMoodTick` match-branch: +2 rep for houses with ≥1 equipped artifact whose family matches favoredFamily; reputation clamped at literal `100`.
  7. `applyMonarchsMoodTick` no-match-branch: +1 scandal for houses without any matching equipped artifact; scandal clamped at literal `100`; no rep change, no negative surge.
  8. `applyMonarchsMoodTick` per-house mutual-exclusion: a single house never receives both rep surge AND scandal hit in the same tick (verified via two-house fixture + assertion).
  9. `expireFinishedEvents` drops events with `endTick <= state.tick`; preserves events with `endTick > state.tick`. Combined with apply-before-expire ordering, a WarEffort spawned at tick=100 (`endTick=110`) fires effects at ticks 101-110 inclusive (10 applications total) and is dropped on tick=110 AFTER the 10th apply. Verify exact application count via fixture with `WAR_EFFORT_DURATION_TICKS = 10` spawned at known tick — count `houses["player"].wealth` deltas: −20 wealth total (10 × −2).
  10. `maybeFireNewEvent` burns one player-rng draw every tick regardless of outcome (trigger-roll); duplicate-kind skip preserves the kind-pick draw but not a favored-family draw.
  11. `maybeFireNewEvent` MonarchsMood path consumes 3 draws total (trigger + kind + favored-family); WarEffort/MarketCrash paths consume 2 draws (trigger + kind).
  12. `maybeFireNewEvent` no-event path consumes 1 draw (trigger only); duplicate-kind-skip path consumes 2 draws (trigger + kind, no favored-family even on MonarchsMood-skip).
  13. `makeGlobalEventId` per-kind index: spawning 3 MarketCrash events (over time, with expiries between) yields `globalevent-MarketCrash-0`, `-1`, `-2`; interleaved spawns don't share indices across kinds.
  14. `resolveSeduction` WarEffort × officer multiplier: officer aggressor + active WarEffort → pre-clamp `Math.round(80 × 1.5) = 120`, POST-CLAMP stored affection value capped at 100 via `clamp(current + 120, 0, 100)`. Non-officer or no-WarEffort → pre-clamp 80, stored value `clamp(current + 80, 0, 100)`. Trait-only without WarEffort does NOT fire the multiplier (pre-clamp 80). Test asserts the POST-CLAMP stored affection value (i.e., `affectionMap.get(key)` reads at most 100, not 120).
  15. `transitTicks` baseline: no research, no halving. Post-research: halved with floor 1 (a 1-tick baseline stays 1; a 2-tick baseline → 1; a 3-tick baseline → 2). **Existing-test update count**: 4 `transitTicks(` call-sites across 3 `it` blocks in `src/game/rules/courier.test.ts` need the new `(state, originatorHouseId, from, to)` signature threaded through; verify count via `grep -n 'transitTicks(' src/game/rules/courier.test.ts` at implementation time.
  16. `transitTicks` per-house: research on player house halves player-originated couriers; rival-originated couriers (without rival-side research) use baseline transit; research flag is per-originator-house.
  17. `researchFastCouriers` action: success path deducts 30 wealth + flips flag + publishes `CourierResearchUnlocked`; rejection paths cover `PlayerExiled`, `ElopementInProgress`, `EraNotYetLater`, `AlreadyResearched`, `InsufficientWealth`.
  18. `publishGlobalEventTransitions` diff helper: emits `EraTransitioned` on era flip; emits `GlobalEventStarted` per new event; emits `GlobalEventExpired` per dropped event; emits zero events when before === after.
  19. Publisher-set count: `advanceTick` fires 11 publishers + 0 direct-publishes (post-P13); `runYearPass` fires 9 publishers (unchanged); `proposeMarriage` fires 11 publishers + ProposalOutcome direct.
  20. `migrate_v12_to_v13` zero-draw assertion: `expect(migrate_v12_to_v13(save).rng).toEqual(save.rng)`.
  21. `migrate_v12_to_v13` idempotence: `assertMigrationIdempotent(migrate_v12_to_v13, fixture)` passes.
  22. `v1-to-v13-chain.test.ts` byte-identity: legacy V1 → ... → V13 hash equals `createInitialState(playerSeed)` V13 hash for the canonical seed.
  23. `v1-to-v13-chain.test.ts` per-step outputSchema validation: each migration step's output parses cleanly against the next-version SaveSchema.
  24. `replace-state.test.ts` `globalEvents` round-trip: replaceState with a seeded events Map → state mirror has the events → an immediately-following `advanceTick` preserves the events through `overwriteFromGameState`.
  25. **`schema-projection-selector-extension.test.ts` keyset equality** (verified live test gate at `src/game/schema-projection-selector-extension.test.ts:14`): `GameStateSchema.shape` keys === `hashableState({...})` keys === `selectGameState({...})` keys (extended quad-sync surface) — passes post-P13 edit to all four surfaces.
  26. **Replay-harness 30-run stability**: a 1000-tick campaign that crosses `ERA_TRANSITION_TICK = 200` and fires ≥ 1 of each event kind produces identical final state hashes across 30 independent runs with the same seed.
  27. **Era + Smuggling integration**: a Smuggling scheme started at tick 195 (duration 4) completes at tick 199 → succeeds (era still `"Earlier"`). A Smuggling scheme started at tick 198 → rejected at start with `SmugglingPastEraEdge` (per P5 pre-wired gate). At tick 200, era flips to `"Later"`; subsequent travel to ForeignCapital permitted without bypass.
  28. **TRAITS length assertion**: `TRAITS.length === 33` post-P13; module-load throws if changed without phase plan.
  29. **`GLOBAL_EVENT_KINDS` length assertion**: `GLOBAL_EVENT_KINDS.length === 3` post-P13; module-load throws if changed.
  30. **No `MilitaryOfficer` characters at bootstrap**: assert `createInitialState(seed)` produces a state where every character's `traits.includes("MilitaryOfficer" as TraitId) === false`. **Cross-references verification #4**: #4 requires tests to seed officer-tagged characters via fixture literal; #30 requires bootstrap to produce zero officers. The pair is binding — future maintainers cannot break #30 by adding an acquisition path (e.g., to `ARCHETYPE_MATURATION_TRAIT_POOL`) while making #4's "explicit fixture seed" requirement redundant. Either both stand, or both are revisited at the v1.5 phase that adds the acquisition path.
  31. **`ARTIFACT_FAMILIES` length assertion**: `expect(ARTIFACT_FAMILIES.length).toBe(7)` in `globalEvents.test.ts` (or `artifacts.test.ts` extension). Pins the `drawInt(r2, ARTIFACT_FAMILIES.length)` budget for the MonarchsMood favored-family roll. A future widening of the artifact-families enum would silently change the per-rival rng draw count (which is hash-relevant for replay determinism) without this gate.
- **For UI changes**: run the dev server and exercise the golden path in a browser. Verify (a) MapView shows event chips when events are active; (b) chips disappear at endTick; (c) era-flip is silently observable (toast banner stretch goal); (d) Capital LocationDetailsPanel shows the research button only when era === "Later" + flag false + wealth >= 30; (e) clicking research deducts wealth, hides the button, and (visually, via the courier-staff cadence over the next few ticks) halves new outbound courier transits.
- **For LLM-touching changes**: NONE at P13. The LLM round-trip is unaffected.

**Close out.** When the gates and verification items above are green, run `/close-phase 13` to update phase status in `plans/MASTER.md` §6, append to `plans/SESSION-NOTES.md`, resolve any open questions answered during the work (Q21 final-state update), apply any `CLAUDE.md` additions (the six pins enumerated above), and commit the changes (no push).

## Accumulated Risks & Suggestions

*Passively collected from review cycles. Not blockers. Triaged at convergence.*

- [C1] R1. GlobalEventSchema.id field uses `GlobalEventIdSchema`; ensure schema home stays in `rng.ts` (not `entities.ts`) per CLAUDE.md branded-string convention.
- [C1] R2. ARTIFACT_FAMILIES surge/snub balance against player equip diversity (~14-43% match rate); worth a playtest gate before locking surge value.
- [C1] R3. WarEffort officer-death uses PLAYER_HOUSE_ID rng stream for ALL house officers — pin the "single-stream rationale" so a future per-house refactor surfaces as a save-migration concern.
- [C1] R4. `applyEconomyPhase` skips rivals via `RIVAL_HOUSE_IDS_SET.has(houseId)`; `applyWarEffortTick`/`applyMarketCrashTick` iterate ALL houses including rivals. Add inline comment near implementation explaining the divergence.
- [C1] R5. `WAR_EFFORT_SEDUCTION_AFFECTION_MULTIPLIER = 1.5` produces `Math.round(80 × 1.5) = 120` but the affection clamp at 100 caps the final stored value. Verify test #14 asserts post-clamp value, not pre-clamp 120. [likely addressed]
- [C1] R6. "Era flip MUST come first" rationale should pin which phases that actually applies to (the inter-phase consumers post-slot-6: mood drift, happiness, patroness erosion, forgery surfacing, thief notice, sibling-rival action, inherited-secret surfacing, rival action — none read `state.era` today, so ordering is defensive forward-compat).
- [C1] R7. `houseHasFamilyEquipped` is O(houses × characters × artifacts) per tick. Document the cost growth boundary; negligible at v1 cohort sizes.
- [C1] R8. `TraitIdSchema = z.string().transform()` accepts any string (not enum-bounded). Pre-existing risk; manually-corrupted save could carry unknown trait. Not P13-introduced.
- [C1] R9. `applyMonarchsMoodTick` reads post-WarEffort state correctly via `acc` threading; dead officers don't equip artifacts and the `if (!c.alive) continue` filter covers it.
- [C1] R10. CLAUDE.md publisher-pin substring-replace concern. [likely addressed]
- [C1] R11. `toSaveV13` body shape not shown in plan — verify it uses `version: SAVE_VERSION_CURRENT` (now 13) like `toSaveV12` at `schema.ts:1730` and adds `globalEvents: serializeRegistry(state.globalEvents)`. [likely addressed]
- [C1] R12. `researchFastCouriers` direct-publishes `CourierResearchUnlocked` with `tick: result.nextState.tick` — but free actions don't advance tick, so the tick equals the pre-action tick. UI consumers should not assume `tick` indicates the action just ran.
- [C1] R13. `expireFinishedEvents` uses `if (e.endTick < state.tick)` — combined with apply-before-expire ordering, a WarEffort with duration=10 fires effects across 11 ticks (startTick through endTick inclusive). Verify spec intent: "10 ticks" = 10 effect applications, or 10 tick lifespan (11 effects). [likely addressed — predicate switched to `<=` yielding exactly DURATION_TICKS applications]
- [C1] R14. `c.traits.includes("MilitaryOfficer")` works because `TraitIdSchema` is `.transform((s) => s as TraitId)` (no enum guard); string literal coerces silently.
- [C1] R15. `RIVAL_HOUSE_IDS_SET` is NOT consulted by `applyWarEffortTick`/`applyMarketCrashTick`/`applyMonarchsMoodTick` (rivals participate). Add explicit comment so future maintenance doesn't "fix" the omission.
- [C1] R16. Verification #19 wording "fires 11 publishers + 0 direct-publishes" mixes terminology. Diff helpers ride on wrappers; direct-publishes are explicit `bus.publish(...)` calls. Reword.
- [C1] R17. `transitTicks` call-site variable name for `originatorHouseId` at `whispers.ts:141`. [likely addressed]
- [C2] R22. `bootstrapNpcMountFamily` signature mismatch (void-returning mutator, not state-in/state-out). [likely addressed]
- [C2] R23. Verification matrix items #3/#5/#6/#7 + "MarketCrash + WarEffort" edge case carried stale `WEALTH_MIN/REPUTATION_MAX/SCANDAL_MAX` constants. [likely addressed]
- [C2] R24. `fromSaveV1..V12` wrap shapes are heterogeneous (delegation / single-composition / spread-composition); per-wrapper edit pattern enumerated. [likely addressed]
- [C2] S14. Promote construction-site enumeration to in-body bullet (instead of [C1] tail). [likely addressed]
- [C2] S15. Pin `toSaveV13` body shape inline.
- [C2] S16. Pin `generateWhisperCourier` thread shape — direct `PLAYER_HOUSE_ID` constant pass vs widening function signature. [likely addressed]
- [C1] R23. `defaultHouseV4Fields` (`src/persist/schema.ts:93-117`) not enumerated as a construction site; confirm whether Zod `.default(false)` covers parse-time backfill or whether the helper needs an explicit `courierResearchEarned: false` field on the returned literal. [likely addressed]
- [C2] R25. Strip-cascade composition between `stripCourierResearchForLegacyEmit` (Omit<T, ...>) and existing `stripP11FieldsForLegacyEmit` (House → HousePreV12Pre11) needs generic-T treatment to type-check cleanly. [likely addressed]
- [C2] R26. `toSaveV12` demotion-to-legacy: when SAVE_VERSION_CURRENT bumps to 13, the existing `version: SAVE_VERSION_CURRENT` literal in toSaveV12 silently writes V12 saves with `version: 13`. Edit-list bullet should pin "switch toSaveV12's version literal to `version: 12`" alongside applying stripCourierResearchForLegacyEmit. [likely addressed]
- [C2] R27. Rivals get +1 scandal/tick during every MonarchsMood event (no equipped artifacts at v1 — rivals carry `equippedArtifactIds: []` per fixtures/rivals.ts:212). Intentional pressure-on-rivals or oversight? Document the design call.
- [C2] R28. Spec line 390 says "any family character" — implementation iterates ALL houses (including rivals/Independent) for officer-death AND Seduction multiplier. Plan should pin the broader interpretation (events are global per spec line 392).
- [C2] R29. Officer-death cascade may flip state.elopement to null + bump player-house scandal (P9 Branch 5 of pruneOrphanedConversationKeys); same-tick WarEffort + officer-as-elopement-sprint-target death composes multiple house mutations. Add to "Edge cases" section.
- [C2] R30. Strip-cascade composition pick: plan offers "cast OR widen generic" — cast path masks future field-shape drift, generic-widen is cleaner. Implementer's choice currently.
- [C3] R31. `GlobalEventId` import paths in plan snippets pointed to `entities.ts` instead of `rng.ts` (per CLAUDE.md branded-string convention). [likely addressed]
- [C3] R32. `MilitaryOfficer` trait has no acquisition path at v1 ship — wired-but-inert scaffolding scope. [likely addressed]
- [C3] R33. NEW import edge `entities.ts → fixtures/artifacts.ts` (for `ARTIFACT_FAMILIES` consumed by `GlobalEventSchema.favoredFamily`) — boundaries-allowed but unsurfaced in "What does NOT change." (Reviewer note: actually no risk — fixtures/artifacts.ts uses type-only `GameState` import, so no runtime cycle.)
- [C3] R34. `applyResearchFastCouriers` returns `{ ok: true; nextState: GameState }` — `applyThwartTheftPure` uses `{ ok: true; state: GameState }`. Cosmetic field-name divergence; both shapes accepted across rules layer.
- [C3] R35. Verification matrix #15/16 (transitTicks) does not enumerate the existing `courier.test.ts` test-update count (3 existing tests need new `(state, originatorHouseId)` parameters threaded through). `[applied]`
- [C3] R36. `dexie.ts` + `SettingsMenu.tsx` live-consumer edits missing from initial plan; `fromSaveV13` live load function not defined. [likely addressed]
- [C3] R37. Line 16 contradictory sub-clause about MilitaryOfficer "acquirable via existing tutor / location / maturation paths" — contradicts the wired-but-inert design intent pinned elsewhere. [likely addressed]
- [C3] R38. `toSaveV12` demotion snippet AND new `toSaveV13` snippet shipped bare object literals; live `toSaveV12` wraps in `SaveV12Schema.parse({...})` for runtime validation. [likely addressed]
- [C3] R39. Snippet line 728: `c.traits.includes("MilitaryOfficer")` may need `"MilitaryOfficer" as TraitId` cast or `MILITARY_OFFICER_TRAIT_ID: TraitId` typed constant for strict TS (branded-string vs raw string).
- [C3] R40. Inline `identityPhase` removal — verify no test-side reference to the removed identity function (e.g., `phaseOrderTracker.test.ts`).
- [C3] R41. Edge Cases section missing "same-tick WarEffort officer death + in-flight duel" entry. `[applied]`
- [C3] R42. Edge Cases section missing "same-tick WarEffort officer death + MonarchsMood favored-family equip check" (officer death applies before MonarchsMood read; dead-officer artifacts don't count via `c.alive` filter). `[applied]`
- [C3] R43. `getOrThrow(newChars, id)` mis-type for Map<CharacterId, Character>; switched to `.get()` + undefined-guard. [likely addressed]
- [C3] R44. `"MilitaryOfficer"` cast to `TraitId` for branded-string strict-TS compliance at officer-death + Seduction-multiplier sites. [likely addressed]
- [C3] R45. `RIVAL_HOUSE_IDS_SET intentionally NOT consulted` inline comment added to WarEffort/MarketCrash/MonarchsMood tick functions. [likely addressed]
- [C3] R46. `tick: result.nextState.tick` → `tick: stateBefore.tick` in `researchFastCouriers` direct-publish. [likely addressed]
- [C3] R47. Strip-cascade pick: generic-widen path committed (matches `stripEquippedArtifactsForLegacyEmit<T>` precedent). [likely addressed]
- [C3] R48. Verification matrix #4 pinned officer-seeding requirement explicitly. [likely addressed]
- [C3] R49. Migrate snippet simplified to `return toSaveV13(fromSaveV12Bare(save))`, matching v11-to-v12 precedent. [likely addressed]
- [C3] R50. `resolveSeduction` edit bullet header cites `schemes.ts:511-574` (spans both branches); narrow to `schemes.ts:567-573` (success branch only). `[applied]`
- [C3] R51. Verify `eslint-plugin-boundaries` config currently permits the new `entities.ts → fixtures/artifacts.ts` edge at plan time; otherwise import lands as CI break.
- [C3] R52. Cross-reference verification #4 (test seeds officers) with verification #30 (bootstrap asserts zero officers) so future maintainers can't break #30 by adding an acquisition path while making #4 redundant. `[applied]`
- [C1] R18. Vitest fixture for officer-death must explicitly seed at least one `MilitaryOfficer`-tagged character to exercise the draw path (bootstrap has zero, so test would pass vacuously).
- [C1] R19. `applyGlobalEventPhase` active-effects loop sorts events by `e.id.localeCompare`. With 3 max active events, kind-prefix sorts MarketCrash < MonarchsMood < WarEffort alphabetically. Document this in the test for "all 3 active simultaneously."
- [C1] R20. `makeHouse` test factory at `src/game/__test-utils__/factories.ts:95-124` MUST add `courierResearchEarned: false` to its literal or strict-TS tests fail. Plan currently doesn't enumerate this site. [likely addressed]
- [C1] R21. `buildRivalHouse` at `src/game/fixtures/rivals.ts:219-243` constructs a House literal; same enumeration issue as R20. [likely addressed]
- [C1] S1. Promote `MIGRATIONS` registry edit to top-level edit-list bullet. [likely addressed]
- [C1] S2. Drop `void extractPlayerSeed(save)` line from migrate_v12_to_v13. [likely addressed]
- [C1] S3. Replace `WEALTH_MIN/MAX/REPUTATION_MIN/MAX/SCANDAL_MIN/MAX` with literals `0/100`; wealth unclamped. [likely addressed]
- [C1] S4. Enumerate makeHouse + buildRivalHouse + seedIndependentHouse + player-house literal construction sites for `courierResearchEarned: false` literal additions. [likely addressed]
- [C1] S5. Replace TRAITS string-array snippet with object-array entry-append. [likely addressed]
- [C1] S6. Resolve "identityPhase module file is DELETED" to "inline function removed at tickOrchestrator.ts:34-36". [likely addressed]
- [C1] S7. Show full CLAUDE.md publisher-pin diff block (not substring-replace) enumerating membership sub-bullets. [likely addressed]
- [C1] S8. Persona TRAIT_LABEL_BY_ID Map auto-populates from TRAITS; document the cache-version stays at v4 decision. [likely addressed]
- [C1] S9. Show transitTicks call-site diff at whispers.ts:141 with the actual variable name for originatorHouseId. [likely addressed]
- [C1] S10. Pin UI chip placement (right header? left sidebar?) and per-kind color choices to avoid implementer guesswork. `[applied]`
- [C1] S11. Add a verification assertion that `ARTIFACT_FAMILIES` length parity holds (currently 7 entries) so future widenings don't silently break MonarchsMood's `drawInt` over the array. `[applied]`
- [C1] S12. Explicitly enumerate that all 12 `fromSaveV1..V12` wrappers need the same one-line `globalEvents: new Map()` addition. [likely addressed]
- [C1] S13. Verification matrix #25 should reference `src/game/schema-projection-selector-extension.test.ts:14` as the live test gate location. `[applied]`

