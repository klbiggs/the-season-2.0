# P6 — Whispers, Espionage & Staff

> Part of [The Season Master Plan](../MASTER.md). Prior: [P5 — Schemes](./05-schemes.md). Next: [P7 — Family, Marriage & Succession](./07-family-succession.md).

**Goal.** Espionage as a parallel state economy. Whispers (rumors) accumulate from conversation-synergy hits and from household staff working assignments; they travel from the source NPC's location to the player's home (Capital) via courier with a tick-delayed arrival; once arrived they verify per-tick toward Verified; once Verified the player may weaponize them down one of three risk-distinct branches (Blackmail, Scandal Sheet, Accidental Slip) or hold/dismiss. Underpaid Greedy staff carry a per-tick bribery roll; bribed staff cease player-loyal outputs and start leaking inbound whispers about the player house. Save format bumps to **v7** to carry three new top-level GameState Maps (`whispers`, `couriers`, `staff`) and one new House field (`exiled: boolean` — for the Scandal Sheet attribution terminal endgame). P6 also REPLACES the P1-stubbed `identityPhase` at orchestrator slot 4 (`applyCourierAndStaffPhase`), so the orchestrator finally has a non-stub espionage step. P6 widens the LLM tool surface from `[respond]` to `[respond, generateWhisper]` — the second tool was reserved at P4 via the `toolCalls?: Array<...>` field on `ConversationResponseSchema` (typed at P4 as `z.array(z.never()).default([])`) and P6 promotes it to a real variant.

This phase is the project's first **multi-house-asymmetric** state surface. Schemes (P5) cross houses through their effects (Sabotage damages the target, etc.) but every scheme is OWNED by exactly one house; whispers, by contrast, have a tripartite identity: a **source character** (who's spreading it), a **subject character** (who it's about), and a **destination house** (where it's routed to). Courier payloads add a fourth axis: **origin location** vs **destination location** (the transit table from `fixtures/locations.ts:TRANSIT_PAIRS` is the symmetric lookup, already shipped at P1 via `rules/courier.ts:transitTicks`). The compositional shape of these surfaces is why P6 ships three coordinated entity types instead of one fat "Whisper" entity. The whisper itself is the durable record; the courier payload is the in-flight carrier (deleted on arrival per registry-discipline... wait, no — couriers are status-flipped to `"Delivered"`, never deleted, mirroring the schemes/characters/houses/marriages never-deleted invariant).

The non-determinism boundary stays firm: the LLM's `generateWhisper` tool call is ADDITIVE on top of the deterministic synergy whisper (spec §3 line 110). Every deterministic whisper-emission path goes through the seeded gameplay PRNG (e.g., bribery rolls, Scandal Sheet attribution); the LLM-generated additive whisper carries an `llmGenerated: true` flag for replay-debugger inspection but its TEXT BODY is the only non-deterministic part — the whisper's id, source/subject/destination, originating tick, and verification trajectory are all deterministic. This preserves the §5.1 invariant that the LLM doesn't perturb the gameplay PRNG call-count.

**In scope.**

- **Save format bump to v7.** Adds three top-level GameState surfaces + one House field:
  - **`GameState.whispers: Map<WhisperId, Whisper>`** — every Unverified/Verified/Weaponized/Dismissed whisper. Status field on the entity (mirrors P5's Scheme.status); whispers never deleted. Empty by default on fresh state and on every legacy lift.
  - **`GameState.couriers: Map<CourierPayloadId, CourierPayload>`** — every in-flight or Delivered courier payload. Status field on the entity (`InFlight | Delivered | Intercepted | Cancelled`); couriers never deleted. Empty by default on fresh state and on every legacy lift.
  - **`GameState.staff: Map<StaffId, StaffMember>`** — household staff. Loyal, GreedyBribed, or BribedByRival; assignment slot owned per-member. Seeded with 4 baseline staff on fresh state and on every legacy lift (idempotent via the seed helper).
  - **`House.exiled: boolean`** — set to `true` by the Scandal Sheet attribution endgame; default `false`. Renders the player house "out of bounds" — UI treats the campaign as terminated. Fresh state and every legacy lift default to `false`.

- **Whisper entity shape and `WhisperId` brand.** Branded `WhisperId = string & { __brand: "WhisperId" }` exported from `src/game/rng.ts` alongside the existing `SchemeId`/`GrievanceId` brands. Companion `WhisperIdSchema` (using `.transform` per CLAUDE.md `.transform`-not-`.brand` convention) ALSO exported from `rng.ts`. Same export discipline as `SchemeId`/`GrievanceId` at P5. Whisper shape in `src/game/entities.ts` per spec §4 line 542:
  ```ts
  // src/game/entities.ts (P6 addition):
  export const WhisperSchema = z.object({
    id: WhisperIdSchema,
    text: z.string(),                                  // body; templated at v1, LLM-extended via generateWhisper tool
    originatingTick: z.number().int().nonnegative(),   // tick when the source emitted the whisper
    sourceCharacterId: CharacterIdSchema,              // who spread it
    subjectCharacterId: CharacterIdSchema,             // who it's about
    destinationHouseId: HouseIdSchema,                 // recipient house (player at v1; rivals at P8)
    arrivedAtTick: z.number().int().nonnegative().nullable(), // null until courier delivers
    verificationProgress: z.number().int().min(0).max(100),
    status: z.enum(WHISPER_STATUSES),                  // Unverified | Verified | Weaponized | Dismissed
    weaponizedAs: z.enum(WEAPONIZATION_BRANCHES).nullable(), // null until weaponized
    weaponizedAtTick: z.number().int().nonnegative().nullable(),
    scandalSheetAttribution: z.boolean().nullable(),   // null unless weaponizedAs === "ScandalSheet"
    accidentalSlipDripsRemaining: z.number().int().min(0), // 0 unless weaponizedAs === "AccidentalSlip"
    llmGenerated: z.boolean(),                          // true if produced by generateWhisper tool call
  });
  export type Whisper = z.infer<typeof WhisperSchema>;
  ```
  - **Why status on the entity (not separate collections)**: matches P5's Scheme.status pattern verbatim. The diff-publish helper (`publishWhisperTransitions`) walks `before.whispers` vs `after.whispers` and emits the right event variant per transition. Filtering by `status === "Unverified"` is the verification-phase walk; filtering by `status === "Verified"` is the weaponization UI's row filter.
  - **Why `arrivedAtTick` on the entity (not on the courier)**: enables P14 ledger to render "Arrived 3 ticks ago" without joining whispers ↔ couriers. The courier carries the whisper from origin to destination; on delivery the courier flips to `"Delivered"` AND the whisper's `arrivedAtTick` is set to `state.tick`. The two writes happen in the same atomic phase step (`applyCourierAndStaffPhase`'s drain sub-step).
  - **Why `weaponizedAs` is a separate field (not derived from `status === "Weaponized"`)**: a Weaponized whisper has three possible payloads, and the diff helper needs a discriminator to emit `BlackmailApplied` vs `ScandalSheetPublished` vs `AccidentalSlipStarted` events. Mirrors P5's `failureReason` discriminator on Scheme.
  - **Why `accidentalSlipDripsRemaining` is on the whisper (not on a sidecar)**: an active Accidental Slip drips for 5 ticks (per the `ACCIDENTAL_SLIP_DURATION_TICKS` constant); each conversation turn with the subject during that window decrements by 1 and applies `-2 reputation` to the subject's house. Storing the counter on the whisper avoids a separate `state.activeSlips: Map<WhisperId, number>` field — the whisper IS the slip's identity.
  - **Why `llmGenerated: boolean`**: replay-debugger inspection. Two whispers with identical id/source/subject differ in source — deterministic-synergy vs LLM-additive. The flag is hash-relevant (it's a field on a hashed entity), but adding an LLM-additive whisper requires advancing the per-house PRNG via `makeWhisperId` (which counts existing whispers on this tick — see WhisperId factory below) so two replays with the same seed AND identical LLM additive output produce identical hashes. **The flag DOES NOT exempt the entity from the hash projection** — same discipline as P5's `accumulatedAffection: 0` "dead data at v1" field. Future tools may consume the flag (e.g., a "regenerate flavor" debug button).

- **CourierPayload entity shape and `CourierPayloadId` brand.** Branded `CourierPayloadId = string & { __brand: "CourierPayloadId" }` exported from `src/game/rng.ts`. Companion `CourierPayloadIdSchema` with `.transform`. Per spec §4 line 545:
  ```ts
  // src/game/entities.ts (P6 addition):
  export const CourierPayloadSchema = z.object({
    id: CourierPayloadIdSchema,
    payloadType: z.enum(COURIER_PAYLOAD_TYPES),       // "Whisper" — sole variant at v1; future "Letter" reserved
    whisperId: WhisperIdSchema,                        // the whisper being carried
    originHouseId: HouseIdSchema,                      // sender house (source NPC's house)
    destinationHouseId: HouseIdSchema,                 // recipient house
    originLocation: LocationIdSchema,
    destinationLocation: LocationIdSchema,
    originTick: z.number().int().nonnegative(),
    arrivalTick: z.number().int().nonnegative(),       // ABSOLUTE end-tick per CLAUDE.md §2
    interceptable: z.boolean(),                        // true → eligible for Spymaster mail-intercept action
    direction: z.enum(COURIER_DIRECTIONS),             // "Inbound" (to player) | "Outbound" (from player)
    status: z.enum(COURIER_STATUSES),                  // InFlight | Delivered | Intercepted | Cancelled
    resolvedAtTick: z.number().int().nonnegative().nullable(),
  });
  export type CourierPayload = z.infer<typeof CourierPayloadSchema>;
  ```
  - **Why `whisperId` REQUIRED (not nullable)** at v1: every courier payload at v1 carries a whisper. `payloadType: "Letter"` is reserved as a forward-compat slot (e.g., P11 inherited-secrets letters), but no v1 path produces it. The required field forces the resolver to always reach a whisper — eliminates the conditional-on-payloadType branch in every consumer. A future payloadType that doesn't carry a whisper would need its own carrier type OR a save-version bump to make whisperId nullable.
  - **Why `direction` is on the entity (not derived from `originHouseId === PLAYER_HOUSE_ID`)**: at P8 with rivals, a courier from rival-A to rival-B is neither inbound nor outbound from the player's perspective. Storing `direction` explicitly lets the Spymaster mail-intercept rule filter by `direction === "Inbound" AND destinationHouseId === PLAYER_HOUSE_ID` without a derived check. At P6 with no rivals, every outbound courier has `originHouseId === PLAYER_HOUSE_ID` (bribed-staff payloads) and every inbound has `destinationHouseId === PLAYER_HOUSE_ID` (everything else).
  - **Why `interceptable: boolean` on the entity**: spec §4 line 545 calls it out as a flag. At v1 every whisper-carrying inbound courier is interceptable; outbound couriers (bribed-staff leaks) are NOT interceptable from the PLAYER's side (the player can't intercept their own bribed staff's outbound mail — though they CAN reassign the staff to stop further leakage). The Spymaster mail-intercept rule reads this flag.
  - **Why never deleted**: matches the project's broader entity-lifecycle invariant. A Delivered courier is a historical record (P14 ledger may show "delivered 30 ticks ago"). A Cancelled courier (e.g., source NPC died mid-flight — see edge case below) preserves the cancellation reason for postmortem.

- **StaffMember entity shape and `StaffId` brand.** Branded `StaffId = string & { __brand: "StaffId" }` exported from `src/game/rng.ts`. Per spec §4 line 558:
  ```ts
  // src/game/entities.ts (P6 addition):
  export const StaffMemberSchema = z.object({
    id: StaffIdSchema,
    houseId: HouseIdSchema,                            // owning house — always PLAYER_HOUSE_ID at P6
    name: z.string(),
    isGreedy: z.boolean(),                              // spec §4 line 558 — Greedy trait carrier
    loyalty: z.number().int().min(0).max(100),         // clamped at every mutation site per CLAUDE.md §6
    upkeepPerTick: z.number().int().positive(),        // wealth cost per tick
    assignment: z.enum(STAFF_ASSIGNMENTS),             // Snoop | BribeDriver | InterceptMail | None | BribedByRival
    lastOutputTick: z.number().int().nullable(),       // null = never produced; tick of most recent output
    bribedAtTick: z.number().int().nonnegative().nullable(), // null unless assignment === "BribedByRival"
  });
  export type StaffMember = z.infer<typeof StaffMemberSchema>;
  ```
  - **Why `isGreedy: boolean` (not a `traits: TraitId[]` array per Character)**: staff are NOT first-class Characters at v1 — they're a separate entity type with a narrow shape. They don't appear in `state.characters`, don't get conversation history, don't have moods, and don't age. The Greedy trait is the ONLY trait that matters at v1 (it's the bribery-risk multiplier per spec §3 line 204), so a boolean is more direct than a traits array carrying just `["Greedy"]` or `[]`. Future phases that want richer staff (P15 dynasty-perk effects on staff loyalty, P16 procedural identity for hired-vs-baseline staff) can extend with additional fields.
  - **Why `assignment: "BribedByRival"` is its own enum value (not a separate `isBribed` flag)**: a bribed staff member CEASES player-loyal output (spec §7 line 654) — the assignment field's value IS the source of truth for "is this staff producing for the player or against?". Conflating with the player-elected assignment value lets the cadence-resolver branch on a single enum, not a conjunction `(assignment, isBribed)`. The pre-bribe assignment is NOT preserved (resolved by design: once bribed, the player has no UI affordance to "un-bribe" — the staff member must be FIRED to remove them, which P6 does NOT ship; staff are durable until P15 dynasty perks add a fire-staff affordance).
  - **Why staff are NOT in `state.characters`**: characters have a 32-trait identity, mood, age, deathAge, role, archetype, conversation history. Staff are a downstairs/below-stairs class — historically NOT participants in social-circle conversations. P14's ledger will render a Staff tab separate from the Family tab. If a future phase wants a staff member to ascend to social-character status (e.g., marriage between dependent and lady's maid — a hypothetical scandal trigger), it would require an explicit "promote staff to character" rule with a save-version bump.
  - **Loyalty mutation sites at P6**: (a) per-tick drift in `applyStaffOutputsPhase` — `-1/tick` if `wealth < 0` AND staff hasn't been paid, `-2/tick` if `isGreedy AND wealth < 0`; (b) NEVER mutated by upkeep payment directly (upkeep is a SEPARATE per-tick wealth deduction at the economy phase — see "Upkeep deduction site" below). Clamped `[0, 100]` at the mutation site per CLAUDE.md non-negotiable §6.

