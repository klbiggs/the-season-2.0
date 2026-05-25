# P16 — Procedural NPC Generation

> Part of [The Season Master Plan](../MASTER.md). Prior: [P15 — Dynasty Legacies & Renown Perks](./15-dynasty-legacies.md). Next: [P17 — Semantic Memory (Optional)](./17-semantic-memory.md).

**Goal.** Procedurally seed a larger non-player-character population beyond the hand-crafted fixture set so the world feels populated, and give newly-born children real period names instead of the `"Child of <marriage> @<tick>"` placeholder. Activate the wired-but-inert `MilitaryOfficer` trait with its first *designed* acquisition path.

---

## 0. Resolved decisions (read first)

These were settled with the user before planning. They override the original skeleton wording where they conflict.

- **D1 — Two generation hooks, no ongoing society replenishment.**
  1. **Society batch at campaign start**: `PROCEDURAL_NPC_COUNT` (≈ 20) fully-generated society NPCs seeded into the Independent house at bootstrap, persisted into `state.characters`, retroactively seeded into legacy saves via an idempotent helper.
  2. **Newborn naming**: the conception path names children from the era/gender name banks (given name) + a deterministic dynasty surname.
  There is **no** death-driven or yearly society replenishment in v1 (that was the rejected option; it adds a year-pass STEP + replenishment trigger surface). Society density naturally erodes as members age and die — accepted v1 behaviour; replenishment is a v1.5 candidate.

