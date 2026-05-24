# P15 — Dynasty Legacies & Renown Perks

> Part of [The Season Master Plan](../MASTER.md). Prior: [P14 — Ledger View & Social Web Visualization](./14-ledger-social-web.md). Next: [P16 — Procedural NPC Generation](./16-procedural-npcs.md).

**Goal.** Three permanent house-level perks awarded on cross-generational milestones, plus their permanent effects, plus a read-only Ledger surface. Save format bumps **v13 → v14** to carry **FOUR new `House` fields** (one perk-award list + three progress counters) and **ONE new entity schema** (`DynastyPerkAward`) + **ONE new enum** (`DYNASTY_PERK_KINDS`). No new top-level `GameState` fields.

P15 is the project's second monotonic-across-generations system (P11's inherited-secrets ledger was the first). Where P11's state grows by accumulation, P15's grows by *milestone latching*: each perk is a one-way award that, once earned, permanently modulates a gameplay rule. The three triggers each watch a different per-house counter:

| Perk | Trigger (spec §3 line 507-509) | Counter | Counter changes at |
|---|---|---|---|
| **Patronage** | 3 consecutive heirs survive to **natural** death (not duel, not assassination) | `consecutiveHeirsNaturalDeath` (resets on violent head death) | aging (increment), assassination/duel (reset) |
| **Seduction** | 4 cumulative **successful** Seduction completions across all generations | `cumulativeSuccessfulSeductions` (monotonic) | `resolveSeduction` Completed branch |
| **Whispers** | fixed cumulative total of whispers reach **Weaponized** across all generations | `cumulativeWeaponizedWhispers` (monotonic) | `tryWeaponizeWhisper` branch helpers |

The effects each modulate an existing rule (RNG-free except the Whispers intercept):

| Perk | Effect (spec §3 line 510) | Applied at |
|---|---|---|
| **Patronage** | multiplies the rural-estate yield | `applyLocationEffectsPhase` (Country wealth delta) |
| **Seduction** | + fixed positive base on Seduction outcomes AND halves discovery-scandal | `resolveSeduction` (both branches) |
| **Whispers** | halves whisper verification time AND adds inbound-intercept probability | `applyWhisperVerificationPhase` (2× rate) + new conditional courier-phase intercept draw |

---

## Resolved design decisions

These resolve genuine spec ambiguities and underspecified mechanics. Each is a judgment call the `/converge-plan` review should stress-test; the rationale + rejected alternatives are recorded so a reader can re-litigate from first principles.

### D1 — Going-forward-only is enforced by stored counters that seed to ZERO on migration (resolves §10 OQ #22).

OQ #22 default is **"going-forward only"** — "avoids a one-time perk-explosion on the first load after this phase ships." This decision is **load-bearing for the counter-vs-derive choice**, not a cosmetic preference:

- A **derive-at-eval** design (count `state.schemes` Completed-Seductions + count `state.whispers` Weaponized at eval time) would, on the first load of a migrated v13 save, immediately read pre-existing on-disk Completed seductions / Weaponized whispers and award perks **retroactively** — the exact "perk explosion" OQ #22 forbids.
- Therefore P15 uses **explicit stored counters** on the `House`, all seeded to `0` on fresh state AND on every legacy lift / migration. A pre-perk campaign migrates with zeroed counters → zero retroactive awards → going-forward-only is automatic. Counters increment only at post-P15 mutation events.

This also decouples perk logic from scheme/whisper **retention policy** (whether Completed schemes or Weaponized whispers are ever pruned) — the counter is the source of truth, not the derivable collection.

### D2 — Patronage's "events hosted at the rural estate" maps to the Country-location wealth yield.

Spec §3 line 510: "the patronage perk multiplies events hosted at the rural estate." **There is no distinct "host an event" action in v1.** The only rural-estate mechanic is the `Country` location's per-tick wealth gain (`LOCATION_DELTAS.Country = { wealth: 1, ... }` at `src/game/constants.ts:48`; the location is described as "Your rural estate. Rents accumulate…" at `src/game/fixtures/locations.ts:79`). The v1-faithful mapping: **the Patronage perk boosts the positive Country wealth delta while the player house resides at the `Country` location** — `Math.round(delta.wealth × PATRONAGE_PERK_RURAL_ESTATE_MULTIPLIER) + PATRONAGE_PERK_RURAL_ESTATE_FLAT_BONUS` — applied in `applyLocationEffectsPhase` (`src/game/rules/locationEffects.ts:52`). This is a strategic perk — only active while the player chooses to reside at the estate.

**Magnitude resolved (user decision):** a bare `2.0×` of the `yield: 1` Country delta is only +1 wealth/tick — economically trivial for a 3-generation milestone. The perk uses a **larger multiplier (`5.0×`) PLUS a flat per-tick bonus (`+3`)** so it is worth earning (`Math.round(1 × 5) + 3 = +8/tick` while resident, vs the +1/tick baseline). Both magnitudes are designer-tunable in playtest.

Rejected alternatives: (a) a reputation boost — the Country yields `reputation: 0`; "events" building social standing happen at the `Capital` (`reputation: 1`), but the spec explicitly says *rural estate*; (b) a new dedicated event-hosting action — out of v1 scope, a v1.5 candidate.

### D3 — Perk *award evaluation* runs in TWO terminal slots; it is RNG-free, so it may follow the rival phase.

Spec §7 line 656: "Perks are evaluated at the end of every tick after all per-tick rolls have resolved; succession-driven perks must compute against the post-succession house state." This forces TWO evaluation sites because counters change on two different clocks:

1. **Terminal tick phase** — `evaluateDynastyPerks` appended at PHASES slot 15, AFTER `applyRivalActionPhase` (slot 14). Covers same-tick seduction completions (scheme resolution is slot 5).
2. **Terminal year-pass step** — `evaluateDynastyPerks` appended at year-pass STEPS slot 6, AFTER `applyConceptionStep` (slot 5). Runs against fully post-succession state (succession is slot 3) → satisfies the §7 "post-succession state" clause structurally.

**Tension with "rivals always run last" (CLAUDE.md non-negotiable + P11 pin).** That rule protects the **RNG draw stream**: rivals run last so their draws cannot perturb earlier seeded outcomes. `evaluateDynastyPerks` **consumes zero RNG** (a pure milestone check + award-list push). An RNG-free phase appended after rivals cannot perturb any seeded outcome — the draw-count stream up through the rival phase is byte-identical whether or not it runs. The rule is therefore refined (CLAUDE.md amendment at close-out): **"rivals always run last among RNG-consuming phases; the RNG-free `evaluateDynastyPerks` is the sole phase permitted after rivals, precisely because it draws no RNG."** This is the same reasoning used to insert non-rival phases at slots 9-13 (P8-P11) without disturbing the seeded stream — extended here to the terminal position.