- **`migrate_v6_to_v7` and lifter discipline.** Pure function `(SaveV6) → SaveV7` at `src/persist/migrations/v6-to-v7.ts`. Body follows the bare+wrap-then-reserialize pattern from P4/P5:
  ```ts
  export function migrate_v6_to_v7(save: SaveV6): SaveV7 {
    const bare = fromSaveV6Bare(save);                                    // pure deserialize
    const seeded = seedWhispersCouriersStaffIntoLegacyState(bare);
    return toSaveV7(seeded);
  }
  ```
  Effects:
  - Adds `whispers: new Map()` to `GameState` (via the bare deserializer's defaults).
  - Adds `couriers: new Map()` to `GameState` (via the bare deserializer's defaults).
  - Adds `staff: <seeded 4 baseline staff Map>` to `GameState` (via the seeding helper).
  - Adds `exiled: false` to every House (via `defaultHouseV7Fields` symmetric with P5's `defaultHouseV6Fields`).
  - Re-serializes as SaveV7 tuple arrays.
  - Draw budget: **ZERO** — every default is a literal constant; the baseline staff have constant ids/names/loyalties; no PRNG calls.
  - Idempotence assertion ships in `src/persist/migrations/v6-to-v7.idempotence.test.ts` via `assertMigrationIdempotent` (the P2 helper).

  **`seedWhispersCouriersStaffIntoLegacyState` helper** lives in `src/persist/schema.ts` (private to lift/migrate boundary). Idempotent on three dimensions:
  - Walks `state.houses` and adds `exiled: false` only to houses where the field is absent (structural-not-contents check).
  - Returns `whispers: state.whispers ?? new Map()`.
  - Returns `couriers: state.couriers ?? new Map()`.
  - Returns `staff: state.staff ?? <buildBaselineStaffMap()>` — the helper ONLY seeds baseline staff when `state.staff` is undefined OR `state.staff.size === 0`. **Idempotence specifically:** if a fresh-state path has already seeded `state.staff` with the 4 baseline members AND the user has reassigned them or earned bribery, calling the helper twice MUST NOT reset the assignments — the size check (`state.staff.size === 0` → seed; non-zero → preserve) is the load-bearing branch. The idempotence assertion in test is `assertMigrationIdempotent(migrate_v6_to_v7, fixture)`; the structural assertion `expect(helper(s)).toEqual(helper(helper(s)))` proves the size-check branch is correct.

  **Bare+wrap lifter discipline (CLAUDE.md).** P5 documented the full Bare-split chain at V1-V5; P6 extends with V6Bare. **Required edits to the existing lifter chain at `src/persist/schema.ts`:**
  - **`defaultHouseV4Fields` (currently `:55`)**: widen to ALSO default `exiled: false`. P5 widened this helper to include `grievances: []`; P6 extends with `exiled: false`. Function name retained.
    ```ts
    // src/persist/schema.ts:55 AFTER P6:
    function defaultHouseV4Fields(h: HousePreV4): House {
      return {
        ...h,
        currentLocation: "Capital",
        consecutiveTicksAtCurrentLocation: 0,
        lastAudienceTick: null,
        wardrobeLastRefreshTick: null,
        blockadeBypassEarned: false,
        grievances: [],
        exiled: false,           // NEW at P6
      };
    }
    ```
  - **`defaultHouseV6Fields` (currently `:83`)**: similarly widen.
    ```ts
    // src/persist/schema.ts:83 AFTER P6:
    function defaultHouseV6Fields(h: HousePreV6): House {
      return { ...h, grievances: [], exiled: false };  // P6 adds exiled: false
    }
    ```
  - **NEW at P6**: `HousePreV7Schema` + `HousePreV7` TS alias adjacent to the existing `HousePreV4Schema`/`HousePreV6Schema` pair, mirroring the P5 precedent.
    ```ts
    // src/persist/schema.ts (NEW at P6):
    const HousePreV7Schema = HouseSchema.omit({ exiled: true });
    type HousePreV7 = z.infer<typeof HousePreV7Schema>;
    ```
    Used ONLY by `SaveV6Schema` post-P6 cutover (the houses tuple value swaps from live `HouseSchema` to `HousePreV7Schema`). All earlier save schemas (V2-V5) already target their narrower aliases (`HousePreV4Schema` or `HousePreV6Schema`); no change.
  - **NEW at P6**: `defaultHouseV7Fields(h: HousePreV7): House` — returns `{ ...h, exiled: false }`. Symmetric with `defaultHouseV6Fields` but for the narrower V6 input shape.
  - **NEW at P6**: `liftLegacyHousesFromV7Pre(serialized: ...): GameState["houses"]` — applies `defaultHouseV7Fields` per house. Used by V6Bare ONLY. Same two-narrow-helpers pattern as P5 (avoids union-typed helper).

  **Explicit per-lifter edit list (verified against current `schema.ts`):**
  - **`fromSaveV1Bare`** through **`fromSaveV5Bare`**: NO houses-tuple change (their existing lifters route through `liftLegacyHouses` or `liftLegacyHousesFromV6Pre`; both produce V7-shape houses now that `defaultHouseV4Fields` and `defaultHouseV6Fields` are widened to default `exiled: false`). Each Bare body adds three field defaults for the new GameState-level fields: `whispers: new Map(), couriers: new Map(), staff: new Map()` (the seeded staff map is applied by the public wrapper's `seedWhispersCouriersStaffIntoLegacyState` composition — keeping the Bare core "no-seed" for symmetry with the existing pattern).
  - **`fromSaveV1`** through **`fromSaveV5`** public wrappers: extend the composition to also include `seedWhispersCouriersStaffIntoLegacyState` after the existing seed helpers. **All four legacy wrappers (V1-V4) AND `fromSaveV5` get the same extension** — enumerated explicitly to avoid the "Other wrappers V1-V4 similarly extend" hand-wave from earlier plan drafts:
    ```ts
    // src/persist/schema.ts (P6 edits to ALL five wrappers):
    export function fromSaveV1(save: SaveV1): GameState {
      return seedWhispersCouriersStaffIntoLegacyState(
        seedSchemesAndGrievancesIntoLegacyState(
          seedIndependentIntoLegacyState(fromSaveV1Bare(save), extractPlayerSeed(save.rng)),
        ),
      );
    }
    export function fromSaveV2(save: SaveV2): GameState {
      return seedWhispersCouriersStaffIntoLegacyState(
        seedSchemesAndGrievancesIntoLegacyState(
          seedIndependentIntoLegacyState(fromSaveV2Bare(save), extractPlayerSeed(save.rng)),
        ),
      );
    }
    export function fromSaveV3(save: SaveV3): GameState {
      return seedWhispersCouriersStaffIntoLegacyState(
        seedSchemesAndGrievancesIntoLegacyState(
          seedIndependentIntoLegacyState(fromSaveV3Bare(save), extractPlayerSeed(save.rng)),
        ),
      );
    }
    export function fromSaveV4(save: SaveV4): GameState {
      return seedWhispersCouriersStaffIntoLegacyState(
        seedSchemesAndGrievancesIntoLegacyState(
          seedIndependentIntoLegacyState(fromSaveV4Bare(save), extractPlayerSeed(save.rng)),
        ),
      );
    }
    export function fromSaveV5(save: SaveV5): GameState {
      // V5 saves already contain Independent by schema; no seedIndependent call.
      return seedWhispersCouriersStaffIntoLegacyState(
        seedSchemesAndGrievancesIntoLegacyState(fromSaveV5Bare(save)),
      );
    }
    ```

    **Migration-runner mid-chain seed-and-strip contract (resolves B2 from C8 iter 1 — LOAD-BEARING DOCUMENTATION).** The existing `migrate_v5_to_v6` at `src/persist/migrations/v5-to-v6.ts:13-20` composes `toSaveV6(fromSaveV5(save))` — i.e., it calls the PUBLIC wrapper `fromSaveV5` not the Bare core. After this P6 extension, `fromSaveV5` seeds whispers/couriers/staff into a GameState, then `toSaveV6` (whose body literal does NOT reference these fields — they're absent from `SaveV6Schema`) drops them on emission. The freshly-seeded entities are immediately discarded mid-chain. **The waste is intentional, not a bug:** keeping the V1-V5 wrapper extensions ensures DIRECT-LIFT consumers (test fixtures, future direct-load hot paths) produce V7-shape GameState from any legacy save without going through the migration runner. The migration-runner discard is a tolerated cost (the runner is offline migration, not gameplay-tick hot path). **DO NOT** "fix" the waste by dropping the V1-V5 wrapper extension — that would break direct-lift parity (`fromSaveV5` followed directly by `hashState` would have empty staff/whispers/couriers vs `createInitialState`'s populated state). The next migration step `migrate_v6_to_v7` re-seeds via `seedWhispersCouriersStaffIntoLegacyState` in its bare-route composition; the chain converges to V7-shape state at the runner's terminus. **Inline note in `migrate_v5_to_v6.ts` body** (add as a comment): `// P6 note: fromSaveV5's whispers/couriers/staff seeds are dropped at toSaveV6 emission (SaveV6 schema doesn't carry them); the V6→V7 step re-seeds. The mid-chain discard is by design — see plans/phases/06-whispers-espionage.md.`
  - **`fromSaveV6Bare` (NEW at P6)**: split the existing `fromSaveV6` body into a Bare core that does pure deserialization. Houses tuple call is `liftLegacyHousesFromV7Pre(save.houses)`. Other fields retain their existing handling. Adds `whispers: new Map(), couriers: new Map(), staff: new Map()` as the V6→V7 defaults.
  - **`fromSaveV6` (refactored)**: composes `Bare → seedWhispersCouriersStaffIntoLegacyState`. V6 saves already contain Independent + schemes/grievances by schema; no other seed composition needed.
  - **`fromSaveV7` (NEW at P6)**: pure deserialize directly via `deserializeRegistry(...)` — V7 saves contain live `HouseSchema` houses with `exiled` present, AND live `whispers`/`couriers`/`staff` Maps. NO Bare-split, NO seeding helper applies.

  **Bare-core export discipline (per P5 precedent).** `fromSaveV5Bare` is exported (P5 commit at `schema.ts:472`). **P6 follows: `fromSaveV6Bare` is ALSO exported.** Rationale: same as P5 — the migration runner consumes `migrate_vN_to_vN+1` not the public wrappers, but exporting Bare cores lets test fixtures and any direct-lift hot-path bypass the seed helpers. Making V6Bare private would force `migrate_v5_to_v6` to consume the public `fromSaveV5` wrapper, which would double-invoke the staff/whisper/courier seeder.

  Register in `src/persist/migrations/index.ts` after the existing `v5-to-v6` entry; `assertMonotonic(MIGRATIONS)` catches misregistration at module load.

- **Save-version cutover — full edit list at `src/persist/schema.ts` and `src/persist/dexie.ts`.** SaveV7 is the new live format. Following the P5 cutover pattern verbatim:
  - **`src/persist/schema.ts:36`**: `SAVE_VERSION_CURRENT = 6 as const` → `SAVE_VERSION_CURRENT = 7 as const`. Legacy `toSaveV1`/`.../toSaveV6` retain their literal `version: N` writes.
  - **`src/persist/schema.ts` append** — new `SaveV7Schema`, `toSaveV7`, `fromSaveV7` block following the SaveV6 block. Schema shape:
    ```ts
    export const SaveV7Schema = z.object({
      version: z.literal(7),
      tick: z.number().int().nonnegative(),
      rng: z.array(z.tuple([HouseIdSchema, RngStateSchema])),
      houses: z.array(z.tuple([HouseIdSchema, HouseSchema])),       // HouseSchema gains `exiled: boolean`
      characters: z.array(z.tuple([CharacterIdSchema, CharacterSchema])),
      marriages: z.array(z.tuple([MarriageIdSchema, MarriageRecordSchema])),
      campaignName: z.string(),
      era: z.enum(["Earlier", "Later"]),
      conversationHistory: z.array(z.tuple([ConversationPairKeySchema, z.array(ExchangeSchema)])),
      affectionMap: z.array(z.tuple([ConversationPairKeySchema, z.number().int().min(0).max(100)])),
      schemes: z.array(z.tuple([SchemeIdSchema, SchemeSchema])),
      whispers: z.array(z.tuple([WhisperIdSchema, WhisperSchema])),       // NEW at P6
      couriers: z.array(z.tuple([CourierPayloadIdSchema, CourierPayloadSchema])), // NEW at P6
      staff: z.array(z.tuple([StaffIdSchema, StaffMemberSchema])),         // NEW at P6
    });
    export type SaveV7 = z.infer<typeof SaveV7Schema>;
    export function toSaveV7(state: GameState): SaveV7 { /* serializeRegistry for state.whispers, .couriers, .staff */ }
    export function fromSaveV7(save: SaveV7): GameState { /* deserializeRegistry */ }
    ```
  - **Houses tuple value at each save schema (verified state, then P6 edits):**
    - `SaveV1Schema`: no houses — no edit.
    - `SaveV2Schema`/`SaveV3Schema`: already use `HousePreV4Schema` — no edit. Their Bare cores route through `liftLegacyHouses` (which now produces V7-shape houses via the widened `defaultHouseV4Fields`).
    - `SaveV4Schema`/`SaveV5Schema`: already use `HousePreV6Schema` — no edit. Their Bare cores route through `liftLegacyHousesFromV6Pre` (which now produces V7-shape houses via the widened `defaultHouseV6Fields`).
    - `SaveV6Schema`: currently uses live `HouseSchema` (verified at `schema.ts:502`). P6 changes to `HousePreV7Schema`. Its Bare core routes through `liftLegacyHousesFromV7Pre` (new at P6).
    - `SaveV7Schema` (NEW): uses live `HouseSchema` at the houses tuple value (V7 saves contain full live `House` with `exiled` present).

  **Legacy SaveV1-V6 schemas do NOT add `whispers`/`couriers`/`staff` tuple slots (clarification — by design).** This is the SAME discipline as P5's grievances exclusion: legacy save schemas remain frozen at their original shape. The post-P6 `toSaveV6` body (verified at `schema.ts:513-527`) explicitly lists each field in its returned object literal; `state.whispers` / `state.couriers` / `state.staff` are NOT in that literal, so the `SaveV6Schema.parse(...)` call receives an object WITHOUT those keys, and the parse passes cleanly because the schema doesn't expect them. **No silent data loss**: the implementer never tries to emit those fields to a legacy format — the legacy format predates them and exporting them would be nonsensical. **No strip helper is required** for the three new top-level Maps (only for the `exiled` field on House, because the live `HouseSchema` includes `exiled` and `serializeRegistry(state.houses)` emits the full live shape). A future implementer reading the post-P6 toSaveV6 body sees no `whispers:` line and correctly infers "this export drops the field." This matches the P5 grievances pattern: top-level GameState additions don't need strip helpers, only entity-level field additions do.

  - **`toSaveV4`/`toSaveV5`/`toSaveV6` emitter cascade (LOAD-BEARING — mirrors the P5 grievances pattern).** Post-P6 schema widening makes `SaveV6Schema` expect houses to match `HousePreV7Schema` (no `exiled` field). The existing `toSaveV6` body calls `serializeRegistry(state.houses)` and emits the live `House` shape — post-P6 that shape includes `exiled`. Without a strip, `SaveV6Schema.parse` rejects post-P6 `toSaveV6` output AND `migrate_v5_to_v6`'s `outputSchema.parse` step fails. **Required:** extend the strip helpers to also drop `exiled`:
    ```ts
    // schema.ts (REVISED at P6):
    // Strip ONLY exiled — targets HousePreV7 (live House minus exiled).
    // Used by toSaveV6 (V6 saves predate exiled).
    function stripExiledForLegacyEmit(
      entries: ReadonlyArray<readonly [string, House]>,
    ): Array<[string, HousePreV7]> {
      return entries.map(([id, h]) => {
        const { exiled: _e, ...rest } = h;
        return [id, rest as HousePreV7];
      });
    }

    // Strip exiled + grievances — targets HousePreV6 (live House minus
    // BOTH exiled and grievances). Used by toSaveV4 and toSaveV5
    // (V4/V5 predate both fields). Replaces the existing
    // stripGrievancesForLegacyEmit at P5.
    function stripV7FieldsForV6Pre(
      entries: ReadonlyArray<readonly [string, House]>,
    ): Array<[string, HousePreV6]> {
      return entries.map(([id, h]) => {
        const { exiled: _e, grievances: _g, ...rest } = h;
        return [id, rest as HousePreV6];
      });
    }

    // Strip exiled + grievances + 5 P3 fields — targets HousePreV4.
    // Used by toSaveV2 and toSaveV3. Replaces existing
    // stripV6FieldsForLegacyEmit at P5.
    function stripV7FieldsForV4Pre(
      entries: ReadonlyArray<readonly [string, House]>,
    ): Array<[string, HousePreV4]> {
      return entries.map(([id, h]) => {
        const {
          exiled: _e,
          grievances: _g,
          currentLocation: _cl,
          consecutiveTicksAtCurrentLocation: _cttcl,
          lastAudienceTick: _lat,
          wardrobeLastRefreshTick: _wlrt,
          blockadeBypassEarned: _bbe,
          ...rest
        } = h;
        return [id, rest as HousePreV4];
      });
    }
    ```
    **Per-emitter call-site updates:**
    - `toSaveV2`/`toSaveV3` (currently call `stripV6FieldsForLegacyEmit`): swap to `stripV7FieldsForV4Pre`. The helper RENAMES from `stripV6Fields…` to `stripV7Fields…ForV4Pre`; the old name is retired (single in-file rename, no other consumers).
    - `toSaveV4`/`toSaveV5` (currently call `stripGrievancesForLegacyEmit`): swap to `stripV7FieldsForV6Pre`. Old name retired.
    - `toSaveV6` (currently calls `serializeRegistry(state.houses)` directly with no strip — see `schema.ts:518`): add `stripExiledForLegacyEmit(serializeRegistry(state.houses))` wrapping. **This is the only NEW strip site at P6** — toSaveV2/V3/V4/V5 already had a strip wrapper at P5; they only need the body widening.
    - `toSaveV7` (NEW): NO strip — V7 is the live format; `exiled` is expected.

    **Migration runner correctness post-edit:** every legacy `migrate_vN_to_vN+1` step that composes via `toSaveV{N+1}` produces output that parses clean against the post-P6 `SaveV{N+1}Schema`. The full chain V1→V2→V3→V4→V5→V6→V7 runs to completion, with V6→V7's `seedWhispersCouriersStaffIntoLegacyState` adding `exiled: false` + the three new top-level Maps during the lift. The new `v1-to-v7-chain.test.ts` exercises every step.

  - **`src/persist/dexie.ts`** — `SaveRecord.data` union widening from `SaveV1 | ... | SaveV6` to `... | SaveV7` (documentation-only per P3/P4/P5). `load()` final-parse callsite changes to `SaveV7Schema.parse`; return-type annotation changes to `Promise<SaveV7 | undefined>`. Import `toSaveV7`, replace `toSaveV6` in the production write callsite (`save()` at `dexie.ts:61`). Same audit pattern: `rg 'SaveV6|toSaveV6|fromSaveV6' src/` post-cutover; expect only legacy-version-test hits (e.g., `src/persist/migrations/v6-to-v7.test.ts`).

  - **`src/main.tsx` `__buildSaveV6ForTests`** rename to `__buildSaveV7ForTests` per the P3/P4/P5 rename precedent. **Five reference sites must update in `src/main.tsx`** (enumerated to prevent silent stale-ref drift; verified against current `main.tsx` at 67 lines total):
    - **`main.tsx:7`** — import statement `import { toSaveV6 } from "./persist/schema";` updates to `import { toSaveV7 } from "./persist/schema";`.
    - **`main.tsx:18`** — comment line referencing `__buildSaveV6ForTests`; update comment text + the listed P5 surface enumeration (add "P6 whispers/couriers/staff registries").
    - **`main.tsx:26`** — TypeScript type annotation `__buildSaveV6ForTests` updates to `__buildSaveV7ForTests`.
    - **`main.tsx:34`** — window assignment `w.__buildSaveV6ForTests = ...` updates.
    - **`main.tsx:55`** — function body `return toSaveV6(...)` updates to `return toSaveV7(...)`.

    Audit: `rg '__buildSaveV6ForTests' .` (whole-repo scope including `src/`, `tests/`, and any e2e specs — at P5 close-out, verified ZERO references existed in `tests/e2e/*.spec.ts`; if a future phase adds an e2e spec that consumes the helper, the audit catches it). `rg 'toSaveV6' src/main.tsx` post-cutover expects zero hits. `rg '__buildSaveV7ForTests' .` expects the renamed sites enumerated above. **The `.` scope is load-bearing** — limiting to `src/` would miss e2e specs.

  - **`src/persist/migrations/index.ts`** — three coupled edits:
    1. **Imports.** Existing line carries `SaveV1Schema..SaveV6Schema`. Add `SaveV7Schema` alphabetical-by-version preserves ordering.
    2. **Migration import.** Add `import { migrate_v6_to_v7 } from "./v6-to-v7";` after the existing `migrate_v5_to_v6` import.
    3. **Registration.** The `MIGRATIONS` array currently ends with the `{ from: 5, to: 6, ... }` entry. P6 appends:
       ```ts
       { from: 6, to: 7, migrate: (s: unknown) => migrate_v6_to_v7(SaveV6Schema.parse(s)), outputSchema: SaveV7Schema },
       ```
    `assertMonotonic(MIGRATIONS)` catches misordering.

  - **Test-file edit list** — three test files import legacy V6 symbols and need explicit handling:
    - **`src/persist/save-roundtrip.test.ts`** — currently imports `fromSaveV6`. Update both import and call to `fromSaveV7`. V7 round-trip is symmetric (no strip + no seed for the current-version path). Same load-bearing claim as P5 — V7 toSaveV7/fromSaveV7 operates on the live HouseSchema shape; no strip, no seed.
    - **`src/persist/migrations/v1-to-v6-chain.test.ts`** (added at P5) — extend the chain assertion to `runMigrations(saveV1, 1, 7, MIGRATIONS)` and lift via `fromSaveV7`. Also add the new full-chain regression file `src/persist/migrations/v1-to-v7-chain.test.ts`. **Parity-invariant assertion pinned:** `expect(hashState(fromSaveV7(runMigrations(saveV1, 1, 7, MIGRATIONS)))).toBe(hashState(createInitialState(seed, DEFAULT_CAMPAIGN_NAME)))` for a fresh-state seed. **Hash-equivalence claim load-bearing pieces:** (a) `createInitialState` initializes every house's `exiled: false`; (b) `seedWhispersCouriersStaffIntoLegacyState` ALSO initializes every house's `exiled: false`; (c) both paths produce IDENTICAL baseline-staff via `buildBaselineStaffMap()` (single source of truth — see Staff fixtures below); (d) both paths produce `whispers: new Map()` and `couriers: new Map()`; (e) `serializeRegistry` lex-sorts deterministically. Together these make the hash-equivalence strict equality.
    - **`src/persist/dexie.test.ts`** — semantics shift mirroring the P3/P4/P5 pattern. Add "fires InvalidSaveSchemaError when SaveV7 fields are malformed" (current-version path). Rename the existing SaveV6-malformed test to "fires MigrationFailedError when migrating-from-V6 fails on malformed fields". Add SaveV7-specific corruption fixtures: whisper with `verificationProgress: 150` (out of `min(0).max(100)` range) → `InvalidSaveSchemaError`; courier with `arrivalTick: -1` → `InvalidSaveSchemaError`; staff with empty `id: ""` (fails brand transform) → `InvalidSaveSchemaError`.

- **`src/game/constants.ts` extended.** New entries appended to the P1/P2/P3/P4/P5 set:
  - **Module-load assertion** adjacent to `WHISPER_STATUSES` declaration (mirrors P5's `SCHEME_KINDS` assertion):
    ```ts
    // Guards against a future status addition landing without a save-version
    // bump. WhisperStatusSchema = z.enum(WHISPER_STATUSES) serializes by
    // string value; cardinality is part of the hash projection via the
    // Whisper entity's status field. Symmetric to the SCHEME_KINDS assertion
    // at P5.
    if (WHISPER_STATUSES.length !== 4) {
      throw new Error(`WHISPER_STATUSES length changed (${WHISPER_STATUSES.length} !== 4) without save-version bump — bump SAVE_VERSION_CURRENT and add migration`);
    }
    ```
    Same assertion shape for `WEAPONIZATION_BRANCHES.length !== 3` and `STAFF_ASSIGNMENTS.length !== 5` and `COURIER_STATUSES.length !== 4` and `COURIER_PAYLOAD_TYPES.length !== 1` and `COURIER_DIRECTIONS.length !== 2`.
  - **`WHISPER_STATUSES`**, **`WEAPONIZATION_BRANCHES`**, **`STAFF_ASSIGNMENTS`**, **`COURIER_STATUSES`**, **`COURIER_PAYLOAD_TYPES`**, **`COURIER_DIRECTIONS`** — as const tuple literals, exported as types:
    ```ts
    export const WHISPER_STATUSES = ["Unverified", "Verified", "Weaponized", "Dismissed"] as const;
    export type WhisperStatus = (typeof WHISPER_STATUSES)[number];

    export const WEAPONIZATION_BRANCHES = ["Blackmail", "ScandalSheet", "AccidentalSlip"] as const;
    export type WeaponizationBranch = (typeof WEAPONIZATION_BRANCHES)[number];

    export const STAFF_ASSIGNMENTS = ["Snoop", "BribeDriver", "InterceptMail", "None", "BribedByRival"] as const;
    export type StaffAssignment = (typeof STAFF_ASSIGNMENTS)[number];

    export const COURIER_STATUSES = ["InFlight", "Delivered", "Intercepted", "Cancelled"] as const;
    export type CourierStatus = (typeof COURIER_STATUSES)[number];

    export const COURIER_PAYLOAD_TYPES = ["Whisper"] as const;  // "Letter" reserved for P11
    export type CourierPayloadType = (typeof COURIER_PAYLOAD_TYPES)[number];

    export const COURIER_DIRECTIONS = ["Inbound", "Outbound"] as const;
    export type CourierDirection = (typeof COURIER_DIRECTIONS)[number];
    ```

  - **Whisper verification tuning:**
    - **`WHISPER_VERIFICATION_PER_TICK = 10`** — units of `verificationProgress` added per tick to each Unverified whisper that has already ARRIVED at the destination (i.e., `arrivedAtTick !== null`). At 10/tick, an arrived whisper verifies after 10 ticks. Designer-tunable; playtest may adjust.
    - **`WHISPER_VERIFICATION_THRESHOLD = 100`** — when `verificationProgress >= 100`, status flips to `"Verified"`. Spec §3 line 519 says "past 100"; we use `>=` for the conservative reading.

  - **Three weaponization branches:**
    - **Blackmail:**
      - **`BLACKMAIL_SCANDAL_COST = 10`** — applied to the OWNER house on weaponization (spec §3 line 461 "modest scandal cost"). Clamped `[0, 100]`.
      - **`BLACKMAIL_AFFECTION_BOOST = 20`** — at P6 with no rival hostility yet, the "compelled cooperative action" materializes as a `+20 affection` from the subject character to the player. P8 widens this to also flip rival hostility on subject-in-rival-house. Designer-tunable.
    - **Scandal Sheet:**
      - **`SCANDAL_SHEET_REPUTATION_DROP = 30`** — applied to the SUBJECT'S house (clamped `[0, 100]`).
      - **`SCANDAL_SHEET_ATTRIBUTION_PROBABILITY = 0.15`** — 15% per publication. On attribution, the player house's `exiled` flips true and the campaign enters terminal endgame. Designer-tunable.
    - **Accidental Slip:**
      - **`ACCIDENTAL_SLIP_DURATION_TICKS = 5`** — the slip is active for 5 conversation rounds with the subject character. Each conversation turn during the window applies a per-tick reputation drip.
      - **`ACCIDENTAL_SLIP_DRIP_PER_CONVERSATION = -2`** — reputation delta per conversation turn during the active window (applied to the subject's house, clamped `[0, 100]`).
      - Total Accidental Slip damage (if every drip fires): `5 × 2 = 10` reputation off. Same total damage class as Scandal Sheet at one-third the deflection (Slip is 33% of SS's damage but cannot trigger exile and requires 5 conversations to land).

  - **Staff espionage tuning:**
    - **`STAFF_UPKEEP_DEFAULT = 1`** — per-tick wealth cost for each baseline staff member (4 baseline × 1 = 4 wealth/tick). Designer-tunable.
    - **`STAFF_LOYALTY_DRIFT_UNDERPAID_PER_TICK = -1`** — applied to every staff member when the owning house's wealth was negative at the start of this tick. Tick-time check: `state.houses.get(houseId).wealth < 0` BEFORE the staff phase mutations.
    - **`STAFF_LOYALTY_DRIFT_GREEDY_UNDERPAID_PER_TICK = -2`** — applied to Greedy-trait staff when underpaid. Replaces (not stacks with) the base `-1` for greedy staff.
    - **`STAFF_BRIBERY_LOYALTY_THRESHOLD = 30`** — only staff with `loyalty < 30` are eligible for the per-tick bribery roll.
    - **`STAFF_BRIBERY_PROBABILITY_BASE = 0.05`** — 5% per tick for a Greedy underpaid staff member at sub-threshold loyalty.
    - **Cadences (ticks between outputs):**
      - **`STAFF_SNOOP_CADENCE_TICKS = 8`** — Snoop assignment produces 1 outbound whisper every 8 ticks (about a deterministically picked NPC at the high-society location). The whisper originates at the location of the Snoop (Capital, per spec — staff don't physically travel).
      - **`STAFF_BRIBE_DRIVER_CADENCE_TICKS = 12`** — BribeDriver produces 1 outbound whisper every 12 ticks (about a character whose recent travel matches; v1 picks the player's most-recent travel target's NPC pool).
      - **`STAFF_INTERCEPT_MAIL_CADENCE_TICKS = 10`** — InterceptMail drops 1 inbound courier payload every 10 ticks (the lex-smallest InFlight inbound courier targeting the player house at the time of the cadence-fire).
      - **`STAFF_BRIBED_BY_RIVAL_CADENCE_TICKS = 6`** — bribed staff produce 1 outbound whisper about the player every 6 ticks. At P6 with no rivals, the whisper's destination is `INDEPENDENT_HOUSE_ID` (placeholder); at P8 the routing extends to pick a real rival.

  - **All new constants are designer-tuned values per CLAUDE.md §10.** Inline comments cite spec section names (`§3 "Staff Espionage"`) per CLAUDE.md.

- **`src/game/fixtures/staff.ts`** — NEW fixture module. Baseline staff registry; single source of truth for both fresh-state and migration paths. Per CLAUDE.md "Identities live in `src/game/fixtures/`":
  ```ts
  // src/game/fixtures/staff.ts
  import type { StaffMember } from "../entities";
  import { PLAYER_HOUSE_ID, type StaffId } from "../rng";
  import { STAFF_UPKEEP_DEFAULT } from "../constants";

  export type BaselineStaffSeed = {
    id: StaffId;
    name: string;
    isGreedy: boolean;
    startingLoyalty: number;
  };

  export const BASELINE_STAFF: ReadonlyArray<BaselineStaffSeed> = [
    { id: "staff-mrs-hudson" as StaffId, name: "Mrs. Hudson (housekeeper)", isGreedy: false, startingLoyalty: 80 },
    { id: "staff-thompson" as StaffId, name: "Thompson (valet)", isGreedy: true, startingLoyalty: 60 },
    { id: "staff-greer" as StaffId, name: "Greer (carriage driver)", isGreedy: false, startingLoyalty: 70 },
    { id: "staff-pell" as StaffId, name: "Pell (lady's maid)", isGreedy: true, startingLoyalty: 55 },
  ];

  export function buildBaselineStaffMember(seed: BaselineStaffSeed): StaffMember {
    return {
      id: seed.id,
      houseId: PLAYER_HOUSE_ID,
      name: seed.name,
      isGreedy: seed.isGreedy,
      loyalty: seed.startingLoyalty,
      upkeepPerTick: STAFF_UPKEEP_DEFAULT,
      assignment: "None",   // player must explicitly assign
      lastOutputTick: null, // never produced; first cadence fires at currentTick + cadence
      bribedAtTick: null,
    };
  }

  // Single source of truth — called by BOTH seedStartingFamily (fresh state)
  // AND seedWhispersCouriersStaffIntoLegacyState (migration/lifter). Mirrors
  // the BASELINE_NPCS pattern at fixtures/npcs.ts.
  export function buildBaselineStaffMap(): Map<StaffId, StaffMember> {
    const m = new Map<StaffId, StaffMember>();
    for (const seed of BASELINE_STAFF) {
      m.set(seed.id, buildBaselineStaffMember(seed));
    }
    return m;
  }
  ```
  **Why 4 baseline staff:** the historical Regency household is canonically a housekeeper + valet + driver + lady's maid (matches the four-staff Bridgerton archetype). 2 of 4 are Greedy by default, biasing playtest toward visible bribery pressure rather than a flat-rate happy path. **Why the Greedy/loyal split is 2/2:** at-start a player with no upkeep paid will see 2 staff drift toward bribery faster than 2; this is the v1 "espionage pressure" tutorial. Future fixtures (P15 dynasty perk-modified staff, P16 procedural staff names) can extend.

  **Bootstrap integration (resolves B2 from C7 — LITERAL PATCHES).** `src/game/bootstrap.ts:seedStartingFamily` returns a new `staff: ReadonlyArray<StaffMember>` field on its result alongside `houses` and `characters`. `createInitialState` in `src/game/store.ts` consumes it via a parallel for-loop matching the existing `houses`/`characters` pattern.

  **Literal patch at `src/game/bootstrap.ts:27-31` (verified BEFORE state):**
  ```ts
  // src/game/bootstrap.ts:27-31 BEFORE (P4 state, verbatim):
  export function seedStartingFamily(rngState: RngState): {
    rngState: RngState;
    houses: ReadonlyArray<House>;
    characters: ReadonlyArray<Character>;
  } { /* ... */ }

  // src/game/bootstrap.ts AFTER (P6 — add staff field to return type AND return value):
  import { BASELINE_STAFF, buildBaselineStaffMember } from "./fixtures/staff";   // NEW at P6
  import type { StaffMember } from "./entities";                                  // NEW at P6
  // ... rest of existing imports unchanged ...

  export function seedStartingFamily(rngState: RngState): {
    rngState: RngState;
    houses: ReadonlyArray<House>;
    characters: ReadonlyArray<Character>;
    staff: ReadonlyArray<StaffMember>;        // NEW at P6
  } {
    // ... existing body unchanged through the playerCharacter/playerHouse construction ...
    // ... existing NPC construction unchanged ...
    // P6 ADDITION at end of function — build staff array from BASELINE_STAFF:
    const staff = BASELINE_STAFF.map(buildBaselineStaffMember);
    return {
      rngState: postDeathRoll,
      houses: [playerHouse, independentHouse],
      characters: [playerCharacter, ...npcs],
      staff,    // NEW at P6
    };
  }
  ```
  **Why a new return field (not a fourth array merged into characters):** staff are NOT first-class Characters at v1 (see earlier "Why staff are NOT in `state.characters`" rationale); the return shape mirrors the staff's distinct entity-type lifecycle. **Draw discipline preserved:** `BASELINE_STAFF.map(buildBaselineStaffMember)` makes ZERO RNG draws (every field is a literal constant per the fixture); `rngState.callCount` is unchanged from P4. Vitest: `expect(seedStartingFamily(initialRng).rngState.callCount).toBe(1)` — only the player's deathAge roll consumes a draw. The same assertion locks the bootstrap-callcount-invariant per the [C2] suggestion at line 1573.

  **Literal patch at `src/game/store.ts:81-114` (`createInitialState`) — extend with the staff loop mirroring the existing `houses`/`characters` patterns:**
  ```ts
  // src/game/store.ts:96-98 BEFORE (P5 state, verbatim — the two existing per-entity-type loops):
  const houses = new Map<HouseId, House>();
  for (const h of seeded.houses) houses.set(h.id, h);
  const characters = new Map<CharacterId, Character>();
  for (const c of seeded.characters) characters.set(c.id, c);

  // src/game/store.ts:96-100 AFTER (P6 — add a THIRD parallel loop for staff):
  const houses = new Map<HouseId, House>();
  for (const h of seeded.houses) houses.set(h.id, h);
  const characters = new Map<CharacterId, Character>();
  for (const c of seeded.characters) characters.set(c.id, c);
  const staff = new Map<StaffId, StaffMember>();
  for (const s of seeded.staff) staff.set(s.id, s);    // NEW at P6
  ```
  And in the returned `GameState` object literal (around `store.ts:108-113`), add `staff,` alongside `houses`/`characters`/`marriages`:
  ```ts
  // src/game/store.ts:108-113 AFTER (P6 — add staff to the return-shape; also whispers and couriers):
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
    schemes: new Map<SchemeId, Scheme>(),
    whispers: new Map<WhisperId, Whisper>(),    // NEW at P6
    couriers: new Map<CourierPayloadId, CourierPayload>(),    // NEW at P6
    staff,    // NEW at P6 — populated above from seeded.staff
  };
  ```
  **`migrate_v1_to_v2.ts` also calls `seedStartingFamily`** (verified at `src/persist/migrations/v1-to-v2.ts:58-71`). The added `staff` field on the return is harmlessly absorbed — `migrate_v1_to_v2` extracts only `rngState` + `houses` + `characters` from the return; it doesn't need staff (V2 saves predate the staff field). Vitest assertion: `migrate_v1_to_v2`'s output passes `SaveV2Schema.parse` cleanly (Zod strips the unused `staff` field at parse time — no manual filter needed).

  The migration's `seedWhispersCouriersStaffIntoLegacyState` consumes the same `buildBaselineStaffMap()` so both fresh-state and migration paths produce byte-identical staff state. Vitest assertion in `bootstrap.test.ts`: `expect(hashState(createInitialState(seed))).toBe(hashState(fromSaveV7(toSaveV7(createInitialState(seed)))))` — round-trip identity preserved with staff present.

- **`src/game/fixtures/whisperIdFactory.ts`** — NEW fixture-adjacent helper. The whisper id generator. **Determinism contract:** whisper ids are deterministic identifiers derived from `(sourceCharacterId, subjectCharacterId, originatingTick, whisperIndexOnThisTickFromThisSource)`. Format: `` `${sourceCharacterId}:${subjectCharacterId}:${originatingTick}:${index}` `` cast to `WhisperId`. **Why deterministic, not UUID:** whispers participate in the hash projection; UUID-based ids would diverge across replay-harness 30-run stability NFR.
  ```ts
  // src/game/fixtures/whisperIdFactory.ts
  import type { GameState } from "../entities";
  import type { CharacterId, WhisperId } from "../rng";

  export function makeWhisperId(
    state: GameState,
    sourceCharacterId: CharacterId,
    subjectCharacterId: CharacterId,
  ): WhisperId {
    // Count existing whispers (any status — never deleted) matching
    // (source, subject, this-tick). Partitioned by (source, subject) so
    // two same-tick whispers from the same source about different subjects
    // get index 0 each, but two from the same source about the same subject
    // get 0 and 1.
    let index = 0;
    for (const w of state.whispers.values()) {
      if (w.sourceCharacterId === sourceCharacterId &&
          w.subjectCharacterId === subjectCharacterId &&
          w.originatingTick === state.tick) {
        index += 1;
      }
    }
    return `${sourceCharacterId}:${subjectCharacterId}:${state.tick}:${index}` as WhisperId;
  }
  ```
  **Why `(source, subject)` partition (not `(source)` alone)**: lets a single conversation generate (a) the synergy whisper (source = NPC, subject = ANY) AND (b) the wallflower-bonus whisper (source = NPC, subject = a different NPC picked deterministically) WITHOUT colliding index 0. The synergy whisper gets index 0 for `(npc, subject1)`; the wallflower-bonus whisper gets index 0 for `(npc, subject2)`. Two distinct ids.

  **Wallflower-bonus subject selection (deterministic — spec §3 line 304):** "targets a deterministically picked non-target NPC." V1 rule: lex-smallest CharacterId among living non-target NPCs in `state.characters` (excluding characters in PLAYER_HOUSE_ID — the bonus is third-party gossip). Resolved in `src/game/rules/whispers.ts:pickWallflowerBonusSubject(state, conversationTargetCharId)`. The pick is deterministic (no PRNG draw); replay-harness sees the same subject across runs. If no eligible non-target NPC exists (e.g., the target is the ONLY non-player NPC), the bonus fires as a no-op (no whisper generated).

  **Wallflower-bonus composition with synergy whisper (resolves B3 — load-bearing).** The bonus is **ADDITIVE alongside** the synergy whisper, NOT a substitute or wrapper. Trigger: `input.stance === "Wallflower" AND input.classifiedTactic === "SlyGossip" AND outcome.kind === "Normal" AND outcome.synergy === true`. When all four conditions hold, `sendBallroomMessage`'s post-resolve block runs (in order):
  1. `generateSynergyWhisper(state, target.id, target.id, state.tick)` — the standard synergy whisper, subject = the conversation target. Append to `state.whispers`; emit a courier via `generateWhisperCourier`.
  2. `const bonusSubject = pickWallflowerBonusSubject(state, target.id)`. If non-null:
     - `generateSynergyWhisper(state, target.id, bonusSubject.id, state.tick)` — the wallflower-bonus whisper, source = same NPC, subject = the lex-smallest non-target NPC. The `makeWhisperId` factory's `(source, subject)` partition (see "Why (source, subject) partition" above) guarantees the two whispers get DISTINCT ids (the synergy whisper gets index 0 for `(npc, target)`; the bonus whisper gets index 0 for `(npc, bonusSubject)`).
     - Append + courier emit (same shape as step 1).

  **Per-conversation whisper count matrix:**
  | Stance / synergy / SlyGossip | LLM `generateWhisper` toolCall present | Whispers emitted (max) |
  |---|---|---|
  | Synergy=false | none | 0 |
  | Synergy=false | 1 | 1 (LLM-additive only) |
  | Synergy=true, NOT (Wallflower+SlyGossip) | none | 1 (synergy) |
  | Synergy=true, NOT (Wallflower+SlyGossip) | 1 | 2 (synergy + LLM-additive) |
  | Synergy=true AND Wallflower+SlyGossip | none | 2 (synergy + wallflower-bonus) |
  | Synergy=true AND Wallflower+SlyGossip | 1 | 3 (synergy + wallflower-bonus + LLM-additive) |

  **`sendBallroomMessage` whisper-creation Immer-producer extension (resolves B2 from C7 iter 2 — LOAD-BEARING LITERAL PATCH).** The slip-drip block is inlined as Immer-draft mutations inside the existing set body; the whisper-creation site follows the same pattern. **CRITICAL discipline: the whisper-creation block runs BEFORE the slip-drip block** (a same-tick weaponized AccidentalSlip whisper about the conversation subject would otherwise drip on the JUST-CREATED synergy whisper if order were reversed — semantically inconsistent). Literal placement INSIDE the existing `set((state) => {...})` body, AFTER the combat-outcome mutations + faux-pas grievance append (around `store.ts:550`) AND BEFORE the slip-drip block:
  ```ts
  // P6 ADDITION inside the existing sendBallroomMessage set body, AFTER the
  // P5 grievance-push block and BEFORE the AccidentalSlip drip block.
  // Whisper creation has up to 3 paths per the count matrix above. All three
  // paths use direct Immer-draft mutation (parallel to the grievance push).
  //
  // The `outcome.synergy` field is `true` only for the Normal combat-outcome
  // variant (resolveCombat returns InstantFail/ZeroYield with synergy: false).

  // (1) Synergy whisper — fires when outcome.kind === "Normal" AND outcome.synergy === true.
  if (outcome.kind === "Normal" && outcome.synergy) {
    // Subject = the conversation target (not a third party for the standard
    // synergy whisper). Source = the conversation target as well (the synergy
    // arose from the NPC's own behavior).
    const w = generateSynergyWhisper(state, target.id, target.id, state.tick);
    state.whispers.set(w.id, w);
    const c = generateWhisperCourier(state, w, "Capital" as LocationId, PLAYER_HOUSE_ID);
    state.couriers.set(c.id, c);

    // (2) Wallflower-bonus whisper — fires ONLY when stance === Wallflower AND
    // tactic === SlyGossip AND synergy === true (per spec §3 line 304 + matrix).
    if (input.stance === "Wallflower" && response.classifiedTactic === "SlyGossip") {
      const bonusSubject = pickWallflowerBonusSubject(state, target.id);
      if (bonusSubject !== null) {
        // Subject = lex-smallest non-target living NPC; partition by (source, subject)
        // in makeWhisperId guarantees the bonus whisper gets a distinct id from
        // the synergy whisper above.
        const wb = generateSynergyWhisper(state, target.id, bonusSubject.id, state.tick);
        state.whispers.set(wb.id, wb);
        const cb = generateWhisperCourier(state, wb, "Capital" as LocationId, PLAYER_HOUSE_ID);
        state.couriers.set(cb.id, cb);
      }
    }
  }

  // (3) LLM-additive whisper — fires when response.toolCalls contains a
  // generateWhisper entry that survives the three-predicate validation
  // (exists + not-target + not-player-house). Synergy not required;
  // LLM-additive can fire on a non-synergy turn.
  for (const tc of response.toolCalls) {
    if (tc.name !== "generateWhisper") continue;
    const subjectId = tc.args.subjectCharacterId as CharacterId;
    const subject = state.characters.get(subjectId);
    if (subject === undefined) continue;                            // predicate 1: exists
    if (subjectId === target.id) continue;                          // predicate 2: not the target
    if (subject.houseId === PLAYER_HOUSE_ID) continue;              // predicate 3: not player-house
    const wL = ingestLlmAdditiveWhisper(state, target.id, subjectId, tc.args.text);
    state.whispers.set(wL.id, wL);
    const cL = generateWhisperCourier(state, wL, "Capital" as LocationId, PLAYER_HOUSE_ID);
    state.couriers.set(cL.id, cL);
  }
  ```
  **Why the rule functions take `state` (the Immer DRAFT) directly:** Immer drafts are accessed as if they were the source-of-truth state; reads via `state.whispers.values()` (used by `makeWhisperId`'s index walk inside `generateSynergyWhisper`) work correctly against the draft. The mutations `state.whispers.set(w.id, w)` write back to the draft, so the NEXT call's `makeWhisperId(state, ...)` sees the whisper just created — index counts increment correctly within the producer body. **This is the per-iteration accumulator-write-back pattern from `applyStaffOutputsPhase` adapted for the Immer-producer context.** The slip-drip block at line 600+ executes AFTER these whisper-create mutations, so its drip targets the just-arrived state including newly-created whispers (though no new whisper has `status === "Weaponized" AND weaponizedAs === "AccidentalSlip"` at creation, so they're skipped by the drip filter — correct semantics).

  **Vitest coverage (extends "Whisper rules" target):** explicit test for "Wallflower + SlyGossip + synergy hit emits two whispers with distinct ids and distinct subjects"; test for "Wallflower + SlyGossip + synergy hit + no eligible bonus subject (single-NPC scene) emits only the synergy whisper".

- **`src/game/fixtures/courierPayloadIdFactory.ts`** and **`src/game/fixtures/staffIdFactory.ts`** — courier IDs use `` `courier:${originHouseId}:${tick}:${index}` `` (counting existing couriers at this tick from this origin); staff ids are CONSTANTS in `fixtures/staff.ts:BASELINE_STAFF` (no factory — staff are seeded as a fixed set; future "hire new staff" actions in P15 would introduce a factory then). At P6, no new staff are created during gameplay — staff are seeded at fresh-state and persist for the campaign's lifetime. **`StaffMember.id` factory rejection:** spec doesn't enumerate a hire-staff affordance for v1; P6 confirms no runtime path creates new staff. A future phase that does (P15's dynasty perk pool, possibly P16's procedural identity layer) MUST bump the save version AND introduce a `makeStaffId(state)` helper.

- **Pure rule `src/game/rules/whispers.ts`** — the whisper resolver module. Owns whisper generation (synergy, wallflower-bonus, LLM-additive ingestion), verification cadence (per-tick increment), and weaponization rules (Blackmail / Scandal Sheet / Accidental Slip). **File-header imports:**
  ```ts
  // src/game/rules/whispers.ts
  import { clamp } from "../util/clamp";
  import { getHouseOrThrow, getCharacterOrThrow } from "../util/lookups";
  import { drawNext, getOrThrow } from "../rng";
  import { makeWhisperId } from "../fixtures/whisperIdFactory";
  import {
    BLACKMAIL_AFFECTION_BOOST, BLACKMAIL_SCANDAL_COST,
    SCANDAL_SHEET_ATTRIBUTION_PROBABILITY, SCANDAL_SHEET_REPUTATION_DROP,
    ACCIDENTAL_SLIP_DURATION_TICKS, ACCIDENTAL_SLIP_DRIP_PER_CONVERSATION,
    WHISPER_VERIFICATION_PER_TICK, WHISPER_VERIFICATION_THRESHOLD,
    type WeaponizationBranch, type WhisperStatus,
  } from "../constants";
  import { makePairKey } from "../conversation/types";
  // ... entity/brand imports ...
  ```

  **Exports:**

  - **`generateSynergyWhisper(state, sourceCharacterId, subjectCharacterId, conversationTick)`** — pure function. Called from `sendBallroomMessage`'s post-resolve block when `outcome.synergy === true`. Returns a new `Whisper` entity with `status: "Unverified"`, `verificationProgress: 0`, `arrivedAtTick: null`. The whisper's text body is a templated stub at v1: `"Whisper about ${subjectName} from ${sourceName}"`. **Why a function (not just inline in sendBallroomMessage):** keeps the rule layer pure and testable in isolation; the store action just appends the returned whisper to `state.whispers` AND creates the courier payload that carries it (via `generateWhisperCourier` below). Vitest covers the whisper-shape contract directly.

  - **`generateWhisperCourier(state, whisper, originLocation, destinationHouseId)`** — pure function. Creates the in-flight `CourierPayload` carrying the whisper from origin to destination. Computes `arrivalTick = state.tick + transitTicks(originLocation, destinationLocation)` per spec §4 line 545. Returns the new `CourierPayload`. **Destination location resolution:** the destination location is the `currentLocation` of the destination house (read from `state.houses.get(destinationHouseId).currentLocation`). For Inbound couriers (most cases at v1) the destination house is `PLAYER_HOUSE_ID` and its current location is wherever the player is — usually `"Capital"`. **CRITICAL contract:** `arrivalTick` is computed against the location of destination AT START TIME of the courier. If the destination house moves between courier start and arrival, the arrival STILL fires at the originally-computed `arrivalTick` — the courier doesn't chase the player. (P14 ledger may surface "delivered to Capital but you're now at Country" — UI concern, not a rule-layer issue.) This matches the broader CLAUDE.md non-negotiable #2 "every scheduled event stores an absolute end-tick".

  - **`ingestLlmAdditiveWhisper(state, sourceCharacterId, subjectCharacterId, text)`** — pure function. Called from the post-resolve block in `sendBallroomMessage` when `response.toolCalls` contains a `generateWhisper` entry. Mirrors `generateSynergyWhisper` shape but sets `llmGenerated: true` AND uses the LLM-provided text body instead of the templated stub. **Why a separate function (not a flag on `generateSynergyWhisper`):** clarifies the intent at the call site and lets the two paths evolve independently (e.g., a future "validate LLM whisper text doesn't leak credentials" check belongs only in the ingest path). The LLM-additive whisper also gets a courier payload via `generateWhisperCourier`. **Whisper-text trust boundary:** spec §6 line 631 forbids credential leakage in logs; the same discipline applies to whisper bodies. The orchestrator MUST NOT pass the API key into the LLM prompt as a substring (the BYOK convention already enforces this). However, the `text` returned by `generateWhisper` is unsanitized model output — at v1 the rule layer treats it as an opaque string, stores it verbatim, and the UI renders it as text-content (no HTML). A future polish phase may add length capping; v1 trusts the LLM's `respond` tool's bounded output (capped at `LLM_OUTPUT_TOKEN_BUDGET`).

  - **`applyWhisperVerificationPhase(state)`** — pure function. Walks `state.whispers` in lex-sort SchemeId order... wait, WhisperId order. For each whisper with `status === "Unverified" AND arrivedAtTick !== null`, increments `verificationProgress` by `WHISPER_VERIFICATION_PER_TICK`. If new progress `>= WHISPER_VERIFICATION_THRESHOLD`, flips `status: "Verified"`. NO PRNG draws — verification is purely deterministic. Returns new state via shallow Map clone of `state.whispers` per CLAUDE.md pure-rule structural-sharing contract.

  - **`applyCourierDrainStep(state)`** — pure function. Walks `state.couriers` in lex-sort CourierPayloadId order. For each courier with `status === "InFlight" AND arrivalTick === state.tick`, flips status to `"Delivered"`, sets `resolvedAtTick: state.tick`, AND mutates the carried `Whisper`'s `arrivedAtTick: state.tick`. NO PRNG draws. Returns new state via two shallow Map clones (`state.couriers` + `state.whispers`).

    **Edge case — source character died between courier start and arrival:** the courier still delivers; the whisper still arrives; the source character on the whisper points to a now-dead character. UI surfaces "from the late <name>". Per CLAUDE.md "characters never deleted; status flips only", the dead character is still in `state.characters` for lookup. The whisper is NOT cancelled — the gossip survives its source's death (matches Regency-flavor: a duel doesn't unspeak the rumor).

    **Edge case — destination house's currentLocation changed:** the courier arrives at the originally-computed `arrivalTick` based on the destination's location AT COURIER START. The destination check just uses the destinationHouseId — there's no geographic check at delivery. Whisper enters the destination house's whisper ledger regardless of where the destination house's head is currently standing.

  - **`tryWeaponizeWhisper(state, ownerHouseId, whisperId, branch)`** — pure validator + state-mutator. Player-initiated weaponization. **Signature pin (resolves B1 from C6 — LOAD-BEARING):** `ownerHouseId: HouseId` is the SECOND positional param, mirroring P5's `tryStartScheme(state, ownerHouseId, input)` precedent at `src/game/rules/schemes.ts:165-169`. The owner is the house whose whisper is being weaponized (always `PLAYER_HOUSE_ID` at v1 — only the player can weaponize whispers in their own ledger; P8 may extend if rivals can weaponize whispers in their own ledgers, but the v1 invariant is single-owner). The store-action wrapper passes `PLAYER_HOUSE_ID` explicitly from `src/game/rng.ts`; the rule layer NEVER hardcodes `PLAYER_HOUSE_ID` itself (game-rules → game-rng is the canonical import direction; the constant is exported from `rng.ts:26` and imported into the rule's caller, not the rule). The body references `owner = getHouseOrThrow(state, ownerHouseId)` and `ownerRng = getOrThrow(state.rng, ownerHouseId)` — both reads use the param, not a hardcoded constant. **Why not derive owner from whisper.destinationHouseId:** the destination is the house that RECEIVED the whisper, but at P8 a whisper might travel between rival houses and be weaponized at the destination — `(destinationHouseId)` IS the owner in that case but the destination semantics conflate "lives in my ledger" with "I weaponize" only at v1; cleanest to take owner explicitly. **Atomic gating (CLAUDE.md non-negotiable §5):**
    1. **Validate** (first-fail-wins, same ordering rationale as P5's tryStartScheme):
       - `WhisperNotFound`: id not in `state.whispers`.
       - `WhisperNotVerified`: status !== `"Verified"`. (Can't weaponize Unverified, already-Weaponized, or Dismissed.)
       - `BlackmailInsufficientScandalCapacity`: `branch === "Blackmail" AND owner.scandal + BLACKMAIL_SCANDAL_COST > 100`. Scandal is clamped `[0, 100]`; if the cost would overflow, surface a typed rejection rather than clipping silently (matches the spec §3 line 461 "spends a modest scandal cost" — if the player can't afford the scandal, the action is rejected).
       - `SubjectIsDead`: subject character is `alive === false`. (Weaponizing whispers about corpses is semantically dead — the spec doesn't address it explicitly, but a Blackmail against a dead person is meaningless. Surface as a typed rejection.)
       - `SubjectIsSelf`: subject character's `houseId === PLAYER_HOUSE_ID`. Player can't weaponize whispers about anyone in their own house — leak-against-self is self-harm. **PINNED predicate (resolves B4):** the validator uses the house-membership predicate (`state.characters.get(subjectId).houseId === ownerHouseId`), NOT the literal-subject-equals-target predicate. The literal-subject-equals-target check is a SEPARATE concern owned by `ingestLlmAdditiveWhisper`'s filter (next bullet), and the two are NOT redundant — see alignment table below.
       - **Note:** for ScandalSheet + AccidentalSlip, no additional resource check beyond `WhisperNotVerified` — neither branch has an upfront wealth/scandal cost (their cost is the consumed whisper + the attribution risk for SS).
    2. **Branch-specific effect application + status flip atomic:**
       - **Blackmail:** owner.scandal `+= BLACKMAIL_SCANDAL_COST` (clamped); affectionMap for `makePairKey(playerHouseId, subjectCharacterId)` `+= BLACKMAIL_AFFECTION_BOOST` (clamped `[0, 100]`); whisper.status flips `Weaponized`, weaponizedAs `"Blackmail"`, weaponizedAtTick `state.tick`.
       <br>**Semantic pin for the affectionMap delta direction (resolves B1 from C4 iter 5 — load-bearing).** The pair key `(playerHouseId, subjectCharacterId)` is the P4 player-house-perspective directional key — verified at `entities.ts:148-149` and the P4 plan's "Why a top-level `affectionMap` (not `Character.affectionTo`)" rationale. The value at that key represents the PLAYER's mechanical-advantage-in-conversations-with-subject (player→subject reading). At v1 with no rival hostility surface yet (ships at P8), Blackmail's spec semantic of "compelled cooperative action; the target's faction-tension or hostility flips to satisfy the player's request" maps to: the player gains +20 mechanical advantage over the subject in subsequent conversations. The advantage encodes that the subject knows they're being held over a barrel and behaves more accommodatingly — which is observable as +20 affectionMap on the existing player-perspective key. The semantic IS a stretch from the spec wording (spec uses "hostility flip", which is rival-house-specific and ships at P8), but the existing affection map IS the only v1 surface that carries "subject is more cooperative with player". **Pair-key creation contract:** the affection-Map at `(playerHouseId, subjectCharacterId)` may not exist pre-Blackmail (the player has never conversed with the subject directly). The mutation `current = affectionMap.get(key) ?? 0; affectionMap.set(key, clamp(current + 20, 0, 100))` creates the entry on demand — default-zero is the no-prior-conversation case. **P8 extension reservation:** when rival houses ship, Blackmail extends to ALSO flip the subject's rival-house's hostility toward the player by -X — that's the proper "hostility flip" mechanic. P6 ships only the affection delta; P8 adds the hostility delta as a backward-compat additive change (no save-version bump because the affectionMap delta semantic is preserved).
       - **Scandal Sheet:** subjectHouse.reputation `-= SCANDAL_SHEET_REPUTATION_DROP` (clamped); draw 1 from owner's RNG for attribution roll; if `next < SCANDAL_SHEET_ATTRIBUTION_PROBABILITY`, owner.exiled = true AND whisper.scandalSheetAttribution = true; else whisper.scandalSheetAttribution = false; whisper.status flips `Weaponized`, weaponizedAs `"ScandalSheet"`. **Draw budget: 1 from owner's RNG.** Same Map-clone + set discipline as P5's Seduction discovery roll.
       - **Accidental Slip:** whisper.accidentalSlipDripsRemaining `= ACCIDENTAL_SLIP_DURATION_TICKS`; whisper.status flips `Weaponized`, weaponizedAs `"AccidentalSlip"`. The actual drip-feed fires on subsequent conversation turns with the subject — see `applyAccidentalSlipDripOnConversation` below.
    3. Return shape (success carries new GameState mirroring P5):
       ```ts
       type WeaponizeWhisperResult =
         | { ok: true; state: GameState }
         | { ok: false; reason: WeaponizeWhisperRejection };
       type WeaponizeWhisperRejection =
         | { kind: "WhisperNotFound"; whisperId: WhisperId }
         | { kind: "WhisperNotVerified"; whisperId: WhisperId; currentStatus: WhisperStatus }
         | { kind: "BlackmailInsufficientScandalCapacity"; have: number; cap: 100; need: number }
         | { kind: "SubjectIsDead"; subjectId: CharacterId }
         | { kind: "SubjectIsSelf"; subjectId: CharacterId }
         | { kind: "PlayerExiled" };  // P6 exile-gate variant (resolves R5 from C9)
       ```

    **PRNG draw budget summary for `tryWeaponizeWhisper`:** Blackmail = 0 draws; ScandalSheet = 1 draw (attribution); AccidentalSlip = 0 draws (drips fire on conversation turns, not on weaponization). Future Blackmail-with-randomized-flip-strength would bump the draw count and require a save-version bump.

  - **`dismissWhisper(state, whisperId)`** — pure mutator. Player-initiated dismissal of a Verified whisper. Status flips `Dismissed`. **Why an explicit affordance:** the UI shows Verified whispers in the player's ledger; the player should be able to discard one rather than leaving it to clutter the ledger forever. No effect on game state beyond status flip. Returns `{ ok: true; state }` or `{ ok: false; reason: DismissWhisperRejection }`.

    **Canonical `DismissWhisperRejection` enumeration (resolves B2 from C6 — LOAD-BEARING):**
    ```ts
    export type DismissWhisperResult =
      | { ok: true; state: GameState }
      | { ok: false; reason: DismissWhisperRejection };
    export type DismissWhisperRejection =
      | { kind: "WhisperNotFound"; whisperId: WhisperId }
      | { kind: "WhisperAlreadyTerminal"; whisperId: WhisperId; currentStatus: WhisperStatus }  // status is Weaponized | Dismissed
      | { kind: "PlayerExiled" };  // P6 exile-gate variant (resolves R5 from C9)
    ```
    `WhisperAlreadyTerminal` fires when the player tries to dismiss a whisper already in `Weaponized` or `Dismissed` state — surfaces as player-readable "this whisper has already been resolved". (Dismissing a Verified or Unverified whisper IS valid — the rule allows dismissal at any non-terminal status.)

  - **`applyAccidentalSlipDripOnConversation(state, conversationTargetCharId)`** — pure function. Returns new state via Map clones. Walks `state.whispers` for active Accidental Slips (`status === "Weaponized" AND weaponizedAs === "AccidentalSlip" AND accidentalSlipDripsRemaining > 0`) whose `subjectCharacterId === conversationTargetCharId`. For each, applies `ACCIDENTAL_SLIP_DRIP_PER_CONVERSATION` (-2) to the subject's house reputation (clamped `[0, 100]`) AND decrements `accidentalSlipDripsRemaining` by 1.

    **Integration into `sendBallroomMessage` set body (resolves B5 — PINNED).** The drip mutations are inlined INTO the existing Immer producer body that already runs combat-outcome mutations + faux-pas grievance append (verified at `store.ts:519-551`). Option (a) "extend the producer" was picked over (b) "compose pure rule before set body via overwriteFromGameState" because the existing set body ALREADY uses Immer-draft mutations for the parallel cross-house grievance append (`store.ts:546-549`); a single producer body keeps the entire post-resolve mutation atomic with the combat write. Option (c) "second set call" was rejected — it would break single-flight atomicity and create an observable mid-set window. Literal placement INSIDE the existing `set((state) => {...})` body, AFTER the affection/composure/conversation-history/grievance writes (around `store.ts:550`):

    ```ts
    // P6 ADDITION inside the existing sendBallroomMessage set body, AFTER the
    // existing P5 grievance-push block. Inlines the slip-drip pure-rule logic
    // via direct Immer mutations on the draft (parallel to the grievance push).
    // Walks state.whispers (Map<WhisperId, Whisper> in immer-draft form);
    // mutates state.houses + state.whispers entries in place.
    for (const [_id, w] of state.whispers) {
      if (w.status === "Weaponized" &&
          w.weaponizedAs === "AccidentalSlip" &&
          w.accidentalSlipDripsRemaining > 0 &&
          w.subjectCharacterId === target.id) {
        const subjectHouse = state.houses.get(target.houseId);
        if (subjectHouse !== undefined) {
          subjectHouse.reputation = clamp(
            subjectHouse.reputation + ACCIDENTAL_SLIP_DRIP_PER_CONVERSATION,
            0, 100,
          );
        }
        w.accidentalSlipDripsRemaining -= 1;
      }
    }
    ```

    **Why the pure rule function ALSO exists** (despite the inlined Immer block): testability. `applyAccidentalSlipDripOnConversation` is the unit-testable shape; the inlined Immer block in `sendBallroomMessage` is the production call site. Vitest invokes the pure function with hand-built fixtures; the Immer block is exercised by integration tests via `sendBallroomMessage` itself. The two MUST stay semantically identical — change one, change the other. Pin a Vitest assertion: `expect(applyAccidentalSlipDripOnConversation(stateBefore, target.id)).toEqual(simulatedPostSetState)` where `simulatedPostSetState` is the result of stepping the Immer block manually.

    **Event publication** for the drip: `publishWhisperTransitions` (called after `set` returns) WILL detect any whisper whose `accidentalSlipDripsRemaining` decreased AND the field is hash-relevant — but there is NO event variant for slip-drips at v1 (the UI re-renders the WhisperLedgerPanel reactively from Zustand). A future polish phase may add `AccidentalSlipDripped` events; v1 is silent.

  **Lex-sort iteration discipline** (CLAUDE.md "Lex-sort iteration over identifier Maps"): every rule above that walks `state.whispers` or `state.couriers` sorts by id first. `applyWhisperVerificationPhase` walks in lex `WhisperId` order; `applyCourierDrainStep` walks in lex `CourierPayloadId` order. No PRNG-consuming rule iterates without sorting.

- **Pure rule `src/game/rules/staff.ts`** — the staff resolver module. Owns loyalty drift, bribery rolls, and per-cadence output generation. Exports:

  - **`applyStaffOutputsPhase(state)`** — pure function. The "staff phase" sub-step inside `applyCourierAndStaffPhase`. Walks `state.staff` in lex-sort StaffId order. For each staff member:
    1. **Loyalty drift step.** If owning house `wealth < 0` at start-of-tick (read from `state.houses.get(staff.houseId).wealth`): if `staff.isGreedy`, apply `STAFF_LOYALTY_DRIFT_GREEDY_UNDERPAID_PER_TICK` (-2); else apply `STAFF_LOYALTY_DRIFT_UNDERPAID_PER_TICK` (-1). Clamp `[0, 100]`. **No drift when wealth >= 0** — solvent houses don't bleed staff loyalty.
    2. **Bribery roll step.** If `staff.isGreedy AND staff.assignment !== "BribedByRival" AND staff.loyalty < STAFF_BRIBERY_LOYALTY_THRESHOLD`: draw 1 from the OWNER's per-house RNG **and write the post-draw RNG state back into the in-progress staff-Map clone's parent state**. If `next < STAFF_BRIBERY_PROBABILITY_BASE`, flip `staff.assignment = "BribedByRival"`, `staff.bribedAtTick = state.tick`. **Only Greedy staff trigger this roll at v1:** non-Greedy underpaid staff still drift in loyalty but spec §3 line 204 explicitly ties bribery to the Greedy trait — "underpaying a Greedy-trait staff member raises a per-tick probability of rival bribery". Non-Greedy staff with loyalty < threshold do NOT roll; they remain loyal-but-unhappy. (V1 design choice; spec is silent on non-Greedy bribery — flagged `[Deliberate divergence]` so future-phase implementers don't "fix" it.)

       **Draw discipline + Map-state write-back (resolves B2 AND B3 — LOAD-BEARING).** Loyalty drift (step 1) is deterministic and draws ZERO PRNG. Bribery roll (step 2) draws 1 PRNG IFF Greedy AND loyalty < threshold AND assignment !== BribedByRival. **Each draw MUST write the post-draw `RngState` back AND each whisper-creating cadence output MUST be visible to the next iteration's `makeWhisperId` walk.** Without the rng write-back, every staff iteration draws the SAME `next` value (bribery probability semantics collapse). Without the whispers write-back, two same-tick staff cadence outputs both call `makeWhisperId(state, ...)` which walks the ORIGINAL `state.whispers` — both compute index=0 → identical WhisperId → `Map.set` collision losing one whisper. The accumulator must clone+write-back BOTH `acc.rng` AND `acc.whispers` (AND `acc.couriers`, since `generateWhisperCourier` creates a courier that the next iteration may need to count via `makeCourierPayloadId`). The same Map-clone-then-set pattern as P5's Seduction discovery roll (`src/game/rules/schemes.ts:resolveSeduction`):
       ```ts
       // Inside applyStaffOutputsPhase, the loop accumulator carries FOUR
       // Map clones forward: staff (mutated by drift/bribery), rng (per-draw
       // advance), whispers (per-cadence creation), couriers (per-cadence
       // carrier creation). All four must be re-cloned-and-set per iteration
       // OR makeWhisperId's index walk reads stale state. Literal shape:
       let acc = {
         ...state,
         staff: new Map(state.staff),
         rng: new Map(state.rng),
         whispers: new Map(state.whispers),    // P6: write-back required for makeWhisperId
         couriers: new Map(state.couriers),    // P6: write-back required for makeCourierPayloadId
       };
       for (const staffId of [...state.staff.keys()].sort()) {
         const s = acc.staff.get(staffId)!;
         // ── step 1 (loyalty drift; pure mutation of acc.staff) ──
         // ── step 2 (bribery roll) ──
         if (s.isGreedy && s.assignment !== "BribedByRival" && s.loyalty < STAFF_BRIBERY_LOYALTY_THRESHOLD) {
           const rngBefore = getOrThrow(acc.rng, s.houseId);    // <-- READ from accumulating rng
           const { next, rngState: rngAfter } = drawNext(rngBefore);
           acc = { ...acc, rng: new Map(acc.rng).set(s.houseId, rngAfter) };  // <-- WRITE post-draw
           if (next < STAFF_BRIBERY_PROBABILITY_BASE) {
             // P6 bribery write — MUST reset lastOutputTick to acc.tick alongside
             // bribedAtTick (resolves B3 from C7 — LOAD-BEARING). Without this
             // reset, a newly-bribed staff member whose prior lastOutputTick was
             // null hits the `?? -cadence` fallback in step 3's cadence check on
             // the SAME tick: state.tick - (null ?? -6) >= 6 → state.tick + 6 >= 6
             // → TRUE → BribedByRival cadence fires immediately on the bribery
             // tick (and every tick until cadence-elapses). Same foot-gun the
             // plan resolved for tryAssignStaff at line 632; bribery-roll path
             // gets the same fix.
             acc.staff.set(staffId, {
               ...s,
               assignment: "BribedByRival",
               bribedAtTick: acc.tick,
               lastOutputTick: acc.tick,     // <-- RESET cadence anchor; new assignment starts a fresh counter
             });
           }
         }
         // ── step 3 (cadence outputs) ──
         // Each per-assignment branch that creates whispers calls
         // makeWhisperId(acc, source, subject) — note `acc`, NOT `state` —
         // so the factory walks the loop-accumulated whispers Map. After
         // creating a whisper:
         //   const w = generateSynergyWhisper(acc, source, subject, acc.tick);
         //   const c = generateWhisperCourier(acc, w, origin, destHouseId);
         //   acc = {
         //     ...acc,
         //     whispers: new Map(acc.whispers).set(w.id, w),     // <-- visible to next iteration
         //     couriers: new Map(acc.couriers).set(c.id, c),     // <-- same
         //   };
         //   acc.staff.set(staffId, { ...s, lastOutputTick: acc.tick });
         // The next iteration's makeWhisperId sees w in acc.whispers → index=1
         // when source/subject collide with w's pair.
       }
       return acc;
       ```
       **Why both rng AND whispers/couriers write-back is required:** the per-iteration `makeWhisperId(acc, source, subject)` factory uses `acc.whispers.values()` to count existing whispers with matching `(source, subject, tick)` for the deterministic index. Without the per-iteration write-back, two staff producing same-tick outbound whispers about the SAME subject from the SAME source would both compute index=0 (since `state.whispers` is still empty) → identical WhisperId → `acc.whispers.set(w.id, w)` collision (the second write overwrites the first). The fix is mechanical: the accumulator pattern that already exists for `acc.rng` MUST be applied to `acc.whispers` and `acc.couriers` as well. Iteration sort by StaffId lex order keeps draw COUNT AND id-generation order deterministic across replays.
    3. **Cadence output step** (resolves B6) — runs only when `staff.assignment !== "None"` (the `"None"` assignment short-circuits step 3 entirely; ALL other assignments — `Snoop`, `BribeDriver`, `InterceptMail`, `BribedByRival` — fall through to the per-assignment switch below). Once gated in, check `state.tick - (staff.lastOutputTick ?? -cadence) >= cadence` per the assignment's cadence constant (each assignment has its own cadence — `STAFF_SNOOP_CADENCE_TICKS` for Snoop, etc.). If due:
       - **Snoop:** generate one outbound whisper. Subject = lex-smallest non-PLAYER CharacterId at the Capital location (i.e., NPCs from Independent house — at v1 the only non-PLAYER characters). Source = the staff member's owning house's head-of-house (proxy — staff don't appear in `state.characters`, so the whisper attributes to the head; spec is silent on this attribution and v1 uses head-of-house as the carrier). Routed to PLAYER_HOUSE_ID. **Courier originLocation = `"Capital" as LocationId` (constant, resolves B3 from C6 — LOAD-BEARING)** — per spec "staff don't physically travel"; Snoop staff are stationed at the player's London household (Capital) regardless of where the player head is currently traveling. Literal call site: `generateWhisperCourier(acc, w, "Capital" as LocationId, PLAYER_HOUSE_ID)`. The same constant applies to BribeDriver and BribedByRival cadence outputs (also Capital-stationed). **Why a constant, not `state.houses.get(PLAYER_HOUSE_ID).currentLocation`:** the player head's currentLocation can be ANY of the 7 locations as they travel; Snoop staff don't go with them. Using the player's currentLocation would shift transit costs every time the player travels — semantically wrong (a Capital-based snoop's whispers travel from Capital, not from wherever the player happens to be). At P15+ if a "traveling valet" staff member ships, that affordance would attach a `staff.location: LocationId` field; v1 doesn't ship one.
       - **BribeDriver:** generate one outbound whisper. **Subject selection PINNED (resolves B1 from C7 — LOAD-BEARING):** the lex-smallest CharacterId `c` matching `c.alive === true AND c.houseId !== PLAYER_HOUSE_ID`. (P6 has no location field on Character — the per-NPC location-derived "where did the driver overhear" detail is reserved for P11+ when NPCs track travel; at v1 BribeDriver picks the lex-smallest living non-player character as its subject, identical to Snoop's selection rule.) **Snoop vs BribeDriver subject-set divergence at v1:** both rules select from the same character pool (the 5 Independent NPCs); they differ only in CADENCE (Snoop fires every 8 ticks, BribeDriver every 12). The prior plan-draft attempted to specialize BribeDriver to "the player's most-recent travel target's NPC" but no `lastTravelTarget` field exists on House at v1, and the parenthetical fallback `state.houses.get(PLAYER_HOUSE_ID).currentLocation` returned a `LocationId`, not a `Character` — semantically incompatible. **At v1 the two assignments are functionally redundant on subject; only cadence differs.** Future phases that ship per-NPC location tracking (P11 sibling-rivals OR a future location-bound NPC pool) can specialize BribeDriver's subject selection then. Vitest: assign one staff to Snoop, another to BribeDriver, advance through both cadences; assert each produces a whisper about the lex-smallest non-player NPC at their respective cadence ticks. If no eligible subject (e.g., all non-player NPCs dead), the cadence fires as a NO-OP — `staff.lastOutputTick` STILL updates per the "cadence rate is independent of output success" rule. **Rationale for lastOutputTick mutation on no-op:** prevents the cadence from "catching up" on subsequent ticks (e.g., 12 ticks of no eligible subject → no flood of 12 whispers when one becomes available); matches a "punch the clock" semantic where cadence is wall-clock, not deliverable-counting.
       - **InterceptMail:** find the lex-smallest InFlight inbound courier targeting the player's house (`state.couriers.values().filter(c => c.status === "InFlight" AND c.direction === "Inbound" AND c.destinationHouseId === PLAYER_HOUSE_ID AND c.interceptable)`). If found, flip its status to `"Intercepted"`, set `resolvedAtTick: state.tick`. The CARRIED WHISPER's `arrivedAtTick` stays `null` — the whisper never reaches the player's ledger. The whisper itself stays in `state.whispers` with status `"Unverified"` (and will sit there inert forever — no surfacing path exists for an intercepted-mid-flight whisper). **Why the whisper isn't deleted:** "characters/houses/marriages/schemes never deleted; status flips only" — extends to whispers and couriers. The whisper's perpetual Unverified status with `arrivedAtTick === null` is the "intercepted" marker. If no eligible courier exists, the cadence fires as no-op.
       - **None:** no output; skip step 3 entirely (do NOT update `lastOutputTick` — None has no cadence to track).
       - **BribedByRival:** generate one inbound-relative-to-rival outbound whisper. Source = the staff member (proxied via the player's head-of-house). Subject = the player's head-of-house (the leak is about the player). Destination = `INDEPENDENT_HOUSE_ID` (placeholder at v1; P8 routes to a real rival via `pickRivalDestinationHouse(state)`). Courier originates at Capital. **The destination is hardcoded to Independent at P6** — verified inert because Independent has no whisper-consuming rule layer at v1. The whisper accumulates in Independent's ledger but does nothing. P8's rival action phase will start consuming Independent's (and rival houses') Verified whispers about the player for hostility/sabotage initiation.
    4. **Update `lastOutputTick = state.tick`** if step 3 produced an attempt (success OR no-op). Skip if assignment was `"None"`.

  - **`tryAssignStaff(state, staffId, newAssignment)`** — pure validator + mutator. Player action: reassign a staff member's job. **Validate:**
    - `StaffNotFound`: id not in `state.staff`.
    - `StaffBribedByRival`: current assignment is `"BribedByRival"` — bribed staff cannot be reassigned (only fired, which P6 doesn't ship). Surface as typed rejection.
    - `AssignmentInvalid`: caller tried to set assignment to `"BribedByRival"` directly — that's not a player-elected value; only the bribery roll path may set it.
    - **No cost** at v1 — reassignment is free. Future P15 dynasty perks may add a cost.

    Effect: flips `staff.assignment = newAssignment`, sets `lastOutputTick = state.tick` (resolves B2 from C4 iter 5 — load-bearing). Returns `{ ok: true; state }` or typed rejection per `AssignStaffRejection`:
    ```ts
    export type AssignStaffResult =
      | { ok: true; state: GameState }
      | { ok: false; reason: AssignStaffRejection };
    export type AssignStaffRejection =
      | { kind: "StaffNotFound"; staffId: StaffId }
      | { kind: "StaffBribedByRival"; staffId: StaffId }
      | { kind: "AssignmentInvalid"; rejectedAssignment: StaffAssignment }  // fires when caller passes "BribedByRival" — only the bribery roll path may set that
      | { kind: "PlayerExiled" };  // P6 exile-gate variant — see exile-gate section
    ```
    **`PlayerExiled` variant pinned here (resolves R5 from C9 — single source of truth):** earlier exile-gate prose said "WeaponizeWhisperRejection, DismissWhisperRejection, AssignStaffRejection, SpymasterInterceptRejection (NEW at P6) include PlayerExiled in their initial definition" — this declaration is the initial definition. The same variant is added to `WeaponizeWhisperRejection`, `DismissWhisperRejection`, and `SpymasterInterceptRejection` at their respective declarations (apply uniformly across all four NEW-at-P6 rejection unions).

    **Why `lastOutputTick = state.tick` and NOT `null`:** the cadence check at `applyStaffOutputsPhase` step 3 reads `state.tick - (staff.lastOutputTick ?? -cadence) >= cadence`. With `lastOutputTick: null`, the `?? -cadence` fallback substitutes a negative sentinel, making the expression evaluate `state.tick + cadence >= cadence` → ALWAYS TRUE at every tick (since `state.tick >= 0`). The newly-reassigned staff would fire output on tick T+1 instead of waiting a full cadence cycle (T + cadence). The earlier plan draft's "re-cadence from current tick — new assignment doesn't inherit the prior cadence's progress" prose was misleading — `null` doesn't reset to T, it resets to "before time itself". Setting `lastOutputTick = state.tick` is the correct semantic: the new assignment starts its cadence counter at NOW, fires its first output after `STAFF_<KIND>_CADENCE_TICKS` ticks elapse. **The `null` form is reserved for "never produced" — the initial-state value from `buildBaselineStaffMember` at fresh-state seed.** Once an assignment fires its first output OR is reassigned, the field is non-null. **Vitest assertion:** reassign a staff member to Snoop at tick=10; advance to tick=10 + STAFF_SNOOP_CADENCE_TICKS - 1 (= 17); assert NO cadence output. Advance one more tick (= 18); assert cadence fires. Without the `lastOutputTick = state.tick` fix, the assertion fails because the cadence fires at tick 11.

  - **`trySpymasterMailIntercept(state)`** — pure validator + mutator. Player action: the family-tab Spymaster intercept affordance. **Validate:**
    - `NoLivingSpymaster`: walk `state.characters.values()`; no character matches `c.houseId === PLAYER_HOUSE_ID AND c.alive === true AND c.archetype === "Spymaster"`. At P6 this ALWAYS fires (classifyArchetype stubbed at "None" until P7). The UI button is permanently disabled at P6 with tooltip "Requires a living Spymaster — available after P7".
    - **At P7+ semantics (load-bearing acknowledgement):** the action drops 1 in-flight inbound interceptable courier (lex-smallest CourierPayloadId), same effect shape as the InterceptMail staff cadence step but player-elected and one-shot (no cadence). Costs **`SPYMASTER_INTERCEPT_WEALTH_COST = 10`** (NEW constant at P6) per use. **P6 ships the rule layer's logic FULLY** — the gate function correctly drops a courier when a Spymaster exists — and tests it via synthetic Vitest fixtures that hand-construct characters with `archetype: "Spymaster"`. The live-UI dead-state at P6 is the expected behavior; P7 ships `classifyArchetype` and the button enables itself when classification produces real archetypes. **NO P6-only archetype override** in `bootstrap.ts` (would be fake-classification debt for P7 to undo).
    - Effect: deduct wealth, flip lex-smallest matching courier to `"Intercepted"`, set `resolvedAtTick`. Return `{ ok: true; state }`.

    Return shape:
    ```ts
    type SpymasterInterceptResult =
      | { ok: true; state: GameState }
      | { ok: false; reason: SpymasterInterceptRejection };
    type SpymasterInterceptRejection =
      | { kind: "NoLivingSpymaster" }
      | { kind: "InsufficientWealth"; have: number; need: number }
      | { kind: "NoEligibleCourier" }
      | { kind: "PlayerExiled" };  // P6 exile-gate variant (resolves R5 from C9)
    ```

- **Pure rule `src/game/rules/courier.ts` extension.** The existing `transitTicks(from, to)` stays as the symmetric-table lookup (verified at `courier.ts:22`). P6 adds:

  - **`applyCourierAndStaffPhase(state)`** — the orchestrator phase function. Replaces the P1 `identityPhase` at PHASES slot 4 ("courier draining"). Composes three sub-steps in fixed order:
    ```ts
    export function applyCourierAndStaffPhase(state: GameState): GameState {
      // (1) Verify progress on already-arrived Unverified whispers. NO PRNG.
      const afterVerify = applyWhisperVerificationPhase(state);
      // (2) Drain arrivals. NO PRNG. Couriers with arrivalTick === state.tick
      //     flip to Delivered; their whispers get arrivedAtTick = state.tick.
      const afterDrain = applyCourierDrainStep(afterVerify);
      // (3) Staff loyalty drift + bribery rolls + cadence outputs. PRNG only
      //     in the bribery roll (1 draw per Greedy underpaid sub-threshold staff).
      return applyStaffOutputsPhase(afterDrain);
    }
    ```
    **Inner sub-step ordering rationale (load-bearing):**
    - **Verify FIRST so the new payloads we drain THIS tick don't get verification credit on the tick they arrive.** A whisper arriving at tick=T gets `arrivedAtTick=T` via step 2; verification doesn't start until tick T+1's verify step. Without this ordering, an arriving whisper would gain `WHISPER_VERIFICATION_PER_TICK` units on its arrival tick — semantically wrong (verification is "time spent at the player's home" not "ticks since origination").
    - **Drain SECOND so newly-arrived whispers populate the ledger before staff might generate new ones.** Not strictly required for correctness (steps 2 and 3 mutate disjoint surfaces), but ordering by mechanism-lifecycle (existing-arrivals → new-outputs) reads cleanly.
    - **Staff THIRD so cadence outputs read the post-drain whispers Map.** Snoop's wallflower-bonus-like subject selection might one day filter by "no existing whisper about this NPC" — putting the drain BEFORE the staff step gives the staff a fresh-state view. At v1 the cadence outputs don't read whispers, so this is forward-compat.

    **No transition-array threading.** The phase returns only the new state; transitions are derived by the diff-publish helpers at the store-action level (mirrors P5's pattern).

- **`src/runtime/tickOrchestrator.ts` extended.** PHASES slot 4 changes from `identityPhase` to `applyCourierAndStaffPhase`:
  ```ts
  // src/runtime/tickOrchestrator.ts (P6 edit):
  import { applyCourierAndStaffPhase } from "../game/rules/courier";

  const PHASES: readonly TickPhase[] = [
    advanceTickPhase,            // 1. time advance
    applyEconomyPhase,           // 2. economy
    applyLocationEffectsPhase,   // 3. location effects (P3)
    applyCourierAndStaffPhase,   // 4. courier draining + verification + staff (P6 — NEW)
    applySchemeResolutionPhase,  // 5. scheme resolution (P5)
    identityPhase,               // 6. global-event roll (P1 stub)
    applyMoodDriftPhase,         // 7. mood drift
    identityPhase,               // 8. rival-house action roll (P1 stub — ALWAYS last)
  ] as const;
  ```
  **Boundary impact:** `runtime-tick-orchestrator` element's `default: "allow"` permits the import from `../game/rules/courier`. No `eslint.config.js` edit.

  **Test-side audit on PHASES[4] substitution (clarification — non-load-bearing).** The existing `src/runtime/tickOrchestrator.test.ts` test at lines 69-91 uses its own tracker-constructed phases array passed to `runOrchestratorWithPhases`, NOT the production `PHASES` constant. The other test at line 59 invokes `advanceTickPure` (which reads production `PHASES`) but asserts only that `rng.callCount` advanced — no slot-specific behavior pinned. **Therefore: replacing `identityPhase` at PHASES[4] with `applyCourierAndStaffPhase` does NOT break any existing test.** The plan still pins a sanity-check run-existing-tests-post-edit step as Verification — but no test-list audit is REQUIRED at the plan level because no test pins slot 4 to identity-noop semantics. Any future test that DOES want identity-at-slot-4 semantics should construct its own phases array via `createPhaseOrderTracker` (per the existing P3 precedent at `tickOrchestrator.test.ts:70-80`).

  **Phase ordering rationale (P6-specific):** P6's espionage phase fires at slot 4 (after location-effects, before scheme resolution). The reasoning:
  - **After location-effects** so courier arrivals see the post-location wealth/scandal updates. (Currently not load-bearing, but reserves the option for P10 location-bound whisper effects.)
  - **Before scheme resolution** so a whisper that arrives on tick T is verified-eligible BEFORE a Chaperone resolving on tick T could trigger a side-effect (none currently, but forward-compat). More importantly: a Snoop staff cadence output on tick T should be visible to a Sabotage scheme completing on tick T — the staff phase needs to run before the scheme phase to honor "staff outputs are espionage-tick mechanics, schemes are interpersonal-tick mechanics".
  - **Before mood-drift** so any whisper-driven mood changes (none at P6 but reserved for P11 inherited-secrets) land BEFORE the drift roll.
  - **Before rival-action** (which stays last per CLAUDE.md non-negotiable) so the rival house's per-tick reaction (P8) sees the staff outputs and whisper arrivals on this tick.

- **`src/game/hash.ts:hashableState` and `src/game/store.ts:selectGameState` extensions for the three new top-level Maps (resolves B2 — LOAD-BEARING).** The schema↔projection↔selector trip-wire at `src/game/schema-projection-selector-extension.test.ts` enforces top-level KEYSET equality across `GameStateSchema`, `hashableState`'s return shape, and `selectGameState`'s return shape. Adding `whispers`/`couriers`/`staff` to `GameStateSchema` (already pinned in the in-scope bullet above) WITHOUT mirror additions to the other two surfaces fails the trip-wire AT TEST-RUN TIME (which is the cheap fail mode); WITHOUT extending them at all, `save()` Zod-fails silently on every save attempt (which is the expensive fail mode). **Literal edits required at TWO sites:**

  ```ts
  // src/game/hash.ts:18-42 BEFORE (P5 state, verbatim):
  export function hashableState(state: GameState): {
    tick: number;
    rng: Array<[HouseId, RngState]>;
    houses: Array<[HouseId, House]>;
    characters: Array<[CharacterId, Character]>;
    marriages: Array<[MarriageId, MarriageRecord]>;
    campaignName: string;
    era: "Earlier" | "Later";
    conversationHistory: Array<[ConversationPairKey, Exchange[]]>;
    affectionMap: Array<[ConversationPairKey, number]>;
    schemes: Array<[SchemeId, Scheme]>;
  } {
    return {
      tick: state.tick,
      rng: serializeRegistry(state.rng),
      houses: serializeRegistry(state.houses),
      characters: serializeRegistry(state.characters),
      marriages: serializeRegistry(state.marriages),
      campaignName: state.campaignName,
      era: state.era,
      conversationHistory: serializeRegistry(state.conversationHistory),
      affectionMap: serializeRegistry(state.affectionMap),
      schemes: serializeRegistry(state.schemes),
    };
  }

  // src/game/hash.ts AFTER (P6 — six new lines, three in the return type and
  // three in the body):
  export function hashableState(state: GameState): {
    // ... existing fields unchanged ...
    schemes: Array<[SchemeId, Scheme]>;
    whispers: Array<[WhisperId, Whisper]>;             // NEW at P6
    couriers: Array<[CourierPayloadId, CourierPayload]>; // NEW at P6
    staff: Array<[StaffId, StaffMember]>;              // NEW at P6
  } {
    return {
      // ... existing fields unchanged ...
      schemes: serializeRegistry(state.schemes),
      whispers: serializeRegistry(state.whispers),     // NEW at P6
      couriers: serializeRegistry(state.couriers),     // NEW at P6
      staff: serializeRegistry(state.staff),           // NEW at P6
    };
  }
  ```

  ```ts
  // src/game/store.ts:650-668 BEFORE (selectGameState, P5 state, verbatim):
  export function selectGameState(state: StoreState): GameState {
    return {
      tick: state.tick,
      rng: state.rng,
      houses: state.houses,
      characters: state.characters,
      marriages: state.marriages,
      campaignName: state.campaignName,
      era: state.era,
      conversationHistory: state.conversationHistory,
      affectionMap: state.affectionMap,
      schemes: state.schemes,
    };
  }

  // src/game/store.ts AFTER (P6 — three new lines):
  export function selectGameState(state: StoreState): GameState {
    return {
      // ... existing fields unchanged ...
      schemes: state.schemes,
      whispers: state.whispers,    // NEW at P6
      couriers: state.couriers,    // NEW at P6
      staff: state.staff,          // NEW at P6
    };
  }
  ```

  **Import additions to `src/game/hash.ts`:** the existing imports at lines 3-4 carry `Character, GameState, House, MarriageRecord, Scheme` from `./entities` and `CharacterId, HouseId, MarriageId, RngState, SchemeId` from `./rng`. P6 extends BOTH:
  ```ts
  // src/game/hash.ts:3-4 AFTER (P6):
  import type { Character, CourierPayload, GameState, House, MarriageRecord, Scheme, StaffMember, Whisper } from "./entities";
  import type { CharacterId, CourierPayloadId, HouseId, MarriageId, RngState, SchemeId, StaffId, WhisperId } from "./rng";
  ```

  **Trip-wire scope reminder (apply on every save-version bump):** the four surfaces that must stay in keyset-sync are `GameStateSchema` (entities.ts), `hashableState` (hash.ts), `selectGameState` (store.ts), AND `overwriteFromGameState` (store.ts) — the FIRST three are caught by the existing schema-projection-selector trip-wire; the FOURTH (`overwriteFromGameState`) is NOT and must be audited manually per the previous bullet's literal edit.

- **`src/game/store.ts` import-block additions (resolves B3 — LOAD-BEARING).** P6's `sendBallroomMessage` extension (inlined AccidentalSlip drip block) AND the new player actions (`weaponizeWhisper`/`dismissWhisper`/`assignStaff`/`spymasterIntercept`) reference symbols that store.ts does NOT currently import. The plan body shows action bodies that USE these symbols but doesn't enumerate the import additions. Required edits to the `src/game/store.ts` import block (mirroring the existing P5 `publishSchemeTransitions, schemeBus` import at `store.ts:172`):
  ```ts
  // src/game/store.ts imports — ADD at P6:

  // From ./constants — needed for the inlined AccidentalSlip drip block + the
  // weaponize* action bodies. clamp/PLAYER_HOUSE_ID/CONVERSATION_HISTORY_LIMIT_PER_PAIR
  // are already imported per P4/P5. ADD:
  import {
    // ... existing constants imports ...
    ACCIDENTAL_SLIP_DRIP_PER_CONVERSATION,        // P6: drip applied inside sendBallroomMessage set body
    type WeaponizationBranch,                      // P6: weaponizeWhisper action input type
    type StaffAssignment,                          // P6: assignStaff action input type
  } from "./constants";

  // From ./rng — NEW brand types for P6. ADD to existing import block:
  import {
    // ... existing rng imports ...
    type WhisperId,                                // P6
    type CourierPayloadId,                         // P6
    type StaffId,                                  // P6
  } from "./rng";

  // From ./rules/whispers (NEW module at P6) — pure rules consumed by store actions:
  import {
    tryWeaponizeWhisper as tryWeaponizeWhisperPure,
    dismissWhisper as dismissWhisperPure,
    type WeaponizeWhisperRejection,
    type DismissWhisperRejection,
  } from "./rules/whispers";

  // From ./rules/staff (NEW module at P6) — pure rules for staff actions:
  import {
    tryAssignStaff as tryAssignStaffPure,
    trySpymasterMailIntercept as trySpymasterMailInterceptPure,
    type AssignStaffRejection,
    type SpymasterInterceptRejection,
  } from "./rules/staff";

  // From ../runtime/events/whispers (NEW module at P6) — diff helper + bus.
  // Mirror precedent: `import { publishSchemeTransitions, schemeBus } from "../runtime/events/scheme";`
  // currently at store.ts:172.
  import { publishWhisperTransitions, whisperBus } from "../runtime/events/whispers";
  ```
  **`clamp` lookup discipline reminder:** `store.ts` already imports `clamp` from `./util/clamp` (verified at `store.ts:56`), so the inlined slip-drip block's `clamp(subjectHouse.reputation + ACCIDENTAL_SLIP_DRIP_PER_CONVERSATION, 0, 100)` call uses the existing import — no additional edit needed for `clamp` itself. The literal slip-drip body's `clamp` reference is to THIS already-imported helper, not a per-rule local duplicate (which would violate CLAUDE.md "Auxiliary helpers referenced without home pin").

  **Why this is a LOAD-BEARING enumeration**: the cross-plan pattern is that import-block additions for new symbols are easy to forget when the symbol's USAGE site is more visually prominent than the import block. The plan's pattern from P4/P5 is to enumerate every import edit explicitly; P6 follows.

- **`src/game/store.ts:overwriteFromGameState` extended for the three new top-level Maps (resolves prior B1 — LOAD-BEARING).** The schema↔projection↔selector trip-wire at `schema-projection-selector-extension.test.ts` only enforces top-level KEYSET equality across the three surfaces; it does NOT enforce that `overwriteFromGameState` writes the new fields into the Immer draft. CLAUDE.md's P3 schema-projection-selector triple-sync section explicitly documents this trap: "Forgetting `selectGameState` breaks `save()` silently — Zod parse fails at write time, not at field-add time." The SAME silent-failure applies to `overwriteFromGameState`: without the draft writes, every tick-advancing action (advanceTick / travel / requestAudience / escapeBankruptcy / refreshWardrobe / runYearPass) silently CLEARS the new Maps because Zustand's Immer middleware preserves whatever the producer body left unchanged in the draft — and `overwriteFromGameState` overwrites the rest. **Literal edit at `src/game/store.ts:181-201`:**
  ```ts
  // BEFORE (store.ts:181-201, verbatim — P5 state):
  function overwriteFromGameState(draft: GameState, next: GameState): void {
    draft.tick = next.tick;
    draft.rng = next.rng;
    draft.houses = next.houses;
    draft.characters = next.characters;
    draft.marriages = next.marriages;
    draft.campaignName = next.campaignName;
    draft.era = next.era;
    draft.conversationHistory = next.conversationHistory;
    draft.affectionMap = next.affectionMap;
    draft.schemes = next.schemes;
  }

  // AFTER (P6 — three new lines):
  function overwriteFromGameState(draft: GameState, next: GameState): void {
    draft.tick = next.tick;
    draft.rng = next.rng;
    draft.houses = next.houses;
    draft.characters = next.characters;
    draft.marriages = next.marriages;
    draft.campaignName = next.campaignName;
    draft.era = next.era;
    draft.conversationHistory = next.conversationHistory;
    draft.affectionMap = next.affectionMap;
    draft.schemes = next.schemes;
    draft.whispers = next.whispers;   // NEW at P6
    draft.couriers = next.couriers;   // NEW at P6
    draft.staff = next.staff;         // NEW at P6
  }
  ```
  **Trip-wire scope reminder (apply this to every save-version bump):** the schema-projection-selector test catches missing entries in three places (`GameStateSchema`, `hashableState`, `selectGameState`), but NOT in `overwriteFromGameState` because that helper isn't a "projection" — it's a write-side mirror. Always add a fourth-edit checklist item: "`overwriteFromGameState` draft writes for every new top-level GameState field". Same audit per `selectGameState` edits (already covered in the schema-projection-selector triple-sync section, but the draft helper is the OFTEN-FORGOTTEN fourth surface).

- **`src/game/store.ts` extended with new player actions.** Adds five `StoreActions`:
  ```ts
  type StoreActions = {
    // ... existing actions ...
    // P6 additions:
    weaponizeWhisper: (whisperId: WhisperId, branch: WeaponizationBranch) =>
      | { ok: true }
      | { ok: false; reason: WeaponizeWhisperRejection };
    dismissWhisper: (whisperId: WhisperId) =>
      | { ok: true }
      | { ok: false; reason: DismissWhisperRejection };
    assignStaff: (staffId: StaffId, assignment: StaffAssignment) =>
      | { ok: true }
      | { ok: false; reason: AssignStaffRejection };
    spymasterIntercept: () =>
      | { ok: true }
      | { ok: false; reason: SpymasterInterceptRejection };
  };
  ```

  **All four actions are FREE ACTIONS** — they do NOT advance the tick (matching P5's startScheme/cancelScheme precedent). The wealth cost (for spymasterIntercept and any future cost-bearing actions) IS the cost; no tick consumed at start. The orchestrator's `applyCourierAndStaffPhase` fires on every tick advance via the existing tick-consuming actions (travel, audience, ...).

  **Action body shape (block-form `set` matching P5 precedent):**
  ```ts
  weaponizeWhisper: (whisperId, branch) => {
    const before = get();
    // Pass PLAYER_HOUSE_ID as the 2nd positional arg per the rule's pinned
    // signature `tryWeaponizeWhisper(state, ownerHouseId, whisperId, branch)`
    // (resolves B1 from C8 iter 1). At v1 the player is the only owner of
    // weaponizable whispers; P8 may route rival-owned whispers through a
    // different entry point with a different owner.
    const result = tryWeaponizeWhisper(before, PLAYER_HOUSE_ID, whisperId, branch);
    if (!result.ok) return { ok: false, reason: result.reason };
    set((draft) => {
      overwriteFromGameState(draft, result.state);
    });
    // Direct publish the wrapper-owned event(s). Per the pinned discipline,
    // the diff helper ALSO runs (below) — but is told via wrapperPublishedKeys
    // to skip the Verified→Weaponized transition for THIS whisperId.
    const weaponizedWhisper = result.state.whispers.get(whisperId)!;
    whisperBus.publish({
      kind: "WhisperWeaponized",
      tick: result.state.tick,
      whisperId,
      branch,
      subjectCharacterId: weaponizedWhisper.subjectCharacterId,
      scandalSheetAttribution: branch === "ScandalSheet" ? weaponizedWhisper.scandalSheetAttribution : null,
    });
    if (branch === "ScandalSheet" && weaponizedWhisper.scandalSheetAttribution === true) {
      whisperBus.publish({
        kind: "PlayerExiled",
        tick: result.state.tick,
        reason: "ScandalSheetAttribution",
        whisperId,
      });
    }
    // Diff helper picks up any other side effects (none at v1; forward-compat
    // for future weaponize extensions).
    publishWhisperTransitions(before, result.state, new Set([`weaponize:${whisperId}`]));
    return { ok: true };
  },
  // dismissWhisper, assignStaff, spymasterIntercept follow the same shape:
  // capture `before`, run pure rule, set + direct-publish wrapper-owned event,
  // call publishWhisperTransitions with the matching wrapperPublishedKeys set
  // (`"dismiss:<whisperId>"`, `"reassign:<staffId>"`, `"intercept:<courierId>"`).
  ```

  **Publisher discipline — PINNED reading (resolves B1).** Two readings were drafted; only ONE ships. The pinned discipline:

  - The diff helper `publishWhisperTransitions(before, after)` ALWAYS runs after every tick-advance wrapper AND after every player-action wrapper (`weaponizeWhisper`, `dismissWhisper`, `assignStaff`, `spymasterIntercept`).
  - Player-action wrappers ALSO direct-publish their owned event (`WhisperWeaponized`, `WhisperDismissed`, `StaffReassigned`, `CourierIntercepted`).
  - To prevent double-publish, the diff helper applies a SKIP RULE for each wrapper-owned transition. Literal body fragment inside `publishWhisperTransitions`:
    ```ts
    // SKIP wrapper-owned transitions — wrapper publishes them directly.
    if (beforeWhisper.status === "Verified" && afterWhisper.status === "Weaponized") continue;
    if (beforeWhisper.status === "Verified" && afterWhisper.status === "Dismissed") continue;
    // (And below in the courier-loop:)
    // if (beforeCourier.status === "InFlight" && afterCourier.status === "Intercepted"
    //     && afterCourier.resolvedAtTick === after.tick && wrapperOwnedIntercept) continue;
    ```
    For player-elected `spymasterIntercept` the wrapper sets a transient flag on the helper call — or simpler: the wrapper publishes BEFORE invoking the diff helper, and the diff helper checks via a small `set` of already-published `(courierId, "Intercepted")` pairs the wrapper hands in as a third arg. The pinned implementation passes a 3rd arg: `publishWhisperTransitions(before, after, wrapperPublishedKeys: Set<string>)`. Wrappers populate the set with keys like `"weaponize:<whisperId>"`, `"dismiss:<whisperId>"`, `"reassign:<staffId>"`, `"intercept:<courierId>"` before calling. Diff helper skips matching entries.
  - For tick-advance wrappers (advanceTick, travel, …), `wrapperPublishedKeys` is the empty set — no events are pre-published, so the diff helper handles every transition.

  This rule **scales to future side effects**: if a future `weaponizeWhisper` extension also mutates the subject's archetype, the diff helper picks it up automatically — the wrapper only needs to enumerate keys for the EVENTS it directly publishes, not the state surfaces it touches.

  **Net effect:**
  | Transition | Source path | Publisher |
  |---|---|---|
  | (none yet) → Unverified (new whisper from synergy or LLM) | `sendBallroomMessage` wrapper post-resolve block | direct publish `WhisperCreated` from wrapper |
  | (none yet) → Unverified (new whisper from staff cadence) | `applyCourierAndStaffPhase` during tick-advance | diff helper publishes `WhisperCreated` |
  | `arrivedAtTick: null` → `arrivedAtTick: T` | `applyCourierAndStaffPhase` drain step | diff helper publishes `WhisperArrived` |
  | Unverified → Verified | `applyWhisperVerificationPhase` during tick-advance | diff helper publishes `WhisperVerified` |
  | Verified → Weaponized | `weaponizeWhisper` wrapper | direct publish `WhisperWeaponized` (+ `PlayerExiled` if attribution) |
  | Verified → Dismissed | `dismissWhisper` wrapper | direct publish `WhisperDismissed` |
  | Courier InFlight → Delivered | `applyCourierAndStaffPhase` drain step | diff helper publishes `CourierDelivered` |
  | Courier InFlight → Intercepted | `applyCourierAndStaffPhase` staff InterceptMail OR `spymasterIntercept` wrapper | diff helper publishes `CourierIntercepted` (tick path); direct publish from wrapper (player path) |
  | Staff assignment change (player) | `assignStaff` wrapper | direct publish `StaffReassigned` |
  | Staff assignment → BribedByRival (auto) | `applyCourierAndStaffPhase` bribery roll | diff helper publishes `StaffBribed` |
  | Staff loyalty drift (per-tick) | `applyCourierAndStaffPhase` drift step | NO event — loyalty changes are too frequent to publish individually; UI reads loyalty directly via Zustand selector |

  **Why no per-tick loyalty event:** unlike status transitions (rare, discrete), loyalty drift is per-tick continuous. Publishing on every drift would flood subscribers. The UI's Staff ledger renders loyalty via a Zustand selector and re-renders reactively without bus involvement.

- **`src/runtime/events/whispers.ts`** — NEW event bus module. Defines the typed-event discriminated union for whisper + courier + staff lifecycle events. Variants (CANONICAL DECLARATION — single source of truth; resolves B1 from C6 iter 2):
  ```ts
  export type WhisperEvent =
    | { kind: "WhisperCreated"; tick: number; whisperId: WhisperId; sourceCharacterId: CharacterId; subjectCharacterId: CharacterId; destinationHouseId: HouseId; llmGenerated: boolean }
    | { kind: "WhisperArrived"; tick: number; whisperId: WhisperId; destinationHouseId: HouseId }
    | { kind: "WhisperVerified"; tick: number; whisperId: WhisperId }
    | { kind: "WhisperWeaponized"; tick: number; whisperId: WhisperId; branch: WeaponizationBranch; subjectCharacterId: CharacterId; scandalSheetAttribution: boolean | null }
    | { kind: "WhisperDismissed"; tick: number; whisperId: WhisperId }
    | { kind: "PlayerExiled"; tick: number; reason: "ScandalSheetAttribution"; whisperId: WhisperId }
    | { kind: "CourierDelivered"; tick: number; courierId: CourierPayloadId; whisperId: WhisperId; destinationHouseId: HouseId }
    | { kind: "CourierIntercepted"; tick: number; courierId: CourierPayloadId; whisperId: WhisperId; source: "StaffInterceptMail" | "SpymasterAction" }
    | { kind: "StaffReassigned"; tick: number; staffId: StaffId; from: StaffAssignment; to: StaffAssignment }
    | { kind: "StaffBribed"; tick: number; staffId: StaffId }
    | { kind: "PlayerExileBlocked"; tick: number; action: string };  // P6 exile-gate variant — see "Exile enforcement" section for the per-action gate logic that publishes this
  export const whisperBus = new EventBus<WhisperEvent>();
  ```
  **All 11 variants live in THIS canonical declaration**, including `PlayerExileBlocked`. The exile-gate section below references this declaration; the variant is NOT re-declared at the gate site (a prior plan-draft had a duplicate declaration that diverged — resolved by single-source-of-truth here).
  - **Why a SINGLE bus for whispers + couriers + staff** (not three separate buses): they're tightly coupled domain events (a courier delivery emits a whisper-arrived; a staff bribery affects whisper output flow). The bus is the same shape as P5's `schemeBus` (one bus for scheme + grievance events). Same CLAUDE.md "typed event publishers, no god files" — `whispers.ts` is the espionage domain.

  - **`publishWhisperTransitions(before, after, wrapperPublishedKeys?)`** — diff helper. **PINNED signature (resolves B2 — load-bearing):**
    ```ts
    // src/runtime/events/whispers.ts
    const EMPTY_KEYS: ReadonlySet<string> = new Set();
    export function publishWhisperTransitions(
      before: GameState,
      after: GameState,
      wrapperPublishedKeys: ReadonlySet<string> = EMPTY_KEYS,
    ): void {
      // ... body per per-loop description below ...
    }
    ```
    **Caller convention:** tick-advance wrappers (`advanceTick`, `travel`, `requestAudience`, `escapeBankruptcy`, `refreshWardrobe`, `runYearPass`) OMIT the third arg — they invoke `publishWhisperTransitions(before, after)` and the parameter defaults to the module-level `EMPTY_KEYS` constant. Player-action wrappers (`weaponizeWhisper`, `dismissWhisper`, `assignStaff`, `spymasterIntercept`) pass a non-empty Set: `publishWhisperTransitions(before, after, new Set([\`weaponize:${whisperId}\`]))`. **The module-level `EMPTY_KEYS` constant is load-bearing** — if every tick-advance caller `new Set()`-allocates a fresh empty Set, the diff-helper allocation cost grows with phase-chain depth across the campaign; sharing one frozen empty Set across all tick-path calls keeps the cost zero. **Why default-arg vs options-bag** at v1: the 3-arg shape mirrors P5's `publishSchemeTransitions(before, after)` precedent at `runtime/events/scheme.ts:134` (minimal divergence); a future fourth piece of skip metadata would force a switch to an options bag at that time — the migration is mechanical and the v1 default-arg form is the smaller delta. Body walks four collections in fixed order: (a) `after.whispers` for new ids → emit `WhisperCreated`; (b) `after.whispers` for `arrivedAtTick: null → set` → emit `WhisperArrived`; (c) `after.whispers` for status transitions (`Unverified→Verified` → emit `WhisperVerified`; `Verified→Weaponized` → emit `WhisperWeaponized` UNLESS `wrapperPublishedKeys.has("weaponize:" + whisperId)`; `Verified→Dismissed`/`Unverified→Dismissed`/`Verified→Dismissed` → emit `WhisperDismissed` UNLESS `wrapperPublishedKeys.has("dismiss:" + whisperId)`); (d) `after.couriers` for `InFlight→Delivered` → emit `CourierDelivered`; `InFlight→Intercepted` → emit `CourierIntercepted { source: wrapperPublishedKeys.has("intercept:" + courierId) ? "SpymasterAction" : "StaffInterceptMail" }` UNLESS the wrapperPublishedKeys already covered it (in which case the wrapper published the spymaster-source variant directly and the helper skips); (e) `after.staff` for assignment changes that introduce `BribedByRival` → emit `StaffBribed`; non-bribery assignment changes (player-elected) → emit `StaffReassigned` UNLESS `wrapperPublishedKeys.has("reassign:" + staffId)`. **Why the third-arg approach (not a side-channel flag):** keeps the diff helper a pure function of its three inputs; testable in isolation by passing a synthesized `wrapperPublishedKeys` set; wrapper-vs-tick path branches collapse to a single skip-check per case.

    **Why the diff helper ALWAYS runs (even on wrapper paths):** wrapper paths may produce side effects beyond the wrapper's direct-published event. Example: a future `weaponizeWhisper` extension that also flips the subject character's archetype — the wrapper publishes `WhisperWeaponized` (with `wrapperPublishedKeys: {"weaponize:" + whisperId}`); the diff helper walks the rest and emits any other transitions. The wrapper-only-publish-non-diff alternative was considered and rejected for this reason.

    **Per-wrapper diff-helper wiring (literal table — variable names follow existing precedent):**
    | Wrapper | Diff helpers fired AFTER set returns |
    |---|---|
    | `advanceTick` | `publishCharacterDeaths`, `publishSchemeTransitions`, `publishWhisperTransitions` |
    | `travel` / `requestAudience` / `escapeBankruptcy` / `refreshWardrobe` | same triplet |
    | `runYearPass` | `publishCharacterDeaths` AND `publishWhisperTransitions` (resolves B5). **Why both:** `runYearPassPure` composes `applyAgingStep` which calls `pruneOrphanedConversationKeys` (the death-cascade helper extended at P6 to ALSO flip whispers to `"Dismissed"` when a subject character dies). So a year-pass that kills any whisper subject DOES mutate `state.whispers`. The Vitest invariant pinned at this row was `expect(runYearPassPure(state).whispers).toBe(state.whispers)` (referential equality); P6 DROPS that exact assertion and replaces it with conditional shape:<br>`if (no characters die during year-pass) expect(runYearPassPure(state).whispers).toBe(state.whispers); else expect(/* whispers about dead subjects */).each(w => expect(w.status).toBe("Dismissed"))`.<br>`couriers` and `staff` ARE untouched by year-pass (verified: `applySuccessionStep` + `applyConceptionStep` don't read or write either Map), so `expect(runYearPassPure(state).couriers).toBe(state.couriers)` and `expect(...).staff.toBe(state.staff)` STILL hold unconditionally — keep those two referential-equality assertions. The diff helper is wired on the wrapper unconditionally; if no characters died, it walks an unchanged whispers Map and emits zero events (cheap no-op).<br>**LOAD-BEARING source-edit at `src/game/store.ts:222-236` (resolves prior B1 — LITERAL PATCH).** Literal BEFORE/AFTER of the entire `runYearPass` action body:<br>```ts<br>// src/game/store.ts:222-236 BEFORE (verbatim — P5 state):<br>runYearPass: () => {<br>  const before = get();<br>  const after = runYearPassPure(before);<br>  set((state) => {<br>    overwriteFromGameState(state, after);<br>  });<br>  // P5: extracted to publishCharacterDeaths shared helper. The pre-P5<br>  // inline TargetCharacterDied loop is REPLACED — keeping both would<br>  // double-publish for every death. heir-promotion safety is preserved<br>  // (helper reads playerHeadIdBefore from `before`).<br>  publishCharacterDeaths(before, after);<br>  // NO publishSchemeTransitions: runYearPassPure never mutates<br>  // state.schemes or house.grievances (verified yearPass.ts composes<br>  // aging + succession + conception, none of which touch those surfaces).<br>},<br><br>// src/game/store.ts:222-236 AFTER (P6 — replace P5 comment with P6 comment + add publishWhisperTransitions call):<br>runYearPass: () => {<br>  const before = get();<br>  const after = runYearPassPure(before);<br>  set((state) => {<br>    overwriteFromGameState(state, after);<br>  });<br>  publishCharacterDeaths(before, after);<br>  // P5 invariant preserved: NO publishSchemeTransitions — runYearPassPure<br>  // doesn't touch state.schemes or house.grievances.<br>  // P6 ADDITION: publishWhisperTransitions FIRES here because applyAgingStep's<br>  // pruneOrphanedConversationKeys extension flips whispers to Dismissed when<br>  // a subject character dies (year-pass natural deaths trigger the cascade).<br>  // Without this call, P11's inherited-secrets pipeline misses year-pass-driven<br>  // whisper-Dismissal events.<br>  publishWhisperTransitions(before, after);<br>},<br>```<br>The patch is surgical: replace lines 228-235's P5 comment block with the P6 one, and add the new `publishWhisperTransitions(before, after);` call as the function body's last statement. |
    | `weaponizeWhisper` / `dismissWhisper` / `assignStaff` / `spymasterIntercept` | `publishWhisperTransitions` (diff path — captures any side effects beyond the direct-publish); the wrapper ALSO direct-publishes its targeted event. Skip-rule prevents double-publish for the specific transition the wrapper owns. |
    | `sendBallroomMessage` | already publishes conversation-domain events; also calls `publishWhisperTransitions` (NEW at P6) to emit `WhisperCreated` for synergy + LLM-additive whispers AND to capture the `applyAccidentalSlipDripOnConversation` ripple effects. **Alternative: direct-publish inside sendBallroomMessage** considered + rejected; the diff helper is the cleaner pattern because synergy + wallflower-bonus + LLM-additive can produce 0, 1, 2, or 3 new whispers per call — walking the diff is simpler than counting branches inline. |

- **LLM tool surface widening (`src/llm/tools.ts`)** — promote `generateWhisper` from reserved-empty-array slot to a real tool. **Edits:**
  ```ts
  // src/llm/tools.ts (P6 ADDITIONS):
  export const GENERATE_WHISPER_TOOL_NAME = "generateWhisper" as const;

  export const GENERATE_WHISPER_TOOL: FunctionDeclaration = {
    name: GENERATE_WHISPER_TOOL_NAME,
    description:
      "Emit an in-character rumor/whisper about a third party. The whisper " +
      "becomes Unverified in the player's ledger and may be weaponized later. " +
      "Use sparingly — only when the in-character moment naturally produces gossip.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        // The model identifies the subject by character id (sourced from the
        // persona prompt's "Other characters" section). v1 disables free-form
        // subject names — only valid CharacterIds are accepted; invalid ids
        // are dropped silently (the whisper is not ingested).
        subjectCharacterId: { type: "string" },
        text: { type: "string", description: "1-2 sentence whisper body, in-character." },
      },
      required: ["subjectCharacterId", "text"],
    },
  };
  ```
  **`RESPOND_TOOL` items-schema widening (resolves B4 — LITERAL EDIT).** The existing `toolCalls: { type: "array", items: { type: "object" } }` declaration at `tools.ts:29` is the P4-reserved generic shape — Gemini accepts any object the model fabricates. P6 widens the `items` schema to constrain the model AT THE TOOL-DECL LEVEL, not just at Zod-parse-time. Literal post-widening shape:
  ```ts
  // src/llm/tools.ts:13-33 BEFORE (verbatim — P4 state):
  export const RESPOND_TOOL: FunctionDeclaration = {
    name: RESPOND_TOOL_NAME,
    description: "Reply in-character to the player's message and classify their tactic.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        dialogue: { type: "string" },
        classifiedTactic: { type: "string", enum: ["Flattery", "WittyBanter", "SlyGossip", "DeepEmpathy"] },
        qualityMultiplier: { type: "number" },
        moodHint: { type: "string", enum: ["Receptive", "Defensive", "Distracted", "Jealous", "Grieving"] },
        toolCalls: { type: "array", items: { type: "object" } }, // P6 widens
      },
      required: ["dialogue", "classifiedTactic", "qualityMultiplier"],
    },
  };

  // P6 AFTER (toolCalls.items widened):
  export const RESPOND_TOOL: FunctionDeclaration = {
    name: RESPOND_TOOL_NAME,
    description: "Reply in-character to the player's message and classify their tactic.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        dialogue: { type: "string" },
        classifiedTactic: { type: "string", enum: ["Flattery", "WittyBanter", "SlyGossip", "DeepEmpathy"] },
        qualityMultiplier: { type: "number" },
        moodHint: { type: "string", enum: ["Receptive", "Defensive", "Distracted", "Jealous", "Grieving"] },
        toolCalls: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string", enum: ["generateWhisper"] },
              args: {
                type: "object",
                properties: {
                  subjectCharacterId: { type: "string" },
                  text: { type: "string" },
                },
                required: ["subjectCharacterId", "text"],
              },
            },
            required: ["name", "args"],
          },
        },
      },
      required: ["dialogue", "classifiedTactic", "qualityMultiplier"],
    },
  };
  ```
  **Why both layers (tool-decl AND Zod):** the tool-decl constraint biases the model AT GENERATION TIME (Gemini's structured-output mode honors the JSON schema's `enum` and `required` fields when sampling). The Zod schema at `ConversationResponseSchema` is the DEFENSIVE backstop for when the model returns a malformed call despite the constraint. Both layers are needed: the tool-decl improves model behavior; the Zod parse keeps the rule layer's invariants honest.

  Both `RESPOND_TOOL` and `GENERATE_WHISPER_TOOL` go into the `tools[].functionDeclarations` array in `client.ts`. `toolConfig.functionCallingConfig.allowedFunctionNames` STAYS `["respond"]` — the structure is: the model is forced to call `respond`, and within `respond`'s `toolCalls` field the model may include a `generateWhisper` payload. (The `generateWhisper` declaration is REGISTERED for type/documentation symmetry but isn't a forced second call.)

  **`src/llm/client.ts:56` literal edit (resolves B1 — LOAD-BEARING).** The existing line at `client.ts:56` reads `tools: [{ functionDeclarations: [RESPOND_TOOL] }],` (verified). Without an explicit edit, `GENERATE_WHISPER_TOOL` is exported but NEVER REGISTERED with Gemini — the model never sees the declaration AND the toolCalls payloads the model produces have no schema-side bias toward the constrained shape. Literal edit:
  ```ts
  // src/llm/client.ts BEFORE (line 20 import, line 56 registration — verbatim):
  import { RESPOND_TOOL } from "./tools";
  // ...
        tools: [{ functionDeclarations: [RESPOND_TOOL] }],

  // src/llm/client.ts AFTER (P6 — two-line edit):
  import { GENERATE_WHISPER_TOOL, RESPOND_TOOL } from "./tools";
  // ...
        tools: [{ functionDeclarations: [RESPOND_TOOL, GENERATE_WHISPER_TOOL] }],
  ```
  `toolConfig.functionCallingConfig.allowedFunctionNames` at `client.ts:60` STAYS `["respond"]` — the registration symmetry exists for type/documentation purposes, but only `respond` is FORCED (the model freely decides whether to emit `generateWhisper` payloads inside `respond`'s `toolCalls` field).

  **Schema widening (`src/llm/types.ts:ConversationResponseSchema`):** the existing `toolCalls: z.array(z.never()).default([])` (verified at `types.ts:59`) widens to a real shape:
  ```ts
  // src/llm/types.ts (P6 edits):
  const GenerateWhisperToolCallSchema = z.object({
    name: z.literal("generateWhisper"),
    args: z.object({
      subjectCharacterId: z.string(),
      text: z.string(),
    }),
  });
  export const ConversationResponseSchema = z.object({
    dialogue: z.string().min(1),
    classifiedTactic: z.string(),
    qualityMultiplier: z.number(),
    moodHint: z.string().optional(),
    toolCalls: z.array(GenerateWhisperToolCallSchema).default([]),  // WIDENED at P6
  });
  // ConversationResponse (narrowed) gains `toolCalls` typed properly. THIS IS A
  // LITERAL EDIT to the existing type-alias declaration at types.ts:64-70
  // (resolves B2). Verified pre-edit at src/llm/types.ts:69 reads
  // `toolCalls: never[];`. Without this declaration-level widening, dropping
  // the `as never[]` cast in narrowResponse (below) FAILS typecheck because
  // the consumer-facing type still pins never[].
  // src/llm/types.ts:64-70 BEFORE (P4 state, verbatim):
  //   export type ConversationResponse = {
  //     dialogue: string;
  //     classifiedTactic: Tactic;
  //     qualityMultiplier: number;
  //     moodHint: Mood | null;
  //     toolCalls: never[];
  //   };
  // src/llm/types.ts:64-70 AFTER (P6 — single line edit, the `toolCalls` field):
  export type ConversationResponse = {
    dialogue: string;
    classifiedTactic: Tactic;
    qualityMultiplier: number;
    moodHint: Mood | null;
    toolCalls: ReadonlyArray<{ name: "generateWhisper"; args: { subjectCharacterId: string; text: string } }>;
  };
  ```
  **`narrowResponse` body edit (resolves B3 — LOAD-BEARING).** The existing `narrowResponse` at `src/llm/types.ts:107-122` currently writes `toolCalls: raw.toolCalls as never[]` (verified at `types.ts:120`). The cast is what kept the P4 "schema-present, contents-empty" contract honest. P6 MUST drop the cast:
  ```ts
  // src/llm/types.ts:107-122 BEFORE (verbatim — P4 state):
  export function narrowResponse(
    raw: ConversationResponseRaw,
    pinnedIntent: Tactic | null,
  ): ConversationResponse {
    const qualityMultiplier = Math.max(
      QUALITY_MULTIPLIER_FLOOR,
      Math.min(QUALITY_MULTIPLIER_CEIL, raw.qualityMultiplier),
    );
    return {
      dialogue: raw.dialogue,
      classifiedTactic: resolveTactic(raw.classifiedTactic, pinnedIntent),
      qualityMultiplier,
      moodHint: resolveMoodHint(raw.moodHint),
      toolCalls: raw.toolCalls as never[],   // <-- P4 cast: DROP at P6
    };
  }

  // P6 AFTER (single-line edit at the toolCalls field):
  // ... unchanged setup ...
    return {
      dialogue: raw.dialogue,
      classifiedTactic: resolveTactic(raw.classifiedTactic, pinnedIntent),
      qualityMultiplier,
      moodHint: resolveMoodHint(raw.moodHint),
      toolCalls: raw.toolCalls,   // P6: pass through (Zod schema now validates the shape)
    };
  ```
  Without this edit, every consumer of `ConversationResponse` still sees `toolCalls: never[]` from the cast — the LLM-additive whisper path is structurally dead code (`response.toolCalls` is typed as never[], so any `if (response.toolCalls.length > 0) ingestLlmAdditiveWhisper(...)` branch fails typecheck). The cast is the load-bearing thing the P4 schema-present-contents-empty contract depended on; once the schema is widened (P6), the cast becomes the type-narrowing barrier that defeats the widening.

  **Defensive clamp at v1:** invalid subjectCharacterIds are filtered at the `ingestLlmAdditiveWhisper` boundary in the store action (per the predicate-alignment table above), not at `narrowResponse` — keeping `narrowResponse` purely shape-narrowing matches the P4 design.

  **Persona prompt extension** (`src/llm/prompts/persona.ts`): add an "Other characters in this scene" section listing the names + CharacterIds of NPCs present, so the model has a valid id pool to reference in `generateWhisper`. At P6 with the 5 baseline NPCs all at Capital, the list is the 4 non-target NPCs. (Persona prompt body remains <300 tokens — well under the 1500-token system-instruction budget.) **Why include CharacterIds in the prompt:** the model's `generateWhisper` call must produce a valid CharacterId; without exposure to the id namespace, the model would fabricate ids that fail the ingest-time validation. Trade-off accepted: persona prompts grow by ~50 tokens per scene; well within budget. **Cache invalidation concern:** at P4 the per-target persona cache is keyed on the target character's identity — the "other characters" section depends on the SCENE composition (who else is present), so cache hits may surface stale "other characters" lists when scene composition changes. **At P6 with no scene-composition variation** (ballroom always shows the same 5 NPCs at Capital), this is functionally a non-issue; P11 sibling-rivals OR a future rotating-NPC-pool addition would force a cache-key extension. Document inline in `persona.ts` so the future maintainer doesn't miss it.

  **`buildPersonaPrompt` signature change (resolves B1 from C5 — LOAD-BEARING).** The current signature at `src/llm/prompts/persona.ts:16` is `buildPersonaPrompt(target: Character): string` — single-arg. To embed the "Other characters in this scene" section, the function MUST receive the scene composition. Literal signature change + canonical-format extension + 2-callsite update list:
  ```ts
  // src/llm/prompts/persona.ts:16 BEFORE (P4 state — single-arg):
  export function buildPersonaPrompt(target: Character): string { ... }

  // src/llm/prompts/persona.ts AFTER (P6 — two-arg with scene context):
  export function buildPersonaPrompt(
    target: Character,
    otherCharactersInScene: ReadonlyArray<Character>,   // NEW at P6 — lex-sort-by-id by caller
  ): string {
    // ... existing canonical-format body unchanged ...
    // ... append at end (P6 ADDITION):
    //   Other characters in this scene:
    //   - <id>: <name> (<role>)
    //   - ...
    // (Lex-sort by CharacterId across the array; deterministic per the
    // canonical-format invariant. Empty array → omit the section entirely.)
  }
  ```
  **Canonical-format invariant update (CRITICAL):** the comment block at `persona.ts:7-13` describes the CANONICAL FORMAT consumed by the mock SDK's request-hash. P6 extends the comment block to document the new section AND its conditional emission (omit when array is empty). The mock-SDK fixture-update step (line 4 of the replay-harness re-baseline gate above) MUST cover the new section's hash contribution.

  **2-callsite update list:**
  - **`src/llm/cache.ts:35`** (verified `systemInstruction: buildPersonaPrompt(target),`): widens to `systemInstruction: buildPersonaPrompt(target, otherCharactersInScene),`. The caller (`getOrCreatePersonaCache`) must now ALSO receive the scene composition. Signature change at `cache.ts:11-15`:
    ```ts
    // src/llm/cache.ts:11-15 AFTER (P6 — add scene composition arg):
    async getOrCreatePersonaCache(
      ai: GoogleGenAI,
      target: Character,
      model: Model,
      abort: AbortSignal,
      otherCharactersInScene: ReadonlyArray<Character>,   // NEW at P6
    ): Promise<string | null> { ... }
    ```
    **`conversationOrchestrator.send` caller** (`src/runtime/conversationOrchestrator.ts:90-95`) — THIRD load-bearing callsite (alongside `cache.ts:35` and `store.ts:421`). Verified BEFORE state at `conversationOrchestrator.ts:90-95`:
    ```ts
    // src/runtime/conversationOrchestrator.ts:90-95 BEFORE (P4 state, verbatim):
    const cacheName = await personaCacheRegistry.getOrCreatePersonaCache(
      client.ai,
      target,
      request.model,
      abortController.signal,
    );

    // src/runtime/conversationOrchestrator.ts:90-95 AFTER (P6 — append 5th arg from request):
    const cacheName = await personaCacheRegistry.getOrCreatePersonaCache(
      client.ai,
      target,
      request.model,
      abortController.signal,
      request.otherCharactersInScene,   // NEW at P6 — threaded from store-action request build
    );
    ```
    The orchestrator receives `otherCharactersInScene` from the store action via the new field on `ConversationRequest`. Literal `ConversationRequest` field addition at `src/llm/types.ts:37-48`:
    ```ts
    // src/llm/types.ts — P6 ADDITIONS:
    // Direct import from game/entities is permitted under boundary rule (c)
    // at eslint.config.js:117 — llm element is explicitly allowed to import
    // from game-entities for typed parameter shapes. (game/conversation/types.ts
    // does NOT re-export Character, so we go direct.) PINNED resolves B1 from
    // C7 iter 2: implementer takes the direct route, not the re-export route.
    import type { Character } from "../game/entities";

    export type ConversationRequest = {
      // ... existing fields ...
      otherCharactersInScene: ReadonlyArray<Character>;   // NEW at P6
    };
    ```
    **Import-path discipline pin (resolves B1 from C7 iter 2):** boundary rule (c) at `eslint.config.js:117-118` explicitly comments: "game-entities is allowed for typed parameter shapes (Character) since the LLM layer reads-but-doesn't-mutate state." Direct import `import type { Character } from "../game/entities"` is the canonical route — not via `game/conversation/types.ts` (which doesn't re-export Character). Same direct-import pattern that `conversationOrchestrator.ts:18` already uses (verified: `import type { Character } from "../game/entities";`).
  - **`src/game/store.ts:421`** (verified `persona: buildPersonaPrompt(target),`): widens to `persona: buildPersonaPrompt(target, otherCharactersInScene),`. The store action computes `otherCharactersInScene` BEFORE the request builder — at v1, it's the 4 non-target NPCs at the Capital location:
    ```ts
    // src/game/store.ts (sendBallroomMessage P6 ADDITION before request builder):
    const otherCharactersInScene = [...stateBefore.characters.values()]
      .filter(c => c.alive && c.id !== target.id && c.houseId !== PLAYER_HOUSE_ID)
      .sort((a, b) => a.id.localeCompare(b.id));   // lex-sort by CharacterId — deterministic
    // ... then in the request builder:
    const request = {
      // ... existing fields ...
      persona: buildPersonaPrompt(target, otherCharactersInScene),
      otherCharactersInScene,                              // NEW at P6 (threaded to orchestrator → cache.ts)
      // ... rest unchanged ...
    };
    ```
    **Why lex-sort here:** matches the project's lex-sort iteration discipline; the model sees the same character list in the same order across replay-harness runs.

  **Persona cache version bump at P6 deploy (resolves B3 from C4 iter 5 AND B2 from C4 iter 7 — LITERAL PATCH).** P4 introduced the per-target Gemini context cache (`src/llm/cache.ts`) keyed on the character identity + model. Verified BEFORE state at `cache.ts:17`: `type CacheKey = \`${CharacterId}|${Model}\`` AND verified at `cache.ts:28`: `const key = \`${target.id}|${model}\` as CacheKey;`. The cache's `systemInstruction` is the persona prompt body — at P4-P5 deploys, the in-memory registry populated with `systemInstruction: <P5-format-persona>` entries that DON'T contain the new "Other characters in this scene" section. P6 adds the section to `buildPersonaPrompt`; without a key shape change, the existing P4-P5 entries CONTINUE TO HIT on post-P6 lookups → model sees stale persona → `generateWhisper` toolCall is never produced → the espionage tutorial silently fails for any conversation target the player visited pre-P6.

  **PINNED literal patch at `src/llm/cache.ts`:**
  ```ts
  // src/game/constants.ts — ADD at P6 (alongside PERSONA_CACHE_TTL_SECONDS):
  // Bumped on every change to buildPersonaPrompt's output format. Forces
  // in-memory cache miss on every prior-version key; Gemini server-side
  // caches with the old displayName naturally expire by TTL.
  export const PERSONA_CACHE_VERSION = "v2" as const;

  // src/llm/cache.ts:17 BEFORE (verbatim — P4 state):
  type CacheKey = `${CharacterId}|${Model}`;

  // src/llm/cache.ts:17 AFTER (P6 — extend the key shape):
  type CacheKey = `${CharacterId}|${Model}|${typeof PERSONA_CACHE_VERSION}`;

  // src/llm/cache.ts:28 BEFORE (verbatim — P4 state):
  const key = `${target.id}|${model}` as CacheKey;

  // src/llm/cache.ts:28 AFTER (P6 — append the version suffix):
  const key = `${target.id}|${model}|${PERSONA_CACHE_VERSION}` as CacheKey;

  // src/llm/cache.ts:37 BEFORE (verbatim — P4 state, cosmetic displayName):
  displayName: `${PERSONA_CACHE_DISPLAY_NAME_PREFIX}${target.id}`,

  // src/llm/cache.ts:37 AFTER (P6 — version-tagged displayName so Gemini-side cache pool partitions cleanly):
  displayName: `${PERSONA_CACHE_DISPLAY_NAME_PREFIX}${target.id}-${PERSONA_CACHE_VERSION}`,
  ```
  **`PERSONA_CACHE_VERSION` import at `cache.ts`:** add to the existing import block at `cache.ts:1-10` (specifically the line that imports `PERSONA_CACHE_TTL_SECONDS`).

  **Why both the in-memory key AND the server-side displayName change:** the in-memory key change is what forces the LOOKUP miss (the load-bearing fix for stale local registry). The displayName change is defense-in-depth on the Gemini server-side cache pool — if the player has multiple browser tabs open or hydrates state from a recent save, the Gemini-side cache could in principle be reused via a discovery path; the version-tagged displayName partitions the Gemini-side caches cleanly. (Gemini's cache discovery is opaque from the SDK; explicit displayName partitioning is the conservative move.)

  **Future persona-prompt format changes (P11 sibling-rivals, P15 dynasty perks) MUST also bump `PERSONA_CACHE_VERSION`** (v2 → v3, etc.) to force cache invalidation on deploy. **The version constant is hash-irrelevant** (lives in code, not game state; hash projection doesn't include it) — bumping it is a pure non-determinism-safe code change.

  **Replay-harness re-baseline gate (resolves prior B1 — HARD VERIFICATION REQUIREMENT).** `src/llm/prompts/persona.ts:8` carries an explicit warning: "format changes break replay-harness determinism" because the mock SDK hashes the canonical persona format string to produce deterministic stub responses. Modifying the persona format (adding the "Other characters in this scene" section) WILL change the hash inputs → the mock SDK returns DIFFERENT responses than the pre-P6 fixtures → the 30-run identical-hash NFR fails at first run after the edit. **Coordinated lockstep update required as part of P6 close-out:**
  1. Update the mock SDK's request-hash input set to include the new persona format AND re-baseline whatever response fixtures it produces.
  2. Re-run the replay-harness 30-run identical-hash test to confirm the new baseline is stable.
  3. Update any conversation-orchestrator tests that pin specific dialogue responses against the pre-P6 mock outputs (search via `rg 'mockResponse|stubDialogue|expect.*dialogue' src/`).
  4. Document the new mock SDK request-hash input set inline at `persona.ts`'s CANONICAL FORMAT comment block AND at the mock SDK's hash-input file (location TBD by implementer — recommend `src/llm/__test-utils__/mockSdkHashInputs.ts` if not already established).

  **This is a HARD verification gate**: P6 cannot ship until the replay-harness 30-run NFR re-passes against the new persona format. The alternative — moving the persona prompt extension OUT of P6 scope — would force `generateWhisper`'s subjectCharacterId to be free-form text validated only at ingest time, dropping ~80% of model outputs (the model would fabricate names instead of using ids). Persona extension stays in P6 scope; replay-harness re-baseline is the required coordination step. Added to Verification section below.

  **`ingestLlmAdditiveWhisper` defensive validation in the store action:** when `response.toolCalls` contains a `generateWhisper` entry, the store action validates `args.subjectCharacterId` against three predicates IN ORDER (first-fail drops silently):
  1. **Exists:** `state.characters.has(args.subjectCharacterId as CharacterId)`. Drop if the model fabricated an unknown id.
  2. **Not the conversation target:** `args.subjectCharacterId !== input.targetCharacterId`. The gossip mechanic models third-party rumor; a whisper about the person you're conversing with is dialogue, not espionage.
  3. **Not in the player's house:** `state.characters.get(args.subjectCharacterId).houseId !== PLAYER_HOUSE_ID`. Match the `SubjectIsSelf` predicate in `tryWeaponizeWhisper` so an ingested whisper never traps the player in a permanently-unweaponizable ledger row.

  **Predicate-alignment table (resolves B4):**
  | Predicate | Where enforced | Why it's needed |
  |---|---|---|
  | Subject character exists | Ingest filter | Defensive against LLM fabrication; whispers must reference real `state.characters` entries |
  | Subject ≠ conversation target | Ingest filter | Scope: gossip is third-party. The conversation target's lines are dialogue, not rumor. |
  | Subject's `houseId !== PLAYER_HOUSE_ID` | BOTH ingest filter AND weaponize validator | Prevents player-house-targeted whispers from entering the ledger AT ALL (ingest) AND blocks weaponization of any (e.g., staff-cadence-emitted) whispers that slip through. |
  | Subject `alive === true` | Weaponize validator (NOT ingest) | An ingested whisper about a living subject who LATER dies stays in the ledger as Verified; the orphan-prune cascade flips it to Dismissed on the same tick the subject dies. Weaponize-after-death rejection is defense-in-depth for the brief window between status="Verified" and the cascade firing. |

  **Why the dual enforcement (not single-site):** the ingest filter PREVENTS player-house-subject whispers from being created (so they never appear in the ledger). The weaponize validator PROTECTS against staff-cadence-emitted whispers (Snoop/BribeDriver) accidentally producing a player-house-subject whisper via future bugs — defense-in-depth. At v1 the staff-cadence rules explicitly filter to non-PLAYER subjects (see Staff outputs step 3 above), so the weaponize validator's `SubjectIsSelf` branch is functionally unreachable AT v1 — but it remains as a backstop.

- **Ballroom UI extension (`src/ui/ballroom/`)** — at P6 the ballroom doesn't change its primary interaction shape. The synergy whisper emission happens entirely in the store action; the UI's ChatLog.tsx may optionally show a subtle "a whisper was generated" toast on the SchemeButtons row. P6 ships ONE optional UI element:
  - **`WhisperToast.tsx`** — a transient toast (Framer Motion fade-in/out, 3s duration) that appears in the BallroomView when a synergy whisper fires. Subscribes to `whisperBus` for `WhisperCreated` events with `tick === currentTick`. Renders "A whisper about <subjectName> spreads from this conversation." Purely informational; no player interaction.
  - **No changes to `SchemeButtons`, `MessageInput`, `TacticButtons`, `StanceToggle`** — the conversation flow is unchanged.

- **Ledger UI extensions (`src/ui/ledger/`)** — three new components:
  - **`WhisperLedgerPanel.tsx`** — tabbed view (Unverified | Verified | Weaponized | Dismissed). Lists whispers; for Verified rows, renders three buttons (Blackmail | Scandal Sheet | Accidental Slip) plus a Dismiss button. Each button calls the corresponding store action. Rejection toasts use the standard ActionRejectionToast pattern. **Verification progress bar** on Unverified rows shows `verificationProgress/100` with the per-tick increment hinted in a tooltip.
  - **`StaffPanel.tsx`** — table of staff: name, loyalty (color-coded), upkeep, assignment (dropdown with the 5 enum values; BribedByRival is disabled — player can't elect that). Reassignment fires `assignStaff` store action. Bribed staff render with a "Bribed by rival house" badge instead of the dropdown. Loyalty bar with color thresholds (green 70+, yellow 30-69, red <30).
  - **`SpymasterInterceptCard.tsx`** — a single-button affordance. Disabled at P6 (no living Spymaster); tooltip explains why. The button text is "Intercept Inbound Mail (1 ⨉ tick, requires Spymaster — 10 wealth)".
  - **`ActiveSchemesPanel.tsx`** (existing from P5) — no changes.

  **Where these mount:** P14 ships the full tabbed ledger view; at P6 we mount them in inline panels on the existing strategy map (MapView) or as a temporary "Ledger" route accessible via TopBar. **Pin decision:** add a "Ledger" button to `<TopBar />` (already exists at `src/ui/shared/TopBar.tsx`) that toggles a slide-over panel containing the three new panels stacked. The slide-over IS the v0.6 ledger view; P14 ships the full tabbed restructure. **Why a slide-over (not a route):** the strategy map is the primary view at P3/P4/P5/P6; a route swap to a Ledger view would suspend the map. A slide-over keeps the map in the background. **Slide-over component reuse:** P3's `LocationDetailsPanel` uses a similar pattern (sliding panel from right edge); extract a `<SlideOver>` shell in `src/ui/shared/` for both. This is a small refactor of one component.

- **MapView toast extension** — `src/ui/map/ActionRejectionToast.tsx` already renders typed rejection prose. Extend the rejection prose mapping in `<ActionRejectionToast>` to include the new typed rejections (`WeaponizeWhisperRejection`, `DismissWhisperRejection`, `AssignStaffRejection`, `SpymasterInterceptRejection`). Each variant has a player-readable string.

- **Spec §7 edge cases honored at P6:**
  - **"Conversation history orphan keys"** (referenced at P4/P5): when an NPC dies, the orphan-prune cascade in `pruneOrphanedConversationKeys` (P5 extraction) already handles conversation-history + affection-map cleanup. **P6 extension:** verified-secret pruning on character death. The current helper takes a `newlyDeadCharIds` Set and prunes `conversationHistory` + `affectionMap` keyed on those ids (as targets). P6 ADDS whisper pruning: walks `state.whispers` and flips status to `"Dismissed"` for any whisper where `subjectCharacterId IN newlyDeadCharIds` (the rumor about the dead person becomes inert — Regency-flavor: "de mortuis nil nisi bonum"). **Why Dismissed (not deleted):** matches the "characters/houses/marriages/schemes/whispers never deleted; status flips only" invariant. The diff-publish helper detects the status flip and emits `WhisperDismissed` events for each pruned whisper (player ledger UI updates).

    **Helper signature extension:**
    ```ts
    // src/game/rules/aging.ts (P6 edit):
    export function pruneOrphanedConversationKeys(
      state: GameState,
      newlyDeadCharIds: ReadonlySet<CharacterId>,
    ): GameState {
      if (newlyDeadCharIds.size === 0) return state;
      // (Existing P4/P5 body for conversationHistory + affectionMap pruning.)
      const histFiltered = new Map(state.conversationHistory);
      for (const key of histFiltered.keys()) {
        if (newlyDeadCharIds.has(parsePairKey(key).characterId)) histFiltered.delete(key);
      }
      const affFiltered = new Map(state.affectionMap);
      for (const key of affFiltered.keys()) {
        if (newlyDeadCharIds.has(parsePairKey(key).characterId)) affFiltered.delete(key);
      }
      // P6 NEW: dismiss whispers about newly dead subjects. The subject
      // dies → the rumor goes inert (Regency-flavor). Status flip preserves
      // the whisper record for postmortem display.
      let whispersChanged = false;
      const newWhispers = new Map(state.whispers);
      for (const [id, w] of newWhispers) {
        if (newlyDeadCharIds.has(w.subjectCharacterId) &&
            w.status !== "Weaponized" &&     // already-weaponized whispers persist
            w.status !== "Dismissed") {
          newWhispers.set(id, { ...w, status: "Dismissed" });
          whispersChanged = true;
        }
      }
      return {
        ...state,
        conversationHistory: histFiltered,
        affectionMap: affFiltered,
        ...(whispersChanged ? { whispers: newWhispers } : {}),
      };
    }
    ```
    **Why already-Weaponized whispers don't get dismissed:** if you've already published a Scandal Sheet about a person, their subsequent death doesn't unprint the news. The Weaponized status is terminal in this regard. Same logic: an active Accidental Slip whose subject dies COULD stop dripping (the next conversation with the dead subject is impossible), but the whisper itself stays Weaponized — the drip just naturally never fires again.

    **Death-source coverage at P6:** the helper is called from (a) `applyAgingStep` (year-pass deaths from natural causes, verified at `src/game/rules/aging.ts:81`), (b) `resolveAssassination` (P5 tick-phase deaths via Assassination scheme, verified at `src/game/rules/schemes.ts:494`). **BOTH death paths already in place at P5 close-out** — the P6 extension to `pruneOrphanedConversationKeys` (whisper dismissal) inherits both existing call sites automatically. No additional call-site wiring needed for P5 paths. **Future death paths must also call this helper** — P8 duels, P11 sibling-rival kills, P13 WarEffort officer deaths. The helper is the single source of truth for the death cascade across both year-pass and tick-phase mortality.

  - **"Rival-house associated-character pruning"** — deferred to P8 (rivals don't exist yet at P6). The P8 helper will extend `pruneOrphanedConversationKeys` to also walk a rival-houses-character-id list — at P6 we wire the helper signature to accept the broader future state but don't add the walk yet.

  - **"Staff bribery while assigned to mail interception"** — when a staff member's `assignment === "InterceptMail"` is flipped to `"BribedByRival"` via the bribery roll, the NEXT tick's mail-interception cadence slot is FORFEIT — no inbound payload is dropped (spec §7 line 654). At P6 this is automatic: the bribed staff's assignment is `"BribedByRival"`, so step 3 of `applyStaffOutputsPhase` runs the BribedByRival branch (produces an outbound whisper about the player), NOT the InterceptMail branch. The forfeit happens by branch-routing, not by an explicit skip. **Vitest assertion:** a fixture starts a staff member with InterceptMail at loyalty=15 (sub-threshold), wealth<0 (underpaid), and Greedy. Tick advance fires bribery roll; assertion: post-tick the staff is `"BribedByRival"` AND no inbound courier was dropped on this tick.

  - **"Inherited-secret surface against a now-allied rival"** — P11 owns inherited secrets; P6 doesn't extend.

**Out of scope.**
- Inherited-secrets ledger across generations (P11 — survives whisper Dismissal vs durable across generations).
- Blood feuds (P11 — whisper surfacing → feud is the P11 mechanic).
- Semantic-memory whisper indexing (P17 — at P6, whispers are not embedded in any vector index; the recency-window per-pair conversation history shipped at P4 is the only LLM context).
- Rival-house bribed-staff routing (P8 — at P6, bribed-staff outbound whispers route to `INDEPENDENT_HOUSE_ID` and accumulate inert there).
- Rival-house whisper consumption / hostility derived from verified whispers about the player (P8 — at P6, whispers about the player accumulate but produce no rival reactions).
- Spymaster mail-intercept UI affordance enabling (P7 — at P6, `classifyArchetype` returns "None" so the button is always disabled).
- Forgery surfacing producing whispers (P10 — the forgery-surfaces-against-Vain mechanic doesn't emit whispers at v1).
- Persona prompt's "Other characters" cache-key extension for scene-composition variance (P11+).
- Generate-whisper-tool's `generateGrievance` companion or other tool surface additions (P15+).
- Whisper text-length capping or content moderation pass (P16 polish).
- A "Fire Staff" affordance (P15 — at P6, staff are durable until campaign end).

**Resolved decisions (§10).** Two open questions land at P6.

- **#19 — Staff espionage subsystem in v1: YES (specced).** MASTER.md §10 carries the "Resolved at P6" tag. Spec §3 "Staff Espionage (Downstairs Network)" enumerates the full subsystem; the spec's intent is clearly v1, not deferred polish. P6 ships the full subsystem: 4 baseline staff seeded on fresh state + every legacy lift, 5 assignment values, loyalty drift on underpayment, per-tick bribery roll for Greedy staff at sub-threshold loyalty, cadence-based outputs per assignment, and the Spymaster mail-intercept affordance (rule-layer complete; UI disabled until P7). Deferring would punt the "espionage pressure" tutorial that the spec describes as a load-bearing v1 design pillar — the player needs a dedicated whisper-generation lever beyond conversation synergy hits to make the espionage economy feel real.

- **#20 — Three weaponization branches simultaneously: ALL THREE (Blackmail / Scandal Sheet / Accidental Slip).** MASTER.md §10 carries the "Resolved at P6" tag. Spec §3 "Whisper Weaponization Branches" enumerates all three with distinct cost/reward profiles; shipping one at a time would force the player into a single risk-reward shape until subsequent phases add the others. The three are sized for distinct decision-tree shapes:
  - **Blackmail** = small certain cost (10 scandal), small certain reward (+20 affection on subject) — risk-averse pick.
  - **Scandal Sheet** = no scandal cost, large damage to subject's house (-30 reputation), but 15% chance of self-exile (terminal endgame) — high-risk-high-reward.
  - **Accidental Slip** = no scandal cost, slow drip damage (-2 reputation per conversation × 5) requiring 5 conversations to fully land — patient/relationship-bound pick.
  Without all three, the player has only one tactical shape for spending whispers. The spec's intent of "three meaningful choices replacing a single opaque weaponize state" is satisfied only by shipping all three.

**Spec refs.** §3 "Espionage & Whisper Ledger", "Whisper Weaponization Branches", "Staff Espionage", "Stance Modifiers" (Wallflower bonus whisper); §4 "Whisper" entity, "Courier Payload" entity, "Staff Member" entity, "House.exiled flag added at P6"; §7 "Conversation history orphan keys", "Rival-house associated-character pruning" (deferred to P8), "Staff bribery while assigned to mail interception", "Inherited-secret surface against a now-allied rival" (deferred to P11); §8 "Save serialization synchronous, no UI stall" (V7 schema parse remains synchronous), "30-run replay stability" (whisper/courier/staff phases extend the replay-harness verification).

**Key rules / constants pinned.**
- Whisper verification: +10/tick toward threshold 100 (10 ticks of in-house presence verifies a whisper).
- Whisper-from-synergy: keys on the synergy-hit condition (`outcome.kind === "Normal" AND outcome.synergy === true`); spec §3 line 299 — NOT on post-modulation affection sign.
- Wallflower-bonus whisper: ONLY fires on SlyGossip + synergy hit (per spec §3 line 304); subject = lex-smallest non-target living NPC.
- Bribed staff IMMEDIATELY cease outbound player-loyal outputs; next mail-interception slot forfeit (handled implicitly via assignment branch routing).
- Scandal Sheet attribution: 15% per publication; on attribution, `house.exiled = true` AND `PlayerExiled` event fires → terminal endgame.

**State machines added (§5.2 catalog extension).**
| Machine | States | Triggers |
|---|---|---|
| Whisper | Unverified → Verified \| (Dismissed via death-cascade) → Weaponized \| Dismissed (player-elected) | Verification tick threshold; player action; subject death |
| CourierPayload | InFlight → Delivered \| Intercepted \| Cancelled | Arrival tick; InterceptMail cadence; Spymaster action; source-character cancellation (future P8) |
| Staff loyalty / assignment | Loyal(assignment) → BribedByRival; assignment freely transitions among `Snoop / BribeDriver / InterceptMail / None` via player action | Per-tick loyalty drift; bribery roll; player reassignment |

Add these to MASTER.md §5.2 catalog in the P6 closeout.

**Edge cases (§7).**
- **"Conversation history orphan keys"** — extended at P6 to dismiss whispers about dead subjects (status flip, not delete). Vitest: kill an NPC; assert all Unverified/Verified whispers about that NPC flip to Dismissed; already-Weaponized whispers stay Weaponized.
- **"Staff bribery while assigned to mail interception"** — automatic via assignment-branch routing in `applyStaffOutputsPhase` step 3. Vitest: seed a staff member with `assignment: "InterceptMail"`, loyalty=15, Greedy, owner wealth=-50; advance one tick; assert assignment flipped to `"BribedByRival"` AND no inbound courier dropped on this tick.
- **"Inherited-secret surface against a now-allied rival"** (P11) — at P6 the whisper status is preserved for P11's inherited-secrets ledger to consume on succession.
- **"Rival-house associated-character pruning"** (P8) — at P6 the helper is wired to accept future expansion but doesn't walk a rival-character list yet.
- **NEW at P6: "Source character dies between courier start and courier arrival"** — courier still delivers; whisper still arrives at the destination's ledger; UI shows "from the late <name>". The whisper's `sourceCharacterId` still points to a now-`alive: false` character in `state.characters` (per "characters never deleted"). Vitest: start a courier from NPC X at tick=5 with arrivalTick=10; kill X at tick=7; advance to tick=10; assert courier flipped to Delivered AND whisper.arrivedAtTick=10 AND whisper.sourceCharacterId still points to X (now dead).
- **NEW at P6: "Bribed-staff outbound whisper arrives at Independent (no rivals at v1)"** — the whisper accumulates in Independent's ledger and does nothing. P8 extends consumption. Vitest: trigger a bribed-staff cadence; assert one outbound courier created with `destinationHouseId === INDEPENDENT_HOUSE_ID`; advance through the courier's transit; assert delivery happens without error and the whisper arrives at Independent. (No effect on player state.)
- **NEW at P6: "Weaponize a whisper whose subject just died"** — the `SubjectIsDead` rejection fires (validation step 4). UI surfaces "Cannot weaponize: subject deceased". The whisper itself stays Verified (NOT auto-dismissed by the weaponization rejection; the orphan-prune cascade will dismiss it on the next tick-advance via the death-cascade extension above, IF the death just happened on the current tick).
- **NEW at P6: "Scandal Sheet attribution endgame"** — `house.exiled = true` triggers terminal endgame. UI: the `<TopBar />` renders a "House Exiled — Campaign Ended" banner; the strategy map becomes read-only (no actions enabled); the player may start a new campaign via the Settings menu. **No automatic save mutation at exile** — the save persists in the Exiled state; loading the save reopens the read-only end-state. P14's ledger will render an "End of Campaign" page summarizing the run; at P6 the read-only banner is sufficient. Vitest: weaponize a Verified whisper as ScandalSheet with a deterministic RNG state that triggers attribution; assert `state.houses.get(PLAYER_HOUSE_ID).exiled === true` AND `PlayerExiled` event fires.

  **Exile enforcement at the rule-layer boundary (resolves B7 — LOAD-BEARING).** UI-only enforcement (CSS `pointer-events: none` or a hidden action button) is INSUFFICIENT — the rule layer must reject all player-elected mutations when `state.houses.get(PLAYER_HOUSE_ID).exiled === true`. Otherwise a future UI bug, programmatic test path, or third-party scripted client could continue advancing the campaign past the terminal state, corrupting the save. **PINNED enforcement strategy: option (a) per-action gate** — every player-elected store action checks exile at the TOP of its body, BEFORE any pure-rule call or `set` invocation. This matches CLAUDE.md non-negotiable §5 "atomic gating" — validation precedes resource deduction. Option (b) "single orchestrator gate" was considered + rejected because it doesn't cover free-action store wrappers (startScheme, cancelScheme, weaponizeWhisper, dismissWhisper, assignStaff, spymasterIntercept) that don't go through `advanceTickPure`.

  **Affected store actions (the FULL list — every player-elected MUTATION action MUST gate):** `advanceTick`, `runYearPass`, `travel`, `requestAudience`, `escapeBankruptcy`, `refreshWardrobe`, `enterBallroom`, `startScheme`, `cancelScheme`, `weaponizeWhisper` (NEW at P6), `dismissWhisper` (NEW at P6), `assignStaff` (NEW at P6), `spymasterIntercept` (NEW at P6).

  **EXEMPT actions (per-action rationale):**
  - **`replaceState`** — load path; intentionally restores any saved state including exiled saves (so the player can revisit the read-only endgame from disk).
  - **`sendBallroomMessage`** — resolves B1 from C4 iter 7. Cannot share the `{ok, reason: {kind: ...}}` gate shape because its rejection union is `ConversationFailure` (verified at `src/game/conversation/types.ts:67-72`), which uses a `reason: "timeout" | "network" | "schema" | "missing-key" | "cancelled"` STRING discriminator — fundamentally incompatible with the `{kind}` object discriminator pattern used by every other rejection union. Extending `ConversationFailure` with `| { reason: "exiled" }` would conflict with the existing 5-variant string discriminator semantics (the strings represent LLM-side failures, not gameplay-side rejections). **Resolution: gate at `enterBallroom` only.** If `enterBallroom` rejects with `PlayerExiled`, no ballroom session opens → no `sendBallroomMessage` can be dispatched (the UI doesn't expose the send affordance without an active session). The `sendBallroomMessage` action body adds NO exile gate — it relies on the upstream `enterBallroom` gate. Edge case: a ballroom session opened pre-exile (player conversing when ScandalSheet attribution fires from a same-tick weaponization) continues until the player closes it — semantically correct; the player can finish the conversation but no NEW gameplay-mutating actions land. Vitest: open ballroom session, fire attribution mid-session via a separate code path, verify subsequent `sendBallroomMessage` calls in the SAME session still execute (no gate on send) but other gated actions (e.g., `travel`) reject.
  - **`exitBallroom`** — cleanup action, not new-mutation. Player must close session even mid-attribution. NOT gated.
  - **`abortBallroomRequest`** — cleanup action, same rationale. NOT gated.

  **Literal gate shape (applies to every gated action):**
  ```ts
  // Top of every gated store-action body, BEFORE any pure-rule call:
  const exileGate = get();
  if (exileGate.houses.get(PLAYER_HOUSE_ID)?.exiled === true) {
    return { ok: false, reason: { kind: "PlayerExiled" } };
  }
  // ... rest of action body unchanged ...
  ```
  For actions that don't return `{ok, reason}` (e.g., `runYearPass: () => void`, `exitBallroom: (playerComposureAtExit: number) => void`, `abortBallroomRequest: () => void`), the gate short-circuits to a silent no-op AND publishes a `PlayerExileBlocked { action: "runYearPass" }` event via `whisperBus` for debug-trace visibility. Literal gate body for void-returning actions:
  ```ts
  // src/game/store.ts: every void-returning gated action AFTER P6:
  runYearPass: () => {
    const exileGate = get();
    if (exileGate.houses.get(PLAYER_HOUSE_ID)?.exiled === true) {
      whisperBus.publish({ kind: "PlayerExileBlocked", tick: exileGate.tick, action: "runYearPass" });
      return;
    }
    // ... rest of existing P5 body unchanged ...
  },
  // exitBallroom + abortBallroomRequest are EXEMPT per the rationale below
  // (cleanup actions, not new-mutation actions). Listed here for completeness:
  // exitBallroom: NOT gated — must close in-flight session even mid-attribution.
  // abortBallroomRequest: NOT gated — same cleanup rationale.
  ```

  **`PlayerExileBlocked` variant — declared in the canonical `WhisperEvent` union** at the `src/runtime/events/whispers.ts` section above (single source of truth — resolves B1 from C6 iter 2). The variant signature is `| { kind: "PlayerExileBlocked"; tick: number; action: string }`. **DO NOT re-declare it here.** All 11 `WhisperEvent` variants — including `PlayerExileBlocked` — live in that one canonical declaration; this exile-gate section only USES the variant via `whisperBus.publish({ kind: "PlayerExileBlocked", ... })`. The earlier plan-draft re-declared the union here and the two declarations diverged (this section had 11 variants, the canonical had 10) — resolved by hoisting to the canonical site exclusively.

  **Rejection-union extension:** every existing rejection union for the gated actions adds a `| { kind: "PlayerExiled" }` variant. Specifically:
  - `TravelRejection` (P3), `EscapeRejection` (P3), `WardrobeRejection` (P3) extend with `PlayerExiled`.
  - `StartSchemeRejection` (P5), `CancelSchemeRejection` (P5) extend with `PlayerExiled`.
  - `WeaponizeWhisperRejection`, `DismissWhisperRejection`, `AssignStaffRejection`, `SpymasterInterceptRejection` (NEW at P6) include `PlayerExiled` in their initial definition.
  - `BallEntryRejection` (P4) extends with `PlayerExiled`.
  - `AudienceOutcome` (P3) gains a `PlayerExiled` reason via extending the underlying `AudienceRejection` union. **Literal edit at `src/game/rules/monarchsAudience.ts:24-27` (resolves B1 from C4 iter 6 — LOAD-BEARING; corrects payload preservation from C4 iter 7 R1):** verified BEFORE state at `monarchsAudience.ts:24-27`:
    ```ts
    // src/game/rules/monarchsAudience.ts:24-27 BEFORE (verbatim — P3 state):
    export type AudienceRejection =
      | { kind: "WrongLocation"; current: LocationId }
      | { kind: "InsufficientReputation"; reputation: number; required: number }
      | { kind: "CooldownActive"; lastAttemptTick: number; ticksUntilAvailable: number };

    // src/game/rules/monarchsAudience.ts:24-28 AFTER (P6 — single new variant; existing payloads preserved verbatim):
    export type AudienceRejection =
      | { kind: "WrongLocation"; current: LocationId }
      | { kind: "InsufficientReputation"; reputation: number; required: number }
      | { kind: "CooldownActive"; lastAttemptTick: number; ticksUntilAvailable: number }
      | { kind: "PlayerExiled" };                                  // NEW at P6
    ```
    **CRITICAL:** the existing three variants' payloads (`current: LocationId`, `reputation/required: number`, `lastAttemptTick/ticksUntilAvailable: number`) MUST be preserved verbatim. The earlier-draft "BEFORE" snippet in this section drafted shorter payloads and would have regressed every existing field on implementation; the corrected BEFORE/AFTER above is the authoritative pair.
    The gated `requestAudience` body returns `{ outcome: { kind: "Denied", reason: { kind: "PlayerExiled" } } }`. Literal action body (resolves shape-mismatch with the generic `{ok, reason}` gate snippet above):
    ```ts
    // src/game/store.ts: requestAudience action AFTER P6 exile gate:
    requestAudience: () => {
      const stateBefore = get();
      // P6 exile gate: returns AudienceOutcome shape, not {ok, reason}.
      if (stateBefore.houses.get(PLAYER_HOUSE_ID)?.exiled === true) {
        const outcome: AudienceOutcome = { kind: "Denied", reason: { kind: "PlayerExiled" } };
        locationBus.publish({
          kind: "RequestedAudience",
          tick: stateBefore.tick,
          houseId: PLAYER_HOUSE_ID,
          outcome,
        });
        return { outcome };
      }
      // ... rest of existing P3 body unchanged ...
    },
    ```

  **Vitest coverage (extends "Whisper rules" target):** for each gated action, fixture: deterministic exile via ScandalSheet attribution, then attempt each action, assert all return `PlayerExiled` rejection (or no-op + `PlayerExileBlocked` event); assert `replaceState` to a non-exiled save SUCCESSFULLY restores playable state (exempt-from-gate verified).

  **`exitBallroom` and `abortBallroomRequest` semantics under exile:** these are "exit / cleanup" actions, not new-mutation actions. Pin them to NOT gate on exile — the player must be able to close an in-flight ballroom session even after attribution fires mid-conversation. The session cleanup is a no-op on the gameplay state; only `sendBallroomMessage` (the mutation entry) is gated.

**Verification.**
- **`pnpm test`** — all Vitest suites pass; deterministic replay harness produces identical hashes across 30 runs (extend `src/game/replay-harness.test.ts` with a fixture seed that includes staff bribery, whisper synergy, and weaponization to exercise the new draw paths). **Mock SDK re-baseline gate** (resolves B1 from C4): the persona prompt extension (`src/llm/prompts/persona.ts`) mutates the canonical-format string that the mock SDK hashes for deterministic responses. The 30-run identical-hash NFR MUST re-pass against the new mock SDK fixtures after the persona format edit. The fixture-update step is part of P6 close-out — see "Replay-harness re-baseline gate" section above for the four-step coordinated update.
- **Vitest coverage targets:**
  - Whisper rules: per-branch weaponization outcomes (Blackmail / Scandal Sheet / Accidental Slip); attribution RNG seeded fixtures (assert deterministic attribution outcomes); orphan-prune death cascade (subject-dies-during-Unverified, subject-dies-during-Verified, subject-dies-during-Weaponized: only first two flip status); LLM-additive whisper ingest (valid + invalid + same-as-target subjectCharacterId paths).
  - Staff rules: loyalty drift over 100-tick simulation with wealth<0; bribery probability convergence (fixture seed advances 1000 simulated underpaid Greedy staff; assert observed bribery fraction within 5% of `STAFF_BRIBERY_PROBABILITY_BASE`); each assignment's cadence output (Snoop / BribeDriver / InterceptMail / BribedByRival fire at the expected tick counts); InterceptMail forfeit on same-tick bribery flip.
  - Courier rules: transit reproducibility (`applyCourierDrainStep` produces deterministic delivery order across replays); intercept removes from in-flight set; source-character death does NOT cancel courier.
  - Migration: `migrate_v6_to_v7` idempotence; full-chain `v1-to-v7-chain.test.ts` parity assertion.
  - Schema: `schema-projection-selector-extension.test.ts` passes with three new top-level GameState keys; `hashable-state-extension.test.ts` passes.
  - Event bus: `publishWhisperTransitions` skip-rule prevents double-publish when wrappers also publish; verified by setting a counting subscriber on `WhisperWeaponized` and asserting count === 1 after a single `weaponizeWhisper` call.
- **`pnpm lint`** — Biome clean; boundary-rule clean. `eslint-plugin-boundaries` should not need extension at P6 (all new files fall under existing elements: `game-rules`, `game-fixtures`, `game-entities`, `runtime`, `ui`, `persist`).
- **`pnpm typecheck`** — strict TS clean. New branded ids (`WhisperId`, `CourierPayloadId`, `StaffId`) and their schemas all compile clean against the in-memory + save-format schema duals.
- **UI golden path (manual via dev server):**
  - Start a fresh campaign; trigger a SlyGossip synergy hit; assert a Whisper toast appears AND a courier appears in the (debug-only) Whisper ledger panel.
  - Wait through transit ticks until arrival; assert the whisper appears in the player's Whisper ledger as Unverified.
  - Wait through 10 ticks; assert verification completes.
  - Weaponize as Blackmail; assert subject's affection ledger entry increases by 20; player scandal increases by 10.
  - Replay with seeded fixture: weaponize as ScandalSheet (deterministic attribution=true); assert `house.exiled=true` banner appears and map becomes read-only.
  - Assign a staff member to Snoop; wait through 8-tick cadence; assert one new outbound courier appears.
  - Manually set staff loyalty to 10 + wealth to -100 (via debug action OR by ticking through a long bankrupt run); assert bribery roll fires within a few ticks (deterministic per seed); assert the bribed staff produces an outbound whisper to Independent on next cadence.
- **LLM-touching changes:** exercise all four failure paths (timeout / network / schema / missing key) against the widened `generateWhisper` toolCall response. A failed conversation MUST NOT advance the tick AND MUST NOT ingest any whispers (the toolCalls field is only consumed on the success path).

**Close out.** When the gates and verification items above are green, run `/close-phase P6` to update phase status in `plans/MASTER.md` §6, append to `plans/SESSION-NOTES.md`, resolve OQ #19 + #20 in `plans/MASTER.md` §10, apply any `CLAUDE.md` additions (notably: the death-cascade contract now includes whispers; the LLM tool surface has two declarations; bribed-staff outbound destination is `INDEPENDENT_HOUSE_ID` at P6 and shifts at P8), and commit the changes (no push).

## Accumulated Risks & Suggestions

*Passively collected from review cycles. Not blockers. Triaged at convergence.*

- [C1] New `toSaveV6` strip site is mechanical but unscripted — recommend showing the literal 3-line edit at `schema.ts:518` (mirror `stripGrievancesForLegacyEmit` shape)
- [C1] Greedy-only bribery diverges from spec silence — add `[Deliberate divergence]` annotation so future-phase implementers don't "fix" it
- [C1] Persona prompt token-budget regression isn't gated — ship a `expect(personaPromptLength).toBeLessThan(1500)` Vitest assertion before P11 sibling-rivals + P15 dynasty perks drift the size
- [C1] AccidentalSlip drip mutation's atomicity with combat-outcome set body is undefined — pin whether to thread via `overwriteFromGameState` or to call the drip rule BEFORE the set body [likely addressed]
- [C1] Whisper text template home is unpinned — pin whether `${subjectName} from ${sourceName}` template lives in `rules/whispers.ts`, `constants.ts`, or `fixtures/whisperTemplates.ts`
- [C1] INDEPENDENT_HOUSE_ID's currentLocation dependency for bribed-staff transit cost isn't called out — cite `src/game/fixtures/npcs.ts:80` (`currentLocation: "Capital"`) so future Independent moves don't shift transit silently
- [C1] `lastOutputTick` update rule for None-vs-no-op is inconsistent across bullets — recommend explicit one-line branch table inside the cadence bullet
- [C1] Off-by-one risk in verification ordering — pin a Vitest assertion `expect(whisperAfterTick.verificationProgress).toBe(0)` for a whisper whose courier arrives on the exact tick verify runs
- [C1] Spymaster Vitest fixtures must bypass `classifyArchetype` — explicitly hand-construct the character object so succession re-runs don't reset the archetype
- [C1] Suggestion: promote the publisher discipline matrix to the canonical reference; add explicit "extend on every phase that adds whisper/courier/staff status flips" tail
- [C1] Suggestion: specify whether `v1-to-v7-chain.test.ts` REPLACES or ADDS-TO `v1-to-v6-chain.test.ts` (P5 used REPLACE)
- [C1] Suggestion: extract a single `assertEnumCardinality(WHISPER_STATUSES, 4, "whisper status enum")` helper instead of six repeated `if (X.length !== N) throw` blocks
- [C1] Suggestion: add a Campaign-level state machine to MASTER.md §5.2 catalog for the "exile → read-only" terminal state
- [C1] Suggestion: cross-reference forgery-out-of-scope item points to P10 which doesn't have a plan yet — surface as forward-declaration
- [C1] Suggestion: `makeWhisperId`'s O(N) walk across `state.whispers.values()` becomes a hot path at scale — either pin a per-tick whisper-creation-count cache or explicitly accept the cost
- [C1] Suggestion: mirror the explicit PRNG-draw-budget table from `tryWeaponizeWhisper` inside `applyStaffOutputsPhase` step 2/3
- [C1] `toSaveV6` strip site at `schema.ts:518` still lacks a literal BEFORE/AFTER snippet — only the [C1] acknowledgement exists
- [C1] `applyCourierAndStaffPhase`'s bribery roll's per-house RNG advance interaction with the future P8 rivals-action-roll phase (slot 8) draw-budget contract is unpinned
- [C1] `PHASES` array literal edit matches current source shape — verified, no action; left for reviewer rationale tracking
- [C1] `sendBallroomMessage`'s new diff-helper call should explicitly state that `publishWhisperTransitions` does NOT walk reputation deltas (the wrapper's responsibility to NOT emit a generic "reputation changed" event is implicit)
- [C1] Close-out step says "resolve OQ #19 + #20 in MASTER.md §10" — implementer should verify those entries still exist as Open before reordering steps (already resolved at plan-write time)
- [C1] Whisper text template `${subjectName} from ${sourceName}` home is acknowledged but not pinned — inline-in-`rules/whispers.ts` recommended at v1
- [C1] Six `XYZ.length !== N` module-load assertion blocks duplicate pattern — recommend explicit pin (extract helper OR accept the duplication) so implementer doesn't agonize
- [C1] `pruneOrphanedConversationKeys` whisper extension verified additive — no action
- [C1] Suggestion: promote `applyStaffOutputsPhase` "loop + clone + RNG-write-back" accumulator pattern to CLAUDE.md as canonical shape
- [C1] Suggestion: promote publisher discipline matrix to CLAUDE.md verbatim for future-phase implementers
- [C1] Suggestion: CLAUDE.md one-liner on the save-version-bump cutover pattern (5-site `__buildSaveVNForTests` rename verified mechanical)
- [C1] Suggestion: `WhisperToast` test coverage either pinned or explicitly marked "no test at v1; polish in P14"
- [C1] Suggestion: "No per-tick loyalty event" decision belongs in MASTER.md or CLAUDE.md so future implementer doesn't add `StaffLoyaltyChanged` and break the invariant
- [C1] Suggestion: Campaign-level state machine entry to MASTER.md §5.2 catalog for the exile terminal state
- [C1] Strip helper rename direction (`stripGrievancesForLegacyEmit` → `stripExiledForLegacyEmit`, `stripV6FieldsForLegacyEmit` → `stripV7FieldsForV4Pre`) not pinned as old→new mapping; implementer can't grep-discover renames from current `schema.ts:101-110`
- [C1] `__buildSaveV6ForTests` rename enumerates 5 line-pinned `main.tsx` sites — line numbers verified against current 66-line file but pinning by line is fragile; grep audit (line 265) is the truth source
- [C1] Bare cores `fromSaveV1Bare..fromSaveV5Bare` default `staff: new Map()`; the migration runner's per-step Zod parse briefly observes empty-staff state — verify no SaveVN schema requires non-empty staff
- [C1] Suggestion: add one line to publisher discipline matrix explicitly stating `publishWhisperTransitions` does NOT walk reputation/scandal/composure deltas (owned by the originating wrapper)
- [C1] Suggestion: promote the triple-strip pattern to a CLAUDE.md one-liner about save-version cutover strip-helper renaming
- [C1] Suggestion: CLAUDE.md addendum after P6 close-out: "save-version bumps require auditing the strip-helper cascade across all `toSaveV{N}` legacy emitters, not just live-adjacent ones"
- [C2] `applyStaffOutputsPhase` step 3 cadence-gating predicate is literally `staff.assignment !== "BribedByRival" || staff.assignment === "BribedByRival"` — vacuously true. The intended predicate is `staff.assignment !== "None"` (with BribedByRival branching INSIDE step 3 to the bribed-cadence output). Mechanical fix in plan body. [likely addressed]
- [C2] Persona prompt "Other characters in this scene" addition mutates the canonical-format string at `src/llm/prompts/persona.ts` whose hash drives the mock SDK's request canonicalization — must be coordinated with the mock SDK update AND exercised by the replay-harness 30-run identical-hash invariant before P6 ships. [likely addressed]
- [C2] `runYearPass`-doesn't-touch-whispers invariant is incorrect: `pruneOrphanedConversationKeys` (called from `applyAgingStep` inside `runYearPassPure`) DOES flip whispers to Dismissed when a character dies during year-pass. Either drop the `expect(runYearPassPure(state).whispers).toBe(state.whispers)` invariant or conditionally call `publishWhisperTransitions` from `runYearPass`'s wrapper to publish the auto-Dismissed events. [likely addressed]
- [C2] Snoop courier `originLocation` resolution unpinned when the player head is away from Capital — pick (a) Capital constant per spec "staff don't travel", (b) head's currentLocation, or (c) the Snoop's location (which always reads as Capital at v1).
- [C2] Spymaster intercept validation ordering (NoLivingSpymaster vs InsufficientWealth vs NoEligibleCourier) not pinned as first-fail-wins; mirror P5's `tryStartScheme` ordering rationale.
- [C2] Strip-helper rename direction needs explicit "old name retired" enumeration so the dead-code grep audit catches stragglers (P6 plan body says "Old name retired" for two but doesn't pin a `rg 'stripGrievancesForLegacyEmit\|stripV6FieldsForLegacyEmit' src/` expects-zero-hits assertion).
- [C2] Suggestion: triage the C1/C2 tail with `[folded into <section>]`/`[deferred to <phase>]`/`[still-open]` tags per the cross-plan pattern — currently 31+ items without explicit disposition.
- [C2] Suggestion: enumerate `import { publishWhisperTransitions, whisperBus } from "../runtime/events/whispers";` add to `store.ts`'s import block, mirroring the existing `schemeBus` import at `store.ts:172`.
- [C2] Suggestion: pin `_id` destructure style in the inlined Immer slip-drip block — Biome may flag unused; either use `for (const w of state.whispers.values())` or disable inline.
- [C2] Suggestion: Vitest assertion that bootstrap callcount is unchanged after seedStartingFamily returns staff (the `drawInt` for player deathAge at `bootstrap.ts:36` is the only baseline draw; staff seeding must NOT introduce additional draws).
- [C2] Suggestion: `generateWhisperCourier`'s `interceptable` flag write-site discipline — pin "interceptable = direction === 'Inbound'" in the rule body.
- [C2] `spymasterIntercept` wealth deduction must be after the full validation chain (including `NoEligibleCourier`) — pin atomic-gating ordering in the validator body so a partial-deduct-then-reject path is structurally impossible.
- [C2] `_id` destructure style is inconsistent between the slip-drip Immer block (line 519, `[_id, w]`) and the orphan-prune helper (line 1008, `[id, w]`); pin a single convention (recommend `for (const w of state.whispers.values())` everywhere unused-id form is wanted).
- [C2] Suggestion: extract the `runYearPass` row's invariant-set into a separate pinned-assertion list block — the cell now carries multiple conditional Vitest assertions that read poorly inside a table.
- [C2] `applyStaffOutputsPhase` step 4 lastOutputTick rule: pin "lastOutputTick updates whenever step 3 was reached (any assignment !== None), regardless of whether the cadence produced a deliverable" so Snoop/InterceptMail/BribedByRival no-ops match the BribeDriver "punch the clock" semantics already pinned at line 572.
- [C2] `publishWhisperTransitions` skip-rule prose conflates two Dismissed paths: the cascade-path `Unverified→Dismissed` (from `pruneOrphanedConversationKeys` on character death) is NEVER skipped (no wrapper publishes it), while the player-elected `Verified→Dismissed` IS skipped via `wrapperPublishedKeys.has("dismiss:" + whisperId)`. Pin the asymmetry explicitly in the helper's body.
- [C2] `PlayerExileBlocked` event variant is introduced inline at the exile-gate section but not added to the canonical `WhisperEvent` discriminated union at the bus declaration — exhaustiveness checks on `WhisperEvent` will fail to handle it. Add to the union. [applied]
- [C3] Exile gate's literal `{ ok: false, reason: { kind: "PlayerExiled" } }` snippet is incompatible with `requestAudience: () => { outcome: AudienceOutcome }` shape — plan needs a literal snippet showing what the gated `requestAudience` body returns (`{ outcome: { kind: "Denied", reason: { kind: "PlayerExiled" } } }`), AND must show the matching `AudienceOutcome.Denied` reason-union extension at the type declaration in `src/game/rules/monarchsAudience.ts`.
- [C3] `assignStaff` resets `lastOutputTick = null` — cadence check `state.tick - (staff.lastOutputTick ?? -cadence) >= cadence` evaluates true at every tick under `null`, so reassignment fires output on tick T+1 not T+cadence. Either pin "intentional — reassignment grants immediate next-tick output" OR pin `lastOutputTick = state.tick` so the cadence starts over from now. [likely addressed]
- [C3] `__buildSaveV7ForTests` (renamed from V6) helper's type parameter `currentLocation?: string` at `main.tsx:30` uses untyped `string` even though `LocationId` is branded at P3 — recommend tightening to `LocationId` brand as part of the V7 rename pass.
- [C3] Legacy SaveV1Schema..SaveV6Schema bodies do NOT add `whispers`/`couriers`/`staff` tuples — only SaveV7Schema carries them (verified). Plan should explicitly assert that legacy save schemas remain unchanged at the schema level AND that their corresponding `toSaveV{N}` emitters strip these three new fields (mirror the `stripExiledForLegacyEmit` pattern for the three new Map fields). Without this, post-P6 round-trip via `toSaveV6` of a state with non-empty staff/whispers/couriers would silently drop them OR fail schema parse.
- [C3] Suggestion: pin a deterministic fixture seed string in the 30-run replay-harness extension that demonstrably exercises staff bribery + whisper synergy + weaponization within a bounded tick range.
- [C3] `AudienceRejection` union at `src/game/rules/monarchsAudience.ts:29` is currently `WrongLocation | InsufficientReputation`; the exile-gate's `AudienceOutcome.Denied → reason: PlayerExiled` requires extending THIS specific union, not introducing a new top-level variant. Pin the literal union extension at the type declaration.
- [C3] `fromSaveV6Bare` export discipline (mirroring P5's `fromSaveV5Bare` exported at `schema.ts:472`): if shipped as private, the migration runner runs the seed helper twice and the idempotence assertion only hides the bug because of the size-check branch in `seedWhispersCouriersStaffIntoLegacyState`. Pin export as REQUIRED, not optional.
- [C3] Add `// PINNED: house-membership, not literal-id-equals` comment on the `SubjectIsSelf` branch in `tryWeaponizeWhisper`'s rules-layer body so future-phase implementers don't copy-paste P5's literal-owner-equals-target gating pattern over the v1 semantic.
- [C3] Suggestion: replay-harness 30-run identical-hash NFR must re-pass AFTER the persona-prompt "Other characters in this scene" extension lands — pin as a Verification gate before P6 ships. [applied]
- [C3] Suggestion: short pin in the publishWhisperTransitions helper body explicitly stating cascade-path Unverified→Dismissed is NEVER skipped while player-elected Verified→Dismissed IS skipped (asymmetry currently only documented in the C2 tail).
- [C4] `tryWeaponizeWhisper` validation ordering puts `SubjectIsDead` before `SubjectIsSelf` — pin which fires when subject is both dead AND in player's house (recommend SubjectIsDead first since it's a stronger condition; corpses can't be either weaponized OR self-targeted).
- [C4] `seedStartingFamily` return shape change to add `staff` field needs a literal diff against `bootstrap.ts:27-31` AND a literal update to every `createInitialState` for-loop consumption site at `store.ts:81-114`.
- [C4] `STAFF_BRIBERY_PROBABILITY_BASE = 0.05` doesn't pin `drawNext`'s return-type convention (float [0,1) vs int-in-range) at the comparison site — add a one-line inline comment `// drawNext returns float in [0,1); compare with probability`.
- [C4] `BASELINE_STAFF` insertion order vs `serializeRegistry`'s lex-sort: hash-equivalence between fresh-state and migration paths depends on lex order matching insertion. The chosen ids (greer/mrs-hudson/pell/thompson) lex-sort differently from insertion order — Vitest must assert hash equivalence via a fixture that exercises both paths.
- [C4] `WhisperToast` dedup behavior: without dedup, 3 toasts can fire in 3s for a single message (synergy + wallflower-bonus + LLM-additive) — pin dedup discipline OR explicit "v1 ships sequential toasts, polish in P14".
- [C4] Suggestion: remove the stale `[C2]` "vacuously true predicate" tail item since the body is now fixed at line 570 (B6 closure).
- [C4] Suggestion: pin `__buildSaveV6ForTests` whole-repo grep audit (`rg '__buildSaveV6' .`) expects-zero post-rename rather than line-number-pinning the 5 sites in main.tsx.
- [C4] `_id` destructure inconsistency between inlined Immer slip-drip block (`[_id, w]` at line 521) and orphan-prune helper (`[id, w]` at line 1205); Biome's `noUnusedVariables: "error"` (biome.json:32) will flag. Pin one style (recommend `for (const w of state.whispers.values())`).
- [C4] Stale tail cleanup: the [C2] "vacuously true predicate" item is still listed as `[likely addressed]` but body fix is in place at line 595 — convert to `[applied]` or remove during final triage.
- [C5] `ingestLlmAdditiveWhisper` call-site shape inside `sendBallroomMessage`'s set body is not enumerated with the literal `acc`-shape composition like the slip-drip block is — pin parallel literal snippet so implementer knows where in the producer the ingest call lives. [applied]
- [C5] Suggestion: convert `applyStaffOutputsPhase` PRNG-draw-budget from prose into a tabular reference matching `tryWeaponizeWhisper`'s style at line 508.
- [C6] BribeDriver subject-selection prose ("the player's most-recent travel target's NPC") diverges from the code expression (`state.houses.get(PLAYER_HOUSE_ID).currentLocation`) — pick one (recommend "character at the player's current location" matching the code).
- [C6] `runYearPass` literal patch is embedded inside a markdown table cell with `<br>` tags + triple-backtick fences; some markdown renderers swallow the inner code fence. Consider extracting to a numbered top-level snippet outside the table.
- [C6] `overwriteFromGameState` rationale prose claims the schema-projection-selector trip-wire doesn't cover the draft-writer, but `src/game/store.replace-state.test.ts:24-44` DOES enforce per-key equality on the replaceState path (which goes through `overwriteFromGameState`). The required edits are still correct; the "fourth-surface silent-fail" framing is slightly overstated.
- [C6] Step 3 (per-assignment switch) and step 4 (lastOutputTick update) of `applyStaffOutputsPhase` both encode None-skip logic separately — consider collapsing into a single decision table for clarity.
- [C6] Suggestion: pin `publishWhisperTransitions` cascade-path vs player-path Dismissed asymmetry as inline `// PINNED` comment in the helper body so future implementers don't "fix" the asymmetry.
- [C6] Suggestion: pin inline assertion or comment in BribedByRival branch that `INDEPENDENT_HOUSE_ID.currentLocation === "Capital"` — if a future Independent NPC moves, bribed-staff transit cost shifts silently.

---

**Final-cycle (C9) advisory triage results:**

- [C9-R1] `applyStaffOutputsPhase` accumulator mixes in-place `acc.staff.set(...)` and spread-clone `acc = { ...acc, rng: ... }` styles. Both correct; implementer can pick one style and apply uniformly. `[note for implementer]`
- [C9-R2] `conversationOrchestrator.send` 3rd-callsite enumeration for `getOrCreatePersonaCache`'s 5th arg. `[applied]` — literal BEFORE/AFTER added at the `conversationOrchestrator.ts:90-95` site under the persona prompt extension section.
- [C9-R3] `PERSONA_CACHE_VERSION` import addition lacks a literal AFTER snippet. Mechanical edit; implementer can extend the existing import line at `cache.ts:1-10`. `[note for implementer]`
- [C9-R4] `WhisperToast` 3-toasts dedup discipline. UX risk only; pick at implementation time. `[note for implementer]`
- [C9-R5] `AssignStaffRejection` dual source of truth re `PlayerExiled` variant. `[applied]` — `PlayerExiled` variant added at the canonical declaration for `AssignStaffRejection` AND uniformly extended to `WeaponizeWhisperRejection`, `DismissWhisperRejection`, `SpymasterInterceptRejection`.
- [C9-S1] Strip-helper rename grep audit in Verification. `[note for implementer]` — one-line addition at implementation time.
- [C9-S2] Extract `assertEnumCardinality` helper. `[safe to ignore]` — duplication is mechanical and acceptable.
- [C9-S3] Triage the 87+ tail items at close-out. `[note for implementer]` — disposition is body-state-dependent.
- [C9-S4] Add Campaign exile state machine row to MASTER.md §5.2. `[note for implementer]` — polish at close-out.
- [C9-S5] "EMPTY_KEYS load-bearing" wording overstated. `[safe to ignore]` — cosmetic.