- **D2 — Procedural NPCs live in the existing Independent ("society") house.** No new house entity. `state.characters` (a `Map<CharacterId, Character>` persisted to IndexedDB via Dexie) is already the single central NPC registry — generated NPCs join it like every other character and round-trip through the existing save contract, are the **ballroom conversation roster** (`BallroomView` rosters all alive `INDEPENDENT_HOUSE_ID` characters), are seduction/scheme targets, and undergo mood drift on the `INDEPENDENT_HOUSE_ID` RNG stream. No parallel storage system is introduced. **Correction (verified in-app):** society NPCs do NOT appear in the P14 Social Web or Family Tree — both are **player-house-only** (`SocialWebView.buildSocialGraphData` nodes = alive player-house chars + the player's affection targets; `FamilyTreeTab` filters to `PLAYER_HOUSE_ID`). A society NPC enters the social web only after the player builds an `affectionMap` entry with them via conversation. The "populated world" payoff is the ballroom roster (~25 targets), not the social web.

- **D3 — `MilitaryOfficer` rides the Bohemian-Rake / "dashing officer" profile.** The Regency dashing-officer-in-society trope: the BohemianRake generation profile *guarantees* `MilitaryOfficer`, so every Bohemian-profile society NPC is an officer. This is the first **designed** acquisition path; it activates the P13 WarEffort officer-death + WarEffort×Seduction-multiplier branches (which iterate **all** houses including Independent — verified `globalEvents.ts:147-181`).

- **D4 — Population ≈ 20** at campaign start (tunable `PROCEDURAL_NPC_COUNT`). Roughly doubles the cast to ~35 total (player + 5 baseline + 9 rival + 20 society). The ballroom roster grows from 5 → 25 targets; **verified in-app it renders as a clean 5×5 PortraitRing grid (no overflow/clipping)**. Saves stay small.

- **D5 — Founder stays `"Player I"`; dynasty surname derived from `houseId`.** The House schema has **no** name/surname field (`entities.ts:143-203` — houses are keyed by `HouseId` only). The founding head is the placeholder `"Player I"` with no real surname, so born children cannot *inherit* a clean surname. We derive a stable per-house dynasty surname deterministically from `houseId` (FNV-1a over the founding-era surname bank) and apply it to newborns. Renaming the founder would force a content-rewriting migration to preserve chain-parity, so the founder is left as-is. **Accepted cosmetic effect**: patriarch `"Player I"`, children `"Emma Hartwell"`. Founder procedural naming is a v1.5 candidate. *(Settled default — treat as binding; §11 records it as a user-overridable choice, not an open blocker.)*

---

## 1. Key findings that reshape the skeleton

1. **The skeleton's "existing character-creation sites" do not exist.** The skeleton said to hook into "existing character-creation sites that currently rely on the hand-crafted fixture (Independent-house adolescents, rival-house associates, social-web filler)." There are no such ongoing sites. Baseline NPCs (5, `npcs.ts`) and rival characters (9, `rivals.ts`) are seeded **once** at bootstrap from fixtures with **zero RNG draws**; the only ongoing character source is conception (`conception.ts`). So P16 adds a **new** one-time procedural batch plus a conception-naming hook — it does not retrofit pre-existing sites.

2. **`MilitaryOfficer` is already incidentally reachable via conception.** `TRAITS_ALL` (traits.ts:59) includes `MilitaryOfficer`; conception's novelty slot draws from `noveltyPool = TRAITS_ALL.filter(not-in-union)` (conception.ts:131,83-85). So a child can *already* be born with `MilitaryOfficer` (rarely: `TRAIT_NOVELTY_PROBABILITY × 1/|noveltyPool|`). The traits.ts:39-46 comment and the CLAUDE.md "wired-but-inert … not in conception/artifact paths" pin are therefore **inaccurate**. P16 corrects that comment and frames itself as the first *designed/common* officer path (the incidental novelty path is left intact — a noble taking a commission is harmless and faintly realistic).

3. **P16 adds NO new `GameState` top-level fields.** Generated NPCs are plain `Character` entries. Therefore: no `hashableState` change (characters already project via `serializeRegistry`), no schema↔projection↔selector quad-sync change, no new bus events, no `PERSONA_CACHE_VERSION` bump. The only state delta is "more rows in `state.characters`" plus a save-version bump for the seeding discipline (§5).

---

## 2. In scope / Out of scope

**In scope.**
- Name banks (given names by era×gender; surnames by era) in `src/game/fixtures/nameBanks.ts`.
- Archetype-aware **generation profiles** over the canonical 33-trait pool in `src/game/fixtures/proceduralProfiles.ts` (Spymaster / BohemianRake-officer / Tutor / CountryExile / None), each locking its classifier outcome via role + guaranteed traits.
- A pure deterministic generator `generateSocietyNpcs(rngState, era, count)` consuming a dedicated `${seed}|procedural-npcs` RNG sub-stream (never `Math.random`).
- Bootstrap wiring (society batch into Independent house) + idempotent legacy-save seeding (`seedProceduralSocietyIntoLegacyState`, P4/P8 precedent).
- Conception naming hook (given name from banks + dynasty surname), +1 conception RNG draw.
- `SaveV15` bump (structurally identical to `SaveV14`) + `migrate_v14_to_v15` (bare+wrap) + legacy-emit prefix filter.
- Correct the inaccurate `MilitaryOfficer` "no acquisition path" comment + CLAUDE.md pin.

**Out of scope.**
- LLM-generated NPC biographical text (P18 — consumes the procedural NPCs created here).
- Portrait generation (procedural-flat or fixture-portrait stays at v1).
- Procedural artifact generation (§10 Q10 v1.5 candidate).
- Ongoing society replenishment (death-driven / yearly trickle) — v1.5 candidate (D1).
- Procedurally-generated marriages **between** society NPCs (they are all single in v1).
- Society NPCs as `HeadOfHouse` (Independent already has its head, `npc-blackwood`; all society NPCs take non-head roles).
- Founder procedural naming (D5 — v1.5 candidate).

**Spec refs.** §3 "Audio, Localization & Procedural Identity (Content Tier)" — "Procedural non-player characters are seeded from name banks plus the canonical 32-trait pool with archetype-aware distributions; each generated character's identity is persisted at first creation" (`docs/greenfield-spec.md:273-279`). *(The spec line says "32-trait pool"; it predates the P13 `MilitaryOfficer` addition — the live pool is 33, asserted at `traits.ts:49`. This plan uses 33.)*

**Dependencies.** P0 (RNG), P1 (Character schema + trait pool + conception), P7 (archetype classification + roles). Independent of P14/P15.

---

## 3. Determinism contract

- **Dedicated transient RNG sub-stream for the society batch.** Seeded `createRngState(\`${campaignSeed}|procedural-npcs\`)`. Drawn down fully at generation, then **discarded** — it is NOT added to `state.rng`, so there is no `state.rng` projection change and no per-tick consumer. Identical seed in both the bootstrap path and the legacy-seed path ⇒ byte-identical society. (Per-tick mood drift for these NPCs uses the existing `INDEPENDENT_HOUSE_ID` stream, since they belong to that house.)
  - Rationale for a dedicated stream over the player stream: isolates batch-size from the player gameplay stream's call-count, mirroring the per-rival `${seed}|${rivalHouseId}` precedent (`bootstrap.ts:176`, `rivals.ts:272`). A `|`-separator collision guard is unnecessary because `"procedural-npcs"` is a fixture-controlled literal (not user-supplied), same as rival ids.

- **Era is pinned to `"Earlier"` for the society batch on BOTH paths.** `generateSocietyNpcs(rngState, era, count)` takes `era` as a parameter, but every caller (bootstrap AND the migration seed helper) MUST pass the literal `"Earlier"` (the founding era), **never** `save.era`. The bootstrap path is trivially Earlier (`store.ts:194`), but a mid-campaign save migrated *after* an era flip carries `era: "Later"` — passing `save.era` there would diverge from the fresh-bootstrap society and silently break the `hashState(fresh) === hashState(migrated)` chain-test parity (`v1-to-v14-chain.test.ts`). The chain test seeds a tick=0 save (stays Earlier) and would NOT catch this — so it must be pinned by construction. (Newborn naming in conception is different — it correctly reads the *live* `state.era` at birth; see below.)

- **Fixed 8-draw budget per society NPC** (regardless of which profile/branch is taken — mirrors `inheritTraits`' "empty-pool fallback still consumes the draw" discipline, conception.ts:28-33). Iterate index `0..count-1` sequentially on the single procedural stream:
  1. **profile pick** — integer cumulative-sum over `PROCEDURAL_PROFILE_WEIGHTS` (sum = 100): `drawInt(rng, 100)` returns `[0,99]` → pick the first profile whose running cumulative weight is **strictly `> roll`** (equivalently `roll < cumulative`). Use strict `>`, NOT `≥` — `≥` would catch `roll == cumulative` and over-weight the first bucket by one, skewing the realized distribution off the nominal weights. NO `weight/total` float intermediate (cross-engine determinism hazard; there is no `pickWeighted` in `rng.ts` — only `drawNext`/`drawInt`/`pickItem`, so write the cumulative-sum inline).
  2. gender (drawn; a profile that FIXES gender — Spymaster Female, BohemianRake Male — ignores the drawn value for the `Character.gender` field but the draw is still consumed). Define `effectiveGender` = the profile-forced gender where fixed, else the drawn value. **`Character.gender`, `honorificFor`, AND draw 7's name-bank index all use `effectiveGender`** — never the raw drawn bit — else a fixed-gender NPC could be named against the wrong bank (e.g. a male officer "Lord Honoria").
  3. age (`drawInt` over the adult range `[PROCEDURAL_NPC_MIN_AGE, PROCEDURAL_NPC_MAX_AGE]`, e.g. `[20, 55]` — always `< 70 = LIFESPAN_RANGE[0]`, so `deathAge > age` always holds)
  4. deathAge (`drawInt(_, 26) + 70`, same as `seedStartingFamily`/conception)
  5. trait pool pick #1 (`drawInt(rng, pooled.length)`; dedup vs guaranteed + prior; collision ⇒ fewer traits, draw still consumed)
  6. trait pool pick #2 (same)
  7. given-name pick (`drawInt(rng, GIVEN_NAMES[era][effectiveGender].length)` — note `effectiveGender`, see draw 2)
  8. surname pick (`drawInt(rng, SURNAMES[era].length)`)
  - `id = \`proc-npc-${i}\``; `birthTick = 0` (mirrors baseline NPCs' "birthTick 0; no aging skew", npcs.ts); `role` = profile-determined (no draw); `archetype = classifyArchetype(...)` (derived, no draw); gender **drawn** (not hashed — procedural NPCs are new entities with no legacy gender-parity constraint, matching conception which also draws gender). All other `Character` fields are constants — see §6 B-fix (mirror `buildBaselineNpcCharacter` field-for-field).

- **Conception gains +1 draw** (now 7/child: 4 traits + deathAge + gender + **given-name**). The given-name draw is **appended at the tail** (after gender) per the P7 precedent (conception.ts:141-147) so the existing 6-draw prefix's per-child trait/deathAge/gender values are unchanged for a given starting call-count. Surname is derived (`dynastySurnameForHouse`, no draw). The name draw uses the **child's house** stream (keeps conception house-local).

- **Replay harness baseline recomputes.** Adding society NPCs to the Independent house adds Independent-stream mood-drift draws each tick and (for officers, during WarEffort) player-stream draws. All deterministic. The harness is `src/game/replay-harness.test.ts`; it asserts run-to-run equality (`expect(runOnce(...)).toBe(baseline)` at :37) with NO pinned hex hash, so it stays green with the larger population. No golden-hash fixture exists to update.

---

## 4. Generation profiles (archetype-aware distributions)

`src/game/fixtures/proceduralProfiles.ts`. Each profile is keyed to an intended `Archetype` and constructs `role` + `gender bias` + `guaranteed[]` + `pooled[]` such that `classifyArchetype` (archetypes.ts:26-64) deterministically returns that archetype. Branch ordering in the classifier (Spinster→Spymaster, then male-unwed-rake→BohemianRake, then unwed-Intellectual→Tutor, then Exile/Rustic→CountryExile, else None) is respected so `pooled` traits cannot flip the classification.

| Profile (intended archetype) | role | gender | guaranteed | pooled (drawn ×2) | classifier lock |
|---|---|---|---|---|---|
| **Spymaster** | `Spinster` | Female (fixed) | `Cunning` | Reserved, Suspicious, Cautious, Observant, Eloquent | Branch 1 (Spinster + (Cunning\|Observant)); guaranteed `Cunning` forces it |
| **BohemianRake (officer)** | `Bohemian` | Male (fixed) | `Jaded`, **`MilitaryOfficer`** | Bold, Brash, Charming, Hedonistic, Romantic, Frivolous | Branch 2 (male unwed adult + Jaded) |
| **Tutor** | `Dependent` | drawn | `Intellectual` | Sophisticated, Polyglot, Eloquent, Devout, Ascetic | Branch 3 (unwed adult + Intellectual). Pool **excludes** Frivolous/Romantic/Jaded so a male Tutor can't flip to BohemianRake |
| **CountryExile** | `Exile` | drawn | `Rustic` | Reclusive, Melancholic, ImpoverishedNobility, Ascetic | Branch 4 (Exile role) |
| **None (general society)** | `Dependent` | drawn | *(none)* | Generous, Loyal, Empathetic, Bold, Cautious, Vain, Witty, Charming, Brash, Ambitious, Greedy | Default. Pool **excludes** all classifier triggers (Frivolous/Romantic/Jaded, Intellectual/Sophisticated, ImpoverishedNobility/Rustic, and is never Spinster) so it stays None |

- **Profile weights** (`PROCEDURAL_PROFILE_WEIGHTS` in `constants.ts`, tunable): None 40 / BohemianRake 20 / Tutor 15 / Spymaster 15 / CountryExile 10. With ≈20 NPCs this yields ≈4 officers (BohemianRake), reliably exercising the WarEffort branch.
- **Module-load invariants** (mirror `archetypes.ts:84-100`): assert every profile's `guaranteed` traits force the intended `classifyArchetype` outcome given a synthetic adult Character (a tiny self-check loop at module load), and assert `MilitaryOfficer ∈ BohemianRake.guaranteed`. This catches a future trait-pool edit silently breaking the classifier lock or the officer activation.

---

## 5. Name banks & dynasty surnames

`src/game/fixtures/nameBanks.ts`:
- `GIVEN_NAMES: Record<"Earlier"|"Later", Record<"Female"|"Male", readonly string[]>>` — ~25 names per cell. Earlier ≈ Regency (Augustus, Frederick, Honoria, Arabella…), Later ≈ early-Victorian (Albert, Edmund, Florence, Beatrice…).
- `SURNAMES: Record<"Earlier"|"Later", readonly string[]>` — ~40 gentry surnames per era (Hartwell, Pembroke, Wexford, Ashby…).
- `honorificFor(gender, role): string` — period honorific (Female→`Miss`/`Lady`, Male→`Mr.`/`Lord`) derived deterministically from gender+role (no draw). Society NPC display name = `\`${honorific} ${given} ${surname}\``.
- `dynastySurnameForHouse(houseId): string` = `SURNAMES["Earlier"][fnv1a32(houseId) % SURNAMES["Earlier"].length]`. **Founding-era fixed** so the dynasty surname is stable across an era flip. Newborn name = `\`${givenName} ${dynastySurnameForHouse(childHouseId)}\``.
  - **`fnv1a32` extraction touches FROZEN code — parity guard required.** `hashCharIdToGender.ts:26-34` is the frozen FNV-1a (computes gender via `(hash & 1) === 0` with NO `>>> 0` anywhere — a drift "silently re-rolls every legacy character's gender"). Extract a shared `fnv1a32(s: string): number` that returns the raw **unsigned** 32-bit hash (`hash >>> 0` — REQUIRED because `dynastySurnameForHouse` uses `% length`, which needs the unsigned value; the `& 1` gender low-bit is unaffected by sign so gender stays byte-identical), and have `hashCharIdToGender` call it then apply `& 1`. The existing `hashCharIdToGender.test.ts` golden pairs MUST stay green post-extract — that is the parity guard (see §8).

---

## 6. Files to create / modify

**Create**
- `src/game/fixtures/nameBanks.ts` (+ `.test.ts`) — name banks, `honorificFor`, `dynastySurnameForHouse`, `fnv1a32`.
- `src/game/fixtures/proceduralProfiles.ts` (+ `.test.ts`) — the 5 profiles, weights table, module-load invariants.
- `src/game/rules/proceduralNpcs.ts` (+ `.test.ts`) — **pure** `generateSocietyNpcs(rngState, era, count): { characters: Character[]; rngState }` and `buildProceduralNpcCharacter(...)`. Lives in the rules layer because it consumes RNG; imports only constants/fixtures/rng (boundary-clean).
  - **`buildProceduralNpcCharacter` MUST set all 24 `CharacterSchema` fields — mirror `buildBaselineNpcCharacter` (`npcs.ts:79-109`) field-for-field.** The §3 draw list names only the ~8 drawn/derived fields; the rest are constants. Explicit pins for the non-obvious ones: `marriageId: null`, `moodLockUntilTick: 0`, `diedAtTick: null`, `composure: 100`, `maxComposure: 100`, `happiness: HAPPINESS_INITIAL`, `temptationHookUnlocked: false`, `assignedTutorCharacterId: null`, `tutorBonusTraitGranted: false`, `dullSpouseExposureStartTick: null`, `parentCharacterIds: null` (society NPCs are first-generation), `equippedArtifactIds: []`. (TS strict catches omissions, but enumerate to spare the implementer guessing.)
- `src/persist/migrations/v14-to-v15.ts` (+ `.idempotence.test.ts`) — `migrate_v14_to_v15(save: SaveV14): SaveV15 = toSaveV15(seedProceduralSocietyIntoLegacyState(fromSaveV14Bare(save), playerSeed))`, where `playerSeed` feeds the `${campaignSeed}|procedural-npcs` stream and the seed helper passes era `"Earlier"` (NOT `save.era` — see §3 era pin). **Seed-composition template = `v8-to-v9.ts:43-48`** (which composes a seed step + extracts the player seed), NOT `v13-to-v14.ts` (that is a bare `toSaveV14(fromSaveV13Bare(save))` with ZERO seed step). **`extractPlayerSeed` is module-private** — `schema.ts:746` (sig `(rng)`) is not exported, and `v4-to-v5.ts`/`v5-to-v6.ts`/`v8-to-v9.ts` each re-declare their own (sig `(save)`). Either export the schema.ts one or re-declare locally per the v8-to-v9 precedent; the call shape is `extractPlayerSeed(save.rng)` (rng form) or `extractPlayerSeed(save)` (save form) depending which you reuse.

**Modify**
- `src/game/constants.ts` — `PROCEDURAL_NPC_COUNT`, `PROCEDURAL_NPC_MIN_AGE`/`MAX_AGE`, `PROCEDURAL_PROFILE_WEIGHTS`, `PROCEDURAL_NPC_TRAIT_DRAWS = 2`. (NOT `SAVE_VERSION_CURRENT` — that constant lives in `schema.ts:78`, see below; `constants.ts` only mentions the name in two error strings.)
- `src/game/bootstrap.ts` — `seedStartingFamily` generates the society batch via `generateSocietyNpcs(createRngState(\`${campaignSeed}|procedural-npcs\`), "Earlier", PROCEDURAL_NPC_COUNT)` and appends to the returned `characters` array. **Add `createRngState` to the `./rng` import** (bootstrap.ts:52 currently imports only `drawInt`). Society generation consumes its own transient stream, so the player-house `rngState` return is unchanged. **`createInitialState` (`store.ts:143-199`) needs NO edit** — the seam is `seedStartingFamily`'s returned `characters` array (flows into the Map at `:164-165`); `bootstrapPlayerArtifactsForInit`/`bootstrapNpcMountFamily` look up the head by id (not array index), so appending society NPCs is safe and adds zero artifact draws.
- `src/game/fixtures/names.ts` + `src/game/rules/conception.ts` — replace `childName(...)` placeholder with the name-bank composition (`\`${given} ${dynastySurnameForHouse(childHouseId)}\``); add the 7th (given-name) draw at the conception tail. **Conception now reads `state.era`** (it does not today — `applyConceptionStep` gains a `state.era` read to index `GIVEN_NAMES[state.era][gender]`; this correctly uses the LIVE era at birth, unlike the society batch's pinned `"Earlier"`).
- `src/game/fixtures/traits.ts` (comment at 39-46) — correct the "no acquisition path / not in conception" inaccuracy.
- `src/persist/schema.ts`:
  - **Bump `SAVE_VERSION_CURRENT` 14 → 15 at `schema.ts:78`** (`export const SAVE_VERSION_CURRENT = 14 as const;`). Only the live `toSaveV15` references it; demoted emitters pin their literal version (the existing `toSaveV2..V14` already use literal `version: N`, so the bump doesn't disturb them).
  - `SaveV15Schema` (clone of V14 + `version: z.literal(15)`); `toSaveV15`.
  - **Create `fromSaveV14Bare` via a Bare/wrap split** — `fromSaveV14` (schema.ts:2227) currently *inlines* `bootstrapNpcMountFamily(...)` and was never split (unlike V13). Refactor to mirror `fromSaveV13Bare`/`fromSaveV13` (schema.ts:2109/2148): `fromSaveV14Bare` does pure deserialization with NO mount seeding. NOTE the mechanics differ from the V13 template: `fromSaveV14` extracts `characters`/`artifactInstances` into locals (schema.ts:2228-2232), mutates them, then references them in the return — so the public `fromSaveV14` wrap cannot be a literal append; it must call `fromSaveV14Bare`, re-derive the two locals from the bare result (or thread the bare `GameState` through `bootstrapPlayerArtifactsForMigration`/`bootstrapNpcMountFamily` which already take/return state), then return. Net contract: `fromSaveV14Bare` = pure deserialize, public `fromSaveV14` = Bare + mount seed, behaviour-identical to today.
  - `seedProceduralSocietyIntoLegacyState(state, playerSeed)` (idempotent: return unchanged if any `proc-npc-` id already present; else generate via the `"Earlier"`-pinned `generateSocietyNpcs` and add to `state.characters`). **Thread it into ALL public `fromSaveV1..V14` lifters.** The lifter shapes are heterogeneous (V1-V8 chain seed helpers; V9/V10 `return bootstrapPlayerArtifactsForMigration(...)`; V11 bare `return fromSaveV11Bare(save)`; V12/V13 mutate-then-return-local; V14 returns a literal), so the single unifying rule is: **wrap the outermost `GameState`-returning expression in `seedProceduralSocietyIntoLegacyState(<expr>, playerSeed)`.** The helper is idempotent and only adds `proc-npc-*` rows, so composition order relative to the independent/rivals/artifact seeds is irrelevant — don't fret about ordering. This seed-into-every-lifter is the P4/P8 precedent. **Load-bearing for the ten existing fresh-parity chain tests** — see §8.
  - `PROCEDURAL_NPC_ID_PREFIX = "proc-npc-"` + `filterProceduralNpcsForLegacyEmit(characters)`. **Per-emitter composition differs in SHAPE, not just presence** (the existing char-emit sites are NOT uniform): `toSaveV2-V4` build `charsLegacy` via a push-loop with a `continue` on rival ids (schema.ts:842-850 + V3/V4 analogues) → add a second `continue`/predicate for `proc-npc-`; `toSaveV5-V8` use `serializeRegistry(...).filter(rival)` (V7/V8 wrapped in a strip helper) → extend the predicate; `toSaveV9/V10` use `stripEquippedArtifactsForLegacyEmit(serializeRegistry(...))` with NO char filter → add the proc filter; `toSaveV11/V12/V13/V14` use bare `serializeRegistry(state.characters)` with NO char filter → add the proc filter. TS won't catch a miss — only the chain tests will. **`toSaveV14` is special**: it demotes from the live emitter to a legacy emitter at P16 and must gain ONLY the `proc-npc-` filter — it MUST NOT gain a `RIVAL_CHARACTER_IDS_SET` filter, because rival characters were legitimate in the live V14 format and a real on-disk V14 save contains them (filtering them would corrupt V14 round-trips). Do not pattern-match "make V14 look like V2-V13."
- `src/persist/migrations/index|registry` (wherever `MIGRATIONS` is assembled) + the migration runner's max-version — register `migrate_v14_to_v15` with `outputSchema: SaveV15Schema`.
- `src/persist/migrations/v1-to-v15-chain.test.ts` — **ADD** a new chain file (additive convention: `ls src/persist/migrations/` shows `v1-to-v3` … `v1-to-v14` chain files coexisting — do NOT rename `v1-to-v14-chain.test.ts`). Migrate v1→v15; assert society contract (every Independent-house `proc-npc-*` count = `PROCEDURAL_NPC_COUNT`; all single, non-head) and the fresh==migrated hash parity at the new version.

### 6a. Live-version consumer swaps — REQUIRED, easily missed

> Bumping `SAVE_VERSION_CURRENT` 14→15 is **not** just a schema edit. `SaveV14Schema.version = z.literal(14)` and `toSaveV14` emits `version: SAVE_VERSION_CURRENT` (`schema.ts:2195`) — so once the constant is 15, **every `save()` throws** (15 ≠ literal-14) and load/restore type-mismatch until the live consumers swap to V15. This gap crashed P13 and silently stripped state at P15; it is in scope and load-bearing. After editing, run `rg 'SaveV14|fromSaveV14|toSaveV14' src/ --glob '!**/schema.ts' --glob '!**/migrations/**'` and confirm zero stale hits.

Swap V14→V15 at each verified surface:
- `src/persist/dexie.ts` — imports (`type SaveV14`, `SaveV14Schema`, `toSaveV14` at lines 27-29 → V15), `Data` union member (`:58`), the live emitter `toSaveV14(state)` (`:82` → `toSaveV15`), `load(): Promise<SaveV14 | undefined>` return type (`:94`), and both `SaveV14Schema.parse(...)` sites (`:116` current-version path, `:124` post-migration path), plus the explanatory comments at `:41`/`:80`/`:87`/`:91`.
- `src/persist/save-roundtrip.test.ts` — `import { fromSaveV14 }` (`:12`) and `replaceState(fromSaveV14(loaded))` (`:37`) → `fromSaveV15`.
- `src/ui/shared/SettingsMenu.tsx` — `import { fromSaveV14 }` (`:5`) and `replaceState(fromSaveV14(saved))` (`:45`) → `fromSaveV15`.
- `src/persist/dexie.test.ts` — current-version-path test name + comments (`:57-59`) reference SaveV14; update to V15. **Critically, flip the in-payload `version: 14` literal at `:62`** inside the `_putRawForTests({...})` object → `15`. If only the name/comment change, a `version: 14` record now takes the *legacy-migration* branch (`dexie.ts:122`) instead of the current-version `SaveV15Schema.parse` branch (`dexie.ts:114`) — testing the wrong path and likely changing which error fires.

These swaps are part of slice 6 (§7) — the slice is not complete until the `rg` sweep is clean and `pnpm typecheck` passes.

---

## 7. Implementation slices (ordered)

1. **Name banks + helpers** (`nameBanks.ts` + test): banks, `honorificFor`, `dynastySurnameForHouse`, `fnv1a32`. Golden-output test pins a few `dynastySurnameForHouse` pairs (frozen, like `hashCharIdToGender.test.ts`).
2. **Profiles** (`proceduralProfiles.ts` + test): 5 profiles + weights + module-load invariants; test asserts each profile's synthetic output classifies to its intended archetype and BohemianRake guarantees `MilitaryOfficer`.
3. **Pure generator** (`rules/proceduralNpcs.ts` + test): `generateSocietyNpcs`; test asserts the fixed 8-draw budget, determinism (same seed ⇒ identical batch; 30× equality), distinct ids, all single + non-head, era-correct name banks, and per-profile trait invariants.
4. **Bootstrap wiring**: `seedStartingFamily` seeds the batch into Independent. Update bootstrap/replay tests for the new character count + recomputed determinism.
5. **Conception naming**: name-bank given name + dynasty surname; +1 tail draw. Update `conception.test.ts` (new 7-draw budget, name format).
6. **Save bump + migration + legacy seed + emit filter + live-consumer swap (§6a)**: `SAVE_VERSION_CURRENT=15`, `SaveV15Schema`, `migrate_v14_to_v15`, `seedProceduralSocietyIntoLegacyState` into lifters, prefix filter at legacy emitters; **swap every V14→V15 live consumer per §6a** (dexie.ts/SettingsMenu.tsx/save-roundtrip.test.ts/dexie.test.ts); idempotence test; add `v1-to-v15-chain.test.ts`. Done only when `rg 'SaveV14|fromSaveV14|toSaveV14' src/ --glob '!**/schema.ts' --glob '!**/migrations/**'` is clean and `pnpm typecheck` passes.
7. **Correct the `MilitaryOfficer` comment** in traits.ts + the CLAUDE.md pin.
8. **Verification pass** (§8) + `/close-phase 16`.

---

## 8. Verification

Vitest:
- **Determinism**: `generateSocietyNpcs` produces an identical batch across 30 runs of a fixed seed; bootstrap-path society == legacy-seed-path society (byte-identical); the 30-run replay harness stays green (run-to-run equality) with the larger population.
- **Save/load round-trip**: a fresh campaign's society NPCs round-trip through `save()`/`load()` verbatim; legacy `SaveV{<15}` lift seeds the identical society; `migrate_v14_to_v15` is idempotent; the new `v1-to-v15-chain.test.ts` produces fresh==migrated hash parity.
- **The TEN existing fresh-parity chain tests stay green by construction** (`v1-to-v5`, `v1-to-v6`, `v1-to-v7`, `v1-to-v8`, `v1-to-v9`, `v1-to-v10`, `v1-to-v11`, `v1-to-v12`, `v1-to-v13`, `v1-to-v14` — each asserting `hashState(lifted) === hashState(createInitialState(seed))`): bootstrap now puts `PROCEDURAL_NPC_COUNT` `proc-npc-*` characters in `createInitialState`, so EVERY public `fromSaveV1..V14` lifter MUST seed the identical society (per §6) or these break. **Re-run all ten after slice 6** — they are the proof that the seed-into-every-lifter wiring is complete (the V5-V8 lifters have the most heterogeneous shapes and are the likeliest to be wired wrong; do not skip them). NOTE `v1-to-v3` and `v1-to-v4` are tick-only assertions (`lifted.tick === 0`), NOT parity — they are unaffected (v4's own comment records that parity moved to `v1-to-v5-chain.test.ts` pre-Independent-house).
- **Archetype-aware distribution**: every generated NPC's traits are drawn from its profile's pool (a Spymaster-profile NPC has `Cunning`+Spinster, never the Rake pool; a Tutor-profile NPC is never male-with-a-rake-trigger; a None-profile NPC carries no classifier trigger). Statistical check over a large batch confirms the weight table is respected within tolerance.
- **MilitaryOfficer end-to-end**: with a pinned seed that yields ≥1 BohemianRake society officer, build a campaign, run an active WarEffort tick, and assert the officer-death roll path executes against a society (Independent-house) officer (per-officer player-stream draw consumed; over enough ticks an officer dies and routes through `pruneOrphanedConversationKeys`). Also assert the WarEffort×Seduction multiplier branch fires for an officer aggressor.
- **`fnv1a32` extraction parity**: `hashCharIdToGender.test.ts` golden pairs stay green after the extraction (proves the frozen gender derivation didn't drift); add a golden-output test pinning a few `dynastySurnameForHouse(houseId)` pairs (frozen, like the gender test).
- **No-state-leak guard**: `hashable-state-extension.test.ts` and the schema↔projection↔selector trip-wire stay green **untouched** (P16 adds no top-level field) — proof the phase added zero new state surface.

Manual (✅ done — Playwright-driven against `pnpm dev:vite`, screenshots in evidence):
- **Ballroom roster** ✅ — entered the ballroom at Capital; the roster shows **25 conversation targets** (5 baseline Lady/Lord/Miss/Mr. + 20 procedural `Mr./Miss <Given> <Surname>`, e.g. "Mr. Horatio Pennington", "Miss Rosamund Marchmont", "Mr. Frederick Fairfax"), rendered as a clean 5×5 PortraitRing grid with no overflow. Selecting a `proc-npc-*` card works (`aria-pressed=true`). No page errors.
- **Social Web / Family Tree finding** ✅ — confirmed player-house-only: Family Tree shows 1 row ("Player I"); the Social Web force-graph shows a single gold node on a fresh campaign. Society NPCs are NOT visible here (only after the player builds affection). The earlier "~35 nodes in the social web" expectation was wrong — see D2 correction.
- **Newborn naming** — NOT browser-driven (requires a marriage + multi-year conception flow); covered by the conception unit test (`conception.test.ts`: name = `"<Given> <DynastySurname>"`, no "Child of" placeholder). Flagged as test-covered, not UI-exercised.

Gates: `pnpm test`, `pnpm lint` (Biome + boundaries — note the known 2-error `lint:boundaries` baseline from the P14 carve-out is unchanged), `pnpm typecheck`.

---

## 9. CLAUDE.md additions (apply at close-out)

- **Procedural society generation (P16)**: ~`PROCEDURAL_NPC_COUNT` society NPCs generated once at bootstrap into `INDEPENDENT_HOUSE_ID` from a **transient** `${seed}|procedural-npcs` RNG sub-stream (NOT added to `state.rng`; discarded after the batch). Fixed 8-draw budget per NPC; ids `proc-npc-<i>`; gender drawn (not hashed); retroactively seeded into legacy saves via idempotent `seedProceduralSocietyIntoLegacyState` (skip if any `proc-npc-` present), threaded into every public lifter + the v14→v15 migration. Legacy emit filters `proc-npc-` by prefix (mirrors `RIVAL_CHARACTER_IDS_SET`). Adds **no** new `GameState` field — characters project through the existing `serializeRegistry`.
- **Generation profiles lock the classifier (P16)**: each profile sets role + guaranteed traits so `classifyArchetype` is deterministic; `pooled` arrays exclude triggers that would flip the branch. Module-load invariants enforce both the lock and `MilitaryOfficer ∈ BohemianRake.guaranteed`.
- **`MilitaryOfficer` correction (P16 supersedes the P13 pin)**: the P13 "no acquisition path / not in conception" claim was inaccurate — the conception novelty slot (`TRAITS_ALL` includes `MilitaryOfficer`) could always incidentally produce it. P16 adds the first **designed** path (BohemianRake society profile). The incidental novelty path is intentionally retained.
- **Newborn naming (P16)**: conception names children `"<givenName> <dynastySurnameForHouse(houseId)>"` with a 7th tail draw (given name, child's-house stream). `dynastySurnameForHouse` is FNV-1a over the founding-era surname bank, stable across era flips. Founder remains `"Player I"` (renaming would need a content migration — v1.5).
- **Save bump rationale (P16)**: `SaveV15Schema` is structurally identical to `SaveV14Schema` (no new fields); the bump exists solely to mark the "society guaranteed present" boundary and give the chain test a clean step — the disciplined analogue of the P8 rival seeding.

---

## 10. Determinism / behaviour ripples to watch

- **Independent-house succession** now has a larger heir-candidate pool when `npc-blackwood` dies. But `processDeadHead` (`succession.ts`) filters the family pool to `role ∈ {Spouse, Heir, Dependent}` — so only the **Tutor** and **None** profiles (role `Dependent`) are eligible; **Spymaster** (`Spinster`), **BohemianRake** (`Bohemian`), and **CountryExile** (`Exile`) are NOT. With the §4 weights that is ≈11 of 20 eligible, not "all". Deterministic (lex-sorted) and a benign behaviour change — do NOT write a verification test asserting "all society NPCs are succession-eligible" (it would fail by design).
- **Aging deaths**: society NPCs have varied ages and finite `deathAge`; some die over a long campaign and route through `pruneOrphanedConversationKeys` like any character. No special handling — confirm no orphan/cascade surprises.
- **WarEffort** now has more officers across houses → more player-stream draws on WarEffort ticks; reflected in the recomputed replay baseline.

---

## 11. Sub-decisions (SETTLED — recorded for traceability, not open blockers)

> All four below are settled at their chosen default and are **binding for implementation**. They are listed only so a future maintainer can see the alternatives weighed and the user-overridable knobs. The implementer should NOT treat any of these as open questions.

- **D5 founder naming**: leave founder as `"Player I"` with derived dynasty surnames for children (chosen default), or rename the founder procedurally (needs a content-rewriting v14→v15 step to preserve chain-parity)? **Settled: leave as-is.**
- **Officer prevalence**: `MilitaryOfficer` guaranteed on *every* Bohemian-profile NPC (chosen default, ~4 officers/20), or probabilistic within the pool (needs a seed-pinned verification test)? Default = guaranteed.
- **Save bump vs no-bump**: bump to `SaveV15` for discipline (chosen default), or seed society purely in the lifters with no version bump (lighter, but same version number would carry different content pre/post-P16)? Default = bump.
- **`PROCEDURAL_NPC_COUNT`** exact value (≈20) — final tuning during playtest.

---

## Close out

When the gates and verification items above are green, run `/close-phase 16` to update phase status in `plans/MASTER.md` §6, append to `plans/SESSION-NOTES.md`, resolve any open questions answered during the work, apply the §9 `CLAUDE.md` additions, and commit the changes (no push).

---

## Accumulated Risks & Suggestions

*Passively collected from review cycles. Not blockers. Triaged at convergence.*

- [C1] R1 — `buildProceduralNpcCharacter` mirror `buildBaselineNpcCharacter` field-for-field (24 fields). [folded into §6 Create block — escalated to B1 in C3 and fixed]
- [C1] R2 — Weighted profile-pick as integer cumulative-sum; no float intermediate. [folded into §3 draw-budget step 1]
- [C1] R3 — `fnv1a32` extraction parity (frozen `hashCharIdToGender`; `>>> 0`; golden pairs stay green). [folded into §5 + §8]
- [C1] R4 — Chain test is additive convention: ADD `v1-to-v15-chain.test.ts`, don't rename. [folded into §6]
- [C1] R5 — `bootstrap.ts` add `createRngState` to the `./rng` import. [folded into §6 bootstrap line]
- [C1] R6 — Replay test is `src/game/replay-harness.test.ts` (run-to-run parity, no golden hex). [folded into §3 + §8]
- [C1] S1 — `createInitialState` needs NO edit (seam is the returned `characters` array). [folded into §6 bootstrap line]
- [C1] S2 — §11 sub-decisions all settled "(chosen default)"; reconcile D5's "Flagged for review" tone. [still-open — minor wording]
- [C1] N1 — Create `fromSaveV14Bare` via Bare+wrap split (mirror `fromSaveV13Bare`/`fromSaveV13`). [folded into §6 schema.ts — escalated to B2 in C3 and fixed]
- [C1] N2 — Flip the `version: 14` literal at `dexie.test.ts:62` → `15`. [folded into §6a]
- [C1] Minor — `migrate_v14_to_v15` thread `playerSeed` via `extractPlayerSeed`. [folded into §6 Create migration line]
- [C2] R1 — `toSaveV14` gains ONLY the `proc-npc-` filter, NOT a rival filter (would corrupt V14 round-trips). [folded into §6 schema.ts per-emitter composition]
- [C2] S1 — Spec "32-trait pool" is stale (live 33). [folded into §2 Spec-refs parenthetical]
- [C2] S2 — Triage the [C1] tail into the body. [done — items above marked folded]
- [C3] B3 — Seed proc-npcs into ALL public `fromSaveV1..V14` lifters (not just "after the rivals seed" — V9-V14 have no rivals anchor); the six existing chain tests break otherwise. [folded into §6 lifter line + §8 existing-chain-tests note — escalated to blocker and fixed]
- [C3] R6 — `fromSaveV14` Bare/wrap split must re-derive the `characters`/`artifactInstances` locals (V14 extracts them mid-body, unlike the V13 append template). [folded into §6 Bare-split note]
- [C3] R7 — `extractPlayerSeed` is module-private (re-declared per migration); cite `v8-to-v9.ts` as the seed-composition template, NOT `v13-to-v14.ts` (zero seed step). [folded into §6 Create migration line]
- [C3] R8 — Per-emitter proc filter shape varies (V2-V4 push-loop `continue` vs V5+ `.filter()`). [folded into §6 per-emitter line]
- [C3] S4 — Reconcile §11 "open/flagged" framing with §0 "settled default." [folded into §11 heading/intro + D5]
- [C3] B4 — Fresh-parity chain tests are TEN (`v1-to-v5`…`v1-to-v14`), not six; `v1-to-v3/v4` are tick-only. The V5-V8 lifters are the trickiest and were excluded from the proof-set. [folded into §6 + §8 — escalated to blocker and fixed]
- [C3] R9 — Unifying lifter rule: wrap the outermost `GameState`-returning expression in `seedProceduralSocietyIntoLegacyState(<expr>, playerSeed)`; idempotent so order-safe. [folded into §6 lifter line]
- [C3] S5 — §4 branch-1 prose: classifier is `Spinster + (Cunning|Observant)`, not just Cunning. [folded into §4 table]
- [C4] R10 — §3 draw-7 should index `GIVEN_NAMES[era][effectiveGender]` (the profile-forced gender where fixed, else the drawn gender) — else a male officer could be named "Honoria". Cosmetic (the `gender` field is correct), smoke-test would catch. [applied — §3 draws 2 & 7 now use `effectiveGender`]
- [C4] S6 — [withdrawn: misread — the export IS `MIGRATIONS` (imported `from "./index"` at v1-to-v14-chain.test.ts:15); the "ln" alias was a grep display artifact, not real]
- [C4] R2 — `SAVE_VERSION_CURRENT` is defined at `src/persist/schema.ts:78` (NOT `constants.ts`, which only references the name in two error strings). §6 "Modify" sends the 14→15 bump to the wrong file. [applied — §6 retargets the bump to schema.ts:78; constants.ts line corrected]
- [C4] R3 — Cumulative-weight predicate: `drawInt(rng, 100)` returns `[0,99]`; "first bucket whose cumulative `≥ roll`" over-weights the first bucket by one. Use strict `cumulative > roll` (or `roll < cumulative`). Determinism-safe but skews realized distribution. [applied — §3 draw 1 now pins strict `>`]
- [C4] S1 — §6a V2 push-loop cite `schema.ts:842-849` is off by one (block is 842-850). Cosmetic. [applied — §6a cite corrected to 842-850]
