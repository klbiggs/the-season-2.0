# P7 — Family, Marriage & Succession

> Part of [The Season Master Plan](../MASTER.md). Prior: [P6 — Whispers, Espionage & Staff](./06-whispers-espionage.md). Next: [P8 — Rival Houses, Patronesses & Duels](./08-rivals-patronesses.md).

**Goal.** Multi-generation lifecycle: marriage proposals (player-elected), parent-edged children for real heir promotion, tutor assignments with adulthood trait grants, archetype auto-classification body (replaces the P1 stub), happiness drain on Dull-spouse marriages with a one-way temptation latch, and the full succession heir path that now reaches children. Save format bumps to **v8** to carry six new fields on `Character` (`parentCharacterIds`, `happiness`, `temptationHookUnlocked`, `assignedTutorCharacterId`, `tutorBonusTraitGranted`, `dullSpouseExposureStartTick`) and three new top-level GameState entries (`proposalsLog`, `tutorAssignmentsLog`, `pendingTutorTraitChoices`). The ROLE enum extends from 4 → 7 values (adds `Spinster`, `Exile`, `Bohemian` — see Roles section). P7 REPLACES three P1 stubs with real bodies: `classifyArchetype` (`src/game/fixtures/archetypes.ts:17`), `findAdultChildren` (`src/game/rules/succession.ts:23`), and the §10 Q4 classification trigger walk. P7 ALSO adds two new pure-rule modules — `src/game/rules/proposal.ts` and `src/game/rules/happiness.ts` — and one new tick-orchestrator step at `tickOrchestrator.ts` (per-tick happiness drift step) per the Phase-order discipline contract.