The same `evaluateDynastyPerks(state): GameState` function is referenced in BOTH the PHASES and STEPS arrays (identical `(GameState) => GameState` signature). One function, two array slots; the phase-order tracker test identifies it by function-reference identity in each.

### D4 — Counters mutate at the death/event sites (cause is known there); evaluation only READS.

The patronage counter is path-dependent (a violent death breaks the streak). Rather than persist a cause-of-death field on `Character` (heavy; no such field exists — only `diedAtTick` at `src/game/entities.ts:193`), the counter is updated **at each death site, which inherently knows the cause** (CLAUDE.md "clamp at every mutation site" discipline):

- **Natural death** → `applyAgingStep` (`src/game/rules/aging.ts:387`) is the only natural-death site. When the just-died character is the *pre-succession* player head, increment `consecutiveHeirsNaturalDeath`.
- **Violent death** → `resolveAssassination` (`src/game/rules/schemes.ts:662`) kills `targetId`; `resolveDuel` (`src/game/rules/duel.ts:151`) kills `loserId`. When the killed character is the player head, reset `consecutiveHeirsNaturalDeath = 0`.

`evaluateDynastyPerks` never mutates a counter — it only reads counters and pushes award entries. This keeps the two terminal-slot calls pure idempotent reads.

### D5 — Whisper-perk effect determinants (offensive = player-sourced; defensive = player-subject).

The spec's two Whisper effects split by direction, which P15 makes concrete:

- **"Halves whisper verification time"** (offensive) → the player house's *own* intelligence verifies faster. Determinant: whispers whose `sourceCharacterId` resolves to a **player-house** character get a **2× per-tick increment** in `applyWhisperVerificationPhase` when the player holds the perk.
- **"Adds … intercepting inbound whispers about the player house"** (defensive) → damaging whispers rivals circulate *about* the player get intercepted. Determinant: the predicate **mirrors `trySpymasterMailIntercept`'s 4-predicate filter** (`InFlight` + inbound + `interceptable` + `destinationHouseId === PLAYER_HOUSE_ID`, per `src/game/rules/staff.ts:290-300`) PLUS a **subject-is-player-house** clause. The subject clause is **load-bearing, not optional**: without it the automatic intercept would also grab the player's own returning intel (inbound couriers whose subject is a *non-player* character), hurting the player. With it, only whispers *about* the player house are intercepted.

Flag for review: the source-based verification determinant is the most-underspecified piece; an alternative reading (double the rate for ALL whispers the player is verifying, regardless of source) is simpler but less defensible.

### D6 — Whisper-perk threshold = 5 (a chosen "fixed total").

