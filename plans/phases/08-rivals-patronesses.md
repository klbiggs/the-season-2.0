# P8 — Rival Houses, Patronesses & Duels

> Part of [The Season Master Plan](../MASTER.md). Prior: [P7 — Family, Marriage & Succession](./07-family-succession.md). Next: [P9 — Elopement Sprint Overlay](./09-elopement.md).

**Goal.** Three canonical rival houses with per-tick automated action loops, five patronesses with favor scores and ball-veto gating, four-faction pairwise tension counters, and the deterministic 12-exchange duel resolver wired to the P5 grievance ledger via a player-elected "demand satisfaction" action. Save format bumps to **v9** to carry three new top-level GameState Maps (`patronesses`, `rivalActors`, `factionTensions`) plus one new top-level Map (`duels`) AND the three canonical rival houses inside the existing `state.houses` Map. P8 REPLACES the P1 rival-action stub at `tickOrchestrator.ts:54` (slot 9) with a real `applyRivalActionPhase` and ADDS a new patroness erosion phase that runs before the rival roll. P8 ALSO adds three new pure-rule modules — `src/game/rules/rivals.ts`, `src/game/rules/patronesses.ts`, `src/game/rules/duel.ts` — and three new fixture files: `src/game/fixtures/rivals.ts`, `src/game/fixtures/patronesses.ts`, `src/game/fixtures/factions.ts`.

P8 is the first phase that widens `state.houses` beyond the player + Independent pair: three named rival houses (e.g., `House Ashford`, `House Beaumont`, `House Cavendish`) become full `House` entities with their own wealth, reputation, scandal, head-of-house character, generation counter, and associated character lists. The existing CLAUDE.md invariant "Characters / Houses / Marriages are never deleted; status flips only" carries over — rival houses persist for the campaign's lifetime, even after their head dies (succession picks an heir from the rival's associated characters, same as the player path). The P3 "audience-before-rival" §7 ordering contract becomes load-bearing for real at P8: the existing `MONARCH_AUDIENCE_RIVAL_HOSTILITY_DROP = 5` constant (currently an empty-loop stub) starts walking `state.rivalActors` and dropping hostility before the rival-action phase fires.

This phase introduces the project's first per-tick PRNG-consuming action AGAINST the player (whisper generation in P6 was player-initiated; staff cadences in P6 were autonomous but not adversarial). Determinism discipline carries over: rival action rolls use each rival's own `state.rng[rivalHouseId]` (initialized at bootstrap per-rival, deterministic seed) and consume `callCount` deterministically. The lex-sort-by-`HouseId` iteration discipline (CLAUDE.md "Lex-sort iteration over identifier Maps") applies to the rival-action loop AND the patroness-erosion loop. Rival actors are NOT promoted to XState v5 actor refs — same reasoning as P5's per-scheme actor decision (per-rival actors would multiply ref counts by N-rivals and complicate save/load serialization with no behavioral benefit). The `RivalActorState.lastActionTick` field + cooldown predicate in `applyRivalActionPhase` is the entire state machine.

**In scope.**

- **Save format bump to v9.** Adds **4 new top-level GameState Maps** + **3 canonical rival House entities** seeded into `state.houses` + **2 new entity types** (`PatronessRecord`, `RivalActorState`, `Duel`). Every field is hash-relevant; every new entry has a default and a strip-on-emit. Top-level additions:
  - `GameState.patronesses: Map<PatronessId, PatronessRecord>` — five hardcoded patroness records (id, displayName, favor `[0, 100]`, factionId). Seeded at bootstrap and on every legacy lift from the canonical fixture `PATRONESSES_FIXTURE`. Favor starts at 50 (spec §3 line 410). OQ #1 resolution: this Map is NOT cleared at succession — the heir inherits the same favor scores.
  - `GameState.rivalActors: Map<HouseId, RivalActorState>` — per-rival action-loop state (lastActionTick for cooldown gating). Keyed by rival's `HouseId` (the rival's House entity lives in `state.houses` keyed by the same id; `rivalActors` is the sibling Map carrying ONLY the action-loop fields). Seeded at bootstrap + legacy lift via `RIVAL_HOUSES_FIXTURE`.
  - `GameState.factionTensions: Map<FactionPairKey, number>` — pairwise tension counters, clamped `[0, 100]`. `FactionPairKey = ${FactionId}|${FactionId}` with lex-smaller faction first (e.g., `"FactionA|FactionB"` NEVER `"FactionB|FactionA"` — single canonical key per unordered pair). With 4 factions there are 6 unordered pairs, all pre-seeded at value 0. Diagonal (self-tension) is NOT stored.
  - `GameState.duels: Map<DuelId, Duel>` — every duel ever resolved (the entity persists past resolution, like schemes — never deleted, status flips only). Empty on fresh state + legacy lift. `DuelId` is a new branded string; companion `DuelIdSchema` in `rng.ts` with `.transform`.

  **Rival houses seeded into `state.houses`.** Three full `House` entities — same shape as the player and Independent houses — distinguished only by their presence in `state.rivalActors`. The full `HouseSchema` is reused; no Rival-specific schema. The rival's `headOfHouseCharacterId` points to a freshly-created character also seeded into `state.characters` (each rival ships with 3 associated characters: head + 2 family members per spec line 549 "associated character identifiers"). On bootstrap that's 3 rival houses × 3 characters = 9 new characters in `state.characters` (added to the 1 player + 5 Independent baseline = 15 total at fresh state).

