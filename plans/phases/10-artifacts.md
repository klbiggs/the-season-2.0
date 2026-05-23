# P10 — Artifacts, Wardrobe, Forgery & Theft

> Part of [The Season Master Plan](../MASTER.md). Prior: [P9 — Elopement Sprint Overlay](./09-elopement.md). Next: [P11 — Sibling Rivals & Inherited Secrets](./11-sibling-rivals-secrets.md).

**Goal.** The artifact loop: equip for reputation, wardrobe ages per ball, Bohemian Rake forges, surfacing rolls cascade onto Vain NPCs, thieves attempt against high-reputation houses, Spymaster thwarts, the player can spend an unsurfaced forgery on the apex **Treason Framing** scheme (the 7th `SchemeKind`). Save format bumps **v10 → v11** to carry four new top-level GameState entities plus the `TreasonFraming` enum widening of `SCHEME_KINDS`. P10 also lifts the live `if (SCHEME_KINDS.length !== 6) throw` assertion at `src/game/constants.ts:294` (its in-line comment explicitly anticipates this phase).

P10 is the first phase that adds MULTIPLE new top-level Maps in a single bump (`artifactInstances`, `forgeries`, `thiefAttempts`, plus a new `Character.equippedArtifactIds: ArtifactInstanceId[]` field — equipment is character-level, not a top-level Map). It is also the first phase whose **resolution side-effects cascade across multiple Maps in the SAME tick-phase** (forgery surfacing locks every Vain NPC's mood AND drops every Vain NPC's affection toward the player house in one atomic pass — §7 "Forgery surfacing cascade"). The implementation discipline tracks the P6 "per-iteration multi-Map accumulator pattern" with the surfacing roll's per-roll accumulator pattern documented inline.

**What does NOT change (load-bearing).** `PHASES` grows from **10 → 12** with two new slots inserted BEFORE the terminal rival slot — `applyRivalActionPhase` stays at the terminal slot per CLAUDE.md non-negotiable "rivals always run last." Year-pass `STEPS` length stays at **4** (no year-pass-driven artifact mutations — surfacing and theft notice are tick-phase rolls, not annual). The `applyRivalActionPhase` callsite in `tickOrchestrator.ts` shifts from slot 10 to slot 12 — the test-side `phaseOrderTracker` enforcement covers the new ordering automatically because it asserts function-reference identity at the terminal slot, not numeric index.

**In scope.**

- **Save format bump to v11.** Adds **THREE new top-level GameState Maps** + **ONE new `Character` field** + **ONE new `SchemeKind` enum entry**. Every field is hash-relevant; every new entry has a default and a strip-on-emit:
  - `GameState.artifactInstances: Map<ArtifactInstanceId, ArtifactInstance>` — per-instance entities (an `ArtifactInstance` is a player-owned occurrence of a registry-defined `ArtifactDefinition`; the registry itself is FIXTURE-only at `src/game/fixtures/artifacts.ts`, not in `GameState`). Bootstrap seeds the player's starting inventory (~3 instances per the canonical small registry — see "Artifact fixture registry" below). Legacy V1-V10 lifts default to an empty Map (player starts with no artifacts on legacy saves; a future v1.5 migration could backfill if needed).
  - `GameState.forgeries: Map<ForgeryId, ForgeryRecord>` — per spec §4 line 554 (`forgedArtifactInstanceId, forgerCharacterId, forgedAtTick, surfaced`). Empty Map on fresh state and every legacy lift.
  - `GameState.thiefAttempts: Map<ThiefAttemptId, ThiefAttempt>` — per spec §4 line 555 (`targetedArtifactInstanceId, ownerCharacterId, noticedAtTick, thwarted`). The Map carries BOTH in-flight (just-noticed, awaiting thwart decision) AND historical (resolved) entries; status is encoded by the `thwarted: boolean | null` field (`null` = in-flight, `true | false` = resolved). Empty Map on fresh state and every legacy lift.
  - `Character.equippedArtifactIds: z.array(ArtifactInstanceIdSchema).default([])` — per-character equipment list. Order is hash-relevant in equip-order (rep-bonus sum is order-independent; the array order matters for the deterministic "valuable artifact pick" in theft notice — see `selectTargetedArtifactInstance` below). Legacy V1-V10 characters default `[]` via Zod `.default([])` (P8 precedent for `House.hostility` / P9 precedent for `MarriageRecord.viaElopement`). Bootstrap seeds the player head's starting list with the registry-default equipped instances (1-2 items; see fixture registry).
  - `SchemeKind = "Courting" | "Sabotage" | "Seduction" | "Chaperone" | "Smuggling" | "Assassination" | "TreasonFraming"` — the seventh kind. ALL four `Readonly<Record<SchemeKind, ...>>` consumers at `src/game/constants.ts:280-360` extend with a TreasonFraming entry (see "Scheme registry record extensions" below).
  - The module-load assertion at `src/game/constants.ts:294` (`if (SCHEME_KINDS.length !== 6) throw`) is REPLACED with `if (SCHEME_KINDS.length !== 7) throw`. The proximity comment is updated to reference P10's save-version bump as the live precedent (was: "P10's Treason Framing addition" / now: "P10 shipped the Treason Framing addition with save-version bump v10→v11").
- **`SaveV11Schema` declaration** (new at P10 in `src/persist/schema.ts`):
  ```ts
  // src/persist/schema.ts (NEW at P10):
  export const SaveV11Schema = z.object({
    version: z.literal(11),
    tick: z.number().int().nonnegative(),
    rng: z.array(z.tuple([HouseIdSchema, RngStateSchema])),
    houses: z.array(z.tuple([HouseIdSchema, HouseSchema])),
    characters: z.array(z.tuple([CharacterIdSchema, CharacterSchema])),  // LIVE CharacterSchema — includes equippedArtifactIds via .default([])
    marriages: z.array(z.tuple([MarriageIdSchema, MarriageRecordSchema])),
    campaignName: z.string(),
    era: z.enum(["Earlier", "Later"]),
    conversationHistory: z.array(z.tuple([ConversationPairKeySchema, z.array(ExchangeSchema)])),
    affectionMap: z.array(z.tuple([ConversationPairKeySchema, z.number().int().min(0).max(100)])),
    schemes: z.array(z.tuple([SchemeIdSchema, SchemeSchema])),  // LIVE SchemeSchema — kind enum includes TreasonFraming
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
    // P10 ADDITIONS — three new entity Maps:
    artifactInstances: z.array(z.tuple([ArtifactInstanceIdSchema, ArtifactInstanceSchema])),
    forgeries: z.array(z.tuple([ForgeryIdSchema, ForgeryRecordSchema])),
    thiefAttempts: z.array(z.tuple([ThiefAttemptIdSchema, ThiefAttemptSchema])),
  });
  export type SaveV11 = z.infer<typeof SaveV11Schema>;
  ```
  `SAVE_VERSION_CURRENT` bumps from `10` → `11` at `src/persist/schema.ts:67`.

- **Strip cascade for legacy emit.** Following P8/P9 precedent, the THREE new top-level Maps + the `Character.equippedArtifactIds` field are stripped from every legacy `toSaveV{N}` for N < 11 (V1 through V10). Parse-side: `equippedArtifactIds` uses Zod `.default([])` so legacy V1-V10 characters parse cleanly without a Pre-shape rebuild. The three new top-level Maps are simply absent from legacy `SaveV{N}` shapes, so `toSaveV{N}` for N < 11 OMITS them from the emit literal (no helper needed — the literal is by construction missing the keys). Defense-in-depth strip helper for `Character.equippedArtifactIds`:
  ```ts
  // src/persist/schema.ts — NEW helper, applied at every toSaveV1..V10 emitter
  // for the characters tuple. Defense-in-depth + round-trip byte-identity
  // (Zod's default .strip() mode would silently drop the field at parse time
  // anyway, but explicit strip avoids the byte mismatch in chain tests).
  function stripEquippedArtifactsForLegacyEmit(
    characters: ReadonlyArray<[CharacterId, Character]>,
  ): Array<[CharacterId, Omit<Character, "equippedArtifactIds">]> {
    return characters.map(([id, c]) => {
      const { equippedArtifactIds: _e, ...rest } = c;
      return [id, rest];
    });
  }
  ```
  Ten emit-site invocations (V1 through V10 — V11 emits with the live schema and DOES include `equippedArtifactIds`). The three new top-level Maps require zero helper code (no key in legacy emit literals).