Spec line 509 says "a cumulative fixed total" without a number. `WHISPERS_PERK_CUMULATIVE_WEAPONIZED = 5` is chosen (one above the Seduction perk's 4, reflecting that weaponization is a multi-step investment). Designer-tunable; pinned by a module-load positive-integer guard.

---

## In scope

### 1. Save format bump v13 → v14

**`SAVE_VERSION_CURRENT` bumps `13` → `14`** at `src/persist/schema.ts:77`.

**New enum + entity schema** (`src/game/constants.ts` + `src/game/entities.ts`). `DynastyPerkAward` matches spec §4 line 560 ("A perk enum, the awarded-at tick, the awarded-during-generation marker"):

```ts
// src/game/constants.ts (P15 — in the new block; drives the entity enum + UI labels):
export const DYNASTY_PERK_KINDS = ["Patronage", "Seduction", "Whispers"] as const;
export type DynastyPerkKind = (typeof DYNASTY_PERK_KINDS)[number];
// Module-load cardinality guard (mirrors TACTICS.length at constants.ts:157):
if (DYNASTY_PERK_KINDS.length !== 3) {
  throw new Error("DYNASTY_PERK_KINDS must have exactly 3 entries; bump SAVE_VERSION on change.");
}

// src/game/entities.ts (P15 ADDITION, alongside the P11 entity schemas):
export const DynastyPerkAwardSchema = z.object({
  perk: z.enum(DYNASTY_PERK_KINDS),
  awardedAtTick: z.number().int().nonnegative(),
  awardedDuringGeneration: z.number().int().nonnegative(), // snapshot of House.generation at award (POST-succession per §7)
});
export type DynastyPerkAward = z.infer<typeof DynastyPerkAwardSchema>;
```

No branded ID — a perk is keyed by its enum `kind` (at most one award per kind per house), not an entity needing an id factory.

**Four new `House` fields** (`src/game/entities.ts`, appended after `courierResearchEarned` at line 179). All use Zod `.default(...)` per the P8/P11/P13 backward-compat shortcut, so legacy V1-V13 saves parse cleanly. **All seed to `0` / `[]` on fresh state AND every legacy lift → going-forward-only (D1):**

```ts
  // P15: Dynasty Legacies. Player house owns all four; non-player houses default
  // empty/0 and never increment (every mutation site gates on PLAYER_HOUSE_ID).
  // awardedDynastyPerks is the spec §4 line 541 "list of awarded dynasty perks".
  // The three counters seed to 0 on migration → no retroactive awards (§10 OQ#22).
  awardedDynastyPerks: z.array(DynastyPerkAwardSchema).default([]),
  consecutiveHeirsNaturalDeath: z.number().int().nonnegative().default(0),
  cumulativeSuccessfulSeductions: z.number().int().nonnegative().default(0),
  cumulativeWeaponizedWhispers: z.number().int().nonnegative().default(0),
```

**No new top-level `GameState` fields.** The four fields ride the existing `houses` Map serialization (`serializeRegistry<HouseId, House>`) and the existing `houses`-key hash projection. Per the P11 precedent (House `hostility`/`factionId`) and verified against the trip-wire tests, the top-level **schema↔projection↔selector↔overwriteFromGameState quad-sync does NOT change**: `hashable-state-extension.test.ts:12-14` and `schema-projection-selector-extension.test.ts:17-21` compare `Object.keys(GameStateSchema.shape)` (top-level keys only — they never recurse into `HouseSchema.shape`). `overwriteFromGameState` writes the whole `draft.houses = next.houses` Map, so the new sub-fields ride along. **Both trip-wires stay green untouched** — do NOT edit them.

### 2. Strip-on-emit cascade for legacy emitters (mirrors P13's V12 treatment)

The single fact that shapes this: **`SaveV13Schema.houses` currently references the LIVE `HouseSchema` directly** (`src/persist/schema.ts:1909`), exactly as `SaveV12` referenced live `HouseSchema` before P13 demoted it. When the live `HouseSchema` widens, `SaveV13Schema` would silently start including the four P15 fields. P15 demotes V13 to a Pre-schema, identically to how P13 introduced `HousePreV13Schema`:

- **New `HousePreV14Schema`** (analog of `HousePreV13Schema` at `:328-330`):
  ```ts
  const HousePreV14Schema = HouseSchema.omit({
    awardedDynastyPerks: true,
    consecutiveHeirsNaturalDeath: true,
    cumulativeSuccessfulSeductions: true,
    cumulativeWeaponizedWhispers: true,
  });
  type HousePreV14 = z.infer<typeof HousePreV14Schema>;
  ```
- **Swap `SaveV13Schema.houses`** (`:1909`) from `HouseSchema` → `HousePreV14Schema`. Without this, V13 and V14 become Zod-identical post-widening and a v13 save round-trips with v14 fields silently injected by `.default()`.
- **New `stripP15FieldsForLegacyEmit`** (analog of `stripCourierResearchForLegacyEmit` at `:333-340`) — drops the four new fields; called in `toSaveV13` (`:1944`, which currently emits the live shape with no strip).
- **Widen the FIVE existing House field-strip helper destructures** to also drop the four new fields (the same one-line-per-helper extension P13 made for `courierResearchEarned`): `stripGrievancesForLegacyEmit` (`:220`), `stripV6FieldsForLegacyEmit` (`:240`), `stripExiledForLegacyEmit` (`:268`), `stripP11FieldsForLegacyEmit` (`:308`), `stripCourierResearchForLegacyEmit` (`:333`). (`stripBloodFeudGrievancesForLegacyEmit` filters grievances, not House fields — no edit.)
- **Widen the FIVE House-building lift helpers** to append the four new fields as `0`/`[]` (the same P13 move that appended `courierResearchEarned: false`): `defaultHouseV4Fields` (`:97`), `defaultHouseV6Fields` (`:148`), `defaultHouseV7Fields` (`:189`), `liftLegacyHousesFromV12Pre11` (`:345`), `liftHousesFromPreV13` (`:1841`). These build `House` objects literally (not via Zod parse), so the `.default()` backfill doesn't reach them — explicit append is required.
- **Split `fromSaveV13`** (`:1973-2012`, currently unsplit since V13 had no migration target) into `fromSaveV13Bare` + public `fromSaveV13`. **Note the structural refactor required:** the current `fromSaveV13` does NOT match the `fromSaveV12Bare` shape — it extracts `characters` + `artifactInstances` into locals and mutates them via an **inline `bootstrapNpcMountFamily(characters, artifactInstances, save.tick)` call (`:1974-1978`)** before building the `GameState` literal. The split must **remove that interleave** to match V12's actual structure (`fromSaveV12Bare` `:1851-1888` builds the literal with NO bootstrap call; public `fromSaveV12` `:1893-1897` calls `bootstrapNpcMountFamily(bare.characters, bare.artifactInstances, …)` AFTER Bare returns). So: `fromSaveV13Bare` deserializes `characters`/`artifactInstances` fresh + applies `liftHousesFromPreV14` + returns the full `GameState` literal **without** the bootstrap mutation; public `fromSaveV13` = `const bare = fromSaveV13Bare(save); bootstrapNpcMountFamily(bare.characters, bare.artifactInstances, save.tick); return bare;`. Copying V12's shape literally is correct ONLY if the inline interleave is removed (not preserved). Add a `liftHousesFromPreV14` helper (analog of `liftHousesFromPreV13` at `:1841`) appending the four new fields as `0`/`[]`.
- **New live `SaveV14Schema` + `toSaveV14` + `fromSaveV14`.** `SaveV14Schema` is the same shape as `SaveV13Schema` but its `houses` tuple references the LIVE `HouseSchema` (includes the four new fields); `toSaveV14` emits `houses: serializeRegistry(state.houses)` with NO strip; `fromSaveV14` is the live load path referencing `SAVE_VERSION_CURRENT`.

### 3. `migrate_v13_to_v14`

Pure `(SaveV13) → SaveV14` at `src/persist/migrations/v13-to-v14.ts`. Mirrors `v12-to-v13.ts` exactly (a one-liner):

```ts
// src/persist/migrations/v13-to-v14.ts (NEW at P15):
// Draw budget: ZERO — pure shape transformation. The four new House fields seed
// empty/0 via the Zod .default(...) on HouseSchema + the explicit liftHousesFromPreV14
// append (defense-in-depth). Empty seeding is the §10 OQ#22 going-forward-only contract.
import { type SaveV13, type SaveV14, fromSaveV13Bare, toSaveV14 } from "../schema";

export function migrate_v13_to_v14(save: SaveV13): SaveV14 {
  return toSaveV14(fromSaveV13Bare(save));
}
```

- **`MIGRATIONS` registry** (`src/persist/migrations/index.ts`): append `{ from: 13, to: 14, migrate: (s) => migrate_v13_to_v14(SaveV13Schema.parse(s)), outputSchema: SaveV14Schema }` after the `from:12,to:13` entry (`:115-120`); add the `migrate_v13_to_v14` import + `SaveV14Schema` to the schema import block. `assertMonotonic(MIGRATIONS)` (`:123`) runs at module load.
- **`fromSaveV1`..`fromSaveV12` public wrappers** need no per-wrapper edit — the shared lift-helper appends (above) cover them.

### 3a. Live-version consumer swaps (dexie / UI / tests) — REQUIRED, easily missed

Bumping `SAVE_VERSION_CURRENT` + adding `SaveV14Schema`/`toSaveV14`/`fromSaveV14` is inert unless the LIVE emitter/loader/UI callers are repointed off the now-demoted V13 symbols. **This is a silent-strip trap, not a crash:** once `SaveV13Schema.houses` is demoted to `HousePreV14Schema` (§2) and `SAVE_VERSION_CURRENT === 14`, a freshly-saved v14 record hits the unedited `observedVersion === SAVE_VERSION_CURRENT` branch at `src/persist/dexie.ts:112-114` which parses against `SaveV13Schema` — which now **strips the four new House fields on every save/load cycle**. The round-trip succeeds silently; perks never persist. Verified live-version consumers that MUST move v13→v14:

- **`src/persist/dexie.ts`** (the live save/load module): import block `:26-28` (`type SaveV13`, `SaveV13Schema`, `toSaveV13` → add the V14 symbols); the `Data` union `:56` (`| SaveV13` → `| SaveV14`); the live emitter `:80` (`const data = toSaveV13(state)` → `toSaveV14(state)`); `load(): Promise<SaveV13 | undefined>` `:92` → `Promise<SaveV14 | undefined>`; the current-version branch `:114` (`return SaveV13Schema.parse(raw)` → `SaveV14Schema.parse(raw)`) AND the post-migration branch `:122` (`return SaveV13Schema.parse(migrated)` → `SaveV14Schema.parse(migrated)`). `SAVE_VERSION_CURRENT` is already imported (`:13`); its value bumps in `schema.ts`.
- **`src/ui/shared/SettingsMenu.tsx`**: `import { fromSaveV13 }` `:5` → `fromSaveV14`; `replaceState(fromSaveV13(saved))` `:45` → `fromSaveV14(saved)`.
- **`src/persist/save-roundtrip.test.ts`**: `:12` import + `:37` `replaceState(fromSaveV13(loaded))` → `fromSaveV14`.
- **`src/persist/dexie.test.ts`**: the "current-version malformed" test (`:57-62`) drives the current-version path via a `version: 13` data literal (`:62`) + a `SaveV13Schema` mention in a comment (`:59`) — there is no imported `SaveV13Schema` symbol to swap here. The edit is: bump the `version: 13` literal to `14` and update the comment text (so the malformed-current-version case still exercises the `SaveV14Schema.parse` → `InvalidSaveSchemaError` path).

This mirrors what P13 did when it made `toSaveV13`/`fromSaveV13` the live pair (the dexie/UI/test repoint is part of every save-bump, not optional). Grep `fromSaveV13|toSaveV13|SaveV13Schema|Promise<SaveV13>` across `src/` (excluding `schema.ts` + `migrations/`) at implementation time to confirm the full consumer set.

### 4. Designer constants block

Append a "P15 Dynasty Legacies" block at EOF (`src/game/constants.ts:911+`), banner-bar style (P11 precedent at `:717`), with per-constant spec-line proximity comments and a trailing module-load assertion divider (range/positive-integer guards mirroring `:814-828`):

```ts
// ============================================================================
// P15 — Dynasty Legacies & Renown Perks
// plans/phases/15-dynasty-legacies.md  (spec §3 lines 507-510, §7 line 656)
// ============================================================================

// --- Triggers (spec §3 lines 507-509) ---
export const PATRONAGE_PERK_CONSECUTIVE_NATURAL_DEATHS = 3;
export const SEDUCTION_PERK_CUMULATIVE_SUCCESSES = 4;
export const WHISPERS_PERK_CUMULATIVE_WEAPONIZED = 5; // "fixed total" — see plan D6

// --- Effects (spec §3 line 510) ---
/** Patronage: multiplies the positive Country-location wealth yield (plan D2). */
export const PATRONAGE_PERK_RURAL_ESTATE_MULTIPLIER = 5.0;
/** Patronage: flat extra wealth/tick added on top of the multiplied yield while
 *  resident at Country with the perk (plan D2 — makes a 3-generation milestone
 *  reward economically meaningful, not the marginal +1/tick of a bare 2× of yield:1). */
export const PATRONAGE_PERK_RURAL_ESTATE_FLAT_BONUS = 3;
/** Seduction: fixed positive base added to the success affection delta. */
export const SEDUCTION_PERK_AFFECTION_BASE_BONUS = 15;
/** Seduction: halves discovery-scandal (applied to the already-selected delta). */
export const SEDUCTION_PERK_DISCOVERY_SCANDAL_MULTIPLIER = 0.5;
/** Whispers: doubles the per-tick verification increment for player-sourced whispers. */
export const WHISPERS_PERK_VERIFICATION_MULTIPLIER = 2.0;
/** Whispers: per-courier auto-intercept probability on inbound whispers about the player house. */
export const WHISPERS_PERK_INBOUND_INTERCEPT_PROBABILITY = 0.15;

// --- Module-load assertions ---
if (PATRONAGE_PERK_CONSECUTIVE_NATURAL_DEATHS <= 0) throw new Error("...");
if (SEDUCTION_PERK_CUMULATIVE_SUCCESSES <= 0) throw new Error("...");
if (WHISPERS_PERK_CUMULATIVE_WEAPONIZED <= 0) throw new Error("...");
if (PATRONAGE_PERK_RURAL_ESTATE_MULTIPLIER <= 1) throw new Error("...");
if (PATRONAGE_PERK_RURAL_ESTATE_FLAT_BONUS <= 0) throw new Error("...");
if (SEDUCTION_PERK_DISCOVERY_SCANDAL_MULTIPLIER <= 0 || SEDUCTION_PERK_DISCOVERY_SCANDAL_MULTIPLIER >= 1) throw new Error("...");
if (WHISPERS_PERK_VERIFICATION_MULTIPLIER <= 1) throw new Error("...");
if (WHISPERS_PERK_INBOUND_INTERCEPT_PROBABILITY <= 0 || WHISPERS_PERK_INBOUND_INTERCEPT_PROBABILITY >= 1) throw new Error("...");
```

### 5. Rules module `src/game/rules/dynastyLegacies.ts` (NEW)

Pure module (boundary-clean: imports only `constants`, `entities` types, `rng` for `PLAYER_HOUSE_ID`, other rules). **Pin: `import type { GameState } from "../entities"`** (as `locationEffects.ts:23` does), NOT `from "../store"`. The cited P11 siblings `inheritedSecrets.ts:38` and `siblingRivals.ts:42` import `GameState` from `../store` — that IS the known 2-error `lint:boundaries` baseline (P14 carve-out). Copying their import verbatim would introduce a THIRD boundary error and break the exactly-2-error gate this phase's Verification depends on. Exports:

- **`evaluateDynastyPerks(state: GameState): GameState`** — the idempotent award function used at BOTH terminal slots (D3). Reads the player house; for each not-yet-awarded perk whose trigger is met, pushes a `DynastyPerkAward`. RNG-free. Returns input unchanged when nothing awards (so it's harmless on every wrapper).
  ```ts
  export function evaluateDynastyPerks(state: GameState): GameState {
    const house = state.houses.get(PLAYER_HOUSE_ID);
    if (house === undefined) return state;
    const have = new Set(house.awardedDynastyPerks.map((a) => a.perk));
    const toAward: DynastyPerkKind[] = [];
    if (!have.has("Patronage") && house.consecutiveHeirsNaturalDeath >= PATRONAGE_PERK_CONSECUTIVE_NATURAL_DEATHS) toAward.push("Patronage");
    if (!have.has("Seduction") && house.cumulativeSuccessfulSeductions >= SEDUCTION_PERK_CUMULATIVE_SUCCESSES) toAward.push("Seduction");
    if (!have.has("Whispers") && house.cumulativeWeaponizedWhispers >= WHISPERS_PERK_CUMULATIVE_WEAPONIZED) toAward.push("Whispers");
    if (toAward.length === 0) return state;
    const awarded = [
      ...house.awardedDynastyPerks,
      ...toAward.map((perk) => ({ perk, awardedAtTick: state.tick, awardedDuringGeneration: house.generation })),
    ];
    const houses = new Map(state.houses);
    houses.set(PLAYER_HOUSE_ID, { ...house, awardedDynastyPerks: awarded });
    return { ...state, houses };
  }
  ```
  (Deterministic award order: Patronage → Seduction → Whispers, the `DYNASTY_PERK_KINDS` order — matters only if multiple cross threshold in one tick, which is possible but rare.)
- **`hasDynastyPerk(state, perk): boolean`** — convenience predicate the effect sites call (`applyLocationEffectsPhase`, `resolveSeduction`, `applyWhisperVerificationPhase`, the intercept step) to read whether the player house holds a perk. Single source of truth for the read.
- **`recordPlayerHeadNaturalDeath(state, deadCharIds: ReadonlySet<CharacterId>): GameState`** — increments `consecutiveHeirsNaturalDeath` iff the *pre-succession* player head id is in `deadCharIds`. Called by `applyAgingStep` AFTER its `pruneOrphanedConversationKeys` call (operates on post-prune state — no clone-clobber).
- **`recordPlayerHeadViolentDeath(state, killedCharId: CharacterId): GameState`** — resets `consecutiveHeirsNaturalDeath = 0` iff `killedCharId === playerHouse.headOfHouseCharacterId`. Called by `resolveAssassination` + `resolveDuel`.

### 6. Counter mutation sites (D4)

- **`applyAgingStep`** (`src/game/rules/aging.ts`): the function currently ends `return pruneOrphanedConversationKeys({ ...state, characters }, newlyDead)`. Change to capture the result, then apply the natural-death increment on top: `const pruned = pruneOrphanedConversationKeys(...); return recordPlayerHeadNaturalDeath(pruned, newlyDead);`. Reading the head from the *pre-succession* `state.houses` is correct — aging is STEPS slot 1, succession is slot 3, so the head id is still the dying head.
- **`resolveAssassination`** (`src/game/rules/schemes.ts:650-680`): the function assembles `newHouses` (owner-scandal bump at `:665-669`) and rebuilds state INLINE as `pruneOrphanedConversationKeys({ ...state, characters: newCharacters, houses: newHouses }, …)` at `:676-679`. **A literal `recordPlayerHeadViolentDeath(state, targetId)` is silently discarded** by that inline rebuild (it derives `newHouses` from the original `state.houses`, not from the helper's output — the same silent-no-op class as B1). The reset MUST compose into the state that flows into prune: thread it as `const afterReset = recordPlayerHeadViolentDeath({ ...state, characters: newCharacters, houses: newHouses }, targetId); const afterPrune = pruneOrphanedConversationKeys(afterReset, new Set([targetId]));`. The reset writes the *player-house* entry while the owner-scandal write targets the *assassin's* house entry — independent `set`s, so they compose cleanly. Add `import { PLAYER_HOUSE_ID } from "../rng"`.
- **`resolveDuel`** (`src/game/rules/duel.ts:148-160`): inside the `loserCasualty === "Killed"` branch, **assign the result back** — `workingState = recordPlayerHeadViolentDeath(workingState, loserId)` — since `workingState` is the threaded base for the subsequent prune + return (a bare un-assigned call would be discarded). Add the `PLAYER_HOUSE_ID` import.
- **`resolveSeduction`** (`src/game/rules/schemes.ts:577-599`): in the not-discovered Completed branch, when `scheme.ownerHouseId === PLAYER_HOUSE_ID`, increment `cumulativeSuccessfulSeductions` on the player house. **The success branch writes `affectionMap` ONLY (`stateWithAffection = { ...baseState, affectionMap: newAffection }` at `:598`) — there is NO existing `houses` clone to reuse, so add a FRESH `new Map(state.houses)` clone for the counter write.** Gate to player-owned: rival-owned Seductions (P8) neither count nor get effects.
- **`tryWeaponizeWhisper`** branch helpers (`src/game/rules/whispers.ts:303/341/357`): each branch flips status to `Weaponized`. Increment `cumulativeWeaponizedWhispers` per weaponization regardless of branch. **Compose carefully with each branch's existing house writes:** Blackmail/ScandalSheet already clone `state.houses` and write the owner entry (scandal/reputation) — the counter increment must read the POST-write entry (`newHouses.get(ownerHouseId) ?? owner`, mirroring `whispers.ts:337`) and re-set it, NOT the stale pre-write `owner` (which would clobber the just-written scandal/exiled state). **`resolveAccidentalSlip` (`:357`) does NOT clone houses at all — add a fresh `new Map(state.houses)` clone there.** (At v1 `ownerHouseId` is always `PLAYER_HOUSE_ID`; gate defensively but increment on `ownerHouseId`.)

### 7. Perk effect application sites

- **Patronage** — `applyLocationEffectsPhase` (`src/game/rules/locationEffects.ts:52`, the `let wealth = house.wealth + delta.wealth` line; `:51` is the `LOCATION_DELTAS` read): replace `let wealth = house.wealth + delta.wealth` so that when `house.currentLocation === "Country"` AND `hasDynastyPerk(state, "Patronage")`, the positive Country delta is boosted by the multiplier AND the flat bonus: `const yield_ = (delta.wealth > 0 && atCountry && hasPatronage) ? Math.round(delta.wealth * PATRONAGE_PERK_RURAL_ESTATE_MULTIPLIER) + PATRONAGE_PERK_RURAL_ESTATE_FLAT_BONUS : delta.wealth`. RNG-free; clamps unchanged.
- **Seduction base bonus** — `resolveSeduction` success branch (`:590-592`): when player-owned AND `hasDynastyPerk(state, "Seduction")`, add the base before the WarEffort multiplier: `finalDelta = Math.round((SEDUCTION_AFFECTION_DELTA_ON_SUCCESS + perkBonus) * seductionMultiplier)` where `perkBonus = hasSeductionPerk ? SEDUCTION_PERK_AFFECTION_BASE_BONUS : 0`. "Fixed positive base" → modifies the base, then scales (documented order).
- **Seduction discovery-scandal halving** — `resolveSeduction` discovery branch (`src/game/rules/schemes.ts:543-574`). **The `scandalDelta` local is NOT written to any Map at the cited lines — it is passed as the third argument into `startElopementSprintFromDiscoveredSeduction(baseState, scheme, scandalDelta)` at `:569-573`, which applies the scandal internally as part of the P9 sprint mount (`src/game/rules/elopement.ts:76`).** So the halving must be applied to that argument, NOT to a standalone scandal write (which does not exist): when player-owned AND `hasDynastyPerk(state, "Seduction")`, pass `Math.round(scandalDelta * SEDUCTION_PERK_DISCOVERY_SCANDAL_MULTIPLIER)` as the third arg instead of `scandalDelta`. This composes with the temptation discount (halves whichever delta was selected at `:559-562`). Editing a phantom standalone write at `:559-562` would silently no-op.
- **Whispers verification 2×** — `applyWhisperVerificationPhase` (`src/game/rules/whispers.ts:198`): when `hasDynastyPerk(state, "Whispers")` AND the whisper is player-sourced (D5), use `WHISPER_VERIFICATION_PER_TICK * WHISPERS_PERK_VERIFICATION_MULTIPLIER` as the increment. **The player-sourced check is a per-whisper one-hop resolve the loop does NOT do today: `state.characters.get(w.sourceCharacterId)?.houseId === PLAYER_HOUSE_ID`** — add it inside the existing `for` loop (`:194-203`); it requires threading `state.characters` (already on `state`). RNG-free.
- **Whispers inbound-intercept** — NEW conditional draw (D5). A new sub-step `applyWhispersPerkInterceptStep(state): GameState` composed **between `applyWhisperVerificationPhase` and `applyCourierDrainStep`** in `applyCourierAndStaffPhase` (`src/game/rules/courier.ts:69-72` runs the fixed order verify (`:70`) → drain (`:71`) → staff (`:72`); the composer comment at `:61-68` documents why verify must run first). The composer becomes `verify → intercept → drain → staff`: `const afterVerify = applyWhisperVerificationPhase(state); const afterIntercept = applyWhispersPerkInterceptStep(afterVerify); const afterDrain = applyCourierDrainStep(afterIntercept);` then staff. (Running before drain keeps intercepted couriers from delivering this tick; it must still run AFTER verify per the `courier.ts:61-68` ordering comment.) `applyWhispersPerkInterceptStep` is gated: returns input unchanged (ZERO draws) when `!hasDynastyPerk(state, "Whispers")`. When held, walk lex-sorted `state.couriers`; a courier matches when `status === "InFlight"` AND inbound AND `interceptable === true` AND `destinationHouseId === PLAYER_HOUSE_ID` (the `trySpymasterMailIntercept` 4-predicate filter at `staff.ts:296-303`) AND the **subject-resolve two-hop** holds: `state.whispers.get(courier.whisperId)?.subjectCharacterId` → `state.characters.get(thatId)?.houseId === PLAYER_HOUSE_ID`. For each match, draw ONE player-RNG value; if `< WHISPERS_PERK_INBOUND_INTERCEPT_PROBABILITY`, **write ONLY the courier** — `{ ...courier, status: "Intercepted", resolvedAtTick: afterVerify.tick }` (exactly what `trySpymasterMailIntercept` does at `staff.ts:318`). The whisper is NOT mutated: its `arrivedAtTick` stays `null` naturally because an intercepted courier never drains — do not add a whisper write. One draw per matching courier (conditional — P10 forgery-roll precedent, NOT P13's unconditional draw).

### 8. Tick phase + year-pass step wiring (D3)

- **`src/runtime/tickOrchestrator.ts`**: append `evaluateDynastyPerks` as PHASES slot 15 (after `applyRivalActionPhase` at slot 14). Update the `// PHASES count stays at 14` comment (`:45`) to 15 and document the "RNG-free phase after rivals" rationale inline.
- **`src/runtime/yearPass.ts`**: append `evaluateDynastyPerks` as STEPS slot 6 (after `applyConceptionStep` at slot 5) in the `runYearPassPure` STEPS array (`:51-57`).

### 9. Event module + publisher (12/12/10)

- **New `src/runtime/events/dynastyLegacy.ts`** modeled on `siblingRival.ts`: a `dynastyLegacyBus = new EventBus<DynastyLegacyEvent>()` with one variant `{ kind: "DynastyPerkAwarded"; tick: number; perk: DynastyPerkKind; generation: number }`, plus `publishDynastyPerkAwards(before, after): void` — diffs `before`/`after` player-house `awardedDynastyPerks` by `perk` set; publishes one event per newly-added perk. Module-level `EMPTY_KEYS` not needed (no wrapper direct-publishes perk awards — all awards flow through the diff helper).
- **Store wrapper fan-out** (`src/game/store.ts`): insert `publishDynastyPerkAwards(before, after)` into all NINE tick-advancing wrapper sites — `proposeMarriage` (group a, 1 site); `advanceTick` + `travel` + `requestAudience` + `escapeBankruptcy` + `refreshWardrobe` + `reconcileSibling` + `exitPromenade` (group b, 7 sites); **AND `runYearPass` (group c, 1 site)** = 9 sites (grep-confirmable against the structural twin `publishBloodFeudTransitions`, which fires at exactly these 9 sites). Unlike `publishGlobalEventTransitions` (which skips `runYearPass`), this MUST ride `runYearPass` because the Patronage perk awards at the year-pass terminal step. New publisher pin: **12/12/10**. Add the `{ dynastyLegacyBus, publishDynastyPerkAwards }` import near `:416-435`. The helper is safe (zero events) on wrappers where no perk can change.

### 10. UI — new "Dynasty" Ledger tab (read-only)

New tab (P14 decomposition discipline — there is no existing house-summary tab; `ancestorSummary` is currently unsurfaced). Three coordinated edits in `src/ui/ledger/LedgerView.tsx`: add `"dynasty"` to the `TabKey` union (`:23-31`), the `TABS` array (`:33-42`), and the panel switch (`:80-87`). New `src/ui/ledger/tabs/DynastyTab.tsx` reads the player house via `store(useShallow((s) => ({ houses: s.houses, tick: s.tick })))` (FamilyTreeTab pattern at `:61-72`), imports `PLAYER_HOUSE_ID` from `../../../game/rng.seeds` (P14 boundary rule (b)), and renders: the three awarded perks (with awarded-at-tick + generation) and the three progress counters as "X / threshold" toward each unearned perk. Add a `DynastyPerkAwarded` toast/log subscriber via `useBusEvent(dynastyLegacyBus, "DynastyPerkAwarded", …)` if a notification surface exists. Extend `src/ui/ledger/tabs/tabs.smoke.test.tsx` with the new tab case. Pure rendering values (if any) live in `src/ui/ledger/` per the P14 UI-local-constants rule, NOT `constants.ts`.

---

## Out of scope

- **Retroactive awards for pre-perk campaigns** (§10 OQ #22 — DEFAULT: NO; enforced structurally by D1's zero-seeded counters).
- **A distinct "host an event at the rural estate" action** — the Patronage effect rides the existing Country wealth yield (D2). A bespoke event-hosting affordance is a v1.5 candidate.
- **Perks for rival houses** — dynasty legacies are player-house-only; every counter/effect gates on `PLAYER_HOUSE_ID`.
- **Per-family / per-location patronage tuning** — single multiplier on the Country yield.
- **Whisper-perk award inside the `weaponizeWhisper` free action** — the counter increments there, but the award lands at the next tick's terminal phase (spec §7 "evaluated at the end of every tick"). Immediate free-action award is a considered-and-rejected alternative (adds a 9th publisher call site + couples the whisper wrapper to perk eval for a ≤1-tick UX gain).

## Machines

None. Perks are one-way latches on a `House` array, not a state machine (no XState actor). Mirrors P11's choice to model sibling-rival/secret state as entity fields rather than actors.

## Edge cases (§7)

- **"Dynasty perk award during the same tick as succession"** (§7 line 656) → handled structurally by D3: the year-pass terminal step (slot 6) runs AFTER succession (slot 3) + conception (slot 5), so `evaluateDynastyPerks` reads post-succession `house.generation` + `headOfHouseCharacterId`. `awardedDuringGeneration` snapshots the post-succession generation.
- **Heirless succession on the 3rd natural death** → the patronage counter still increments in aging, but if the house goes `heirless` at succession the perk award is moot (dynasty ended). Awarding to a terminal dynasty is harmless (idempotent push; never read again). No special-casing.
- **Player head violently killed mid-tick** → `recordPlayerHeadViolentDeath` resets the counter at the kill site (tick phase); the terminal tick-phase `evaluateDynastyPerks` (slot 15) then sees the reset counter and does NOT award Patronage that tick.
- **Two counters cross threshold in one tick** → `evaluateDynastyPerks` awards both, in `DYNASTY_PERK_KINDS` order; the diff publisher fires both `DynastyPerkAwarded` events.

## Determinism / test surface

(Mapped against the live test infrastructure.)

- **Replay harness** (`src/game/replay-harness.test.ts`) — the baseline self-heals (recomputed at runtime, not a frozen golden hash), so no structural edit is required. **Add** a P15 scenario variant (mirroring the P3 Rustic-trait assertion at `:81-83`) that drives a campaign to a milestone and asserts the perk was awarded deterministically across 30 runs.
- **Phase-order tracker** (`src/runtime/tickOrchestrator.test.ts` + `__test-utils__/phaseOrderTracker.ts`) — append a `"dynasty-perk-evaluation"` tracked phase after `"rival-action"` in the local 9-phase subset array; THREE coordinated test edits: (1) bump the `expect(tracker.trace).toHaveLength(9)` assertion at `:134` → `toHaveLength(10)` (the new tracked phase grows the subset — this fails on first run if missed); (2) change the rival-last assertion at `:141-142` from `rivalIdx === trace.length - 1` to `rivalIdx === trace.length - 2`; (3) add `perkIdx === trace.length - 1`. (No MODULE-LOAD `PHASES.length` assertion exists to update — PHASES is module-private; this is purely the test-side tracked-subset.)
- **RNG-budget tests** — add a `dynastyLegacies.test.ts` budget block for the new conditional intercept draw, three cases (P10 forgery precedent at `artifacts.test.ts:161-182` for the zero cases): perk-unheld → `callCount` unchanged (0 draws); perk-held + 0 matching couriers → 0 draws; perk-held + N matching couriers → exactly N draws. The terminal `evaluateDynastyPerks` phase/step asserts `callCount` **unchanged** (RNG-free, justifies post-rival placement).
- **Extension trip-wires** (`hashable-state-extension.test.ts`, `schema-projection-selector-extension.test.ts`) — stay green untouched (House-field additions, top-level-key comparison only).
- **Chain test** — new `src/persist/migrations/v1-to-v14-chain.test.ts` (mirrors `v1-to-v13-chain.test.ts`): walks every legacy save V1→…→V14, asserts per-house `awardedDynastyPerks=[]` + the three counters `=0`, and hash parity `hashState(fromSaveV14(v14)) === hashState(createInitialState(seed, DEFAULT_CAMPAIGN_NAME))` (zero new draws on either path; empty seeding on both → parity holds).
- **Migration test** — new `src/persist/migrations/v13-to-v14.test.ts` (idempotence inlined per the recent `v12-to-v13.test.ts` convention): valid-output, `rng` byte-identity / zero draws, four-new-field empty backfill, per-house defaults, idempotence.

## Verification

- **Vitest — triggers over a 5-generation simulation:**
  - Patronage: 3 consecutive natural-death successions award it; a duel/assassination of the player head mid-streak resets the counter and blocks the award. **Fixture timing (off-by-one trap): drive exactly 3 player-head natural deaths across 3 distinct YEAR-PASSES (not 3 ticks) — the counter increments in aging (STEPS slot 1) and is read at the terminal eval (STEPS slot 6) of the SAME year-pass, so the award lands in the year-pass of the 3rd death.**
  - Seduction: the 4th player-owned successful Seduction awards it; discovered Seductions and rival-owned Seductions do NOT count.
  - Whispers: the 5th Weaponized whisper awards it.
- **Vitest — effects:** Patronage boosts the Country yield (`×5` + flat `+3`) only at `Country` + only when held; Seduction adds the base bonus + halves discovery-scandal; Whispers doubles verification for player-sourced whispers + intercepts inbound player-subject couriers at the configured probability.
- **Vitest — save round-trip:** awarded perks + counters survive save/load; migrated v13 saves start with zeroed counters (no retroactive awards).
- **Determinism:** the budget + phase-order + chain + replay assertions above are green.
- **Gates:** `pnpm test`, `pnpm lint` (boundaries clean — known 2-error baseline only, per the P14 carve-out), `pnpm typecheck`.
- **UI:** run the dev server; drive a campaign to a milestone; confirm the Dynasty tab renders the award + counters and the perk effect is observable (or state explicitly if the milestone can't be reached in a manual session).

## CLAUDE.md additions (apply at close-out)

1. **"Rivals always run last" refined to "last among RNG-consuming phases."** `evaluateDynastyPerks` is the sole phase permitted after `applyRivalActionPhase` (PHASES slot 15) because it draws zero RNG and therefore cannot perturb the seeded stream. It is referenced in BOTH the PHASES array (slot 15) and the year-pass STEPS array (slot 6, post-conception) — same function, two terminal slots — satisfying spec §7's "evaluated after all rolls" + "post-succession state."
2. **Going-forward-only perks via zero-seeded counters (§10 OQ#22).** The three `House` progress counters seed to 0 on fresh state AND every migration; perk awards derive from counters, never from re-counting on-disk schemes/whispers — this is what prevents the retroactive perk-explosion. Future cumulative-milestone systems follow the stored-counter pattern, not derive-at-eval, for the same reason.
3. **P15 publisher set is 12/12/10**, superseding the P13 11/11/9. `publishDynastyPerkAwards` rides EVERY tick-advancing wrapper INCLUDING `runYearPass` (the Patronage perk awards at the year-pass terminal step) — diverging from `publishGlobalEventTransitions`, which skips `runYearPass`.
4. **Patronage effect = Country wealth-yield multiplier (D2).** The "events hosted at the rural estate" spec phrase maps to the `Country` location's per-tick wealth delta; a distinct event-hosting action is a v1.5 candidate.
5. **Counter mutation at death/event sites; evaluation reads only (D4).** Patronage's consecutive-natural-death counter increments in `applyAgingStep` (natural) and resets in `resolveAssassination`/`resolveDuel` (violent) — no cause-of-death field on `Character`; the site knows the cause.

## Close out

When the gates and verification items above are green, run `/close-phase 15` to update phase status in `plans/MASTER.md` §6, append to `plans/SESSION-NOTES.md`, resolve §10 OQ #22 (and record the D2/D5/D6 interpretation decisions), apply the CLAUDE.md additions above, and commit the changes (no push).

## Accumulated Risks & Suggestions

*Passively collected from review cycles. Not blockers. Triaged at convergence.*

- [C1] D5 source-based verification determinant: `applyWhisperVerificationPhase` (`whispers.ts:198`) iterates ALL whispers with no character/house lookup today; the "sourceCharacterId resolves to a player-house character" gate needs a per-whisper `characters.get(sourceCharacterId)?.houseId === PLAYER_HOUSE_ID` resolve — pin the helper so the implementer doesn't improvise. (2× rate is safe; `Math.min(100, …)` clamps overshoot.) [applied]
- [C1] `recordPlayerHeadNaturalDeath` ordering vs `pruneOrphanedConversationKeys` house mutations (branches 5/10 lazy-clone `state.houses`). Recording AFTER prune on post-prune state is correct, but pin that the prune branches spread `...house` so the `consecutiveHeirsNaturalDeath` counter survives the clone.
- [C1] Patronage effect (D2) magnitude — RESOLVED (user decision): keep the Country-yield mapping but make it meaningful via a larger multiplier (`5.0×`) + a flat per-tick bonus (`+3`) → +8/tick while resident vs +1/tick baseline. D2 + the constants block + §7 effect + Verification updated accordingly. [applied]
- [C1] Off-by-one trap in the Patronage 3-consecutive-natural-deaths verification: the counter increments in aging (year-pass slot 1) and is read at the terminal step (slot 6) of the SAME year-pass. The test fixture must drive exactly 3 head deaths across 3 year-passes (not 3 ticks); trace the exact year-pass at which the `>= 3` predicate fires. [applied]
- [C1] Publisher set 12/12/10 verified structurally sound; the `runYearPass` inclusion (diverging from `publishGlobalEventTransitions`) is justified by Patronage awarding at the year-pass terminal step (confirmation, no action).
- [C1] PHASES slot-15 append is correct; the phase-order tracker test uses a 9-phase SUBSET (not the full 14), and the `:45` "count stays at 14" comment is stale-by-design (confirmation, no action).
- [C1] `resolveAccidentalSlip` (`whispers.ts:357`) confirmed to lack a `houses` clone — the plan's §6 instruction to add one for the counter increment is accurate (confirmation, no action).
- [C1] Phase-order tracker test: the §"Determinism / test surface" instruction changes the rival-last assertion at `tickOrchestrator.test.ts:141-142` but must ALSO bump the `expect(tracker.trace).toHaveLength(9)` assertion at `:134` → `10` (the new terminal tracked phase). The implementer hits this on first run if not pinned. [likely addressed]
- [C1] §6 counter-increment compose hazards: (a) the `resolveSeduction` not-discovered branch (`schemes.ts:594-598`) writes `affectionMap` only — there is NO existing `houses` clone to "compose with," so the `cumulativeSuccessfulSeductions` increment needs a FRESH `houses` clone (the §6 "compose with stateWithAffection" wording is loose). (b) the `resolveScandalSheet` whisper branch must re-fetch the owner from the post-write Map (`newHouses.get(owner.id) ?? owner`, mirroring `whispers.ts:337`) before the `cumulativeWeaponizedWhispers` increment, or the increment clobbers the just-written scandal/exiled state. Both are adjacent to existing patterns. [likely addressed]
- [C2] `resolveDuel` (`duel.ts:148-160`): pin the exact insertion ORDER of `recordPlayerHeadViolentDeath` relative to the `pruneOrphanedConversationKeys` line. Both orders work IF assigned to `workingState`; the plan now says "assign the result back" but doesn't pin order.
- [C2] Cosmetic line-cite drift (reviewers disagree, low value): verification increment may be `whispers.ts:200` (not `:198`); the wealth line `:51` vs `:52` (two reviewers split); spymaster predicate `staff.ts:296-303` (not `:290-300`); weaponize `status: "Weaponized"` writes `:305/343/359` (not `:303/341/357`); rival-last assertion `tickOrchestrator.test.ts:142`; P11 constants banner `:718`. The quoted code is verbatim-correct at each site — anchor on the code string, not the number, at implementation time.
- [C3] `resolveDuel` (`duel.ts:148-160`): pin that `recordPlayerHeadViolentDeath` lands INSIDE the `loserCasualty === "Killed"` branch (assigned back to `workingState`) BEFORE the later `resolveBloodFeudByGrievance` write at `:192`. Both compose (each spreads `...workingState`), so order is not correctness-critical, but making it explicit avoids implementer guesswork.
- [C4] Close-out follow-through: the "rivals always run last" CLAUDE.md refinement (and the D2/D5/D6 interpretation records) live in the plan's §"CLAUDE.md additions" + §"Close out" but must ACTUALLY be written into CLAUDE.md at `/close-phase 15`, else the next phase inherits the un-amended pin and the RNG-free-terminal-phase rationale is lost.