- **`HouseSchema` widens at P8 — two new top-level Character/House fields (resolves B1 + R12).** P8 is the first phase to widen `HouseSchema` since P6 (which added `exiled`). Two new fields, both hash-relevant:
  - `House.hostility: z.number().int().min(0).max(100)` — applies to RIVAL houses (the activation-threshold predicate reads this field). For the player house and Independent house this field is permanently `0` (rivals never raise hostility against them in the v1 model — only against other rivals via faction tension, NOT via per-house hostility scores). Schema-side it's required on every `House` for shape uniformity; semantically it's load-bearing only on the 3 rival entries.
  - `House.factionId: FactionIdSchema` — every house carries a faction. Player house: `"faction-crown"`. Independent house: `"faction-crown"` (neutral; doesn't participate in faction politics at v1). Rival houses: per `RIVAL_HOUSES_FIXTURE` entry (each rival's faction populates one of the three non-crown factions).
  - The widening triggers the strip-on-emit cascade for `toSaveV1`..`toSaveV8` (every legacy emitter now strips BOTH new fields per the Strip cascade section); legacy lifters default `hostility: 0` and `factionId: "faction-crown"` for non-fixture houses, and read from `RIVAL_HOUSES_FIXTURE` for rival ids.
  - The widening is the reason the strip-on-emit section already enumerates `stripV9TopLevelFieldsForLegacyEmit` AND a per-house strip helper — the per-house helper strips these two new fields (PLUS rival entries by id) on every legacy emit.

  **Pre-shape inheritance cascade (resolves Cycle-3-Iter-5 B1 + Cycle-4-Iter-2 B3 edit-ordering).** **Edit ORDER MATTERS:** edit `HousePreV6Schema` (`schema.ts:98`) and `HousePreV7Schema` (`schema.ts:119`) FIRST to add the `hostility/factionId` omits; ONLY THEN derive `HouseForV6EmitSchema` from the post-edit `HousePreV7Schema`. If the implementer edits the derived `HouseForV6EmitSchema` first, the parent Pre-shape still contains the new required fields and the derivation silently inherits them. Verified at `src/persist/schema.ts:98,119`:
  - `HousePreV6Schema = HouseSchema.omit({ grievances: true, exiled: true })` — used by SaveV2/V3/V4/V5.
  - `HousePreV7Schema = HouseSchema.omit({ exiled: true })` — used by SaveV6.
  Both derivations SILENTLY inherit the new required `hostility` + `factionId` fields after the post-P8 `HouseSchema` widening — every legacy V2/V3/V4/V5/V6 save on disk lacks those fields, so `SaveV{N}Schema.parse(legacySave)` fails at the houses tuple. The pre-shape `.omit()` lists MUST be extended at P8:
  ```ts
  // src/persist/schema.ts:98 AFTER P8:
  const HousePreV6Schema = HouseSchema.omit({
    grievances: true,
    exiled: true,
    hostility: true,    // NEW at P8 — V2/V3/V4/V5 saves predate
    factionId: true,    // NEW at P8 — V2/V3/V4/V5 saves predate
  });
  // src/persist/schema.ts:119 AFTER P8:
  const HousePreV7Schema = HouseSchema.omit({
    exiled: true,
    hostility: true,    // NEW at P8 — V6 saves predate
    factionId: true,    // NEW at P8 — V6 saves predate
  });
  ```
  Symmetric emit-side (resolves Cycle-3-Iter-5 B2):
  - `HouseForV6EmitSchema` and `HouseForV7EmitSchema` (introduced above) already chain off `HousePreV7Schema` / `HouseSchema` respectively. Once `HousePreV7Schema` widens via the `hostility/factionId` omits above, `HouseForV6EmitSchema` inherits the omits automatically (no extra edit). `HouseForV7EmitSchema = HouseSchema.extend({ grievances: ... })` — this STILL has hostility/factionId. P8 EDIT: chain it through the same omit:
  ```ts
  const HouseForV7EmitSchema = HouseSchema.omit({
    hostility: true,
    factionId: true,
  }).extend({
    grievances: z.array(GrievancePreV9Schema),
  });
  ```
  `HouseForV8EmitSchema` already omits the two new fields (introduced explicitly in the nested-strip cascade section above). Confirmed correct.

  **Strip helper updates (resolves Cycle-3-Iter-5 B2).** Verified at `src/persist/schema.ts:142-184`:
  - `stripGrievancesForLegacyEmit` (`:142-153`), `stripV6FieldsForLegacyEmit` (`:155-171`), `stripExiledForLegacyEmit` (`:177-184`) all destructure-drop named fields + spread `...rest`. Post-P8 `HouseSchema` widening, `rest` includes `hostility` + `factionId` — these would leak into legacy save shapes (silent strip via Zod's default `.strip()` at parse time but a round-trip parity hazard for the `v1-to-v9-chain` assertion).
  - P8 EDIT: extend each helper's destructure to ALSO drop the two new fields. Example for `stripExiledForLegacyEmit`:
    ```ts
    function stripExiledForLegacyEmit(entries) {
      return entries.map(([id, h]) => {
        const { exiled: _e, hostility: _h, factionId: _f, ...rest } = h;
        return [id, rest as HousePreV7];
      });
    }
    ```
    Symmetric updates for `stripGrievancesForLegacyEmit` (drops `grievances, hostility, factionId`) and `stripV6FieldsForLegacyEmit` (drops the existing 5 P3 fields PLUS `grievances, hostility, factionId`). All three existing helpers gain `hostility` + `factionId` to their destructure lists.

  **Entity Zod schemas (new at P8 — declared in `src/game/entities.ts` next to the existing entity schemas).**
  ```ts
  // src/game/entities.ts (NEW at P8):
  export const PatronessRecordSchema = z.object({
    id: PatronessIdSchema,
    displayName: z.string(),
    favor: z.number().int().min(0).max(100),
    factionId: FactionIdSchema,
  });
  export type PatronessRecord = z.infer<typeof PatronessRecordSchema>;

  export const RivalActorStateSchema = z.object({
    houseId: HouseIdSchema,                       // same id as the House entity in state.houses
    factionId: FactionIdSchema,
    associatedCharacterIds: z.array(CharacterIdSchema), // per spec §4 line 549; updated on death cascade
    lastActionTick: z.number().int().nullable(),  // null = never acted; gates ACTION_COOLDOWN_TICKS predicate
  });
  export type RivalActorState = z.infer<typeof RivalActorStateSchema>;

  export const DUEL_STATUSES = ["Active", "Resolved"] as const;
  export const DUEL_OUTCOMES = ["ChallengerVictory", "DefenderVictory", "Stalemate"] as const;
  export const DUEL_CASUALTIES = ["Killed", "Wounded", "Unharmed"] as const;

  export const DuelSchema = z.object({
    id: DuelIdSchema,
    challengerCharacterId: CharacterIdSchema,
    defenderCharacterId: CharacterIdSchema,
    grievanceId: GrievanceIdSchema,                  // the grievance this duel resolves
    initiatedAtTick: z.number().int().nonnegative(),
    status: z.enum(DUEL_STATUSES),
    resolvedAtTick: z.number().int().nonnegative().nullable(),
    outcome: z.enum(DUEL_OUTCOMES).nullable(),       // null while Active
    loserCasualty: z.enum(DUEL_CASUALTIES),            // ALWAYS set: defaults to "Unharmed" at duel creation; flipped to "Killed"/"Wounded" on decisive resolve; stays "Unharmed" on Stalemate. Required (NOT nullable) per recurring R6 — null is structurally unreachable post-resolve and forced unnecessary narrowing.
    exchangesElapsed: z.number().int().min(0).max(12), // 0..12 cap (spec line 368)
  });
  export type Duel = z.infer<typeof DuelSchema>;
  ```

  **Grievance schema widens at P8 — adds NULLABLE `defendantCharacterId` (resolves B2 + Cycle-4-Iter-2 B1).** Verified at `src/game/entities.ts:48-56`, `GrievanceSchema` currently carries `perpetratorHouseId: HouseIdSchema` ONLY. `demandSatisfaction(grievanceId)` cannot derive "who fights whom" from this shape alone. P8 widens with a NULLABLE field:
  ```ts
  // src/game/entities.ts (P8 EDIT to existing GrievanceSchema):
  export const GrievanceSchema = z.object({
    id: GrievanceIdSchema,
    perpetratorHouseId: HouseIdSchema,
    // P8 ADDITION: the specific character on the perpetrator side who'd answer
    // for this grievance in a duel. NULLABLE because legacy V5..V8 grievances
    // were ALL player-perpetrated (verified: src/game/store.ts:677 FauxPas all
    // set ownerHouseId = PLAYER_HOUSE_ID; src/game/rules/schemes.ts:370
    // Sabotage's scheme.ownerHouseId is always PLAYER_HOUSE_ID at v1, held by
    // the target's house). Such grievances are NOT actionable via
    // demandSatisfaction (player can't sensibly duel themselves); they retain
    // defendantCharacterId: null. NEW post-P8 grievances created by rival-owned
    // schemes set this explicitly to the rival's aggressor character —
    // those ARE the v1 duel loop.
    defendantCharacterId: CharacterIdSchema.nullable(),
    source: z.enum(GRIEVANCE_SOURCES),
    schemeId: SchemeIdSchema.nullable(),
    recordedAtTick: z.number().int().nonnegative(),
    resolved: z.boolean(),
  });
  ```
  - **`demandSatisfaction` derives defender from grievance.** Wrapper reads `grievance.defendantCharacterId`. If `null` → typed rejection `{ kind: "LegacyGrievanceUnactionable" }` (legacy player-perpetrated grievance — not duelable). Otherwise reads `state.houses.get(grievance.perpetratorHouseId).headOfHouseCharacterId` for cross-checks; challenger is the PLAYER head.
  - **V8→V9 migration backfill (resolves Cycle-4-Iter-2 B1).** Legacy grievances created by P5/P6/P7 have NO `defendantCharacterId` AND they are ALL player-perpetrated (verified at the two construction sites). Seeding helper defaults them all to `defendantCharacterId: null`. The earlier "default to perpHouse head" approach (cycle-3 plan iteration) was semantically wrong: setting defendant=playerHead made `demandSatisfaction` resolve player-vs-self duels. Null defendant correctly marks legacy grievances as unactionable. Documented inline in `seedRivalsAndPatronessesIntoLegacyState`.
  - **Grievance-construction site edits (resolves Cycle-4-Iter-2 B2 — required by post-P8 schema widening).** Both existing sites must extend the literal with `defendantCharacterId` (otherwise TS compile fails — even though nullable, the field is required by Zod):
    - **`src/game/rules/schemes.ts:368-375`** (Sabotage completion): `defendantCharacterId: scheme.aggressorCharacterId` (always non-null per `SchemeSchema.aggressorCharacterId` required field). Player-perpetrated at v1; field is forward-looking for P11+ rival-demand-satisfaction.
    - **`src/game/store.ts:675-682`** (FauxPas completion in `sendBallroomMessage`): `defendantCharacterId: state.houses.get(PLAYER_HOUSE_ID).headOfHouseCharacterId` (the player head fired the faux-pas — at v1 no other player-house character has the ballroom-message affordance).
    - **P8 rival-owned OpenSabotage scheme completion** (new at this phase via `applyRivalActionPhase`'s OpenSabotage dispatch): `defendantCharacterId: scheme.aggressorCharacterId` (= rival head). **`selectAggressor` returns the head for empty-`acceptable` kinds** — verified live at `src/game/rules/schemes.ts:99-113`: the `if (acceptable.length === 0) { return ownerHouse.headOfHouseCharacterId }` branch fires for Sabotage (`SCHEME_PREREQUISITES.Sabotage = []`). The head-exclusion logic only applies in the archetype-gated branch (line 118-129), which Sabotage never enters. So rival-owned Sabotage's aggressor IS the rival head; the head-alive gate in `applyRivalActionPhase` (line 547) protects against the `selectAggressor` throw on dead head. This is the load-bearing site for actionable rival-perpetrated grievances; `demandSatisfaction` against these grievances IS the v1 duel loop.
  - **Nested-schema strip cascade for legacy load + emit paths (resolves Cycle-2 Iter-4 B1).** Verified at `src/persist/schema.ts:890`: `SaveV8Schema.houses = z.array(z.tuple([HouseIdSchema, HouseSchema]))` — live `HouseSchema` embeds live `GrievanceSchema`. The same chain applies to `SaveV5Schema`/`SaveV6Schema`/`SaveV7Schema`'s `HousePreV6/V7Schema` derivatives (which `.omit()` the post-P5 / post-P6 fields but inherit the live `GrievanceSchema` nesting because they're built via `HouseSchema.omit(...)`). After P8, the live `GrievanceSchema` has a NEW required field `defendantCharacterId` — every pre-P9 save on disk has grievances WITHOUT this field, so `SaveV{N≤8}Schema.parse(legacySave)` fails at load time with a Zod required-field error. The fix is the nested-schema strip cascade (mirrors the P6 HousePreV7Schema = HouseSchema.omit({exiled: true}) precedent at `schema.ts:117`):
    ```ts
    // src/persist/schema.ts (NEW at P8 — nested grievance strip):
    const GrievancePreV9Schema = GrievanceSchema.omit({ defendantCharacterId: true });
    type GrievancePreV9 = z.infer<typeof GrievancePreV9Schema>;

    // House shape that embeds the pre-V9 Grievance — used by every legacy save
    // schema's houses tuple (V5/V6/V7/V8). Inherits the existing HousePreV{N}
    // .omit() chain but ALSO swaps the grievances field's element schema.
    const HousePreV9Schema = HouseSchema.extend({
      grievances: z.array(GrievancePreV9Schema),
    });
    type HousePreV9 = z.infer<typeof HousePreV9Schema>;

    // Versioned-composition: only V6/V7/V8 keep grievances on-disk; V2/V3/V4/V5
    // already drop the grievances field entirely via the existing HousePreV4 /
    // HousePreV6 .omit({ grievances: true }) chain (verified at
    // src/persist/schema.ts:98 — HousePreV6Schema = HouseSchema.omit({
    // grievances: true, exiled: true })). So the new grievance-strip cascade
    // applies ONLY to V6/V7/V8 emit/parse — NOT to V2-V5.
    //
    // Verified live schema chain (src/persist/schema.ts):
    //   HousePreV4Schema  — used by SaveV2, SaveV3                (no exiled, no grievances, no P3 fields)
    //   HousePreV6Schema  — used by SaveV4, SaveV5                (no exiled, no grievances)
    //   HousePreV7Schema  — used by SaveV6                         (keeps grievances live, no exiled)
    //   HouseSchema       — used by SaveV7, SaveV8                 (keeps grievances live AND exiled live)
    //
    // P8 EDIT — compose the GrievancePreV9 swap onto V6/V7/V8 shapes (NOT V2-V5).
    // Exactly one shape per emit version (no alternatives):
    const HouseForV6EmitSchema = HousePreV7Schema.extend({                      // V6: grievances live, no exiled
      grievances: z.array(GrievancePreV9Schema),
    });
    const HouseForV7EmitSchema = HouseSchema.extend({                           // V7: grievances live, exiled live
      grievances: z.array(GrievancePreV9Schema),
    });
    const HouseForV8EmitSchema = HouseSchema.omit({                             // V8: predates P8's hostility + factionId
      hostility: true,
      factionId: true,
    }).extend({
      grievances: z.array(GrievancePreV9Schema),
    });
    // (Implementer: replace `HouseSchema` at SaveV6Schema's houses tuple with
    // HouseForV6EmitSchema; SaveV7Schema with HouseForV7EmitSchema;
    // SaveV8Schema with HouseForV8EmitSchema. No edits to SaveV2-V5 houses tuple.)
    ```
    Per-emitter strip site updates (extends the existing strip-on-emit cascade enumerated above):
    - **`SaveV2Schema` / `SaveV3Schema` / `SaveV4Schema` / `SaveV5Schema`** houses tuple value: NO grievance-strip cascade change at P8 (V2-V5 already omit grievances entirely via existing `HousePreV4Schema` standalone object + `HousePreV6Schema.omit({grievances})`). **BUT the per-house strip helpers DO need new-field drops at P8 (resolves Cycle-5 B3):** existing `stripV6FieldsForLegacyEmit` (V2/V3 emit, schema.ts:155-171) and `stripGrievancesForLegacyEmit` (V4/V5 emit, schema.ts:142-153) destructure-drop named fields and spread `...rest`. Post-P8 `HouseSchema` widening makes `rest` include `hostility` + `factionId` → those leak into V2-V5 emit shapes (`HousePreV4`/`HousePreV6` don't carry them, so Zod's default `.strip()` silently drops at parse time, but the migration runner's `outputSchema.parse` would re-mutate the result). **P8 EDIT — extend each strip helper's destructure list:**
      ```ts
      // stripV6FieldsForLegacyEmit (V2/V3 emit) AFTER P8:
      const { grievances: _g, exiled: _e, currentLocation: _cl, consecutiveTicksAtCurrentLocation: _cttcl,
              lastAudienceTick: _lat, wardrobeLastRefreshTick: _wlrt, blockadeBypassEarned: _bbe,
              hostility: _h, factionId: _f, ...rest } = h;  // NEW at P8: hostility + factionId added
      // stripGrievancesForLegacyEmit (V4/V5 emit) AFTER P8:
      const { grievances: _g, hostility: _h, factionId: _f, ...rest } = h;  // NEW at P8
      ```
      Already-extended `stripExiledForLegacyEmit` (V6 emit) gets the same `hostility, factionId` additions per the prior section. The contradiction between line-184 "NO change for V2-V5" and line-67 "extend strip helpers" (flagged in Cycle-5 B3) is resolved here: VALUES schema (HousePreV4/V6) unchanged; STRIP HELPERS extended.
    - **`SaveV6Schema` / `SaveV7Schema` / `SaveV8Schema`** houses tuple value: swap from current `HousePreV7Schema` / `HousePreV{N≥7}Schema` to the post-P8 `HousePreV{N}AndPreV9Schema` derivatives. These three save versions DO retain grievances on-disk, so the nested cascade DOES apply.
    - **NEW emit-side helper** `stripV9GrievanceFieldsForLegacyEmit(houses: ReadonlyArray<[HouseId, House]>): Array<[HouseId, House-with-grievances-pre-V9]>` strips `defendantCharacterId` from every grievance in every house's `grievances` array. Composes with the existing house-level strip helpers (e.g., `stripV9TopLevelFieldsForLegacyEmit` for top-level Map fields PLUS this one for nested Grievance fields). Applied ONLY by `toSaveV6` / `toSaveV7` / `toSaveV8` (NOT `toSaveV2`-`toSaveV5` per the V2-V5 no-change rule above).
    - **Load-side: legacy lifters preserve the GrievancePreV9 shape through Bare**. The Pre→live `House` construction at `src/persist/schema.ts:101` (`defaultHouseV6Fields`) and `:124` (`defaultHouseV7Fields`) currently does `{ ...h, exiled: false }` etc. — the spread preserves whatever shape `h.grievances` has. Post-P8, the live `House.grievances: z.array(GrievanceSchema)` requires the new `defendantCharacterId` field on every entry, but the lifted Pre-V9 grievances DON'T have it (the field was omitted via `GrievancePreV9Schema.omit({defendantCharacterId: true})`). **P8 EDIT (resolves Cycle-4-Iter-3 B2):** extend `defaultHouseV6Fields` and `defaultHouseV7Fields` to map each grievance and default `defendantCharacterId: null` during the Pre→live lift:
    ```ts
    // src/persist/schema.ts:69 (defaultHouseV4Fields — V2/V3 lifter; STANDALONE z.object not derived from HouseSchema) AFTER P8:
    function defaultHouseV4Fields(h: HousePreV4): House {
      return {
        ...h,
        currentLocation: "Capital",
        consecutiveTicksAtCurrentLocation: 0,
        lastAudienceTick: null,
        wardrobeLastRefreshTick: null,
        blockadeBypassEarned: false,
        grievances: [],                          // P5: existing; V2/V3 saves predate grievances entirely
        exiled: false,                           // P6: existing
        hostility: 0,                            // NEW at P8 (HouseSchema widening) — defaults for all legacy V2/V3 houses
        factionId: "faction-crown" as FactionId, // NEW at P8 — non-fixture houses default to crown
      };
    }
    // src/persist/schema.ts:101 (defaultHouseV6Fields — V4/V5 lifter; HousePreV6Schema = HouseSchema.omit) AFTER P8:
    function defaultHouseV6Fields(h: HousePreV6): House {
      return {
        ...h,
        exiled: false,
        hostility: 0,                            // NEW at P8 (HouseSchema widening)
        factionId: "faction-crown" as FactionId, // NEW at P8 (HouseSchema widening)
        grievances: h.grievances.map(g => ({ ...g, defendantCharacterId: null as CharacterId | null })),  // NEW at P8 (GrievanceSchema widening)
      };
    }
    // src/persist/schema.ts:122 (defaultHouseV7Fields — V6 lifter; HousePreV7Schema = HouseSchema.omit) AFTER P8:
    function defaultHouseV7Fields(h: HousePreV7): House {
      return {
        ...h,
        hostility: 0,                            // NEW at P8 (HouseSchema widening)
        factionId: "faction-crown" as FactionId, // NEW at P8 (HouseSchema widening)
        grievances: h.grievances.map(g => ({ ...g, defendantCharacterId: null as CharacterId | null })),  // NEW at P8 (GrievanceSchema widening)
      };
    }
    ```
    **All THREE default-house helpers extended (resolves Cycle-5 B2 + B3).** Previously the plan said "V2-V5 needs no change" — that was incorrect. The actual lift chain at `src/persist/schema.ts:69, 101, 122` shows three distinct helpers (`defaultHouseV4Fields` for V2/V3, `defaultHouseV6Fields` for V4/V5, `defaultHouseV7Fields` for V6) and EACH constructs a live `House` literal — each must default `hostility` + `factionId` post-P8 because `HouseSchema` now requires them. Without these edits, every legacy V2/V3/V4/V5/V6 load fails Zod parse at the lift site.
    Then `seedRivalsAndPatronessesIntoLegacyState` is idempotent w.r.t. the defendant field (every legacy grievance is now `null`-defaulted; seeder leaves them alone — they're correctly unactionable). The seeder still fires for the rival/patroness/faction Maps that ARE its concern; it does NOT need to touch grievance defendants any more. The lift applies to V6/V7/V8 legacy loads only — V2-V5 lifters route through `liftLegacyHouses` which produces empty grievance arrays by default (no grievances → no lift edit needed).
  - The post-P8 `GrievanceSchema` is the new live shape; legacy `toSaveV{N≤8}` emitters strip `defendantCharacterId` via the nested cascade above. Per-step `outputSchema.parse` assertions in every migrate_v{N}_to_v{N+1}.test.ts catch any missed strip site.
  - `DUEL_STATUSES` is intentionally `["Active", "Resolved"]` only (NOT a per-outcome status); the `outcome` field discriminates resolved duels. Mirrors the P5 `Scheme.status` + `failureReason` pattern.
  - `loserCasualty` is REQUIRED `z.enum(DUEL_CASUALTIES)` (NOT nullable per line 103 — resolves Cycle-6-Iter-3 B2). Defaults to `"Unharmed"` at duel creation (Active status). Stays `"Unharmed"` on Stalemate. Decisive loss flips to `"Killed"` (50/50 roll → triggers `pruneOrphanedConversationKeys` death cascade) or `"Wounded"` (composure restored to a low value, narrative only — see Duel resolver section). The required-with-default form is the canonical shape; prior plan iterations contradicted between `.nullable()` and required — this is the single source of truth.

  **Branded id schemas in `rng.ts` (new at P8).** Three new brand-type aliases + companion `.transform` schemas, following the existing `SchemeId` / `GrievanceId` pattern:
  ```ts
  // src/game/rng.ts: ADD adjacent to existing brand-type declarations:
  export type PatronessId = string & { __brand: "PatronessId" };
  export type FactionId = string & { __brand: "FactionId" };
  export type DuelId = string & { __brand: "DuelId" };
  export type FactionPairKey = string & { __brand: "FactionPairKey" };

  // src/game/rng.ts: ADD after the existing brand-schema block:
  export const PatronessIdSchema = z.string().transform((s) => s as PatronessId);
  export const FactionIdSchema = z.string().transform((s) => s as FactionId);
  export const DuelIdSchema = z.string().transform((s) => s as DuelId);
  export const FactionPairKeySchema = z.string().transform((s) => s as FactionPairKey);
  ```
  **`makeFactionPairKey(a: FactionId, b: FactionId): FactionPairKey`** helper lives in `src/game/fixtures/factions.ts` (NOT in `rng.ts` — no PRNG consumption); lex-sorts the two faction ids and joins with `|`. Module-load assertion: `if (a === b) throw new Error("FactionPairKey requires distinct factions — diagonal not stored")`. Idempotent: `makeFactionPairKey(a, b) === makeFactionPairKey(b, a)` for any a≠b.

  **`makeDuelId(state: GameState, challengerId: CharacterId, defenderId: CharacterId): DuelId`** factory lives at `src/game/fixtures/duelIdFactory.ts` (mirrors `schemeIdFactory.ts` / `whisperIdFactory.ts` precedent). Format: `${challengerId}|${defenderId}|${state.tick}|${index}` where `index` is the per-(challenger, defender, tick) collision counter walking `state.duels.values()`. Lex-smaller challenger first if both directions count (player-as-challenger and player-as-defender are distinct duels).

- **`PATRONESSES_FIXTURE` (canonical 5 patronesses) at `src/game/fixtures/patronesses.ts`.** Per spec §3 line 113 "Five named arbiters of social access" — Regency-flavored names. Each carries a `factionId` from the 3-faction enum below; the spec frames patronesses as "affiliated with one of three named factions" (§3 line 119). With 5 patronesses and 3 factions, two factions get 2 patronesses each and one gets 1 (or any 2-2-1 split). Concrete fixture:
  ```ts
  export const PATRONESSES_FIXTURE: readonly PatronessRecord[] = [
    { id: "patroness-lady-jersey"     as PatronessId, displayName: "Lady Jersey",     favor: 50, factionId: "faction-ton"     as FactionId },
    { id: "patroness-lady-castlereagh" as PatronessId, displayName: "Lady Castlereagh", favor: 50, factionId: "faction-court"   as FactionId },
    { id: "patroness-lady-cowper"     as PatronessId, displayName: "Lady Cowper",     favor: 50, factionId: "faction-ton"     as FactionId },
    { id: "patroness-lady-sefton"     as PatronessId, displayName: "Lady Sefton",     favor: 50, factionId: "faction-country" as FactionId },
    { id: "patroness-mrs-drummond"    as PatronessId, displayName: "Mrs. Drummond Burrell", favor: 50, factionId: "faction-court" as FactionId },
  ] as const;
  ```
  Module-load assertion: `if (PATRONESSES_FIXTURE.length !== 5) throw new Error("Spec §3 requires exactly 5 patronesses");`. Used by bootstrap (`seedStartingFamily` extends to seed patronesses) and `seedRivalsAndPatronessesIntoLegacyState` (the V8→V9 migration's seeding helper).

- **`FACTIONS_FIXTURE` (4 factions) at `src/game/fixtures/factions.ts`.** Spec §3 line 12 in P8 plan reads "4 factions; pairwise tension counters cap at 100". Reconciles with spec §3 line 119 ("three named factions" for patronesses) — patronesses populate 3 of the 4 factions; the 4th is a player-faction or "Crown" that holds the player's own affiliation and never hosts a patroness. The plan locks in 4 factions to honor the in-scope statement, partition the rival houses cleanly (3 rivals × 1 faction-each leaves room for the player to be neutral), and produce 6 pairwise tension counters (4 choose 2 = 6).
  ```ts
  // src/game/fixtures/factions.ts (NEW at P8 — resolves B10):
  export const FactionSchema = z.object({
    id: FactionIdSchema,
    displayName: z.string(),
  });
  export type Faction = z.infer<typeof FactionSchema>;

  export const FACTION_IDS = [
    "faction-court"   as FactionId,    // Court / Whitehall — Lady Castlereagh, Mrs. Drummond Burrell
    "faction-ton"     as FactionId,    // High Society / Almack's — Lady Jersey, Lady Cowper
    "faction-country" as FactionId,    // Country gentry — Lady Sefton
    "faction-crown"   as FactionId,    // Crown / monarch-aligned — no patroness; reserved for the player house's neutral affiliation
  ] as const;

  export const FACTION_DISPLAY_NAMES: readonly string[] = [
    "Court", "Ton", "Country", "Crown",
  ] as const;

  export const FACTIONS_FIXTURE: readonly Faction[] = FACTION_IDS.map((id, idx) => ({
    id, displayName: FACTION_DISPLAY_NAMES[idx]!,
  }));
  ```
  `FactionSchema` is colocated with `FactionIdSchema` consumers but lives in `src/game/fixtures/factions.ts` (NOT `rng.ts`) per the project pattern: brand-id schemas live in `rng.ts`; entity/fixture schemas live next to their fixture data. Module-load assertion: `if (FACTIONS_FIXTURE.length !== FACTION_IDS.length) throw new Error("FACTIONS_FIXTURE length must match FACTION_IDS");`. `Faction` entities are NOT saved (factions are static fixture data, NOT runtime state); only `FactionId` values appear in save format (inside `HouseSchema.factionId`, `PatronessRecordSchema.factionId`, `RivalActorStateSchema.factionId`, and `FactionPairKey` strings).
  Module-load assertion: `if (FACTION_IDS.length !== 4) throw new Error("P8 plan requires exactly 4 factions for the 6-pair tension grid");`. The `FACTION_PAIRS` derived constant enumerates the 6 unordered pairs and is used by `createInitialState` / `seedRivalsAndPatronessesIntoLegacyState` to pre-seed `state.factionTensions` at value 0 per pair:
  ```ts
  export const FACTION_PAIRS: readonly FactionPairKey[] = (() => {
    const pairs: FactionPairKey[] = [];
    for (let i = 0; i < FACTION_IDS.length; i++) {
      for (let j = i + 1; j < FACTION_IDS.length; j++) {
        pairs.push(makeFactionPairKey(FACTION_IDS[i]!, FACTION_IDS[j]!));
      }
    }
    return Object.freeze(pairs);
  })();
  ```

- **`RIVAL_HOUSES_FIXTURE` (canonical 3 rivals) at `src/game/fixtures/rivals.ts`.** Per spec §3 line 130 "Three canonical rival houses". Each fixture entry is a `RivalHouseSeed`:
  ```ts
  export type RivalHouseSeed = {
    houseId: HouseId;
    displayName: string;
    factionId: FactionId;                                   // one of the three non-crown factions
    startingReputation: number;                             // [0, 100]; spec §3 line 402 "starting reputations"
    startingHostility: number;                              // [0, 100]; spec §3 line 402 "starting hostilities"
    startingWealth: number;                                 // unbounded; pinned per fixture entry
    headSeed: { characterId: CharacterId; name: string; gender: "Female" | "Male"; deathAge: number; traits: readonly TraitId[] };
    associatedSeeds: readonly [                             // 2 additional associated characters per rival
      { characterId: CharacterId; name: string; gender: "Female" | "Male"; deathAge: number; traits: readonly TraitId[] },
      { characterId: CharacterId; name: string; gender: "Female" | "Male"; deathAge: number; traits: readonly TraitId[] },
    ];
  };
  export const RIVAL_HOUSES_FIXTURE: readonly [RivalHouseSeed, RivalHouseSeed, RivalHouseSeed] = [
    {
      houseId: "rival-ashford" as HouseId, displayName: "House Ashford",
      factionId: "faction-court" as FactionId,
      startingReputation: 60, startingHostility: 10, startingWealth: 200,
      headSeed: {
        characterId: "rival-ashford-head" as CharacterId,
        name: "Lord Ashford", gender: "Male", deathAge: 82,
        traits: ["Cunning" as TraitId, "Sophisticated" as TraitId],
      },
      associatedSeeds: [
        { characterId: "rival-ashford-a1" as CharacterId, name: "Lady Ashford",      gender: "Female", deathAge: 78, traits: ["Vain" as TraitId, "Observant" as TraitId] },
        { characterId: "rival-ashford-a2" as CharacterId, name: "Charles Ashford",   gender: "Male",   deathAge: 75, traits: ["Brash" as TraitId] },
      ],
    },
    {
      houseId: "rival-beaumont" as HouseId, displayName: "House Beaumont",
      factionId: "faction-ton" as FactionId,
      startingReputation: 55, startingHostility: 15, startingWealth: 180,
      headSeed: {
        characterId: "rival-beaumont-head" as CharacterId,
        name: "Lord Beaumont", gender: "Male", deathAge: 77,
        traits: ["Frivolous" as TraitId, "Jaded" as TraitId],
      },
      associatedSeeds: [
        { characterId: "rival-beaumont-a1" as CharacterId, name: "Lady Beaumont",       gender: "Female", deathAge: 80, traits: ["Romantic" as TraitId] },
        { characterId: "rival-beaumont-a2" as CharacterId, name: "Penelope Beaumont",   gender: "Female", deathAge: 85, traits: ["Vain" as TraitId, "Frivolous" as TraitId] },
      ],
    },
    {
      houseId: "rival-cavendish" as HouseId, displayName: "House Cavendish",
      factionId: "faction-country" as FactionId,
      startingReputation: 50, startingHostility: 20, startingWealth: 150,
      headSeed: {
        characterId: "rival-cavendish-head" as CharacterId,
        name: "Lord Cavendish", gender: "Male", deathAge: 74,
        traits: ["Rustic" as TraitId, "ImpoverishedNobility" as TraitId],
      },
      associatedSeeds: [
        { characterId: "rival-cavendish-a1" as CharacterId, name: "Lady Cavendish",      gender: "Female", deathAge: 81, traits: ["Melancholic" as TraitId] },
        { characterId: "rival-cavendish-a2" as CharacterId, name: "Edmund Cavendish",   gender: "Male",   deathAge: 76, traits: ["Intellectual" as TraitId, "Observant" as TraitId] },
      ],
    },
  ] as const;
  ```
  Trait choices reference live `TraitId` values from `src/game/fixtures/traits.ts`; the implementer audits at `rg "export const TRAITS" src/game/fixtures/traits.ts` and confirms each picked id matches the live registry. No invented traits.

  **Full 17-field Character defaults at rival-character seed time (resolves R19/R21).** Bootstrap + V8→V9 migration BOTH call a shared `buildRivalCharacter(seed: RivalCharacterSeed, houseId: HouseId, role: Role, currentTick: number): Character` helper that produces a fully-defaulted `CharacterSchema`-shaped object. Defaults (one-line each):
  - `id` = `seed.characterId`; `houseId` = `houseId`; `name` = `seed.name`.
  - `birthTick` = `0` (matches the baseline NPC precedent at `src/game/fixtures/npcs.ts:84`). **`age` is set EXPLICITLY per role at construction time (resolves Cycle-3-Iter-5 B3 — `applyAgingStep` increments `char.age + 1` per year-pass and NEVER recomputes from birthTick, so the formula `age = state.tick - birthTick` would leave rival heads as newborns at bootstrap).** Pin per role:
    - HeadOfHouse rivals: `age = 35` (adult head, mid-life — capable of running OpenSabotage; matches baseline NPC `age: 25-40` range at `npcs.ts`).
    - Associated rivals with `role: "Dependent"` representing adult family: `age = 30` (Lady-X spouses, adult siblings).
    - Future P11+ can ship infant rival-house children via `birthTick: state.tick - 0` at conception time; v1 ships only adult rival-associated characters.
  The baseline NPC precedent at `npcs.ts:85` sets `age: 25` directly (NOT derived); `applyAgingStep` at `aging.ts:147` increments `char.age + 1` per year-pass. Pinning `age` explicitly at seed time mirrors that precedent.
  - `deathAge` = `seed.deathAge`; `alive` = `true`; `diedAtTick` = `null`.
  - `mood` = `"Receptive"`; `moodLockUntilTick` = `0`.
  - `role` = passed in (HeadOfHouse for the head entry; Dependent for the 2 associated).
  - `archetype` = `"None"` (P7 classifier doesn't extend to rival houses at v1).
  - `traits` = `seed.traits`.
  - `marriageId` = `null` (no rival marriages at v1; the `RIVAL_HOUSES_FIXTURE` doesn't seed marriage entries).
  - `composure` = `100`; `maxComposure` = `100`.
  - `happiness` = `100`; `temptationHookUnlocked` = `false`; `assignedTutorCharacterId` = `null`; `tutorBonusTraitGranted` = `false`; `dullSpouseExposureStartTick` = `null`.
  - `parentCharacterIds` = `null` (rival heads + associated have pre-history parents per the baseline NPC precedent at `npcs.ts`).
  - `gender` = `seed.gender` (explicit per the seed; rival characters do NOT use `hashCharIdToGender` because the seed authors gender directly — same as `BASELINE_NPCS` for the Independent house).

  The shared helper lives at `src/game/fixtures/rivals.ts` next to `RIVAL_HOUSES_FIXTURE`; both bootstrap (`seedStartingFamily`) and the V8→V9 migration (`seedRivalsAndPatronessesIntoLegacyState`) import it. **Test pin:** the bootstrap-vs-legacy-lift parity test (`v1-to-v9-chain.test.ts`) catches any drift between the two callers' field defaults — both paths construct identical Character entities for the 9 rival characters.
  Module-load assertion: `if (RIVAL_HOUSES_FIXTURE.length !== 3) throw new Error("Spec §3 line 130 requires exactly 3 canonical rivals");` plus a faction-coverage assertion ensuring each non-crown faction has exactly one rival.

  **Per-rival RNG callCount inventory (resolves Cycle-5 B4).** Per-rival RNG entries are consumed by MULTIPLE rule paths at P8+, not just `applyRivalActionPhase`. Inventory:
  1. **`applyMoodDriftPhase`** (`src/game/rules/moods.ts:60-89`) — iterates ALL houses including rivals (verified live; no PLAYER_HOUSE_ID filter), drawing per-house per-character for the 15% reroll. With each rival shipping 3 associated characters (head + 2), each rival's RNG consumes ~3 draws per tick (one per character's reroll-or-skip decision, gated by mood-lock). This is INTENTIONAL — rivals should have mood drift like all characters. Per-tick budget per rival: ~3 draws.
  2. **`applyRivalActionPhase`** (P8): 1 draw per eligible tick (the weighted-pick draw). Eligibility gated by activation threshold + cooldown + head-alive + player-not-exiled. Per-tick budget: 0 or 1 draws.
  3. **`resolveDuel`** (P8): up to 13 draws per duel (12 parry + 1 casualty) — BUT consumed on the CHALLENGER's RNG (typically player); rival's RNG is untouched when the player is the challenger. If a rival is ever the challenger (Out-of-scope at v1 per the "NPC-initiated duels" deferral), this would draw from rival's RNG.

  **Cumulative per-rival callCount per tick: ~3 (mood drift) + 0-1 (rival action) = ~3-4 draws/tick.** Over a 1000-tick campaign that's 3000-4000 draws per rival — well within `seedrandom@3.0.5`'s deterministic period. The 30-run hash-stability NFR (§8) is preserved because every draw is deterministic from the per-rival seed.

  **Verification test pin (line ~1145):** "rival action pool distribution... ±3%" requires understanding the per-rival RNG is post-mood-drift, not initial. The test fixture either (a) runs full PHASES to advance mood drift naturally, or (b) directly mutates `state.rng.get(rivalId).callCount` to a known offset before invoking `applyRivalActionPhase` in isolation. Pin the (a) approach in the test for fidelity to production.

  **Per-rival RNG seeding (resolves B6 + Cycle-6-Iter-1 B4 bootstrap-parity).** Each rival house gets its own `state.rng[rivalHouseId]` entry initialized via:
  ```ts
  // BOTH paths derive identical seed strings (the load-bearing parity contract):
  rngState = createRngState(`${campaignSeed}|${rivalHouseId}`);
  ```
  **Bootstrap path (`src/game/bootstrap.ts`):** `seedStartingFamily` currently accepts `RngState`-like seed input — verified at `bootstrap.ts:29` it threads via `createRngState(seed)`. P8 EDIT: the bootstrap caller (`createInitialState` at `src/game/store.ts`) ALREADY accepts a `seed: string` argument as its first parameter (verified at `store.ts` — the campaign seed is the original string from which the player RNG is seeded). `createInitialState` threads this string into `seedStartingFamily` AS the `campaignSeed`. The rival-seeding helper invoked from bootstrap uses the SAME string-concat form: `createRngState(\`${campaignSeed}|${rivalHouseId}\`)` per rival.

  **Legacy-lift path (`src/persist/schema.ts`):** `extractPlayerSeed(save.rng)` at `schema.ts:401` returns the ORIGINAL seed string used at campaign creation (pre-any-draws). Verified: `extractPlayerSeed` returns `rng.find(([id]) => id === PLAYER_HOUSE_ID).seed` (the `seed` field is the original string, NOT the post-draw `callCount`). So `seedRivalsAndPatronessesIntoLegacyState(state, playerSeed)` receives the same string at migration time that bootstrap had at fresh-state time.

  **Parity contract:** `createInitialState(seed, ...)` and the V8→V9 migration both produce identical rival RNG entries because they BOTH derive the seed from the SAME canonical campaign-seed string AND use the SAME `${campaignSeed}|${rivalHouseId}` format. The `v1-to-v9-chain.test.ts` parity assertion verifies bit-equality across all 3 rival RNG slots between bootstrapped and migrated states. **Pre-condition for the contract:** `extractPlayerSeed` MUST return the pre-draw seed string (NOT the post-draw `callCount` value); the helper's implementation at `schema.ts:401` already does this — implementer audits at code time to confirm `state.rng[PLAYER_HOUSE_ID].seed` is the original string.
  **String-concatenation form is load-bearing** — `createRngState` already accepts a string seed (verified at `src/game/rng.ts`), and string-hashing inside `seedrandom` is hash-stable across V8 engine minor versions. Arithmetic forms (`campaignSeed * 31 + hashString(...)`) are NOT stable: JavaScript `*` over the 32-bit integer range produces engine-sensitive results when either operand exceeds 2^31. The `${campaignSeed}|${rivalHouseId}` literal — with a `|` separator that cannot appear in either substring per the `HouseId` brand-format — produces a unique deterministic seed per rival per campaign. Bootstrap and the V8→V9 migration MUST use the IDENTICAL string format (load-bearing for the `v1-to-v9-chain.test.ts` parity assertion). All rival action draws (action-pool weighted choice, OpenSabotage target pick, LeakWhisper target subject pick) consume this per-rival RNG. The player's RNG is NEVER touched by rival actions — the determinism contract requires each house to own its own draw stream.

  **Rival houses + their characters seeded at bootstrap.** `seedStartingFamily` (currently at `src/game/bootstrap.ts`) extends to ALSO seed 3 rival houses + their 9 associated characters into `state.houses` and `state.characters`. Each rival house's head gets `role: "HeadOfHouse"`; the 2 associated characters get `role: "Dependent"`. All 9 rival characters get `archetype: "None"` at P8 (P7's archetype classifier doesn't know about rival families and shouldn't — classification is owned by the family-side branch). A future phase that wants per-rival-character archetypes must extend `classifyArchetype` to be house-aware.

- **Schema↔projection↔selector↔overwriteFromGameState quad-sync (CLAUDE.md non-negotiable).** Four NEW top-level GameState fields (`patronesses`, `rivalActors`, `factionTensions`, `duels`) trip the keyset extension test at `src/game/schema-projection-selector-extension.test.ts`. Required edits to ALL FOUR surfaces:
  1. `GameStateSchema` (`src/game/entities.ts`): append four new `z.map(...)` entries.
  2. `hashableState` (`src/game/hash.ts`): extend the projection with the four new keys (serialized via `serializeRegistry` — same lex-sort discipline as existing Maps).
  3. `selectGameState` (`src/game/store.ts`): extend the selector to include the four new keys.
  4. `overwriteFromGameState` (`src/game/store.ts`): extend with `draft.patronesses = next.patronesses; draft.rivalActors = next.rivalActors; draft.factionTensions = next.factionTensions; draft.duels = next.duels;`. **Forgetting this fourth surface silently CLEARS the four new Maps on every tick-advancing store action** per the CLAUDE.md `overwriteFromGameState` warning (confirmed at P7 as a real regression risk via `replace-state.test.ts`).

  `replace-state.test.ts` gains FOUR new `it(...)` blocks (one per Map) that seed a synthetic entry, fire a tick-advancing action (e.g., `travel`), and assert the entry survives. Per-Map blocks localize regression on a forgotten `draft.X = next.X` write.

- **`migrate_v8_to_v9` and lifter discipline.** Pure function `(SaveV8) → SaveV9` at `src/persist/migrations/v8-to-v9.ts`. Body follows the bare+wrap-then-reserialize pattern. **Helper signature pinned (resolves Cycle-4 B4): `seedRivalsAndPatronessesIntoLegacyState(state: GameState, playerSeed: string): GameState`** — the second arg is the campaign seed extracted via existing `extractPlayerSeed(state.rng)` at `src/persist/schema.ts:401`. Required because the per-rival RNG seed format `${campaignSeed}|${rivalHouseId}` needs `campaignSeed` recoverable from the save. Symmetric with `seedIndependentIntoLegacyState`'s signature precedent.
  ```ts
  export function migrate_v8_to_v9(save: SaveV8): SaveV9 {
    const bare = fromSaveV8Bare(save);
    const playerSeed = extractPlayerSeed(save.rng);
    const seeded = seedRivalsAndPatronessesIntoLegacyState(bare, playerSeed);
    return toSaveV9(seeded);
  }
  ```
  **P7-Maps passthrough (resolves Cycle-4 B3).** Verified at `src/game/entities.ts:312-314` + `src/persist/schema.ts:902-904`: `GameStateSchema` carries three P7 Maps (`proposalsLog`, `tutorAssignmentsLog`, `pendingTutorTraitChoices`) and `SaveV8Schema` carries their array-of-tuple forms. The new `fromSaveV8Bare` deserializes them via existing `deserializeRegistry` calls (no Bare-split body changes needed — the existing V8 deserializer already reads them). `seedRivalsAndPatronessesIntoLegacyState` does NOT touch them (they were V8-additions; every V8 save has them by schema). `toSaveV9` re-serializes them via existing `serializeRegistry` calls — they're SaveV9-passthrough fields. **No legacy-emit strip needed** for any of the three: V8 already carries them; V9 also carries them. The lift/migrate/emit chain threads them unchanged. Explicitly enumerate in plan to prevent silent-drop regression: `SaveV9Schema` includes `proposalsLog`, `tutorAssignmentsLog`, `pendingTutorTraitChoices` array-of-tuple entries by virtue of `extending` `SaveV8Schema`'s shape.
  Effects:
  - Adds three rival House entities to `state.houses` (via `RIVAL_HOUSES_FIXTURE`).
  - Adds 9 rival-associated Character entities to `state.characters` (via the per-rival `headSeed` + `associatedSeeds`). Each carries V8's gender/parents/happiness/etc. defaults (parents `null`; happiness 100; gender per the seed authored value).
  - Adds per-rival RNG entries to `state.rng` (3 new entries, one per rival house, seeded deterministically from the player seed + rival id).
  - Adds `state.patronesses` (5 entries via `PATRONESSES_FIXTURE`).
  - Adds `state.rivalActors` (3 entries derived from `RIVAL_HOUSES_FIXTURE`; `lastActionTick: null`).
  - Adds `state.factionTensions` (6 entries via `FACTION_PAIRS`, all at value 0).
  - Adds `state.duels` (empty Map).
  - Draw budget: **ZERO** — every field is a literal constant from a fixture; per-rival RNG seeds are deterministic from the player seed but do NOT consume any draws (the RNG entries are CREATED, not advanced). Asserted in `v8-to-v9.test.ts`: `expect(migrate_v8_to_v9(save).rng.find(([id, _]) => id === PLAYER_HOUSE_ID)?.[1]).toEqual(save.rng.find(([id, _]) => id === PLAYER_HOUSE_ID)?.[1])`. The migration adds NEW rng entries but never touches existing ones.
  - Idempotence assertion ships in `src/persist/migrations/v8-to-v9.idempotence.test.ts` via `assertMigrationIdempotent`.

  **`seedRivalsAndPatronessesIntoLegacyState` helper** lives in `src/persist/schema.ts` (private to lift/migrate boundary). Idempotent: every seed step structurally checks whether the target entity is already present before adding (e.g., `if (!state.houses.has("rival-ashford" as HouseId)) { /* add */ }`). Required because the legacy lifters (V1..V8) compose seeders OUTSIDE-IN per the CLAUDE.md "Bare+wrap lifter pattern" — the migration runner's per-step seeding + the public wrapper's seeding both invoke the helper, and only idempotence prevents double-seeding.

  **Bare+wrap lifter discipline (CLAUDE.md).** Required edits to the existing lifter chain at `src/persist/schema.ts`:
  - **NEW at P8**: `fromSaveV8Bare` (split off `fromSaveV8`) — pure deserialization, no seeding. Body mirrors the V7Bare pattern from P7 (deserialize all Maps; emit GameState directly).
  - **`fromSaveV8` (refactored at P8)**: composes `Bare → seedRivalsAndPatronessesIntoLegacyState`. The comment block at the existing `fromSaveV8` body ("V8 is the live format") MUST be updated to "V8 was the live format pre-P8; V9 is live at P8+." (mirrors the V7-comment update from P7).
  - **`fromSaveV1` through `fromSaveV7` public wrappers**: extend the composition to add `seedRivalsAndPatronessesIntoLegacyState` as the OUTERMOST seeder. **Verified: there is NO `seedV8FieldsIntoLegacyState` state-level helper at P7** (resolves Cycle-2 Iter-2 B1) — the actual V8 defaulting mechanism is per-character via `defaultV8CharacterFields` (`src/persist/schema.ts:217`) called inside the Bare core's `liftLegacyCharactersFromV8Pre` (`schema.ts:253`). Post-Bare-deserialization the GameState already has V8 character fields populated; no separate V8 state-level wrapper layer exists. **P8's wrapper composition therefore adds ONE new outer layer (the V9 seeder), NOT two.** Concrete post-P8 form for each existing wrapper (verbatim — each is a one-line wrap of the existing body):
    ```ts
    // src/persist/schema.ts — VERIFIED LIVE composition shape post-P7 (pre-P8):
    //   fromSaveV1: seedWhispers(seedSchemes(seedIndependent(Bare, playerSeed)))
    //   fromSaveV2: same as V1 but reads V2Bare
    //   fromSaveV3: same as V1 but reads V3Bare
    //   fromSaveV4: same as V1 but reads V4Bare
    //   fromSaveV5: seedWhispers(seedSchemes(V5Bare))       // no Independent — V5 already has it
    //   fromSaveV6: seedWhispers(V6Bare)                    // V6 already has schemes + grievances
    //   fromSaveV7: V7Bare directly (no seeders)            // V7 is the live format pre-P8
    //
    // P8 EDITS — wrap each with seedRivalsAndPatronessesIntoLegacyState OUTERMOST:
    export function fromSaveV1(save: SaveV1): GameState {
      return seedRivalsAndPatronessesIntoLegacyState(
        seedWhispersCouriersStaffIntoLegacyState(
          seedSchemesAndGrievancesIntoLegacyState(
            seedIndependentIntoLegacyState(fromSaveV1Bare(save), extractPlayerSeed(save.rng)),
          ),
        ),
      );
    }
    export function fromSaveV2(save: SaveV2): GameState {
      return seedRivalsAndPatronessesIntoLegacyState(
        seedWhispersCouriersStaffIntoLegacyState(
          seedSchemesAndGrievancesIntoLegacyState(
            seedIndependentIntoLegacyState(fromSaveV2Bare(save), extractPlayerSeed(save.rng)),
          ),
        ),
      );
    }
    // fromSaveV3, fromSaveV4: identical shape to V2 with their respective Bare core.
    export function fromSaveV5(save: SaveV5): GameState {
      return seedRivalsAndPatronessesIntoLegacyState(
        seedWhispersCouriersStaffIntoLegacyState(
          seedSchemesAndGrievancesIntoLegacyState(fromSaveV5Bare(save)),
        ),
      );
    }
    export function fromSaveV6(save: SaveV6): GameState {
      return seedRivalsAndPatronessesIntoLegacyState(
        seedWhispersCouriersStaffIntoLegacyState(fromSaveV6Bare(save)),
      );
    }
    export function fromSaveV7(save: SaveV7): GameState {
      // V7 was the live format pre-P8; gets ONLY the V9 seeder wrap.
      return seedRivalsAndPatronessesIntoLegacyState(fromSaveV7Bare(save));
    }
    export function fromSaveV8(save: SaveV8): GameState {
      // V8 was the live format pre-P8; gets ONLY the V9 seeder wrap (new Bare-split per the Bare+wrap section).
      return seedRivalsAndPatronessesIntoLegacyState(fromSaveV8Bare(save));
    }
    ```
    **Stale comment cleanup (resolves R3).** `src/game/fixtures/npcs.ts:98` and `src/game/fixtures/hashCharIdToGender.ts:5` carry stale references to a fictional `seedV8FieldsIntoLegacyState` helper (left over from a P7 plan draft that never shipped). P8 verification step: `rg "seedV8FieldsIntoLegacyState" src/` MUST return zero matches post-P8 (added to the Verification list).
  - **`fromSaveV9` (NEW at P8)**: pure deserialize directly via `deserializeRegistry(...)`. V9 saves contain the live `HouseSchema` (no widening at P8) AND the four new top-level Maps. NO Bare-split, NO seeding helper applies.

  **Mid-chain seed-and-strip waste at `migrate_v7_to_v8` and `migrate_v8_to_v9`.** Same intentional-discard pattern as P7's note: `fromSaveV{N<8}` now seeds rivals + patronesses; `toSaveV{N<9}` strips them on emission. The V8→V9 step re-seeds. Inline note in `migrate_v7_to_v8.ts` updated to mention the V9 seeders now ride through.

  Register in `src/persist/migrations/index.ts` after the existing `v7-to-v8` entry; `assertMonotonic(MIGRATIONS)` catches misregistration.

  **Per-step `outputSchema.parse` assertions** in every updated `migrate_v{N}_to_v{N+1}.test.ts` (P7 pattern continued). Particularly important for `migrate_v7_to_v8.test.ts` whose `toSaveV8` now strips V9 fields.

- **Save-version cutover — full edit list.** SaveV9 is the new live format:
  - **`src/persist/schema.ts`**: `SAVE_VERSION_CURRENT = 8 as const` → `SAVE_VERSION_CURRENT = 9 as const`.
  - **`src/persist/schema.ts` append** — new `SaveV9Schema`, `toSaveV9`, `fromSaveV9` block following the SaveV8 block. Schema extends SaveV8Schema with the 4 new top-level array-of-tuple entries.
  - **Strip-on-emit cascade.** Every `toSaveV{N}` for N < 9 must strip the 4 new top-level Maps before emission. Two strip helpers:
    - `stripV9TopLevelFieldsForLegacyEmit(state: GameState): Omit<GameState, "patronesses" | "rivalActors" | "factionTensions" | "duels">` — used by every `toSaveV{N<9}` after their existing strip steps.
    - The rival-House entities ALSO need to be stripped from `state.houses` before emit (legacy formats expect 2 houses, not 5). `stripRivalHousesForLegacyEmit(houses: ReadonlyArray<[HouseId, House]>): Array<[HouseId, House]>` filters out any house whose id is in the `RIVAL_HOUSES_FIXTURE` set. Similarly for `state.characters` (filter out rival-associated character ids).

    **The filter-by-id strip approach is the load-bearing alternative to a schema-omit strip.** Rival houses are full `House` entities — they don't have a marker field to detect. The id-filter relies on `RIVAL_HOUSES_FIXTURE`'s frozen id list as the canonical signal. **Module-load assertions** (declared in `src/game/fixtures/rivals.ts` and exported for use by the strip helpers; resolves recurring R11):
    ```ts
    // src/game/fixtures/rivals.ts (NEW exports at P8):
    export const RIVAL_HOUSE_IDS_SET: ReadonlySet<HouseId> = new Set(
      RIVAL_HOUSES_FIXTURE.map((r) => r.houseId),
    );
    export const RIVAL_CHARACTER_IDS_SET: ReadonlySet<CharacterId> = new Set(
      RIVAL_HOUSES_FIXTURE.flatMap((r) => [
        r.headSeed.characterId,
        ...r.associatedSeeds.map((s) => s.characterId),
      ]),
    );
    if (RIVAL_HOUSE_IDS_SET.size !== 3) throw new Error("RIVAL_HOUSE_IDS_SET must have exactly 3 entries (per spec §3 line 130)");
    if (RIVAL_CHARACTER_IDS_SET.size !== 9) throw new Error("RIVAL_CHARACTER_IDS_SET must have exactly 9 entries (3 heads + 6 associated)");
    // Per-rival RNG seed separator collision check (resolves recurring R16):
    for (const id of RIVAL_HOUSE_IDS_SET) {
      if (id.includes("|")) throw new Error(`RivalHouseId ${id} contains '|' — per-rival RNG seed format ${"`${campaignSeed}|${rivalHouseId}`"} requires no '|' in either substring`);
    }
    ```
    Strip helpers consume both sets — `stripRivalHousesForLegacyEmit` filters by `RIVAL_HOUSE_IDS_SET.has(id)`; `stripRivalCharactersForLegacyEmit` filters by `RIVAL_CHARACTER_IDS_SET.has(id)`.

    Per-emitter call-site updates (NINE emitter sites — `toSaveV1` through `toSaveV8` plus a defensive note in `toSaveV9` that the strip helper is NOT applied):
    - `toSaveV1`..`toSaveV8`: wrap the existing `serializeRegistry(state.houses)` call with `stripRivalHousesForLegacyEmit(serializeRegistry(state.houses))`; wrap the characters call analogously. Add the top-level strip via `stripV9TopLevelFieldsForLegacyEmit(state)` at the top of the body (replaces the bare `state` reference in subsequent field emissions).
    - `toSaveV9`: NO strip — V9 is the live format.
  - **`src/persist/dexie.ts`** — `SaveRecord.data` union widening to include `SaveV9`. `load()` final-parse callsite changes to `SaveV9Schema.parse`; return type `Promise<SaveV9 | undefined>`. Import `toSaveV9`, replace `toSaveV8` in the production write callsite. Audit: `rg 'SaveV8|toSaveV8|fromSaveV8' src/` post-cutover; expect only legacy-version-test hits.
  - **`src/main.tsx`** — rename `__buildSaveV8ForTests` → `__buildSaveV9ForTests` per the established rename precedent.
  - **`src/persist/migrations/index.ts`** — add `import { migrate_v8_to_v9 } from "./v8-to-v9";` and append the registration entry; `assertMonotonic(MIGRATIONS)` catches misordering.
  - **Test-file edit list:**
    - `src/persist/save-roundtrip.test.ts` — update both import and call to `fromSaveV9`.
    - `src/persist/migrations/v1-to-v8-chain.test.ts` — extend chain assertion to `runMigrations(saveV1, 1, 9, MIGRATIONS)` and lift via `fromSaveV9`. Add new `v1-to-v9-chain.test.ts` with the parity-invariant assertion: `expect(hashState(fromSaveV9(runMigrations(saveV1, 1, 9, MIGRATIONS)))).toBe(hashState(createInitialState(seed, DEFAULT_CAMPAIGN_NAME)))`. Load-bearing pieces: (a) `createInitialState` seeds rivals + patronesses + factionTensions + duels identically to the migration path; (b) per-rival RNG seeds are derived deterministically from the player seed in both paths; (c) `state.factionTensions` pre-seeds all 6 pairs at 0 in both paths.
    - `src/persist/dexie.test.ts` — add "fires InvalidSaveSchemaError when SaveV9 fields are malformed". Add corruption fixtures: patroness with `favor: -1` → reject; rivalActor with empty `houseId` → reject; faction tension > 100 → reject; duel with `exchangesElapsed: 13` → reject.

- **`src/game/constants.ts` extended.** New entries appended to the P1..P7 set. Inline comments cite spec section.
  - **`RIVAL_HOSTILITY_ACTIVATION_THRESHOLD = 25`** (spec §3 line 403 "A rival acts only when its hostility ≥ 25").
  - **`RIVAL_HOSTILITY_DECAY_PER_TICK = -1`** (spec §3 line 403 "passive decay -1/tick"). Clamped `[0, 100]` at the mutation site.
  - **`RIVAL_ACTION_COOLDOWN_TICKS = 8`** (spec §3 line 404). Predicate: `state.tick - rivalActor.lastActionTick >= RIVAL_ACTION_COOLDOWN_TICKS`. `lastActionTick === null` always passes the predicate (never-acted rivals can act immediately on first eligibility).
  - **`RIVAL_ACTION_WEIGHTS: Readonly<Record<RivalActionKind, number>>`** (spec §3 line 405):
    | RivalActionKind | base weight |
    |---|---|
    | `LeakWhisper` | `3` |
    | `PettySabotage` | `2` |
    | `OpenSabotage` | `2` |
    | `RaiseFactionTension` | `1` |
  - **`PETTY_SABOTAGE_REPUTATION_DELTA = -2`** (resolves accumulated C9). Per-PettySabotage reputation drop applied to the player house's `reputation` field. Clamped `[0, 100]` at the mutation site in the `dispatchRivalAction` PettySabotage branch (`acc.houses.set(PLAYER_HOUSE_ID, { ...playerHouse, reputation: clamp(playerHouse.reputation + PETTY_SABOTAGE_REPUTATION_DELTA, 0, 100) })`). Designer-tunable.
  - **`RIVAL_OPEN_SABOTAGE_TENSION_BIAS_SLOPE_SCALED = 5`** (integer; resolves recurring R10). Per-point of opposing-rival faction tension above 50, the OpenSabotage weight (in `RIVAL_WEIGHT_SCALE` units) grows by `SLOPE_SCALED * (tension - 50)`. Stored as INTEGER (not the 0.05 float form) to eliminate IEEE-754 cross-engine variance: `5 × 35 = 175` is exact; `0.05 × 35 = 1.7500000000000002` is platform-sensitive. Application in `computeEffectiveWeights`: `base_scaled = base × RIVAL_WEIGHT_SCALE; bias_scaled = maxOpposing > 50 ? SLOPE_SCALED × (maxOpposing - 50) : 0; effective_scaled = base_scaled + bias_scaled` — all integer arithmetic. At tension 100: OpenSabotage `effective_scaled = 2 × 100 + 5 × 50 = 450`; pool size `300 + 200 + 450 + 100 = 1050` → OpenSabotage ≈ 43% of pool (not "~50%" as some earlier draft prose claimed — resolves Cycle-5-Iter-2 B2 math contradiction). Verification target accordingly: "OpenSabotage frequency rises from ~25% baseline to ~43% at max tension, within ±3%." Designer-tunable.
  - **`RIVAL_WEIGHT_SCALE = 100`** (NEW pin at P8 — resolves Cycle-4 B6). Integer-scaling factor for the weighted-pick over float-derived weights. `pickByScaledWeight` multiplies each effective weight by 100 then floors (`Math.floor(w * RIVAL_WEIGHT_SCALE)`), producing integer pool sizes deterministically. At default base weights (`LeakWhisper=3, PettySabotage=2, OpenSabotage=2, RaiseFactionTension=1`) + no tension bias, scaled pool = `300 + 200 + 200 + 100 = 800`; at max tension bias (OpenSabotage = 4.5), scaled pool = `300 + 200 + 450 + 100 = 1050`. 100 chosen over 1000 because: (a) 1-percentage-point resolution per integer tension step is finer than playtest can distinguish; (b) smaller scale produces tighter modulo arithmetic on the per-rival RNG draw (drawNext returns `[0, 1)` × pool); (c) bias slope 0.05 × 100 = integer 5, never sub-integer.
  - **Player-action hostility deltas (spec §3 line 134).** Three deltas pinned:
    - **`PLAYER_SABOTAGE_HOSTILITY_DELTA = +15`** — applied to the targeted rival's hostility on Sabotage completion (P5 wires the hook; P8 pins the delta).
    - **`PUBLIC_FAUX_PAS_HOSTILITY_DELTA = +5`** — applied to ALL active rivals (hostility ≥ 25 OR ≥ threshold-after-bump) on FauxPas event (P4 wires the hook; P8 pins the delta). "Less than Sabotage" per spec.
    - **`MONARCH_AUDIENCE_RIVAL_HOSTILITY_DROP = 5`** — REUSED from `constants.ts:89` (existing P3 stub). At P8 this becomes load-bearing: applied to ALL rivals on full-success audience (spec §3 line 329 + line 134).
  - **`PATRONESS_FAVOR_INITIAL = 50`** (spec §3 line 410).
  - **`PATRONESS_FAVOR_EROSION_PER_TICK = -1`** (spec §3 line 411).
  - **`PATRONESS_FAVOR_EROSION_SCANDAL_THRESHOLD = 50`** (spec §3 line 411 "when house scandal ≥ 50").
  - **`PATRONESS_FAVOR_EROSION_TENSION_THRESHOLD = 50`** (spec §3 line 412 "doubles when faction tension toward her affiliation is ≥ 50").
  - **`PATRONESS_FAVOR_EROSION_DOUBLED_PER_TICK = -2`** — the doubled value when tension ≥ 50; clamping happens at the mutation site.
  - **`PATRONESS_FAVOR_AUDIENCE_BONUS = +5`** (spec §3 line 413). REUSED from `MONARCH_AUDIENCE_PATRONESS_BONUS` at `constants.ts:85` — the existing constant becomes the canonical name; this entry is the cross-reference. At P8 the empty-loop stub starts iterating `state.patronesses.values()`.
  - **`PATRONESS_VETO_THRESHOLD = 20`** (spec §3 line 414 "ball at the high-society location is vetoed when any single patroness's favor falls below 20").
  - **`FACTION_TENSION_CAP = 100`** (spec §3 line 406).
  - **`FACTION_TENSION_DELTA_PER_RAISE_ACTION = +10`** — applied per `RaiseFactionTension` rival action. Picks a deterministic faction pair (lex-smallest involving the rival's own faction, see Rival action resolver). Designer-tunable.
  - **`DUEL_INITIAL_COMPOSURE = 100`** (spec §3 line 366).
  - **`DUEL_BASE_POWER = 25`** (spec §3 line 367 + line 532).
  - **`DUEL_COMPOSURE_MULTIPLIER = 2`** (spec §3 line 367 "×2 composure multiplier").
  - **`DUEL_MAX_EXCHANGES = 12`** (spec §3 line 368).
  - **`DUEL_WOUNDED_COMPOSURE_RESTORATION = 25`** — the low value composure is restored to on the "wounded" branch (spec §3 line 370 "composure restored to a low value"). Designer-tunable.
  - **`DUEL_KILLED_VS_WOUNDED_PROBABILITY = 0.5`** (spec §3 line 370 "50/50 random draw"). Stored as a constant so the implementer doesn't inline-magic-number it. **Off-by-one convention pinned (resolves R28 / R14):** `const { next: casualtyRoll, rngState: postCasualty } = drawNext(rngState);` — `drawNext` returns `{ next: number; rngState: RngState }` (verified at `src/game/rng.ts:99`); `next` is in `[0, 1)`; `loserCasualty = (casualtyRoll < DUEL_KILLED_VS_WOUNDED_PROBABILITY ? "Killed" : "Wounded")`. The exact-0.5 draw maps to `"Wounded"` (>= 0.5 path). Documented inline at the resolver mutation site.
  - **`DUEL_PARRY_PROBABILITY = 0.5`** (NEW pin at P8 — resolves B7). Per-exchange parry roll: each exchange consumes one PRNG draw on the defender's behalf; `parryRoll < 0.5` → defender parries (zero composure damage that exchange); else → full damage lands. **Why parry-variance is necessary:** spec §3 lines 366-368 are internally inconsistent — with `DUEL_INITIAL_COMPOSURE = 100`, `DUEL_BASE_POWER = 25`, `DUEL_COMPOSURE_MULTIPLIER = 2` and no per-exchange variance, the loop terminates in 2 exchanges and the "12-exchange cap" is unreachable. Adding a per-exchange parry roll keeps the spec's base-power/multiplier numerics intact AND makes the 12-exchange stalemate statistically reachable. Expected damage per exchange = `0.5 × -50 = -25`; expected kill at exchange `100 / 25 = 4` (with high variance from the geometric distribution); 12-exchange stalemate happens in `P(stalemate) ≈ Σ binomial coefficients` — non-trivial probability per duel (target: ~5-10% stalemate rate over 1000 trials within tolerance). Spec §3 line 367 "conversation math" is interpreted here as "base damage modulated by per-exchange resistance" — the parry roll IS the per-exchange resistance check that maps to the conversation system's per-tactic outcome variance.
    - **PRNG draw budget revision:** the duel resolver consumes **up to 12 parry draws + 1 casualty draw = 13 draws max**. The previous "0 draws per exchange" claim is REVISED in light of B7's math gap. Determinism is preserved (same seed → same draws → same outcome); the harness 30-run hash stability NFR still holds because all draws consume the per-house RNG deterministically.
    - **Stalemate-rate math correction (resolves Cycle-6-Iter-3 B3).** With `DUEL_PARRY_PROBABILITY = 0.5` and -50 composure per landed hit, each duelist tolerates AT MOST 1 unparried hit (2 hits = -100 = composure 0). Over 6 attacks against them: `P(≤ 1 hit) = C(6,0)(0.5)^6 + C(6,1)(0.5)^6 = 7/64 ≈ 10.9%` per duelist; both survive: `(7/64)^2 ≈ 1.2%`. The earlier "~5-10% stalemate rate over 1000 trials" prose claim was wrong by an order of magnitude. **Stalemate verification at P8 uses `forceParryEveryExchange: true` (deterministic 100% stalemate by construction), NOT a statistical 1000-trial test.** The killed-vs-wounded 50/50 distribution test still runs over 1000 trials (it's an outcome-conditional check, NOT a stalemate-rate check). No statistical-stalemate test ships at P8; revisit at v1.5 if playtest shows stalemate frequency is interesting to tune.
  - **`DUEL_DEMAND_SATISFACTION_REPUTATION_COST = -5`** — small reputation cost for issuing a duel challenge (the "demand satisfaction" action). Designer-tunable; pinned to keep the action from being free-clickable.

  **Module-load assertions** adjacent to the new constants:
  ```ts
  if (PATRONESSES_FIXTURE.length !== 5) throw new Error("Spec §3 requires 5 patronesses");
  if (RIVAL_HOUSES_FIXTURE.length !== 3) throw new Error("Spec §3 requires 3 rival houses");
  if (FACTION_IDS.length !== 4) throw new Error("P8 plan locks 4 factions for 6-pair tension grid");
  if (FACTION_PAIRS.length !== 6) throw new Error("4 factions choose 2 = 6 unordered pairs");
  for (const kind of RIVAL_ACTION_KINDS) {
    if (RIVAL_ACTION_WEIGHTS[kind] <= 0) throw new Error(`Rival action ${kind} must have positive weight`);
  }
  if (DUEL_MAX_EXCHANGES !== 12) throw new Error("Spec §3 line 368 pins 12-exchange cap");
  ```

- **`RIVAL_ACTION_KINDS` enum extension** at `src/game/constants.ts`:
  ```ts
  export const RIVAL_ACTION_KINDS = ["LeakWhisper", "PettySabotage", "OpenSabotage", "RaiseFactionTension"] as const;
  export type RivalActionKind = (typeof RIVAL_ACTION_KINDS)[number];
  ```
  These are NOT entity types — they're the action-pool outcome enumeration consumed by the resolver. No save-format presence.

- **Pure rule `src/game/rules/rivals.ts` — `applyRivalActionPhase`.** Per-tick rule that walks `state.rivalActors` in lex-`HouseId` order and, for each rival passing the activation threshold AND cooldown predicate, rolls one weighted action from `RIVAL_ACTION_WEIGHTS`. The rule consumes the rival's own `state.rng[rivalHouseId]` — NEVER the player's RNG.

  **Per-iteration multi-Map accumulator pattern (resolves B11 — CLAUDE.md non-negotiable).** Each iteration may write to up to FIVE state Maps (`rivalActors`, `schemes`, `whispers`, `houses`, `factionTensions`) AND the rival's RNG entry (`rng`). Same bug-class as the P6 `applyStaffOutputsPhase` (canonical example at `src/game/rules/staff.ts`): without lazy-clone-and-write-back of every Map the NEXT iteration's factory call reads, two same-tick same-(source, subject) creations collide on factory index 0 (e.g., two rivals running LeakWhisper at the same tick both create whispers with index 0 if `whisperIdFactory` reads stale `state.whispers`).

  Required acc skeleton:
  ```ts
  export function applyRivalActionPhase(
    state: GameState,
    opts?: { cooldownOverride?: number },  // NEW at P8 (resolves accumulated C1): test-only seam; default undefined uses RIVAL_ACTION_COOLDOWN_TICKS. Verification distribution-test passes { cooldownOverride: 0 } to fire every tick.
  ): GameState {
    // Lazy-clone accumulator. Cloned ONCE per Map on first write; subsequent
    // writes mutate in place. All factory calls inside the loop read from
    // `acc.*` (NEVER `state.*`) so cross-iteration collisions are impossible.
    // Acc type promoted to MODULE SCOPE (resolves Cycle-5-Iter-4 B1) so
    // `dispatchRivalAction` (module-scope helper) can reference it as a
    // parameter type. Declared at the top of src/game/rules/rivals.ts:
    //   type Acc = { rivalActors: Map<HouseId, RivalActorState> | null;
    //                schemes: Map<SchemeId, Scheme> | null;
    //                whispers: Map<WhisperId, Whisper> | null;
    //                couriers: Map<CourierPayloadId, CourierPayload> | null;
    //                houses: Map<HouseId, House> | null;
    //                factionTensions: Map<FactionPairKey, number> | null;
    //                rng: Map<HouseId, RngState> | null; };
    const acc: Acc = { rivalActors: null, schemes: null, whispers: null, couriers: null, houses: null, factionTensions: null, rng: null };

    // Iterate in lex-HouseId order (CLAUDE.md "Lex-sort iteration over identifier Maps").
    const sortedRivalIds = [...state.rivalActors.keys()].sort();
    for (const rivalId of sortedRivalIds) {
      const rival = (acc.rivalActors ?? state.rivalActors).get(rivalId)!;
      const rivalHouse = (acc.houses ?? state.houses).get(rivalId)!;

      // 1. Decay hostility (-1/tick, clamp [0,100]). Always mutates rivalHouse.
      //    Lazy-clone state.houses on first write of the loop.
      acc.houses ??= new Map(state.houses);
      acc.houses.set(rivalId, { ...rivalHouse, hostility: clamp(rivalHouse.hostility - 1, 0, 100) });
      // (Rivals never exile — spec §3 line 462; no exile gate.)

      // 2-3. Activation + cooldown + head-alive predicates read from acc.houses + acc.rivalActors.
      const postDecayHouse = acc.houses.get(rivalId)!;
      if (postDecayHouse.hostility < RIVAL_HOSTILITY_ACTIVATION_THRESHOLD) continue;
      const cooldownTicks = opts?.cooldownOverride ?? RIVAL_ACTION_COOLDOWN_TICKS;
      const cooldownReady = rival.lastActionTick === null
        || (state.tick - rival.lastActionTick) >= cooldownTicks;
      if (!cooldownReady) continue;
      // Head-alive gate (resolves Cycle-2 Iter-2 B4). selectAggressor inside
      // tryStartScheme throws unconditionally if the owner house's head is not
      // alive (src/game/rules/schemes.ts:103-110). Rivals that lose their head
      // become "heirless / dormant" per the Out-of-scope note — gate here so
      // OpenSabotage dispatch never reaches the throw site. state.characters is
      // read-stable across this loop (C6 invariant) so reading from `state`
      // directly is safe.
      const rivalHead = state.characters.get(postDecayHouse.headOfHouseCharacterId);
      if (rivalHead === undefined || !rivalHead.alive) continue;
      // Player-exile gate (resolves recurring R4). CLAUDE.md "Terminal-state
      // exile gate is per-action at the rule layer" — once exiled, every
      // player-mutating action is rejected. All four rival actions target the
      // player (LeakWhisper enqueues whispers about player chars; PettySabotage
      // drops player rep; OpenSabotage targets player head; RaiseFactionTension
      // indirectly damages player via patroness erosion). Skip the entire
      // dispatch for this rival on an exiled player. Cooldown does NOT burn
      // because exile is terminal and burning cooldown post-exile is wasted.
      const playerHouseForExileGate = state.houses.get(PLAYER_HOUSE_ID);
      if (playerHouseForExileGate?.exiled === true) continue;

      // 4. Integer-scaled weighted pick. computeEffectiveWeights returns ALREADY-SCALED integers
      //    (resolves R22 + Cycle-4 B5+B6 + recurring R10).
      const scaledWeights = computeEffectiveWeights(rival, acc.factionTensions ?? state.factionTensions);
      const poolSize = scaledWeights.reduce((a, b) => a + b, 0);
      // Lazy-clone state.rng on first RNG draw for this rival.
      acc.rng ??= new Map(state.rng);
      const rngState = acc.rng.get(rivalId)!;
      // drawNext returns { next: number; rngState: RngState } (object, NOT tuple) —
      // verified at src/game/rng.ts:99. Destructure with rename.
      const { next: roll, rngState: nextRng } = drawNext(rngState);
      acc.rng.set(rivalId, nextRng);
      const rollScaled = Math.floor(roll * poolSize);
      const pickedKind = pickByScaledWeight(scaledWeights, rollScaled, RIVAL_ACTION_KINDS);

      // 5. Dispatch. Each dispatcher mutates the acc Maps it touches AND returns
      //    a typed discriminated-union result. ALL factory calls (makeWhisperId,
      //    makeSchemeId, etc.) receive `acc.*` (NOT `state.*`) so per-iteration
      //    index counting is correct.
      const result = dispatchRivalAction(pickedKind, rival, postDecayHouse, acc, state, state.tick);

      // 6. Cooldown burns on ALL outcomes — Fired AND Skipped (resolves Cycle-2
      //    Iter-3 B2). Earlier draft burned only on Fired; that produces a
      //    deterministic wedge when an action terminally skips (e.g.,
      //    RaiseFactionTension picks a capped pair → returns Skipped → next
      //    eligible tick has the same deterministic weighted-pick → same skip
      //    indefinitely). Burning on Skipped lets the rival cycle the cooldown
      //    and re-roll after RIVAL_ACTION_COOLDOWN_TICKS; the weighted pick is
      //    deterministic per-tick but the next eligible tick has a different
      //    RNG state (because the prior roll advanced the per-rival callCount),
      //    so the next pick is different. Cooldown burning also matches spec
      //    §3 line 404 "cooldown timer advances even on defensive no-ops" — the
      //    no-op IS a defensive no-op when the rival rolls a terminally-skipped
      //    action. Implementation: burn cooldown unconditionally post-dispatch.
      acc.rivalActors ??= new Map(state.rivalActors);
      acc.rivalActors.set(rivalId, { ...rival, lastActionTick: state.tick });
      // result.kind === "Fired" vs "Skipped" remains the discriminator for
      // event publishing (publishRivalActionFired emits ONLY on Fired).
    }

    // Single rebuild at end. Each `acc.X ?? state.X` reuses the unchanged Map
    // reference if no iteration touched it (zero-allocation common case).
    return {
      ...state,
      rivalActors: acc.rivalActors ?? state.rivalActors,
      schemes: acc.schemes ?? state.schemes,
      whispers: acc.whispers ?? state.whispers,
      couriers: acc.couriers ?? state.couriers,                    // resolves Cycle-4 B1
      houses: acc.houses ?? state.houses,
      factionTensions: acc.factionTensions ?? state.factionTensions,
      rng: acc.rng ?? state.rng,
    };
  }
  ```
  **`dispatchRivalAction` helper** (same file). Return type pinned as discriminated union (resolves B2):
  ```ts
  type DispatchResult =
    | { kind: "Fired"; action: RivalActionKind }
    | { kind: "Skipped"; reason: "TargetDead" | "FactionTensionAtCap" | "PlayerHouseNotFound" | "OtherRejection" };

  function dispatchRivalAction(
    pickedKind: RivalActionKind,
    rival: RivalActorState,
    rivalHouse: House,
    acc: Acc,                                  // mutable accumulator
    state: GameState,                          // read-only fallback for unmutated Maps
    tick: number,
  ): DispatchResult { /* branch on pickedKind below */ }
  ```
  Branches lazy-clone the Map(s) they write. Note the inline `state.characters` is read-stable across the rival-action loop (the loop never mutates characters — resolves C6); other Maps MUST be threaded through acc.
  - **LeakWhisper**: lazy-clone `acc.whispers` AND `acc.couriers`. **The factory signatures `makeWhisperId(state: GameState, ...)` (verified at `src/game/fixtures/whisperIdFactory.ts:16`) and `makeCourierPayloadId(state: GameState, ...)` both take a `GameState`, NOT an accumulator (resolves Cycle-3 B3).** Reconstruct a synthetic `GameState` from acc BEFORE the factory call (same pattern as OpenSabotage's synthState above):
    ```ts
    const accStateForWhisper: GameState = {
      ...state,
      whispers: acc.whispers ?? state.whispers,
      couriers: acc.couriers ?? state.couriers,
    };
    const whisperId = makeWhisperId(accStateForWhisper, rivalHeadId, targetCharId);
    ```
    Same shape for `makeCourierPayloadId`. Enqueue inbound whisper about a player-house character (target picked by lex-`CharacterId` over `state.characters.values().filter(c => c.houseId === PLAYER_HOUSE_ID)` — characters Map is read-stable per the C6 invariant). Returns `{ kind: "Fired", action: "LeakWhisper" }`. If no player-house character is found (heir-less player house — recoverable error path), returns `{ kind: "Skipped", reason: "PlayerHouseNotFound" }`.
  - **PettySabotage**: lazy-clone `acc.houses`; drop `playerHouse.reputation` by `PETTY_SABOTAGE_REPUTATION_DELTA = -2` (NEW constant; clamp `[0, 100]`). No factory call. Returns `{ kind: "Fired", action: "PettySabotage" }`.
  - **OpenSabotage (resolves B1)**: reconstructs a synthetic `GameState` from the accumulator BEFORE calling `tryStartScheme` so the called helper reads post-mutation Maps:
    ```ts
    const accState: GameState = {
      ...state,
      houses: acc.houses ?? state.houses,
      schemes: acc.schemes ?? state.schemes,
      rng: acc.rng ?? state.rng,
      whispers: acc.whispers ?? state.whispers,
      factionTensions: acc.factionTensions ?? state.factionTensions,
      // state.characters is read-stable across the rival-action loop (no
      // character mutation in this phase per C6); pass through directly.
      // Future phase that adds character mutation MUST also propagate
      // acc.characters here — load-bearing invariant.
    };
    const result = tryStartScheme(accState, rival.houseId, {
      kind: "Sabotage",
      targetCharacterId: playerHeadId,
      skipWealthDeduction: true,
    });
    if (result.ok) {
      // Propagate ALL relevant result.state mutations (resolves Cycle-4 B2).
      // tryStartScheme always writes the owner house slot (even with
      // skipWealthDeduction: true the body at schemes.ts:287 returns a
      // freshly-cloned houses Map with the owner's slot rewritten — at v1 a
      // no-op identity write because wealthDelta=0, but defensively merge
      // result.state.houses to stay correct if a future phase extends
      // tryStartScheme to mutate additional house fields).
      acc.schemes ??= new Map(state.schemes);
      acc.schemes.set(result.schemeId, result.state.schemes.get(result.schemeId)!);
      acc.houses ??= new Map(state.houses);
      for (const [hid, h] of result.state.houses) {
        // Adopt every house from result.state — handles the owner-slot write
        // and any future cross-house schemes.ts mutations.
        if (acc.houses.get(hid) !== h) acc.houses.set(hid, h);
      }
      return { kind: "Fired", action: "OpenSabotage" };
    } else if (result.reason.kind === "TargetIsDead") {
      return { kind: "Skipped", reason: "TargetDead" };
    } else {
      // Any other rejection (MissingArchetype, WrongEra, InsufficientWealth, etc.)
      // collapses to "OtherRejection" — distinct from TargetDead for debug-trace
      // fidelity (resolves Cycle-7 B3). v1 has no archetype/era gates that apply
      // to rival OpenSabotage (Sabotage has empty acceptable archetypes, no era
      // requirement, skipWealthDeduction=true), so this branch is structurally
      // unreachable at P8 — kept as defense-in-depth for future phases adding
      // gates. The DispatchResult union widens to include "OtherRejection".
      return { kind: "Skipped", reason: "OtherRejection" };
    }
    ```
    **Why synthetic-GameState reconstruction over `tryStartScheme` widening:** `tryStartScheme`'s signature is consumed by 10+ call sites (P5/P7 player actions + tests) that all pass bare `GameState`. Widening would force every consumer to pass acc-like shapes they don't have, propagating accumulator threading across the whole codebase. Reconstruction is a 5-line spread cost per rival per tick (`O(rivals × ticks)` = small for v1's 3 rivals + ~1000 ticks/campaign). The cost is bounded; the alternative (widening) is structural.
  - **RaiseFactionTension (resolves B4 + Cycle-3-Iter-2 B3 clarification)**: **Single-pair pick per rival.** The rival lex-picks EXACTLY ONE opposing faction (per the rule below) and writes to THAT one tension pair. The rival does NOT re-pick an alternate pair if the lex-picked pair is at cap — the dispatcher returns `{ kind: "Skipped", reason: "FactionTensionAtCap" }` and the cooldown burns per the unconditional-burn discipline above. Same-rival cycles after cooldown will deterministically re-pick the same pair until per-rival RNG advance flips the weighted action to a different kind (LeakWhisper / PettySabotage / OpenSabotage). C10 still-open suggests a pre-filter zero-out in `computeEffectiveWeights` for cleaner UX. Implementation: lazy-clone `acc.factionTensions`; pick the lex-smallest faction in `FACTION_IDS` that is NEITHER `"faction-crown"` (player's neutral affiliation, unattackable by rivals) NOR `rival.factionId` (no self-tension). For Ashford (Court): candidates are `["faction-country", "faction-ton"]` (excludes crown + court); lex-smallest is `"faction-country"`. For Beaumont (Ton): candidates are `["faction-country", "faction-court"]`; lex-smallest is `"faction-country"`. For Cavendish (Country): candidates are `["faction-court", "faction-ton"]`; lex-smallest is `"faction-court"`. Compute `makeFactionPairKey(rival.factionId, opposingFactionId)`; add `FACTION_TENSION_DELTA_PER_RAISE_ACTION = +10`; clamp `[0, FACTION_TENSION_CAP]`. No factory call. Returns `{ kind: "Fired", action: "RaiseFactionTension" }` on success; `{ kind: "Skipped", reason: "FactionTensionAtCap" }` if the pair is already at `FACTION_TENSION_CAP = 100` (no-op).

  Spec §3 line 404 "cooldown timer advances even on defensive no-ops" is honored implicitly: a rival that never passes activation simply skips the entire roll (no `lastActionTick` write); the cooldown predicate `(state.tick - lastActionTick) >= COOLDOWN` continues to advance because `state.tick` increases each tick.

  **Private helper signatures (resolves Cycle-4 B5).** Two helpers live in `src/game/rules/rivals.ts` (private to file; not exported):
  ```ts
  // computeEffectiveWeights: returns ALREADY-SCALED integer weights. Walks
  // RIVAL_ACTION_KINDS in lex-pinned array order; OpenSabotage weight grows by
  // SLOPE_SCALED × (max opposing-faction tension - 50) when max tension > 50;
  // other kinds stay at base × RIVAL_WEIGHT_SCALE. ALL ARITHMETIC IS INTEGER —
  // no float multiplication in the determinism-relevant path. Result is a
  // `readonly number[]` of length RIVAL_ACTION_KINDS.length (=4), aligned by
  // index with RIVAL_ACTION_KINDS.
  function computeEffectiveWeights(
    rival: RivalActorState,
    factionTensions: ReadonlyMap<FactionPairKey, number>,
  ): readonly number[] {
    return RIVAL_ACTION_KINDS.map((kind) => {
      const baseScaled = RIVAL_ACTION_WEIGHTS[kind] * RIVAL_WEIGHT_SCALE;  // integer
      // RaiseFactionTension at-cap pre-filter (resolves accumulated C10): if the
      // rival's lex-pick opposing pair is already at FACTION_TENSION_CAP, zero
      // out the weight so the weighted-pick skips this kind entirely. Avoids
      // the wedge where the rival deterministically re-picks a terminal-skip
      // action every cooldown cycle until per-rival RNG drifts elsewhere.
      if (kind === "RaiseFactionTension") {
        const opposingFactionId = lexPickOpposingFaction(rival.factionId);
        if (opposingFactionId !== null) {
          const pairKey = makeFactionPairKey(rival.factionId, opposingFactionId);
          if ((factionTensions.get(pairKey) ?? 0) >= FACTION_TENSION_CAP) return 0;
        }
        return baseScaled;
      }
      if (kind !== "OpenSabotage") return baseScaled;
      // Find max opposing-faction tension (over non-self non-Crown factions).
      let maxOpposing = 0;
      for (const fid of FACTION_IDS) {
        if (fid === rival.factionId || fid === "faction-crown") continue;
        const pairKey = makeFactionPairKey(rival.factionId, fid);
        const t = factionTensions.get(pairKey) ?? 0;
        if (t > maxOpposing) maxOpposing = t;
      }
      const biasScaled = maxOpposing > 50 ? RIVAL_OPEN_SABOTAGE_TENSION_BIAS_SLOPE_SCALED * (maxOpposing - 50) : 0;
      return baseScaled + biasScaled;
    });
  }

  // pickByScaledWeight: deterministic index pick from a roll in [0, poolSize).
  // Walks the scaled weights cumulatively and returns the kind whose cumulative
  // sum first exceeds rollScaled. Edge case: rollScaled === poolSize - 1 returns
  // the last kind (Math.floor(rollScaled) is strictly < poolSize when poolSize > 0).
  function pickByScaledWeight(
    scaledWeights: readonly number[],
    rollScaled: number,
    kinds: typeof RIVAL_ACTION_KINDS,
  ): RivalActionKind {
    let cumulative = 0;
    for (let i = 0; i < scaledWeights.length; i++) {
      cumulative += scaledWeights[i]!;
      if (rollScaled < cumulative) return kinds[i]!;
    }
    // Defensive: should never reach here if poolSize > 0; return last kind.
    return kinds[kinds.length - 1]!;
  }
  ```
  **Why this is the terminal slot in PHASES.** CLAUDE.md non-negotiable "Rivals always run last" — the rival roll must not perturb earlier seeded outcomes. The existing slot 9 `identityPhase` in `tickOrchestrator.ts:54` is replaced by `applyRivalActionPhase` — single-line edit to the PHASES array; no slot reordering. Spec §3 + the `phaseOrderTracker` tests will catch any accidental reorder.

  **OpenSabotage starts a P5-style Scheme entity (resolves B8 — explicit edit enumerated).** Walks `aggressorCharacterId: rival.headOfHouseCharacterId`; `targetCharacterId: playerHouse.headOfHouseCharacterId`; `kind: "Sabotage"`; `endsAtTick: state.tick + SCHEME_TUNING.Sabotage.durationTicks`. The scheme is added to `state.schemes` (same Map as player-owned schemes — `ownerHouseId` distinguishes them) and resolved by the existing `applySchemeResolutionPhase` at slot 5 on its end-tick.

  **`StartSchemeInput` widens with `skipWealthDeduction?: boolean` field (P8 edit to `src/game/rules/schemes.ts` — resolves B14).** Verified live signature at `src/game/rules/schemes.ts:169`: `tryStartScheme(state: GameState, ownerHouseId: HouseId, input: StartSchemeInput): StartSchemeResult`. The `StartSchemeInput` type at `src/game/rules/schemes.ts:46-49` is `{ kind: SchemeKind; targetCharacterId: CharacterId | null }`. The result type is `StartSchemeResult` (`src/game/rules/schemes.ts:67`), NOT `SchemeStartResult`. P8 widens the input type — NOT the function arity — so all existing 3-arg call sites at `src/game/store.ts:848` and the 9 test sites at `src/game/rules/schemes.test.ts:84-191` remain valid:
  ```ts
  // src/game/rules/schemes.ts:46-49 (P8 EDIT — extend input type):
  export type StartSchemeInput = {
    kind: SchemeKind;
    targetCharacterId: CharacterId | null;       // null only for Smuggling
    skipWealthDeduction?: boolean;               // NEW at P8; default false → wealth deducted as before
  };

  // src/game/rules/schemes.ts:169 (signature UNCHANGED — only the body checks the new field):
  export function tryStartScheme(
    state: GameState,
    ownerHouseId: HouseId,
    input: StartSchemeInput,
  ): StartSchemeResult {
    // ... existing archetype / era / prerequisite / target-state precondition checks unchanged ...

    // VERIFIED LIVE shape at src/game/rules/schemes.ts:263-265 (single combined mutation):
    //   const newHouses = new Map(state.houses);
    //   newHouses.set(ownerHouseId, { ...ownerHouse, wealth: ownerHouse.wealth - cost });
    //
    // P8 EDIT (resolves Cycle-2 Iter-2 B2): gate the wealth check + delta on the new flag.
    // Cleanest refactor: keep the newHouses.set unconditional (always writes the owner
    // house slot) but compute the wealth delta conditionally. The "no-op write" is
    // structurally equivalent to omitting the write (Map.set with identical-shape value
    // is hash-equivalent because the inner object is shallow-cloned with the same field
    // values when delta === 0). Pre-flight insufficient-wealth check ALSO gated.
    const cost = SCHEME_TUNING[input.kind].wealthCost;
    const ownerHouse = getHouseOrThrow(state, ownerHouseId);
    if (input.skipWealthDeduction !== true) {
      if (ownerHouse.wealth < cost) {
        return { ok: false, reason: { kind: "InsufficientWealth", have: ownerHouse.wealth, need: cost } };
      }
    }
    const wealthDelta = input.skipWealthDeduction === true ? 0 : -cost;
    const newHouses = new Map(state.houses);
    newHouses.set(ownerHouseId, { ...ownerHouse, wealth: ownerHouse.wealth + wealthDelta });

    // ... existing scheme-construction (makeSchemeId, newScheme object, newSchemes set) unchanged ...

    return { ok: true, schemeId, state: { ...state, houses: newHouses, schemes: newSchemes } };
  }
  ```
  - **All existing P5/P7 call sites pass `StartSchemeInput` WITHOUT `skipWealthDeduction`** (optional field omitted; default is wealth-deducted). No call-site changes for any of the 10 existing consumers. Verified zero regressions at `src/game/store.ts:848` and `src/game/rules/schemes.test.ts:84-191`.
  - **`applyRivalActionPhase` calls `tryStartScheme(state, rivalHouseId, { kind: "Sabotage", targetCharacterId: playerHeadId, skipWealthDeduction: true })`** for OpenSabotage. Rivals bypass the wealth gate. Rival wealth stays cosmetic (visible in the Rivals tab at P14 but never decremented by rival actions).
  - **`InsufficientWealth` rejection cannot fire for rivals** — they bypass the check; the only remaining rejection paths are archetype-mismatch (rival heads have `archetype: "None"` at v1; Sabotage has empty `acceptable` archetype array per `SCHEME_PREREQUISITES.Sabotage = []`, so this passes), era-mismatch (Sabotage has no era requirement), target-dead (handled — rival skips and consumes cooldown anyway; see R35 resolution below).
  - **Verification:** P8 extends `tryStartScheme` unit tests with an additional `describe("skipWealthDeduction option")` block that asserts: (a) skip path doesn't decrement owner wealth, (b) skip path still respects archetype/era checks, (c) default `{}` still deducts. This is part of the P8 schemes.test.ts extension list.

  Future phases could model rival economies (rivals start a Sabotage only when wealth ≥ cost) but P8 treats rival wealth as cosmetic per the "Out of scope" rival-economy deferral.

- **Pure rule `src/game/rules/patronesses.ts` — `applyPatronessErosionPhase`.** New per-tick phase inserted at slot 9 (between happiness drift and the rival-action roll). The phase:
  1. Reads `state.houses.get(PLAYER_HOUSE_ID)?.scandal ?? 0` for the player house's scandal value. If the player house entry is missing (structurally impossible — the player house is seeded by bootstrap and never deleted per CLAUDE.md "Houses are never deleted; status flips only") the `?? 0` fallback returns state unchanged without throwing. Imports: `PLAYER_HOUSE_ID` from `src/game/rng.ts`.
  2. If `scandal < PATRONESS_FAVOR_EROSION_SCANDAL_THRESHOLD` → no-op (consume no PRNG draw; return state unchanged).
  3. Else: **deterministically picks ONE patroness via `state.tick % state.patronesses.size` over the lex-sorted patroness ids** (resolves B3 — no PRNG draw consumed). **Design call vs spec wording (resolves Cycle-3 B2):** spec §3 line 411 says "on one deterministically-picked patroness" — the spec leaves the deterministic-source-of-truth open. The plan picks `tick % size` over alternatives (lowest-favor patroness; patroness affiliated with highest-tension faction; RNG draw) because: (a) `tick` is already hash-relevant and cycles all 5 patronesses in 5 ticks, satisfying "deterministic from state" cleanly, (b) lowest-favor / highest-tension would create monotonic-collapse runaway feedback (once a patroness hits low favor, she keeps being picked, never recovering), (c) RNG-draw would introduce player-RNG drift per B3 below. The round-robin is the v1 design choice; a future v1.5 could revisit if playtest shows the round-robin pattern feels too mechanical. Concretely:
     ```ts
     const sortedPatronessIds = [...state.patronesses.keys()].sort();
     const pickedId = sortedPatronessIds[state.tick % sortedPatronessIds.length]!;
     ```
     **Why round-robin not RNG (resolves B3 + R43/R44 PRNG drift):** inserting a NEW player-RNG draw at slot 9 would shift the call-count of EVERY downstream consumer that uses the player RNG (P3 location-effects trait-grant rolls; P5 Seduction-discovery roll at scheme completion; future P9 elopement push roll; etc.). Every pre-P8 save reloaded under P8 would diverge from its prior PRNG trajectory — the migration cannot back-fill "what would have been drawn." Round-robin via `tick % size` is deterministic from the tick number alone (already hash-relevant), consumes ZERO PRNG draws, and produces the same canonical erosion target the spec asks for. Cycles through all 5 patronesses in 5 ticks of sustained-high-scandal, which matches the spec's "deterministically-picked" intent without introducing a non-deterministic input.
  4. For the picked patroness: compute the faction-tension lookup. **Design call (resolves Cycle-3-Iter-3 B2):** the lookup uses `makeFactionPairKey(rival.factionId, patroness.factionId)` for ANY rival whose `hostility >= RIVAL_HOSTILITY_ACTIVATION_THRESHOLD` (i.e., any "active" rival), iterating over `state.rivalActors` and picking the MAX tension across all qualifying rival↔patroness pairs. If the max tension ≥ `PATRONESS_FAVOR_EROSION_TENSION_THRESHOLD` (50), apply `PATRONESS_FAVOR_EROSION_DOUBLED_PER_TICK` (-2); else apply `PATRONESS_FAVOR_EROSION_PER_TICK` (-1). **Why active-rival aggregation over player-faction lookup:** the player house's `factionId = "faction-crown"` and `RaiseFactionTension` excludes Crown from the pair pool, so `makeFactionPairKey(playerFaction, patroness.factionId)` would always be 0 — making `PATRONESS_FAVOR_EROSION_DOUBLED_PER_TICK` dead code at v1. Reading from active rivals instead makes the doubled-erosion path naturally reachable: when Ashford (Court) sustains hostility ≥ 25 and pumps `RaiseFactionTension` over time, Court↔Ton tension reaches 50; Lady Jersey (Ton) and Lady Cowper (Ton) BOTH then erode at -2/tick (when picked by the round-robin). Implementation:
     ```ts
     // src/game/rules/patronesses.ts (step 4 lookup body):
     let maxTension = 0;
     for (const [, ra] of state.rivalActors) {
       const rivalHouse = state.houses.get(ra.houseId);
       if (rivalHouse === undefined || rivalHouse.hostility < RIVAL_HOSTILITY_ACTIVATION_THRESHOLD) continue;
       if (ra.factionId === picked.factionId) continue; // same-faction pair is self-tension; not stored
       const pairKey = makeFactionPairKey(ra.factionId, picked.factionId);
       const tension = state.factionTensions.get(pairKey) ?? 0;
       if (tension > maxTension) maxTension = tension;
     }
     const delta = maxTension >= PATRONESS_FAVOR_EROSION_TENSION_THRESHOLD
       ? PATRONESS_FAVOR_EROSION_DOUBLED_PER_TICK
       : PATRONESS_FAVOR_EROSION_PER_TICK;
     ```
  5. Clamp `[0, 100]`.
  6. NO publishing here — the diff helper at the store-action wrapper publishes a `PatronessFavorDropped` event (P14 ledger consumer).

  **PHASES array post-P8 (10 slots; rivals still last) — full `src/runtime/tickOrchestrator.ts` edit (resolves Cycle-4-Iter-5 B1):**
  ```ts
  // Import edits at src/runtime/tickOrchestrator.ts:21-27 (verified live: 6 existing imports):
  import { applyCourierAndStaffPhase } from "../game/rules/courier";
  import { applyEconomyPhase } from "../game/rules/economy";
  import { applyHappinessPhase } from "../game/rules/happiness";
  import { applyLocationEffectsPhase } from "../game/rules/locationEffects";
  import { applyMoodDriftPhase } from "../game/rules/moods";
  import { applyPatronessErosionPhase } from "../game/rules/patronesses";   // NEW at P8
  import { applyRivalActionPhase } from "../game/rules/rivals";              // NEW at P8
  import { applySchemeResolutionPhase } from "../game/rules/schemes";
  import type { GameState } from "../game/store";

  // PHASES array edit at src/runtime/tickOrchestrator.ts:45-55:
  const PHASES: readonly TickPhase[] = [
    advanceTickPhase,             // 1. time advance
    applyEconomyPhase,            // 2. economy
    applyLocationEffectsPhase,    // 3. location effects (P3)
    applyCourierAndStaffPhase,    // 4. courier + verify + staff (P6)
    applySchemeResolutionPhase,   // 5. scheme resolution (P5)
    identityPhase,                // 6. global-event roll (P1 stub, P13)
    applyMoodDriftPhase,          // 7. mood drift
    applyHappinessPhase,          // 8. happiness drift (P7)
    applyPatronessErosionPhase,   // 9. patroness erosion (NEW at P8 — INSERTED between happiness + rival)
    applyRivalActionPhase,        // 10. rival-action roll (REPLACES the P1 stub `identityPhase` at slot 9 pre-P8 — now slot 10, ALWAYS last)
  ] as const;
  ```
  Two new imports added (alphabetical order between `applyMoodDriftPhase` and `applySchemeResolutionPhase`). PHASES array length grows 9→10; the old slot-9 `identityPhase` (rival-action stub from P1) is REPLACED by `applyRivalActionPhase` and shifts to slot 10; `applyPatronessErosionPhase` is INSERTED at slot 9. "Rivals always run last" CLAUDE.md non-negotiable preserved.

  **Golden-hash regeneration list for the PHASES widening (resolves B6 + R44 + C4).** PHASES.length 9→10 plus the new non-no-op `applyPatronessErosionPhase` (for `scandal ≥ 50`) plus the new non-no-op `applyRivalActionPhase` (for hostility ≥ 25 + cooldown ready) means every test fixture or replay baseline that captured `hashState(advanceTickPure(state))` for ANY state that crosses these thresholds will produce a different hash post-P8. **Round-robin patroness erosion (B3 resolution) eliminates the player-RNG drift concern** — patroness phase consumes ZERO PRNG draws — so the ONLY hash differences come from new hash-relevant Map content (rivalActors / patronesses / factionTensions / duels / new house.hostility & house.factionId fields). Audit list (`rg "hashState\|hashableState\|advanceTickPure" src/ --files-with-matches`):
  - `src/persist/migrations/v1-to-v8-chain.test.ts` (existing parity assertion) — extends to V9 via the new `v1-to-v9-chain.test.ts`; the V1→V8 hash is INVARIANT (no PHASES.length change in the assertion path because the chain test compares `fromSaveV9` against `createInitialState`, not tick-advance traces).
  - `src/persist/save-roundtrip.test.ts` — updates from V8 to V9 round-trip per the existing rename precedent; no golden-hash regeneration needed (round-trip is byte-identical for any valid V9 input state).
  - `src/runtime/tickOrchestrator.test.ts` — existing phase-order tracker tests use `runOrchestratorWithPhases` with caller-supplied arrays; not affected by `PHASES` widening. Test-side `phaseOrderTracker` fixture extends with two new tracked phases (patroness erosion, rival action) per the existing pattern.
  - `src/game/rules/monarchsAudience.test.ts` — gains the NEW audience-before-rival ordering test per the integrations section above; uses `runOrchestratorWithPhases` + a synthetic PHASES array (not the production one) for isolation. Does NOT regenerate a hash baseline.
  - `src/game/rules/aging.test.ts` / `succession.test.ts` / `conception.test.ts` / `maturation.test.ts` — none capture `hashState` baselines for tick-advance traces; they assert state-field mutations directly. Safe across P8 widening.
  - `src/game/replay-harness.test.ts` (if present per P1's "30-run replay harness" NFR) — IF the harness has captured-hash assertions across multi-tick traces, those baselines REGENERATE at P8. The harness regeneration is a one-time per-phase chore; documented inline at the test file. **Action item:** the implementer runs `pnpm test --run replay-harness` once post-P8 implementation; if it fails with hash-mismatch, regenerates the golden-hash baselines and re-commits.
  - **No production-code goldens** outside the test suite — no on-disk hash snapshots committed to `src/` (verified by audit).

  **Test-side `phaseOrderTracker` update.** `src/runtime/__test-utils__/phaseOrderTracker.ts` is the canonical test-side fixture per CLAUDE.md (P7 contract). P8 extends the tracker's expected-phase list with two new entries (patroness-erosion + rival-action) at slots 9 + 10. The test-side update is the load-bearing enforcement mechanism (PHASES module-load `if (length !== 10)` is NOT added — see PHASES discipline below).

  **No module-load PHASES.length assertion (per CLAUDE.md "frozen PHASES" non-negotiable).** P7's pattern explicitly chose against module-load `.length` checks ("Test enforcement is via test-side `phaseOrderTracker` function-reference identity (NOT module-load `.length === N` assertions — PHASES is module-private; exporting would break the frozen-PHASES contract)"). P8 inherits this discipline; the test-side `phaseOrderTracker` extension above is the only enforcement mechanism.

- **Pure rule `src/game/rules/duel.ts` — `resolveDuel`.** Pure function `(state: GameState, duelId: DuelId, rngState: RngState) → { state: GameState, finalDuel: Duel }`. Called from the `demandSatisfaction` store-action wrapper after the Duel entity is created.

  **Canonical signature (resolves Cycle-6-Iter-2 B1 — single definition replaces all prior partial pins):**
  ```ts
  export function resolveDuel(
    state: GameState,
    duelId: DuelId,
    rngState: RngState,
    opts?: { forceParryEveryExchange?: boolean; forceNoParryEveryExchange?: boolean },
  ): { state: GameState; finalDuel: Duel; rngState: RngState } { /* ... */ }
  ```
  The 2-opt-flag form resolves Cycle-6-Iter-2 B3: `forceParryEveryExchange = true` makes ALL parry rolls succeed (zero damage; reaches 12-exchange Stalemate deterministically); `forceNoParryEveryExchange = true` makes ALL parry rolls fail (full damage every exchange; reaches a decisive kill in 2 exchanges of consecutive landed attacks, which is the "challenger asymmetry" test scenario). At most one of the two flags is true. Both default `undefined` → production behavior (PRNG-driven parry).

  **Resolver algorithm (spec §3 lines 364-370):**
  ```
  // Prologue (resolves Cycle-6-Iter-2 B2): look up duel + duelists from state.
  const duel = state.duels.get(duelId)!;
  const challenger = state.characters.get(duel.challengerCharacterId)!;
  const defender = state.characters.get(duel.defenderCharacterId)!;
  // Working composure copies — modified in-loop, written back at end. Pre-duel
  // composure values come from the character entities (NOT DUEL_INITIAL_COMPOSURE
  // unconditionally — duelists may have lost composure to prior actions).
  // Spec §3 line 366 "Each duellist begins at 100 composure" — interpreted as a
  // RESET at duel entry, since duels are formal events; the resolver overwrites
  // composure to DUEL_INITIAL_COMPOSURE regardless of pre-duel value.
  let challengerComposure = DUEL_INITIAL_COMPOSURE  // 100
  let defenderComposure   = DUEL_INITIAL_COMPOSURE
  exchanges = 0
  attacker = challenger  // spec §3 line 368 "challenger acts first"
  while challengerComposure > 0 AND defenderComposure > 0 AND exchanges < DUEL_MAX_EXCHANGES:
    defenderInLoop = (attacker === challenger ? defender : challenger)
    // Per-exchange parry check. Test-mode overrides skip the draw entirely
    // (zero PRNG consumption when force-flags are set — keeps test-driven seeds
    // hash-stable across production behavior).
    parried = opts?.forceParryEveryExchange === true
      ? true
      : opts?.forceNoParryEveryExchange === true
      ? false
      : (() => {
          const { next: parryRoll, rngState: nextRng } = drawNext(rngState);
          rngState = nextRng;
          return parryRoll < DUEL_PARRY_PROBABILITY;
        })();
    if parried:
      // Parried — zero damage this exchange.
      composureDelta = 0
    else:
      composureDelta = -(DUEL_BASE_POWER * DUEL_COMPOSURE_MULTIPLIER)  // -50 base
      // Trait modifiers (e.g., "Cunning" +20% damage) apply here via existing combat infra.
    // Apply to the correct working composure var (challenger vs defender).
    if defenderInLoop === challenger:
      challengerComposure = clamp(challengerComposure + composureDelta, 0, DUEL_INITIAL_COMPOSURE)
    else:
      defenderComposure = clamp(defenderComposure + composureDelta, 0, DUEL_INITIAL_COMPOSURE)
    exchanges += 1
    attacker = defenderInLoop  // alternate
  // Promote loserCasualty + outcome to top-level let declarations BEFORE the
  // if/else (resolves Cycle-7 R1: prior closure-scoped bindings were unreachable
  // at the finalDuel construction site).
  let outcome: "Stalemate" | "ChallengerVictory" | "DefenderVictory"
  let loserCasualty: "Killed" | "Wounded" | "Unharmed"
  let loser: Character | null = null
  // Outcome determination (Stalemate vs decisive). Sets outcome + loserCasualty
  // + loser based on loop-exit state. NO composure mutation yet — composure
  // write-back lives OUTSIDE the if/else so Stalemate also persists (resolves
  // Cycle-7 B1).
  if exchanges === DUEL_MAX_EXCHANGES AND both alive:
    outcome = "Stalemate"; loserCasualty = "Unharmed"  // favors defender per spec line 369.
  else:
    loser = (challengerComposure <= 0 ? challenger : defender)
    outcome = (loser === challenger ? "DefenderVictory" : "ChallengerVictory")
    { next: casualtyRoll, rngState: postCasualty } = drawNext(rngState)  // single draw — the 50/50 killed-vs-wounded
    rngState = postCasualty
    loserCasualty = (casualtyRoll < DUEL_KILLED_VS_WOUNDED_PROBABILITY ? "Killed" : "Wounded")

  // UNCONDITIONAL composure write-back for BOTH duelists — outside the if/else
  // (resolves Cycle-7 B1). Stalemate AND decisive paths both reach this site.
  const newCharacters = new Map(state.characters)
  const challengerChar = newCharacters.get(challenger.id)!
  const defenderChar = newCharacters.get(defender.id)!
  newCharacters.set(challenger.id, { ...challengerChar, composure: clamp(challengerComposure, 0, challengerChar.maxComposure) })
  newCharacters.set(defender.id, { ...defenderChar, composure: clamp(defenderComposure, 0, defenderChar.maxComposure) })
  state = { ...state, characters: newCharacters }

  // Casualty branches (only fire on decisive outcome — Stalemate skips both):
  if loserCasualty === "Killed":
    // Inline mutation (resolves Cycle-2 Iter-2 B3 — no applyDeathToCharacter helper exists).
    // Flip loser.alive = false; set diedAtTick = state.tick; then run pruneOrphanedConversationKeys
    // (verified at src/game/rules/aging.ts:40-43 — signature is
    // `(state: GameState, newlyDeadCharIds: ReadonlySet<CharacterId>): GameState`).
    const loserChar = newCharacters.get(loser!.id)!
    newCharacters.set(loser!.id, { ...loserChar, alive: false, diedAtTick: state.tick })
    // Pass the explicit dead-id set as the 2nd arg (resolves Cycle-2 Iter-5 B1).
    state = pruneOrphanedConversationKeys({ ...state, characters: newCharacters }, new Set<CharacterId>([loser!.id]))
  else if loserCasualty === "Wounded":
    // Wounded: composure RESTORED to DUEL_WOUNDED_COMPOSURE_RESTORATION (25) — overwrites
    // the unconditional write above for the loser. "Restored" is the spec wording at
    // line 370 — interpretation: set TO the constant (not floor-toward; the constant
    // is the post-wound rest value regardless of pre-duel composure). The write is
    // unconditional within this branch; matches spec §3 line 370 "narrative effect only."
    const loserChar = newCharacters.get(loser!.id)!
    newCharacters.set(loser!.id, { ...loserChar, composure: clamp(DUEL_WOUNDED_COMPOSURE_RESTORATION, 0, loserChar.maxComposure) })
    state = { ...state, characters: newCharacters }
  // Stalemate (loserCasualty === "Unharmed"): no further composure mutation — the
  // unconditional write above persisted both duelists' depleted-but-non-zero composure.
  // Inline grievance-flip (resolves Cycle-2-Iter-2 B3 — no updateGrievanceInHouse helper exists).
  // **Stalemate gate (resolves Cycle-4-Iter-5 R15):** flip ONLY on decisive outcomes
  // (ChallengerVictory or DefenderVictory). Stalemate leaves the grievance unresolved
  // — spec §3 line 369 "favors defender" means the defender keeps the grievance lever
  // to weather another challenge. Without this gate, the verification claim at the
  // Edge cases section ("Stalemate ... player can re-issue") contradicts the
  // resolver's actual mutation.
  // **Ordering pin (resolves Cycle-3 B4):** the grievance-flip MUST run AFTER the prune
  // cascade above (Killed branch only — prune already mutated state). The grievance-flip
  // re-reads state.houses.get(holderHouseId) fresh — never reuses the pre-prune `state`
  // reference. Future phase that extends pruneOrphanedConversationKeys to mutate per-house
  // grievances (e.g., dropping grievances perpetrated BY a now-dead character — currently
  // out-of-scope) reads the post-prune state, not stale. Grievances live INSIDE
  // house.grievances (verified at src/game/entities.ts:76).
  if (outcome !== "Stalemate") {
    const holderHouseId = findGrievanceHolderHouseId(state, duel.grievanceId)  // re-reads post-prune state
    if (holderHouseId !== null) {                                              // null → grievance pruned mid-cascade
      const holderHouse = state.houses.get(holderHouseId)!                     // re-read fresh
      const newGrievances = holderHouse.grievances.map(g => g.id === duel.grievanceId ? { ...g, resolved: true } : g)
      const newHouses = new Map(state.houses)
      newHouses.set(holderHouseId, { ...holderHouse, grievances: newGrievances })
      state = { ...state, houses: newHouses }
    }
  }
  // Construct the resolved Duel entity (resolves Cycle-5 B5 — pin explicit return shape).
  // `duel` is the Active-status entity passed in by the demandSatisfaction wrapper
  // (which already wrote it to state.duels via makeDuelId before calling resolveDuel).
  // resolveDuel writes back a NEW Duel object via state.duels Map clone — pure function;
  // never mutates the input entity reference.
  const finalDuel: Duel = {
    ...duel,
    status: "Resolved",
    resolvedAtTick: state.tick,
    outcome,
    loserCasualty,
    exchangesElapsed: exchanges,
  };
  const newDuels = new Map(state.duels);
  newDuels.set(duel.id, finalDuel);
  return { state: { ...state, duels: newDuels }, finalDuel };

  // findGrievanceHolderHouseId (helper local to duel.ts; NOT promoted to util/lookups
  // because there's only one v1 caller — per CLAUDE.md "no premature abstractions").
  // Typed result (resolves Cycle-4-Iter-4 B1): returns null on missing rather than
  // throwing. The caller treats null as "grievance vanished during prune" — typically
  // means the prune cascade dropped the grievance (e.g., a future phase that prunes
  // grievances tied to a now-dead aggressor). The resolver handles null by SKIPPING
  // the grievance-flip step (the duel is already resolved at this point; skipping
  // the flip is the correct behavior because the grievance no longer exists to flip).
  function findGrievanceHolderHouseId(state: GameState, grievanceId: GrievanceId): HouseId | null {
    for (const [hid, h] of state.houses) {
      if (h.grievances.some(g => g.id === grievanceId)) return hid;
    }
    return null;
  }
  // (Vestigial mutating-assignment pseudo-code deleted at Cycle-5-Iter-2 B1 —
  // the canonical pure-rule form is the `return { state: ..., finalDuel: ... }`
  // statement above. The resolver NEVER mutates the input `duel` reference; the
  // final Duel entity is constructed via spread + return per CLAUDE.md pure-rule
  // structural-sharing contract.)
  ```
  **PRNG draw budget (revised post-B7):** up to **12 parry draws + 1 casualty draw = 13 draws max**. Stalemate consumes 12 parry draws + 0 casualty (no casualty roll on stalemate). Each draw is on the challenger's house RNG (the duel is owned by the challenger — typically the player); the defender's RNG is NEVER consumed. This makes duels reproducible from the challenger-house seed alone. Determinism contract preserved: same seed → same draws → same outcome; the 30-run hash stability NFR still holds.

  **`resolveDuel` is a player-elected action wrapper, not a tick phase.** It runs synchronously when the player clicks "Demand Satisfaction" on a grievance in the Ledger view. It does NOT advance the tick (matches the P5 free-action pattern for `startScheme` / `cancelScheme`). The store wrapper:
  - Validates: grievance exists, grievance.resolved === false, challenger is alive, defender is alive, neither is exiled.
  - Deducts: `DUEL_DEMAND_SATISFACTION_REPUTATION_COST` from challenger's house.
  - Creates the Duel entity via `makeDuelId(...)`.
  - Calls `resolveDuel` synchronously (the 12-exchange loop runs to completion in one tick).
  - Publishes `DuelResolved` event with the full outcome payload.

- **Player-elected action `demandSatisfaction(perpetratorHouseId, grievanceId)` at `src/game/store.ts` (resolves B5).** Free-action wrapper (does not advance tick). The action accepts BOTH the perpetrator house id and the grievance id — the UI already has the perpetrator house id when it renders the grievance row (the Ledger walks `state.houses.values()` to enumerate per-house grievances), so passing it explicitly avoids the cross-house walk. Returns typed discriminated union for the rejection paths:
  ```ts
  type DemandSatisfactionResult =
    | { ok: true; duelId: DuelId; outcome: Duel["outcome"] }
    | { ok: false; reason:
        | { kind: "GrievanceNotFound" }
        | { kind: "GrievanceAlreadyResolved" }
        | { kind: "LegacyGrievanceUnactionable" }  // grievance.defendantCharacterId === null (legacy backfill)
        | { kind: "ChallengerDead" }
        | { kind: "DefenderDead" }
        | { kind: "DefenderExiled" }               // defense-in-depth — rivals never exile at v1 but future v1.5/P11 may
        | { kind: "PlayerExiled" }                 // CLAUDE.md per-action exile gate
      };

  // Wrapper body (sketch):
  function demandSatisfaction(perpetratorHouseId: HouseId, grievanceId: GrievanceId) {
    const perpHouse = state.houses.get(perpetratorHouseId);
    if (perpHouse === undefined) return { ok: false, reason: { kind: "GrievanceNotFound" } };
    const grievance = perpHouse.grievances.find(g => g.id === grievanceId);
    if (grievance === undefined) return { ok: false, reason: { kind: "GrievanceNotFound" } };
    // ... resolved/dead/exiled checks ...
  }
  ```
  **Why no `findGrievanceAcrossHouses(state, grievanceId)` helper at v1:** the UI already segments by perpetrator house (one grievance row per perpetrator); the cross-house walk would only be needed if a code path had an isolated `grievanceId` with no house context, which doesn't exist at P8. A future phase (e.g., a "global grievances" inbox tab) would add the helper to `src/game/util/lookups.ts` then; deferred per the "no premature abstractions" CLAUDE.md guidance.

  **Wrapper body shape (resolves Cycle-6-Iter-1 B3):** matches the P5 `startScheme` / P6 `weaponizeWhisper` Zustand pattern at `src/game/store.ts` — uses `get()` to read pre-action snapshot, then `set` to apply the post-resolve state, then fires publishers AFTER `set` returns. Concrete:
  ```ts
  // src/game/store.ts (NEW demandSatisfaction at P8):
  demandSatisfaction: (perpetratorHouseId, grievanceId) => {
    const before = get();   // pre-action snapshot (read via Zustand get())
    // Validation reads from `before` — no set yet.
    // **Grievance lookup direction (resolves Cycle-6-Iter-3 B1):** grievances are
    // stored on the VICTIM house (verified at src/game/entities.ts:73-76 — "the
    // house is the VICTIM, perpetrator referenced by perpetratorHouseId" — and
    // src/game/rules/schemes.ts:376-378 stores grievances on the target's house).
    // At v1 the player is the only victim (rival-perpetrated OpenSabotage creates
    // grievances on PLAYER_HOUSE_ID; legacy player-perpetrated grievances are held
    // by NPC houses but are LegacyGrievanceUnactionable — not duelable). So the
    // lookup walks the player house, cross-filtering by perpetratorHouseId.
    const victimHouse = before.houses.get(PLAYER_HOUSE_ID)!;
    const grievance = victimHouse.grievances.find(
      (g) => g.id === grievanceId && g.perpetratorHouseId === perpetratorHouseId,
    );
    if (grievance === undefined) return { ok: false, reason: { kind: "GrievanceNotFound" } };
    if (grievance.resolved) return { ok: false, reason: { kind: "GrievanceAlreadyResolved" } };
    if (grievance.defendantCharacterId === null) return { ok: false, reason: { kind: "LegacyGrievanceUnactionable" } };
    if (before.houses.get(PLAYER_HOUSE_ID)?.exiled === true) return { ok: false, reason: { kind: "PlayerExiled" } };
    // ... ChallengerDead / DefenderDead / DefenderExiled gates ...
    // Pure-rule call: construct Duel entity, deduct reputation, run resolveDuel.
    const reputationDelta = DUEL_DEMAND_SATISFACTION_REPUTATION_COST;  // -5
    // ... build pre-resolve state with reputation deducted + duel entity added ...
    const challengerRng = before.rng.get(PLAYER_HOUSE_ID)!;
    const { state: postResolveState, finalDuel, rngState: postRng } = resolveDuel(
      stateBeforeResolve, duelId, challengerRng,
    );
    // Write back the post-resolve RNG to the challenger's slot.
    const newRng = new Map(postResolveState.rng);
    newRng.set(PLAYER_HOUSE_ID, postRng);
    const after = { ...postResolveState, rng: newRng };
    // Apply via Zustand set + overwriteFromGameState mirror.
    set((draft) => overwriteFromGameState(draft, after));
    // Publishers fire AFTER set returns (P3 event-bus discipline). Diff helpers
    // walk before/after snapshots — each detects only its own domain's transitions.
    publishDuelResolved(after.duels.get(duelId)!);        // direct event with skip-key "duelResolved:${duelId}"
    publishWhisperTransitions(before, after, new Set([`duelResolved:${duelId}`]));
    publishMarriageTransitions(before, after);
    publishTemptationLatchTransitions(before, after);
    if (finalDuel.loserCasualty === "Killed") {
      publishCharacterDeaths(before, after);
      publishSchemeTransitions(before, after);   // any cascade-killed schemes from pruneOrphanedConversationKeys
    }
    if (finalDuel.outcome !== "Stalemate") {
      publishGrievanceResolved(grievanceId, perpetratorHouseId);
    }
    return { ok: true, duelId, outcome: finalDuel.outcome };
  }
  ```
  **Per-outcome publisher count (resolves recurring R14):**
  - **Killed**: 6 publishers — `DuelResolved` (direct) + 4 baseline diff publishers (`whisperTransitions`, `marriageTransitions`, `temptationLatchTransitions`, `characterDeaths`) + `schemeTransitions` + `GrievanceResolved`.
  - **Wounded**: 3 publishers — `DuelResolved` (direct) + `whisperTransitions` (no-op typically) + `GrievanceResolved`. No death-cascade fires.
  - **Stalemate**: 2 publishers — `DuelResolved` (direct) + `whisperTransitions` (no-op typically). NO `GrievanceResolved` (grievance stays unresolved per the Stalemate gate at the resolver).

- **Ball-veto rule `src/game/rules/patronesses.ts:checkBallVeto(state: GameState): { vetoedBy: PatronessId[] }`.** Pure function called by the ballroom enter-flow at P4's `enterBallroom` action (P8 wires the gate). Iterates `state.patronesses.values()` in lex-`PatronessId` order and collects any whose `favor < PATRONESS_VETO_THRESHOLD`. Returns ALL snubbing patronesses (NOT just the first match) so the rejection prose can name them. **Single canonical shape (resolves accumulated C1):** `{ vetoedBy: PatronessId[] }` — empty array means NO veto; non-empty means veto by the listed patronesses. Single-shape return is cleaner than a discriminated union for the single call site at `enterBallroom`. The UI prose reads from `result.vetoedBy.map(id => state.patronesses.get(id).displayName).join(" and ")`. P4's enter-ballroom action gains a typed rejection variant `{ kind: "BallVetoedByPatronesses", vetoedBy: PatronessId[] }` (using the same field name as the rule's return).

- **Bus events partitioned per domain.** Three new event modules at `src/runtime/events/`:
  - `runtime/events/rivals.ts` — `RivalActionFired`, `RivalHostilityChanged`, `FactionTensionChanged`.
  - `runtime/events/patronesses.ts` — `PatronessFavorDropped`, `BallVetoTriggered`.
  - `runtime/events/duels.ts` — `DuelInitiated`, `DuelResolved`, **`GrievanceResolved` (resolves recurring R12)** — fires when `demandSatisfaction` flips a grievance's `resolved: true` on decisive duel outcome (NOT Stalemate per the resolver's gate). P14 ledger consumer needs this event to update its Grievances tab row. Lives in `duels.ts` (not a separate `grievances.ts` module) because the duel resolution IS the grievance-flip trigger at v1; future v1.5 paths that resolve grievances outside duels (e.g., a "withdraw grievance" action) would split into their own publisher.
  Each module declares its own typed event variants (discriminated unions) and a publisher. Subscribers register via the `useBusEvent<K>` hook (P3 pattern). No global string-keyed bus.

- **Diff publishers for tick-advancing wrappers.** The post-P7 wrapper publisher trio expands. Per-Map diff helpers added at P8:
  - `publishRivalActionFired(before, after)` — emits one event per rival whose `lastActionTick` changed since `before`.
  - `publishPatronessFavorChanges(before, after)` — emits one event per patroness whose favor decreased; carries the new favor and whether `< PATRONESS_VETO_THRESHOLD`.
  - `publishFactionTensionChanges(before, after)` — emits one event per FactionPairKey whose tension changed.
  - `publishDuelTransitions(before, after, wrapperPublishedKeys?: ReadonlySet<string>)` — P6-pattern 3rd-arg skip-rule for the wrapper that direct-publishes its own DuelResolved event.

  **Publisher trio post-P8.** `advanceTick` + the four P3 wrappers (travel/audience/bankruptcy/wardrobe) fire **9 publishers** (the 5 from P7 + the four new P8 publishers). `runYearPass` fires **10** (adds the 4 new P8 publishers to its existing 6). `demandSatisfaction` fires **6** (its own DuelResolved + the 4 baseline death-cascade publishers + characterDeaths only on Killed). `proposeMarriage` continues to fire its existing 5.

- **Existing P1 / P3 / P5 / P6 / P7 integrations.**
  - `tickOrchestrator.ts:54` slot 9 (currently `identityPhase` for "rival-house action roll") REPLACED by `applyRivalActionPhase` — single-line import edit.
  - `tickOrchestrator.ts` PHASES array gets `applyPatronessErosionPhase` inserted at slot 9 (between happiness and the rival phase); rivals stay terminal.
  - `MONARCH_AUDIENCE_PATRONESS_BONUS` at `constants.ts:85` becomes load-bearing: `applyAudience` (`src/game/rules/monarchsAudience.ts:76` — verified function name; NOT `applyMonarchsAudience`) starts iterating `state.patronesses.values()` and bumping favor by +5 on full-success. **Body diff sketch (resolves Cycle-3 B2):** the existing function returns a discriminated-union outcome (success-band classification + state mutation). P8 EDIT extends the FULL-SUCCESS branch ONLY:
    ```ts
    // src/game/rules/monarchsAudience.ts (P8 EDIT — patch the existing applyAudience body).
    //
    // VERIFIED LIVE signature + body shape at monarchsAudience.ts:76-118 (pre-P8):
    //   export function applyAudience(state: GameState, houseId: HouseId): { state: GameState; outcome: AudienceOutcome } {
    //     const check = canRequestAudience(state, houseId);
    //     if (!check.ok) return { state, outcome: { kind: "Denied", reason: check.reason } };
    //     const house = getHouseOrThrow(state, houseId);
    //     const preCostReputation = house.reputation;
    //     const isFullSuccess = preCostReputation >= MONARCH_AUDIENCE_FULL_SUCCESS_THRESHOLD;
    //     const wealth = house.wealth - MONARCH_AUDIENCE_WEALTH_COST;
    //     const reputation = clamp(house.reputation - MONARCH_AUDIENCE_REPUTATION_COST, 0, 100);
    //     let scandal = house.scandal;
    //     if (isFullSuccess) {
    //       scandal = 0;
    //       // P3 stub: patronesses + rivals loops empty here. <-- P8 FILLS THESE IN.
    //     } else {
    //       scandal = clamp(scandal + MONARCH_AUDIENCE_PARTIAL_SCANDAL_DELTA, 0, 100);
    //     }
    //     const houses = new Map(state.houses);
    //     houses.set(houseId, { ...house, wealth, reputation, scandal, lastAudienceTick: state.tick });
    //     const outcome: AudienceOutcome = isFullSuccess
    //       ? { kind: "FullSuccess", preCostReputation }
    //       : { kind: "Partial", preCostReputation };
    //     return { state: { ...state, houses }, outcome };
    //   }
    //
    // P8 EDIT (resolves Cycle-3-Iter-4 B1 + Cycle-4-Iter-6 B1 — signature + locals + branch-keys match live):
    //   1. DELETE the P3-stub comment block at monarchsAudience.ts:96-99 ("P3 stub: patronesses
    //      (+5 each) and rivals (-5 hostility each) loops are empty here. P8 fills these in...").
    //   2. Inside the EXISTING `if (isFullSuccess) { scandal = 0; ... }` block (after the
    //      scandal-zero write, before the closing brace at line 102), ADD the rival
    //      hostility-drop loop. The loop writes into a NEW Map cloned right then; later
    //      the EXISTING `const houses = new Map(state.houses)` at line 104 is REPLACED
    //      with a reuse of the new clone (or the loop's clone is created earlier so the
    //      single clone serves both player + rival writes).
    //   3. ADD a `let patronesses = state.patronesses;` after the existing `houses` clone;
    //      inside the isFullSuccess branch, replace with `new Map(state.patronesses)` and
    //      run the +5-favor loop.
    //   4. EXTEND the final return to include `patronesses` in the state spread.
    //
    // Concrete post-P8 body (rewriting the existing function — NOT adding a parallel one):
    export function applyAudience(
      state: GameState,
      houseId: HouseId,
    ): { state: GameState; outcome: AudienceOutcome } {
      const check = canRequestAudience(state, houseId);
      if (!check.ok) return { state, outcome: { kind: "Denied", reason: check.reason } };
      const house = getHouseOrThrow(state, houseId);
      const preCostReputation = house.reputation;
      const isFullSuccess = preCostReputation >= MONARCH_AUDIENCE_FULL_SUCCESS_THRESHOLD;
      const wealth = house.wealth - MONARCH_AUDIENCE_WEALTH_COST;
      const reputation = clamp(house.reputation - MONARCH_AUDIENCE_REPUTATION_COST, 0, 100);
      let scandal = house.scandal;
      if (isFullSuccess) {
        scandal = 0;
      } else {
        scandal = clamp(scandal + MONARCH_AUDIENCE_PARTIAL_SCANDAL_DELTA, 0, 100);
      }
      const houses = new Map(state.houses);
      houses.set(houseId, { ...house, wealth, reputation, scandal, lastAudienceTick: state.tick });

      // P8 ADDITION: full-success rewards (rival hostility drop + patroness favor bonus).
      // MONARCH_AUDIENCE_RIVAL_HOSTILITY_DROP is the POSITIVE magnitude (verified
      // at src/game/constants.ts:89 — value is +5). Subtract to actually drop hostility.
      let patronesses = state.patronesses;
      if (isFullSuccess) {
        for (const [rid] of state.rivalActors) {
          const rh = houses.get(rid)!;
          houses.set(rid, { ...rh, hostility: clamp(rh.hostility - MONARCH_AUDIENCE_RIVAL_HOSTILITY_DROP, 0, 100) });
        }
        patronesses = new Map(state.patronesses);
        for (const [pid, p] of state.patronesses) {
          patronesses.set(pid, { ...p, favor: clamp(p.favor + MONARCH_AUDIENCE_PATRONESS_BONUS, 0, 100) });
        }
      }

      const outcome: AudienceOutcome = isFullSuccess
        ? { kind: "FullSuccess", preCostReputation }
        : { kind: "Partial", preCostReputation };
      return { state: { ...state, houses, patronesses }, outcome };
    }
    ```
    The existing comment "Stub at P3 — patronesses ship in P8" at `monarchsAudience.ts:96` (and any stub-loop body adjacent to it) is DELETED at P8 — the new patroness + rival iteration replaces it (resolves Cycle-4 B7: the P8 edit is `+/-` not `+`-only; the stub-comment + any placeholder body MUST be removed before the new loops land). New imports added to `monarchsAudience.ts:12-17`: `MONARCH_AUDIENCE_PATRONESS_BONUS, MONARCH_AUDIENCE_RIVAL_HOSTILITY_DROP` (added to the existing constants import). `clamp` is the local helper at `monarchsAudience.ts:38-40` (verified — NOT imported from `../util/clamp`); the P8 patch reuses the local helper (resolves R17). `PLAYER_HOUSE_ID` is already imported.
  - `MONARCH_AUDIENCE_RIVAL_HOSTILITY_DROP` at `constants.ts:89` becomes load-bearing per the same `applyAudience` full-success branch above. SAME-TICK ordering with rival action: the audience MUST run BEFORE the rival-action phase (spec §7 edge case). Because the audience action runs THROUGH `advanceTickPure` (it's tick-advancing), the audience's hostility-drop write happens BEFORE the orchestrator reduces over PHASES — so the rival phase reads the post-drop hostility. **`monarchsAudience.test.ts` gains a NEW ordering test at P8** (the existing test file at `src/game/rules/monarchsAudience.test.ts` has outcome-band and state-mutation tests only — no prior ordering coverage). The new test uses `runOrchestratorWithPhases` + `phaseOrderTracker` to construct a state where a rival's hostility is `30` (above threshold), trigger a full-success audience (drops to `25` — still above threshold but on the edge), then assert the subsequent rival-action phase saw the post-drop hostility (cooldown bypass needed — see test-mode override note in the Verification section).
  - `runtime/events/conversation.ts` `FauxPasFired` consumer extends: P5 records a Grievance on faux-pas; P8 ALSO bumps every active rival's hostility by `PUBLIC_FAUX_PAS_HOSTILITY_DELTA = +5` (spec §3 line 134 "a public faux-pas raises it less"). The hook runs in the same store-action wrapper that fires the FauxPasFired event — pure additive bump, no PRNG.
  - `applySchemeResolutionPhase` (`src/game/rules/schemes.ts`) Sabotage completion branch extends: on rival-targeted Sabotage success (`scheme.targetCharacterId` belongs to a rival house), bump that rival's hostility by `PLAYER_SABOTAGE_HOSTILITY_DELTA = +15` AND record a Grievance into the rival's `state.houses[rivalId].grievances` (the rival becomes the victim of the player's Sabotage). The grievance gives the rival a future "demand satisfaction" path — but rivals don't have a UI to issue duels at P8 (no NPC-initiated actions per OQ #14); the recorded grievance is for future P11+ rival-demand-satisfaction phases.
  - **`applyEconomyPhase` rival-skip gate (NEW at P8 — resolves Cycle-5-Iter-2 B3).** Verified at `src/game/rules/economy.ts:32`: iterates ALL houses with no PLAYER_HOUSE_ID filter. Post-P8, the 3 rival houses would receive bankruptcy-tier wealth/reputation/scandal deltas every tick — contradicting the plan's repeated claim that "rival wealth is cosmetic" (and the `skipWealthDeduction` widening rationale). P8 gates rival + Independent houses out of the economy phase:
    ```ts
    // src/game/rules/economy.ts (P8 EDIT — at the top of the for-loop body).
    // Narrow gate to RIVAL_HOUSE_IDS_SET (resolves Cycle-5-Iter-4 B3 rationale).
    // Pre-P8: Independent house received economy deltas every tick (verified at
    // economy.ts:32 — no filter). Post-P8 narrow form preserves Independent's
    // pre-P8 economy participation; only the 3 NEW rival houses are gated out
    // because they predate any rival-economy model. Live body uses BOTH `houseId`
    // and `house` (resolves Cycle-5-Iter-3 B2).
    for (const [houseId, house] of state.houses) {
      if (RIVAL_HOUSE_IDS_SET.has(houseId)) continue;  // NEW at P8: rivals only skip economy decay (cosmetic wealth invariant at v1). Independent + player still receive deltas.
      // ... existing tier classification + delta application unchanged ...
    }
    ```
    Same one-line gate pattern as `applySuccessionStep`. The Independent house was already invisible to the player at v1 (no UI affordance for its economy), so the skip is symmetric for rivals + Independent. Future v1.5 rival-economy work would remove this gate.
  - **`applySuccessionStep` rival-skip gate (NEW at P8 — resolves Cycle-5 B1 + Cycle-5-Iter-4 B3 rationale correction).** Verified at `src/game/rules/succession.ts:52`: the current loop iterates ALL houses without filter; would auto-promote rival heirs on rival-head death. The plan narrows the gate to RIVAL_HOUSE_IDS_SET specifically (NOT a blanket "non-player skip") to preserve existing Independent-house succession behavior — verified at `src/game/fixtures/npcs.ts:35,51,59,67` that **4 of 5 BASELINE_NPCS have `role: "Dependent"`** AND `succession.ts:85` includes Dependent in the family-pool filter; so pre-P8 a Lord Blackwood (Independent head) death would have auto-promoted `npc-aldridge` (lex-smallest Dependent). A blanket "non-player skip" would silently break this — narrow to rivals only:
    ```ts
    // src/game/rules/succession.ts (P8 EDIT — at the top of the for-loop body, before any other logic):
    for (const [, house] of state.houses) {
      if (RIVAL_HOUSE_IDS_SET.has(house.id)) continue;  // NEW at P8: ONLY rivals skip (rival heads stay heirless/dormant per Out-of-scope). Independent + player succeed normally.
      // ... existing succession logic unchanged ...
    }
    ```
    Imports `RIVAL_HOUSE_IDS_SET` from `../fixtures/rivals`. Narrow-set form is the deliberate v1 behavior contract; future v1.5 rival-succession work removes the gate entirely.
  - `pruneOrphanedConversationKeys` (`src/game/rules/aging.ts:40`) death cascade extends with a NEW rival-branch (resolves Cycle-5-Iter-3 B3 — the host function is the canonical CLAUDE.md death-cascade helper, NOT `applyAgingStep` directly). The rival branch joins the existing 3 P7 branches (tutor-prune, Dull-spouse-prune, marriage-dissolution) using the same shared-accumulator discipline. When a rival-associated character dies, the `RivalActorState.associatedCharacterIds` array drops that character id. Spec §7 edge case "Rival-house associated-character pruning". The branch:
    ```ts
    // src/game/rules/aging.ts (P8 EDIT — extend pruneOrphanedConversationKeys with shared-accumulator rival-branch).
    // **Cumulative `newRivalActors` accumulator (resolves accumulated C2):** clone the rivalActors
    // Map ONCE on first match, then mutate in place across all subsequent dead chars in the same
    // call. Multi-rival-death year-pass (e.g., Ashford-a1 AND Beaumont-a1 both die at the same
    // year-tick) all see the cumulative accumulator and write into it — last-write-wins regression
    // is eliminated. Same pattern as the existing P7 `newChars` accumulator in this same function.
    let newRivalActors: Map<HouseId, RivalActorState> | null = null;
    for (const deadId of newlyDeadCharIds) {
      const deadCharacter = state.characters.get(deadId);
      if (deadCharacter === undefined) continue;
      // Gate on RIVAL_HOUSE_IDS_SET (resolves accumulated C2 + Cycle-3 R7).
      if (!RIVAL_HOUSE_IDS_SET.has(deadCharacter.houseId)) continue;
      const rivalActor = (newRivalActors ?? state.rivalActors).get(deadCharacter.houseId);
      if (rivalActor === undefined) continue;  // structurally unreachable (RIVAL_HOUSE_IDS_SET ⊆ rivalActors keys)
      if (!rivalActor.associatedCharacterIds.includes(deadId)) continue;
      newRivalActors ??= new Map(state.rivalActors);   // lazy clone on first match
      newRivalActors.set(deadCharacter.houseId, {
        ...rivalActor,
        associatedCharacterIds: rivalActor.associatedCharacterIds.filter(id => id !== deadId),
      });
    }
    if (newRivalActors !== null) {
      state = { ...state, rivalActors: newRivalActors };
    }
    ```
    The death-cascade helper continues to be the single chokepoint per CLAUDE.md ("`pruneOrphanedConversationKeys` is the canonical death-cascade helper"). When a rival's head dies, the orchestrator does NOT auto-promote a new head at P8 — succession is the player-only path at v1 per the spec's "automated opposing actors" framing (rivals continue to fire actions through their existing head until that head also dies; an heirless rival flag is set similarly to the player's `heirless: true` and the rival becomes effectively dormant). Document this as a v1 limitation in the Out of scope list.

- **Bootstrap integration.** `seedStartingFamily` (currently at `src/game/bootstrap.ts`) extends to ALSO seed:
  - 3 rival houses into `state.houses` (full `House` entities from `RIVAL_HOUSES_FIXTURE`).
  - 9 rival-associated characters into `state.characters` (each carrying V8 character defaults: parents `null`, happiness 100, gender per the seed authored value).
  - 3 `state.rng` entries (one per rival house, deterministically seeded from the player seed).
  - 5 `state.patronesses` entries from `PATRONESSES_FIXTURE`.
  - 3 `state.rivalActors` entries (one per rival, `lastActionTick: null`).
  - 6 `state.factionTensions` entries from `FACTION_PAIRS` (all at value 0).
  - Empty `state.duels` Map.

  **Bootstrap-vs-legacy-lift parity.** Same discipline as P7's gender-derivation parity: both paths produce identical hash-relevant state. Fresh-state bootstrap seeds via `PATRONESSES_FIXTURE` + `RIVAL_HOUSES_FIXTURE` + `FACTION_PAIRS`; legacy lift via `seedRivalsAndPatronessesIntoLegacyState` uses the EXACT SAME fixtures. The `v1-to-v9-chain.test.ts` parity assertion verifies.

- **UI surfaces (deferred to P14 ledger; P8 adds wiring only).** P8 does NOT ship the Rivals tab UI, the Patronesses tab UI, or the Grievances tab UI — those are P14's domain (per the master plan's "Ledger View" assignment). What P8 DOES ship:
  - The data Maps (`patronesses`, `rivalActors`, `factionTensions`, `duels`) so P14 has something to render.
  - The `checkBallVeto` rule wired into the `enterBallroom` flow with a typed rejection variant so the existing ballroom enter-action surfaces a banner ("Lady Jersey and Lady Cowper have snubbed you — Almack's is closed to House [Player]").
  - The `demandSatisfaction` action exposed via the store but NOT rendered (P14 ledger ships the button).
  - Console-log emissions (per the existing P5/P6/P7 dev pattern) for `RivalActionFired`, `PatronessFavorDropped`, `DuelResolved` events so the implementer can verify gameplay during P8 manual testing without the ledger UI.

**Out of scope.**
- Sibling-rival actors (P11) — the within-family rival mechanic. P8 covers only the 3 external rival HOUSES.
- Rival-house cross-marriage (OQ #16 — deferred to v1.5; P7 rejects via `{ kind: "CrossHouseMarriageNotSupported" }`).
- NPC-initiated duels — rivals NEVER click "demand satisfaction" on the player; only the player initiates duels (OQ #14 deferral).
- Rival succession when a rival head dies — the rival's head dies and the rival becomes heirless / dormant; no auto-promote-heir for rivals at v1. Documented limitation.
- Rival economic model — rival wealth is cosmetic; rival-owned OpenSabotage schemes do NOT deduct rival wealth. v1.5 candidate.
- Rivals Ledger tab UI, Patronesses Ledger tab UI, Grievances Ledger tab UI — all P14.
- Force-graph faction tension viz — explicitly deferred per OQ #8.
- Per-rival LLM persona prompts (rivals don't enter the conversation system as targets at v1; if they ever do, P4's persona-cache infrastructure applies as-is).

**Spec refs.** §3 "Rival Houses", "Patronesses & Faction Politics", "Duels & Grievances", "Patroness Favor", "Duel Resolution". §4 "Patroness Record" + "Rival House" entities. §7 "Same-tick monarch's audience and rival action", "Rival-house associated-character pruning". §10 OQ #1, #2, #8 resolved at this phase.

**Key rules / constants.** See `src/game/constants.ts` extension list above. Pinned: `RIVAL_HOSTILITY_ACTIVATION_THRESHOLD = 25`, `RIVAL_HOSTILITY_DECAY_PER_TICK = -1`, `RIVAL_ACTION_COOLDOWN_TICKS = 8`, `RIVAL_ACTION_WEIGHTS = { LeakWhisper: 3, PettySabotage: 2, OpenSabotage: 2, RaiseFactionTension: 1 }`, `PATRONESS_FAVOR_INITIAL = 50`, `PATRONESS_FAVOR_EROSION_PER_TICK = -1` (doubled to -2 at tension ≥ 50), `PATRONESS_VETO_THRESHOLD = 20`, `FACTION_TENSION_CAP = 100`, `DUEL_INITIAL_COMPOSURE = 100`, `DUEL_BASE_POWER = 25`, `DUEL_COMPOSURE_MULTIPLIER = 2`, `DUEL_MAX_EXCHANGES = 12`, `DUEL_KILLED_VS_WOUNDED_PROBABILITY = 0.5`.

**Machines.** No new XState v5 machines. Rival action loops are per-tick rolls gated by cooldown predicate (same justification as P5's "Scheme.status is a field, not an actor"); Duel is a one-shot resolver that loops in pure code without per-state actor refs. PHASES array grows from 9 to 10 slots (patroness erosion inserted at slot 9; rival action stays terminal).

**Edge cases (§7).**
- **Same-tick monarch's audience and rival action** (spec §7 line 641). The audience hostility drop runs BEFORE the rival-action phase because the audience is a tick-advancing store action: the audience writes to state BEFORE `advanceTickPure` reduces over PHASES, so the rival phase reads post-drop hostility. Existing `monarchsAudience.test.ts` ordering test extends.
- **Rival-house associated-character pruning** (spec §7 line 646). `pruneOrphanedConversationKeys` extension; see the rivals integration above. Test: kill a rival-associated character, assert their id is dropped from `rivalActors.associatedCharacterIds`.
- **Ball veto with multiple snubbing patronesses.** `checkBallVeto` returns the FULL list; UI prose names all. Test fixture: 2 patronesses at favor 15 each; assert the rejection variant carries both ids.
- **Stalemate-favors-defender invariant.** 12-exchange stalemate with neither party at composure ≤ 0 → outcome `"Stalemate"`, loserCasualty `"Unharmed"`. Defender keeps their grievance unresolved (player can re-issue). Test: pin both duelists with no trait modifiers; assert outcome === `"Stalemate"` after 12 exchanges.
- **Decisive loss killed-vs-wounded 50/50 tolerance.** 1000-trial replay over fixed seed should produce a killed:wounded ratio within `[0.45, 0.55]` per spec line 370. Test uses a binomial confidence interval at p=0.5, n=1000.
- **Inherited-secret surface against a now-allied rival** (spec §7 line 655) — partial overlap with P11 (Inherited Secrets ships there). P8 ships the hostility-threshold check infrastructure that P11 reads.
- **Action gating bypassed by mid-flight rival schemes.** OpenSabotage starts a P5 Scheme entity owned by the rival; per the CLAUDE.md "Action gating is atomic" invariant, the rival's scheme is NOT retroactively invalidated by the rival head's death between start and completion (the scheme persists as-is; aggressorCharacterId references a dead character but the scheme still resolves on its end-tick — symmetric with player-owned schemes whose aggressor dies mid-flight per the P7 cascade).

**Verification.**
- `pnpm test` — all Vitest suites pass; deterministic replay harness produces identical hashes across 30 runs of any P8-touching campaign.
- `pnpm lint` — Biome clean; boundary-rule clean (`rivals.ts`, `patronesses.ts`, `duel.ts` may import only from `src/game/constants.ts`, `src/game/fixtures/**`, `src/game/rng.ts`, and other `src/game/rules/**` files per CLAUDE.md non-negotiable §1).
- `pnpm typecheck` — strict TS clean.
- **Rival action pool distribution.** 10k-tick simulation with a single rival at hostility 30 (above threshold, below tension bias), cooldown disabled — assert empirical frequencies match `RIVAL_ACTION_WEIGHTS` ratios within `±3%` (baseline pool = `300 + 200 + 200 + 100 = 800` scaled units → LeakWhisper 37.5%, PettySabotage 25%, OpenSabotage 25%, RaiseFactionTension 12.5%). With tension at 100 on the rival's pair, assert OpenSabotage frequency rises to **~43%** per the tension-bias formula (`450 / 1050` scaled-pool; resolves Cycle-5-Iter-2 B2).
- **Patroness erosion & audience offset.** Construct a state with `scandal = 60` (above threshold) and run 20 ticks; assert the deterministically-picked patroness lost favor at `-1`/tick. Bump faction tension on her pair above 50; assert the next-tick drop is `-2`. Trigger a full-success audience; assert ALL 5 patronesses gain `+5`.
- **Ball veto** — set one patroness's favor to 15; assert `enterBallroom` returns `{ ok: false, reason: { kind: "BallVetoedByPatronesses", patronessIds: [<that id>] } }`.
- **Duel resolver — challenger asymmetry test.** With identical traits + composure AND `forceParryEveryExchange: true` (parry blocks every hit; composure stays at 100; reaches the 12-exchange `DUEL_MAX_EXCHANGES` cap deterministically), assert `outcome === "Stalemate"`. This is the canonical Stalemate-by-construction test (resolves Cycle-6-Iter-2 B3).
- **Duel resolver — challenger-first attack ordering.** With `forceNoParryEveryExchange: true` (every attack lands, full -50 composure each), confirm the duel terminates after **exchange 3** (resolves Cycle-7 B2 off-by-one): exch 1 challenger→defender 100→50; exch 2 defender→challenger 100→50; exch 3 challenger→defender 50→0 → loser is defender, outcome `ChallengerVictory`, `exchangesElapsed === 3`. The challenger-attacks-first contract is verified by the deterministic loser-is-defender outcome. **Test-mode overrides (resolves Cycle-6-Iter-1 B2 + Cycle-6-Iter-2 B3):** the resolver's 4th-param `opts` accepts `forceParryEveryExchange` for the Stalemate test and `forceNoParryEveryExchange` for the asymmetry test; both default `undefined` → production PRNG behavior. The two overrides are mutually exclusive; the wrapper does NOT support custom seed pinning (would require multi-draw sequence engineering that's harder to read than the override approach).
- **Killed-vs-wounded 50/50 over 1000 trials within tolerance** — see Edge cases above.
- **`pruneOrphanedConversationKeys` rival branch.** Kill a rival-associated character; assert (a) their id is dropped from the rival's `associatedCharacterIds`, (b) any whisper about them flips to Dismissed, (c) the rival itself remains in `state.rivalActors` (rivals don't disappear when their associated characters die).
- **`v1-to-v9-chain.test.ts`** — full chain V1→V2→…→V9 produces identical hash to fresh-state bootstrap.
- **`replace-state.test.ts`** — four new `it(...)` blocks confirm the four new top-level Maps survive a tick-advancing action.
- **`overwriteFromGameState`** test confirms all four new draft writes are present.
- **Bootstrap parity test** — `createInitialState` produces exactly 5 houses (1 player + 1 Independent + 3 rivals), exactly 15 characters (1 player + 5 Independent baseline + 9 rival-associated), exactly 5 patronesses, exactly 3 rival actors, exactly 6 faction-tension entries (all at 0), and exactly 0 duels.
- For UI changes: at P8 only `enterBallroom` gains a real veto branch — exercise it manually in the dev server by setting one patroness's favor below 20 via test fixture and confirming the rejection banner names the snubbing patroness.
- For LLM-touching changes: NONE at P8 (rivals don't enter the conversation system; patronesses don't have personas). No new LLM failure paths.

**Close out.** When the gates and verification items above are green, run `/close-phase P8` to update phase status in `plans/MASTER.md` §6, append to `plans/SESSION-NOTES.md`, resolve any open questions answered during the work, apply any `CLAUDE.md` additions, and commit the changes (no push).

## Accumulated Risks & Suggestions

*Passively collected from review cycles. Triaged at end of cycle 2. Each item carries one of: `[folded into <section>]` (resolved in plan body), `[deferred to <phase>]` (out of P8 scope), or `[still-open]` (genuine open question deferred to implementation-time judgment).*

### Folded into plan body

- [C1] RIVAL_ACTION_KINDS cardinality assertion — `[folded into Constants module-load assertions block]`
- [C1] Float weight modulo determinism — `[folded into applyRivalActionPhase pseudo-code integer-scale step]`
- [C1] Per-rival RNG seed formula — `[folded into Per-rival RNG seeding subsection (string-concat form)]`
- [C1] tryStartScheme rival wealth deduction — `[folded into tryStartScheme widening (skipWealthDeduction field)]`
- [C1] Duel resolver math (12-exchange unreachable) — `[folded into DUEL_PARRY_PROBABILITY constant + revised draw budget]`
- [C1] Per-iteration accumulator for rivalActors — `[folded into applyRivalActionPhase pseudo-code (Acc skeleton)]`
- [C1] PHASES.length 9→10 enforcement — `[folded into PHASES golden-hash regeneration section (test-side phaseOrderTracker discipline per P7 precedent)]`
- [C1] Migration outputSchema in registration — `[folded into Save-version cutover section]`
- [C1] Off-by-one killed-vs-wounded — `[folded into DUEL_KILLED_VS_WOUNDED_PROBABILITY constant comment]`
- [C1] FauxPasFired consumer extension — `[folded into Existing integrations section (inline same-block bump)]`
- [C1] RIVAL_HOUSES_FIXTURE placeholder entries — `[folded into RIVAL_HOUSES_FIXTURE block (all 9 chars + traits populated)]`
- [C1] 9 rival-character defaults — `[folded into buildRivalCharacter 17-field defaults subsection]`
- [C1] FACTION_DISPLAY_NAMES declaration — `[folded into FACTIONS_FIXTURE block (explicit array)]`
- [C1] Promote HouseSchema widening — `[folded into HouseSchema widening top-level In-scope bullet]`
- [C2] Float weight scaling in pseudo-code — `[folded into applyRivalActionPhase Acc skeleton (Math.floor × 100)]`
- [C2] applyRivalActionPhase multi-Map accumulator — `[folded into applyRivalActionPhase Acc skeleton]`
- [C2] Action gating atomicity for rival cooldown — `[folded into applyRivalActionPhase step 6 (cooldown unconditional on Skipped per Cycle-3 design call)]`
- [C3] Per-rival RNG bootstrap-vs-migration parity assertion — `[folded into v1-to-v9-chain.test.ts parity assertion list]`
- [C4] dispatchRivalAction return type — `[folded into DispatchResult discriminated union pin]`
- [C4] tryStartScheme mid-loop stale state — `[folded into OpenSabotage synthetic GameState reconstruction]`
- [C4] applyPatronessErosionPhase PRNG drift — `[folded into round-robin (tick % size) design call; zero PRNG consumption]`
- [C4] PHASES slot 9 hash invalidation — `[folded into Golden-hash regeneration list section]`
- [C5] findGrievanceAcrossHouses helper — `[folded into demandSatisfaction(perpHouseId, grievanceId) signature (UI passes both args; no cross-house walk)]`
- [C6] state.characters read-stability invariant — `[folded into applyRivalActionPhase head-alive gate inline comment]`
- [C8] Stale seedV8FieldsIntoLegacyState comments — `[folded into Stale comment cleanup verification step]`
- [C9] GrievanceSchema nested-strip cascade — `[folded into nested strip cascade section with HouseForV{N}EmitSchema helpers]`
- [C11] StartSchemeResult.TargetIsDead variant verified — `[folded into OpenSabotage dispatcher branch (verified live at schemes.ts:57,252)]`

### Still open (implementer judgment at P8 implementation time)

- [still-open] [C1] Helper naming inconsistency — `seedRivalsAndPatronessesIntoLegacyState` vs P7 `seedV{N}FieldsIntoLegacyState` convention. **Author call:** keep the content-named form for v1 (no rename); P4-P6 used content-named seeders too. The version-numbered form is a P7-only convention; rename is mechanical if convention-consistency wins out.
- [still-open] [C1] PvE duels against rival-house grievances — `demandSatisfaction` accepts any unresolved grievance regardless of perpetrator (player-house OR rival-house). Pinned: rival-house perpetrators ARE a valid duel target at P8.
- [folded] [C1] loserCasualty schema vs Stalemate — RESOLVED at line 103 + line 237: required `z.enum(DUEL_CASUALTIES)`, defaults to `"Unharmed"` at duel creation. NOT nullable. Single canonical shape.
- [still-open] [C1] No grievance-age cap for demandSatisfaction — v1 design: no cap; player can duel on arbitrarily-old grievances. Pin "no cap, by design" in the rejection enumeration at code time.
- [still-open] [C1] Bus cross-cutting subscriber table — P14 ledger ships the UI; the cross-bus assembly is a P14 design concern, not P8's. Add subscriber registration table at P14 plan time.
- [still-open] [C1] Strip-on-emit fixture-id filter assumes rivals never reproduce — pin as v1 invariant at code time; revisit if P11 grants rivals reproduction.
- [applied] [C1] Cooldown disabled test mode — pinned in `applyRivalActionPhase` signature as `opts?: { cooldownOverride?: number }`; default `undefined` uses `RIVAL_ACTION_COOLDOWN_TICKS`; verification test passes `{ cooldownOverride: 0 }`.
- [still-open] [C1] Publisher-count table cross-walked per wrapper — implementer ships the table in code-comment form at `src/game/store.ts` near the wrapper definitions; plan documents the totals in prose.
- [still-open] [C1] Spec-line-index subsection — implementer pins line-anchored quotes during implementation; plan references stay as is.
- [applied] [C1] checkBallVeto return shape simplification — pinned `{ vetoedBy: PatronessId[] }` (empty = no veto) at the rule signature + rejection variant; single canonical shape across all call sites.
- [applied] [C2] pruneOrphanedConversationKeys rival-branch accumulator — pinned in the plan body with explicit `let newRivalActors: Map | null = null` lazy-clone pattern matching the P7 `newChars` precedent. Multi-rival-death year-pass safe.
- [still-open] [C2] migrate_v7_to_v8.test.ts outputSchema assertion — implementer adds the per-step assertion at code time per the existing per-step pattern across V1-V8 migration tests.
- [still-open] [C3] Stalemate-favors-defender mechanical effect — v1 design: narrative-only (grievance stays unresolved; player can re-challenge). Pin in Edge cases section at code time.
- [skipped: requires codebase verification] [C3] Test fixture houses.size/characters.size audit — implementer runs `rg 'houses.size|characters.size' src/` at code time and updates any baselines.
- [folded] [C3] Stalemate-rate verification test — RESOLVED at Cycle-6-Iter-3 B3 fix (line ~584): no statistical 1000-trial stalemate-rate test ships; verification uses `forceParryEveryExchange: true` for deterministic stalemate coverage.
- [folded] [C7] RIVAL_OPEN_SABOTAGE_TENSION_BIAS_SLOPE × 100 5-point resolution — pinned ×100 in body with explicit rationale (1-percentage-point per integer tension step is finer than playtest can distinguish; ×100 also produces tighter modulo arithmetic).
- [folded] [C7] Doubled-erosion reachability via player-Crown faction — RESOLVED at Cycle-5-Iter-3 B2 fix (`applyPatronessErosionPhase` step 4): the lookup uses `makeFactionPairKey(rival.factionId, patroness.factionId)` over active rivals (NOT player-Crown faction), making the doubled-erosion path naturally reachable.
- [applied] [C9] PETTY_SABOTAGE_REPUTATION_DELTA — pinned in `src/game/constants.ts` extension list: `PETTY_SABOTAGE_REPUTATION_DELTA = -2` (designer-tunable; consumed by `dispatchRivalAction` PettySabotage branch). Add to the constants section adjacent to `RIVAL_ACTION_WEIGHTS`.
- [still-open] [C9] Quad-sync test coverage consolidation — implementer confirms all 4 surfaces have test coverage at code time per the existing P7 pattern.
- [still-open] [C9] Round-robin patroness erosion concentration pattern — accepted at plan time (round-robin is the v1 design call per Cycle-3 B2 resolution); revisit at v1.5 playtest.
- [still-open] [C9] DuelResolved event payload pre/post-prune ordering — implementer confirms post-prune ordering at code time per the existing event-bus discipline.
- [applied] [C10] RaiseFactionTension at-cap pre-filter — pinned in `computeEffectiveWeights` as a zero-out when the lex-pick opposing pair is at `FACTION_TENSION_CAP`. Eliminates the cooldown-burn-on-terminal-skip wedge.
- [still-open] [C10] Per-rival RNG advance-N-ticks parity — implementer adds the N-tick advance parity assertion at code time alongside the tick-0 parity test.
- [applied] [C10] state.patronesses read-stability invariant — `state.patronesses` is read-stable within `applyRivalActionPhase` (rival action loop never mutates patronesses; mutations happen in `applyPatronessErosionPhase` at slot 9 which runs BEFORE the rival phase at slot 10). Future dispatcher path that mutates patronesses MUST add `patronesses` to `Acc` + thread through. Document inline at the Acc type declaration.
- [skipped: requires codebase verification] [C10] Golden-hash regen audit `rg` results — implementer runs `rg "hashState|hashableState" src/game/rules/*.test.ts` at code time and updates per the audit list.
- [folded] [C12] dispatchRivalAction "TargetDead" catch-all — RESOLVED at Cycle-7-Iter-2 B3 fix: catch-all returns `"OtherRejection"` (distinct from `"TargetDead"`); `DispatchResult` union widened accordingly.
- [folded] [C13] Per-rival RNG `extractPlayerSeed` reuse in V8→V9 seeding helper — RESOLVED at Cycle-6-Iter-1 B4 fix: `seedRivalsAndPatronessesIntoLegacyState(state: GameState, playerSeed: string): GameState` signature pinned; `extractPlayerSeed(save.rng)` reuse documented in the migration body.

### Deferred to later phases

- [deferred to P11] [C7] FauxPas grievance backfill misattribution risk — current default (`defendantCharacterId = perpHouse.headOfHouseCharacterId`) is correct at P8 (only head has ballroom-action affordance). P11+ adds non-head ballroom actions; eventual remediation reads `state.schemes[grievance.schemeId].aggressorCharacterId` for Sabotage grievances.
- [deferred to P14] [C2] Cross-bus subscriber registration table for `demandSatisfaction` — P14 ledger is the consumer; cross-bus assembly belongs in P14's UI design.

### Folded in cycle 4 (proactive recurring-risk consolidation)

- [folded] Float arithmetic in `computeEffectiveWeights` — `RIVAL_OPEN_SABOTAGE_TENSION_BIAS_SLOPE` now stored as integer `_SCALED = 5` (not 0.05 float); all weighted-pick arithmetic is integer-clean.
- [folded] `RIVAL_CHARACTER_IDS_SET` declaration — exported from `src/game/fixtures/rivals.ts` with module-load `size === 9` assertion.
- [folded] `RIVAL_HOUSE_IDS_SET` per-rival RNG seed separator collision check — module-load assertion that no `RivalHouseId` contains `|`.
- [folded] `GrievanceResolved` event variant — declared in `runtime/events/duels.ts`.
- [folded] `loserCasualty` schema decision — pinned as required `z.enum(DUEL_CASUALTIES)` (not nullable); defaults to `"Unharmed"` at duel creation.
- [folded] `DefenderExiled` rejection variant on `demandSatisfaction` — added for defense-in-depth.
- [folded] Player-exile gate in `applyRivalActionPhase` — early-continue when `state.houses.get(PLAYER_HOUSE_ID).exiled === true`; cooldown does NOT burn (terminal-state per CLAUDE.md).
- [folded] `LegacyGrievanceUnactionable` rejection variant on `demandSatisfaction` — added for legacy backfill grievances with `defendantCharacterId: null`.