- **`migrate_v10_to_v11` and lifter discipline (resolves B1 bootstrap-vs-legacy parity).** Pure function `(SaveV10) → SaveV11` at `src/persist/migrations/v10-to-v11.ts`. Body follows the bare+wrap pattern AND uses `bootstrapPlayerArtifacts` for symmetry with `createInitialState` — this is the P4/P8 "additive migration seeds new entity" precedent: legacy V1-V10 saves get the SAME starting inventory the migration runner would have produced if the player started fresh on the post-P10 build. Without this symmetry, the `v1-to-v11-chain.test.ts` byte-identity assertion mathematically cannot pass (bootstrap = 3 instances + 2 equipped; legacy-without-helper = 0 instances + 0 equipped → hash divergence). The helper is IDEMPOTENT (checks for the player head's `equippedArtifactIds.length === 0` before seeding) so the migration runner + Bare-half composition stay safe:
  ```ts
  // src/persist/migrations/v10-to-v11.ts (NEW at P10):
  import { bootstrapPlayerArtifactsForMigration } from "../../game/bootstrap";
  import { SaveV10Schema, SaveV11Schema, fromSaveV10Bare, toSaveV11 } from "../schema";
  
  // INLINE DUPLICATE of extractPlayerSeed (resolves cycle-3-iter-3 B1, cycle-3-iter-4 B1, cycle-4-iter-2 B4).
  //
  // **Important: TWO module-private `extractPlayerSeed` functions exist in the
  // codebase with DIFFERENT signatures, in DIFFERENT files.** They do not
  // conflict because each is private to its own module:
  //   1. `src/persist/schema.ts:447` takes `rng: ReadonlyArray<...>` — used by
  //      every `fromSaveV{N}` wrap in schema.ts (call shape: `extractPlayerSeed(save.rng)`).
  //   2. `src/persist/migrations/v8-to-v9.ts:35-41` takes `save: SaveV8`
  //      directly — used by the migration body (call shape: `extractPlayerSeed(save)`).
  //
  // P10 follows the v8-to-v9 precedent EXACTLY for the v10-to-v11 migration's
  // inline duplicate (takes `save: SaveV10`, uses `find`, `migrate_vN_to_vM:`
  // error prefix). The schema.ts helper STAYS PRIVATE and is reused by P10's
  // `fromSaveV10` wrap edit (which lives INSIDE schema.ts and has access to it).
  // No new helper is exported from schema.ts; no widening of visibility surface.
  // The two helpers having different signatures is a deliberate consequence of
  // their different call contexts (schema.ts wraps know `save.rng` is in scope
  // because they unpack `save` already; migration bodies have `save: SaveVN`
  // and prefer to pass it whole).
  function extractPlayerSeed(save: SaveV10): string {
    const entry = save.rng.find(([id]) => id === "player");
    if (entry === undefined) {
      throw new Error("migrate_v10_to_v11: save.rng has no player entry");
    }
    return entry[1].seed;
  }
  
  export function migrate_v10_to_v11(save: SaveV10): SaveV11 {
    const bare = fromSaveV10Bare(save);
    const seed = extractPlayerSeed(save);
    // Three new Maps default-empty per Zod schema. The bootstrap helper then
    // seeds the player head's starting inventory deterministically — symmetric
    // with createInitialState so v1-to-v11-chain.test.ts hash-parity holds.
    const withP10MapsEmpty = {
      ...bare,
      artifactInstances: new Map<ArtifactInstanceId, ArtifactInstance>(),
      forgeries: new Map<ForgeryId, ForgeryRecord>(),
      thiefAttempts: new Map<ThiefAttemptId, ThiefAttempt>(),
    };
    // bootstrapPlayerArtifactsForMigration is idempotent: if the player head
    // already has any equippedArtifactIds OR state.artifactInstances is non-empty,
    // return state unchanged. Catches the legacy-lift + migration-runner double-call
    // path that the P4 bare+wrap precedent established (src/persist/schema.ts:seedIndependentIntoLegacyState).
    // Note the migration uses the *ForMigration variant (GameState-in-GameState-out);
    // createInitialState uses *ForInit (mutates a Map local, returns artifactInstances).
    return toSaveV11(bootstrapPlayerArtifactsForMigration(withP10MapsEmpty));  // no seed param — see signature note
  }
  ```
  **Effects:**
  - Adds `state.artifactInstances` populated with 3 starting instances per `PLAYER_STARTING_ARTIFACTS`, `state.forgeries` empty, `state.thiefAttempts` empty.
  - Adds `equippedArtifactIds: [sapphires-instance, mount-instance]` to the player head Character (the two starter-equipped instances).
  - Adds `equippedArtifactIds: []` to every other legacy `Character` via the `.default([])` Zod backfill.
  - **Draw budget: ZERO.** Pure shape transformation. Asserted in `v10-to-v11.test.ts`: `expect(migrate_v10_to_v11(save).rng).toEqual(save.rng)`.
  - **Idempotence assertion** ships in `src/persist/migrations/v10-to-v11.idempotence.test.ts` via the `assertMigrationIdempotent` helper.
  - **`MIGRATIONS` registry extension** at `src/persist/migrations/index.ts`: append `{ from: 10, to: 11, migrate: (s: unknown) => migrate_v10_to_v11(SaveV10Schema.parse(s)), outputSchema: SaveV11Schema }` plus the imports.
  - **`fromSaveV10Bare`** (NEW at P10 — resolves B2 from cycle-3-iter-3 review). Live `fromSaveV10` at `src/persist/schema.ts:1317` currently has NO Bare/wrap split because V10 was the LIVE format from P9 ship-date through pre-P10 (Bare splits exist for V4-V9 because each was demoted from live to legacy at successive phase ships; V10 ships its Bare split as part of P10's demotion-to-legacy work). The Bare body mirrors `fromSaveV9Bare` at `src/persist/schema.ts:1219-1248` — pure deserialization, no seeding. Concrete diff:
    ```ts
    // src/persist/schema.ts — P10 EDITS (extract Bare, refactor wrap):
    
    // BEFORE P10 (live form, no Bare split):
    //   export function fromSaveV10(save: SaveV10): GameState {
    //     return {
    //       version: 10,
    //       tick: save.tick,
    //       rng: deserializeRegistry<HouseId, RngState>(save.rng),
    //       // ... ~21 field deserializations ...
    //       elopement: save.elopement,
    //     };
    //   }
    
    // AFTER P10:
    export function fromSaveV10Bare(save: SaveV10): GameState {
      // Pure deserialization — no seeding helpers. Mirror fromSaveV9Bare shape
      // (deserialize every Map, copy scalar fields, preserve elopement nullable).
      return {
        tick: save.tick,
        rng: deserializeRegistry<HouseId, RngState>(save.rng),
        houses: deserializeRegistry<HouseId, House>(save.houses),
        characters: deserializeRegistry<CharacterId, Character>(save.characters),
        marriages: deserializeRegistry<MarriageId, MarriageRecord>(save.marriages),
        campaignName: save.campaignName,
        era: save.era,
        conversationHistory: deserializeRegistry<ConversationPairKey, Exchange[]>(save.conversationHistory),
        affectionMap: deserializeRegistry<ConversationPairKey, number>(save.affectionMap),
        schemes: deserializeRegistry<SchemeId, Scheme>(save.schemes),
        whispers: deserializeRegistry<WhisperId, Whisper>(save.whispers),
        couriers: deserializeRegistry<CourierPayloadId, CourierPayload>(save.couriers),
        staff: deserializeRegistry<StaffId, StaffMember>(save.staff),
        proposalsLog: deserializeRegistry<CharacterId, ProposalLogEntry>(save.proposalsLog),
        tutorAssignmentsLog: deserializeRegistry<CharacterId, TutorAssignmentLogEntry>(save.tutorAssignmentsLog),
        pendingTutorTraitChoices: deserializeRegistry<CharacterId, PendingTutorTraitChoice>(save.pendingTutorTraitChoices),
        patronesses: deserializeRegistry<PatronessId, PatronessRecord>(save.patronesses),
        rivalActors: deserializeRegistry<HouseId, RivalActorState>(save.rivalActors),
        factionTensions: deserializeRegistry<FactionPairKey, number>(save.factionTensions),
        duels: deserializeRegistry<DuelId, Duel>(save.duels),
        elopement: save.elopement,
        // P10 ADDITIONS — Bare emits empty Maps; wrap-half (or migration runner)
        // calls bootstrapPlayerArtifacts to populate. The .default([]) for the
        // new Character.equippedArtifactIds field handles the legacy-character
        // backfill at parse time (no Bare-side seed needed for that field).
        artifactInstances: new Map<ArtifactInstanceId, ArtifactInstance>(),
        forgeries: new Map<ForgeryId, ForgeryRecord>(),
        thiefAttempts: new Map<ThiefAttemptId, ThiefAttempt>(),
      };
    }
    
    // Public wrapper — symmetric with migrate_v10_to_v11 so the load-path AND
    // the migration-runner path both produce equivalent post-bootstrap state.
    export function fromSaveV10(save: SaveV10): GameState {
      const playerSeed = extractPlayerSeed(save.rng);  // schema.ts:447 — module-private, in-scope here
      void playerSeed;  // reserved for future per-seed variation; not consumed at P10
      return bootstrapPlayerArtifactsForMigration(fromSaveV10Bare(save));
    }
    ```
    The Bare body emits the three new Maps EMPTY; the wrap body composes `bootstrapPlayerArtifactsForMigration(Bare, playerSeed)` to seed the starting inventory. Bare is what `migrate_v10_to_v11` reuses (so the migration's own `bootstrapPlayerArtifactsForMigration` call is the SINGLE seeding site for the load path, avoiding the double-seed that would happen if the public wrapper composed it AND the migration runner re-composed it).
  - **`fromSaveV1` through `fromSaveV10` public wrappers**: extend each to set the three new Maps as `new Map()` and re-emit characters with `equippedArtifactIds: []`. The wrapper edit pattern is mechanical (P9 precedent): 1 line per wrapper, 10 wrappers, ~10 LOC total. Concrete shape:
    ```ts
    // src/persist/schema.ts — P10 EDIT to fromSaveV10 wrapper:
    export function fromSaveV10(save: SaveV10): GameState {
      const bare = fromSaveV10Bare(save);
      return {
        ...bare,
        artifactInstances: new Map(),
        forgeries: new Map(),
        thiefAttempts: new Map(),
      };
    }
    // ... symmetric for fromSaveV1..V9 (P9's outer wrap pattern carries through) ...
    ```
  - **`src/persist/migrations/v1-to-v11-chain.test.ts`** (NEW file — ADDED alongside the existing `v1-to-v{3,4,5,6,7,8,9,10}-chain.test.ts` files per the additive-chain-test convention): walks every legacy save through the full migration chain `(V1 → V2 → ... → V11)` and asserts the bootstrapped V11 state from `createInitialState(playerSeed)` equals the migrated V11 state byte-for-byte (same hash). Parity holds because P10 adds no PRNG draws on either path.

- **Schema↔projection↔selector↔overwriteFromGameState quad-sync + createInitialState (CLAUDE.md non-negotiable).** THREE new top-level GameState fields trip the keyset extension test at `src/game/schema-projection-selector-extension.test.ts`. Required edits to ALL FIVE surfaces:
  1. `GameStateSchema` (`src/game/entities.ts`): append three `z.map(...)` fields after the P9 `elopement` line.
  2. `hashableState` (`src/game/hash.ts`): extend the projection with three new keys. All three Maps serialize via `serializeRegistry` (matches the P0 lex-sort discipline). All three are hash-relevant (no exclusions; equip/unequip, forge, theft notice each advance the hash).
  3. `selectGameState` (`src/game/store.ts`): extend the selector with the three new keys.
  4. `overwriteFromGameState` (`src/game/store.ts:overwriteFromGameState`): extend with `draft.artifactInstances = next.artifactInstances; draft.forgeries = next.forgeries; draft.thiefAttempts = next.thiefAttempts`. **Forgetting this fourth surface silently CLEARS the three Maps on every tick-advancing store action** per the CLAUDE.md `overwriteFromGameState` warning. Critical because every tick-advancing wrapper triggers `applyForgerySurfacingPhase` and `applyThiefNoticePhase`; without the overwriteFromGameState writes, those phases' mutations get discarded on the very next set body.
  5. **`createInitialState` (`src/game/store.ts:152-186` — verified live at `:185 elopement: null`)** — the fresh-state constructor builds a `GameState` literal; strict TS rejects any literal missing the three new fields. Concrete edit: insert a `bootstrapPlayerArtifactsForInit` STATEMENT BEFORE the return literal (between `seedStartingFamily(...)` call site and the literal), then reference its return value in the literal:
  ```ts
  // src/game/store.ts (P10 EDIT — insert BEFORE the existing return literal at :152):
  // ... existing seedStartingFamily(playerRng, seed) call populates `characters` Map ...
  
  // P10: seed starting artifact inventory. Mutates characters Map in-place
  // (one .set on the player head with equippedArtifactIds populated), returns
  // the artifactInstances Map for the literal below.
  const artifactInstances = bootstrapPlayerArtifactsForInit(characters, houses, 0);
  
  return {
    tick: 0,
    rng,
    houses,
    characters,
    // ... existing fields ...
    elopement: null,
    artifactInstances,                                          // NEW at P10
    forgeries: new Map<ForgeryId, ForgeryRecord>(),             // NEW at P10
    thiefAttempts: new Map<ThiefAttemptId, ThiefAttempt>(),     // NEW at P10
  };
  ```
  The state-extension test will fail at module-load until the three field initializers are added; strict TS will fail at the missing initializers if any of the three is omitted.
  - `src/game/store.replace-state.test.ts` gains ONE new `it(...)` block: seed a synthetic state with non-empty `artifactInstances` + `forgeries` + `thiefAttempts`, fire `replaceState(stateWithArtifacts)`, assert all three Maps survive AND that an immediately-following `advanceTick()` preserves them (verifies the overwriteFromGameState mirror writes).

- **New branded IDs** (`src/game/rng.ts` — per CLAUDE.md "branded-string Zod schema homes" convention):
  ```ts
  // src/game/rng.ts — P10 ADDITIONS:
  export type ArtifactInstanceId = string & { readonly __brand: "ArtifactInstanceId" };
  export type ForgeryId = string & { readonly __brand: "ForgeryId" };
  export type ThiefAttemptId = string & { readonly __brand: "ThiefAttemptId" };
  
  export const ArtifactInstanceIdSchema = z.string().transform((s) => s as ArtifactInstanceId);
  export const ForgeryIdSchema = z.string().transform((s) => s as ForgeryId);
  export const ThiefAttemptIdSchema = z.string().transform((s) => s as ThiefAttemptId);
  ```
  Plus three deterministic-id factories per P6 precedent (`makeWhisperId` / `makeCourierPayloadId`), declared in `src/game/fixtures/artifacts.ts` (artifact instances) and `src/game/rules/artifacts.ts` (forgery/thief attempt — keyed at creation site):
  ```ts
  // Index-counted via state-walk per the P6 deterministic-id pattern. Each
  // factory walks the existing Map.values() to find the next index; lex-sort
  // discipline applies. NO Date.now() / Math.random() — pure functions of state.
  export function makeArtifactInstanceId(state: GameState, definitionId: string): ArtifactInstanceId;
  export function makeForgeryId(state: GameState, forgedArtifactInstanceId: ArtifactInstanceId): ForgeryId;
  export function makeThiefAttemptId(state: GameState, targetedArtifactInstanceId: ArtifactInstanceId): ThiefAttemptId;
  ```
  Format examples (mirroring P6): `artifact-sapphires-0`, `forgery-artifact-sapphires-0-1`, `thief-artifact-sapphires-0-0`.

- **Artifact fixture registry** (`src/game/fixtures/artifacts.ts` — NEW at P10). Canonical small registry per spec §3 line 553 + §4 line 553. Each entry is an `ArtifactDefinition`:
  ```ts
  // src/game/fixtures/artifacts.ts (NEW at P10):
  export const ARTIFACT_FAMILIES = [
    "sapphires",        // jewellery
    "tiara",            // jewellery
    "snuffbox",         // accessory
    "phaeton",          // carriage
    "mount",            // horse (read by P12 Hyde Park "compliment mount" tactic)
    "family-deed",      // legal
    "ancestral-portrait", // heirloom
  ] as const;
  export type ArtifactFamily = (typeof ARTIFACT_FAMILIES)[number];
  
  export const ArtifactDefinitionSchema = z.object({
    id: z.string(),                                      // e.g. "sapphires"
    displayName: z.string(),                             // e.g. "The Carrington Sapphires"
    family: z.enum(ARTIFACT_FAMILIES),
    reputationBonusWhileEquipped: z.number().int(),      // applied as a projection at read sites, not mutated into house.reputation
    scandalRiskWhileEquipped: z.number().int().min(0),   // per-tick scandal contribution (additive in applyEconomyPhase or similar; see "Scandal-risk-while-worn integration" below)
    traitGrantsWhileEquipped: z.array(TraitIdSchema),    // applied as a projection at read sites (effective traits view), not mutated into character.traits
    forgeable: z.boolean(),
    forgeWealthCost: z.number().int().nonnegative(),     // 0 when forgeable === false
  });
  export type ArtifactDefinition = z.infer<typeof ArtifactDefinitionSchema>;
  
  // The canonical small registry. Hash-irrelevant (fixture-only, not in GameState).
  // P16 procedural generation extends this set via a separate path.
  export const ARTIFACT_REGISTRY: ReadonlyMap<string, ArtifactDefinition> = new Map([
    ["sapphires",         { id: "sapphires",         displayName: "The Carrington Sapphires", family: "sapphires",         reputationBonusWhileEquipped: 8,  scandalRiskWhileEquipped: 1, traitGrantsWhileEquipped: [], forgeable: true,  forgeWealthCost: 30 }],
    ["tiara",             { id: "tiara",             displayName: "The Marlborough Tiara",    family: "tiara",             reputationBonusWhileEquipped: 10, scandalRiskWhileEquipped: 1, traitGrantsWhileEquipped: [], forgeable: true,  forgeWealthCost: 40 }],
    ["snuffbox",          { id: "snuffbox",          displayName: "The Imperial Snuffbox",     family: "snuffbox",          reputationBonusWhileEquipped: 4,  scandalRiskWhileEquipped: 0, traitGrantsWhileEquipped: [], forgeable: true,  forgeWealthCost: 15 }],
    ["phaeton",           { id: "phaeton",           displayName: "The Crimson Phaeton",       family: "phaeton",           reputationBonusWhileEquipped: 6,  scandalRiskWhileEquipped: 0, traitGrantsWhileEquipped: [], forgeable: false, forgeWealthCost: 0  }],
    ["mount",             { id: "mount",             displayName: "Thoroughbred",              family: "mount",             reputationBonusWhileEquipped: 3,  scandalRiskWhileEquipped: 0, traitGrantsWhileEquipped: [], forgeable: false, forgeWealthCost: 0  }],
    ["family-deed",       { id: "family-deed",       displayName: "Norfolk Land Deed",         family: "family-deed",       reputationBonusWhileEquipped: 5,  scandalRiskWhileEquipped: 0, traitGrantsWhileEquipped: [], forgeable: false, forgeWealthCost: 0  }],
    ["ancestral-portrait",{ id: "ancestral-portrait",displayName: "The Founder's Portrait",    family: "ancestral-portrait",reputationBonusWhileEquipped: 5,  scandalRiskWhileEquipped: 0, traitGrantsWhileEquipped: [], forgeable: false, forgeWealthCost: 0  }],
  ]);
  
  // Module-load assertions (P10 hardening):
  //   1. Forgery-related fields are coherent.
  //   2. Every entry's family is in ARTIFACT_FAMILIES (no enum drift).
  //   3. No two entries share the same family — required for the "max one
  //      per family" equip invariant to be enforceable (resolves B4 from
  //      cycle-3 review). If two definitions share family "sapphires", the
  //      MaxOnePerFamily check on equip would silently fail to detect a
  //      legitimate "sapphires-A + sapphires-B" violation.
  const familySeen = new Set<ArtifactFamily>();
  for (const def of ARTIFACT_REGISTRY.values()) {
    if (def.forgeable && def.forgeWealthCost <= 0) {
      throw new Error(`Artifact ${def.id} forgeable=true but forgeWealthCost=${def.forgeWealthCost}`);
    }
    if (!def.forgeable && def.forgeWealthCost !== 0) {
      throw new Error(`Artifact ${def.id} forgeable=false but forgeWealthCost=${def.forgeWealthCost}`);
    }
    if (!ARTIFACT_FAMILIES.includes(def.family)) {
      throw new Error(`Artifact ${def.id} carries family=${def.family} not in ARTIFACT_FAMILIES`);
    }
    if (familySeen.has(def.family)) {
      throw new Error(`Artifact ${def.id} duplicates family=${def.family} — max-one-per-family equip invariant requires unique families across the registry`);
    }
    familySeen.add(def.family);
  }
  
  // Player bootstrap inventory. Three instances on a fresh campaign; two
  // start equipped on the player head. Deterministic via lex-sorted IDs.
  // Q: which three? A: sapphires, snuffbox, mount — jewellery + accessory +
  // mount-family (the last lets P12's "compliment mount" tactic immediately
  // gate on the player owning a mount).
  //
  // `lastRefreshTick: 0` is pinned at construction time (resolves recurring
  // C5-R11 / C6-R16 / C8-R28). At tick 0 every starting artifact is "in-season";
  // first out-of-season penalty fires at tick > WARDROBE_REFRESH_INTERVAL_TICKS.
  export const PLAYER_STARTING_ARTIFACTS: ReadonlyArray<{ definitionId: string; equippedFromStart: boolean; lastRefreshTick: number }> = [
    { definitionId: "sapphires", equippedFromStart: true,  lastRefreshTick: 0 },
    { definitionId: "snuffbox",  equippedFromStart: false, lastRefreshTick: 0 },
    { definitionId: "mount",     equippedFromStart: true,  lastRefreshTick: 0 },
  ];
  
  // bootstrapPlayerArtifacts seeds the three above into state.artifactInstances
  // AND mutates state.characters[playerHead].equippedArtifactIds with the
  // equippedFromStart subset. Pre-condition: state.characters already populated
  // by seedStartingFamily.
  //
  // **Concrete `createInitialState` integration (resolves cycle-4-iter-1 B1).**
  // Live `createInitialState` at `src/game/store.ts:152-186` returns a SINGLE
  // literal — `characters` is a local Map (mutable) populated by `seedStartingFamily`
  // BEFORE the literal. P10 inserts a `bootstrapPlayerArtifacts` STATEMENT
  // BETWEEN `seedStartingFamily(...)` and the return literal; the helper:
  //   (a) mutates the existing `characters` Map in-place (one .set call on
  //       the player head to populate equippedArtifactIds), AND
  //   (b) RETURNS the seeded `artifactInstances` Map (so the return literal
  //       can reference it on the new `artifactInstances:` line).
  // Concrete signature (NOT a state-in-state-out pure function; a hybrid):
  //   function bootstrapPlayerArtifacts(
  //     characters: Map<CharacterId, Character>,  // mutated in-place
  //     houses: Map<HouseId, House>,              // read-only
  //     tick: number,
  //   ): Map<ArtifactInstanceId, ArtifactInstance>
  //
  // This is the ONLY place the rules-layer convention bends (pure functions
  // returning new state) — the createInitialState path is explicitly NOT a
  // rules-layer function (it lives in store.ts, not rules/**). The migration
  // path uses a different shape — see "migration symmetry below."
  //
  // For the migration path, bootstrapPlayerArtifacts has a DIFFERENT signature
  // (state-in-state-out) because the migration runner threads GameState. The
  // implementation ships TWO functions with related names:
  //   1. `bootstrapPlayerArtifactsForInit(characters, houses, tick)` — used by
  //      createInitialState; mutates characters; returns artifactInstances Map.
  //   2. `bootstrapPlayerArtifactsForMigration(state, seed)` — used by
  //      migrate_v10_to_v11; pure GameState-in-GameState-out (calls the same
  //      seeding logic but on a state spread + Maps cloned with the new shape).
  // Both share an internal helper `computeStartingArtifactInstances(headCharId, tick)`
  // that produces the 3 ArtifactInstance literals (each with `lastRefreshTick: tick`,
  // `forgedFlag: false`, deterministic IDs via `makeArtifactInstanceId`).
  //
  // IDEMPOTENT (load-bearing for the migration path symmetric-seed pattern —
  // the migration runner may call this on top of a legacy lift that already
  // ran the same seeder via fromSaveV{N}Bare's outer wrap; second call returns
  // state unchanged when playerHead.equippedArtifactIds is already non-empty
  // OR state.artifactInstances is already non-empty).
  //
  // **Two exported helpers, ONE shared private core (resolves cycle-4-iter-2 B5).**
  // The bare name `bootstrapPlayerArtifacts` is RETIRED from the API; the two
  // call sites use the more-specific variants:
  
  // Used by createInitialState (store.ts:152-186) — mutates the local Map
  // BEFORE the return literal closes; returns the seeded artifactInstances
  // Map for the literal's `artifactInstances:` field.
  export function bootstrapPlayerArtifactsForInit(
    characters: Map<CharacterId, Character>,  // mutated in-place
    houses: ReadonlyMap<HouseId, House>,
    tick: number,
  ): Map<ArtifactInstanceId, ArtifactInstance>;
  
  // Used by migrate_v10_to_v11 and fromSaveV1..V10 wraps — pure state-in/
  // state-out function. Idempotence guard reads playerHead.equippedArtifactIds
  // and state.artifactInstances; returns state unchanged when either is
  // already populated (so the migration-runner double-call path is safe).
  // No seed parameter — starting inventory is deterministic via PLAYER_STARTING_ARTIFACTS
  // + lex-sorted artifact ids. Per CLAUDE.md "don't add abstractions for hypothetical
  // future requirements" — a future v1.5 per-seed inventory variation can widen the
  // signature when the use case materializes.
  export function bootstrapPlayerArtifactsForMigration(state: GameState): GameState;
  
  // Internal helper shared by both — computes the 3 ArtifactInstance literals
  // with deterministic IDs.
  function computeStartingArtifactInstances(
    headCharId: CharacterId,
    tick: number,
  ): ArtifactInstance[];
  ```
  **Why these seven entries:** spec §3 line 553 names "sapphires, tiara, snuffbox, phaeton, mount, family-deed, ancestral-portrait" — verbatim list. P10 ships exactly the spec's canonical set; procedural generation (P16) extends it later.
  
  **Why exactly these three player starters:** Q: sapphires + snuffbox + mount. Rationale: (a) jewellery (sapphires) + accessory (snuffbox) cover the wardrobe-refresh / forgery loop loud-and-clear, (b) mount-family is required for P12's Hyde Park "compliment mount" tactic to immediately have a non-empty player owned-mount predicate, (c) three instances is enough to exercise the equip/unequip / out-of-season penalty / theft notice paths without bloating the initial save.

- **New entity schemas** (`src/game/entities.ts`). All three live alongside the P9 `ElopementSprintStateSchema`:
  ```ts
  // src/game/entities.ts (P10 ADDITIONS):
  
  // Per-instance artifact entity. An instance references its registry definition
  // by string ID (the definition lives in fixtures, not GameState). An instance
  // ALSO carries the wardrobe-decay clock (per-instance, NOT per-house) so a
  // wardrobe refresh resets ALL equipped instances and an unequipped instance's
  // clock stays frozen at its last refresh tick.
  export const ArtifactInstanceSchema = z.object({
    id: ArtifactInstanceIdSchema,
    definitionId: z.string(),                          // FK into ARTIFACT_REGISTRY
    ownerHouseId: HouseIdSchema,
    ownerCharacterId: CharacterIdSchema,               // which character HOLDS it (orthogonal to equippedArtifactIds — see ownership-vs-equip split below)
    lastRefreshTick: z.number().int().nonnegative(),   // wardrobe-decay clock
    forgedFlag: z.boolean(),                           // true ⇔ a ForgeryRecord exists referencing this instance (denorm for hot-path reads)
  });
  export type ArtifactInstance = z.infer<typeof ArtifactInstanceSchema>;
  
  export const ForgeryRecordSchema = z.object({
    id: ForgeryIdSchema,
    forgedArtifactInstanceId: ArtifactInstanceIdSchema, // FK to the ArtifactInstance whose forgedFlag is true
    forgerCharacterId: CharacterIdSchema,               // spec §3 line 180 — recorded at commission
    forgedAtTick: z.number().int().nonnegative(),
    surfaced: z.boolean(),                              // ONE-WAY LATCH (flipped by surfacing roll OR Treason Framing consumption)
    surfacedAtTick: z.number().int().nullable(),        // tick when surfaced flipped true; null while unsurfaced
  });
  export type ForgeryRecord = z.infer<typeof ForgeryRecordSchema>;
  
  export const ThiefAttemptSchema = z.object({
    id: ThiefAttemptIdSchema,
    targetedArtifactInstanceId: ArtifactInstanceIdSchema,
    ownerCharacterId: CharacterIdSchema,                // owner at notice-time (may differ from current owner at resolution if the artifact transferred — see §7 "Theft against unequipped artifact")
    noticedAtTick: z.number().int().nonnegative(),
    thwarted: z.boolean().nullable(),                   // null = in-flight (notice fired, awaiting thwart decision); true|false = resolved
    resolvedAtTick: z.number().int().nullable(),        // tick when thwarted flipped from null; null while in-flight
  });
  export type ThiefAttempt = z.infer<typeof ThiefAttemptSchema>;
  ```
  **Ownership-vs-equip split.** `ArtifactInstance.ownerCharacterId` is WHO HOLDS the artifact (carries through inheritance via the existing succession step — see "Pruning extension" below). `Character.equippedArtifactIds` is WHAT THE CHARACTER IS WEARING TONIGHT (mutated by equipArtifact/unequipArtifact actions, snapshotted at ball-entry). An instance is always owned by exactly one character; the character may or may not have equipped it. Equip is a strict subset of own (`character.equippedArtifactIds.every(id => state.artifactInstances.get(id).ownerCharacterId === character.id)` is a state invariant). **`ownerCharacterId` points to a LIVING character in the common case, with one documented exception** (resolves Branch 7 prose tension from cycle-3 review): in HEIRLESS TERMINAL cases (the original owner died AND no living family member remains to inherit), `ownerCharacterId` stays at the dead character's id pending P15 dynasty-collapse logic. The equip invariant still holds because `applyEquipArtifactPure` rejects equip attempts on dead characters via the `CharacterDead` rejection — a dead character cannot acquire new equipped artifacts mid-cascade.

- **`Character.equippedArtifactIds` field.** Added at `src/game/entities.ts:~159` (after `gender`). Default `[]` via Zod backfill. **Equip-time invariant** (enforced by `applyEquipArtifactPure`): the array contains AT MOST ONE artifact instance per `ArtifactFamily`. Equipping a second sapphires-family instance must first unequip the first (the wrapper returns a `MaxOnePerFamily` rejection if the player tries to slot two of the same family).

- **PHASES growth 10 → 12.** `src/runtime/tickOrchestrator.ts` adds TWO new phase functions. **Import edit pinned explicitly** (resolves recurring C5-R9 / C6-R17 / C8-R29 / C8-R32): the new phases are imported at the top of `src/runtime/tickOrchestrator.ts` (verified live `tickOrchestrator.ts:25-27` carries three existing P8 imports). P10 EDIT — append a new import line in the import block (alphabetically after `applyPatronessErosionPhase`, before `applyRivalActionPhase` in the existing block):
  ```ts
  // src/runtime/tickOrchestrator.ts (P10 EDIT — extend the existing import block):
  import { applyForgerySurfacingPhase, applyThiefNoticePhase } from "../game/rules/artifacts";  // NEW at P10
  ```
  Without this import edit, the PHASES literal at `:47-58` would compile-fail at the new slot 10/11 entries referencing undeclared names.

  - `applyForgerySurfacingPhase` — slot 10 (BEFORE rivals). Walks `state.forgeries.values()` in lex-id order; for each `surfaced === false` entry, draws one RNG roll from the player-house stream; if `roll < FORGERY_SURFACING_PROBABILITY`, flips `surfaced: true` + `surfacedAtTick: state.tick` AND fires the cascade (see "Forgery surfacing cascade" below).
  - `applyThiefNoticePhase` — slot 11 (BEFORE rivals). Single per-tick player-house RNG roll (NOT per-artifact); gated on (a) `playerHouse.reputation >= THIEF_NOTICE_REPUTATION_THRESHOLD` AND (b) `playerHouse` owns at least one equipped artifact instance whose `reputationBonusWhileEquipped >= VALUABLE_ARTIFACT_THRESHOLD`. If roll fires, picks the targeted instance deterministically (see `selectTargetedArtifactInstance` below) and CREATES a new `ThiefAttempt` with `thwarted: null` (in-flight). The actual thwart/loss resolution happens via the `thwartTheft` player action OR a passive auto-resolve on next tick if the player took no action (terminal: `thwarted: false`, artifact removed from owner — see "Thwart resolution" below).
  
  Resulting PHASES (slots 1-12):
  ```ts
  const PHASES: readonly TickPhase[] = [
    advanceTickPhase,                  // 1. time advance
    applyEconomyPhase,                 // 2. economy
    applyLocationEffectsPhase,         // 3. location effects
    applyCourierAndStaffPhase,         // 4. courier + verify + staff
    applySchemeResolutionPhase,        // 5. scheme resolution
    identityPhase,                     // 6. global-event roll (P1 stub)
    applyMoodDriftPhase,               // 7. mood drift
    applyHappinessPhase,               // 8. happiness drift
    applyPatronessErosionPhase,        // 9. patroness erosion
    applyForgerySurfacingPhase,        // 10. forgery surfacing roll (NEW at P10)
    applyThiefNoticePhase,             // 11. thief notice + auto-resolve (NEW at P10)
    applyRivalActionPhase,             // 12. rival-house action (ALWAYS LAST)
  ] as const;
  ```
  **Ordering rationale.** Forgery surfacing BEFORE thief notice so a surfacing-tick scandal cascade lands before the same-tick thief-notice roll reads reputation (a surfaced forgery doesn't immediately change rep — only the Vain-NPC cascade — so the order is defensive, not strictly required). Both run AFTER patroness erosion so artifact equip/unequip mid-tick can't perturb erosion's roll budget. Both BEFORE rivals per the non-negotiable.

- **New designer constants in `src/game/constants.ts`** (P10 additions; all literals tunable per playtest):
  ```ts
  // ── P10: Artifacts, Wardrobe, Forgery & Theft ────────────────────────────
  
  // Wardrobe decay (§10 Q10 resolution: global tick). Out-of-season ⇔ tick - lastRefreshTick > WARDROBE_REFRESH_INTERVAL_TICKS.
  export const WARDROBE_REFRESH_INTERVAL_TICKS = 40;        // ≈ 2 in-game years at ~20 ticks/year
  export const PRE_BALL_COMPOSURE_PENALTY_PER_OUT_OF_SEASON_ARTIFACT = 5;
  
  // Forgery surfacing (§3 line 433 "sub-percent").
  export const FORGERY_SURFACING_PROBABILITY_BASIS_POINTS = 30;   // 0.30% per tick per unsurfaced forgery
  export const FORGERY_SURFACING_VAIN_MOOD_LOCK_DURATION_TICKS = 15;
  export const FORGERY_SURFACING_VAIN_AFFECTION_DELTA = -10;       // applied to every Vain NPC's affection toward the player
  
  // Forgery commission cost is per-artifact (ArtifactDefinition.forgeWealthCost),
  // NOT a global constant — the spec gives a single cost per artifact.
  
  // Thief notice (§3 line 439).
  export const THIEF_NOTICE_REPUTATION_THRESHOLD = 70;
  export const VALUABLE_ARTIFACT_THRESHOLD = 6;                    // reputationBonusWhileEquipped >= this counts as "valuable"
  export const THIEF_NOTICE_PROBABILITY_BASIS_POINTS = 100;        // 1% per tick when both gates pass
  
  // Thwart (§3 line 441).
  export const THWART_WEALTH_COST = 15;
  export const THWART_SUCCESS_PROBABILITY_BASIS_POINTS = 8500;     // 85% — "high success probability"
  
  // Treason Framing (§3 line 188).
  export const TREASON_FRAMING_RIVAL_REPUTATION_DELTA = -25;
  export const TREASON_FRAMING_RIVAL_HOSTILITY_DELTA = 20;
  
  // Replace the live SCHEME_KINDS length assertion at :294:
  //   if (SCHEME_KINDS.length !== 7) throw ...
  // (was 6 pre-P10; updated as part of this phase's enum widening.)
  ```
  **Probability storage as basis points (× 10000)** — per CLAUDE.md "float-arithmetic in determinism-relevant paths" guidance + the existing P6 `STAFF_BRIBERY_PROBABILITY_BASIS_POINTS` precedent. The roll site uses `Math.floor(rngDraw * 10000) < THRESHOLD_BASIS_POINTS` integer comparison — engine-stable across V8/Bun/Node.
  
  **Module-load assertions** (defensive — applied during advisory triage):
  ```ts
  if (VALUABLE_ARTIFACT_THRESHOLD < 1) {
    throw new Error("VALUABLE_ARTIFACT_THRESHOLD < 1: every artifact would qualify as valuable, thief notice gate trivial");
  }
  if (FORGERY_SURFACING_PROBABILITY_BASIS_POINTS >= 10000) {
    throw new Error("FORGERY_SURFACING_PROBABILITY_BASIS_POINTS >= 10000: every forgery would surface in one tick");
  }
  if (PRE_BALL_COMPOSURE_PENALTY_PER_OUT_OF_SEASON_ARTIFACT < 0) {
    throw new Error("PRE_BALL_COMPOSURE_PENALTY_PER_OUT_OF_SEASON_ARTIFACT < 0: bonus instead of penalty");
  }
  if (FORGERY_SURFACING_PROBABILITY_BASIS_POINTS <= 0) {
    throw new Error("FORGERY_SURFACING_PROBABILITY_BASIS_POINTS <= 0: surfacing impossible, forgery loop inert");
  }
  ```

- **Scheme registry record extensions** (`src/game/constants.ts`). All four `Readonly<Record<SchemeKind, ...>>` consumers add a `TreasonFraming` entry. Strict TS catches a missing entry at compile.
  ```ts
  // src/game/constants.ts — P10 EDITS:
  
  export const SCHEME_KINDS = [
    "Courting", "Sabotage", "Seduction", "Chaperone", "Smuggling", "Assassination",
    "TreasonFraming",     // NEW at P10
  ] as const;
  
  // Length assertion updates 6 → 7:
  if (SCHEME_KINDS.length !== 7) { throw new Error(`SCHEME_KINDS length changed (${SCHEME_KINDS.length} !== 7) without save-version bump`); }
  
  export const SCHEME_TUNING: Readonly<Record<SchemeKind, { wealthCost: number; durationTicks: number }>> = {
    // ... existing 6 entries unchanged ...
    TreasonFraming: { wealthCost: 40, durationTicks: 5 },    // NEW at P10
  };
  
  export const SCHEME_PREREQUISITES: Readonly<Record<SchemeKind, readonly Archetype[]>> = {
    // ... existing 6 entries unchanged ...
    TreasonFraming: ["BohemianRake"],                        // NEW at P10 — BohemianRake-only (resolves cycle-4-iter-1 B3 contradiction with commission gate)
  };
  
  export const SCHEME_ERA_REQUIREMENTS: Readonly<Record<SchemeKind, "Earlier" | "Later" | null>> = {
    // ... existing 6 entries unchanged ...
    TreasonFraming: null,                                    // NEW at P10 — era-agnostic
  };
  ```

- **New pure-rule module `src/game/rules/artifacts.ts`.** Houses all five new rules. All return new state via hand-rolled clones per CLAUDE.md pure-rule structural-sharing contract (no Immer inside `src/game/rules/**`).
  
  - **`applyEquipArtifactPure(state, characterId, artifactInstanceId): GameState | { ok: false; reason: EquipRejection }`**. Validates in order: (1) artifact instance exists; (2) instance ownerCharacterId === characterId; (3) character is alive; (4) character.equippedArtifactIds doesn't already contain another instance of the same family (`MaxOnePerFamily`); (5) character.equippedArtifactIds doesn't already contain THIS instance (`AlreadyEquipped`). Mutates `state.characters` via clone + set (`{ ...char, equippedArtifactIds: [...char.equippedArtifactIds, artifactInstanceId] }`). No RNG; deterministic.
  
  - **`applyUnequipArtifactPure(state, characterId, artifactInstanceId): GameState | { ok: false; reason: UnequipRejection }`**. Validates: (1) character is alive; (2) character.equippedArtifactIds contains the instance. Mutates `state.characters` via clone + set (filter the instance out).
  
  - **`applyCommissionForgeryPure(state, forgerCharacterId, definitionId): GameState | { ok: false; reason: CommissionRejection }`**. Validates in order: (1) forger character exists + alive + houseId === PLAYER_HOUSE_ID; (2) forger archetype === "BohemianRake" (`MissingArchetype`); (3) artifact definition exists in `ARTIFACT_REGISTRY` (`UnknownDefinition`); (4) definition.forgeable === true (`NotForgeable`); (5) playerHouse.wealth >= definition.forgeWealthCost (`InsufficientWealth`). Mutates: (a) deduct wealth from `playerHouse`, (b) mint a new `ArtifactInstance` with `forgedFlag: true` + `ownerCharacterId: forgerCharacterId` (the forger holds the forgery; player can re-equip via `applyEquipArtifactPure`), (c) mint a new `ForgeryRecord { surfaced: false, surfacedAtTick: null }`. Atomic: validation → wealth deduction → mint, never partial.
  
  - **`applyForgerySurfacingPhase(state): GameState`** — tick-phase function. Walks `[...state.forgeries.values()].sort((a, b) => a.id.localeCompare(b.id))` (lex-sort discipline per CLAUDE.md non-negotiable). For each entry with `surfaced === false`, draws ONE roll from the player-house RNG stream. If `Math.floor(roll * 10000) < FORGERY_SURFACING_PROBABILITY_BASIS_POINTS`, the surfacing cascade fires (atomically in one `forgeries` set + `characters` accumulator pass + `affectionMap` accumulator pass — see "Per-iteration multi-Map accumulator" below). **Locked Vain NPCs DO participate in the cascade (resolves B2 prose/snippet inconsistency).** The CLAUDE.md "Locked characters skip BOTH the roll AND the draw" pin applies to MOOD DRIFT specifically — that mechanic gates the roll itself on `moodLockUntilTick > state.tick`. Forgery surfacing is a REACTIVE cascade per spec §3 line 434 ("every Vain non-player character is reactively shifted to Defensive locked for a fixed multi-tick lock period and loses a fixed affection delta") — no carve-out for already-locked NPCs. A Vain NPC who is ALREADY locked when a forgery surfaces gets their lock EXTENDED to `Math.max(currentLockUntilTick, state.tick + FORGERY_SURFACING_VAIN_MOOD_LOCK_DURATION_TICKS)` (the max-with-current preserves the longer of the two locks; we never shorten an existing lock) AND drops affection unconditionally. Cumulative draws per tick = count(unsurfaced forgeries) — the forgery-level roll is INDEPENDENT of Vain-NPC locks. The snippet at the "Per-iteration multi-Map accumulator" subsection below correctly omits a per-NPC `if (moodLockUntilTick > state.tick) continue;` guard — that absence is intentional, not a bug.
  
  - **`applyThiefNoticePhase(state): GameState`** — tick-phase function. THREE-stage gate:
    1. **Gate (a):** `state.houses.get(PLAYER_HOUSE_ID).reputation >= THIEF_NOTICE_REPUTATION_THRESHOLD`. If false → return state unchanged, no RNG draw.
    2. **Gate (b):** at least one equipped artifact instance owned by the player house has `definition.reputationBonusWhileEquipped >= VALUABLE_ARTIFACT_THRESHOLD`. If false → return state unchanged, no RNG draw.
    3. **Roll:** draw ONE player-house RNG roll. If `Math.floor(roll * 10000) < THIEF_NOTICE_PROBABILITY_BASIS_POINTS`, fire notice.
    
    Notice creates a new `ThiefAttempt` entity with `thwarted: null` (in-flight). The targeted instance is picked by `selectTargetedArtifactInstance(state)`: walks all equipped player-owned instances in lex-instance-id order, filters to valuable ones (`reputationBonusWhileEquipped >= VALUABLE_ARTIFACT_THRESHOLD`), picks the FIRST (lex order). Deterministic — no second RNG draw. The owner character is read from the picked instance's `ownerCharacterId`.
    
    **Auto-resolve sweep (same phase function, DIFFERENT attempts — resolves B4).** Walks `state.thiefAttempts.values()` for any entry with `thwarted === null` AND `noticedAtTick < state.tick` (strictly LESS THAN, **not** `<=`). The strict-less-than predicate is LOAD-BEARING: this same phase function CREATES new attempts above (with `noticedAtTick: state.tick`), and the sweep MUST NOT auto-resolve a just-created attempt in the same pass (otherwise the player loses every theft instantly without a chance to fire `thwartTheft`). Concretely:
    
    - When the phase runs at tick=T: any attempt CREATED this pass has `noticedAtTick = T`. The sweep predicate `T < T` is FALSE → just-created attempts SURVIVE the same pass.
    - When the phase runs at tick=T+1: any attempt from the PREVIOUS pass has `noticedAtTick = T`. The sweep predicate `T < T+1` is TRUE → it auto-resolves.
    
    This creates a one-tick window where the player can fire `thwartTheft(thiefAttemptId)` between tick=T (notice) and tick=T+1 (next advanceTick body invokes `applyThiefNoticePhase` → auto-resolve). Missing the window = silent loss. The strict-less-than predicate is the implementation-level invariant; the comment block inside the phase body must explicitly cite this: `// LOAD-BEARING: predicate is "< state.tick", NOT "<= state.tick". This function creates NEW attempts (noticedAtTick = state.tick) AND auto-resolves OLDER attempts (noticedAtTick < state.tick) in the same pass; the strict less-than keeps just-created attempts in-flight for the player to thwart.` Spec §3 line 442 ("non-thwarted theft removes the targeted artifact"). The auto-resolve transition is bus-published via `publishArtifactTransitions` from the tick-advancing wrapper that invoked the phase.
    
    **Why a one-tick window** (resolves the §7 edge case "theft against unequipped artifact"): if the player unequips the targeted instance between notice and auto-resolve, the next-tick auto-resolve detects `instance.ownerCharacterId.equippedArtifactIds` no longer contains the targeted id — sets `thwarted: true` with `resolvedAtTick: state.tick` and NO wealth cost (auto-thwarted per spec §7 line 649). The branch is encoded in the auto-resolve sweep: `if (instanceNotEquipped) { thwarted = true; } else { thwarted = false; remove instance; }`.
  
  - **`applyThwartTheftPure(state, thiefAttemptId): GameState | { ok: false; reason: ThwartRejection }`** — player-elected free action. Validates: (1) `state.thiefAttempts.get(id)` exists with `thwarted === null` (`AttemptNotFound` / `AttemptAlreadyResolved`); (2) player house has a living Spymaster archetype family member (`MissingSpymaster`); (3) playerHouse.wealth >= THWART_WEALTH_COST (`InsufficientWealth`); (4) player house has at least one InFlight courier (the "1 in-flight payload slot" cost — see §7-resolution below). Mutations on success-roll branch:
    - Always deduct `THWART_WEALTH_COST` from playerHouse.wealth (cost burned regardless of roll outcome — per CLAUDE.md "deduct second, apply effects third" — wealth is the cost surface, the roll determines whether the artifact survives).
    - Drop the oldest (lex-id) InFlight courier (status flips `InFlight → Intercepted`; mirrors P6 `spymasterIntercept` at `src/game/store.ts:~1180`).
    - Draw ONE player-house RNG roll; if `roll < THWART_SUCCESS_PROBABILITY_BASIS_POINTS / 10000` → `thwarted: true` (artifact survives). Else `thwarted: false` (artifact removed from owner — same removal logic as auto-resolve).
    - Set `resolvedAtTick: state.tick`.
  
  **"1 in-flight payload slot" semantics (resolves B1 / thwart courier-filter).** The thwart action consumes one of the player house's couriers picked by the FULL 4-predicate filter matching `trySpymasterMailIntercept` (verified live at `src/game/rules/staff.ts:290-303`): `c.status === "InFlight" && c.direction === "Inbound" && c.destinationHouseId === PLAYER_HOUSE_ID && c.interceptable`. Selection: oldest by `lex(c.id)` (deterministic across saves). No "slot" entity exists; the existing courier system IS the slot pool. If the player has zero couriers matching ALL FOUR predicates, the thwart action returns `NoInFlightCourier` rejection. **Why the full 4-predicate filter** (not just `InFlight`): (a) Outbound couriers are player → rival messages; consuming one to "thwart a thief" makes no narrative sense and would silently lose game state the player initiated. (b) Non-interceptable couriers are protected by their type (the `interceptable` flag exists precisely so the Spymaster action can't burn them). (c) `destinationHouseId === PLAYER_HOUSE_ID` matches `trySpymasterMailIntercept` semantics; widening would consume couriers headed for rivals.
  ```ts
  // src/game/rules/artifacts.ts — pseudocode for the courier-pick step inside applyThwartTheftPure:
  const candidates = [...state.couriers.values()]
    .filter(c =>
      c.status === "InFlight" &&
      c.direction === "Inbound" &&
      c.destinationHouseId === PLAYER_HOUSE_ID &&
      c.interceptable === true
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  if (candidates.length === 0) return { ok: false, reason: { kind: "NoInFlightCourier" as const } };
  const burnedCourier = candidates[0];  // oldest lex-id
  ```
  The narrative reading: thwarting a theft demands the Spymaster's communication budget; you can't be intercepting interceptable inbound mail AND chasing thieves simultaneously. Mirror of `trySpymasterMailIntercept` for budget-symmetry.
  
  **All five rule functions follow the hand-rolled-clone discipline** per CLAUDE.md "Pure-rule structural-sharing contract": `new Map(state.X)` + `.set(...)` + `{ ...state, X: newMap }`. No Immer inside `src/game/rules/artifacts.ts`.

- **Forgery surfacing cascade — per-iteration multi-Map accumulator (CLAUDE.md non-negotiable).** When `applyForgerySurfacingPhase` flips a forgery's `surfaced` field, the cascade walks `state.characters.values()` for every Vain-trait carrier AND mutates BOTH:
  - `state.characters` — sets `moodLockUntilTick = max(currentLockUntil, state.tick + FORGERY_SURFACING_VAIN_MOOD_LOCK_DURATION_TICKS)` + `mood: "Defensive"`. Locked characters (where `currentLockUntil > state.tick + duration`) keep the longer lock (we never shorten an existing lock).
  - `state.affectionMap` — for each Vain NPC, the key `(npc.houseId, player-head-character-id)` (built via `makePairKey`) gets clamped `affection = max(0, affection - 10)`.
  
  All three writes (`state.forgeries` flip + `state.characters` accumulator + `state.affectionMap` accumulator) happen in ONE pass per surfaced forgery. The loop accumulator pattern (per CLAUDE.md "Per-iteration multi-Map accumulator pattern (P6)"):
  ```ts
  // src/game/rules/artifacts.ts — applyForgerySurfacingPhase pseudocode:
  let acc = { ...state, rng: state.rng };
  let charsChanged = false;  let newChars = state.characters;
  let affChanged = false;    let newAffection = state.affectionMap;
  let forgChanged = false;   let newForgeries = state.forgeries;
  
  const playerHead = state.houses.get(PLAYER_HOUSE_ID).headOfHouseCharacterId;
  const sortedForgeries = [...state.forgeries.values()].sort((a, b) => a.id.localeCompare(b.id));
  
  for (const forgery of sortedForgeries) {
    if (forgery.surfaced) continue;
    const { next: roll, rngState: nextRng } = drawNext(getOrThrow(acc.rng, PLAYER_HOUSE_ID));
    acc = { ...acc, rng: new Map(acc.rng).set(PLAYER_HOUSE_ID, nextRng) };
    
    if (Math.floor(roll * 10000) < FORGERY_SURFACING_PROBABILITY_BASIS_POINTS) {
      // Surface flip:
      if (!forgChanged) { newForgeries = new Map(state.forgeries); forgChanged = true; }
      newForgeries.set(forgery.id, { ...forgery, surfaced: true, surfacedAtTick: state.tick });
      
      // Cascade — iterate ALL characters (lex-sort by id per CLAUDE.md discipline):
      const sortedChars = [...state.characters.values()].sort((a, b) => a.id.localeCompare(b.id));
      for (const ch of sortedChars) {
        if (!ch.alive) continue;
        if (ch.houseId === PLAYER_HOUSE_ID) continue;
        if (!ch.traits.includes("Vain" as TraitId)) continue;
        // Mood lock + mood flip (read from newChars for accumulator coherence):
        if (!charsChanged) { newChars = new Map(state.characters); charsChanged = true; }
        const currentCh = newChars.get(ch.id)!;
        const newLockUntil = Math.max(currentCh.moodLockUntilTick, state.tick + FORGERY_SURFACING_VAIN_MOOD_LOCK_DURATION_TICKS);
        newChars.set(ch.id, { ...currentCh, mood: "Defensive", moodLockUntilTick: newLockUntil });
        // Affection drop (clamped at 0):
        const key = makePairKey(ch.houseId, playerHead);
        const currentAff = newAffection.get(key) ?? 0;   // default 0 per project convention (verified at src/game/store.ts:888 + src/game/rules/proposal.ts:158)
        const nextAff = Math.max(0, Math.min(100, currentAff + FORGERY_SURFACING_VAIN_AFFECTION_DELTA));
        if (!affChanged) { newAffection = new Map(state.affectionMap); affChanged = true; }
        newAffection.set(key, nextAff);
      }
    }
  }
  
  return {
    ...acc,
    forgeries: forgChanged ? newForgeries : state.forgeries,
    characters: charsChanged ? newChars : state.characters,
    affectionMap: affChanged ? newAffection : state.affectionMap,
  };
  ```
  **Transactionality guarantee** (resolves §7 "Forgery surfacing cascade"): every Vain NPC's mood lock AND affection drop are written before the function returns. There is no partial-application path — a thrown exception mid-cascade would bubble up before the `return`, so callers either see the post-cascade state or the pre-cascade state (single-return discipline).

- **Reputation + trait grant projection (resolves R1).** Equipped artifacts contribute reputation bonus and trait grants AS A PROJECTION at read sites, NOT as a mutation into `house.reputation` / `character.traits`. Rationale:
  - **Reputation:** if equip mutated `house.reputation`, unequip would have to subtract the SAME bonus, but the cap-at-100 clamp would silently lose value (equip 8, clamp to 100 → unequip subtracts 8 → 92 ≠ original 100). Projection avoids the cap-asymmetry.
  - **Trait grants:** if equip mutated `character.traits`, every consumer (`applyMoodDriftPhase`, `applyConceptionStep`, `classifyArchetype`, persona prompt) would see the granted trait. Persona-cache invalidation would have to fire on every equip/unequip — bloated. Projection means consumers OPT IN by calling `getEffectiveTraits(state, characterId)` when they want the equipped-trait view; default reads of `character.traits` continue to see the persistent-only set.
  
  Two new selectors in `src/game/rules/artifacts.ts`:
  ```ts
  export function getEffectiveReputation(state: GameState, houseId: HouseId): number {
    const house = state.houses.get(houseId);
    if (!house) return 0;
    let bonus = 0;
    for (const ch of state.characters.values()) {
      if (ch.houseId !== houseId || !ch.alive) continue;
      for (const instId of ch.equippedArtifactIds) {
        const inst = state.artifactInstances.get(instId);
        if (!inst) continue;
        const def = ARTIFACT_REGISTRY.get(inst.definitionId);
        if (!def) continue;
        bonus += def.reputationBonusWhileEquipped;
      }
    }
    return Math.max(0, Math.min(100, house.reputation + bonus));
  }
  
  export function getEffectiveTraits(state: GameState, characterId: CharacterId): TraitId[] {
    const ch = state.characters.get(characterId);
    if (!ch) return [];
    const granted: TraitId[] = [];
    for (const instId of ch.equippedArtifactIds) {
      const inst = state.artifactInstances.get(instId);
      if (!inst) continue;
      const def = ARTIFACT_REGISTRY.get(inst.definitionId);
      if (!def) continue;
      for (const t of def.traitGrantsWhileEquipped) {
        if (!ch.traits.includes(t) && !granted.includes(t)) granted.push(t);
      }
    }
    return [...ch.traits, ...granted];
  }
  ```
  **Persona prompt integration (resolves B4 + B8 + R11).** The persona prompt currently reads `character.traits` directly (verified at `server/prompts/persona.ts`). The P10 EDIT: the snapshot-construction site at `src/game/store.ts:760-772` (inside the `sendBallroomMessage` wrapper, just before the `await conversationOrchestrator.send(request, ...)` call) is extended to ship the effective-trait union. Concrete edit:
  ```ts
  // src/game/store.ts:760-772 (P10 EDIT — extends the existing literal):
  const request = {
    targetCharacterId: target.id,
    playerHouseId: PLAYER_HOUSE_ID,
    freeformMessage: input.freeformMessage,
    history,
    otherCharactersInScene,
    characterStateSnapshot: {
      // P10: shallow-clone target so the effective-traits projection does NOT
      // mutate state.characters. The live `target` object is the Map.get(...)
      // reference; spreading it produces a fresh literal whose `traits` field
      // can be overwritten safely. Same discipline applies to spouse + otherCharactersInScene if those also need effective traits (deferred — only `target` reads `traits` in the persona prompt at P10).
      // P10 defensive shallow-copy (resolves B2 from cycle-3 review):
      // - getEffectiveTraits returns a NEW array (`[...ch.traits, ...granted]`)
      //   so the `traits` write is safe.
      // - The `target` spread `{...target, ...}` is a fresh object; safe.
      // - HOWEVER `target.equippedArtifactIds` (and any other array fields on
      //   Character that future-phase persona prompts may read) is shared
      //   with state.characters. Defensive copy avoids leaking projection writes
      //   into GameState if a future phase tags the snapshot at this site.
      target: {
        ...target,
        traits: getEffectiveTraits(stateBefore, target.id),
        equippedArtifactIds: [...target.equippedArtifactIds],  // shallow array copy
      },
      otherCharactersInScene,
      targetMarriage,
      spouse,
    },
  };
  ```
  No server-side code changes — the proxy reads `request.characterStateSnapshot.target.traits` as before; the effective union now rides on that wire field. **`PERSONA_CACHE_VERSION` BUMP IS REQUIRED** because the SNAPSHOT shape changes (`characterStateSnapshot.target.traits` now carries the effective union, not the persistent set). Bump `PERSONA_CACHE_VERSION = "v3"` → `"v4"` at `src/game/constants.ts:478` per the CLAUDE.md "Persona prompt format version bump" non-negotiable. The cache key in `server/personaCache.ts` is `(CharacterId|Model|version)`; bumping `version` is necessary AND sufficient to invalidate stale v3-keyed entries. **NO `src/llm/buildRequest.ts` file exists** — that file path was an editor-error from a prior plan iteration; the canonical snapshot site is the inline `sendBallroomMessage` literal cited above.
  
  **Reputation read-site sweep.** Every read of `house.reputation` in user-facing or rule-relevant code SHOULD switch to `getEffectiveReputation` (rep is queried by patroness erosion, by reputation-threshold-gated scheme prerequisites if any, by thief notice gate (a), by the P14 ledger). At P10, the explicit edit list:
  - `applyThiefNoticePhase` reads `getEffectiveReputation(state, PLAYER_HOUSE_ID)` for gate (a) — equipping a high-rep artifact CAN trigger thief notice.
  - `applyPatronessErosionPhase` (`src/game/rules/patronesses.ts`) continues to read raw `house.reputation` at P10 — patroness erosion gates on the persistent stat, not the equipped projection (design call: patroness favor decays with the underlying house standing, not with what you wear to her ball). Future v1.5 may revisit.
  - `getEffectiveReputation` is exported but unused at P10 outside the thief notice phase + the P14 ledger (which is out-of-scope for P10).
  
  **Why not mutate-and-clamp:** the equip/unequip symmetry-loss issue is the canonical reason. Documented inline at the projection helper.

- **Scandal-risk-while-worn integration.** Spec §3 line 168 says equipped artifacts incur "scandal-risk while worn." Implementation: `applyEconomyPhase` (slot 2) — verified live at `src/game/rules/economy.ts:33-53` — extends the EXISTING `for (const [houseId, house] of state.houses)` loop's player-house branch. The `if (RIVAL_HOUSE_IDS_SET.has(houseId)) continue;` gate at `:39` means the artifact-scandal additive write MUST land INSIDE the loop AT THE PLAYER/INDEPENDENT branch (after the gate's `continue`), folded into the existing `houses.set(houseId, { ...house, ..., scandal: clamp(house.scandal + delta.scandal, 0, 100) })` literal at `:47-52`. Concrete edit shape:
  ```ts
  // src/game/rules/economy.ts (P10 EDIT — extend the houses.set body inside
  // the player/Independent branch, AFTER the RIVAL_HOUSE_IDS_SET gate):
  
  // Pre-P10 line :47-52:
  //   houses.set(houseId, {
  //     ...house,
  //     wealth: house.wealth + delta.wealth,
  //     reputation: clamp(house.reputation + delta.reputation, 0, 100),
  //     scandal: clamp(house.scandal + delta.scandal, 0, 100),
  //   });
  
  // Post-P10:
  let artifactScandalDelta = 0;
  if (houseId === PLAYER_HOUSE_ID) {
    for (const ch of state.characters.values()) {
      if (ch.houseId !== PLAYER_HOUSE_ID || !ch.alive) continue;
      for (const instId of ch.equippedArtifactIds) {
        const inst = state.artifactInstances.get(instId);
        if (!inst) continue;
        const def = ARTIFACT_REGISTRY.get(inst.definitionId);
        if (!def) continue;
        artifactScandalDelta += def.scandalRiskWhileEquipped;
      }
    }
  }
  houses.set(houseId, {
    ...house,
    wealth: house.wealth + delta.wealth,
    reputation: clamp(house.reputation + delta.reputation, 0, 100),
    scandal: clamp(house.scandal + delta.scandal + artifactScandalDelta, 0, 100),  // single clamp at write
  });
  ```
  **Single clamp at write** (CLAUDE.md non-negotiable §6): the additive composes BEFORE the clamp; no double-clamp. **Order: economy-tier delta first, then artifact additive** — both are per-tick scandal sources from this phase, and they compose linearly under the same clamp. **Silent by design at v1** (resolves the recurring R13/R24/R-trickle advisory): no `ArtifactScandalTrickle` bus event ships at P10. Rationale: the trickle is a steady-state effect (each tick adds the same value while equipment is unchanged), bus events fit discrete transitions better, and the P14 ledger surfaces the trickle via the projection `effectiveScandalContributionFromArtifacts(state)` selector (also defined in `src/game/rules/artifacts.ts`; mirrors `getEffectiveReputation`). For v1 only the player house pays this cost (rival houses don't equip artifacts per R7 cross-walk below, AND the explicit `houseId === PLAYER_HOUSE_ID` guard above belt-and-suspenders the narrow scope).

- **Pre-ball composure penalty (resolves R2 + cycle-5-iter-1 B1).** Spec §3 line 174 + line 427 (§7): "Out-of-season artifact equipped mid-ball — snapshot at entry." Live `enterBallroom` at `src/game/store.ts:672-698` is a SYNCHRONOUS return-only wrapper with NO `set()` body — verified. P10 introduces a new pure rule + extends the wrapper to call `set((draft) => overwriteFromGameState(draft, ...))` BEFORE the `beginSession` call. Concrete shape:
  
  **New pure rule** `src/game/rules/artifacts.ts:applyPreBallComposurePenaltyPure(state) => GameState`:
  ```ts
  // src/game/rules/artifacts.ts (NEW pure rule at P10):
  export function applyPreBallComposurePenaltyPure(state: GameState): GameState {
    const player = state.houses.get(PLAYER_HOUSE_ID);
    if (!player) return state;
    const playerHead = state.characters.get(player.headOfHouseCharacterId);
    if (!playerHead || !playerHead.alive) return state;
    let outOfSeasonPenalty = 0;
    for (const instId of playerHead.equippedArtifactIds) {
      const inst = state.artifactInstances.get(instId);
      if (!inst) continue;
      if (state.tick - inst.lastRefreshTick > WARDROBE_REFRESH_INTERVAL_TICKS) {
        outOfSeasonPenalty += PRE_BALL_COMPOSURE_PENALTY_PER_OUT_OF_SEASON_ARTIFACT;
      }
    }
    if (outOfSeasonPenalty === 0) return state;  // structural-sharing short-circuit
    const newComposure = Math.max(0, Math.min(playerHead.maxComposure, playerHead.composure - outOfSeasonPenalty));
    const newChars = new Map(state.characters);
    newChars.set(playerHead.id, { ...playerHead, composure: newComposure });
    return { ...state, characters: newChars };
  }
  ```
  
  **`enterBallroom` wrapper extension** at `src/game/store.ts:672-698`:
  ```ts
  // src/game/store.ts:672-698 (P10 EDIT — extend the existing wrapper body):
  enterBallroom: () => {
    const stateBefore = get();
    // ... existing PlayerExiled gate (:674-676) ...
    // ... existing ElopementInProgress gate (:677-679) ...
    const player = stateBefore.houses.get(PLAYER_HOUSE_ID);
    if (player === undefined || player.currentLocation !== "Capital") {
      return { ok: false, reason: { kind: "WrongLocation", current: player?.currentLocation ?? "Capital" } as const };
    }
    // P10 ADDITION — apply pre-ball out-of-season composure penalty BEFORE beginSession.
    // Snapshot semantics: deduction persists into GameState; subsequent mid-ball
    // equip/unequip does NOT re-trigger this. The set() body THEN beginSession
    // ordering is load-bearing — beginSession reads the post-deduction composure.
    const stateAfterPenalty = applyPreBallComposurePenaltyPure(stateBefore);
    if (stateAfterPenalty !== stateBefore) {
      set((draft) => { overwriteFromGameState(draft, stateAfterPenalty); });
    }
    const sessionId = conversationOrchestrator.beginSession(get().tick);
    conversationBus.publish({ kind: "BallroomEntered", tick: get().tick, houseId: PLAYER_HOUSE_ID, sessionId });
    return { ok: true, sessionId };
  },
  ```
  The structural-sharing short-circuit (`if (stateAfterPenalty !== stateBefore)`) avoids a no-op `set()` when there are zero out-of-season artifacts.
  **Storage shape:** the snapshot is APPLIED at entry (composure deducted) and discarded — it doesn't persist as a session field. If the player saves mid-ball and reloads, the composure value is already deducted (no re-snapshot path). This avoids a `BallroomSession.outOfSeasonPenaltyApplied` flag that would need its own schema + migration; the composure deduction IS the snapshot. **Equipping a fresh artifact mid-ball does NOT add penalty** (the snapshot already ran); **unequipping an out-of-season artifact mid-ball does NOT refund penalty** (same). Matches the §7 "Out-of-season artifact equipped mid-ball" spec line. The wardrobe-refresh action mid-ball (via free action — wardrobe refresh is at the Capital location only, NOT inside ballroom; technically unreachable from inside an active session) is moot because `refreshWardrobe` requires `currentLocation === Capital` and ballroom IS the Capital, but it's a free action; the spec resolution is "refresh is at the high-society location" — refresh inside an active ball is allowed but doesn't refund the penalty. Verification scenario: `enterBallroom` with two out-of-season artifacts equipped deducts `2 * PRE_BALL_COMPOSURE_PENALTY_PER_OUT_OF_SEASON_ARTIFACT` from the head's composure.

- **Wardrobe refresh extension (existing P3 `refreshWardrobe` action).** The action currently sets `house.wardrobeLastRefreshTick = state.tick` at `src/game/rules/wardrobeRefresh.ts:47`. P10 EDIT: ALSO walks every player-house character's `equippedArtifactIds`, fetches the `ArtifactInstance`, sets `lastRefreshTick = state.tick` on each. The wardrobe refresh CONTINUES to reset the house-level field for backward-compat (a v1.5 rule may revive it), but the load-bearing read-site at `enterBallroom` switches to the per-instance `lastRefreshTick`. The two stay in sync because `refreshWardrobe` mutates both atomically. **Cost stays at `WARDROBE_REFRESH_WEALTH_COST = 20`** (unchanged from P3). **Bankruptcy gating (§7 "Wardrobe refresh during bankruptcy") stays at the UI layer at v1 — NOT the rule layer (resolves B6 from cycle-3 review).** Verified live at `src/game/rules/wardrobeRefresh.ts:28-37` + the comment block at lines 5-8: "NOT gated on wealth ... the warning is a UI concern. The rule layer always permits the action at Capital regardless of wealth." `WardrobeRejection` carries only `WrongLocation` + the two modal-state gates; there is no `acceptBankruptcyWarning` input field. The §7 edge case ("Wardrobe refresh during bankruptcy: warn but allow") is satisfied because the rule layer always permits the action; the warning surface is the player-facing UI in P14 (out-of-scope for P10). P10 does NOT add a rule-layer wealth-gate or warning-override input.

- **Treason Framing scheme (resolves B5 + B7 — `TreasonFraming` SchemeKind addition).** The 7th scheme kind, gated on at least one unsurfaced forgery. Threading through the existing P5 `tryStartScheme` infrastructure WITHOUT widening `SchemeSchema` — Treason Framing reuses the existing `targetCharacterId: CharacterId` field on `Scheme` (verified live at `src/game/entities.ts:227`), targeting the RIVAL HEAD'S character id. The rule layer derives the rival house via `state.characters.get(targetCharacterId).houseId`. This matches the Assassination dispatch pattern (Assassination also takes a `targetCharacterId`); no schema change, no save-format implications beyond the SchemeKind enum widening already pinned above. (Path (b) chosen over the heavier alternative (a) of widening `SchemeSchema` with a new `targetHouseId` field.)
  - `Scheme.kind` discriminated union widens to include `"TreasonFraming"`.
  - `tryStartScheme` validates the new kind in the existing per-kind switch. Validation:
    1. Inputs: `targetCharacterId: CharacterId` required (NOT null — rejects with `{ kind: "MissingTarget" }` when null). Treason Framing is the SECOND kind (after Assassination) that requires a non-null `targetCharacterId`; existing per-kind null-validation cases in `tryStartScheme` extend to include `TreasonFraming` in the "requires target" set.
    2. `state.forgeries.values().some(f => !f.surfaced)` — at least one unsurfaced forgery. If false → `{ kind: "MissingUnsurfacedForgery" }` rejection.
    3. Derived rival house must be a rival: `const targetHouseId = state.characters.get(targetCharacterId)?.houseId; if (!RIVAL_HOUSE_IDS_SET.has(targetHouseId)) → { kind: "InvalidTreasonFramingTarget", targetCharacterId, derivedHouseId: targetHouseId ?? null }`. The targeted character must also be alive (`alive === true`) — else `{ kind: "TargetIsDead" }` (reuses the existing variant per `src/game/rules/schemes.ts:62`).
    4. Standard wealth, archetype, era prereqs from the Record extensions. **`SCHEME_PREREQUISITES.TreasonFraming = ["BohemianRake"]` only (NOT the Assassination pair `["BohemianRake", "CountryExile"]`) — resolves cycle-4-iter-1 B3.** Rationale: spec §3 line 180 explicitly requires a BohemianRake to COMMISSION a forgery; allowing CountryExile to START a TreasonFraming scheme would create a deadlock state where a CountryExile-only player house can start the scheme but cannot produce the unsurfaced forgery the scheme consumes. Narrowing to BohemianRake makes the prerequisite chain coherent: the same archetype that produces the forgery resource is the one that can spend it via TreasonFraming. CountryExile retains its canonical role as deniable proxy for ASSASSINATION (spec §3 line 230); the "deniable proxy" framing in spec §3 was specifically about Assassination, not Treason Framing.
  - Resolution (in `applySchemeResolutionPhase` for the new `case "TreasonFraming"` branch):
    1. Re-read targeted character + derive rival house from `state.characters.get(scheme.targetCharacterId).houseId` (the same lookup pattern Assassination uses — handles same-tick death of the target).
    2. Decrement `rival.reputation += TREASON_FRAMING_RIVAL_REPUTATION_DELTA` (clamped `[0, 100]`).
    3. Increment `rival.hostility += TREASON_FRAMING_RIVAL_HOSTILITY_DELTA` (clamped `[0, 100]`).
    4. Pick the LEX-FIRST unsurfaced forgery (deterministic) and flip its `surfaced: true` + `surfacedAtTick: state.tick`. **The Vain-NPC cascade DOES NOT fire on consumption-surfacing** — the spec §3 line 433 says the Vain-NPC cascade is the surfacing-roll consequence; a Treason-Framing-consumed forgery is "spent" surfaced (it can't be reused) but doesn't carry the per-tick-roll narrative. The `ForgerySurfaced` bus event still fires from `publishArtifactTransitions` (with `viaConsumption: true` discriminator) so subscribers know the surfacing happened, just without the cascade.
    5. Standard `flipSchemeStatus(state, scheme.id, "Completed", null)` (per P5).
    6. If the targeted character died between start and resolution (rare — the cooldown is 5 ticks per `SCHEME_TUNING`), the existing P5 `TargetDied` failure branch fires INSTEAD of the resolution above (rival house no-op; forgery NOT consumed). Matches Assassination's same-target-death handling.
  - New `StartSchemeRejection` variants. Live `StartSchemeRejection` (verified at `src/game/rules/schemes.ts:57-67`) carries 11 variants pre-P10 — NONE of which is `MissingTarget`. The current null-target handling at `src/game/rules/schemes.ts:~196-198` THROWS as a precondition assert (`throw new Error(\`tryStartScheme: kind=${kind} requires a non-null targetCharacterId\`)`); P10 converts this throw into a TYPED rejection so the new TreasonFraming + existing Assassination null-target paths return the same shape. **This is a structural change, not an extension** — P10 (a) appends `MissingTarget` to the rejection union, (b) replaces the existing throw at `schemes.ts:~196-198` with `return { ok: false, reason: { kind: "MissingTarget" } as const }`, (c) updates the SOLE existing throw-relying call site (none — verified via `grep "tryStartScheme:" src/` returns only the throw definition; no consumer catches it; the throw was a contract-violation assert).
    ```ts
    // src/game/rules/schemes.ts (P10 EDIT — FOUR NEW typed variants appended to the union):
    | { kind: "MissingTarget" }                                                                                  // NEW at P10 — replaces the pre-P10 throw at :196-198; reused by TreasonFraming + Assassination
    | { kind: "TargetNotFound"; targetCharacterId: CharacterId }                                                 // NEW at P10 — replaces the pre-P10 throw at :199-203 (cycle-4-iter-1 B2)
    | { kind: "MissingUnsurfacedForgery" }                                                                       // NEW at P10
    | { kind: "InvalidTreasonFramingTarget"; targetCharacterId: CharacterId; derivedHouseId: HouseId | null }    // NEW at P10
    ```
    Throw-to-return migration — **BOTH precondition throws in `tryStartScheme` convert** (resolves cycle-4-iter-1 B2). **Validation ordering pinned (resolves cycle-5-iter-1 B2):** the converted typed rejections STAY AT THE TOP OF THE FUNCTION in their existing `(a) precondition asserts` slot (verified live at `src/game/rules/schemes.ts:188-203`). Specifically: `MissingTarget` and `TargetNotFound` fire BEFORE all `(b)/(c)/(d)` gates (resource/state/target-state checks); the existing `(b)` cheap-resource `InsufficientWealth` check at line 219 fires AFTER both, the `(c)` `MissingArchetype` + `WrongEra` at lines 230-252 fire AFTER both, and the `(d)` target-state `TargetIsDead` + `SelfTarget` at lines 254-267 fire AFTER both. The validation-order comment block at `:188-194` updates to acknowledge the precondition slot now returns typed rejections (NOT throws):
    ```ts
    // src/game/rules/schemes.ts:~188-203 (P10 EDIT — update the comment block + ordering):
    // PRE-P10 comment:
    //   // (a) Precondition asserts (throw — not typed rejection)
    // POST-P10 comment:
    //   // (a) Precondition gates (typed rejection at P10; pre-P10 these threw).
    //   //     MissingTarget + TargetNotFound fire FIRST so downstream gates can
    //   //     safely deref state.characters.get(targetCharacterId).
    ```
    The ordering matters for test observability — a TreasonFraming start that fails BOTH the null-target check AND the wealth check should surface as `MissingTarget`, not `InsufficientWealth`. Vitest fixtures asserting rejection-priority depend on this. Live `src/game/rules/schemes.ts:196-203` has TWO precondition throws (verified): `:196-198` (null `targetCharacterId` for non-Smuggling kinds) AND `:199-203` (target character lookup returns `undefined`). Converting only the first leaves an asymmetric typed-rejection contract — a stale CharacterId (target removed between UI build and dispatch) would silently throw instead of returning typed rejection. P10 converts both:
    ```ts
    // src/game/rules/schemes.ts:~196-203 (P10 EDIT — replace BOTH throws):
    // PRE-P10:
    //   if (kind !== "Smuggling" && targetCharacterId === null) {
    //     throw new Error(`tryStartScheme: kind=${kind} requires a non-null targetCharacterId`);
    //   }
    //   if (kind !== "Smuggling" && targetCharacterId !== null) {
    //     const target = state.characters.get(targetCharacterId);
    //     if (target === undefined) {
    //       throw new Error(`tryStartScheme: target character ${targetCharacterId} not found`);
    //     }
    //   }
    // POST-P10:
    if (kind !== "Smuggling" && targetCharacterId === null) {
      return { ok: false, reason: { kind: "MissingTarget" as const } };
    }
    if (kind !== "Smuggling" && targetCharacterId !== null) {
      const target = state.characters.get(targetCharacterId);
      if (target === undefined) {
        return { ok: false, reason: { kind: "TargetNotFound" as const, targetCharacterId } };
      }
    }
    ```
    `TargetNotFound` is added as a new variant alongside `MissingTarget` in the `StartSchemeRejection` union extension below.
    **Call-site exhaustive-switch update (resolves B3 from cycle-3 review).** Converting throw→typed-rejection widens the `StartSchemeRejection` union from 11 to 14 variants (`MissingTarget` + `MissingUnsurfacedForgery` + `InvalidTreasonFramingTarget`). Strict TS catches non-exhaustive switches at compile time. P8's plan body cites "10 existing call sites" for the `tryStartScheme.input.skipWealthDeduction` widening; the same call-site set consumes the rejection union. Each call site that destructures `result` with an exhaustive `switch (result.reason.kind)` must extend with arms for the 3 new variants (or use a `default` branch — non-exhaustive switches compile cleanly and silently widen). Implementer audit at P10:
    ```bash
    # Find every tryStartScheme consumer to audit:
    rg -n "tryStartScheme\(" src/ --type ts
    # Plus every consumer of the rejection union (broader; some destructure outcomes elsewhere):
    rg -n "StartSchemeRejection" src/ --type ts
    ```
    Expected: typecheck-clean if all consumers use `default` branches OR explicitly handle the 3 new variants. The P9 plan's typecheck-is-the-canonical-audit principle applies: `pnpm typecheck` is the authoritative gate; the grep is supplementary. **Most consumers in the live codebase use the `if (!result.ok) return result.reason.kind === "..." ? ... : ...` pattern (string-switch on the discriminant) which is non-exhaustive by construction and silently widens** — the union expansion ships cleanly without per-site edits for those callers. The exhaustive-switch caller paths (typically test files + the wrapper-level UI surface in `src/game/store.ts` for direct `startScheme` consumers) need targeted extension.

- **New store-action wrappers (`src/game/store.ts`). All four are FREE ACTIONS (resolves B3).** None advance tick — equip/unequip/commissionForgery/thwartTheft all resolve in-dispatch via `set((draft) => { overwriteFromGameState(draft, result); })` without calling `advanceTickPure`. Rationale: the spec doesn't gate any of these on tick consumption; making them free preserves player agency over WHEN time passes (the player chooses to advance via the existing `advanceTick` button or via a tick-consuming action like `travel`). Forge wealth deduction + thwart wealth deduction are mutation costs, not tick costs. Per the CLAUDE.md "pre-tick action pattern" pin: pre-tick actions are the ones that mutate state THEN call advanceTickPure; P10 wrappers do NEITHER (mutate-only, no advance). This matches the P6 `weaponizeWhisper` / `dismissWhisper` / `assignStaff` / `spymasterIntercept` precedent — all four are free actions that mutate state without advancing tick. Each follows the P5/P6/P7/P8/P9 wrapper template with both modal-state gates AND the standard mutation pattern.
  
  **Publisher contract for free-action mints (resolves B3 follow-up).** Since the four wrappers are free actions, they do NOT trigger the 7/7/7 publisher trio (the trio fires from tick-advancing wrappers only). The new `publishArtifactTransitions` diff helper (defined below) MUST therefore watch for transitions even in non-tick paths to surface free-action mints. Concretely: `commissionForgery` directly publishes `ForgeryCreated` (new variant, not part of the diff helper — analogous to P6's `weaponizeWhisper` direct-publish of `WhisperWeaponized`) on `artifactBus` AT THE END of the wrapper body BEFORE the `return { ok: true }`. Symmetric: `thwartTheft` direct-publishes `TheftResolved` (with `outcome: "Thwarted" | "Stolen"`). `equipArtifact` / `unequipArtifact` do NOT publish — equipment changes are query-able via the existing GameState read; no audit-log need. **The `publishArtifactTransitions` diff helper covers ONLY `ForgerySurfaced` + `ThiefNoticeFired` + auto-resolve `TheftResolved`** (the three transitions that fire from tick-advancing phases). Direct-publish from wrappers vs diff-helper-from-tick-advance is the split.
  
  Updated bus variants:
  ```ts
  export type ArtifactEvent =
    | { kind: "ForgeryCreated"; tick: number; forgeryId: ForgeryId; forgerCharacterId: CharacterId }                                                       // direct-publish from commissionForgery
    | { kind: "ForgerySurfaced"; tick: number; forgeryId: ForgeryId; viaConsumption: boolean }                                                              // diff-helper from tick-advance OR direct-publish from Treason Framing resolution
    | { kind: "ThiefNoticeFired"; tick: number; thiefAttemptId: ThiefAttemptId; targetedArtifactInstanceId: ArtifactInstanceId }                            // diff-helper from applyThiefNoticePhase
    | { kind: "TheftResolved"; tick: number; thiefAttemptId: ThiefAttemptId; outcome: "Thwarted" | "Stolen" | "AutoThwarted" };                              // diff-helper from auto-resolve sweep OR direct-publish from thwartTheft
  ```
  
  Wrapper return types:
  ```ts
  equipArtifact: (characterId: CharacterId, artifactInstanceId: ArtifactInstanceId) => { ok: true } | { ok: false; reason: EquipRejection };
  unequipArtifact: (characterId: CharacterId, artifactInstanceId: ArtifactInstanceId) => { ok: true } | { ok: false; reason: UnequipRejection };
  commissionForgery: (forgerCharacterId: CharacterId, definitionId: string) => { ok: true; forgeryId: ForgeryId } | { ok: false; reason: CommissionRejection };
  thwartTheft: (thiefAttemptId: ThiefAttemptId) => { ok: true; outcome: "Thwarted" | "Stolen" } | { ok: false; reason: ThwartRejection };
  ```
  
  Rejection unions (the modal-state gates per CLAUDE.md "Modal-state rule-layer gate principle"):
  ```ts
  export type EquipRejection =
    | { kind: "ArtifactNotFound"; artifactInstanceId: ArtifactInstanceId }
    | { kind: "NotOwnedByCharacter" }
    | { kind: "CharacterDead" }
    | { kind: "AlreadyEquipped" }
    | { kind: "MaxOnePerFamily"; conflictingInstanceId: ArtifactInstanceId }
    | { kind: "PlayerExiled" }                   // P6 modal-state gate
    | { kind: "ElopementInProgress" };           // P9 modal-state gate
  
  export type UnequipRejection =
    | { kind: "ArtifactNotFound"; artifactInstanceId: ArtifactInstanceId }
    | { kind: "CharacterDead" }
    | { kind: "NotEquipped" }
    | { kind: "PlayerExiled" }
    | { kind: "ElopementInProgress" };
  
  export type CommissionRejection =
    | { kind: "CharacterNotFound" }
    | { kind: "CharacterDead" }
    | { kind: "MissingArchetype"; required: readonly Archetype[] }     // BohemianRake
    | { kind: "UnknownDefinition"; definitionId: string }
    | { kind: "NotForgeable" }
    | { kind: "InsufficientWealth"; have: number; need: number }
    | { kind: "PlayerExiled" }
    | { kind: "ElopementInProgress" };
  
  export type ThwartRejection =
    | { kind: "AttemptNotFound" }
    | { kind: "AttemptAlreadyResolved" }
    | { kind: "MissingSpymaster" }
    | { kind: "InsufficientWealth"; have: number; need: number }
    | { kind: "NoInFlightCourier" }                                     // the "1 in-flight payload slot" cost
    | { kind: "PlayerExiled" }
    | { kind: "ElopementInProgress" };
  ```
  
  **Wrapper body pattern** (template, equipArtifact shown — other three follow the same shape per the P9 wrapper convention):
  ```ts
  equipArtifact: (characterId, artifactInstanceId) => {
    const state = get().state;
    // Modal-state gates first (atomic gating per CLAUDE.md non-negotiable §5):
    if (state.houses.get(PLAYER_HOUSE_ID)?.exiled === true) {
      return { ok: false, reason: { kind: "PlayerExiled" as const } };
    }
    if (state.elopement !== null) {
      return { ok: false, reason: { kind: "ElopementInProgress" as const } };
    }
    // Pure-rule dispatch:
    const result = applyEquipArtifactPure(state, characterId, artifactInstanceId);
    if (!result.ok) return { ok: false, reason: result.reason };
    set((draft) => { overwriteFromGameState(draft, result); });
    // No publisher trio fires — equip is a free action, no domain transitions cross
    // the diff-helper threshold (no character death, no scheme transition, no
    // marriage/whisper/elopement state change). Future ledger-feature can subscribe
    // to a future artifactBus if needed.
    return { ok: true };
  };
  ```
  
  **Publisher trio integration (resolves R6 — `ArtifactEvent` canonical declaration is in the wrapper section above at lines 619-623; do NOT redeclare).** The P10 free actions DO NOT extend the 6/6/6 publisher trio — none of them cross a domain transition the existing diff helpers track (no character death, no scheme transition, no marriage/whisper/elopement state change). **However**, `applyForgerySurfacingPhase` and `applyThiefNoticePhase` run inside tick-advancing wrappers (`advanceTick`, the 4 P3 wrappers, `proposeMarriage` — all 6 of them), so the existing trio (`marriageTransitions + temptationLatchTransitions + characterDeaths + whisperTransitions + schemeTransitions + elopementTransitions`) continues to fire from the same wrappers. **NEW domain bus + publisher for P10**: `artifactBus` (new module `src/runtime/events/artifacts.ts` per CLAUDE.md no-god-files). The `ArtifactEvent` union variants are declared ONCE in the wrapper section above (4 variants: `ForgeryCreated` + `ForgerySurfaced` + `ThiefNoticeFired` + `TheftResolved`); do NOT redeclare a 3-variant subset here.
  
  Published via a new `publishArtifactTransitions(before: GameState, after: GameState)` diff helper that walks `state.forgeries` for `surfaced` flips (emits `ForgerySurfaced`), `state.thiefAttempts` for `null → boolean` transitions (emits `ThiefNoticeFired` on creation diff, `TheftResolved` on `null → boolean` resolution diff). The 4th variant `ForgeryCreated` is direct-published from `commissionForgery` wrapper body (NOT covered by the diff helper — commission is a free action that never runs inside tick-advancing phases). Wired into the 5 tick-advancing wrappers that include scheme-resolution (`advanceTick` + the 4 P3 wrappers `travel`/`requestAudience`/`escapeBankruptcy`/`refreshWardrobe`) + `proposeMarriage` (forgeries can surface during the tick-advance that proposeMarriage triggers) = **6 wrappers**. `runYearPass` deliberately SKIPS `publishArtifactTransitions` (resolves R4 from cycle-3-iter-3 review — year-pass STEPS doesn't include `applyForgerySurfacingPhase` or `applyThiefNoticePhase`, so the diff fires zero events; wiring it would be a no-op overhead inconsistent with the year-pass STEPS contract).
  
  **CLAUDE.md pin edit — full block diff (resolves B3 from cycle-3-iter-3 review).** The existing pin "6/6/6 publisher trio across store wrappers (P7 baseline, P9 add-on, P9-followup truth-up)" describes THREE WRAPPER GROUPS with DIFFERENT publisher membership (per CLAUDE.md `proposeMarriage` has 6 = proposalOutcome direct + marriageTransitions + temptationLatchTransitions + characterDeaths + whisperTransitions + elopementTransitions; the 5 generic tick-advancing wrappers have 6 = characterDeaths + schemeTransitions + whisperTransitions + marriageTransitions + temptationLatchTransitions + elopementTransitions; `runYearPass` has 6 = characterDeaths + whisperTransitions + marriageTransitions + temptationLatchTransitions + childMaturationTransitions + archetypeReclassificationsFromSuccession). A naive `6/6/6 → 7/7/7` substring replace obscures the membership distinction. The P10 edit is more surgical:
  - **`proposeMarriage` group:** 6 → **7** (add `publishArtifactTransitions` — proposeMarriage advances tick, so the artifact phases run).
  - **5 generic tick-advancing wrappers group:** 6 → **7** (add `publishArtifactTransitions`).
  - **`runYearPass` group:** **STAYS AT 6** (no artifact-phase fires during year-pass; wiring would be a no-op). The new count is therefore **7/7/6**, NOT 7/7/7.
  
  Concrete CLAUDE.md edit (under the existing "6/6/6 publisher trio across store wrappers" pin body, REWRITE the heading + the three group bullets):
  ```diff
  - **6/6/6 publisher trio across store wrappers (P7 baseline, P9 add-on, P9-followup truth-up).** All three tick-advancing wrapper groups fire **6 publishers each**, just with different membership:
  + **7/7/6 publisher set across store wrappers (P7 baseline, P9 add-on, P9-followup truth-up, P10 artifact addition).** The three tick-advancing wrapper groups now fire {7, 7, 6} publishers respectively, with different membership per group:
  
  -   - `proposeMarriage` (6): proposalOutcome direct + marriageTransitions + temptationLatchTransitions + characterDeaths + whisperTransitions + elopementTransitions. No schemeTransitions (proposal doesn't invoke scheme resolution).
  +   - `proposeMarriage` (7): proposalOutcome direct + marriageTransitions + temptationLatchTransitions + characterDeaths + whisperTransitions + elopementTransitions + artifactTransitions. No schemeTransitions (proposal doesn't invoke scheme resolution).
  
  -   - `advanceTick` + the 4 P3 wrappers (`travel`/`requestAudience`/`escapeBankruptcy`/`refreshWardrobe`) (6 each): characterDeaths + schemeTransitions + whisperTransitions + marriageTransitions + temptationLatchTransitions + elopementTransitions.
  +   - `advanceTick` + the 4 P3 wrappers (`travel`/`requestAudience`/`escapeBankruptcy`/`refreshWardrobe`) (7 each): characterDeaths + schemeTransitions + whisperTransitions + marriageTransitions + temptationLatchTransitions + elopementTransitions + artifactTransitions.
  
      - `runYearPass` (6): characterDeaths + whisperTransitions + marriageTransitions + temptationLatchTransitions + childMaturationTransitions + archetypeReclassificationsFromSuccession. No schemeTransitions or elopementTransitions — year-pass STEPS doesn't include scheme-resolution, and the Q4 gate blocks runYearPass when `state.elopement !== null`. **runYearPass STAYS AT 6 at P10 — year-pass STEPS includes no artifact phases, so artifactTransitions would emit zero events. Wiring it would be a no-op (resolves R4 from cycle-3-iter-3 review).**
  ```
  Single, surgical CLAUDE.md pin edit; the substring `"6/6/6"` is replaced inline AND the per-group membership updates land in the same edit. No drift.

- **`pruneOrphanedConversationKeys` death-cascade extension (resolves R7).** Two new branches at `src/game/rules/aging.ts:50`:
  - **Branch 6: Forger death.** When a character dies, walk `state.forgeries.values()` for entries with `forgerCharacterId === dead.id`. Forgeries PERSIST past forger death (mirrors the P6 "Weaponized whispers persist past subject death" precedent — "you can't unprint the news," and once forged the artifact is forged regardless of whether the forger is alive). NO mutation. **Branch 6 is documented for symmetry + future-proofing** (a v1.5 "forger death surfaces the forgery" rule would land here) but is currently a no-op walk. The pruner's signature stays the same; the branch comment explains the deliberate no-op.
  - **Branch 7: Equipped-artifact-owner death (resolves B7 from cycle-3 review).** When a character dies, walk their `equippedArtifactIds` — each instance is REMOVED from the dead character's `equippedArtifactIds` (set to `[]` explicitly; the dead character can't be equipped post-death). The instance ITSELF persists in `state.artifactInstances` and its `ownerCharacterId` flips per the **deterministic fallback chain**:
    1. If `state.houses.get(dead.houseId).headOfHouseCharacterId !== dead.id` AND the head is alive (`state.characters.get(headId).alive === true`) → `ownerCharacterId = headId`. Common case.
    2. Else (dead was the head, OR the head is also not-yet-alive somehow) → lex-first living character in the house: `[...state.characters.values()].filter(c => c.houseId === dead.houseId && c.alive && c.id !== dead.id).sort((a, b) => a.id.localeCompare(b.id))[0]?.id`.
    3. Else (NO living family member remains) → `ownerCharacterId` stays at `dead.id`. **Documented stranded-instance state** — Branch 7's stated invariant relaxes to "ownerCharacterId points to a character (alive or, in heirless terminal cases, the original dead owner)." Future P15 dynasty-collapse logic owns the final disposition (artifact-redistribution at house-extinction).
    
    **No artifact instance is ever deleted from `state.artifactInstances` by the orphan-prune** (matches the "never delete; status flips only" invariant — though artifacts have no `dissolved` flag, they have an `ownerCharacterId` that points to either a living character OR to the dead character in heirless terminal cases — see relaxed invariant at line 245).
  - **Branch 8: Active thief attempt with dead target/owner.** When a character dies, walk `state.thiefAttempts.values()` for in-flight entries (`thwarted === null`) where `ownerCharacterId === dead.id`. Flip `thwarted: true` (auto-thwarted by virtue of the owner being dead — there's no one to steal from) with `resolvedAtTick: state.tick`. No artifact removal (the instance is owned by whoever inherits per Branch 7). Matches spec §7 line 649's "auto-thwarted with no cost" semantic generalized to "target permanently unavailable."

- **Modal-state gate matrix (resolves R5).** Every new player-elected wrapper carries BOTH `| { kind: "PlayerExiled" }` AND `| { kind: "ElopementInProgress" }` in its rejection union (per CLAUDE.md "Modal-state rule-layer gate principle"). Verification: 4 new wrappers × 2 modal-state gates = 8 new gate-clause sites. The implementer's audit: `grep -c "PlayerExiled" src/game/store.ts` returns the previous count + 4 (one per new wrapper that returns the rejection); `grep -c "ElopementInProgress" src/game/store.ts` symmetric. The Treason Framing scheme is dispatched via the existing `startScheme` wrapper (already gates both modal states), so no new gate site there.

- **RNG seeding for P10 rolls (resolves R9).** Both `applyForgerySurfacingPhase` and `applyThiefNoticePhase` consume from the EXISTING `state.rng[PLAYER_HOUSE_ID]` stream. Per-tick draw budget:
  - Surfacing: count(unsurfaced forgeries) draws per tick (typically 0-3 in practice).
  - Thief notice: 0 draws when gate (a) or gate (b) fails (most ticks); 1 draw when both gates pass.
  - Thwart action: 1 draw per dispatch (not per tick — bound to the player's free action).
  - Total tick-phase budget: count(unsurfaced) + {0 or 1} draws. Documented inline as a comment block in `applyForgerySurfacingPhase` + `applyThiefNoticePhase` so determinism reasoning is visible at the call site.
  
  **Why the player-house stream and not a new per-forgery stream:** the precedent from P8 (per-rival streams) was justified by EACH rival being an autonomous actor needing isolation from other actors' draw budget. P10 surfacing/theft happen TO the player house, not autonomously — drawing from the player-house stream keeps the budget reasoning consistent with P3 pre-tick actions (which also draw from the player stream). No new RNG streams introduced; no per-entity stream seeding required.

- **Rival participation gate (resolves R7 cross-walk).** Rivals at v1 DO NOT own artifacts. The narrow gate sites:
  - `applyThiefNoticePhase` reads `state.houses.get(PLAYER_HOUSE_ID)` directly — rivals are never the notice target.
  - `applyForgerySurfacingPhase` walks `state.forgeries.values()` — all entries have `forgerCharacterId` in the player house by `applyCommissionForgeryPure`'s gate (only player Bohemian Rakes can forge).
  - `applyEconomyPhase` scandal-risk-while-worn integration walks ONLY `houseId === PLAYER_HOUSE_ID` characters' equipped artifacts.
  - `getEffectiveReputation` / `getEffectiveTraits` work for any houseId/characterId (no gate), but no rival code path calls them at P10.
  - **Bootstrap path does NOT seed any artifact instances for rival houses.** Rival fixtures at `src/game/fixtures/rivals.ts` carry no `equippedArtifactIds` data; the schema default `[]` covers them.
  - Future v1.5 may add rival-owned artifacts (would need a P10-followup phase to extend the rival action roller with equip/unequip choices). The current narrow gate keeps the player-loop clean.

**Schema↔projection↔selector↔overwriteFromGameState quad-sync edit list (mechanical):**

| Surface | File:Line | Edit |
|---|---|---|
| GameStateSchema | `src/game/entities.ts:~480` (after `duels`) | Append `artifactInstances: z.map(...)`, `forgeries: z.map(...)`, `thiefAttempts: z.map(...)`. Append `equippedArtifactIds: z.array(ArtifactInstanceIdSchema).default([])` to `CharacterSchema` at `:~159`. |
| hashableState | `src/game/hash.ts` | Extend projection with three keys; each serializes via `serializeRegistry` (lex-id sort). |
| selectGameState | `src/game/store.ts:1531` | Append three field selectors. |
| overwriteFromGameState | `src/game/store.ts:overwriteFromGameState` | Append three `draft.X = next.X` writes. |
| createInitialState | `src/game/store.ts:152-186` | Insert `const artifactInstances = bootstrapPlayerArtifactsForInit(characters, houses, 0);` BEFORE the return literal, then append three field initializers (`artifactInstances`, `forgeries: new Map()`, `thiefAttempts: new Map()`). |

**MarriageRecord / fixture construction sites — no new edits required at P10.** Unlike P9's `viaElopement` rollout (which required edits at ~5 construction sites + the makeMarriage factory), P10 adds fields that are NEW Maps (no construction sites in existing code) or fields on `Character` with `.default([])` (every existing Character construction site auto-backfills via Zod). The only new construction sites are inside the new artifact rules themselves.

**Bus events — new domain bus.** Per the P9 precedent (elopementBus diverging from whisperBus for per-domain partition), P10 ships `artifactBus` for `ForgerySurfaced` / `ThiefNoticeFired` / `TheftResolved`. Update CLAUDE.md's "Modal-state rule-layer gate principle" pin's "future modal-state Blocked events follow the per-domain pattern" — P10 is the first non-modal new domain bus (per-domain split for non-Blocked events).

**Out of scope.** Procedural artifact generation (§3 Audio/Localization tier in P16); generated artifact backstories (P18); rival-owned artifact loops (v1.5); per-artifact-family wardrobe decay (§10 Q10 v1.5 candidate); Observant-trait-detected forgeries (§10 Q11 v1.5 candidate); NPC-initiated thefts (player-house is the only target at v1).

**Spec refs.** §3 "Wardrobe, Artifacts & Heirlooms", "Forgery & Theft", "Treason Framing", "Wardrobe Decay & Pre-Ball Composure Penalty", "Forgery Surfacing", "Thief Notice & Thwart"; §4 "Artifact Definition", "Forgery Record", "Thief Attempt"; §7 "Forgery surfacing cascade", "Theft against unequipped artifact", "Wardrobe refresh during bankruptcy", "Out-of-season artifact equipped mid-ball"; §10 Q#7, Q#10, Q#11 (resolved at P10).

**Key rules / constants.** Constants block in `src/game/constants.ts` with named values (see "New designer constants" above). No magic numbers anywhere in `src/game/rules/artifacts.ts`. Module-load assertions on the three load-bearing constants documented in the constants section.

**Machines.** Forgery (Unsurfaced → Surfaced — one-way latch, dual entry-point via surfacing roll OR Treason Framing consumption). ThiefAttempt (`thwarted: null → true | false` — one-way latch, dual entry-point via player thwart action OR auto-resolve sweep). ArtifactInstance has no status machine (equip/unequip is a Character-side field, not an Artifact-side status).

**Edge cases (§7) — implementation pins.**
- "Wardrobe refresh during bankruptcy" — resolution lives at `canRefreshWardrobe` in `src/game/rules/wardrobeRefresh.ts` (unchanged from P3); the existing `acceptBankruptcyWarning: true` opt-in input field carries through.
- "Out-of-season artifact equipped mid-ball" — `enterBallroom` snapshot pattern documented above; the snapshot fires AT ENTRY, mid-session equip/unequip doesn't re-trigger the penalty.
- "Theft against an unequipped artifact" — the auto-resolve sweep in `applyThiefNoticePhase` detects unequipped target instances and flips `thwarted: true` (auto-thwarted) instead of `false`. No wealth cost. Spec §7 line 649 verbatim semantics.
- "Forgery surfacing cascade" — the per-iteration multi-Map accumulator pattern documented above guarantees all Vain NPCs get locked + affection-dropped before the function returns. Single-return-statement discipline = transactionality.

**Open questions (§10) — resolved at P10.**
- **#7** — Ship Treason Framing in v1 alongside the artifact registry, or defer until after artifacts are stable? **Resolved: Yes — ships with P10.** Rationale: Treason Framing is the apex outcome of the forgery loop and the only scheme that *requires* an artifact-derived resource (spec §3 "Treason Framing"). Shipping the artifact registry without it leaves the forge-loop economically meaningless (forged artifacts grant rep but never spend out into a rival-damaging move), so deferral would either (a) leak gameplay weight into the next-shipped phase or (b) ship an inert loop in v1. The scheme's cost surface is small (one new `Scheme.kind` literal, one new prerequisite check against `state.forgeries`, one new resolution branch that flips `forgery.surfaced = true`). The Treason Framing branch becomes the 7th scheme kind in the `Scheme.kind` discriminated union; `tryStartScheme` gains three new rejection variants (`MissingTarget`, `MissingUnsurfacedForgery`, `InvalidTreasonFramingTarget`).
- **#10** — Wardrobe seasonal decay: global tick threshold or per-artifact-family (some fashions age faster)? **Resolved: global tick in v1.** Rationale: per-artifact-family decay would require either (a) a per-family `refreshIntervalTicks` field on `ArtifactDefinition` with bespoke fixture-tuning per family OR (b) a designer-constant table keyed by family enum. Both add tuning surface area without changing the player-facing affordance (the wardrobe-refresh action resets ALL equipped artifacts in one wealth spend regardless of family). At v1 the §3 spec asks only for "a fixed refresh-interval since last refresh" — singular, applied uniformly. Per-family decay is a v1.5 candidate (would also pair naturally with v1.5's procedural artifact generation in P16, since procedurally-generated artifacts would need a family default anyway). One global constant `WARDROBE_REFRESH_INTERVAL_TICKS` in `src/game/constants.ts`.
- **#11** — Should forged artifacts be detectable by Observant-trait NPCs at a probability, or stay hidden until the per-tick surfacing roll fires? **Resolved: hidden until surfacing roll.** Rationale: §3 "Forgery Surfacing" describes a single mechanism for forgery-to-discovery propagation (the per-tick `FORGERY_SURFACING_PROBABILITY_BASIS_POINTS` roll). Adding a parallel Observant-trait detection probability would create two surfacing pathways with different cascade semantics (which Vain NPCs get locked? does Observant-detect propagate the same affection delta?), forcing a content split between "surfaced via roll" and "spotted by Observant." Keeping a single mechanism preserves the §3 contract and avoids per-NPC trait scans during every per-tick draw budget. The Observant trait remains valuable elsewhere (P11 inherited-secrets detection, future content hooks). Implication: the `ForgeryRecord.surfaced` flag is a one-way latch flipped by exactly TWO sites (`applyForgerySurfacingPhase` roll-driven AND the Treason Framing scheme-resolution branch consumption-driven — both fire `ForgerySurfaced` bus event, with `viaConsumption: boolean` discriminator).

**Verification.**

Vitest matrix (file paths under `src/game/rules/artifacts.test.ts` + adjacent test files for the wider integration surface):

1. **Surfacing roll determinism.** Run a 30-campaign replay seeded identically; assert `hashableState(state)` identical at every tick. Per CLAUDE.md replay-harness contract.
2. **Surfacing cascade transactionality.** Seed state with: (a) one unsurfaced forgery, (b) three Vain-trait NPCs in three different rival houses, (c) FORGERY_SURFACING_PROBABILITY_BASIS_POINTS bumped to 10000 (force surface). Invoke `applyForgerySurfacingPhase`. Assert: (1) `state.forgeries.get(id).surfaced === true`, (2) all three NPCs have `mood === "Defensive"` AND `moodLockUntilTick >= state.tick + 15`, (3) all three affection-map keys clamped down by 10 (or to 0).
3. **Pre-ball snapshot semantics.** Seed state with player head equipped to two artifacts whose `lastRefreshTick = state.tick - 50` (out-of-season per `WARDROBE_REFRESH_INTERVAL_TICKS = 40`). Fire `enterBallroom`. Assert head's composure dropped by `2 * 5 = 10`. Then equip a third out-of-season artifact mid-session. Assert composure UNCHANGED (snapshot already ran).
4. **Treason Framing consumes the forgery exactly once.** Seed state with one unsurfaced forgery + Bohemian Rake + player wealth >= cost + rival house with a living head. Fire `startScheme({ kind: "TreasonFraming", targetCharacterId: rivalHeadCharacterId })` (NOT `targetHouseId` — Treason Framing reuses the existing `Scheme.targetCharacterId` field per the body resolution; the rival house is derived as `state.characters.get(targetCharacterId).houseId`). Run `applySchemeResolutionPhase` until completion. Assert: (a) scheme status === "Completed", (b) rival house reputation dropped by `TREASON_FRAMING_RIVAL_REPUTATION_DELTA`, (c) rival house hostility raised by `TREASON_FRAMING_RIVAL_HOSTILITY_DELTA`, (d) the consumed forgery's `surfaced === true`, (e) NO Vain-NPC cascade fired (because consumption-surfacing skips the cascade), (f) `publishArtifactTransitions` published `{ kind: "ForgerySurfaced", viaConsumption: true, ... }` on `artifactBus`.
5. **Theft against unequipped artifact (§7 edge case).** Seed state with one in-flight `ThiefAttempt` whose targeted instance is owned by player but NOT in any character's `equippedArtifactIds`. Fire `advanceTick` to trigger the auto-resolve sweep. Assert `thwarted === true` (auto-thwarted), wealth UNCHANGED.
6. **Thwart success-roll bypasses wealth on roll-fail.** Seed state with one in-flight `ThiefAttempt` + Spymaster + wealth + one InFlight courier + `THWART_SUCCESS_PROBABILITY_BASIS_POINTS = 0` (force fail). Fire `thwartTheft(id)`. Assert: wealth deducted, courier intercepted, `thwarted === false`, artifact removed.
7. **Equip invariant: max one per family.** Seed state with player head equipping a `sapphires` instance. Mint a second `sapphires` instance owned by the same character. Fire `equipArtifact(charId, secondInstId)`. Assert rejection `{ kind: "MaxOnePerFamily" }`.
8. **Persona snapshot includes effective traits.** Seed state with a character carrying `["trait-clever"]` traits + equipping an artifact that grants `["trait-wealthy"]`. Build a conversation request via `buildConversationRequest(...)`. Assert `request.characterStateSnapshot.target.traits` includes BOTH traits.
9. **Persona cache invalidation on equip.** Bump `PERSONA_CACHE_VERSION` from "v3" → "v4"; verify cached personas keyed under "v3" miss; verify a fresh request creates a new "v4"-keyed cache entry. (Server-side test; equivalent verification at `server/personaCache.test.ts`.)
10. **Migration v10 → v11 is byte-identity on rng + chain-step outputSchema validation (resolves cycle-4-iter-3 B1).** Run `migrate_v10_to_v11(saveV10)` against a saved fixture with non-trivial RNG state. Assert `result.rng === save.rng` (no consumed draws). Run the chain test `v1-to-v11-chain.test.ts` and assert hash parity vs `createInitialState(seed)`. **PER-STEP outputSchema validation**: the chain test walks `MIGRATIONS` registry entries and for each `step`, asserts `step.outputSchema.parse(step.migrate(prev))` succeeds BEFORE composing the next step. Without this, a mid-chain emitter could silently produce a shape that doesn't match its declared `outputSchema` — the final-state hash would still equate (parity) but a single step's schema drift would go undetected. Concrete shape:
    ```ts
    // src/persist/migrations/v1-to-v11-chain.test.ts (NEW at P10):
    let current: unknown = saveV1Fixture;
    for (const step of MIGRATIONS) {
      // Apply the migration step:
      const next = step.migrate(current);
      // PER-STEP outputSchema gate — catches mid-chain strip-cascade drift
      // that the final-state hash parity assertion would miss.
      expect(() => step.outputSchema.parse(next)).not.toThrow();
      current = next;
    }
    // Final-state hash parity (existing):
    expect(hashState(lift(current as SaveV11))).toBe(hashState(createInitialState(seed)));
    ```
11. **Idempotence assertion.** `expect(migrate_v10_to_v11(saveV10)).toEqual(migrate_v10_to_v11(saveV10))` via `assertMigrationIdempotent`.
12. **PHASES length post-P10 = 12 with rivals terminal.** Assert `applyRivalActionPhase` is the terminal phase function (test-side function-reference identity, not numeric index — matches the P9 enforcement pattern).
13. **Quad-sync test trip-wire.** `src/game/schema-projection-selector-extension.test.ts` is expected to pass automatically once all 5 surfaces extend. Assert `Object.keys(GameStateSchema.shape)` ⊇ `["artifactInstances", "forgeries", "thiefAttempts"]` AND `Object.keys(hashableStateProjection({}))` ⊇ same.
14. **Modal-state gate matrix.** For each of the 4 new wrappers (equipArtifact, unequipArtifact, commissionForgery, thwartTheft), seed state with `playerHouse.exiled === true` and assert `PlayerExiled` rejection. Symmetric seed with `state.elopement !== null` → `ElopementInProgress` rejection. 8 test blocks total.
15. **Branch 7 orphan-prune.** Seed state with a non-head character holding one equipped artifact instance. Kill the character (set `alive = false` via `applyAgingStep` or direct test mutation). Run `pruneOrphanedConversationKeys`. Assert: artifact instance persists in `state.artifactInstances`, but `instance.ownerCharacterId` flips to the house head; the dead character's `equippedArtifactIds` is empty.
16. **Replay determinism — full P10 surface.** Run a 30-iteration seeded replay involving: 5 equip/unequip cycles, 1 forgery commission, ~50 ticks of surfacing rolls, 1 thief notice + thwart, 1 Treason Framing scheme. Assert final state hash identical across all 30 iterations.

**Close out.** When the gates and verification items above are green, run `/close-phase P10` to update phase status in `plans/MASTER.md` §6, append to `plans/SESSION-NOTES.md`, resolve any open questions answered during the work, apply any `CLAUDE.md` additions, and commit the changes (no push).

## Accumulated Risks & Suggestions

*Passively collected from review cycles. Not blockers. Triaged at convergence.*

### Post-Convergence Advisory Triage (cycle 6)

Four items folded into the body during post-convergence triage:
- `FORGERY_SURFACING_PROBABILITY_BASIS_POINTS > 0` module-load assertion `[applied]` (resolves recurring C5-S4 / C10-S6 / C12-R9 / C13-R7 / C14-S3 / C15-S8 / C16-R7).
- `PLAYER_STARTING_ARTIFACTS.lastRefreshTickAtBootstrap` renamed to `lastRefreshTick` `[applied]` (resolves C13-R11 / C15-R8 / C16-R8).
- `selectGameState` line cite refreshed from `:~1569` to `:1531` `[applied]` (resolves C12-R8 / C15-R11 / C16-R11).
- `bootstrapPlayerArtifactsForMigration` `seed` param dropped `[applied]` (resolves C13-R7 / C15-R10 / C16-R10).

Eleven items remain advisory at convergence — none block implementation. Categorized:

**Note for implementer (implementation-time judgment, no plan change needed):**
- R1 (wardrobe-refresh two-Map clone snippet): mechanical extension of existing single-Map pattern; implementer derives from P6 multi-Map accumulator.
- R2 (PHASES length=12 module-load assertion): consider adding alongside the existing terminal-rivals test-side check; CLAUDE.md "frozen PHASES" non-negotiable interacts.
- R3 (`applyThwartTheftPure` "always deduct" wording): cosmetic prose nit; behavior is correct per the validation gates.
- R4 (Vitest scenario for already-locked Vain NPC extend-not-shorten): add the test fixture during implementation.
- R5 (`selectTargetedArtifactInstance` body snippet): selector logic unambiguous from prose; implementer writes the 8-line body directly.
- R6 (`applyEconomyPhase` inline comment at additive write): one-line comment add during implementation.
- R9 (equip-order hash-relevance reconciliation): equip array order IS hash-relevant via Character serialization preserving array order; lex-sort only applies to Map iteration, not to array fields. Implementer-time clarification.
- R12 (per-iteration `acc` spread O(n²) profile): acceptable at typical n=3-5 unsurfaced forgeries; document inline OR accept the trade-off.
- R13 (V10 Bare/wrap extraction split-and-add ordering): two-commit PR preferred but single-commit acceptable.
- R14 (`makeArtifactInstanceId` walker scope): per-definitionId counter is the canonical interpretation per the `artifact-sapphires-0` example; pin in the factory's JSDoc when implementing.
- R15 (`tryStartScheme` Treason Framing rejection slot for `MissingUnsurfacedForgery`): slot (a) precondition placement is fine — the O(state.forgeries) walk is typically O(0-5) at v1, smaller than the wealth check's allocation cost.

### Item ledger (historical record from cycles 1-14)

### Triage Status (resolves cycle-3-iter-2 B5)

Items below are tagged in-place. Where multiple cycles surfaced the same concern (carry-overs), all matching entries share the same status. Tags:

- `[folded]` — the concern has been addressed by an edit to the plan body in some cycle; the body should now contain the pin/clarification/fix the item asked for.
- `[deferred to <phase>]` — the concern is real but its resolution belongs to a later phase (typically P14 ledger, P15 dynasty-collapse, or v1.5).
- `[still-open]` — the concern is acknowledged but the plan deliberately punts to implementation-time judgment; the implementer should flag and ask if blocked.

The `[likely addressed]` annotations originally placed on C1 items have been re-evaluated in this triage: any C1 item that has a verified body fix becomes `[folded]`; any C1 item whose verification cannot be confirmed becomes `[still-open]`.

**Bulk triage summary** (cycle-3-iter-2):
- C1 R1-R9, S1-S5: ALL `[folded]` — the body rewrite at cycle 1 iter 1 + cycle 1 iter 2 trait-id fix addresses every C1 item by construction.
- C2 R10-R12, R15, R19, R20, S6-S11: `[folded]` (R10/R11/R12: persona snapshot edit; R15: Branch 7 via B7; R19: ?? 0 fix; R20: makePairKey rename; S11: verification matrix item #15 covers tick-phase assassination orphan-prune).
- C2 R13, R17, R18: `[deferred to P14]` (R13 silent-by-design pinned in body but full ledger surfacing belongs to P14; R17 player-facing surface awareness; R18 helper signature deferred to implementation-time).
- C2 R14, R16: `[folded]` (auto-resolve LOAD-BEARING comment + MissingTarget consumer audit).
- C3 R11, R13, R14, R15, R18, R19, R20, R21, S12, S13: `[folded]` (all addressed in cycle 1 + cycle 2 iter 4 + cycle 3 iter 2).
- C4 R22, R23, R24, S14-S17: `[folded]` (R22 + S16 via B1 migration symmetric seed; R23 cascade `newChars.get` reads pre-cascade value documented inline; R24 single-clamp pinned; S14-S17 carry-overs all folded).
- C5 R5, R9, R10, R11, R13, S1-S6: `[folded]` (R5 confirmed no rivals.ts touch; R9 import edit added to verification gate below; R10 confirmed no AudienceRejection extension; R11 lastRefreshTick: 0 pinned in PLAYER_STARTING_ARTIFACTS revision below; R13 confirmed dual-fire NOT needed for free-action wrappers; S1-S6 carry-overs).
- C6 R14, R15, R16, R17, R18, R19, R20, R21, S3: `[folded]` (R14 4-predicate filter; R15 deterministic fallback via B7; R16 lastRefreshTick: 0; R17 import edit; R18 ordering via B1; R19 locked-Vain reconciliation; R20 LOAD-BEARING comment; R21 substring pin edit; S3 player-facing surface deferred to P14).
- C7 R7, R8, S5, S7: `[folded]` (R7 equip-invariant reconciled; R8 selector signature `getEffectiveReputation` precedent; S5 verification scenario #15; S7 family-uniqueness assertion via B4).
- C8 R26-R32, S29: `[folded]` (R26 Branch 7 prose reconciled; R27 bootstrap ordering via B1; R28 lastRefreshTick: 0 pinned; R29 import edit; R30 [] reset pinned; R31 this triage; R32 invariant pinned; S29 outputSchema validation in chain test).

**Net result of triage:** all 35+ items are `[folded]` or `[deferred to P14]`. ZERO items remain `[still-open]` after cycle 3 iter 2. The body changes from cycle 1 through cycle 3 iter 2 have addressed every carried concern.

**Two new explicit pins added to body in this triage pass** (to ensure folded items stay folded):
1. `PLAYER_STARTING_ARTIFACTS` block (line ~196): each starting-artifact-record's `lastRefreshTick: 0` is pinned in the bootstrap pseudocode.
2. PHASES growth edit at `src/runtime/tickOrchestrator.ts` (line ~270): the explicit `import { applyForgerySurfacingPhase, applyThiefNoticePhase } from "../game/rules/artifacts";` insertion is enumerated as part of the PHASES literal edit.

### Item ledger (historical record)


- [C1] R1. Equip-time trait grants must be a projection at read sites, not a mutation into character.traits, to avoid cross-cutting downstream consumer breakage. [likely addressed]
- [C1] R2. Pre-ball composure penalty needs explicit storage shape + entry point (enterBallroom wrapper). [likely addressed]
- [C1] R3. Forgery surfacing cascade transactionality must follow the per-iteration multi-Map accumulator pattern. [likely addressed]
- [C1] R4. Thwart cost "1 in-flight payload slot" semantics — pin to spymasterIntercept's intercept-oldest-InFlight pattern. [likely addressed]
- [C1] R5. PlayerExiled + ElopementInProgress modal-state gates must extend to every new player-elected wrapper. [likely addressed]
- [C1] R6. Publisher trio must extend to artifact / forgery / theft events; per CLAUDE.md no-god-files, the per-domain bus pattern applies. [likely addressed]
- [C1] R7. pruneOrphanedConversationKeys death-cascade extension for forger death + equipped-character death + in-flight thief target death. [likely addressed]
- [C1] R8. New PHASES slots for surfacing roll + thief notice — must precede rivals-terminal slot. [likely addressed]
- [C1] R9. RNG seeding for per-tick artifact rolls — must consume from existing player-house stream, not introduce new per-forgery streams. [likely addressed]
- [C1] S1. Author the full plan iteration following the P5/P7/P9 template. [likely addressed]
- [C1] S2. Pin ARTIFACT_FAMILIES, ArtifactDefinition shape, ArtifactInstance / ForgeryRecord / ThiefAttempt schemas with full Zod. [likely addressed]
- [C1] S3. Enumerate ArtifactInstanceId / ForgeryId / ThiefAttemptId branded strings under rng.ts. [likely addressed]
- [C1] S4. Add edit-list for store.ts wrappers (equip / unequip / commissionForgery / thwartTheft). [likely addressed]
- [C1] S5. Hyde Park / mount-family artifact reference — clarify whether mount-family ships at P10. [likely addressed]
- [C2] R10. Wrong edit site for persona snapshot — `src/llm/buildRequest.ts` does not exist; the actual construction site is inline at `src/game/store.ts:760-772` inside `sendBallroomMessage`.
- [C2] R11. Snapshot mutation risk — the snapshot's `target` field at `store.ts:767` is the live character object; must shallow-clone before writing the effective traits projection (`target: { ...target, traits: getEffectiveTraits(state, target.id) }`).
- [C2] R12. Persona cache invalidation completeness — bump `PERSONA_CACHE_VERSION` from `"v3"` to `"v4"` is necessary AND sufficient because the cache key in `server/personaCache.ts` is `(CharacterId|Model|version)`.
- [C2] R13. Silent scandal trickle via equipped artifacts — `applyEconomyPhase` scandal-risk-while-worn mutation has no bus event or diff publisher; either surface as `ArtifactScandalTrickle` on artifactBus or document as designed silence.
- [C2] R14. One-tick auto-resolve window depends on phase ordering — `applyThiefNoticePhase` (slot 11) runs after `advanceTickPhase` (slot 1), so `noticedAtTick = state.tick` is the POST-increment value; auto-resolve sweep filters `noticedAtTick < state.tick` correctly only on subsequent ticks.
- [C2] R15. Branch 7 orphan-prune ordering with assassination-time deaths — `resolveAssassination` calls the pruner WITHOUT succession having run first; pin deterministic fallback: `house.headOfHouseCharacterId` if alive, else lex-first living member.
- [C2] R16. `MissingTarget` rejection added to `StartSchemeRejection` — strict TS catches missing branch coverage in `tryStartScheme`, but document the audit explicitly.
- [C2] R17. Read-site inconsistency for equipped reputation — `getEffectiveReputation` consumed only by `applyThiefNoticePhase` + future P14 ledger; equipping a +10 tiara affects (a) thief notice gate, but NOT (b) patroness erosion, (c) rival behavior, (d) NPC conversation perception. Document the player-facing surface.
- [C2] R18. `bootstrapPlayerArtifacts(seed)` signature — `createInitialState` signature does not pass a `seed` directly; deterministic IDs from `makeArtifactInstanceId` are state-walk-counted, so a `seed` may not be needed. Verify the helper's actual input shape.
- [C2] R19. `affectionMap` default value in surfacing-cascade pseudocode reads `?? 50`; the live convention at `src/game/store.ts:888` + `src/game/rules/proposal.ts:158` is `?? 0`. Fix to `?? 0` to match the project convention.
- [C2] S6. Trait id fix — applied in iter 2 (B6).
- [C2] S7. Replace `src/llm/buildRequest.ts` reference with `src/game/store.ts:760-772` (sendBallroomMessage snapshot literal).
- [C2] S8. Pin the shallow-clone shape for the snapshot mutation explicitly.
- [C2] S9. Add explicit "silent by design" note OR new `ArtifactScandalTrickle` event for the `applyEconomyPhase` scandal contribution.
- [C2] S10. Pin Branch 7 fallback rules deterministically.
- [C2] S11. Add a Vitest scenario covering tick-phase assassination of a non-head equipped artifact holder.
- [C3] R11. Snapshot.target mutation discipline missing — folded into body in iter 3 (shallow-clone shape pinned alongside B8 fix). [likely addressed]
- [C3] R13. applyEconomyPhase scandal-trickle silent-vs-eventful — still open; decide whether to surface `ArtifactScandalTrickle` on artifactBus or document as designed silence.
- [C3] R14. One-tick auto-resolve window ordering — needs inline code comment at `applyThiefNoticePhase` to prevent future-phase reordering from breaking the window.
- [C3] R15. Branch 7 orphan-prune fallback when head IS the dead character — pin deterministic fallback `house.headOfHouseCharacterId if alive, else lex-first living member`.
- [C3] R18. `bootstrapPlayerArtifacts(seed)` signature — `createInitialState(seed: string, campaignName?: string)` is the actual signature; the helper consumes `seed: string` and walks lex-sorted artifact ids deterministically (no separate RNG state needed because instance ids derive from `definitionId` + the existing state walk).
- [C3] R19. `affectionMap` default `?? 50` in cascade pseudocode — should be `?? 0` per live convention at `src/game/store.ts:888` + `src/game/rules/proposal.ts:158`.
- [C3] R20. `makePairKey` name wrong — the actual helper is `makePairKey` exported from `src/game/conversation/types.ts:26`.
- [C3] R21. Thwart "1 in-flight payload slot" filter — pin whether thwart applies the same 4-predicate filter as `trySpymasterMailIntercept` (InFlight + Inbound + interceptable + destinationHouseId === PLAYER_HOUSE_ID) or only the InFlight predicate.
- [C3] S12. Fix `makePairKey` name + `?? 0` default in cascade pseudocode (advisory — both surfaced as R19, R20).
- [C3] S13. Triage tags for C2 tail items (folded/deferred/still-open) per cross-plan convergence pattern; the `[likely addressed]` annotations on C1 may be unreliable.
- [C4] R22. `bootstrapPlayerArtifacts(seed)` must seed BOTH `state.artifactInstances` AND `state.characters[playerHead].equippedArtifactIds`; pick between (a) post-hoc mutation of the already-built characters Map by `bootstrapPlayerArtifacts` or (b) threading starting-artifact ids into `seedStartingFamily`.
- [C4] R23. Cascade pseudocode `newChars.get(ch.id)` read returns the pre-cascade value on first hit (because `newChars` is cloned from `state.characters`); trace is correct but subtle, flag inline comment.
- [C4] R24. `applyEconomyPhase` scandal-risk-while-worn integration introduces a new per-tick mutation site for `house.scandal`; order of scandal-source application within `applyEconomyPhase` needs pinning (additive composition vs separate clamp steps).
- [C4] S14. Apply C3 advisory fixes inline (R19 `?? 0`, R20 `makePairKey`, R15 Branch 7 deterministic fallback).
- [C4] S15. Pin thwart courier filter explicitly: reuse the 4-predicate filter from `trySpymasterMailIntercept` (InFlight + Inbound + interceptable + destinationHouseId === PLAYER_HOUSE_ID) OR document the divergence.
- [C4] S16. Pin bootstrap order: `seedStartingFamily` → builds characters with `equippedArtifactIds: []` → `bootstrapPlayerArtifacts(seed)` post-hoc mutates the characters Map AND seeds artifactInstances; OR thread starting-artifact ids through `seedStartingFamily`.
- [C4] S17. Confirm "designed silence" for `applyEconomyPhase` scandal trickle OR add `ArtifactScandalTrickle` event to `artifactBus`. [folded — "silent by design at v1" pinned in body]
- [C5] R5. `RIVAL_CHARACTER_IDS_SET.size !== 9` module-load assertion at rivals.ts — confirm rivals.ts is untouched at P10 (no rival-artifact crossover).
- [C5] R9. PHASES literal import edits to `src/runtime/tickOrchestrator.ts` — pin `import { applyForgerySurfacingPhase, applyThiefNoticePhase } from "../game/rules/artifacts";` as part of the PHASES growth edit.
- [C5] R10. `requestAudience` uses `{outcome: AudienceOutcome}` not `{ok}`; confirm `AudienceRejection` does NOT need extension at P10 (P10 new wrappers are independent free actions, not audience-style outcomes).
- [C5] R11. `lastRefreshTick` initial value for bootstrap-seeded artifacts — explicit pin needed (`lastRefreshTick: 0` at tick=0 means starting artifacts are "in-season" at bootstrap; first OOS-penalty fire at tick=`WARDROBE_REFRESH_INTERVAL_TICKS + 1`).
- [C5] R13. ElopementBlocked publish semantics — three of four P10 wrappers return `{ok}`; confirm `commissionForgery` etc. DO NOT publish `ElopementBlocked` (only void-returning advanceTick/runYearPass/proposeMarriage publish per CLAUDE.md pin).
- [C5] S1. Post-P10 PHASES literal as a complete diff block — verify comments inside the array reflect post-P10 final shape.
- [C5] S2. Edit-list line citing `src/game/rules/schemes.ts:340-365` for the per-kind switch extension at `applySchemeResolutionPhase`.
- [C5] S3. Verification matrix #4 snippet uses `targetHouseId: rivalId` — fix to `targetCharacterId: rivalHeadCharacterId` to match the in-body resolution.
- [C5] S4. Add `FORGERY_SURFACING_PROBABILITY_BASIS_POINTS > 0` module-load assertion (else surface impossible, infinite-loop bug bait).
- [C5] S5. Triage tags ([folded]/[deferred]/[still-open]) on C2/C3/C4 tail items per cross-plan convergence pattern.
- [C5] S6. Cascade snippet's `playerHead = state.houses.get(PLAYER_HOUSE_ID).headOfHouseCharacterId` — pin defensive read OR document invariant (player head always alive during cascade).
- [C6] R14. Thwart courier filter — pin whether to reuse the full 4-predicate filter from `trySpymasterMailIntercept` (InFlight + Inbound + interceptable + destinationHouseId === PLAYER_HOUSE_ID) or only InFlight; carry-over from C3-R21 / C4-S15.
- [C6] R15. Branch 7 orphan-prune deterministic fallback — pin `head if alive, else lex-first living family member` (carry-over from C2-R15 / C3-R15 / C4-S14).
- [C6] R16. `lastRefreshTick` initial value at bootstrap — explicit pin `lastRefreshTick: 0` at tick=0.
- [C6] R17. PHASES module-private array import lines — enumerate the literal `import { applyForgerySurfacingPhase, applyThiefNoticePhase } from "../game/rules/artifacts";` edit at `src/runtime/tickOrchestrator.ts:1-15`.
- [C6] R18. `bootstrapPlayerArtifacts` ordering vs `seedStartingFamily` — pick (a) post-hoc mutation of characters Map vs (b) thread starting-artifact ids through `seedStartingFamily` (carry-over from C4-R22 / C4-S16).
- [C6] R19. Forgery surfacing cascade — clarify whether locked Vain NPCs participate in the cascade (the snippet does `Math.max(currentLockUntil, ...)` unconditionally; prose says "locked skip both" — inconsistency).
- [C6] R20. Cascade `newChars.get(ch.id)` — add inline comment "LOAD-BEARING: read from newChars for accumulator coherence" to forestall next-reviewer misread.
- [C6] R21. CLAUDE.md "6/6/6 publisher trio" pin update — enumerate the literal edit in `CLAUDE.md` (currently the pin reads 6/6/6; needs 7/7/7 post-P10 line update).
- [C6] S3. Promote C2-R17 player-facing-surface note into body: equipped rep affects (a) thief notice gate, but NOT (b) patroness erosion, (c) rival behavior, (d) NPC conversation perception.
- [C7] R7. Equip-time invariant vs Branch 7 ownership transfer — pin: inheritance flips `ownerCharacterId` but does NOT auto-equip on new owner.
- [C7] R8. `effectiveScandalContributionFromArtifacts` selector signature — pin in P10 with explicit signature OR defer to P14 with explicit TODO.
- [C7] S5. Vitest scenario covering a Vain NPC who is already mood-locked from an earlier event when a forgery surfaces — verifies the cascade extend-not-shorten behavior.
- [C7] S7. Module-load assertion that no two `ARTIFACT_REGISTRY` entries share the same `family` — the "max one per family" equip invariant only enforces if families are unique across the registry.
- [C8] R26. Branch 7 invariant tension — line 245 invariant says "ownerCharacterId always points to a living character once cascade settles" but heirless-house punt leaves `dead.id`; weaken the invariant prose OR mandate Branch 7 always assigns to lex-first living family member.
- [C8] R27. `bootstrapPlayerArtifacts` ordering carries forward unresolved across 5+ cycles; needs explicit pick (post-hoc mutation vs threading through `seedStartingFamily` vs tuple-return).
- [C8] R28. `lastRefreshTick: 0` bootstrap pin missing from PLAYER_STARTING_ARTIFACTS or bootstrap pseudocode.
- [C8] R29. PHASES literal import edits at `tickOrchestrator.ts:25-27` not enumerated.
- [C8] R30. Dead character's `equippedArtifactIds` after Branch 7 transfer — pin explicit `[]` value.
- [C8] R31. C1-C8 tail (35+ items) untagged; need [folded]/[deferred]/[still-open] tagging.
- [C8] R32. Cascade `playerHead` read at line 410 trusts head exists alive; document invariant inline.
- [C8] S29. Migration step output-schema validation — `outputSchema.parse(step.migrate(prev))` should be in the migration chain test.
- [C9] R1. `applyWardrobeRefresh` extension — pin the post-edit snippet showing the two-Map clone-and-set (houses + artifactInstances). [still-open]
- [C9] R2. `applyEconomyPhase` artifact-scandal inner-loop structural choice — pin compute-once vs per-iteration. [still-open]
- [C9] R3. `applyForgerySurfacingPhase` mixes pre-cascade iteration (`state.characters.values()`) with accumulator reads (`newChars` / `newAffection`) — pin inline comment for next reviewer.
- [C9] R4. `ProxyConversationRequestSchema` does not currently carry `equippedArtifactIds` on the snapshot — verify server-side Zod parse default-strips OR pin schema extension. [deferred to P14 if server doesn't read it]
- [C9] R5. `PERSONA_CACHE_VERSION` bump propagation — verify server reads constant via the sanctioned cross-tree edge (not a frozen local copy).
- [C9] R6. SCHEME_KINDS proximity comment update — pin the full multi-line replacement text. [folded — line 19 update is enumerated]
- [C9] R7. Branch 7 fallback heirless-terminal — pin "stranded = orphaned-from-reputation-bonus" framing (because `getEffectiveReputation` filters `ch.alive`).
- [C9] R8. Verification matrix item 4 — TreasonFraming's selectAggressor skips the head; verification fixture needs a non-head Bohemian Rake family member. [still-open]
- [C9] R9. Rival fixtures don't carry `equippedArtifactIds` — strip-cascade doesn't currently cover this. P10 emit fine; risk downstream if v1.5 adds rival artifacts. [deferred to v1.5]
- [C9] R10. Auto-resolve sweep depends on `advanceTickPhase` being slot 1 — add test-side assertion mirroring "rivals last" pattern.
- [C9] S5. Vitest scenario "two unsurfaced forgeries surface in one tick" — exercises per-iteration accumulator across multiple surfacings.
- [C9] S6. Migration-step outputSchema validation in chain test (carry-over from C8-S29).
- [C9] S7. Vitest that `equippedArtifactIds` survives a V11 live save/load round-trip — defends against the defense-in-depth strip helper accidentally applying to V11 emit.
- [C10] R1. `fromSaveV10` body refactor — verify no v9-to-v10 migration call site depends on the pre-P10 legacy form (live currently no direct dep, but pre-flight check before shipping).
- [C10] R2. `applyWardrobeRefresh` two-Map clone snippet — pin inline (currently described in prose only).
- [C10] R4. `target.equippedArtifactIds` defensive shallow-copy at persona snapshot is currently dead-code at P10 (persona prompt doesn't read it). Either pin the future-phase read OR drop the defensive copy.
- [C10] R5. Triage summary at body line 968 is stale relative to C9 additions — update or fold C9 items in.
- [C10] R6. Cascade `currentCh = newChars.get(ch.id)!` non-null assertion — defensive comment or fallback.
- [C10] R7. Verification #2 doesn't test the "already-locked Vain NPC gets lock EXTENDED, not shortened" semantic.
- [C10] S1. Pin `applyWardrobeRefresh` two-Map clone snippet inline.
- [C10] S2. Pin artifact-scandal compute-ONCE-outside-loop (inside the `if (houseId === PLAYER_HOUSE_ID)` branch).
- [C10] S3. Verification #4 fixture pins a non-head Bohemian Rake family member.
- [C10] S4. Vitest "applyThiefNoticePhase auto-resolve depends on advanceTickPhase being slot 1" (mirror "rivals last" assertion pattern).
- [C10] S5. Update triage summary to acknowledge C9 items.
- [C10] S6. Add module-load assertion `FORGERY_SURFACING_PROBABILITY_BASIS_POINTS > 0`.
- [C10] S8. Vitest "two unsurfaced forgeries surface in one tick" — per-iteration accumulator coverage.
- [C11] R1. Wardrobe-refresh tick-cost — `refreshWardrobe` IS tick-advancing (P3 wrapper); P10 inherits the cost without re-pinning. Carry-over from C10-R1 — `applyWardrobeRefresh` extension still needs concrete two-Map snippet.
- [C11] R2. PHASES module-load length assertion not pinned (post-P10 = 12); only test-side `phaseOrderTracker` enforces.
- [C11] R3. `target.equippedArtifactIds` shallow-clone is dead code at P10 (ProxyConversationRequestSchema doesn't carry the field server-side); pin future-phase reader or drop.
- [C11] R4. `applyEconomyPhase` inner-walk cosmetics — compute-once-inside-PLAYER-branch comment not pinned at the additive write.
- [C11] R5. `applyThwartTheftPure` snippet line 497 says wealth deducted "regardless of roll outcome" — inconsistent with `NoInFlightCourier`-first ordering at step 4 (rejection BEFORE deduction). Reword "always" framing.
- [C11] R6. Verification #2 doesn't exercise the "already-locked Vain NPC gets EXTENDED" semantic.
- [C11] R7. `selectTargetedArtifactInstance` only in prose; pin body snippet alongside surfacing-cascade snippet for symmetry.
- [C11] S1. Pin literal CLAUDE.md edit diff for "7/7/6 publisher trio" update (suggestion only — body already ships a multi-bullet diff block; verify it's verbatim-paste-ready).
- [C11] S2. Per-step `outputSchema.parse(step.migrate(prev))` assertion in chain test.
- [C11] S3. Inline-comment at `applyEconomyPhase` scandal additive: `// silent-by-design at v1: P14 ledger selector surfaces`.
- [C11] S4. Pin `selectTargetedArtifactInstance` body snippet.
- [C11] S5. Document the "module-private extractPlayerSeed duplicate per migration" pattern (N=2 now).
- [C12] R3. Persona snapshot `equippedArtifactIds` defensive shallow-clone — wire schema DOES carry the field via `CharacterStateSnapshotSchema.target = CharacterSchema` (`src/llm/types.ts:80`); the clone is defending future-phase reads, not dead code. Reframe rationale.
- [C12] R8. Line-cite drift — `selectGameState` at `:1531` (not `:~1569` as plan says); other anchor drift may exist.
- [C12] R9. `FORGERY_SURFACING_PROBABILITY_BASIS_POINTS > 0` module-load assertion still missing.
- [C12] R10. Snippet iterates `state.characters.values()` (pre-cascade) while reading `newChars.get(ch.id)` (accumulator) — coherent but subtle; inline comment should explain WHY iteration source diverges from read source.
- [C12] S6. Pin ONE canonical signature for `bootstrapPlayerArtifacts*` and ONE shape for `extractPlayerSeed` (now done in cycle-4-iter-2 fixes; verify all references updated).
- [C12] S7. Vitest: assert `equippedArtifactIds` survives a V11 live save/load round-trip.
- [C12] S8. Vitest: "two unsurfaced forgeries both surface in one tick" — exercises per-iteration multi-surface accumulator (R10).
- [C13] R1. `applyWardrobeRefresh` two-Map clone still prose-only (carry C9-R1 / C10-R2 / C11-R1).
- [C13] R2. `selectTargetedArtifactInstance` body still prose-only.
- [C13] R3. `applyThwartTheftPure` "always deduct" wording is misleading — courier-presence gate rejects pre-deduction; reword.
- [C13] R4. PHASES module-load length assertion at 12 not pinned.
- [C13] R5. Verification #2 doesn't exercise "already-locked Vain NPC gets EXTENDED" semantic.
- [C13] R6. "Equip-order hash-relevant" claim conflicts with lex-sort in selector — reconcile.
- [C13] R7. `bootstrapPlayerArtifactsForMigration` carries unused `seed` param — drop or pin v1.5 use case.
- [C13] R8. Per-iteration accumulator across multi-forgery surfacing — pin verification scenario + inline comment confirming iteration-source vs accumulator-read split.
- [C14] R3. `applyForgerySurfacingPhase` per-iteration `acc = { ...acc, rng: ... }` spread is O(n²) on state-spread allocation across many unsurfaced forgeries — document the trade-off OR refactor.
- [C14] R6. V10 bare/wrap refactor ordering — pin step list: (1) extract V10 Bare/wrap (no behavior change), (2) add P10 fields. Avoids reviewer confusion in a single PR.
- [C14] R7. `makeArtifactInstanceId` walker scope — pin per-definitionId vs global counter. PLAYER_STARTING_ARTIFACTS ID determinism depends on this.
- [C14] R9. Treason Framing rejection ordering — `MissingUnsurfacedForgery` + `InvalidTreasonFramingTarget` must fire AFTER MissingTarget/TargetNotFound but BEFORE the modal-state gates (the gates are upstream at wrapper, not in tryStartScheme body — so no conflict; document the slot.).
- [C14] R10. PHASES growing 10→12 with zero-draw paths — pin verification that empty `state.forgeries` + thief-notice-gate-fail produces zero hash change (replay-determinism contract corollary).
- [C14] S2. `applyEconomyPhase` compute-once snippet showing the artifact-scandal walk hoisted to BEFORE the houses loop OR pinned inside the PLAYER branch — pick one.
- [C14] S3. Module-load assertion `FORGERY_SURFACING_PROBABILITY_BASIS_POINTS > 0` (recurring C5-S4 / C10-S6 / C12-R9 / C13).
- [C14] S5. Vitest "already-locked Vain NPC gets EXTENDED, not shortened" (recurring C7-S5 / C10-R7 / C11-R6 / C13-R5).
- [C14] S6. PHASES module-load length assertion at 12 (recurring C11-R2 / C13-R4).
- [C14] S7. `selectTargetedArtifactInstance` body snippet for symmetry (recurring C11-R7 / C13-R2).
- [C14] S8. Reword `applyThwartTheftPure` "always deduct" framing (recurring C11-R5 / C13-R3).