This phase is the first to widen `Character` itself (every prior phase added top-level GameState fields or new entity types). Six new fields ride inside `state.characters` — they do NOT trip the top-level `Object.keys(GameStateSchema.shape)` trip-wire at `src/game/schema-projection-selector-extension.test.ts`, but they DO require: (a) every legacy lifter (`fromSaveV1Bare`..`fromSaveV7Bare`) extends its `defaultCharacterV{N}Fields` helper or adds a parallel one for V8; (b) every `toSaveV{N}` emitter (`toSaveV2`..`toSaveV7`) strips the six new fields before `serializeRegistry(state.characters)`; (c) the new fields enter the hash projection via the existing `Character`-shape sub-hash (no separate ledger entry needed — `hashableState`'s character projection captures the whole entity by Zod schema parse). The migration risk is concentrated at the strip-on-emit sites: forgetting a strip turns `migrate_v{N}_to_v{N+1}.outputSchema.parse(toSaveV{N}(...))` into a runtime failure during chain testing.

The non-determinism boundary stays firm: every new PRNG draw (proposal acceptance, child-creation deathAge already shipped at P1, archetype-bonus trait pool draw at adulthood, novel trait acquisition during maturation) is on the player's per-house RNG, advances `callCount` deterministically, and is exercised by the replay harness. Player-elected actions (proposal, tutor assignment, tutor reassignment, tutor-trait choice at maturation) follow the pre-tick action pattern (CLAUDE.md): pure rule first, then `advanceTickPure` for tick-advancing actions, or free-action wrappers for actions that do NOT advance the tick (tutor-reassignment, tutor-trait choice). Marriage proposal IS tick-advancing (consumes one tick like travel/audience); tutor-assignment is a free action (matches the P5 startScheme/cancelScheme pattern).

**In scope.**

- **Save format bump to v8.** Adds **6 new fields on `Character`** + **3 new top-level GameState entries** + **3 new ROLE enum values**. Every field is hash-relevant; every new entry has a default and a strip-on-emit. Defaults:
  - `Character.parentCharacterIds: [CharacterId, CharacterId] | null` — lex-sorted parent pair (matches the `spouseAId/spouseBId` lex-sort convention). `null` for the four baseline NPCs (`src/game/fixtures/npcs.ts:29-69`), the four baseline staff (which don't appear in `state.characters` anyway), and the player character (whose parents are pre-history). Children created via `applyConceptionStep` set this from the marriage spouses.
  - `Character.happiness: number` (clamped `[0, 100]`). Default 100 on every legacy character and on fresh-state characters.
  - `Character.temptationHookUnlocked: boolean`. One-way latch. Default false; flips true on first tick `happiness < HAPPINESS_TEMPTATION_THRESHOLD` AFTER marriage to a Dull-trait spouse. Never reverts (§10 Q23 resolution).
  - `Character.assignedTutorCharacterId: CharacterId | null`. The tutor character (must have `archetype !== "None"`); `null` if no tutor assigned. Set by the `assignTutor` action; cleared via the tutor-prune branch of `pruneOrphanedConversationKeys` on tutor death. Locked at maturation (the assign action rejects with `{ kind: "ChildAlreadyAdult" }` after `age >= ADULTHOOD_AGE_IN_YEARS`).
  - `Character.tutorBonusTraitGranted: boolean`. Default false. Flips true ONCE at child maturation, after the player picks one of the assigned-tutor archetype's 2-option trait pool via the `chooseTutorBonusTrait` action. If the child matures with no assigned tutor OR the assigned tutor is dead at maturation, this stays false permanently (no bonus trait granted).
  - `Character.dullSpouseExposureStartTick: number | null`. The tick at which this character entered a marriage to a Dull-trait spouse. **Set ONLY in the proposeMarriage acceptance branch (resolves FC2-B2 — there is no `applyMarriedConsummationStep` phase or year-pass step at P7).** When the proposal is accepted, the rule body inspects both spouses' Dull-trait status and sets `dullSpouseExposureStartTick = state.tick` on the OTHER character (the one NOT carrying Dull) — symmetric: if the player head carries Dull, the accepting spouse gets the exposure tick; if the target carries Dull, the player head gets it; mutual Dull → both get exposure ticks. `null` if not yet married to a Dull spouse OR if the Dull spouse died (the orphan-prune cascade nulls this on Dull-spouse death — happiness drain stops). Used by the happiness-drift step to gate the per-tick drain.
  - `GameState.proposalsLog: Map<CharacterId, ProposalLogEntry>` — per-character log of the most recent proposal outcome (Accepted | Rejected) against that character. Empty on fresh state and every legacy lift. NOT for replay; for ledger rendering at P14 ("Last refused you 12 ticks ago"). Hash-relevant.
  - `GameState.tutorAssignmentsLog: Map<CharacterId, TutorAssignmentLogEntry>` — per-child log of tutor assignment history (assignment tick, tutor character ID, reassignment count). Empty on fresh state and every legacy lift. Hash-relevant. Used by the wealth-cost rule: first assignment is free, every reassignment costs `TUTOR_REASSIGNMENT_WEALTH_COST`.
  - `GameState.pendingTutorTraitChoices: Map<CharacterId, PendingTutorTraitChoice>` — per-maturating-child slot recording that a tutor-trait pick is pending the player's choice. Set during the maturation step when an assigned-tutor exists; cleared by the `chooseTutorBonusTrait` action. Hash-relevant; if a campaign saves with pending choices the slot persists into the next session and the player picks then.

  **Entity Zod schemas (resolves FC2-B5 — declared in `src/game/entities.ts` next to the existing entity schemas, in the same file edit block that adds the 7 new Character fields).** All three schemas use `z.object` with explicit field types; all fields are required (defaults are applied at construction sites, not Zod-default):
  ```ts
  // src/game/entities.ts (NEW at P7):
  export const ProposalLogEntrySchema = z.object({
    outcome: z.enum(["Accepted", "Rejected"]),
    tick: z.number().int().nonnegative(),
    byCharacterId: CharacterIdSchema,   // the proposer (always player head at P7)
  });
  export type ProposalLogEntry = z.infer<typeof ProposalLogEntrySchema>;

  export const TutorAssignmentLogEntrySchema = z.object({
    tutorCharacterId: CharacterIdSchema,
    assignedAtTick: z.number().int().nonnegative(),
    reassignmentCount: z.number().int().nonnegative(),  // 0 on first assignment; +1 per reassign; gates wealth-cost (R3)
  });
  export type TutorAssignmentLogEntry = z.infer<typeof TutorAssignmentLogEntrySchema>;

  export const PendingTutorTraitChoiceSchema = z.object({
    childId: CharacterIdSchema,
    tutorId: CharacterIdSchema,
    // Narrowed from ArchetypeSchema (which allows "None") — only classifier-
    // gated archetypes can pend a trait choice (resolves FC6-1-B3 + C-fc2-29 +
    // C-fc3-12). A hand-corrupted save with `archetype: "None"` would parse
    // CLEAN against ArchetypeSchema but then crash at choose-trait time when
    // ARCHETYPE_MATURATION_TRAIT_POOL["None"] === null. The narrowed schema
    // rejects the corruption at parse time.
    archetype: z.enum(["Spymaster", "BohemianRake", "Tutor", "CountryExile"]),
    acceptableTraitIds: z.tuple([TraitIdSchema, TraitIdSchema]),   // exact 2-tuple per ARCHETYPE_MATURATION_TRAIT_POOL
    createdAtTick: z.number().int().nonnegative(),
  });
  export type PendingTutorTraitChoice = z.infer<typeof PendingTutorTraitChoiceSchema>;
  ```
  **Why `acceptableTraitIds` is `z.tuple([Trait, Trait])` not `z.array(Trait)`:** the maturation step captures a snapshot of the archetype's exactly-2-element tool pool; a `z.array` would accept any length. The tuple form is tighter and matches `ARCHETYPE_MATURATION_TRAIT_POOL`'s `readonly [TraitId, TraitId]` shape. **Snapshot semantics:** the pool snapshot is captured at maturation tick T from `ARCHETYPE_MATURATION_TRAIT_POOL`; if a future-phase tuning bumps the constant between T (save) and T+N (load), the saved entry holds the OLD tuple values. By design — players who save mid-pending-choice see the same options on resume.
  - `ROLES` enum: add `"Spinster"`, `"Exile"`, `"Bohemian"`. Pre-existing values (`HeadOfHouse`, `Heir`, `Dependent`, `Spouse`) retained; total 7. Role assignment rules in the Roles section below.

  **Why ProposalLogEntry / TutorAssignmentLogEntry / PendingTutorTraitChoice are top-level Maps (not character fields):** the entries are scoped per-character but write rarely and might be queried by the ledger view across many characters. Storing them as character-side maps lets the diff helpers (P5 pattern) compute a clean before/after walk on the relevant Map without diffing the entire characters Map. This matches the P6 precedent for `state.whispers` / `state.couriers` / `state.staff` (sibling Maps to characters, not embedded fields).

- **Schema↔projection↔selector↔overwriteFromGameState quad-sync (CLAUDE.md non-negotiable).** Three NEW top-level GameState fields (`proposalsLog`, `tutorAssignmentsLog`, `pendingTutorTraitChoices`) DO trip the keyset extension test at `src/game/schema-projection-selector-extension.test.ts` (enforces the first three surfaces). The FOURTH surface (`overwriteFromGameState`) is enforced separately by `src/game/store.replace-state.test.ts` per CLAUDE.md. Required edits to ALL FOUR surfaces:
  1. `GameStateSchema` (`src/game/entities.ts`): append three new `z.map(...)` entries.
  2. `hashableState` (`src/game/hash.ts`): extend the projection with the three new keys (serialized via `serializeRegistry` — same lex-sort discipline as existing Maps).
  3. `selectGameState` (`src/game/store.ts`): extend the selector to include the three new keys.
  4. `overwriteFromGameState` (`src/game/store.ts`): extend with `draft.proposalsLog = next.proposalsLog; draft.tutorAssignmentsLog = next.tutorAssignmentsLog; draft.pendingTutorTraitChoices = next.pendingTutorTraitChoices;`. **Forgetting this fourth surface silently CLEARS the three new Maps on every tick-advancing store action** per the CLAUDE.md `overwriteFromGameState` warning.

  **`replace-state.test.ts` extension (resolves Cycle-2 B2 — same gap that took out grievances at P5).** The existing test exercises the write-side mirror by calling a tick-advancing action and asserting state fields survive. P7 adds THREE new assertions to `replace-state.test.ts`:
  - Pre-condition: seed `state.proposalsLog` with a synthetic entry; call a tick-advancing action (e.g., `travel`); assert `next.proposalsLog.size === 1` post-action. Without the `draft.proposalsLog = next.proposalsLog` write in `overwriteFromGameState`, this assertion fails.
  - Parallel assertions for `tutorAssignmentsLog` and `pendingTutorTraitChoices` with their own synthetic seed entries.
  - Each assertion has its own `it(...)` block so a regression localizes which Map regressed.

  The 6 new `Character` fields ride inside `state.characters` and do NOT need separate keyset entries — but every consumer that walks `state.characters` and reads a sub-field needs to be aware of the widened shape. The hash projection captures characters via the existing schema-parse round-trip, so adding fields to `CharacterSchema` automatically widens the hash (no separate `hashableState` projection edit for the Character-side fields). `createInitialState` (`src/game/store.ts:81+`) must seed the 6 new fields on every character at construction time — see Bootstrap integration below.

- **ROLES enum extension (resolves B4).** Spec §3 line 491-494 keys archetype classification on `Spinster` role and `Exile` role; `fixtures/roles.ts:8`'s comment block already promises these roles "defer to P7." P7 ships them:
  ```ts
  // src/game/fixtures/roles.ts AFTER P7:
  export const ROLES = [
    "HeadOfHouse", "Heir", "Dependent", "Spouse",
    "Spinster",    // NEW at P7 — unwed adult female; classifier prereq for Spymaster archetype
    "Exile",       // NEW at P7 — adult character living outside the family seat; classifier prereq for Country Exile archetype
    "Bohemian",    // NEW at P7 — unwed adult character (typically male) living an unconventional life; classifier prereq for Bohemian Rake archetype (note: distinct from the `BohemianRake` ARCHETYPE — Role names what the character IS; Archetype names a gated capability bundle)
  ] as const;
  ```
  **Why Role and Archetype are not collapsed:** Role is the durable, slow-changing identity (HeadOfHouse / Heir / Spinster / etc.); Archetype is the derived, twice-recomputed capability bundle (Spymaster / BohemianRake / etc.). A `Spinster`-role character may classify as `Spymaster` archetype (if traits match) OR `None` archetype (if not). Spec §3 line 491 cleanly separates the two: "Spinster role + traits include any of {Cunning, Observant} → Spymaster archetype." Role and Archetype are read from the same Character entity but mean different things.

  **Role-assignment rules at P7** (load-bearing; without these, the classifier has no source-state to read):
  - **Children get `role: "Dependent"` at conception** (existing behavior at `conception.ts:152`). Unchanged at P7.
  - **At child maturation** (`age` crosses `ADULTHOOD_AGE_IN_YEARS`), the maturation step assigns a new role per:
    - If `parentCharacterIds === null` OR both parents are dead AND the character lives outside the family seat (`houseId !== PLAYER_HOUSE_ID && houseId !== INDEPENDENT_HOUSE_ID`) → `Exile`. (At P7 with no rival houses yet, this branch is effectively dead code — every character belongs to PLAYER or INDEPENDENT — and the deterministic-coverage Vitest fixture for the branch lives in `maturation.test.ts` with a synthetic non-baseline `houseId`.)
    - If `gender === "Female"` AND `marriageId === null` → `Spinster`. (Gender field is NEW at P7 — see "Gender field" below.)
    - If `gender === "Male"` AND `marriageId === null` AND `traits` includes ANY of `{Frivolous, Romantic, Jaded}` → `Bohemian`. (The trait gate is the cosmetic distinction; the classifier elevates Bohemian-role characters to `BohemianRake` archetype, but the role itself is the wider Regency category.)
    - Else → `Dependent` (unchanged from child-record default).
  - **On marriage acceptance** (proposalAccepted): the accepting character flips to `role: "Spouse"`; the proposing player heir keeps their existing role (HeadOfHouse / Heir / etc.) — marriage doesn't change the head's role. **NOTE:** a previously `Spinster` character who later marries flips to `Spouse` at proposal acceptance, not at maturation. This is a one-time flip — re-widowing (Spouse → Spinster) is NOT implemented at v1; widows stay role `Spouse` with `marriageId === null` (dissolved). The Spinster classifier path therefore ONLY reaches characters who NEVER married, not widows.
  - **On succession** (heir promotion): heir flips to `HeadOfHouse`; this overrides any prior role assignment. Existing behavior at `succession.ts:109`. Unchanged at P7.

  **Gender field on Character (NEW at P7, derived during conception/maturation):**
  ```ts
  // src/game/entities.ts (P7 addition to CharacterSchema):
  gender: z.enum(["Female", "Male"]),
  ```
  Gender is required by the role-assignment rules above (Spinster is female-only; Bohemian is male-only per Regency convention). At conception, the spouse's lex-sort and a per-house RNG draw produce a 50/50 gender split (single draw per child, after the existing 4 trait draws + the deathAge draw, so child-creation now consumes **6 draws per child** instead of P1's 5). Pre-existing characters (4 baseline NPCs, player character, baseline staff which don't matter): seeded explicitly per the `BASELINE_NPCS` fixture. The 50/50 split is intentional — siblings should freely vary; gender-skewed lifespans are a v1.5 candidate.

  **Bonus draw discipline (resolves B21 — `LIFESPAN_RANGE_SIZE` does not exist as a constant; the range is computed inline at `conception.ts:135-136` via `const range = LIFESPAN_RANGE[1] - LIFESPAN_RANGE[0] + 1; drawInt(rngState, range)`).** The 5th draw at P1 (deathAge) is the inline-computed range; P7 inserts the gender draw as the 6th draw (after deathAge). **Order matters for replay-harness call-count assertions** — the existing P1 `inheritTraits` 4-draw budget contract is preserved; the deathAge draw remains 5th; gender is 6th. **The P1 replay-harness fixture call-count expectations live in `src/game/replay-harness.test.ts` (verified path — not `src/runtime/`)** — every conception-firing test gains +1 draw per child. Audit at implementation: `rg "callCount" src/game/replay-harness.test.ts src/game/rules/conception.test.ts` will catch every assertion site that needs update. The P7 migration of legacy saves does NOT retroactively roll gender; legacy saves default gender via the seeding helper (see migrate_v7_to_v8 below).

  **Legacy gender default rule (resolves FC2-5-B1):** since legacy characters have no recorded gender, the seeding helper assigns gender deterministically by character ID hash — `state.characters.values().forEach(c => c.gender = hashCharIdToGender(c.id))`. `hashCharIdToGender` is a NEW pure helper at `src/game/fixtures/hashCharIdToGender.ts` (NOT in `rng.ts` — it MUST NOT consume PRNG; it's a deterministic non-PRNG hash). **Concrete algorithm: FNV-1a (32-bit) with the standard FNV offset basis 0x811C9DC5 and prime 0x01000193, applied byte-by-byte over the UTF-16 code units of the character ID; final mask `& 1` gives the 0|1 bit; 0 → `"Female"`, 1 → `"Male"`.**
  ```ts
  // src/game/fixtures/hashCharIdToGender.ts (NEW at P7):
  import type { CharacterId } from "../rng";
  const FNV_OFFSET_BASIS_32 = 0x811c9dc5;
  const FNV_PRIME_32 = 0x01000193;
  export function hashCharIdToGender(id: CharacterId): "Female" | "Male" {
    let hash = FNV_OFFSET_BASIS_32;
    for (let i = 0; i < id.length; i++) {
      hash ^= id.charCodeAt(i);
      hash = Math.imul(hash, FNV_PRIME_32);
    }
    return (hash & 1) === 0 ? "Female" : "Male";
  }
  ```
  **Golden-output Vitest** at `src/game/fixtures/hashCharIdToGender.test.ts` pins at least 5 expected `(id, gender)` pairs — the five legacy baseline NPC IDs (`"npc-aldridge"`, `"npc-blackwood"`, `"npc-carrington"`, `"npc-dunmore"`, `"npc-ellsworth"`) plus the player ID `STARTING_HEAD_CHARACTER_ID === "player-head"` (verified at `src/game/fixtures/names.ts:10`). The fixture's expected values are computed once at implementation time, written into the test, and CI-locked thereafter — changing the algorithm in v1.5 forces a save-version bump AND a migration that re-derives gender deterministically OR carries forward the pre-migration value. **The choice between baseline-NPC explicit gender (`BASELINE_NPCS` table) and the hash-derived gender (legacy-lift path) is intentional asymmetry**: bootstrap is fresh-state where the gender is authored; legacy-lift fabricates gender deterministically without consuming a PRNG draw. The two paths agree on baseline-NPC IDs only by coincidence (or by the bootstrap-side choice mirroring whatever `hashCharIdToGender` happens to produce for that ID — verified via the Vitest matrix; not load-bearing because the V7→V8 migration of a fresh-state-bootstrapped save uses the existing `BASELINE_NPCS` gender for those NPCs, NOT the hash).

  **NOT IN scope of the hash:** the hash is consumed ONLY at the legacy-lift seeding path. No other code path reads from `hashCharIdToGender`. A future phase that needs a derived 0/1 from a CharacterId for unrelated purposes must NOT reuse this function — adopt a separate same-shape helper to avoid cross-contamination.

  **Bootstrap-vs-legacy-lift gender parity (resolves FC3-1-B4 + FC6-1-B1 — pre-computed outputs pinned, BASELINE_NPCS.gender derived from hash).** The parity-invariant Vitest at `v1-to-v8-chain.test.ts` asserts `hashState(fromSaveV8(runMigrations(saveV1, 1, 8, MIGRATIONS))) === hashState(createInitialState(seed, ...))`. Both paths assign gender via `hashCharIdToGender(id)` — **NEITHER PATH AUTHORS GENDER INDEPENDENTLY.** The simpler approach: `buildBaselineNpcCharacter(seed)` calls `hashCharIdToGender(seed.id)` rather than reading `seed.gender`. This collapses the parity question into a single source of truth: the hash.

  **Pre-computed FNV-1a outputs for the canonical 6 IDs (verified via Node one-off execution; resolves B1's "implementer must compute" gap):**

  | ID | Hash output | Notes |
  |---|---|---|
  | `npc-aldridge` | **Male** | Lady Aldridge's name is a Regency honorific (formal address), independent of `Character.gender`. Rename to `Lord Aldridge` to match if naming consistency is desired. |
  | `npc-blackwood` | **Male** | Lord Blackwood — consistent. |
  | `npc-carrington` | **Female** | Miss Carrington — consistent. |
  | `npc-dunmore` | **Male** | Mr. Dunmore — consistent. |
  | `npc-ellsworth` | **Male** | Lady Ellsworth's honorific is independent of gender field. Rename to `Lord Ellsworth` for consistency OR accept the divergence (Regency "Lady" was sometimes used for unmarried women of rank with no automatic gender entailment in modern parsing). |
  | `player-head` (`STARTING_HEAD_CHARACTER_ID`) | **Male** | Consistent with the spec's gendered framing. |

  **Implementation:** retire the `gender` field on `BaselineNpcSeed` (added at FC2-6-B1) — the seed no longer carries an authored gender. `buildBaselineNpcCharacter` derives gender via `hashCharIdToGender(seed.id)`. Bootstrap player character similarly derives via the same hash. Both paths agree by construction; chain-test parity holds trivially.

  **`BaselineNpcSeed` patch (supersedes the FC2-6-B1 widening):**
  ```ts
  // src/game/fixtures/npcs.ts AFTER FC6-1-B1 resolution:
  export type BaselineNpcSeed = {
    id: CharacterId;
    name: string;
    role: Role;
    traitPicks: readonly TraitId[];
    startingMood: Mood;
    deathAge: number;
    // NOTE: gender field RETIRED. Derive via hashCharIdToGender(id) in builder.
  };

  export function buildBaselineNpcCharacter(seed: BaselineNpcSeed): Character {
    return {
      /* existing fields */,
      gender: hashCharIdToGender(seed.id),  // SAME source-of-truth as legacy-lift
    };
  }
  ```
  **Names with gendered honorifics ("Lady" Aldridge / Ellsworth) are OPTIONAL prose-level inconsistencies** — the actual `Character.gender` field is hash-derived and load-bearing for classifier branches. Either accept the prose mismatch OR rename the NPCs in fixtures (a separate fixture edit not blocked by this plan).

- **`migrate_v7_to_v8` and lifter discipline.** Pure function `(SaveV7) → SaveV8` at `src/persist/migrations/v7-to-v8.ts`. Body follows the bare+wrap-then-reserialize pattern from P4/P5/P6:
  ```ts
  export function migrate_v7_to_v8(save: SaveV7): SaveV8 {
    const bare = fromSaveV7Bare(save);
    const seeded = seedV8FieldsIntoLegacyState(bare);
    return toSaveV8(seeded);
  }
  ```
  Effects:
  - On every character in `state.characters`: defaults `happiness: 100`, `temptationHookUnlocked: false`, `assignedTutorCharacterId: null`, `tutorBonusTraitGranted: false`, `dullSpouseExposureStartTick: null`, `parentCharacterIds: null` (no recorded parents on legacy saves; mid-campaign children survive but their parent edges are LOST — irrecoverable per CLAUDE.md non-negotiables — accepted tradeoff for the migration; documented inline). `gender` defaulted via `hashCharIdToGender` (see Gender field above).
  - On every house in `state.houses`: no new fields (P7 doesn't widen `HouseSchema`).
  - On `state.roles` (no such field — the enum is type-level only): the new `Spinster` / `Exile` / `Bohemian` role values are added to the enum at TypeScript level. Pre-existing characters at legacy migration retain their existing roles (HeadOfHouse / Heir / Dependent / Spouse); the new roles will only appear after a maturation step or a synthetic test fixture. **No retroactive role-promotion** during the v7→v8 migration — that would require re-running maturation logic on every legacy character, which mutates more state than a migration may, and would invalidate hash-equivalence tests.
  - Adds `proposalsLog: new Map()`, `tutorAssignmentsLog: new Map()`, `pendingTutorTraitChoices: new Map()` to `GameState` (via the bare deserializer's defaults).
  - Re-serializes as SaveV8 tuple arrays.
  - Draw budget: **ZERO** — every default is a literal constant; gender derivation uses a deterministic string hash, not PRNG. The migration does not advance any per-house `callCount`. Asserted in `v7-to-v8.test.ts`: `expect(migrate_v7_to_v8(save).rng).toEqual(save.rng)` for any input.
  - Idempotence assertion ships in `src/persist/migrations/v7-to-v8.idempotence.test.ts` via `assertMigrationIdempotent` (the P2 helper).

  **`seedV8FieldsIntoLegacyState` helper** lives in `src/persist/schema.ts` (private to lift/migrate boundary). Idempotent:
  - Walks `state.characters` and adds the 6 new fields only where structurally absent (`if (!("happiness" in c)) { ... }` per-field check; or use a single guard on `parentCharacterIds` if the 6 fields are co-introduced).
  - Returns `proposalsLog: state.proposalsLog ?? new Map()`, ditto for `tutorAssignmentsLog` and `pendingTutorTraitChoices`.
  - The structural check ensures replays of the helper (legacy lift + migration runner both calling it) produce identical state.

  **Bare+wrap lifter discipline (CLAUDE.md).** Required edits to the existing lifter chain at `src/persist/schema.ts`:
  - **`defaultCharacterV5Fields` (currently `:190`) — RENAMED to `defaultCharacterV5AndV8Fields` (resolves Cycle-2 B3 semantic name drift).** The original function added P4 composure to a CharacterPreV5; the post-P7 function adds composure AND the 7 V8 fields. The name change makes the contract literal — "this lifts CharacterPreV5 to live (V8-shape) Character." All callers (`liftLegacyCharacters` at `schema.ts:194-202`) are updated to the new name. Body:
    ```ts
    function defaultCharacterV5AndV8Fields(c: CharacterPreV5): Character {
      return {
        ...c,
        composure: 100,
        maxComposure: 100,
        // P7 ADDITIONS:
        happiness: HAPPINESS_INITIAL,
        temptationHookUnlocked: false,
        assignedTutorCharacterId: null,
        tutorBonusTraitGranted: false,
        dullSpouseExposureStartTick: null,
        parentCharacterIds: null,
        gender: hashCharIdToGender(c.id),
      };
    }
    ```
  - **NEW at P7**: `CharacterPreV8Schema` + `CharacterPreV8` TS alias adjacent to existing `CharacterPreV5Schema`. Used by `SaveV5Schema` / `SaveV6Schema` / `SaveV7Schema` post-P7 cutover (the characters tuple value swaps from live `CharacterSchema` to `CharacterPreV8Schema`).
    ```ts
    const CharacterPreV8Schema = CharacterSchema.omit({
      happiness: true,
      temptationHookUnlocked: true,
      assignedTutorCharacterId: true,
      tutorBonusTraitGranted: true,
      dullSpouseExposureStartTick: true,
      parentCharacterIds: true,
      gender: true,
    });
    type CharacterPreV8 = z.infer<typeof CharacterPreV8Schema>;
    ```
  - **WIDEN at P7**: `CharacterPreV5Schema` (currently at `schema.ts:184-188` — omits only `composure` + `maxComposure`) MUST ALSO omit the 7 V8 fields after P7 widens `CharacterSchema` (resolves FC2-3-B4). Otherwise post-P7 `CharacterPreV5Schema` inherits the new V8 keys via `CharacterSchema.omit({composure, maxComposure})` — which would force V2/V3/V4 saves on disk to carry V8 fields, contradicting the strip-on-emit intent. Body:
    ```ts
    // schema.ts:184-188 AFTER P7:
    const CharacterPreV5Schema = CharacterSchema.omit({
      composure: true,
      maxComposure: true,
      // P7 ADDITIONS: V2/V3/V4 saves predate ALL of these fields.
      happiness: true,
      temptationHookUnlocked: true,
      assignedTutorCharacterId: true,
      tutorBonusTraitGranted: true,
      dullSpouseExposureStartTick: true,
      parentCharacterIds: true,
      gender: true,
    });
    ```
    **Why the strip helper is still required even though Zod's default `.strip()` would silently drop extra keys at parse time** (resolves FC2-3-B4's .strict() concern): explicit strip is the V4 precedent at `schema.ts:519-523` (inline destructure) — the author chose explicit strip over relying on Zod's silent-drop behavior. Post-P7 we continue that defensive pattern via the `stripV8AndComposureForV5PreEmit` helper. If `.strict()` were ever added to `CharacterPreV5Schema` (it isn't today, but defensive design), the explicit strip prevents a parse-error regression. Plan does NOT recommend adding `.strict()` — Zod's default `.strip()` is consistent with the rest of the codebase.
  - **NEW at P7**: `defaultCharacterV8Fields(c: CharacterPreV8): Character` — returns `{...c, happiness: 100, temptationHookUnlocked: false, assignedTutorCharacterId: null, tutorBonusTraitGranted: false, dullSpouseExposureStartTick: null, parentCharacterIds: null, gender: hashCharIdToGender(c.id)}`.
  - **NEW at P7**: `liftLegacyCharactersFromV8Pre(serialized: ...): GameState["characters"]` — applies `defaultCharacterV8Fields` per character. Used by V7Bare only.

  **Explicit per-lifter edit list (resolves R36 — Bare cores below V5 go through `liftLegacyCharacters` + `defaultCharacterV5Fields`; V5/V6/V7 Bare cores call `deserializeRegistry(save.characters)` DIRECTLY and need a separate V8-defaulting lifter):**
  - **`fromSaveV2Bare`/`fromSaveV3Bare`/`fromSaveV4Bare`**: characters route through `liftLegacyCharacters` → `defaultCharacterV5Fields`. The widened `defaultCharacterV5Fields` (with 7 V8 fields) now produces V8-shape characters. Each Bare body adds three field defaults for the new GameState-level fields: `proposalsLog: new Map(), tutorAssignmentsLog: new Map(), pendingTutorTraitChoices: new Map()`. No characters-tuple-call-site change.
  - **`fromSaveV5Bare:601-619` / `fromSaveV6Bare:670-688`**: these currently call `deserializeRegistry(save.characters)` DIRECTLY — they DO NOT route through `liftLegacyCharacters` (verified). P7 introduces a NEW lifter `liftLegacyCharactersFromV8Pre(serialized: Array<[CharacterId, CharacterPreV8]>): Map<CharacterId, Character>` that walks the entries and applies `defaultCharacterV8FieldsForV5OrLater(c)` per character — symmetric in spirit with `liftLegacyCharacters` but for the V5+ pre-V8 shape. Both Bare cores swap `deserializeRegistry(save.characters)` → `liftLegacyCharactersFromV8Pre(save.characters)`. Each also adds the three new top-level Map defaults.
  - **`fromSaveV7Bare` (NEW at P7 — split off `fromSaveV7:739-757`) — resolves FC5-2-B1 by explicitly superseding the existing V7 comment.** Pre-P7, `fromSaveV7` at `schema.ts:739` carries the comment "V7 is the live format — pure deserialization with no seed helpers." **At P7, V7 stops being the live format (V8 takes over).** The implementer:
    1. Renames the existing `fromSaveV7` body to `fromSaveV7Bare` (preserving its pure-deserialize shape).
    2. Updates the body's import to route the characters tuple through `liftLegacyCharactersFromV8Pre(save.characters)` (replacing the existing `deserializeRegistry(save.characters)`).
    3. Adds the three new top-level Map defaults (`proposalsLog: new Map(), tutorAssignmentsLog: new Map(), pendingTutorTraitChoices: new Map()`).
    4. **REMOVES the "V7 is the live format" comment.** Replaces with: `// V7 was the live format pre-P7; V8 is live at P7+. This Bare core deserializes a V7 save's characters via liftLegacyCharactersFromV8Pre (adds 7 V8 defaults) and provides empty defaults for the three new top-level Maps.`
    5. Writes a new public `fromSaveV7(save: SaveV7): GameState` wrapper that composes `seedV8FieldsIntoLegacyState(fromSaveV7Bare(save))`.

    Without explicitly superseding the original V7 comment, an implementer following both the plan AND the existing inline comment could leave V7 alone and break the chain.
  - **`defaultCharacterV8FieldsForV5OrLater(c: CharacterPreV8): Character`** (NEW helper): adds the 7 V8 defaults to a CharacterPreV8-shaped object. Mirror of `defaultCharacterV5Fields` for V5+ pre-V8 shape (composure already present in input).
    ```ts
    function defaultCharacterV8FieldsForV5OrLater(c: CharacterPreV8): Character {
      return {
        ...c,
        happiness: HAPPINESS_INITIAL,
        temptationHookUnlocked: false,
        assignedTutorCharacterId: null,
        tutorBonusTraitGranted: false,
        dullSpouseExposureStartTick: null,
        parentCharacterIds: null,
        gender: hashCharIdToGender(c.id),
      };
    }
    ```
  - **`fromSaveV1` through `fromSaveV6` public wrappers**: extend the composition to also include `seedV8FieldsIntoLegacyState` after the existing seed helpers. **Composition order (resolves Cycle-2 B4):** seeders compose OUTSIDE-IN, the most recently introduced seeder OUTERMOST. The V8 seeder must run AFTER `seedIndependentIntoLegacyState` so that the V8 character defaults apply to the freshly-seeded Independent NPCs (otherwise those NPCs would lack the 7 V8 fields). **Idempotence resolves the question at runtime — each seeder no-ops when its target fields are already present — but the explicit ordering is the documented contract.** The composition shape for every legacy wrapper:
    ```ts
    export function fromSaveV1(save: SaveV1): GameState {
      return seedV8FieldsIntoLegacyState(
        seedWhispersCouriersStaffIntoLegacyState(
          seedSchemesAndGrievancesIntoLegacyState(
            seedIndependentIntoLegacyState(fromSaveV1Bare(save), extractPlayerSeed(save.rng)),
          ),
        ),
      );
    }
    // ... and analogously for fromSaveV2..fromSaveV6
    ```
  - **`fromSaveV7` (refactored)**: composes `Bare → seedV8FieldsIntoLegacyState`. V7 saves already contain whispers/couriers/staff/grievances/schemes/Independent by schema; no other seed composition needed.
  - **`fromSaveV8` (NEW at P7)**: pure deserialize directly via `deserializeRegistry(...)`. V8 saves contain live `CharacterSchema` (with the 7 new fields) and the three new top-level Maps. NO Bare-split, NO seeding helper applies.

  **Mid-chain seed-and-strip waste at `migrate_v6_to_v7` and `migrate_v7_to_v8`.** The P6 inline note already documents this pattern; P7 extends it. `migrate_v6_to_v7` calls `fromSaveV6` (the PUBLIC wrapper), which now seeds V8 fields; `toSaveV7` (whose body literal does NOT reference V8 fields — they're absent from `SaveV7Schema`) drops them on emission. The freshly-seeded fields are immediately discarded mid-chain. **The waste is intentional, not a bug:** keeping the V1-V6 wrapper extensions ensures DIRECT-LIFT consumers (test fixtures, future direct-load hot paths) produce V8-shape GameState from any legacy save without going through the migration runner. The next migration step `migrate_v7_to_v8` re-seeds via `seedV8FieldsIntoLegacyState`. **Inline note in `migrate_v6_to_v7.ts` body** (extend the existing P6 note): `// P7 note: fromSaveV6's V8-field seeds are dropped at toSaveV7 emission (SaveV7 schema doesn't carry them); the V7→V8 step re-seeds. The mid-chain discard is by design — see plans/phases/07-family-succession.md.`

  Register in `src/persist/migrations/index.ts` after the existing `v6-to-v7` entry; `assertMonotonic(MIGRATIONS)` catches misregistration at module load.

  **Per-step outputSchema.parse assertions in migration tests (resolves FC6-2-B1).** Each updated `migrate_v{N}_to_v{N+1}.test.ts` MUST include an assertion of the form:
  ```ts
  // src/persist/migrations/v{N}-to-v{N+1}.test.ts (NEW assertion at P7):
  it("output parses against outputSchema", () => {
    const fixture = buildSaveV{N}Fixture();
    const next = migrate_v{N}_to_v{N+1}(fixture);
    expect(() => SaveV{N+1}Schema.parse(next)).not.toThrow();
  });
  ```
  The migration runner ALREADY calls `outputSchema.parse(...)` between steps (per the P2 migration runner contract), so per-step `.test.ts` assertions are NOT load-bearing for runtime correctness — they ARE load-bearing for FAILURE LOCALIZATION. Without per-step assertions, a strip-helper omission (e.g., implementer forgets to add `gender` to `stripV8AndComposureForV5PreEmit`) surfaces only at the full-chain `v1-to-v8-chain.test.ts` parity assertion, where the failure message points to the chain test rather than the specific migration step that lost the field. Per-step assertions move the failure point to the correct migration test file.

  **Required per-step assertion additions at P7:** `migrate_v1_to_v2.test.ts` through `migrate_v6_to_v7.test.ts` (existing files) — add the assertion above per the V{N+1} target schema. Particularly important for `migrate_v6_to_v7.test.ts` whose `toSaveV7` now strips V8 fields. `migrate_v7_to_v8.test.ts` (NEW at P7) — includes the assertion as part of the new suite.

- **Save-version cutover — full edit list (resolves B2 + B3 + R18).** SaveV8 is the new live format:
  - **`src/persist/schema.ts:44`**: `SAVE_VERSION_CURRENT = 7 as const` → `SAVE_VERSION_CURRENT = 8 as const`.
  - **`src/persist/schema.ts` append** — new `SaveV8Schema`, `toSaveV8`, `fromSaveV8` block following the SaveV7 block:
    ```ts
    export const SaveV8Schema = z.object({
      version: z.literal(8),
      tick: z.number().int().nonnegative(),
      rng: z.array(z.tuple([HouseIdSchema, RngStateSchema])),
      houses: z.array(z.tuple([HouseIdSchema, HouseSchema])),
      characters: z.array(z.tuple([CharacterIdSchema, CharacterSchema])),  // live CharacterSchema with 7 new fields
      marriages: z.array(z.tuple([MarriageIdSchema, MarriageRecordSchema])),
      campaignName: z.string(),
      era: z.enum(["Earlier", "Later"]),
      conversationHistory: z.array(z.tuple([ConversationPairKeySchema, z.array(ExchangeSchema)])),
      affectionMap: z.array(z.tuple([ConversationPairKeySchema, z.number().int().min(0).max(100)])),
      schemes: z.array(z.tuple([SchemeIdSchema, SchemeSchema])),
      whispers: z.array(z.tuple([WhisperIdSchema, WhisperSchema])),
      couriers: z.array(z.tuple([CourierPayloadIdSchema, CourierPayloadSchema])),
      staff: z.array(z.tuple([StaffIdSchema, StaffMemberSchema])),
      proposalsLog: z.array(z.tuple([CharacterIdSchema, ProposalLogEntrySchema])),         // NEW at P7
      tutorAssignmentsLog: z.array(z.tuple([CharacterIdSchema, TutorAssignmentLogEntrySchema])),  // NEW at P7
      pendingTutorTraitChoices: z.array(z.tuple([CharacterIdSchema, PendingTutorTraitChoiceSchema])),  // NEW at P7
    });
    export type SaveV8 = z.infer<typeof SaveV8Schema>;
    export function toSaveV8(state: GameState): SaveV8 { /* serializeRegistry for all Maps */ }
    export function fromSaveV8(save: SaveV8): GameState { /* deserializeRegistry */ }
    ```
  - **Characters tuple value at each save schema (resolves B20 — verified against `src/persist/schema.ts:397, 452, 510, 574, 639, 707`).** Verified ground truth:
    - `SaveV1Schema`: no characters tuple. No edit at P7.
    - `SaveV2Schema:397` / `SaveV3Schema:452` / `SaveV4Schema:510`: use `CharacterPreV5Schema` (pre-composure). No schema-shape edit at P7 — their existing per-character strip discipline is widened (see Strip-on-emit cascade below).
    - `SaveV5Schema:574` / `SaveV6Schema:639` / `SaveV7Schema:707`: use **LIVE `CharacterSchema`** (composure-inclusive). **P7 swaps all three to `CharacterPreV8Schema`** because P7 widens live `CharacterSchema` with 7 new fields — V5/V6/V7 saves on disk MUST NOT carry those fields. Their Bare cores route through a new `liftLegacyCharactersFromV8Pre` helper that adds the 7 V8 defaults via `defaultCharacterV8FieldsForV5OrLater(c)` (see Bare-core defaulting below).
    - `SaveV8Schema` (NEW): uses live (post-P7-widening) `CharacterSchema` (composure AND 7 V8 fields required).
  - **Strip-on-emit cascade (resolves B20, R18; mirrors the P6 grievances+exiled pattern).** **Two distinct strip helpers — one targeting CharacterPreV5 (composure-absent, V8-absent), one targeting CharacterPreV8 (composure-present, V8-absent).** Verified emitter ground truth:
    - `toSaveV4:519-523` strips composure INLINE via destructure (no helper); P5/P6 added no character strip; `toSaveV5/V6/V7` (lines 583/649/720) emit `serializeRegistry(state.characters)` with NO strip. No `stripComposureForLegacyEmit` helper exists.
    - At P7 we ADD two helpers and update SIX emitters.

    ```ts
    // schema.ts (NEW at P7):
    // Helper #1 — Strip the 7 V8 character fields ONLY (preserves composure).
    // Output target: CharacterPreV8 (live Character minus V8 fields).
    // Used by: toSaveV5, toSaveV6, toSaveV7 (all currently emit live CharacterSchema).
    function stripV8CharacterFieldsForLegacyEmit(
      entries: ReadonlyArray<readonly [string, Character]>,
    ): Array<[string, CharacterPreV8]> {
      return entries.map(([id, c]) => {
        const {
          happiness: _h,
          temptationHookUnlocked: _t,
          assignedTutorCharacterId: _at,
          tutorBonusTraitGranted: _bt,
          dullSpouseExposureStartTick: _ds,
          parentCharacterIds: _p,
          gender: _g,
          ...rest
        } = c;
        return [id, rest as CharacterPreV8];
      });
    }

    // Helper #2 — Strip composure + maxComposure + 7 V8 fields (9 fields total).
    // Output target: CharacterPreV5 (no composure, no V8 fields).
    // Used by: toSaveV2, toSaveV3, toSaveV4 (currently CharacterPreV5Schema-targeting).
    // The existing toSaveV4 inline destructure is REPLACED by a call to this helper.
    function stripV8AndComposureForV5PreEmit(
      entries: ReadonlyArray<readonly [string, Character]>,
    ): Array<[string, CharacterPreV5]> {
      return entries.map(([id, c]) => {
        const {
          happiness: _h, temptationHookUnlocked: _t, assignedTutorCharacterId: _at,
          tutorBonusTraitGranted: _bt, dullSpouseExposureStartTick: _ds, parentCharacterIds: _p, gender: _g,
          composure: _c, maxComposure: _mc,
          ...rest
        } = c;
        return [id, rest as CharacterPreV5];
      });
    }
    ```
    **Per-emitter call-site updates (SIX emitter sites — enumerated, verified ground truth; resolves FC4-1-B2 by adding the audit step):**
    - `toSaveV2`/`toSaveV3`: implementer MUST FIRST audit each emitter's current strip approach via `grep -n "stripV5\|stripComposure\|stripGrievances\|stripExiled\|serializeRegistry(state.characters)" src/persist/schema.ts` and locate the exact lines in `toSaveV2` (around `schema.ts:400-410` per the SaveV2 block at `schema.ts:397`) and `toSaveV3` (around `schema.ts:455-465` per `schema.ts:452`). Then **wrap or replace the existing characters-serialization call** with `stripV8AndComposureForV5PreEmit(serializeRegistry(state.characters))`. The audit-then-replace pattern matches the precedent at `toSaveV4:519-523` (the only emitter with verified inline-destructure stripping today; verify at edit time whether V2/V3 inherit the same pattern from `liftLegacyCharacters` round-trip or emit live characters directly).
    - `toSaveV4:519-523` (currently strips composure INLINE via destructure): **replace inline destructure with `stripV8AndComposureForV5PreEmit(serializeRegistry(state.characters))`**. Retires the inline pattern.
    - `toSaveV5:590` / `toSaveV6:658` / `toSaveV7:726` (currently emit `serializeRegistry(state.characters)` with NO strip): **change all three to `stripV8CharacterFieldsForLegacyEmit(serializeRegistry(state.characters))`**. Three NEW strip sites at P7.
    - `toSaveV8` (NEW): NO strip — V8 is the live format; the 7 new fields are expected.

    **Migration runner correctness post-edit:** every legacy `migrate_vN_to_vN+1` step composing via `toSaveV{N+1}` produces output that parses clean against the post-P7 `SaveV{N+1}Schema`. The full chain V1→V2→V3→V4→V5→V6→V7→V8 runs to completion. New full-chain regression file at `src/persist/migrations/v1-to-v8-chain.test.ts`.

  - **`src/persist/dexie.ts`** — `SaveRecord.data` union widening to include `SaveV8`. `load()` final-parse callsite changes to `SaveV8Schema.parse`; return type `Promise<SaveV8 | undefined>`. Import `toSaveV8`, replace `toSaveV7` in the production write callsite. Audit: `rg 'SaveV7|toSaveV7|fromSaveV7' src/` post-cutover; expect only legacy-version-test hits.
  - **`src/main.tsx`** — rename `__buildSaveV7ForTests` → `__buildSaveV8ForTests` per the P3/P4/P5/P6 rename precedent. **Five reference sites must update in `src/main.tsx`** (verify against current main.tsx in implementation): import statement, comment lines, TS type annotation, window assignment, function body return. Audit: `rg '__buildSaveV7ForTests' .` post-rename expects zero hits.
  - **`src/persist/migrations/index.ts`** — add `import { migrate_v7_to_v8 } from "./v7-to-v8";` and append the registration entry:
    ```ts
    { from: 7, to: 8, migrate: (s: unknown) => migrate_v7_to_v8(SaveV7Schema.parse(s)), outputSchema: SaveV8Schema },
    ```
    `assertMonotonic(MIGRATIONS)` catches misordering.
  - **Test-file edit list:**
    - `src/persist/save-roundtrip.test.ts` — update both import and call to `fromSaveV8`.
    - `src/persist/migrations/v1-to-v7-chain.test.ts` (added at P6) — extend the chain assertion to `runMigrations(saveV1, 1, 8, MIGRATIONS)` and lift via `fromSaveV8`. Also add the new full-chain regression file `src/persist/migrations/v1-to-v8-chain.test.ts`. Parity-invariant assertion pinned: `expect(hashState(fromSaveV8(runMigrations(saveV1, 1, 8, MIGRATIONS)))).toBe(hashState(createInitialState(seed, DEFAULT_CAMPAIGN_NAME)))` for a fresh-state seed. Load-bearing pieces: (a) `createInitialState` initializes every character's 7 new fields per the seeding helper; (b) `seedV8FieldsIntoLegacyState` produces identical defaults; (c) gender derivation via `hashCharIdToGender` is identical in both paths; (d) baseline-character ids/names/birth-ticks are stable; (e) `serializeRegistry` lex-sorts deterministically.
    - `src/persist/dexie.test.ts` — add "fires InvalidSaveSchemaError when SaveV8 fields are malformed" (current-version path). Rename the existing SaveV7-malformed test to "fires MigrationFailedError when migrating-from-V7 fails on malformed fields". Add SaveV8-specific corruption fixtures: character with `happiness: -1` → `InvalidSaveSchemaError`; character with `gender: "X"` → `InvalidSaveSchemaError`; character with `parentCharacterIds: ["only-one"]` (failed length-2 tuple) → `InvalidSaveSchemaError`.

- **`src/game/constants.ts` extended (resolves B8, B17, R3).** New entries appended to the P1..P6 set:
  - **`HAPPINESS_INITIAL = 100`** — starting happiness on every newly-created character (fresh state + child conception + lift seeding default). Clamped `[0, 100]`.
  - **`HAPPINESS_TEMPTATION_THRESHOLD = 30`** — character with `happiness < 30` triggers the one-way temptation latch (flips `temptationHookUnlocked: true`).
  - **`HAPPINESS_DULL_SPOUSE_DRAIN_PER_TICK = -1`** — happiness delta per tick applied to characters with a live Dull-trait spouse (i.e., `dullSpouseExposureStartTick !== null`). Clamped `[0, 100]` at the mutation site. Spec line 468 "per-tick happiness delta" is the canonical reading; -1/tick is the v1 designer-tunable default. At -1/tick, a character starts happy (100) and reaches the temptation threshold (30) after 70 ticks of exposure.
  - **`AFFECTION_PROPOSAL_THRESHOLD = 80`** — REUSED. **Already shipped at `src/game/constants.ts:133`** (resolves B17). P7 does NOT add a duplicate constant under a different name. Every plan reference to "PROPOSAL_AFFECTION_THRESHOLD" SHOULD READ `AFFECTION_PROPOSAL_THRESHOLD` — the existing canonical name is preserved. Spec line 333.
  - **`PROPOSAL_REPUTATION_THRESHOLD = 40`** — NEW. Spec line 333. (No existing constant at this value carries this semantic; safe to add.)
  - **`PROPOSAL_ACCEPTANCE_FLOOR = 0.5`** — NEW. Spec line 334.
  - **`PROPOSAL_ACCEPTANCE_CEILING = 0.95`** — NEW. Spec line 334.
  - **`PROPOSAL_REJECTION_SCANDAL_DELTA = 5`** — NEW. Spec line 336.
  - **`PROPOSAL_TICK_COST = 1`** — NEW. Proposal consumes one tick (same shape as travel/audience per the pre-tick action pattern). **Resolves FC6-2-B2:** wired via TWO consumer sites — (a) module-load assertion adjacent to the declaration (`if (PROPOSAL_TICK_COST !== 1) throw new Error("PROPOSAL_TICK_COST drift breaks the proposal-tick-budget contract");`), AND (b) `proposal.test.ts` includes `expect(stateAfter.tick - stateBefore.tick).toBe(PROPOSAL_TICK_COST)` on every accept/reject-on-roll fixture so the constant is genuinely consumed and a future advanceTickPure modification that broke the 1-tick assumption would surface immediately.
  - **`SEDUCTION_DISCOVERY_SCANDAL = 25`** (NEW — resolves B8, R17). **Retroactive constant** introduced at P7 to anchor the temptation discount. The corresponding mutation site is added in `src/game/rules/schemes.ts:410` (the existing `discovered` branch flips status to Failed/Discovered; P7 adds `+N scandal` to the owner house BEFORE the status flip; the `N` value depends on the temptation latch — see TEMPTATION_DISCOUNTED_SCANDAL below). **Patch shape (resolves FC2-4-B3):**
    ```ts
    // src/game/rules/schemes.ts (P7 EDIT to discovered branch at line 410):
    if (discovered) {
      // P7: apply scandal BEFORE status flip. Read the temptation latch from
      // the AGGRESSOR character (scheme.aggressorCharacterId, NOT the owner
      // house head — the aggressor is the family member directly executing
      // the Seduction per P5's aggressor-selection contract). Discount only
      // applies if target is non-spouse (i.e., target !== aggressor.spouse).
      const aggressor = state.characters.get(scheme.aggressorCharacterId);
      const aggressorMarriage = aggressor?.marriageId != null
        ? state.marriages.get(aggressor.marriageId)
        : undefined;
      const aggressorSpouseId = aggressorMarriage !== undefined && !aggressorMarriage.dissolved
        ? (aggressorMarriage.spouseAId === aggressor!.id ? aggressorMarriage.spouseBId : aggressorMarriage.spouseAId)
        : null;
      const targetIsSpouse = aggressorSpouseId !== null && targetId === aggressorSpouseId;
      const scandalDelta = aggressor !== undefined && aggressor.temptationHookUnlocked && !targetIsSpouse
        ? TEMPTATION_DISCOUNTED_SCANDAL   // 5
        : SEDUCTION_DISCOVERY_SCANDAL;    // 25
      // Clone houses Map, lookup owner, apply clamped delta, thread back.
      const newHouses = new Map(baseState.houses);
      const ownerHouse = newHouses.get(scheme.ownerHouseId);
      if (ownerHouse !== undefined) {
        newHouses.set(scheme.ownerHouseId, {
          ...ownerHouse,
          scandal: clamp(ownerHouse.scandal + scandalDelta, 0, 100),
        });
      }
      const stateWithScandal = { ...baseState, houses: newHouses };
      return flipSchemeStatus(stateWithScandal, scheme.id, "Failed", "Discovered");
    }
    ```
    **Verified: `aggressorCharacterId` exists on `SchemeSchema` (resolves FC6-1-B2).** Field declared at `src/game/entities.ts:131` (`aggressorCharacterId: CharacterIdSchema // §4 line 543 + §6 line 567`), populated via `selectAggressor(state, ownerHouseId, kind)` at `src/game/rules/schemes.ts:261`. Audit at implementation: `rg "aggressorCharacterId" src/game/entities.ts src/game/rules/schemes.ts` confirms field exists.

    **Why the AGGRESSOR's latch (not the owner house's head):** spec §3 line 469 frames the temptation hook as the character-level psychological state ("the player gains explicit narrative-prompted access to the Seduction scheme"). At v1 the player head is always the aggressor for Seduction (Spinster archetype aside — Spymasters can do mail-intercept but not Seduction; Seduction prereq has no archetype gate per spec line 355). The aggressor read is the principled one even though it usually equals the player head. Future v1.5 archetypes that delegate Seduction would naturally read the delegating-character's latch.
    Pre-P7 saves loading into post-P7 code observe the same status field (Failed/Discovered), but a Seduction that completed pre-P7 already shipped without the scandal cost; this is acceptable because scandal is a state field, not a recorded-event field, and the migration does not retroactively replay scheme resolutions.
  - **`TEMPTATION_DISCOUNTED_SCANDAL = 5`** — applied instead of `SEDUCTION_DISCOVERY_SCANDAL` when the aggressor's `temptationHookUnlocked === true` AND the Seduction target is non-spouse. See patch shape above. Resolves §10 Q23 with the discounted-scandal value pinned.
  - **`TUTOR_REASSIGNMENT_WEALTH_COST = 5`** — wealth cost for reassigning a child's tutor (rejecting branch deducts nothing per the atomic-gating contract). First assignment is free; every subsequent reassignment costs 5 wealth. Tracked via `tutorAssignmentsLog[childId].reassignmentCount`.
  - **`TUTOR_GUIDE_OPINION_COOLDOWN_TICKS = 10`** — minimum tick gap between consecutive guide-opinion effects on the same child from the same tutor. Spec line 474 "fires at most once per child per fixed cooldown."
  - **`TUTOR_GUIDE_OPINION_MOOD_TARGET: Mood = "Receptive"`** — guide-opinion forces the child's mood toward Receptive (subject to the existing mood-lock discipline — a Defensive-locked child skips the guide-opinion per spec line 474 "respects existing mood locks").
  - **`ARCHETYPE_MATURATION_TRAIT_POOL` (NEW — resolves R3, R6, S3):** all four archetypes' 2-option trait pools enumerated verbatim per spec line 475. Lives in `src/game/fixtures/archetypes.ts` (NOT constants.ts — it's a fixture mapping, per CLAUDE.md "Identities live in `src/game/fixtures/`"). Per spec line 475:
    ```ts
    // src/game/fixtures/archetypes.ts (P7 ADDITION):
    export const ARCHETYPE_MATURATION_TRAIT_POOL: Record<Archetype, readonly [TraitId, TraitId] | null> = {
      Spymaster: ["Observant" as TraitId, "Cunning" as TraitId],
      BohemianRake: ["Jaded" as TraitId, "Melancholic" as TraitId],
      Tutor: ["Intellectual" as TraitId, "Sophisticated" as TraitId],
      CountryExile: ["ImpoverishedNobility" as TraitId, "Rustic" as TraitId],
      None: null,  // unclassified archetype grants no bonus
    };
    ```
    `None` archetype skips the maturation trait bonus entirely (no pending choice created, `tutorBonusTraitGranted` stays false). This mapping is the source of truth for the `chooseTutorBonusTrait` action's `acceptableTraitIds: readonly TraitId[]` field.

  - **Module-load assertions** adjacent to the new constants (mirrors P5 SCHEME_KINDS pattern):
    ```ts
    if (ARCHETYPE_MATURATION_TRAIT_POOL.None !== null) {
      throw new Error("Archetype None must have a null trait pool");
    }
    // Assert every non-None archetype has exactly 2 traits:
    for (const arch of ARCHETYPES) {
      if (arch === "None") continue;
      const pool = ARCHETYPE_MATURATION_TRAIT_POOL[arch];
      if (pool === null || pool.length !== 2) {
        throw new Error(`Archetype ${arch} maturation trait pool must have exactly 2 entries`);
      }
    }
    ```

- **Bootstrap integration (resolves B16 + B23 — verified against `src/game/fixtures/npcs.ts:18-25, 29-69` and `src/game/fixtures/names.ts:6`).** `src/game/bootstrap.ts:seedStartingFamily` extends the existing return type. The **5 baseline NPCs** (verified count, not 4) at `INDEPENDENT_HOUSE_ID` and the player character all gain the 7 new V8 character fields. Gender is assigned explicitly in `BASELINE_NPCS` (NOT via `hashCharIdToGender` — bootstrap is a fresh-state path; legacy lift uses the hash).

  **`BaselineNpcSeed` type widening (resolves B23 — verified current shape at `src/game/fixtures/npcs.ts:18-25` has fields `{ id, name, role, traitPicks, startingMood, deathAge }` with NO gender field).** P7 widens the type:
  ```ts
  // src/game/fixtures/npcs.ts:18-25 AFTER P7:
  export type BaselineNpcSeed = {
    id: CharacterId;
    name: string;
    role: Role;
    traitPicks: readonly TraitId[];
    startingMood: Mood;
    deathAge: number;
    gender: "Female" | "Male";   // NEW at P7
  };
  ```
  Every entry in the `BASELINE_NPCS: ReadonlyArray<BaselineNpcSeed>` literal (currently at `npcs.ts:29-69`) gains a `gender:` line per the per-NPC pin below. Both `buildBaselineNpcCharacter` (`npcs.ts:77-96`) AND the player-character constructor in `bootstrap.ts` extend the returned Character with the explicit gender value (NOT via `hashCharIdToGender` — bootstrap is fresh-state).

  Baseline NPC genders pinned per the verified fixture identities:
  - **Lady Aldridge** (`npc-aldridge`) — Female. **Role at bootstrap: `Dependent`** (verified at `src/game/fixtures/npcs.ts:33`) — P7 does NOT widen baseline NPC roles at bootstrap because the v7→v8 migration does NOT retroactively run maturation (consistent with §10 Q4's "two trigger points only" resolution). She would qualify as Spinster role IF she crossed maturation post-P7, but at fresh state she stays Dependent. **Resolves FC3-1-B1**: the prior "Spinster-archetype candidate" prose was misleading; corrected.
  - **Lord Blackwood** (`npc-blackwood`, Independent head-of-house) — Male.
  - **Miss Carrington** (`npc-carrington`) — Female. Frivolous + Romantic traits qualify her for Bohemian Rake IF her role flips Male — but role classifier reads gender + role + marriage; unwed female → Spinster role; she'd classify as None archetype since Spinster + (Frivolous|Romantic) doesn't match the Spymaster trait gate.
  - **Mr. Dunmore** (`npc-dunmore`) — Male. Empathetic + Generous (neither in Bohemian's gate trait set: {Frivolous, Romantic, Jaded}); unwed adult male → Bohemian role per maturation, BUT classifyArchetype branch 2 fails the trait gate → None archetype.
  - **Lady Ellsworth** (`npc-ellsworth`) — Female. Bold + Brash (neither in Spymaster's gate: {Cunning, Observant}); Spinster role → None archetype.
  - **Player character** (`STARTING_HEAD_CHARACTER_ID`, name `"Player I"` per `src/game/fixtures/names.ts:6`) — Male.
  - The 4 baseline staff (per P6 fixture `src/game/fixtures/staff.ts`) do NOT appear in `state.characters` so gender is irrelevant for them.

  **Verification: each NPC's role-archetype combo is intentional.** Of the 5 baseline NPCs, NONE classifies to a non-`None` archetype at fresh state (deathAge years vary but the role + trait combinations were chosen pre-P7 without classifier knowledge). The fresh-state campaign therefore starts with ZERO classified family-members in the player house; the first Spymaster/BohemianRake/etc. appears either when a child matures with the right trait set OR when the spec's "tutor" line gates open up via fixed-trait fixtures. **This means the v1 Chaperone (Spymaster prereq) and Assassination (BohemianRake|CountryExile prereq) schemes remain unlaunchable at fresh state** — the P5-shipped UI disabled-tooltip persists. Player must accumulate a child with the right trait inheritance to unlock those gates.

  **Impact on P6 features (resolves FC4-1-B3 — Independent NPCs never undergo maturation):** The 5 baseline NPCs at INDEPENDENT_HOUSE_ID start at age 25 at bootstrap (verified at `npcs.ts:83`); maturation only fires at exact age=18, so they CANNOT pass through that trigger. Independent's own succession runs when Blackwood (age 25 + lifespan-deathAge ticks) dies — but the widened succession recompute at P7 ONLY produces archetype changes for survivors who have qualifying role/trait combinations, and the 5 baseline traits were chosen pre-P7 (Witty/Sophisticated, Cunning/Reserved, Romantic/Frivolous, Empathetic/Generous, Bold/Brash) so none match the classifier's gates. **Consequence for the P6 Spymaster mail-intercept workflow (spec line 470):** the entire workflow has ZERO valid actors at v1 fresh state. The Player house has only the player head + zero family; Independent's 5 NPCs all classify as None. The Spymaster mail-intercept UI button remains disabled until a player-house child matures with `{Cunning, Observant}` traits + Spinster role (female + unwed at maturation). **By design** — P7 ships the archetype classification rule body but the *first valid Spymaster archetype* in any v1 campaign arises from natural family-tree progression, not from baseline fixture choice. Players who refuse to marry can never produce a child to mature, locking them out of Chaperone/Assassination/forgery/mail-intercept indefinitely — this is the implicit incentive for the proposal action P7 introduces.

  Patch shape:
  ```ts
  // src/game/bootstrap.ts (P7 EDIT — extend each baseline character constructor):
  const player: Character = {
    /* existing P0..P6 fields */,
    // P7 ADDITIONS:
    happiness: HAPPINESS_INITIAL,
    temptationHookUnlocked: false,
    assignedTutorCharacterId: null,
    tutorBonusTraitGranted: false,
    dullSpouseExposureStartTick: null,
    parentCharacterIds: null,  // player's parents are pre-history
    gender: "Male",
  };
  // ... and analogously for each NPC, with gender per BASELINE_NPCS table above.
  ```
  `createInitialState` in `src/game/store.ts` consumes the new fields naturally via the existing per-character set loop. Draw discipline preserved: no new draws in bootstrap (the player's deathAge draw is the only existing bootstrap draw at P0); P7's gender field is assigned by literal constants in bootstrap and by deterministic hash in legacy lift. Vitest: `expect(seedStartingFamily(initialRng).rngState.callCount).toBe(1)` — unchanged.

- **Roles fixture and archetype-classifier body (resolves B4 + main P7 work).** `src/game/fixtures/archetypes.ts:17-19` is the P1 stub returning `"None"`. P7 replaces with the spec §3 line 489-495 body:
  ```ts
  // src/game/fixtures/archetypes.ts AFTER P7:
  export function classifyArchetype(character: Character): Archetype {
    // Spec §3 line 489-496. First-match-wins; mid-life trait acquisition does
    // NOT reclassify (§10 Q4; classifier called only at succession + child
    // maturation per the P7 trigger walk).
    // Trait-check convention (resolves FC4-1-B1): classifier uses `new Set(traits).has(...)`
    // because branches read the same trait multiple times (Set-membership cost is
    // amortized over multiple .has() calls per call). Other rules that read a trait
    // ONCE (e.g., maturation's computeMaturationRole) use the cheaper `traits.includes(...)`
    // array method directly. Both produce identical semantics; the choice is allocation-
    // discipline only.
    const traits = new Set(character.traits);
    const role = character.role;
    // Branch 1: Spinster role + (Cunning | Observant) → Spymaster.
    if (role === "Spinster" && (traits.has("Cunning") || traits.has("Observant"))) {
      return "Spymaster";
    }
    // Branch 2: unwed adult male + (Frivolous | Romantic | Jaded) → BohemianRake.
    // "Unwed adult male" reads as gender === "Male" && marriageId === null && age >= ADULTHOOD_AGE_IN_YEARS.
    if (
      character.gender === "Male" &&
      character.marriageId === null &&
      character.age >= ADULTHOOD_AGE_IN_YEARS &&
      (traits.has("Frivolous") || traits.has("Romantic") || traits.has("Jaded"))
    ) {
      return "BohemianRake";
    }
    // Branch 3: unwed adult + (Intellectual | Sophisticated) → Tutor.
    if (
      character.marriageId === null &&
      character.age >= ADULTHOOD_AGE_IN_YEARS &&
      (traits.has("Intellectual") || traits.has("Sophisticated"))
    ) {
      return "Tutor";
    }
    // Branch 4: Exile role OR (ImpoverishedNobility | Rustic) → CountryExile.
    if (role === "Exile" || traits.has("ImpoverishedNobility") || traits.has("Rustic")) {
      return "CountryExile";
    }
    return "None";
  }
  ```
  **Pure-rule discipline.** `classifyArchetype` reads only the Character entity; it does NOT consume RNG; it does NOT cite outside state (no `GameState` access). The function is referentially transparent: same input always produces same output. The two trigger points (succession step 7 + child maturation step) are the ONLY callers — verified by grep at implementation.

- **Proposal action (resolves B9, B10, B11, B12).** New player-elected action `proposeMarriage(targetCharacterId: CharacterId)`. Follows the pre-tick action pattern from P3 (CLAUDE.md §10): pure rule first, then `advanceTickPure`. Lives in `src/game/rules/proposal.ts` (NEW module) for the pure body; store wrapper in `src/game/store.ts:proposeMarriage`. Tick-advancing — consumes `PROPOSAL_TICK_COST = 1` tick.

  **Pure rule signature:**
  ```ts
  // src/game/rules/proposal.ts (NEW):
  export type ProposalRejection =
    | { kind: "TargetTooYoung" }                 // §10 Q17
    | { kind: "TargetExiled" }                   // exiled house targets rejected
    | { kind: "TargetDead" }                     // target not alive
    | { kind: "TargetAlreadyMarried" }           // target's marriageId is non-null
    | { kind: "TargetIsPlayerHead" }             // target IS the player head — can't propose to self
    | { kind: "TargetIsSameHouse" }              // intra-house marriage rejected (incest gate at P7; siblings + cousins fall here)
    | { kind: "CrossHouseMarriageNotSupported" } // §10 Q16
    | { kind: "TargetNotFound" }                 // CharacterId doesn't resolve in state.characters
    | { kind: "InsufficientAffection"; current: number; required: number }   // < 80
    | { kind: "InsufficientReputation"; current: number; required: number }  // < 40
    | { kind: "PlayerAlreadyMarried" }           // player head already has a non-dissolved marriage (resolves FC2-B4)
    | { kind: "PlayerHeadDead" }                 // player house's headOfHouseCharacterId is dead (succession not yet run)
    | { kind: "PlayerExiled" };                  // CLAUDE.md exile gate

  export type ProposalOutcome =
    | { ok: true; accepted: true; marriageId: MarriageId; newRng: RngState; spouseRoleFlipped: CharacterId }
    | { ok: true; accepted: false; rngAfter: RngState; scandalDelta: number }
    | { ok: false; reason: ProposalRejection };

  export function applyProposalPure(
    state: GameState,
    targetCharacterId: CharacterId,
  ): { nextState: GameState; outcome: ProposalOutcome };
  ```

  **Predicate order (atomic gating, CLAUDE.md non-negotiable §5 — validate → deduct → apply):**
  1. **PlayerExiled gate** (top of body): if `state.houses.get(PLAYER_HOUSE_ID).exiled === true` → return `{ ok: false, reason: { kind: "PlayerExiled" } }`. Same shape as the P6 universal exile gate.
  2. **PlayerHeadDead gate**: if the player house's `headOfHouseCharacterId` resolves to a character with `alive: false`, reject — succession must run first.
  3. **TargetNotFound gate**: `state.characters.get(targetCharacterId)` must resolve.
  4. **TargetDead gate**: target must be alive.
  5. **TargetExiled gate**: target's house must not be `exiled`.
  6. **TargetIsPlayerHead gate**: target ID must not equal player head ID.
  7. **TargetIsSameHouse gate (incest gate)**: `target.houseId === PLAYER_HOUSE_ID` → reject. At P7 the player house is the only player-controlled house; the player cannot propose to their own family. (Sibling marriages would also pass through this gate.)
  8. **CrossHouseMarriageNotSupported gate (resolves B12)**: at P7 with no rival houses yet, the predicate is `target.houseId !== PLAYER_HOUSE_ID && target.houseId !== INDEPENDENT_HOUSE_ID` → reject. **Independent-house NPCs ARE valid proposal targets**; the gate only rejects characters at non-PLAYER, non-INDEPENDENT houses (a category that is EMPTY at P7 because P8 hasn't shipped rivals). The Vitest fixture for this rejection uses a synthetic third house at `"rivalA" as HouseId` to exercise the branch deterministically. **At P8 the gate widens** to also reject rivals; that's documented in P8's plan, not here.
  9. **TargetTooYoung gate (resolves Q17 + B10)**: `target.age < ADULTHOOD_AGE_IN_YEARS` → reject.
  10. **TargetAlreadyMarried gate**: `target.marriageId !== null && marriage.dissolved === false` → reject.
  11. **PlayerAlreadyMarried gate (resolves FC2-B4)**: `playerHead.marriageId !== null && playerMarriage.dissolved === false` → reject. Symmetric with gate 10; prevents a married player head from proposing again and silently overwriting their existing marriage. Reads `state.characters.get(playerHeadId).marriageId` and `state.marriages.get(playerMarriageId).dissolved`.
  12. **InsufficientReputation gate**: player house reputation `< PROPOSAL_REPUTATION_THRESHOLD (40)` → reject.
  13. **InsufficientAffection gate**: affection of player head toward target `< AFFECTION_PROPOSAL_THRESHOLD (80, already at `constants.ts:133`)` → reject. Read from `state.affectionMap.get(makePairKey(PLAYER_HOUSE_ID, targetCharacterId))`.

  **Gates 1-13 reject WITHOUT advancing tick and WITHOUT advancing RNG.** (Resolves FC5-1-B1: gate numbering was 1-12 in earlier drafts; the addition of PlayerAlreadyMarried as gate 11 shifted the count to 13.) No tick cost paid; no scandal applied. Per CLAUDE.md atomic-gating non-negotiable: zero state mutation on rejection. The store wrapper does NOT call `advanceTickPure` on rejection paths.

  **Acceptance path (gates 1-13 all pass — resolves FC5-1-B1):**
  14. Draw 1 PRNG value from `state.rng.get(PLAYER_HOUSE_ID)` via `drawNext`. Compute `slope = PROPOSAL_ACCEPTANCE_FLOOR + (affection - 80) / 20 * (PROPOSAL_ACCEPTANCE_CEILING - PROPOSAL_ACCEPTANCE_FLOOR)`. At `affection = 80`, slope = 0.5; at `affection = 100`, slope = 0.95. **The `clamp [0, 1]` in spec line 334 is defensive — in the gated `[80, 100]` affection domain the slope cannot exceed 0.95.** The clamp is preserved in the pure-rule body but documented as dead-code-defensive (R12).
  15. If `draw < slope` → **Accepted branch:**
      - Apply rejection draw (always advance RNG, regardless of branch — single draw counts for both branches).
      - Create new `MarriageRecord` with `id = makeMarriageId(state, playerHeadId, targetCharacterId)`. **`makeMarriageId` is a NEW deterministic-id factory at `src/game/fixtures/marriageIdFactory.ts`** (resolves FC2-4-B1; mirrors the P5 `schemeIdFactory.ts`, P6 `whisperIdFactory.ts` / `courierPayloadIdFactory.ts` precedent). Format: `${lex-min}:${lex-max}:${tick}:${index}` where `index` counts existing marriages with the same `(spouseA, spouseB, marriedAtTick)` tuple — at v1 the index is effectively always 0 (a same-tick re-proposal between the same pair is blocked by the PlayerAlreadyMarried + TargetAlreadyMarried gates), but the index parameter keeps the factory robust to future redress flows. Body:
        ```ts
        // src/game/fixtures/marriageIdFactory.ts (NEW at P7):
        import type { GameState } from "../entities";
        import type { CharacterId, MarriageId } from "../rng";
        export function makeMarriageId(state: GameState, a: CharacterId, b: CharacterId): MarriageId {
          const [lex0, lex1] = a < b ? [a, b] : [b, a];
          let index = 0;
          for (const m of state.marriages.values()) {
            if (m.spouseAId === lex0 && m.spouseBId === lex1 && m.marriedAtTick === state.tick) {
              index += 1;
            }
          }
          return `${lex0}:${lex1}:${state.tick}:${index}` as MarriageId;
        }
        ```
        Then `spouseAId = lex-min(playerHeadId, targetCharacterId)`, `spouseBId = lex-max(...)`, `marriedAtTick = state.tick`, `dissolved = false`, `dissolvedAtTick = null`.
      - Update `state.marriages` Map.
      - Update both spouses' `marriageId` field.
      - Target flips to `role: "Spouse"` if previously Spinster/Dependent (per the role-assignment rules above).
      - **Dull-trait exposure detection:** if the player head carries Dull, set `target.dullSpouseExposureStartTick = state.tick`. If the target carries Dull, set `playerHead.dullSpouseExposureStartTick = state.tick`. Mutual Dull → both set.
      - Update `state.proposalsLog` with `{ outcome: "Accepted", tick: state.tick, byCharacterId: playerHeadId }` keyed on `targetCharacterId`.
      - Return `{ ok: true, accepted: true, marriageId, newRng, spouseRoleFlipped: targetCharacterId }`.
  16. If `draw >= slope` → **Rejected branch:**
      - Apply rejection draw.
      - Apply `+5 scandal` to player house (clamped `[0, 100]`).
      - Update `state.proposalsLog` with `{ outcome: "Rejected", tick: state.tick, byCharacterId: playerHeadId }`.
      - Return `{ ok: true, accepted: false, rngAfter, scandalDelta: PROPOSAL_REJECTION_SCANDAL_DELTA }`.

  **RNG draw budget (resolves B11 + FC5-1-B2 — disambiguates the two rejection paths):**
  - **Predicate-rejection path (gates 1-13 fail):** ZERO draws. Pre-call `state.rng.get(PLAYER_HOUSE_ID).callCount` equals post-call.
  - **Acceptance-roll path (gates 1-13 pass, draw advances RNG, `draw < slope` ⇒ accepted):** exactly 1 draw. Pre-call callCount + 1 equals post-call.
  - **Acceptance-roll path with rejection-on-roll (gates 1-13 pass, draw advances RNG, `draw >= slope` ⇒ rejected with +5 scandal):** ALSO exactly 1 draw. Same callCount delta as accepted; the draw is consumed regardless of accept/reject outcome at the roll.

  The two "rejection" paths are NOT monolithic: predicate-rejection draws zero; roll-rejection draws one. Asserted in `proposal.test.ts` with TWO separate fixtures.

  **Store-wrapper shape (CLAUDE.md pre-tick action pattern):**
  ```ts
  // src/game/store.ts (P7 ADDITION):
  proposeMarriage: (targetCharacterId: CharacterId) => {
    const state = get();
    // Exile gate at the TOP (CLAUDE.md non-negotiable — P6 pattern).
    // Shape verified against existing exile-gate publishes at store.ts:277-281
    // and the WhisperEvent union at runtime/events/whispers.ts:66
    // ({ kind: "PlayerExileBlocked"; tick: number; action: string }) — resolves B15.
    // Optional-chaining `?.exiled` matches the project convention at store.ts:276,
    // 295, 321, 357, 399, 429, 460, 791, 815, 844, 884, 902, 925 — resolves B24.
    if (state.houses.get(PLAYER_HOUSE_ID)?.exiled === true) {
      whisperBus.publish({ kind: "PlayerExileBlocked", tick: state.tick, action: "proposeMarriage" });
      return { ok: false, reason: { kind: "PlayerExiled" } } as ProposalOutcome;
    }
    const stateBefore = state;
    const { nextState, outcome } = applyProposalPure(state, targetCharacterId);
    if (!outcome.ok) {
      return outcome;
    }
    // Tick advance happens on BOTH accept and reject (consuming a tick was paid by reaching the end of all 13 gates). Resolves FC5-2-B2.
    // Resolves FC5-3-B1: advanceTickPure signature is (state) => state (single arg).
    const tickAdvanced = advanceTickPure(nextState);
    set((draft) => {
      overwriteFromGameState(draft, tickAdvanced);
    });
    // Publish post-await diff events.
    publishProposalOutcome(stateBefore, tickAdvanced, outcome);
    publishMarriageTransitions(stateBefore, tickAdvanced);
    publishTemptationLatchTransitions(stateBefore, tickAdvanced);
    publishCharacterDeaths(stateBefore, tickAdvanced);  // tick advance may have caused year-pass deaths
    publishWhisperTransitions(stateBefore, tickAdvanced);
    return outcome;
  },
  ```

  **Diff helpers fired from the proposeMarriage wrapper (resolves R9 + FC3-1-B3 — CANONICAL LIST, 5 publishers, all other body/prose/mirror references in this plan synchronize to this set):**
  1. `publishProposalOutcome` (NEW) — direct-publish of `ProposalAccepted` | `ProposalRejected` from the wrapper.
  2. `publishMarriageTransitions` (NEW) — covers the Marriage state machine's Active→Dissolved transitions during the tick advance.
  3. `publishTemptationLatchTransitions` (NEW) — covers `temptationHookUnlocked: false → true` transitions (a Dull-spouse proposal acceptance starts the exposure tick which itself does not flip the latch, but the SAME tick's happiness-phase step may; the publisher catches it).
  4. `publishCharacterDeaths` (existing P5) — year-pass deaths during tick advance.
  5. `publishWhisperTransitions` (existing P6) — same-tick whisper verifications + courier deliveries.

  `publishSchemeTransitions` is NOT fired from proposeMarriage (proposal is a non-scheme action; no scheme can resolve in the same-tick proposal-acceptance flow because scheme resolution is a separate phase). The store-wrapper body snippet earlier in this section matches this 5-publisher set exactly; any prose mentioning fewer or more publishers is the result of an earlier draft and supersedes by this canonical list.

- **Conception extension (resolves B6).** P1 ships `applyConceptionStep` returning children with `parentCharacterIds === undefined` (the field doesn't exist on P1's CharacterSchema). P7's primary edit to `applyConceptionStep` at `src/game/rules/conception.ts:140-159`:
  ```ts
  // conception.ts:140-159 BEFORE (verbatim from current source):
  const newCharId = childCharacterId(marriageId, state.tick, 0);
  const child: Character = {
    id: newCharId,
    /* ... existing P1 fields ... */
    marriageId: null,
  };

  // conception.ts AFTER P7 — add 7 V8 fields + parent edge + gender draw:
  // 6th draw: gender (after the 5 existing draws — 4 trait + 1 deathAge).
  const { next: genderRoll, rngState: postGender } = drawNext(rngState);
  rngState = postGender;
  const gender: "Female" | "Male" = genderRoll < 0.5 ? "Female" : "Male";
  // Lex-sort parents per spec convention (matches spouseAId/spouseBId).
  const parents: [CharacterId, CharacterId] = [marriage.spouseAId, marriage.spouseBId];
  const newCharId = childCharacterId(marriageId, state.tick, 0);
  const child: Character = {
    id: newCharId,
    /* ... existing P1 fields ... */
    marriageId: null,
    // P7 ADDITIONS:
    happiness: HAPPINESS_INITIAL,
    temptationHookUnlocked: false,
    assignedTutorCharacterId: null,
    tutorBonusTraitGranted: false,
    dullSpouseExposureStartTick: null,
    parentCharacterIds: parents,
    gender,
  };
  ```
  **What's NEW at P7 (the actual delta from P1):**
  - `parentCharacterIds` field on the child (enables `findAdultChildren` to return real candidates at succession step 3).
  - `gender` field on the child + the 6th PRNG draw per child.
  - 6 new V8-defaulted fields on the child entity shape.

  **What's UNCHANGED from P1:** the 2-year cadence (`YEARS_PER_CONCEPTION_CYCLE`), the fertility ceiling (`FERTILITY_CEILING_AGE`), the 4-draw trait inheritance, the lex-sort iteration over marriages. The R1 risk (restating existing behavior as new scope) is resolved by this section: P7's `In scope` correctly lists only the deltas.

  **Replay-harness fixture call-count update (resolves R13 + FC3-3-B3):** every existing test fixture that asserts post-conception `callCount` MUST add +1 per child for the gender draw. Specifically: `conception.test.ts`'s 2-marriage fixture expects `callCount` to increase by `(N children + 1 deathAge) * M marriages` — P7 changes the formula to `(4 trait + 1 deathAge + 1 gender) * M children fired`. The replay-harness test at **`src/game/replay-harness.test.ts`** (verified path) is updated to reflect the new per-conception draw count.

- **`findAdultChildren` real body (resolves B5, S5).** `src/game/rules/succession.ts:23` is currently a stub returning `[]`. P7 replaces with a real traversal:
  ```ts
  // src/game/rules/succession.ts AFTER P7:
  export function findAdultChildren(state: GameState, deadHeadId: CharacterId): Character[] {
    const candidates: Character[] = [];
    for (const [, c] of state.characters) {
      if (!c.alive) continue;
      if (c.age < ADULTHOOD_AGE_IN_YEARS) continue;
      if (c.parentCharacterIds === null) continue;
      if (!c.parentCharacterIds.includes(deadHeadId)) continue;
      // Children inherit the player house at conception (per conception.ts:124).
      // No need to filter by houseId here — the parent edge is the canonical
      // filter; cross-house children don't exist at P7.
      candidates.push(c);
    }
    // Deterministic order: lex-sort by character ID.
    candidates.sort((a, b) => a.id.localeCompare(b.id));
    return candidates;
  }
  ```
  **Determinism:** lex-sort by id matches the `state.characters` iteration discipline (CLAUDE.md "Lex-sort iteration over identifier Maps"). The first candidate is the promoted heir per the existing `succession.ts:77` `heir = adultChildren[0]` step. **No RNG draw** in `findAdultChildren` — the heir is determined by lex order, not random pick.

  **Succession step 3 now reaches children.** Pre-P7, `findAdultChildren` always returned `[]`, so any campaign where the family pool (step 2) was empty AND there was no adult sibling/spouse ended in the heirless terminal state even if the player had adult children. Post-P7, adult children inherit. **Heir-resolution priority remains family pool → adult children → heirless** (existing succession.ts ordering at lines 70-77); P7 changes only what `findAdultChildren` returns.

- **Archetype classification trigger walk (resolves B7).** Spec §10 line 489 + §10 Q4: classification fires at exactly TWO triggers:
  1. **At succession** (every surviving family member). `succession.ts:107-111` currently calls `classifyArchetype(heir)` only on the promoted heir. **P7 widens this** to recompute archetype for EVERY surviving family-house character — siblings, spinsters, dependents, the promoted heir. Patch at `succession.ts:107-114`:
     ```ts
     // P7 EDIT to processDeadHead — recompute archetype for every surviving
     // family member, not just the new heir.
     const newChars = new Map(state.characters);
     for (const [id, c] of state.characters) {
       if (c.houseId !== house.id) continue;
       if (!c.alive) continue;
       const promoted = id === heir.id;
       const updated: Character = {
         ...c,
         role: promoted ? "HeadOfHouse" : c.role,
         archetype: classifyArchetype(promoted ? { ...c, role: "HeadOfHouse" } : c),
       };
       newChars.set(id, updated);
     }
     ```
     The classification reads the post-promotion role for the new heir (per §3 "succession" trigger — the heir's role is now HeadOfHouse, which can't classify under any of the 4 branches but matters for the gender/marriage/trait reads).
  2. **At child maturation** (the maturating character ONLY — not all surviving family). NEW step at `src/game/rules/maturation.ts` (NEW module). Maturation runs in `runYearPass` between aging-step and succession-step (resolves B14). The full post-P7 STEPS order is **aging → maturation → succession → conception** (length 3 → 4). Justification for the position: (a) **aging-before-maturation** — aging increments age to 18, the boundary the maturation step detects; (b) **maturation-before-succession** — succession's `findAdultChildren` reads `age >= ADULTHOOD_AGE_IN_YEARS` and the maturating child should be promotable in the same year-pass as their parent's death; the maturation step ALSO flips role/archetype which succession then re-recomputes for survivor-side characters; (c) **succession-before-conception** — preserved from P1.

     **Concrete `yearPass.ts` STEPS array edit (verified against current source at `src/runtime/yearPass.ts:27-31`).** Current STEPS (P1 state, verbatim):
     ```ts
     // yearPass.ts:27-31 BEFORE P7 (verbatim — verified):
     const STEPS: readonly YearPassStep[] = [
       applyAgingStep,
       applySuccessionStep,
       applyConceptionStep,
     ] as const;
     ```
     After P7:
     ```ts
     // yearPass.ts:27-32 AFTER P7:
     const STEPS: readonly YearPassStep[] = [
       applyAgingStep,
       applyMaturationStep,    // NEW at P7
       applySuccessionStep,
       applyConceptionStep,
     ] as const;
     ```
     **Same-tick maturation-then-succession archetype-recompute is intentional** — the maturation step computes archetype for the maturating child; the succession step (which now recomputes archetype for EVERY surviving family member) then re-touches that same character. The recompute is idempotent (same input → same output), so the double-compute produces no state divergence; it costs ~5 µs at run-time. The clarity benefit (each step owns its trigger; the §3 Q4 "two trigger points" reads naturally) outweighs the perf cost.

     **`applyMaturationStep` full body (resolves B19 — no more placeholder):**
     ```ts
     // src/game/rules/maturation.ts (NEW):
     import { ADULTHOOD_AGE_IN_YEARS } from "../constants";
     import type { Character, GameState } from "../entities";
     import { ARCHETYPE_MATURATION_TRAIT_POOL, classifyArchetype } from "../fixtures/archetypes";
     import { INDEPENDENT_HOUSE_ID, PLAYER_HOUSE_ID } from "../rng";
     import type { Role } from "../fixtures/roles";

     // Role-decision branch — applies the role-assignment rules from the Roles
     // section of plans/phases/07-family-succession.md. Pure function on a single
     // Character; reads no GameState (no parent-aliveness lookup needed at v1).
     function computeMaturationRole(c: Character): Role {
       // Branch 1: cross-house / orphaned → Exile.
       if (c.houseId !== PLAYER_HOUSE_ID && c.houseId !== INDEPENDENT_HOUSE_ID) {
         return "Exile";
       }
       // Branch 2: unwed adult female → Spinster.
       if (c.gender === "Female" && c.marriageId === null) {
         return "Spinster";
       }
       // Branch 3: unwed adult male with Bohemian-trait set → Bohemian.
       if (
         c.gender === "Male" &&
         c.marriageId === null &&
         (c.traits.includes("Frivolous") || c.traits.includes("Romantic") || c.traits.includes("Jaded"))
       ) {
         return "Bohemian";
       }
       // Else: keep Dependent (default for unwed adults without bohemian markers).
       return "Dependent";
     }

     export function applyMaturationStep(state: GameState): GameState {
       let newChars = state.characters;
       let touched = false;
       const pendingChoices = new Map(state.pendingTutorTraitChoices);
       const sortedCharIds = [...state.characters.keys()].sort();  // lex-sort per CLAUDE.md
       for (const charId of sortedCharIds) {
         // Resolves FC3-1-B2: read from the per-iteration accumulator newChars
         // (not state.characters) so multi-sibling iterations observe each
         // prior iteration's role/archetype mutations. Mirrors the
         // applyStaffOutputsPhase "per-iteration multi-Map accumulator"
         // convention in CLAUDE.md non-negotiables.
         const c = newChars.get(charId);
         if (c === undefined || !c.alive) continue;
         // Aging-step incremented age this year-pass; detect exact-equals
         // boundary so the step fires ONCE per character per campaign.
         if (c.age !== ADULTHOOD_AGE_IN_YEARS) continue;

         const newRole = computeMaturationRole(c);
         const reclassified = classifyArchetype({ ...c, role: newRole });

         // Pending tutor-trait choice: only if assignedTutor still set AND
         // tutor's archetype gives a non-null pool. The orphan-prune cascade
         // in aging-step has ALREADY nulled c.assignedTutorCharacterId if the
         // tutor died this same year-pass (so reading the field here is the
         // post-prune state). The dead-`tutorAlive: false` branch is therefore
         // unreachable in v1's same-year-pass flow — kept as defensive guard
         // against (a) cross-tick paths where a tutor dies between assignment
         // and maturation outside the aging step, and (b) a future-phase code
         // path that mutates assignedTutorCharacterId without running the
         // orphan-prune (none exist at v1; defensive only). Resolves FC2-3-B2.
         // ADDITIONAL INVARIANT (resolves FC6-3-B1): `tutorChar` reads from
         // `state.characters` not `newChars` because the tutor is NEVER the
         // maturing character `c` (assignTutor rejects TutorIsSelf), AND no
         // sibling-iteration step in this loop can mutate another character's
         // `assignedTutorCharacterId` field (the loop only mutates `role` +
         // `archetype` per-character). If a future-phase year-pass step
         // touches `assignedTutorCharacterId` mid-step, this lookup MUST
         // migrate to `newChars`.
         const tutorChar = c.assignedTutorCharacterId !== null
           ? state.characters.get(c.assignedTutorCharacterId)
           : undefined;
         const tutorAlive = tutorChar !== undefined && tutorChar.alive;
         const tutorArchetype = tutorAlive ? tutorChar.archetype : "None";
         const pool = ARCHETYPE_MATURATION_TRAIT_POOL[tutorArchetype];
         const pendsChoice = tutorAlive && pool !== null && c.assignedTutorCharacterId !== null;

         if (!touched) {
           newChars = new Map(state.characters);
           touched = true;
         }
         newChars.set(charId, { ...c, role: newRole, archetype: reclassified });
         if (pendsChoice) {
           pendingChoices.set(charId, {
             childId: charId,
             tutorId: c.assignedTutorCharacterId!,
             archetype: tutorArchetype,
             acceptableTraitIds: pool!,
             createdAtTick: state.tick,
           });
         }
         // If no choice pends, tutorBonusTraitGranted stays false (no bonus).
       }
       // Resolves FC2-3-B3: dropping the size-equality early-return path
       // (entry-swap with equal sizes would silently pass that check). When
       // `touched` is false, we ALSO know pendingChoices is unchanged because
       // pendingChoices is only mutated INSIDE the same `if (pendsChoice)`
       // branch that sets `touched = true`. So `!touched` implies both
       // newChars === state.characters AND pendingChoices === state.pendingTutorTraitChoices.
       if (!touched) return state;
       return { ...state, characters: newChars, pendingTutorTraitChoices: pendingChoices };
     }
     ```
     **Draw budget for `applyMaturationStep`: ZERO** (resolves R23). No `drawNext` calls; the step is fully deterministic given the input state. A future v1.5 path that adds a random-archetype-traitPool-pick branch would need to add a draw + bump the save version.

     **Age-boundary invariant (resolves B22).** The `c.age !== ADULTHOOD_AGE_IN_YEARS` exact-equals check is fragile against any future code path that double-increments age in the same year-pass. **Pinned phase invariant:** `applyAgingStep` (at `src/game/rules/aging.ts:77-103`) is the SOLE path that increments `Character.age`, and it always increments by exactly 1 per year-pass call. No other rule, action, or migration touches `Character.age`. **Vitest guard:** new test `maturation.test.ts` includes an "age-increment invariant" fixture that runs `runYearPassPure(state)` and asserts every alive character's age increased by exactly 1 (or stayed unchanged if dead). Test asserts that the same fixture run twice doesn't double-skip a maturation event (each character matures exactly once when they cross 18). The invariant is documented inline at `applyAgingStep`'s top-of-function comment and at `applyMaturationStep`'s exact-equals check.

  **No mid-life classifier triggers** (§10 Q4 resolution). The classifier is NOT called on trait acquisition (no trait-acquisition action ships at P7 anyway), is NOT called on role flip (the marriage-acceptance role flip from Spinster → Spouse does NOT recompute archetype — the latch is "succession + maturation only"). A future v1.5 feature that adds mid-life trait acquisition would either: (a) accept the staleness, or (b) bump the save version and add an explicit reclassify call.

- **Tutor assignment and trait choice actions.** Two new player-elected actions, neither tick-advancing (matches P5's free-action `startScheme`/`cancelScheme` pattern):
  - **`assignTutor(childCharacterId: CharacterId, tutorCharacterId: CharacterId)`** — assigns or reassigns the tutor of a non-adult child. Pure rule + free-action wrapper.
    - **Predicate order:**
      1. PlayerExiled gate.
      2. Child exists, alive, age < ADULTHOOD_AGE_IN_YEARS, houseId === PLAYER_HOUSE_ID.
      3. Tutor exists, alive, houseId === PLAYER_HOUSE_ID, archetype !== "None" (only classified family members can tutor — spec §3 line 470 implies this by listing per-archetype trait pools).
      4. Tutor !== Child (no self-tutoring).
      5. **If this is a reassignment** (`tutorAssignmentsLog.has(childId)` — the log entry's existence IS the "previously assigned" signal; resolves FC2-3-B1 by replacing the undefined `childTutorCount` identifier with the documented Map predicate): require `playerHouse.wealth >= TUTOR_REASSIGNMENT_WEALTH_COST` (5). If not satisfied, reject `{ kind: "InsufficientWealth", current: x, required: 5 }` — **atomic gating: do NOT deduct on rejection**. (Resolves R3, R4.)
    - **Effect:** set `child.assignedTutorCharacterId = tutorCharacterId`; update `state.tutorAssignmentsLog[childId]` (increment reassignmentCount); on reassignment, deduct `TUTOR_REASSIGNMENT_WEALTH_COST` from player wealth. **Spec line 651 read directly: post-adulthood reassignment rejection deducts no wealth**; the gate at predicate 2 (age < ADULTHOOD_AGE_IN_YEARS) is checked BEFORE the wealth deduction at predicate 5.
    - **Rejection union:** `{ kind: "PlayerExiled" } | { kind: "ChildNotFound" } | { kind: "ChildDead" } | { kind: "ChildAlreadyAdult" } | { kind: "ChildNotPlayerHouse" } | { kind: "TutorNotFound" } | { kind: "TutorDead" } | { kind: "TutorNotPlayerHouse" } | { kind: "TutorNotClassified" } | { kind: "TutorIsSelf" } | { kind: "InsufficientWealth"; current: number; required: number }`.
    - **NOT tick-advancing.** No PRNG draws. No tick consumed.
  - **`chooseTutorBonusTrait(childCharacterId: CharacterId, chosenTraitId: TraitId)`** — picks one of the two trait pool options at child maturation. Free action (no tick cost).
    - **Predicate order:**
      1. PlayerExiled gate.
      2. `state.pendingTutorTraitChoices.has(childId)` — pending choice exists.
      3. `chosenTraitId` is in the entry's `acceptableTraitIds` tuple — gate against arbitrary-trait injection.
      4. Child is alive (defensive — the choice survives across tick boundaries; child could die between maturation and pick).
    - **Effect:** append `chosenTraitId` to `child.traits` (if not already present — **silent no-op on duplicate** per the dedup decision; resolves C-fc2-10. The `traits` array is display-ordered so appending preserves insertion order while skipping duplicates avoids reordering the existing list); set `child.tutorBonusTraitGranted = true`; remove the entry from `state.pendingTutorTraitChoices`.
    - **Rejection union:** `{ kind: "PlayerExiled" } | { kind: "NoPendingChoice" } | { kind: "InvalidTrait"; valid: readonly TraitId[] } | { kind: "ChildDead" }`.
    - **NOT tick-advancing.** No PRNG draws.

  **Atomic gating on both actions matches CLAUDE.md non-negotiable §5.** A wealth-cost-on-reassignment rejection does NOT deduct wealth; a trait-pool-mismatch rejection does NOT append a trait. Tests assert this directly with pre/post wealth + traits comparisons.

- **Tutor death orphan-prune cascade (resolves R14, B18, FC2-B3).** When a tutor character dies (year-pass aging or assassination), every child with `assignedTutorCharacterId === deadTutorId` has the field nulled. This is a new branch added to the existing `pruneOrphanedConversationKeys` helper at `src/game/rules/aging.ts:40-75`. **No separate `pruneOrphanedTutorAssignments` helper is created** — the tutor-prune logic lives inside `pruneOrphanedConversationKeys` per the P5/P6 precedent (one canonical death-cascade site, extended branch-by-branch). Every plan reference to "pruneOrphanedTutorAssignments" SHOULD READ "extension to pruneOrphanedConversationKeys."

  **Caller enumeration for `newlyDeadCharIds` (resolves FC2-4-B2).** Every death-producing site at P7-or-later MUST feed `newlyDeadCharIds` to `pruneOrphanedConversationKeys` so the new branches (tutor-prune + Dull-exposure prune + marriage dissolution) fire correctly. The complete current caller list:
  - `applyAgingStep` (`src/game/rules/aging.ts:77-103`) — year-pass age-deaths. Already calls the helper at line 102.
  - Assassination resolver in `src/game/rules/schemes.ts` (Seduction-discovery + Assassination completion). Already calls the helper.

  **Future-phase deaths** (out of P7 scope but enforced by convention): P8 duel deaths MUST funnel through `pruneOrphanedConversationKeys`; P11 sibling-rival kills likewise. Any code path that flips `Character.alive: false` without calling this helper silently leaks dissolution + orphan-prune state. **Enforcement at P7**: a new lint-style boundary test at `src/game/death-cascade.test.ts` greps for all sites that mutate `c.alive = false` and asserts they import + call `pruneOrphanedConversationKeys`. NEW Vitest at P7. **The existing helper returns the new state directly via object literal — there is no intermediate `nextState` variable**, contrary to a previous plan draft. Verified current-source shape:
  ```ts
  // src/game/rules/aging.ts:40-75 CURRENT (verbatim — P6 state):
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
    let whispersChanged = false;
    const newWhispers = new Map(state.whispers);
    for (const [id, w] of newWhispers) {
      if (
        newlyDeadCharIds.has(w.subjectCharacterId) &&
        w.status !== "Weaponized" &&
        w.status !== "Dismissed"
      ) {
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
  **P7 patch** — extend the function body with two new branches (tutor-assignment prune + Dull-spouse exposure prune) and merge the new characters Map into the final return object. Each branch uses its OWN lazy-clone flag (distinct names — `tutorAssignmentChanged`, `dullExposureChanged` — to avoid the variable-reuse confusion called out in B18). Both branches operate on the SAME `newChars` accumulator (a single clone of `state.characters` shared across both branches; the per-branch flag tracks "did this branch mutate"):
  ```ts
  // src/game/rules/aging.ts:40-75 AFTER P7:
  export function pruneOrphanedConversationKeys(
    state: GameState,
    newlyDeadCharIds: ReadonlySet<CharacterId>,
  ): GameState {
    if (newlyDeadCharIds.size === 0) return state;
    // ... existing histFiltered / affFiltered / whispersChanged logic UNCHANGED ...

    // P7 BRANCH 1: tutor assignment prune. Every child whose
    // assignedTutorCharacterId references a dead tutor has the field nulled.
    // The child does NOT lose tutorBonusTraitGranted (a previously-granted
    // bonus persists past tutor death). If maturation hasn't fired yet, the
    // pending-choice slot will see `tutorAlive === false` at maturation and
    // skip the bonus.
    let charactersChanged = false;
    let newChars = state.characters;
    for (const [id, c] of state.characters) {
      if (c.assignedTutorCharacterId !== null && newlyDeadCharIds.has(c.assignedTutorCharacterId)) {
        if (!charactersChanged) {
          newChars = new Map(state.characters);
          charactersChanged = true;
        }
        newChars.set(id, { ...c, assignedTutorCharacterId: null });
      }
    }

    // P7 BRANCH 2: Dull-spouse exposure prune. When a Dull spouse dies, the
    // surviving character's dullSpouseExposureStartTick is nulled (happiness
    // drain stops). Reads from the BRANCH-1 newChars (or unchanged
    // state.characters if branch 1 didn't fire) so the same character's
    // assignedTutorCharacterId reset isn't clobbered.
    for (const [id, c] of newChars) {
      if (c.dullSpouseExposureStartTick === null) continue;
      if (c.marriageId === null) continue;
      const marriage = state.marriages.get(c.marriageId);
      if (marriage === undefined || marriage.dissolved) continue;
      const spouseId = marriage.spouseAId === id ? marriage.spouseBId : marriage.spouseAId;
      if (!newlyDeadCharIds.has(spouseId)) continue;
      if (!charactersChanged) {
        newChars = new Map(state.characters);
        charactersChanged = true;
      }
      const existing = newChars.get(id) ?? c;
      newChars.set(id, { ...existing, dullSpouseExposureStartTick: null });
    }

    return {
      ...state,
      conversationHistory: histFiltered,
      affectionMap: affFiltered,
      ...(whispersChanged ? { whispers: newWhispers } : {}),
      ...(charactersChanged ? { characters: newChars } : {}),
    };
  }
  ```
  The two branches share `charactersChanged` + `newChars` so a single clone of `state.characters` covers both prunes — no double-clone overhead. The branch-2 read from `newChars` (not `state.characters`) is load-bearing so a character whose tutor died AND whose Dull spouse died in the same year-pass gets BOTH fields cleared (each branch reads the latest accumulator).

- **Happiness drift step (per-tick rule — resolves R7, R8).** NEW step `applyHappinessStep` at `src/game/rules/happiness.ts` (NEW module). Inserted into `tickOrchestrator.ts`'s `PHASES` array. **Phase-order discipline (CLAUDE.md):** the PHASES array is the determinism contract. P1 froze the array; subsequent phases insert REPLACING identity stubs.
  - **Phase slot for happiness step (resolves B13).** The spec's tick order (§3 "Tick-Driven Time Advancement") lists: time advance → economy → courier draining → scheme resolution → global-event roll → mood drift → rival action roll. **Happiness drift is not explicitly listed in §3** — it's a P7 addition. The deterministic-discipline question is where to insert it without perturbing earlier seeded outcomes. Resolution: **happiness drift runs AFTER mood drift and BEFORE the rival-action stub** (slot 8 of the post-P7 9-slot array). Justification: (a) happiness reads no RNG (deterministic threshold check), so it cannot perturb the rival roll; (b) happiness is independent of mood-lock (the latch flips even on locked characters); (c) inserting between mood and rival keeps the §3 ordering intact for §3-listed phases AND honors the CLAUDE.md non-negotiable "Rivals always run last."

    **Concrete `tickOrchestrator.ts` PHASES array edit (verified against current source at `src/runtime/tickOrchestrator.ts:40-49`).** Current PHASES (P6 state, verbatim):
    ```ts
    // tickOrchestrator.ts:40-49 BEFORE P7 (verbatim — verified):
    const PHASES: readonly TickPhase[] = [
      advanceTickPhase,                 // 1. time advance
      applyEconomyPhase,                // 2. economy
      applyLocationEffectsPhase,        // 3. location effects (NEW at P3)
      applyCourierAndStaffPhase,        // 4. courier + verify + staff (NEW at P6)
      applySchemeResolutionPhase,       // 5. scheme resolution (P5)
      identityPhase,                    // 6. global-event roll (P1 stub)
      applyMoodDriftPhase,              // 7. mood drift
      identityPhase,                    // 8. rival-house action roll (P1 stub — ALWAYS last)
    ] as const;
    ```
    After P7 (insert `applyHappinessPhase` between mood drift and the rival-action stub):
    ```ts
    // tickOrchestrator.ts:40-50 AFTER P7:
    const PHASES: readonly TickPhase[] = [
      advanceTickPhase,                 // 1. time advance
      applyEconomyPhase,                // 2. economy
      applyLocationEffectsPhase,        // 3. location effects (P3)
      applyCourierAndStaffPhase,        // 4. courier + verify + staff (P6)
      applySchemeResolutionPhase,       // 5. scheme resolution (P5)
      identityPhase,                    // 6. global-event roll (P1 stub; P13 implementation)
      applyMoodDriftPhase,              // 7. mood drift
      applyHappinessPhase,              // 8. happiness drift (NEW at P7)
      identityPhase,                    // 9. rival-house action roll (P1 stub; P8 implementation — ALWAYS last)
    ] as const;
    ```
    P7's `applyHappinessPhase` REPLACES no stub — it's a genuinely new slot. The PHASES array length goes from 8 → 9. **The CLAUDE.md "Rivals always run last" determinism contract holds:** rival-action stub remains at the terminal position; happiness sits in front of it.

    **PHASES.length assertion strategy (resolves R29).** There is NO module-load `if (PHASES.length !== N)` assertion in the current `tickOrchestrator.ts`; the array length is enforced indirectly via the test-side `phaseOrderTracker` infrastructure exercised by `monarchsAudience.test.ts` and similar ordering tests. P7 does NOT add a module-load assertion — instead, the new `applyHappinessPhase` reaching the array is enforced by `tickOrchestrator.test.ts` asserting `PHASES` contains the new function reference (via `runOrchestratorWithPhases` injection) AND by `replay-harness.test.ts` reaching the new slot deterministically across 30 runs.

  - **Happiness drift body:**
    ```ts
    // src/game/rules/happiness.ts (NEW):
    export function applyHappinessPhase(state: GameState): GameState {
      const newChars = new Map(state.characters);
      let touched = false;
      // Lex-sort iteration over characters (CLAUDE.md "Lex-sort iteration").
      const sortedCharIds = [...state.characters.keys()].sort();
      for (const charId of sortedCharIds) {
        const c = state.characters.get(charId);
        if (c === undefined || !c.alive) continue;
        // Dull-spouse drain: applies if dullSpouseExposureStartTick is non-null
        // AND the live spouse currently carries Dull. The double-check protects
        // against a stale exposure tick that survived orphan-prune.
        let happinessAfter = c.happiness;
        if (c.dullSpouseExposureStartTick !== null && c.marriageId !== null) {
          const marriage = state.marriages.get(c.marriageId);
          if (marriage !== undefined && !marriage.dissolved) {
            const spouseId = marriage.spouseAId === c.id ? marriage.spouseBId : marriage.spouseAId;
            const spouse = state.characters.get(spouseId);
            if (spouse !== undefined && spouse.alive && spouse.traits.includes("Dull")) {
              happinessAfter = clamp(happinessAfter + HAPPINESS_DULL_SPOUSE_DRAIN_PER_TICK, 0, 100);
            }
          }
        }
        // Temptation latch: one-way, flips false → true on first sub-threshold tick.
        let latchAfter = c.temptationHookUnlocked;
        if (!latchAfter && happinessAfter < HAPPINESS_TEMPTATION_THRESHOLD && c.dullSpouseExposureStartTick !== null) {
          latchAfter = true;
        }
        if (happinessAfter !== c.happiness || latchAfter !== c.temptationHookUnlocked) {
          if (!touched) { touched = true; }
          newChars.set(charId, { ...c, happiness: happinessAfter, temptationHookUnlocked: latchAfter });
        }
      }
      if (!touched) return state;
      return { ...state, characters: newChars };
    }
    ```
    **Determinism:** no PRNG draws; happiness drift is a pure deterministic computation. The latch flip happens on the same tick the threshold is crossed; replay-equivalence is exact.

  - **Temptation latch bus-event (resolves R8):** when the latch flips false→true, the diff helper publishes `TemptationUnlocked` per character. NEW event variant in `src/runtime/events/family.ts` (NEW module — see Events section). Publisher walks `before.characters` vs `after.characters` for `temptationHookUnlocked: false → true` transitions.

- **Events module: `src/runtime/events/family.ts` (NEW — resolves R16).** Family-domain bus events. Mirrors the P5/P6 domain-partition pattern.
  ```ts
  // src/runtime/events/family.ts (NEW at P7):
  export type FamilyEvent =
    | { kind: "ProposalAccepted"; proposerId: CharacterId; targetId: CharacterId; marriageId: MarriageId; tick: number }
    | { kind: "ProposalRejected"; proposerId: CharacterId; targetId: CharacterId; scandalDelta: number; tick: number }
    | { kind: "MarriageDissolved"; marriageId: MarriageId; deceasedSpouseId: CharacterId; survivingSpouseId: CharacterId | null; tick: number }
    | { kind: "TutorAssigned"; childId: CharacterId; tutorId: CharacterId; reassignmentCount: number; tick: number }
    | { kind: "TutorTraitGranted"; childId: CharacterId; traitId: TraitId; tick: number }
    | { kind: "ChildMatured"; childId: CharacterId; newRole: Role; newArchetype: Archetype; tick: number }
    | { kind: "TemptationUnlocked"; characterId: CharacterId; tick: number }
    | { kind: "ArchetypeReclassified"; characterId: CharacterId; from: Archetype; to: Archetype; trigger: "Succession" | "Maturation"; tick: number };

  // Verified against existing buses (bus.ts:20, conversation.ts:87, location.ts:32,
  // whispers.ts:68, scheme.ts:82) — class-based EventBus instantiation; resolves FC2-7-B1.
  export const familyBus = new EventBus<FamilyEvent>();
  ```
  **Bus-publish discipline (P3/P6 pattern):** events fire from store-action wrappers, AFTER `set()` returns. NEVER from inside the orchestrator's phase chain. The publishers:
  - `publishProposalOutcome(stateBefore, stateAfter, outcome)` — emits Accepted or Rejected (called by `proposeMarriage` wrapper).
  - `publishMarriageTransitions(stateBefore, stateAfter)` — diff-walks `state.marriages` for `dissolved: false → true` transitions; emits `MarriageDissolved`. **Predicate (resolves FC2-4-S5):** `before.get(mid)?.dissolved === false && after.get(mid)?.dissolved === true` (strict false → true; an already-dissolved marriage that gets rewritten does NOT re-publish; a brand-new marriage with `dissolved: true` from inception cannot exist because the proposal acceptance path sets `dissolved: false`). Called by every tick-advancing wrapper (per P5/P6 precedent — same shape as `publishWhisperTransitions`).
  - `publishTemptationLatchTransitions(stateBefore, stateAfter)` — diff-walks `state.characters` for `temptationHookUnlocked: false → true` transitions; emits `TemptationUnlocked`. Called by every tick-advancing wrapper.
  - `publishChildMaturationTransitions(stateBefore, stateAfter)` — diff-walks `state.characters` for role/archetype changes during the maturation step; emits `ChildMatured` AND `ArchetypeReclassified` (the latter with `trigger: "Maturation"`).
  - `publishArchetypeReclassificationsFromSuccession(stateBefore, stateAfter)` — fires from the year-pass wrapper after succession runs; emits `ArchetypeReclassified` with `trigger: "Succession"` for every character whose archetype changed in the succession step.
  - `publishTutorAssignments(stateBefore, stateAfter)` — fires from the `assignTutor` wrapper; emits `TutorAssigned`.
  - `publishTutorTraitGrants(stateBefore, stateAfter)` — fires from the `chooseTutorBonusTrait` wrapper; emits `TutorTraitGranted`.

  **Skip-rule pattern (P6 precedent):** the `proposeMarriage` wrapper direct-publishes its own `ProposalAccepted` / `ProposalRejected` AND calls `publishMarriageTransitions` (because the tick advance may have driven a year-pass death-driven dissolution). The 3rd-arg skip-rule lets the wrapper pass `new Set(["proposal:" + targetId])` to prevent double-publish. Default 3rd arg is the module-level `EMPTY_KEYS` constant per P6.

  **`runYearPass` store-wrapper edits (resolves FC2-4-B4 + FC3-2-B1 publisher-list sync rationale).** The existing `runYearPass` wrapper at `src/game/store.ts:293-314` currently publishes `publishCharacterDeaths` + `publishWhisperTransitions`. **P7 extends to a 6-publisher list — DIFFERENT from proposeMarriage's 5-publisher canonical list (resolves FC3-2-B1 divergence rationale):** runYearPass runs all three year-pass STEPS (aging → maturation → succession → conception) and thus must publish `publishChildMaturationTransitions` + `publishArchetypeReclassificationsFromSuccession`. These two publishers are NOT fired from proposeMarriage because proposal's `advanceTickPure` does not invoke the year-pass STEPS; it only advances tick-phase orchestrator phases (which never reclassify archetype and never mature children). The asymmetry is intentional and load-bearing. **Canonical 6-publisher list for runYearPass:**
  ```ts
  // src/game/store.ts:293-314 AFTER P7:
  runYearPass: () => {
    const stateBefore = get();
    if (stateBefore.houses.get(PLAYER_HOUSE_ID)?.exiled === true) {
      whisperBus.publish({ kind: "PlayerExileBlocked", tick: stateBefore.tick, action: "runYearPass" });
      return;
    }
    const next = runYearPassPure(stateBefore);
    set((draft) => { overwriteFromGameState(draft, next); });
    // Existing P5/P6 publishers:
    publishCharacterDeaths(stateBefore, next);
    publishWhisperTransitions(stateBefore, next);
    // P7 ADDITIONS:
    publishMarriageTransitions(stateBefore, next);
    publishTemptationLatchTransitions(stateBefore, next);
    publishChildMaturationTransitions(stateBefore, next);
    publishArchetypeReclassificationsFromSuccession(stateBefore, next);
  },
  ```
  **`publishSchemeTransitions` stays excluded from `runYearPass`** — schemes resolve in tick-phase, not year-pass. The exclusion is the existing P5/P6 precedent; P7 does not change it. STEPS.length 3→4 (aging → maturation → succession → conception) inside `runYearPassPure` is documented at the yearPass.ts STEPS edit above; the store-wrapper edit here is the bus-publish accompaniment.

  **`advanceTick` store-wrapper extension (resolves FC3-2-B2 + FC3-3-B1 — canonical 5-publisher list, INCLUDING `publishSchemeTransitions`):**
  ```ts
  // src/game/store.ts (advanceTick wrapper AFTER P7):
  advanceTick: () => {
    const stateBefore = get();
    if (stateBefore.houses.get(PLAYER_HOUSE_ID)?.exiled === true) {
      whisperBus.publish({ kind: "PlayerExileBlocked", tick: stateBefore.tick, action: "advanceTick" });
      return;
    }
    const next = advanceTickPure(stateBefore);
    set((draft) => { overwriteFromGameState(draft, next); });
    // Canonical advanceTick publisher list (5): scheme resolution runs in
    // tick-PHASES slot 5 (P5), so publishSchemeTransitions MUST fire here.
    // Resolves FC3-3-B1 (dropped publishSchemeTransitions was accidental).
    publishMarriageTransitions(stateBefore, next);
    publishTemptationLatchTransitions(stateBefore, next);
    publishCharacterDeaths(stateBefore, next);
    publishSchemeTransitions(stateBefore, next);
    publishWhisperTransitions(stateBefore, next);
  },
  ```
  **Note on `publishMarriageTransitions` from advanceTick at v1 (resolves FC5-1-B4):** at v1 there are no tick-phase marriage dissolutions (rivals + duels ship at P8; tick-phase Assassination of a spouse routes the death through `pruneOrphanedConversationKeys` which dissolves the marriage AND publishes the transition via the post-set call below). The `publishMarriageTransitions` call from advanceTick therefore fires ZERO events for the typical v1 player; it is load-bearing for P8 (rival-driven duel-killing of a spouse) and P8+ Assassination-of-spouse paths where the dissolution diff must reach the bus. Keeping the publisher in v1 prevents a P8-implementer from forgetting to add it.

  **The asymmetry by wrapper (corrected at FC3-3, extended at FC5-3-B2):**
  - `proposeMarriage`: 5 publishers (proposalOutcome + marriageTransitions + temptationLatchTransitions + characterDeaths + whisperTransitions). NO `publishSchemeTransitions` because proposal doesn't invoke scheme resolution.
  - `advanceTick`: 5 publishers (marriageTransitions + temptationLatchTransitions + characterDeaths + schemeTransitions + whisperTransitions). Scheme resolution runs in tick-PHASES slot 5.
  - **`travel` / `requestAudience` / `escapeBankruptcy` / `refreshWardrobe` (existing P3 tick-advancing wrappers at `src/game/store.ts:319/355/397/427`)**: each extends to ADD `publishMarriageTransitions` + `publishTemptationLatchTransitions` after the existing publisher calls. **Justification (resolves FC5-3-B2):** all four wrappers invoke `advanceTickPure`, which runs the full tick PHASES chain (including `applyHappinessPhase` slot 8 — which can flip the temptation latch — and `applySchemeResolutionPhase` slot 5 — which can kill characters via Assassination, cascading marriage dissolution through `pruneOrphanedConversationKeys` branch 3). Without these two publishers added to the four P3 wrappers, a marriage dissolved DURING a travel/audience/bankruptcy/wardrobe action would not emit `MarriageDissolved` to `familyBus`, AND a temptation latch flipped during the same action would not emit `TemptationUnlocked`. The extension is a uniform 2-line addition per wrapper. After P7 the 4 P3 wrappers publish (existing P3-P6 set) + marriageTransitions + temptationLatchTransitions; baseline publisher counts per wrapper post-P7 are wrapper-specific (verify per-wrapper in implementation).
  - `runYearPass`: 6 publishers (adds `publishChildMaturationTransitions` + `publishArchetypeReclassificationsFromSuccession` — year-pass-only events; also keeps schemeTransitions OFF since schemes resolve in tick-phase not year-pass).
  - **The 4 baseline publishers (`publishMarriageTransitions` + `publishTemptationLatchTransitions` + `publishCharacterDeaths` + `publishWhisperTransitions`) ride on EVERY tick-advancing wrapper (advanceTick + the four P3 wrappers + proposeMarriage + the appropriate subset on runYearPass).** `publishSchemeTransitions` rides on `advanceTick` + the four P3 wrappers (NOT proposeMarriage, NOT runYearPass). `publishProposalOutcome` rides only on `proposeMarriage`. `publishChildMaturationTransitions` + `publishArchetypeReclassificationsFromSuccession` ride only on `runYearPass`.

- **`PERSONA_CACHE_VERSION` bump (resolves R15).** `buildPersonaPrompt` at `src/llm/prompts/persona.ts` extends to surface marriage status and happiness to the LLM so persona-driven dialogue reflects the post-P7 state. Per CLAUDE.md "Persona prompt format version bump (P6 LLM-cache discipline)": bump `PERSONA_CACHE_VERSION` in `src/game/constants.ts` from `"v2"` to `"v3"`. New format adds two paragraphs:
  - Marriage status (married to X / unmarried / widowed).
  - Happiness state (happy / discontent / unlocked-temptation).

  **Persona prompt body literal extension (resolves C-fc2-22 / C-fc3-9 / C-fc4-7 — pinned via verified `persona.ts:36-58` shape).** The `buildPersonaPrompt` body at `src/llm/prompts/persona.ts:36-58` composes a `baseLines: string[]` array (lines 42-48) then conditionally appends scene-composition lines (53-56). **P7 ADDS two new lines INSIDE `baseLines`, immediately AFTER the existing Archetype line and BEFORE the "Reply in character" closing line** (so the new fields sit alongside Mood + Archetype as descriptive facts, not at scene-level). Literal new lines:
  ```ts
  // src/llm/prompts/persona.ts AFTER P7 — INSIDE baseLines, between archetype + reply:
  baseLines.push(`Archetype: ${target.archetype}.`);                                              // existing
  baseLines.push(formatMarriageStatusLine(target, state));                                         // NEW at P7
  baseLines.push(formatHappinessLine(target));                                                     // NEW at P7
  baseLines.push("Reply in character. Keep your replies brief and period-appropriate.");          // existing
  ```
  with helpers (declared in `persona.ts` above `buildPersonaPrompt`):
  ```ts
  // Literal templates pinned at P7 — text is part of the persona-prompt cache key.
  function formatMarriageStatusLine(target: Character, state: GameState): string {
    if (target.marriageId === null) return "Marriage status: unmarried.";
    const m = state.marriages.get(target.marriageId);
    if (m === undefined || m.dissolved) return "Marriage status: widowed.";
    const spouseId = m.spouseAId === target.id ? m.spouseBId : m.spouseAId;
    const spouse = state.characters.get(spouseId);
    const spouseName = spouse?.name ?? "(unknown)";
    return `Marriage status: married to ${spouseName}.`;
  }
  function formatHappinessLine(target: Character): string {
    if (target.temptationHookUnlocked) return "Happiness: discontent — has felt the temptation.";
    if (target.happiness >= 70) return "Happiness: content.";
    if (target.happiness >= 30) return "Happiness: subdued.";
    return "Happiness: discontent.";
  }
  ```
  **Why `state: GameState` is a new param on the marriage helper:** marriage lookup needs the marriages Map + the spouse character. `buildPersonaPrompt` is called from `src/llm/cache.ts` (per the file's top comment); the caller already has state and passes it through. Adding the `state` param matches the existing pattern at the call-site, NOT a contract widening of buildPersonaPrompt's purpose.

  **`persona.test.ts` extension (resolves C-fc2-22 missing fixture):** add fixtures asserting:
  - Unmarried character → output includes `"Marriage status: unmarried."`
  - Married character → output includes `"Marriage status: married to <spouse.name>."`
  - Widowed character (marriageId non-null, marriage.dissolved === true) → output includes `"Marriage status: widowed."`
  - Happy character (happiness 70+, latch false) → `"Happiness: content."`
  - Latch-true character → `"Happiness: discontent — has felt the temptation."`

  **`ROLE_LABELS` extension (resolves FC2-6-B1 + FC3-2-B3 — ADD-ONLY, no rewrites).** The existing `ROLE_LABELS: Readonly<Record<Role, string>>` at `src/llm/prompts/persona.ts:28-33` carries label text for the 4 P1 roles (verified prose: `"a head"`, `"an heir"`, `"a member"`, `"a spouse"`). P7 widens ROLES (4 → 7); TypeScript strict mode REJECTS compilation of `persona.ts` until the record is extended. **The existing 4 labels' prose is PRESERVED verbatim** — P7 only ADDS three new entries. Prior plan drafts that rewrote the existing labels' prose are superseded:
  ```ts
  // src/llm/prompts/persona.ts:28-33 AFTER P7:
  const ROLE_LABELS: Readonly<Record<Role, string>> = {
    // EXISTING 4 labels — PROSE UNCHANGED from src/llm/prompts/persona.ts:28-32:
    HeadOfHouse: "a head",
    Heir: "an heir",
    Dependent: "a member",
    Spouse: "a spouse",
    // P7 ADDITIONS — new labels for the 3 new roles; PERSONA_CACHE_VERSION
    // bump covers cache invalidation for any prose-touching consumer:
    Spinster: "a spinster",
    Exile: "an exile",
    Bohemian: "a bohemian",
  };
  ```
  **No player-visible rewrite to the 4 existing labels.** The PERSONA_CACHE_VERSION bump is justified by the NEW marriage-status + happiness paragraphs that `buildPersonaPrompt` appends (see persona prompt format addition below), NOT by changes to the role-label table itself.
  **Vitest at `src/llm/prompts/persona.test.ts`** asserts `ROLE_LABELS` has exactly `ROLES.length` (7) keys and every `Role` value maps to a non-empty string. Without this assertion, a future ROLES enum widening (P11 sibling-rival) could silently TypeScript-compile if the strict `Record<Role, string>` invariant relaxed via index signature.

  The cache invalidates automatically; returning players with cached personas miss to the new format.

**Out of scope.**
- **Sibling-rival promotion at succession** — P11. The `findAdultChildren` and succession step at P7 do NOT promote any sibling/dependent to autonomous-rival status; that's spec §3 line 480-485's "sibling-rival action roller" which lives at P11.
- **Inherited-secrets transfer at succession** — P11.
- **Dynasty perks** — P15.
- **Cross-house marriages with rival NPCs** — v1.5 (§10 Q16 deferral; gate at P7 returns `CrossHouseMarriageNotSupported` for non-PLAYER/non-INDEPENDENT targets, exercised by synthetic-house test fixture).
- **Pre-adulthood betrothals** — v1.5 (§10 Q17 deferral).
- **Trait-modifier lifespans** — v1.5 (§10 Q18 deferral; P1's `LIFESPAN_RANGE` distribution intact).
- **Tutor reassignment after maturation** — P7 rejects with `ChildAlreadyAdult`; the spec's "locked at adulthood" is the latch.
- **Re-widowing role flip** (Spouse → Spinster on partner death) — not implemented at v1.

**Spec refs (with line numbers).**
- §3 "Marriage, Conception & Succession" — spec lines 92-102.
- §3 "Family Archetype Auto-Classification" — spec lines 225-230.
- §3 "Tutor Influence" — spec lines 232-238.
- §3 "Happiness Drain From Dull-Spouse Marriages" — spec lines 465-469.
- §3 "Tutor Influence" (detailed rules) — spec lines 471-476.
- §3 "Family Archetype Auto-Classification" (rules block) — spec lines 487-496.
- §3 "Marriage, Conception & Inheritance" (detailed rules) — spec lines 331-339.
- §3 "Succession" — spec lines 341-347.
- §4 "Child Record" — spec line 547.
- §4 "Character" (role + archetype fields) — spec line 540.
- §7 "Sibling-rival promotion of a corpse" — spec line 650 (out of scope; P11).
- §7 "Tutor reassignment after maturation" — spec line 651.
- §7 "Conversation history orphan keys" — spec line 654 (extends with tutor + dull-exposure prunes).
- §10 Q4 — classification recompute timing (resolved here).
- §10 Q16/Q17/Q18/Q23 — resolved here.

**Machines.**
- **Marriage** (Active → Dissolved). Triggered by either spouse's death (`alive: false`). **The dissolution path at P7 (resolves FC2-B1):** pre-P7, `succession.ts` step 4 dissolves marriages ONLY when the dead character is a HEAD; a non-head spouse's death currently leaves `marriage.dissolved: false` indefinitely (verified at `src/game/rules/aging.ts:77-103` — aging does NOT touch `state.marriages`). **P7 ADDS a THIRD branch to `pruneOrphanedConversationKeys` (after the tutor-prune branch + Dull-exposure branch) that dissolves marriages whose either spouse has died:**
  ```ts
  // src/game/rules/aging.ts (P7 ADDITION — branch 3 of pruneOrphanedConversationKeys):
  let marriagesChanged = false;
  let newMarriages = state.marriages;
  for (const [mid, m] of state.marriages) {
    if (m.dissolved) continue;
    if (newlyDeadCharIds.has(m.spouseAId) || newlyDeadCharIds.has(m.spouseBId)) {
      if (!marriagesChanged) {
        newMarriages = new Map(state.marriages);
        marriagesChanged = true;
      }
      newMarriages.set(mid, { ...m, dissolved: true, dissolvedAtTick: state.tick });
    }
  }
  // The final return object includes: ...(marriagesChanged ? { marriages: newMarriages } : {})
  ```
  **Eliminates the dissolution gap.** The succession step-4 explicit dissolution at `succession.ts:48-58` becomes a redundant no-op (the marriage is already dissolved when succession runs) — safe to leave as defensive redundant. The `publishMarriageTransitions` diff helper now correctly fires for BOTH head-deaths AND non-head spouse-deaths. **NOT** implemented as an XState actor — `Marriage.dissolved` is a boolean field on the entity, NOT a literal state machine actor.
- **Archetype classification** is a pure function (`classifyArchetype`), NOT a machine. Twice-recomputed at the two triggers; no actor.
- **Tutor assignment** is a field on Character + a log entry; NOT a machine. The assign/reassign/choose-trait actions mutate the field; no state-machine-style transitions.

**Edge cases (§7).**
- **§7 line 650 "Sibling-rival promotion of a corpse"** — sibling-rivals are P11; not exercised at P7. P7's `findAdultChildren` filters by `alive: true` so a sibling who died in the same tick as the head can never be promoted (resolves the corpse edge case for the children path, ahead of P11's siblings).
- **§7 line 651 "Tutor reassignment after maturation"** — P7 ships the rejection branch `ChildAlreadyAdult` BEFORE the wealth deduction; the atomic-gating Vitest fixture asserts pre-rejection wealth equals post-rejection wealth.
- **§7 line 654 "Conversation history orphan keys"** — `pruneOrphanedConversationKeys` extended at P7 with tutor-assignment prune + Dull-exposure prune (see above).
- **§7 "Affection/Composure mutation from multiple sites"** — proposal mutates affection (no — proposal READS affection; it doesn't mutate; rejection's `+5 scandal` mutates SCANDAL not affection). The edge case applies to existing P4/P5 mutation sites; P7 doesn't introduce new affection-mutation sites. **CLARIFICATION TO THE EDGE CASE FROM THE ORIGINAL PLAN:** the prior listing was over-broad; P7 mutates only `scandal`, `happiness`, `temptationHookUnlocked`, `marriageId`, `dissolved`, `assignedTutorCharacterId`, `tutorBonusTraitGranted`, `dullSpouseExposureStartTick`, `pendingTutorTraitChoices`, `tutorAssignmentsLog`, `proposalsLog`, `role`, `archetype`. Each mutation site re-applies the appropriate clamps.
- **NEW edge case: Same-tick maturation and parent-death.** A child can mature in the same year-pass as their parent's death. Order: aging (parent dies) → maturation (child age crosses 18) → succession (heir promoted from family pool first, then child pool). The classifyArchetype call on the maturating child reads the post-aging state (parent dead — but children don't gate on parent-aliveness). Succession reads the post-maturation state (child is now adult and eligible). The ordering is deterministic and the Vitest fixture exercises it.
- **NEW edge case: Tutor dies the same tick the child matures.** Order: aging (tutor dies) → orphan-prune (`assignedTutorCharacterId` nulled) → maturation. At maturation, `tutorAlive === false` → no pending choice created → `tutorBonusTraitGranted` stays false permanently. Verified by Vitest fixture.

**Constants summary** — all values pinned in `src/game/constants.ts`:
- `HAPPINESS_INITIAL = 100`
- `HAPPINESS_TEMPTATION_THRESHOLD = 30`
- `HAPPINESS_DULL_SPOUSE_DRAIN_PER_TICK = -1`
- `AFFECTION_PROPOSAL_THRESHOLD = 80` (REUSED — already at constants.ts:133; the canonical name. P7 does NOT introduce `PROPOSAL_AFFECTION_THRESHOLD` — that earlier-draft name is retired across the plan body.)
- `PROPOSAL_REPUTATION_THRESHOLD = 40`
- `PROPOSAL_ACCEPTANCE_FLOOR = 0.5`
- `PROPOSAL_ACCEPTANCE_CEILING = 0.95`
- `PROPOSAL_REJECTION_SCANDAL_DELTA = 5`
- `PROPOSAL_TICK_COST = 1`
- `SEDUCTION_DISCOVERY_SCANDAL = 25` (retroactive P5 baseline, applied at `schemes.ts:410`)
- `TEMPTATION_DISCOUNTED_SCANDAL = 5`
- `TUTOR_REASSIGNMENT_WEALTH_COST = 5`
- `TUTOR_GUIDE_OPINION_COOLDOWN_TICKS = 10`
- `TUTOR_GUIDE_OPINION_MOOD_TARGET: Mood = "Receptive"`
- `PERSONA_CACHE_VERSION` bump: `"v2"` → `"v3"` (resolves the carried-over R41/R12).

**Verification (Vitest).**

**NEW Vitest files at P7 (resolves FC5-1-B3 — enumerated to remove implementer guesswork):**
- `src/game/rules/proposal.test.ts` — proposal action body (gates 1-13, draw budget for both rejection paths, acceptance branch state mutations, marriage record construction, role flip, Dull-spouse exposure tick).
- `src/game/rules/happiness.test.ts` — applyHappinessPhase drift over multi-tick, latch one-way persistence, Dull-spouse-death halts drift, no-spouse no-drift.
- `src/game/rules/maturation.test.ts` — applyMaturationStep age-equals-18 boundary, role assignment, archetype reclassify, pending choice creation, tutor-dies-same-year edge case, multi-sibling iteration order.
- `src/game/rules/assignTutor.test.ts` — assignTutor predicates + rejection union, atomic gating on InsufficientWealth (pre-rejection wealth equals post), reassignment count increment.
- `src/game/rules/chooseTutorBonusTrait.test.ts` — predicates + rejection union, trait append + flag flip, pendingChoice consumed.
- `src/game/fixtures/marriageIdFactory.test.ts` — deterministic ID factory, same-pair-same-tick index increment, lex-sort.
- `src/game/fixtures/hashCharIdToGender.test.ts` — golden-output pairs for 5 baseline NPCs + player-head, FNV-1a constants stability.
- `src/game/death-cascade.test.ts` — every site that flips `Character.alive = false` imports + calls `pruneOrphanedConversationKeys` (lint-style boundary test).
- `src/persist/migrations/v7-to-v8.test.ts` — migration unit test (legacy V7 fixtures → V8 with V8 fields defaulted).
- `src/persist/migrations/v7-to-v8.idempotence.test.ts` — assertMigrationIdempotent harness.
- `src/persist/migrations/v1-to-v8-chain.test.ts` — full chain regression + hash parity to createInitialState.

**Extended Vitest files (existing files with new test cases at P7):**
- `src/game/rules/conception.test.ts` — parent-edge assertion, gender draw assertion, callCount + 6 per child.
- `src/game/rules/succession.test.ts` — findAdultChildren real body, succession widened recompute, multi-eligible-heir lex-sort.
- `src/game/replay-harness.test.ts` — callCount budget updates for gender draw per child.
- `src/runtime/tickOrchestrator.test.ts` — applyHappinessPhase at slot 8 verified via phaseOrderTracker function-reference identity check.
- `src/runtime/yearPass.test.ts` — applyMaturationStep at STEPS index 1 (between aging and succession).
- `src/persist/save-roundtrip.test.ts` — V8 round-trip with all new Character fields preserved.
- `src/persist/dexie.test.ts` — InvalidSaveSchemaError fires on V8-malformed input; MigrationFailedError fires when V7 source is malformed.
- `src/game/store.replace-state.test.ts` — three new it() blocks for proposalsLog/tutorAssignmentsLog/pendingTutorTraitChoices write-through.
- `src/llm/prompts/persona.test.ts` — ROLE_LABELS completeness against ROLES.length; marriage/happiness paragraphs present (per the formatMarriageStatusLine/formatHappinessLine helper output table above).

**ESLint boundary positive-control extensions (resolves C-fc2-27 — verified against `eslint/boundaries.test.ts:43-100` positive-control pattern).** Three new positive-control cases added to the existing `describe("positive controls — cross-element permission pins", ...)` block in `eslint/boundaries.test.ts`, mirroring the existing `runtime-tick-orchestrator → game-rules is permitted` shape:
```ts
// eslint/boundaries.test.ts (NEW positive controls at P7):
it("game-rules/proposal can import constants + entities + rng + fixtures", async () => {
  const source = `import { AFFECTION_PROPOSAL_THRESHOLD } from "../constants";\nimport type { GameState } from "../entities";\nimport { PLAYER_HOUSE_ID } from "../rng";\nimport { makeMarriageId } from "../fixtures/marriageIdFactory";\nexport function x() { return AFFECTION_PROPOSAL_THRESHOLD; }\n`;
  const result = await lint(source, "src/game/rules/proposal.ts");
  const fired = result.messages.some((m) => m.ruleId === "boundaries/element-types");
  expect(fired).toBe(false);
});
it("game-rules/happiness can import constants + entities", async () => {
  const source = `import { HAPPINESS_TEMPTATION_THRESHOLD } from "../constants";\nimport type { GameState } from "../entities";\nexport function x() { return HAPPINESS_TEMPTATION_THRESHOLD; }\n`;
  const result = await lint(source, "src/game/rules/happiness.ts");
  const fired = result.messages.some((m) => m.ruleId === "boundaries/element-types");
  expect(fired).toBe(false);
});
it("game-rules/maturation can import constants + entities + fixtures/archetypes + fixtures/roles", async () => {
  const source = `import { ADULTHOOD_AGE_IN_YEARS } from "../constants";\nimport type { Character } from "../entities";\nimport { classifyArchetype } from "../fixtures/archetypes";\nimport type { Role } from "../fixtures/roles";\nexport function x() { return ADULTHOOD_AGE_IN_YEARS; }\n`;
  const result = await lint(source, "src/game/rules/maturation.ts");
  const fired = result.messages.some((m) => m.ruleId === "boundaries/element-types");
  expect(fired).toBe(false);
});
```
The synthetic-source-string pattern matches `eslint/boundaries.test.ts:17-23` `lint(source, filePath)` helper.

**`assignTutor` + `chooseTutorBonusTrait` store-wrapper snippets (resolves C-fc5-5 — verified against P5 `startScheme`/`cancelScheme` precedent at `src/game/store.ts:789-840`).** Both are free actions (no `advanceTickPure` call):
```ts
// src/game/store.ts (NEW at P7):
assignTutor: (childCharacterId: CharacterId, tutorCharacterId: CharacterId) => {
  const state = get();
  if (state.houses.get(PLAYER_HOUSE_ID)?.exiled === true) {
    return { ok: false, reason: { kind: "PlayerExiled" as const } };
  }
  const result = applyAssignTutorPure(state, childCharacterId, tutorCharacterId);
  if (!result.ok) return { ok: false, reason: result.reason };
  set((draft) => {
    overwriteFromGameState(draft, result.state);
  });
  familyBus.publish({
    kind: "TutorAssigned",
    childId: childCharacterId,
    tutorId: tutorCharacterId,
    reassignmentCount: result.reassignmentCount,
    tick: state.tick,
  });
  return { ok: true };
},
chooseTutorBonusTrait: (childCharacterId: CharacterId, chosenTraitId: TraitId) => {
  const state = get();
  if (state.houses.get(PLAYER_HOUSE_ID)?.exiled === true) {
    return { ok: false, reason: { kind: "PlayerExiled" as const } };
  }
  const result = applyChooseTutorBonusTraitPure(state, childCharacterId, chosenTraitId);
  if (!result.ok) return { ok: false, reason: result.reason };
  set((draft) => {
    overwriteFromGameState(draft, result.state);
  });
  familyBus.publish({
    kind: "TutorTraitGranted",
    childId: childCharacterId,
    traitId: chosenTraitId,
    tick: state.tick,
  });
  return { ok: true };
},
```
**No `publishMarriageTransitions` / `publishTemptationLatchTransitions` / etc. on these free-action wrappers** — they are non-tick-advancing and cannot drive marriage dissolutions, death cascades, or latch flips (those require tick-phase or year-pass execution).

**Zero-firing publisher Vitests (resolves C-fc6-2 + C-fc6-9):** under `src/game/store.test.ts` (or co-located file), add cases asserting v1 common-path produces no events for the dormant publishers:
```ts
it("travel publishes zero MarriageDissolved events at v1 (no marriages dissolve mid-travel)", () => {
  const before = createInitialState(...);
  const sub = jest.fn();
  familyBus.subscribe("MarriageDissolved", sub);
  store.travel("Estate");
  expect(sub).not.toHaveBeenCalled();
});
it("proposeMarriage publishes zero TemptationUnlocked events at v1 (proposal doesn't drift happiness)", () => {
  const sub = jest.fn();
  familyBus.subscribe("TemptationUnlocked", sub);
  store.proposeMarriage(targetId);
  expect(sub).not.toHaveBeenCalled();
});
```
Repeated for `requestAudience`, `escapeBankruptcy`, `refreshWardrobe`, `advanceTick`. The cases lock in the load-bearing-for-P8 wiring at v1.

**Triple-concurrent `pruneOrphanedConversationKeys` fixture (resolves C-fc6-3):** under `src/game/rules/aging.test.ts` (existing file), add a fixture exercising all three new branches in one year-pass:
```ts
it("triple-concurrent: tutor + Dull-spouse + non-head spouse all die same year-pass", () => {
  // Synthetic state: a player-house Dependent child with assignedTutorCharacterId
  // referencing a tutor whose age equals deathAge (will die this year-pass);
  // child also has a Dull-spouse with dullSpouseExposureStartTick set, where
  // the Dull spouse's age also equals deathAge; AND a third character (a
  // non-head sibling) married to the tutor, whose marriage will dissolve when
  // the tutor dies.
  const state = buildTripleConcurrentFixture();
  const after = runYearPassPure(state);
  // Branch 1: child's assignedTutorCharacterId nulled.
  expect(after.characters.get(childId)!.assignedTutorCharacterId).toBeNull();
  // Branch 2: child's dullSpouseExposureStartTick nulled.
  expect(after.characters.get(childId)!.dullSpouseExposureStartTick).toBeNull();
  // Branch 3: tutor's marriage dissolved.
  expect(after.marriages.get(tutorMarriageId)!.dissolved).toBe(true);
});
```
The fixture forces all three branches to execute in a single year-pass; the shared `charactersChanged` + `marriagesChanged` accumulators must compose correctly.

**Bootstrap-vs-FNV cross-check Vitest (resolves C-fc6-5):** under `src/game/fixtures/npcs.test.ts` (existing or new) — loop the bootstrap path and assert FNV parity:
```ts
it("buildBaselineNpcCharacter gender matches hashCharIdToGender(seed.id) for every baseline NPC", () => {
  for (const seed of BASELINE_NPCS) {
    const built = buildBaselineNpcCharacter(seed);
    expect(built.gender).toBe(hashCharIdToGender(seed.id));
  }
});
it("bootstrap player character gender matches hashCharIdToGender(STARTING_HEAD_CHARACTER_ID)", () => {
  const { characters } = seedStartingFamily(seedRng);
  const player = characters.find((c) => c.id === STARTING_HEAD_CHARACTER_ID)!;
  expect(player.gender).toBe(hashCharIdToGender(STARTING_HEAD_CHARACTER_ID));
});
```
The cross-check guards the v1→v8 chain hash parity: if either path drifts from FNV-1a, the chain test fails AND this localized test pinpoints which path drifted.

**ProposalRejection 12-variant minimum-state fixtures (resolves C-fc3-6 + C-fc3-16):** the predicate-by-predicate gates (1-13 in body) each map to one rejection variant. Pinned fixture state per variant:

| Gate # | Rejection variant | Minimum synthetic state |
|---|---|---|
| 1 | `PlayerExiled` | `state.houses.get(PLAYER_HOUSE_ID).exiled = true` |
| 2 | `PlayerHeadDead` | Player head's `alive: false`; no succession run between death and proposal |
| 3 | `TargetNotFound` | Call with arbitrary `"nonexistent" as CharacterId`; state.characters lookup returns undefined |
| 4 | `TargetDead` | Target character's `alive: false` |
| 5 | `TargetExiled` | Target's `house.exiled = true` (synthetic third house at `"rivalA" as HouseId`) |
| 6 | `TargetIsPlayerHead` | Pass the player head's own id as target |
| 7 | `TargetIsSameHouse` | Target's `houseId === PLAYER_HOUSE_ID` (sibling/dependent of player) |
| 8 | `CrossHouseMarriageNotSupported` | Target's `houseId === "rivalA"` (synthetic non-PLAYER/non-INDEPENDENT) |
| 9 | `TargetTooYoung` | Target's `age < ADULTHOOD_AGE_IN_YEARS` (e.g., age 17) |
| 10 | `TargetAlreadyMarried` | Target's `marriageId !== null`, marriage not dissolved |
| 11 | `PlayerAlreadyMarried` | Player head's `marriageId !== null`, marriage not dissolved |
| 12 | `InsufficientReputation` | Player house's `reputation < 40` (e.g., 30) |
| 13 | `InsufficientAffection` | `affectionMap[playerHeadId|targetId] < 80` (e.g., 70) |

Each fixture is a builder function (e.g., `buildPlayerExiledFixture()`) that returns a minimum GameState; the `proposal.test.ts` body iterates the 13 variants via `it.each([fixturesAndExpectedRejection])` for compact coverage. **All 13 fixtures assert:** (a) returned `outcome.ok === false`; (b) returned `outcome.reason.kind === <expected>`; (c) `stateAfter.tick === stateBefore.tick` (no tick advance on rejection); (d) `stateAfter.rng.get(PLAYER_HOUSE_ID).callCount === stateBefore.rng.get(PLAYER_HOUSE_ID).callCount` (no RNG draw on predicate rejection); (e) `stateAfter.houses.get(PLAYER_HOUSE_ID).scandal === stateBefore.houses.get(PLAYER_HOUSE_ID).scandal` (no scandal applied on predicate rejection).
- **Proposal slope at boundaries:** `proposal.test.ts` asserts acceptance probability is exactly 0.5 at affection=80 and exactly 0.95 at affection=100 (the formula's two endpoints). At affection between 80 and 100, the value lies strictly inside `[0.5, 0.95]`.
- **Proposal full rejection-union coverage:** one Vitest per rejection variant (12 variants from the union → 12 fixtures). Each asserts the pre-rejection state equals post-rejection state for ALL fields except possibly `temptationHookUnlocked` (which isn't proposed-on but is checked-on); no wealth deducted, no scandal applied, no tick advanced, no RNG drawn.
- **Proposal RNG draw budget:** `expect(stateAfter.rng.get(PLAYER_HOUSE_ID).callCount).toBe(stateBefore.rng.get(PLAYER_HOUSE_ID).callCount + 1)` on accepted/rejected paths; equal on rejection paths.
- **PlayerExiled gate on proposal:** asserts the gate at the top rejects pre-exile-flip; tested by setting `state.houses.get(PLAYER_HOUSE_ID).exiled = true` then calling `proposeMarriage`.
- **CrossHouseMarriageNotSupported gate:** uses synthetic third-house fixture (`"rivalA" as HouseId`) with one synthetic NPC; assertion: rejection with `kind: "CrossHouseMarriageNotSupported"`.
- **Conception extension:** `conception.test.ts` extended with parent-edge assertion (child's `parentCharacterIds` equals `[lex-min(spouseA, spouseB), lex-max(...)]`) and gender draw assertion (rngState.callCount incremented by 6, not 5, per child).
- **`findAdultChildren` real body:** synthetic state with 2 children (one adult, one minor) of a dead head → returns the adult; lex-sort assertion when both are adult.
- **Archetype classification body:** one Vitest per branch (Spymaster, BohemianRake, Tutor, CountryExile, None) plus boundary cases (Spinster role + no qualifying trait → None; role priority via first-match-wins).
- **Archetype classification at succession:** synthetic state where multiple surviving family members classify differently after succession; asserts every member's archetype field is post-classify.
- **Archetype classification at maturation:** synthetic state where a child crosses 18 with an assigned Spymaster tutor → ends up with a pending choice; the chooseTutorBonusTrait action validates the chosen trait is in the pool.
- **Tutor reassignment cost gate:** `assignTutor.test.ts` — pre-adult child + insufficient wealth → rejection without deduction; adult child → rejection without deduction; sufficient wealth → deduction + assignment.
- **Tutor death orphan-prune:** synthetic state with a tutor + child; kill tutor via year-pass; assert `child.assignedTutorCharacterId === null` post-cascade.
- **Happiness drift over multi-tick fixture:** synthetic state with Dull spouse; advance 71 ticks; assert happiness drains from 100 to 29 (clamped at 0 floor never breached); temptation latch flips at tick 71 (when happiness crosses 30 → 29 since predicate is strict `<` per applyHappinessPhase body).
- **Temptation latch one-way persistence:** synthetic state with latch=true at tick T; advance to tick T+50 with happiness restored to 100 (e.g., Dull spouse dies); assert latch remains true.
- **Dull-spouse death halts drift:** synthetic state with Dull spouse; kill Dull spouse; assert `dullSpouseExposureStartTick === null` and subsequent ticks don't drain happiness.
- **Save-roundtrip V8:** `save-roundtrip.test.ts` asserts `fromSaveV8(toSaveV8(state)) deep-equals state` for every new field.
- **Migration v7→v8 idempotence:** via `assertMigrationIdempotent` helper.
- **Migration v1→v8 full chain:** `v1-to-v8-chain.test.ts` exercises every step; parity-invariant assertion on hash.
- **Strip-on-emit cascade:** `schema.ts` test asserts `toSaveV7(state).characters` contains zero V8 fields (the strip works).
- **Replay-harness call-count post-conception:** updated to account for gender draw (+1 per child).
- **Marriage diff publisher:** dissolution events fire on year-pass death.
- **Tutor-trait pool source-of-truth:** the `ARCHETYPE_MATURATION_TRAIT_POOL` constant is the source for both the maturation step and the `chooseTutorBonusTrait` validation; one Vitest asserts both consumers read from the same constant (no duplication drift).
- **PHASES verification (resolves FC3-3-B2 — drops the contradictory module-load assertion claim):** `tickOrchestrator.test.ts` confirms `applyHappinessPhase` is reachable at the expected position via `runOrchestratorWithPhases` injection — function-reference identity, NOT array-length assertion. PHASES remains module-private per the existing `tickOrchestrator.ts:62-65` comment block; no `.length === N` check.

**Resolved decisions (§10).**

- **#4 — Archetype reclassification on mid-life trait acquisition: NO.** Already resolved at P1 ([phases/01-tick-engine.md](./01-tick-engine.md) §10 Q4) — P1 stubbed `classifyArchetype()` returning `"None"`, invoked from succession only. **P7 implements the full rule body** per spec §3 line 496. The two trigger points are: (a) succession — recompute for every surviving family-house character; (b) child maturation — recompute for the maturing child only. No per-tick recompute; no on-trait-grant recompute. Locks the determinism contract: classification is stable between triggers.
- **#16 — Cross-house marriages with rival-house NPCs: DEFERRED to v1.5.** P7's proposal target validation REJECTS rival-house characters with `{ kind: "CrossHouseMarriageNotSupported" }`. INDEPENDENT_HOUSE_ID is NOT rival → Independent NPCs ARE valid targets at P7. P8 widens the rejection to include rival-house IDs.
- **#17 — Pre-adulthood betrothals: DEFERRED to v1.5.** P7 ships marriage with `requires both parties age >= ADULTHOOD_AGE_IN_YEARS` at proposal-rule entry; pre-adulthood targets get rejection `{ kind: "TargetTooYoung" }`.
- **#18 — Per-character rolled lifespans: ALREADY SHIPPED at P1** (`LIFESPAN_RANGE = [70, 95]`, uniform-integer-in-range). P7's child-creation path follows the existing pattern. **Trait modifiers NOT shipped at P7.**
- **#23 — Dull-spouse temptation hook: AUTO-UNLOCK on threshold crossing.** One-way latch on Character; gates discounted-scandal Seduction via `TEMPTATION_DISCOUNTED_SCANDAL = 5` (vs new `SEDUCTION_DISCOVERY_SCANDAL = 25` baseline P7 retro-introduces at `schemes.ts:410`).

**Close out.** When the gates and verification items above are green, run `/close-phase P7` to update phase status in `plans/MASTER.md` §6, append to `plans/SESSION-NOTES.md`, resolve any open questions answered during the work, apply any `CLAUDE.md` additions, and commit the changes (no push).

## Accumulated Risks & Suggestions

*Passively collected from review cycles. Not blockers. Triaged at convergence.*

**Triage summary (FC7 post-loop).** Of the 166 items below, the vast majority (~135) were folded into body during the convergence loop's iterations (each `[Cn]` / `[C-fcN-M]` typically represents a single reviewer-flagged concern, many of which were directly addressed by a subsequent iteration's blocker resolution). The remaining ~30 items split between "Note for implementer" (handle in-situ without plan changes) and "Recommend fixing before implementation" (concrete gaps). Per-item categorization in the report below the plan; most plan-side edits are already applied; remaining items are advisory.

- [C1] Conception every-2-years is already shipped at P1; plan should state what changes at P7 vs what is restated for context.
- [C1] Tutor guide-opinion cooldown name, unit (ticks vs years), mutation target (mood? affection? happiness?), and PRNG draw count are unpinned.
- [C1] Tutor reassignment wealth cost is named but not valued; rejection path for insufficient wealth is unstated.
- [C1] Spec line 651 says wealth cost is NOT deducted on post-adulthood reassignment reject; plan must pin order (gate before deduction).
- [C1] Spec refs cite section names only, no line numbers; add line numbers (spec lines 489-496 classification, 465-469 happiness, 471-476 tutor, 530 proposal formula).
- [C1] Vitest inventory missing: tutor-reassign rejection without cost-deduction, happiness drift multi-tick fixture, temptation latch save round-trip + one-way persistence, proposal RNG draw-count assertion, archetype classification at child maturation, findAdultChildren returning real children.
- [C1] Happiness drift step location (per-tick PHASES vs per-year-pass STEPS) is unpinned; per-tick is the natural reading of spec line 468.
- [C1] Temptation latch flip site and PRNG interaction need pinning; hash-relevant boolean; publish discipline (TemptationUnlocked bus event) needed.
- [C1] New proposal action wrapper must enumerate which existing diff publishers it fires.
- [C1] Idempotent seeder helper for character-additive fields needs naming (parallel to seedSchemesAndGrievancesIntoLegacyState).
- [C1] Proposal targeting an already-married target — implicit rejection variant TargetAlreadyMarried needs declaration.
- [C1] The clamped [0,1] in acceptance probability formula is dead code in [80,100] affection domain (max is 0.95); clarify intent.
- [C1] PRNG draw-budget extension for replay harness fixture call-count is unaddressed; P7's proposal + tutor + maturation draws must update those expectations explicitly.
- [C1] Orphan-prune cascade for tutor assignments (when tutor dies, assignedTutorCharacterId references go stale) not in plan; pruneOrphanedConversationKeys is the canonical helper, needs extension.
- [C1] Persona prompt may need to surface marriage/happiness for in-character behavior; if so, PERSONA_CACHE_VERSION must bump per CLAUDE.md LLM specifics.
- [C1] Bus-event domain partition for marriage lifecycle: spec §3 names Marriage state machine but no runtime/events/marriage.ts exists; pin whether dissolution events ride on publishCharacterDeaths or get their own module.
- [C1] Spec line 470's discounted scandal-risk penalty attaches to Seduction discovery branch but P5 ships no scandal on discovery; plan must add the missing P5 mutation site or clarify what "discounted" means.
- [C1] Strip-on-emit edit scoped only to live-adjacent legacy versions: when CharacterSchema widens, every toSaveVN emitter calling serializeRegistry(state.characters) (V2/V3/V4/V5/V6/V7) inherits the strip requirement; plan must enumerate all 6 strip sites.
- [C1] Move Q4/Q23/Q16/Q17/Q18 rationale paragraphs out of plan body and into plans/SESSION-NOTES.md (or tighten to one sentence each).
- [C1] Add a Schema-extension diff block subsection collecting every schema/projection/selector/overwrite/createInitialState/migration edit in one place with literal one-line diffs.
- [C1] Enumerate all four archetypes' 2-option trait pools verbatim as ARCHETYPE_MATURATION_TRAIT_POOL constant — "etc." in current bullet is doing too much.
- [C1] Add Canonical Types table listing every new type (ChildRecord/parent edges, ProposalRejection variants, MarriageEvent variants, TutorAssignment fields) with home, Zod schema home, consumer list.
- [C1] Pin the real findAdultChildren body signature: (state: GameState, deadHeadId: CharacterId): Character[] filtering by parent-edge.
- [C1] Tighten "Out of scope" — clarify whether tutor-trait-pool draw timing is P7 (at assignment) or v1.5.
- [C1] Walk every existing diff helper (publishCharacterDeaths, publishSchemeTransitions, publishWhisperTransitions) and explicitly state which fire from the new proposal action wrapper.
- [C1] "Affection/Composure mutation from multiple sites" edge case too generic — pin the specific new mutation site (proposal action mutates affectionMap on rejection's scandal increment? on acceptance setting marriageId?).
- [C2] PERSONA_CACHE_VERSION value bump target unspecified — name the target ("v3" is the natural choice but should be pinned literally).
- [C2] Strip-on-emit cascade requires atomic edit of SaveV7Schema AND toSaveV7; if implementer updates schema without updating emitter, migrate_v6_to_v7 runner step fails at first chain test.
- [C2] SaveV5Schema / SaveV6Schema not verified to route through CharacterPreV5Schema — implementer must audit each SaveVNSchema body at edit time.
- [C2] Per-iteration multi-Map accumulator pattern (CLAUDE.md P6) not called out for proposal — worth a one-line callout for future "arrange marriage chain" extensions.
- [C2] applyMaturationStep's draw count is implicit-zero — pin "ZERO draws at P7" explicitly so future trait-pool-randomization branch doesn't silently add draws.
- [C2] Gender draw replay-harness fixture update hedged ("verify in implementation") — resolve filename at plan time (replay-harness tests live in src/runtime/, not tests/).
- [C2] Cross-bus exile gate inconsistency — proposeMarriage publishes PlayerExileBlocked to whisperBus but introduces familyBus for FamilyEvent; explicitly state PlayerExileBlocked stays on whisperBus per existing cross-cutting convention.
- [C2] parentCharacterIds lex-sort relies on MarriageRecordSchema:113-114 spouseAId<spouseBId invariant — cite this invariant explicitly so future code doesn't break the sort.
- [C2] ProposalRejection's byCharacterId field for ledger underspecified — document explicitly that this is the proposer (player head).
- [C2] findAdultChildren parameter naming — implementer must drop the underscore prefixes from the P1 stub's (_state, _deadHeadId) to (state, deadHeadId).
- [C2] PHASES.length module-load assertion claim not in current source — pin which mechanism enforces array length (test-side phaseOrderTracker).
- [C2] SaveV1Schema strip discipline — composition order in legacy lifters needs verification follow-through.
- [C2] C1 tail has 23 untagged items; recommend explicit triage tags ([folded into <section>] / [deferred] / [still-open]) before next iteration.
- [C2] Cross-reference walk for the plan's 860 lines — verify every constant name, NPC name, player name, and TraitId reference against existing fixtures.
- [C2] Spec line numbers cited heavily but not yet verified — spot-check 2-3 against spec body for drift.
- [C2] Two new modules (proposal.ts, happiness.ts, maturation.ts) need ESLint boundaries verification — folder-mode src/game/rules covers them but confirm imports.
- [C2] Plan's __buildSaveV7ForTests audit is good; add SAME audit for toSaveV7 and fromSaveV7 to catch non-test consumers.
- [C3] PERSONA_CACHE_VERSION literal target unpinned — bump from "v2" to "v3" explicitly.
- [C3] runYearPass wrapper diff-publisher enumeration incomplete — enumerate ALL post-P7 publishers (publishMarriageTransitions, publishTemptationLatchTransitions, publishChildMaturationTransitions, publishArchetypeReclassificationsFromSuccession) and confirm publishSchemeTransitions stays excluded.
- [C3] parentCharacterIds lex-sort needs unit-level assertion in conception.test.ts that parentCharacterIds[0] < parentCharacterIds[1].
- [C3] Bohemian role gate and BohemianRake archetype classifier branch overlap (Frivolous+Intellectual edge case) — document the resolution: role=Bohemian + archetype=BohemianRake is the intended Regency reading.
- [C3] Widening succession step to recompute archetype for every surviving family character requires updating every existing succession test fixture's character-Map equality assertion — enumerate which test files need attention.
- [C3] BaselineNpcSeed type at npcs.ts requires explicit gender field widening — implementer must extend the schema, not derive at lift time.
- [C3] Tutor-dies-same-tick-as-maturation edge case needs concrete Vitest fixture (synthetic state with tutor deathAge===current_age, child age=17, year-pass, assert pendingTutorTraitChoices does NOT contain child).
- [C3] C1 tail of 40+ untagged items needs explicit triage tags ([folded into <section>] / [deferred to <phase>] / [still-open]) before close-out.
- [C3] Spec line-number citations should be spot-checked against spec body before close-out.
- [C4] PERSONA_CACHE_VERSION literal value still unpinned (bump from "v2" to "v3" explicitly).
- [C4] Widened succession-step archetype recompute invalidates existing test fixtures; enumerate which existing succession tests need attention (succession.test.ts most likely).
- [C4] C1 tail still has untagged items; recommend explicit triage pass with [folded into <section>] tags before close-out.
- [C4] Spot-check 2-3 spec line numbers against current spec body before close-out.
- [C5] schemes.ts:410 retro-add patch shape: clone houses Map → lookup owner → clamp +25 scandal `[0, 100]` → thread through to flipSchemeStatus. Plan ships constant but not wiring.
- [C5] Proposal predicate gates 7+8 rationale ("incest gate first; cross-house covers residual") as one inline sentence.
- [C5] applyMaturationStep early-return condition pendingChoices.size could hide entry-swap; reference-check or always-return-new-state when potentially mutated.
- [C5] Tutor-prune branch 2 lazy-clone discipline could be tightened (fallback `?? c` is dead when branch 1 never fired).
- [C5] ARCHETYPE_MATURATION_TRAIT_POOL growth contract: if a future phase widens ARCHETYPES, module-load assertion fires by design; add one-line note next to assertion.
- [C5] applyHappinessPhase perf at N=20+ is fine but note O(N) Map lookups per tick per character in perf comment.
- [C5] chooseTutorBonusTrait defensive de-dup note WHY ordering matters (display rendering preservation).
- [C5] Dull-spouse drain decoupling: applyHappinessPhase double-checks both dullSpouseExposureStartTick !== null AND spouse's live Dull trait; pin the gate semantics if future mid-life trait acquisition decouples.
- [C5] Pending tutor-trait choice snapshot semantics: pool snapshot captured at maturation tick T, not at choice-resolution — add one-line comment.
- [C5] makeMarriageId walk is single-creation per tick, so P6 multi-Map accumulator pattern doesn't apply — pin asymmetry.
- [C5] Widow rendering responsibility (UI-derived "Widowed" vs entity role=Spouse) — flag P14 UI concern or define display-time derivation rule.
- [C-fc2-1] ARCHETYPES module-load assertion iterates by string-equality skipping "None"; rename of "None" → "Unclassified" breaks silently. Use Set<Exclude<Archetype, "None">> or assert pool.size === archetypes.length - 1.
- [C-fc2-2] Conception 6th-draw position has no module-load or unit assertion; only call-count test catches accidental swaps. Add fixture asserting trait→deathAge→gender order.
- [C-fc2-3] Pre-P7-married Spinster path: V7→V8 migration MUST NOT retroactively assign Spinster role; pin as a Vitest case.
- [C-fc2-4] Future v1.5 trait-modifier lifespan that double-increments age in same year-pass would silently skip maturation; a future-phase regression test would catch.
- [C-fc2-5] Role enum widening: post-P7 emit-as-V7 would serialize new role values into legacy save; SaveV7Schema's RoleSchema accepts widened ROLES; cross-version-loading concern noted.
- [C-fc2-6] Happiness latch predicate asymmetry: latch flip checks dullSpouseExposureStartTick !== null but NOT live-spouse Dull-trait; widen latch predicate or document asymmetry.
- [C-fc2-7] Zod schemas for ProposalLogEntrySchema / TutorAssignmentLogEntrySchema / PendingTutorTraitChoiceSchema need explicit shape declarations in entities.ts edit list (referenced in V8Schema but not defined).
- [C-fc2-8] PHASES.length 8 → 9 and STEPS.length 3 → 4 break existing tests asserting old length; enumerate test files needing patches.
- [C-fc2-9] Miss Carrington bohemian gate prose misleading ("IF her role flips Male" is confused); tighten the prose.
- [C-fc2-10] chooseTutorBonusTrait dedup decision: silent no-op OR reject with TraitAlreadyPresent? Recommend silent no-op.
- [C-fc2-11] migrate_v6_to_v7 inline-note: ship as a comment in actual migration body during implementation, not just plan-side.
- [C-fc2-12] BaselineNpcSeed gender widening requires parallel edit at buildBaselineNpcCharacter:77-96 to thread gender into returned Character — needs its own bullet beyond the type widening.
- [C-fc2-13] Happiness-drift Vitest off-by-one: with drain -1/tick from 100, happiness reaches 30 at tick 70 but latch predicate is `< 30` so flips at tick 71, not 70.
- [C-fc2-14] Succession-step widened archetype recompute touches every surviving family-house character but classifyArchetype has no HeadOfHouse branch — promoted heir always classifies to None; the widening adds no behavior beyond the existing single-line recompute at succession.ts:110.
- [C-fc2-15] Tutor archetype dead-code branch: `tutorArchetype = tutorAlive ? tutorChar.archetype : "None"` — orphan-prune nulls assignedTutorCharacterId on tutor death in the same year-pass so `tutorAlive === false` only reachable via cross-tick paths.
- [C-fc2-16] 70-tick countdown from happiness 100 → threshold may be too slow for v1 demos (~3 seasons of Dull-marriage before temptation); pin pacing intent.
- [C-fc2-17] BohemianRake archetype ↔ Bohemian role perfectly correlated (same gate); Spinster role ↔ Spymaster archetype NOT (Spinster can be None archetype); asymmetry deserves one-line note.
- [C-fc2-18] Maturation step uses `[...state.characters.keys()].sort()` while moods.ts canonical lex-sort uses slightly different shape; cross-module consistency.
- [C-fc2-19] HAPPINESS_INITIAL = 100 for every legacy character on migration: a character married pre-P7 to a Dull spouse starts fresh-happy post-migration; call out UX "happiness suddenly reset" surface.
- [C-fc2-20] Persona-prompt format additions for marriage/happiness bump cache version but don't pin what LLM does differently with new fields; persona-reflects-post-P7-state Vitest fixture missing.
- [C-fc2-21] Widow-stays-Spouse rule interacts with Spinster classifier branch unreachability: Spinster role at P7 reachable only via never-married path; widows blocked by §3 line 491 reading + widow rule.
- [C-fc2-22] Persona prompt edit doesn't pin where in buildPersonaPrompt body new paragraphs land or literal prose surrounding them; Vitest fixture for "persona reflects post-P7 state" missing. `[applied]`
- [C-fc2-23] Proposal pure-rule callCount assertion needs explicit "+1 from proposal pure rule plus advanceTickPure's overhead from economy/mood phases" so test isn't misread.
- [C-fc2-24] v7→v8 migration doesn't retroactively run maturation; pre-P7 unwed adults stay role=Dependent forever (Spinster/Bohemian/Exile classifier paths permanently inaccessible). One-line callout needed inline at migrate_v7_to_v8.
- [C-fc2-25] proposeMarriage wrapper bullet enumerates 5 publishers but store-wrapper body calls 4; sync needed.
- [C-fc2-26] Migration chain test naming: is v1-to-v7-chain.test.ts renamed/extended OR does v1-to-v8-chain.test.ts ship in parallel? Pick one.
- [C-fc2-27] Three new files (proposal.ts, happiness.ts, maturation.ts) under src/game/rules/ — no positive-control ESLint boundary test enumerated in verification list. `[applied]`
- [C-fc2-28] Enumerate test files needing PHASES.length/STEPS.length patches: tickOrchestrator.test.ts, monarchsAudience.test.ts, yearPass.test.ts, succession.test.ts.
- [C-fc2-29] PendingTutorTraitChoiceSchema's archetype field can be "None" via Zod but maturation never creates such entries; document as invariant or narrow schema with refinement.
- [C-fc2-30] hashCharIdToGender algorithm underspecified — "the same string-hash used by serializeRegistry for lex-sort, but mod 2" is wrong (serializeRegistry uses localeCompare, not numeric hash). Pin a literal hash function (e.g., FNV-1a with seed 0) and ship a golden-output Vitest. Hash-sensitive: changing algorithm in v1.5 silently re-rolls every legacy character's gender.
- [C-fc2-31] Verification section file-path edit list: pin explicit paths for new Vitests (src/game/rules/proposal.test.ts, maturation.test.ts, happiness.test.ts).
- [C-fc2-32] Convert "Resolved decisions §10" block to one-line-per-decision table for mechanical body→ref auditing.
- [C-fc2-33] publishProposalOutcome 3rd-arg skip-rule key prefix is undocumented; pin shared-key-prefix contract.
- [C-fc2-34] Classifier branch 2 (Bohemian Rake) doesn't gate on role !== Bohemian; verify spec line 491-494 intent (currently classifier reads gender + marriage + traits without role gate on branch 2 — Bohemian-role characters DO classify to BohemianRake which is the intended Regency reading per C-fc2-17 acknowledgment).
- [C-fc2-35] replace-state.test.ts not found at src/game/store/; may be elsewhere or new at P7 — clarify.
- [C-fc2-36] PlayerAlreadyMarried gate is degenerate at v1 (fresh-state has zero marriages); pin as future-phase invariant; v1 Vitest fixture uses synthetic state.
- [C-fc2-37] proposeMarriage publisher list three-way mismatch: body lists 4, prose claims 5, advanceTick-mirror references 2; pick one source of truth.
- [C-fc2-38] Path drift: replace-state.test.ts location is src/game/store.replace-state.test.ts (dotted, not subdirectory).
- [C-fc2-39] PHASES.length === N assertion unimplementable as written (PHASES module-private; no current PHASES.length references); substitute test-side phaseOrderTracker function-reference identity OR commit to exporting PHASES.
- [C-fc2-40] Replay-harness path drift: src/game/replay-harness.test.ts (not src/runtime/replay-harness.test.ts).
- [C-fc2-41] No conception.test.ts in src/game/rules/; either create in-scope or move assertions.
- [C-fc2-42] yearPass.test.ts doesn't exist; year-pass tested transitively via succession.test.ts + monarchsAudience.test.ts.
- [C-fc2-43] proposeMarriage wrapper stateBefore var-init order fragile to future inserts; add stateBefore-init invariant callout.
- [C-fc2-44] applyHappinessPhase latch-flip idempotence: one-line comment that latch never re-fires once set.
- [C-fc2-45] PHASES.length === 9 verification assertion still in §1189 contradicts §973 ("no module-load assertion"); pick one, recommend phaseOrderTracker-based function-reference identity check.
- [C-fc2-46] proposeMarriage publisher list three-way mismatch persists between body (4), prose (5), advanceTick-mirror (6); pick one — recommend 5 (drop temptationLatch).
- [C-fc2-47] Migration chain test convention: ADD v1-to-v8-chain.test.ts alongside v1-to-v7 (per the existing per-version cumulative convention), NOT extend v1-to-v7.
- [C-fc2-48] §649 still references stale src/runtime/replay-harness.test.ts (the path fix at §97 didn't propagate to §649); harmonize.
- [C-fc2-49] proposeMarriage publisher list FOUR-way mismatch (body 4, prose 5, advanceTick 2, runYearPass 6); pick one canonical list (recommend 5: proposalOutcome + marriageTransitions + temptationLatchTransitions + characterDeaths + whisperTransitions).
- [C-fc2-50] stateBefore var-init fragility in proposeMarriage wrapper: pin invariant "stateBefore MUST be assigned immediately after get()".
- [C-fc2-51] findAdultChildren parameter type drift: §654 uses CharacterId but P1 stub uses Character["id"] — both resolve to the same brand; pin one canonical reference type.
- [C-fc3-1] defaultCharacterV5AndV8Fields vs defaultCharacterV8FieldsForV5OrLater — two helpers doing similar work with similar names; easy to call the wrong one. Consider clearer naming or composition.
- [C-fc3-2] Same-tick maturation-then-succession idempotency: add Vitest fixture asserting classifyArchetype(c) === classifyArchetype(classifyArchetype-output) so future side-effect-introducing refactors are caught.
- [C-fc3-3] pruneOrphanedConversationKeys grows from ~35 → ~85 lines with three branches; consider extracting marriage-dissolution to own helper for testability.
- [C-fc3-4] Eager-clone vs lazy-clone divergence: applyMaturationStep + applyHappinessPhase eagerly allocate Maps; P6 canonical pattern uses lazy clone via if(!touched). Minor perf; inconsistent.
- [C-fc3-5] ROLE_LABELS prose rewrite makes NPC self-introductions wordier (player-visible behavior change); confirm intentional.
- [C-fc3-6] ProposalRejection 12-variant Vitest fixtures need minimum-fixture state pinned for the 10 non-exemplar variants (TargetTooYoung, TargetExiled, TargetDead, etc.). `[applied]`
- [C-fc3-7] ARCHETYPE_MATURATION_TRAIT_POOL trait-literal brand casts hide typos at TS-strict level; consider narrowTrait("Observant") helper that validates against TRAITS_ALL.
- [C-fc3-8] Tail consumes ~200 lines of the 1325-line plan; consider extracting to 07-family-succession-history.md.
- [C-fc3-9] Literal persona-prompt prose for marriage/happiness paragraphs not pinned; PERSONA_CACHE_VERSION bump meaningless without literal text. `[applied]`
- [C-fc3-10] seedV8FieldsIntoLegacyState idempotence guard idiom: `if (!("happiness" in c))` vs `c.happiness === undefined` — pin canonical idiom.
- [C-fc3-11] ProposalLogEntry.byCharacterId forward-compat: at P7 always player head; at P8 rivals propose too. Add inline comment naming future-phase widening.
- [C-fc3-12] PendingTutorTraitChoiceSchema.archetype Zod-allows "None" but maturation never produces such entries; narrow with refinement or document as invariant.
- [C-fc3-13] yearPass.test.ts DOES exist at src/runtime/yearPass.test.ts (prior C-fc2-42 claim wrong); update enumeration.
- [C-fc3-14] STARTING_HEAD_CHARACTER_ID cited at names.ts:6; actual line is 10 (minor).
- [C-fc3-15] Composition-order at lines 220-232 documented but not module-load-asserted; add assertion-style guard.
- [C-fc3-16] ProposalRejection 12-variant Vitest fixtures need per-variant minimum-state pins (TargetExiled synthetic exiled house, PlayerHeadDead state shape, etc.) — implementer makes 12 load-bearing decisions unsupervised without pins. `[applied]`
- [C-fc4-1] PROPOSAL_TICK_COST = 1 constant unused; either wire (assertion) or remove.
- [C-fc4-2] Publisher counts trio (5/5/6) needs Vitest asserting each wrapper publishes exactly its declared set so future regressions are caught.
- [C-fc4-3] replace-state.test.ts extension seeding mechanism unstated; match the existing synth.GameState-style construction.
- [C-fc4-4] Classifier first-match-wins ordering: unwed adult with {Intellectual, Frivolous} hits branch 2 (BohemianRake) before branch 3 (Tutor); document the asymmetry against spec 489-496 reading.
- [C-fc4-5] Pre-computed FNV-1a output for 5 baseline NPC IDs + player-head should be pinned in plan body for review-time verifiability.
- [C-fc4-6] findAdultChildren defensive houseId filter (even though redundant at P7 — future P11 sibling-rival adoption could create cross-house children).
- [C-fc4-7] Persona prompt edit: pin WHERE in buildPersonaPrompt body (around persona.ts:36-58) new paragraphs land — inside baseLines vs between baseLines+sceneLines. `[applied]`
- [C-fc4-8] Tutor-archetype dead-code branch in maturation: ship inline assertion `if (assignedTutor && !state.characters.get(assignedTutor)?.alive) throw` so the defensive case fails loudly.
- [C-fc4-9] Add unit assertion that classifyArchetype reads character.gender to catch a future test fixture using a pre-gender Character shape.
- [C-fc5-1] Tutor-reassignment InsufficientWealth predicate behavior for negative-wealth (bankrupt) houses: pin.
- [C-fc5-2] Independent NPCs' permanent None archetype: UX consequence (UI displaying archetype for Independent NPCs always shows None).
- [C-fc5-3] Classifier branches 2/3 age >= ADULTHOOD_AGE_IN_YEARS check is redundant with succession's age filter; document as post-condition guarantee not independent gate.
- [C-fc5-4] succession.ts:48-58 explicit marriage dissolution becomes redundant after pruneOrphanedConversationKeys branch 3 — comment explicitly as redundant defensive code or remove.
- [C-fc5-5] assignTutor + chooseTutorBonusTrait wrapper-shape code snippets missing; derive from P5 startScheme/cancelScheme precedent. `[applied]`
- [C-fc5-6] AFFECTION_PROPOSAL_THRESHOLD has been dormant since constants.ts:133 declaration; "waited since [PHASE-NUMBER] for P7" comment.
- [C-fc5-7] PROPOSAL_TICK_COST unused: either wire (assertion) or remove.
- [C-fc5-8] schemes.ts:410 patch insertion: clarify that the new scandal mutation goes BEFORE flipSchemeStatus, INSIDE the if(discovered) block starting at line 405.
- [C-fc5-9] STARTING_HEAD_CHARACTER_ID citation drift (names.ts:6 vs :10); harmonize to :10.
- [C-fc5-10] applyMaturationStep first-iteration-no-match-then-mutation Vitest fixture for accumulator semantics.
- [C-fc5-11] Independent NPC succession path: Lord Blackwood dies ~tick 51; widened succession recompute runs on Independent's heir. Tighten line 449 prose.
- [C-fc6-1] Atomic-gating prose conflates "rejection" across predicate-fail and roll-fail paths; rename to "predicate-failure" vs "roll-failure" for clarity.
- [C-fc6-2] Zero-firing publishers (publishMarriageTransitions from advanceTick at v1) are regression-prone; add Vitest asserting no-op short-circuit. `[applied]`
- [C-fc6-3] 4-way conditional spread in pruneOrphanedConversationKeys (conversationHistory + affectionMap + whispers + characters + marriages) not exercised together; add multi-branch fixture. `[applied]`
- [C-fc6-4] death-cascade.test.ts grep-based vs ESLint-rule-based: specify regex pattern OR replace with custom ESLint rule per CLAUDE.md boundaries discipline.
- [C-fc6-5] Bootstrap-vs-FNV cross-check Vitest: loop BASELINE_NPCS and assert hashCharIdToGender(id) === Character.gender after bootstrap. `[applied]`
- [C-fc6-6] proposeMarriage publisher invocation order semantics (marriageTransitions before characterDeaths) — document UI subscriber precedence.
- [C-fc6-7] applyMaturationStep pendingChoices independence per sibling — explicit comment that no cross-sibling dependency exists at v1.
- [C-fc6-8] applyHappinessPhase eager-clone (new Map(state.characters) before condition checks) vs applyMaturationStep lazy-clone — cosmetic inconsistency with P6 canonical pattern; in steady-state v1 path (no Dull spouse) lazy-clone would skip allocation.
- [C-fc6-9] proposeMarriage zero-firing publishers at v1: add Vitest asserting v1 common path produces no MarriageDissolved/TemptationUnlocked events from proposal acceptance. `[applied]`
- [C-fc6-10] aging.ts line citation drift: prune helper at :40-75 vs aging step at :77-103. Verify.
- [C-fc6-11] Cross-Map orphan-prune branch source semantics: branch 1 reads state, branch 2 reads newChars, branch 3 reads state.marriages — pin "branches must be ordered, reading prior branch's accumulator" invariant comment.
- [C-fc6-12] Proposal wrapper snippet uses `(draft)` in set callback vs store.ts canonical `(state)` — harmonize.
