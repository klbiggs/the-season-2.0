# P11 — Sibling Rivals & Inherited Secrets / Blood Feuds

> Part of [The Season Master Plan](../MASTER.md). Prior: [P10 — Artifacts, Wardrobe, Forgery & Theft](./10-artifacts.md). Next: [P12 — Hyde Park Promenade](./12-promenade.md).

**Goal.** Two long-tail multi-generational systems that activate on succession. Sibling-rival promotion plants autonomous antagonists inside the player's dynasty after every succession; their per-tick action loop drains wealth, leaks secrets, sabotages reputation, and auto-starts Sabotage schemes against the player until reconciled or hostility decays. Inherited Secrets accumulate at every succession from the player house's Verified+Weaponized whispers; a per-tick sub-percent surfacing roll picks a hostile rival house, records a Blood Feud entity AND a `source: "BloodFeud"` Grievance (the casus belli, per spec §3 line 502), and applies a large affection penalty across the rival's associated characters. Save format bumps **v11 → v12** to carry three new `House` array fields (`siblingRivals`, `inheritedSecrets`, `bloodFeuds`), four new branded ID types, three new entity schemas, and a one-element widening of `GRIEVANCE_SOURCES` (`"BloodFeud"`).

P11 is the project's first phase whose state grows monotonically across multi-generation play. P10's artifacts/forgeries persist within a generation; P11's inherited-secrets ledger spans every generation since the campaign began. The ledger is bounded per §8 line 685: the oldest entries collapse into `House.ancestorSummary` on push-past-bound, matching the genealogical-children-list pattern (§8 line 684). The implementation discipline tracks the P5 "House grievances per-house array" precedent (verified live at `src/game/entities.ts:51-92`): three new arrays on `House`, all defaulted via Zod `.default([])` per P8/P9 backward-compat shortcut, all strip-on-emit for legacy V1-V11 emitters. **No new top-level `GameState` fields** — the schema↔projection↔selector↔overwriteFromGameState quad-sync surface does NOT change; only the House-field strip cascade widens (resolves B2 framing).

**What does NOT change (load-bearing).** PHASES grows from **12 → 14** with two new tick-phase slots inserted BEFORE the terminal rival slot — `applySiblingRivalActionPhase` at slot 12 and `applyInheritedSecretSurfacingPhase` at slot 13. `applyRivalActionPhase` stays at the terminal slot per CLAUDE.md non-negotiable "rivals always run last." Year-pass STEPS grows from **4 → 5** with `applySiblingRivalPromotionStep` inserted at slot 4 (between `applySuccessionStep` slot 3 and `applyConceptionStep`, which shifts from slot 4 to slot 5). Insertion AFTER `applySuccessionStep` is load-bearing — promotion reads the new heir id from `house.headOfHouseCharacterId` post-succession to identify "who NOT to promote" (the heir is the new head, not a sibling-rival candidate); succession must have already written the new heir. Insertion AFTER `applyAgingStep` (slot 1) is load-bearing for the §7 line 650 corpse-skip edge case: aging flips dead siblings to `alive: false`, so the post-aging promotion iteration's `alive === true` filter excludes them implicitly (B8 enforcement — see "§7 corpse-promotion guard" below).

**Promotion-eligibility + initial-hostility derivation (resolves cycle-2-iter-7 B1).** Spec §3 line 480 reads "each adult sibling whose hostility derivation (e.g., affection-delta toward dead head vs. new heir) exceeds a fixed threshold" — the "e.g." hedge admits that the formula is non-load-bearing. Verified live: `affectionMap` is keyed by `${HouseId}|${CharacterId}` (`src/game/conversation/types.ts:17`), NOT `(character, character)`. The affection-delta-toward-dead-head minus affection-toward-new-heir formula is therefore not derivable from live state — both reads resolve to the same `(PLAYER_HOUSE_ID, sibling)` key. P11 v1 ADOPTS A PROXY DERIVATION: promotion eligibility is binary (every alive adult sibling of the new heir is eligible at succession; no threshold roll), and initial hostility is derived from the sibling's **traits** at promotion time. The hostility derivation:
- Base initial hostility: `SIBLING_RIVAL_PROMOTION_BASELINE_HOSTILITY = 50` (mid-range — slightly above zero auto-reconcile and well below max).
- Trait modifier: `+15` if sibling has `Jaded`, `+15` if `Ambitious`, `+10` if `Cunning`, `-10` if `Pious`. Clamped to `[1, 100]` after summation (`min 1` so promoted siblings start with at least one tick of cooldown-eligible action before auto-reconciling).
- Module-load assertion: every modifier weight reads from the canonical trait-id enum (no string-key drift).

The threshold concept from spec line 480 is reframed as a TRAIT-PRESENCE GATE rather than a continuous-value threshold:
```ts
// Eligible iff alive + adult + sibling of heir + NOT the heir + NOT the dead head.
// (No threshold filter — see "Why no threshold" below.)
const eligible = characters.values().filter((c) =>
  c.alive
  && c.houseId === PLAYER_HOUSE_ID
  && isAdult(c)
  && c.id !== newHeirId
  && c.id !== deadHeadId
  && isSiblingOf(c, newHeirId, characters)
);
// Per-eligible-sibling initial hostility:
function deriveInitialHostility(c: Character): number {
  let h = SIBLING_RIVAL_PROMOTION_BASELINE_HOSTILITY;
  if (c.traits.includes("Jaded")) h += 15;
  if (c.traits.includes("Ambitious")) h += 15;
  if (c.traits.includes("Cunning")) h += 10;
  if (c.traits.includes("Pious")) h -= 10;
  return Math.max(1, Math.min(SIBLING_RIVAL_HOSTILITY_MAX, h));
}
```

**Why no threshold**: a threshold filter ("only promote siblings with hostility ≥ N") combined with the uniform baseline + trait modifier would either promote every adult sibling (baseline > threshold) OR no adult sibling (baseline < threshold). The trait-presence gate gives the differentiation the spec's "e.g." formula intended — Jaded/Ambitious/Cunning siblings start hot (~75-90), Pious siblings start tepid (~40), neutral siblings start mid (~50). This is the cleanest v1 simplification of the spec hedge.

`SIBLING_RIVAL_PROMOTION_THRESHOLD` from earlier drafts is RETIRED. The constants block updates to remove that constant and add the new `SIBLING_RIVAL_PROMOTION_BASELINE_HOSTILITY = 50` + trait modifiers as named constants (e.g., `SIBLING_RIVAL_TRAIT_HOSTILITY_JADED = 15`, `_AMBITIOUS = 15`, `_CUNNING = 10`, `_PIOUS = -10`).

**Pre-succession-snapshot integration via closure capture (resolves cycle-2-iter-1 B1 + cycle-2-iter-2 B1 + cycle-2-iter-2 B3).** `applySiblingRivalPromotionStep` is a function CONSTRUCTED FRESH per year-pass via a higher-order factory that closes over the pre-succession snapshot. The STEPS array is REBUILT each year-pass call from a `STEP_BUILDERS` array of `(snapshot) => StepFn` factories. This eliminates the implicit-contract risk of relying on `{ ...state }` spreads to propagate a transient field — the snapshot is held in a JS closure, NOT in `GameState`. Concrete:

```ts
// src/runtime/yearPass.ts (P11 EDIT) — runYearPassPure is the canonical name
// (verified live at src/runtime/yearPass.ts:40; the store wrapper at
// src/game/store.ts:485 is named `runYearPass` and DELEGATES to runYearPassPure).
// The snapshot capture lives in runYearPassPure so tests + the replay harness
// see the deterministic shape.

import { applyAgingStep, applyMaturationStep, applySuccessionStep, applyConceptionStep } from "...";
import { buildSiblingRivalPromotionStep } from "../game/rules/siblingRivals";

export function runYearPassPure(state: GameState): GameState {
  // Capture per-house head ids BEFORE any STEP runs. This is the source-of-truth
  // for the deadHeadId/newHeirId pair: succession (slot 3) may rewrite
  // house.headOfHouseCharacterId; we snapshot here so promotion (slot 4) can
  // diff against current state.
  const preSuccessionHeads: ReadonlyMap<HouseId, CharacterId> = new Map(
    [...state.houses].map(([id, h]) => [id, h.headOfHouseCharacterId]),
  );
  // Build per-year-pass STEPS array. SiblingRivalPromotionStep closes over the snapshot.
  const STEPS: readonly YearPassStep[] = [
    applyAgingStep,                                     // slot 1
    applyMaturationStep,                                // slot 2
    applySuccessionStep,                                // slot 3 (also runs inherited-secrets accumulation)
    buildSiblingRivalPromotionStep(preSuccessionHeads), // slot 4 (NEW at P11)
    applyConceptionStep,                                // slot 5
  ];
  return STEPS.reduce<GameState>((acc, step) => step(acc), state);
}
```

`buildSiblingRivalPromotionStep(preSuccessionHeads): YearPassStep` is exported from `src/game/rules/siblingRivals.ts`:

```ts
export function buildSiblingRivalPromotionStep(
  preSuccessionHeads: ReadonlyMap<HouseId, CharacterId>,
): YearPassStep {
  return (state: GameState): GameState => {
    // For each house that experienced a succession this tick (head changed),
    // promote eligible siblings. Per-house iteration in lex-sorted houseId order.
    let nextState = state;
    const sortedHouseIds = [...state.houses.keys()].sort();
    for (const houseId of sortedHouseIds) {
      const deadHeadId = preSuccessionHeads.get(houseId);
      const currentHeadId = state.houses.get(houseId)?.headOfHouseCharacterId;
      if (deadHeadId === undefined || currentHeadId === undefined) continue;
      if (deadHeadId === currentHeadId) continue;  // no succession this tick
      // Only the player house gets sibling-rivals in v1 (spec line 217 "internal antagonist").
      if (houseId !== PLAYER_HOUSE_ID) continue;
      nextState = promoteEligibleSiblingsAtSuccession(nextState, deadHeadId, currentHeadId);
    }
    return nextState;
  };
}
```

Why closure capture (resolves cycle-2-iter-2 B1): a `{ ...state }`-propagated transient field on `GameState` would require every STEP to faithfully preserve the field through its own `return { ...acc, ... }` writes. Tests would have to assert this discipline. JS closures are stronger — the snapshot is captured at year-pass-entry and held in lexical scope until the closure body executes (slot 4); no STEP between slots 1-3 can perturb it. Alternative considered + rejected: (a) augmented STEPS signature `YearPassStep<C>(state: GameState, context: C)` — widens every existing STEP's call site; (b) transient field on GameState — implicit propagation contract; (c) ancestorSummary string-parsing — fragile.

Why the function name `runYearPassPure` (resolves cycle-2-iter-2 B3): the pure composer at `src/runtime/yearPass.ts:40` is `runYearPassPure`; the store wrapper at `src/game/store.ts:485` is `runYearPass` (a thin wrapper that calls `runYearPassPure` then publishes diff-helpers + side effects). The pre-succession snapshot capture lives in `runYearPassPure` so tests + the replay harness see it.

Inherited-secret accumulation is a SIDE-EFFECT inside the existing `applySuccessionStep`, NOT a separate STEPS slot — same precedent as P9's `startElopementSprintFromDiscoveredSeduction` running inside `applySchemeResolutionPhase`. The accumulation helper `accumulateInheritedSecretsAtSuccession(state, deadHeadId, newHeirId)` writes `state.houses[playerHouseId].inheritedSecrets` from within the existing succession step before returning.

**Accumulator insertion path (resolves cycle-2-iter-3 B1).** Live `applySuccessionStep` at `src/game/rules/succession.ts:67-146` calls `processDeadHead` for each house with a dead head; `processDeadHead` has TWO return paths — heirless (`src/game/rules/succession.ts:116`) and promoted (`src/game/rules/succession.ts:146`). The accumulation:
- Runs ONLY on the PROMOTED branch (heirless succession = dynasty ends; no future generations to inherit secrets from). Heirless branch returns unchanged.
- Gated to `house.id === PLAYER_HOUSE_ID` (NON-player succession does not accumulate; inherited-secrets ledger is per-player-dynasty only per spec line 217).
- Invoked IMMEDIATELY BEFORE the existing `return { ...state, houses: newHouses, characters: newChars }` at line 146 — the helper takes the about-to-be-returned state and returns a new state with `state.houses[playerHouseId].inheritedSecrets` extended.
- Whisper filter (resolves cycle-2-iter-2 R1 / C2 #803 / cycle-4-iter-1 B3): copies whispers where (a) `whisper.subjectCharacterId` resolves to a character whose `houseId === PLAYER_HOUSE_ID` AT ACCUMULATION TIME (i.e., the subject was a member of the player house) AND (b) `status IN {Verified, Weaponized}` AND (c) `whisper not already in playerHouse.inheritedSecrets` (dedupe by source whisper id stored in `InheritedSecret.sourceWhisperId` — see schema addition below). Spec §3 lines 241/499 say "verified whispers about the player house" — broader than just the dead head. Post-succession heirs whose whispers were verified during the previous head's reign are accumulated too; their parent generation IS the "inherited" one. Bound-overflow eviction: oldest entry (lex-smallest by `originatingTick`) is collapsed into `playerHouse.ancestorSummary` and dropped from the ledger.
- **Schema field addition**: `InheritedSecret` gains `sourceWhisperId: WhisperIdSchema` (added to the entity schema declared earlier) for dedupe.

```ts
// src/game/rules/succession.ts (P11 EDIT) — body of processDeadHead's promoted branch:
//
// (existing body that computes newHouses[house.id], newChars, etc. unchanged)
//
// P11: BEFORE return, if this is the player house, accumulate inherited secrets.
let nextState: GameState = { ...state, houses: newHouses, characters: newChars };
if (house.id === PLAYER_HOUSE_ID) {
  nextState = accumulateInheritedSecretsAtSuccession(nextState, deadHeadId, newHeirId);
}
return nextState;

// src/game/rules/inheritedSecrets.ts:
export function accumulateInheritedSecretsAtSuccession(
  state: GameState,
  deadHeadId: CharacterId,
  newHeirId: CharacterId,
): GameState {
  const playerHouse = state.houses.get(PLAYER_HOUSE_ID);
  if (playerHouse === undefined) return state;
  const existingSourceIds = new Set(playerHouse.inheritedSecrets.map((s) => s.sourceWhisperId));
  // Lex-sort whispers by id for deterministic accumulation order.
  const sortedWhispers = [...state.whispers.values()].sort((a, b) => a.id.localeCompare(b.id));
  const newSecrets: InheritedSecret[] = [];
  for (const w of sortedWhispers) {
    if (existingSourceIds.has(w.id)) continue;
    // Subject filter: whispers about any character whose house was PLAYER_HOUSE_ID at accumulation time.
    // Per cycle-4-iter-1 B3 — broader than "subject === deadHeadId" because spec §3 line 499 says
    // "verified whispers about the player house" (entire house, not just the dead head).
    const subjectChar = state.characters.get(w.subjectCharacterId);
    if (subjectChar === undefined || subjectChar.houseId !== PLAYER_HOUSE_ID) continue;
    if (w.status !== "Verified" && w.status !== "Weaponized") continue;
    newSecrets.push({
      // Accumulator-aware id derivation (resolves cycle-4-iter-2 B2). The factory walks state.houses
      // but the accumulation loop builds newSecrets[] WITHOUT threading state — so naive
      // `makeInheritedSecretId(state, ...)` produces duplicate IDs for multi-secret single-succession.
      // Compute index inline from PRE-existing ledger + newSecrets[] accumulated this call:
      id: `inheritedSecret-gen${playerHouse.generation}-${
        playerHouse.inheritedSecrets.filter((s) => s.originatingGenerationCount === playerHouse.generation).length
        + newSecrets.filter((s) => s.originatingGenerationCount === playerHouse.generation).length
      }` as InheritedSecretId,
      sourceWhisperId: w.id,
      description: w.text,
      originatingGenerationCount: playerHouse.generation,
      originatingTick: state.tick,
      surfacedAgainstHouseId: null,
      surfacedAtTick: null,
    });
  }
  if (newSecrets.length === 0) return state;
  // Append, then evict oldest if past bound.
  let ledger = [...playerHouse.inheritedSecrets, ...newSecrets];
  let summary = playerHouse.ancestorSummary;
  while (ledger.length > MAX_INHERITED_SECRETS) {
    const oldest = ledger.sort((a, b) => a.originatingTick - b.originatingTick)[0];
    summary = [...summary, `Generation ${oldest.originatingGenerationCount} inherited secret: ${oldest.description}`];
    ledger = ledger.filter((s) => s.id !== oldest.id);
  }
  const newHouses = new Map(state.houses);
  newHouses.set(PLAYER_HOUSE_ID, {
    ...playerHouse,
    inheritedSecrets: ledger,
    ancestorSummary: summary,
  });
  return { ...state, houses: newHouses };
}
```

**In scope.**

- **Save format bump to v12.** Adds **THREE new `House` array fields** + **FOUR new branded ID types** + **THREE new entity schemas** + **ONE new `GRIEVANCE_SOURCES` enum entry**. Every field is hash-relevant; every new entry has a `.default([])` or strip-on-emit:
  - `House.siblingRivals: z.array(SiblingRivalStateSchema).default([])` — per-house list of currently-active sibling-rival actors. Empty on fresh state and every legacy V1-V11 lift.
  - `House.inheritedSecrets: z.array(InheritedSecretSchema).default([])` — per-house multi-generation ledger of accumulated verified whispers. Bounded by `MAX_INHERITED_SECRETS = 12` per §8 line 685; overflow collapses into `House.ancestorSummary`. Empty on fresh state and every legacy V1-V11 lift.
  - `House.bloodFeuds: z.array(BloodFeudSchema).default([])` — per-house active feud list. Empty on fresh state and every legacy V1-V11 lift.
  - `GRIEVANCE_SOURCES = ["Sabotage", "FauxPas", "BloodFeud"] as const` (widening at `src/game/constants.ts:305`). The `"BloodFeud"` source distinguishes the casus belli that fires alongside `BloodFeud` entity creation from human-driven sabotage/faux-pas grievances. Each surfacing fires TWO writes on the player house: one push to `House.bloodFeuds`, one push to `House.grievances` with `source: "BloodFeud"`. Two write sites is intentional — the `BloodFeud` is the gameplay entity (lifecycle Active → Resolved), the `Grievance` is the casus belli surface read by P14 ledger UI.
  - **No new top-level `GameState` Maps.** Resolves the original B2 framing — the quad-sync (`GameStateSchema` / `hashableState` / `selectGameState` / `overwriteFromGameState`) plus `createInitialState` is unchanged. The state-extension trip-wire at `src/game/schema-projection-selector-extension.test.ts` does NOT fire at P11. (House-field additions are hash-relevant via the existing `houses` serialization path; `serializeRegistry<HouseId, House>` already covers the three new arrays.)

- **`SaveV12Schema` declaration** (new at P11 in `src/persist/schema.ts`):
  ```ts
  // src/persist/schema.ts (NEW at P11):
  export const SaveV12Schema = z.object({
    version: z.literal(12),
    tick: z.number().int().nonnegative(),
    rng: z.array(z.tuple([HouseIdSchema, RngStateSchema])),
    houses: z.array(z.tuple([HouseIdSchema, HouseSchema])),  // LIVE HouseSchema — includes siblingRivals/inheritedSecrets/bloodFeuds via .default([])
    characters: z.array(z.tuple([CharacterIdSchema, CharacterSchema])),
    marriages: z.array(z.tuple([MarriageIdSchema, MarriageRecordSchema])),
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
    elopement: ElopementSprintStateSchema.nullable(),
    artifactInstances: z.array(z.tuple([ArtifactInstanceIdSchema, ArtifactInstanceSchema])),
    forgeries: z.array(z.tuple([ForgeryIdSchema, ForgeryRecordSchema])),
    thiefAttempts: z.array(z.tuple([ThiefAttemptIdSchema, ThiefAttemptSchema])),
    // P11: NO new top-level shape — three new fields are on HouseSchema (.default([]) backfill).
  });
  export type SaveV12 = z.infer<typeof SaveV12Schema>;
  ```
  `SAVE_VERSION_CURRENT` bumps from `11` → `12` at `src/persist/schema.ts:73`.

- **Strip cascade for legacy emit (resolves cycle-1-iter-4 B1).** Following P8/P9/P10 precedent (defense-in-depth + round-trip byte-identity parity; NOT required for parse-safety since Zod default `.strip()` mode drops unknown fields), three new House array fields are stripped from every legacy `toSaveV{N}` for N < 12 (V1 through V11). **The live shape uses ONE strip helper per emit-site, NOT a chain** (verified at `src/persist/schema.ts:181,213,245` and `:931,749,583,667`); each `toSaveV{N}` calls a single `HousePre{N}`-shaped helper that returns `Array<[string, HousePre{N}]>`. P11 EXTENDS the existing helpers + Pre-schemas; no new chain.

  **Edit path A: widen each `HousePre{N}Schema.omit(...)` list.** Verified live at `src/persist/schema.ts:126,153` etc.: every `HousePre{N}Schema` is `HouseSchema.omit({...})`. Since `HouseSchema` widens at P11 with three new fields (`siblingRivals`/`inheritedSecrets`/`bloodFeuds`), each `HousePre{N}Schema.omit(...)` AUTO-INCLUDES the three new fields unless the omit list widens explicitly. Concrete edits (Pre-schemas — every existing legacy Pre-shape):
  - `HousePreV4Schema` (raw `z.object` body at `src/persist/schema.ts:78` — NOT a `.omit` of HouseSchema): no edit needed (raw body excludes everything by construction; `defaultHouseV4Fields` populates the P11 fields with `[]` defaults at lift time).
  - `HousePreV6Schema` (`HouseSchema.omit({ grievances: true, exiled: true })` at `:126`): WIDEN omit to `{ grievances: true, exiled: true, siblingRivals: true, inheritedSecrets: true, bloodFeuds: true }`.
  - `HousePreV7Schema` (`HouseSchema.omit({ exiled: true })` at `:153`): WIDEN to `{ exiled: true, siblingRivals: true, inheritedSecrets: true, bloodFeuds: true }`.
  - **`HousePreV12Pre11Schema` covers V7-V11** (resolves cycle-2-iter-2 R4 + cycle-4-iter-1 B2). Verified live (`src/persist/schema.ts:1011/1133/1271/1378/1492`): SaveV7Schema through SaveV11Schema each reference the LIVE `HouseSchema` directly in their `houses` tuple — no Pre-schema in place because each was the live schema at its respective phase ship. P11 introduces ONE new Pre-schema:
    ```ts
    // src/persist/schema.ts (NEW at P11):
    const HousePreV12Pre11Schema = HouseSchema.omit({
      siblingRivals: true,
      inheritedSecrets: true,
      bloodFeuds: true,
    });
    type HousePreV12Pre11 = z.infer<typeof HousePreV12Pre11Schema>;
    ```
    **Apply to V7-V11 emit AND parse-side `Save{N}Schema` declarations** so post-P11 the SaveV7-V11 schemas don't silently include the three new P11 fields:
    ```ts
    // P11 EDITS — replace `HouseSchema` with `HousePreV12Pre11Schema` in EACH of SaveV7Schema..SaveV11Schema's `houses` field.
    // E.g.:
    //   SaveV11Schema = z.object({
    //     ...
    //     houses: z.array(z.tuple([HouseIdSchema, HousePreV12Pre11Schema])),  // was: HouseSchema
    //     ...
    //   });
    ```
    Without this, V11 and V12 become Zod-identical after the live HouseSchema widens — a v11 save written to disk would silently round-trip with the post-P11 fields if the live schema's `.default([])` kicks in at parse time. The strip helper for emit-sites: `stripP11FieldsForLegacyEmit` (declared earlier in this file).

  **Edit path B: extend each existing strip helper destructure.** `stripGrievancesForLegacyEmit` / `stripExiledForLegacyEmit` / (and the V8/V9 helpers — audit `src/persist/schema.ts` for the full list) each destructure-and-respread:
  ```ts
  // src/persist/schema.ts — P11 EDIT (existing helper, EXTEND destructure for the three new fields):
  function stripGrievancesForLegacyEmit(
    houses: ReadonlyArray<[string, House]>,
  ): Array<[string, HousePreV6]> {
    return houses.map(([id, h]) => {
      const {
        grievances: _g,
        exiled: _e,
        siblingRivals: _s,      // P11 ADDITION
        inheritedSecrets: _i,    // P11 ADDITION
        bloodFeuds: _b,          // P11 ADDITION
        ...rest
      } = h;
      return [id, rest as HousePreV6];
    });
  }
  ```
  Same destructure-widening for every existing strip helper (V5 onward). For V1-V4 emitters that go through the raw `HousePreV4Schema` lift (NOT via a `.omit`-derived helper), no edit is needed because the raw V4 shape doesn't include any post-V4 fields by construction.

  **New helper `stripP11FieldsForLegacyEmit`** — ONLY for V8-V11 emit-sites that currently pass through the live HouseSchema directly (i.e., did NOT use a Pre-schema strip-helper before P11). Concrete signature:
  ```ts
  // src/persist/schema.ts — P11 NEW helper, applied ONLY at emit-sites that
  // previously emitted the live HouseSchema (no prior strip).
  function stripP11FieldsForLegacyEmit(
    houses: ReadonlyArray<[string, House]>,
  ): Array<[string, Omit<House, "siblingRivals" | "inheritedSecrets" | "bloodFeuds">]> {
    return houses.map(([id, h]) => {
      const { siblingRivals: _s, inheritedSecrets: _i, bloodFeuds: _b, ...rest } = h;
      return [id, rest];
    });
  }
  ```
  Audit (at implementation time): grep `src/persist/schema.ts` for every `toSaveV{N}` (N in 1..11) and confirm whether the `houses` tuple emit uses a strip helper or the live shape. For each that uses a strip helper, EXTEND the destructure (path B). For each that emits the live shape directly, APPLY `stripP11FieldsForLegacyEmit` (path A's new helper). Both paths are signature-stable; tests catch mistakes via the chain-test byte-identity assertion.

  **Branded `HouseId` vs raw `string` convention drift (resolves cycle-1-iter-4 S6).** Existing strip helpers use raw `string` (verified `:182`). New `stripP11FieldsForLegacyEmit` MATCHES that convention (uses `[string, House]` not `[HouseId, House]`). Future P-later phases should follow the same raw-string convention for consistency.

  **Why no chain.** A previous draft proposed chaining strip helpers (`stripP11(...stripExiled(stripGrievances(houses)))`) which would compose return types and force every wrapped helper to also know about every other Pre-shape. The single-helper-per-emit-site approach is simpler and matches the live code. (Note for implementer: this section was revised post-cycle-1-iter-4 review when the chain proposal was found to be inconsistent with the live shape.)

- **`GRIEVANCE_SOURCES` widening strip cascade.** The grievance source enum gains `"BloodFeud"` at v12. For legacy V5-V11 emit (V5 is when Grievance shipped per P5), grievances with `source: "BloodFeud"` must be filtered OUT of the emitted `house.grievances` array because legacy schemas don't recognize the source value. New helper:
  ```ts
  // src/persist/schema.ts — NEW helper at P11, applied at toSaveV5..V11 only
  // (V1-V4 don't carry grievances). Strips BloodFeud-sourced grievances from
  // House.grievances on legacy emit; the BloodFeud entity itself is stripped
  // by stripP11FieldsForLegacyEmit (above) since House.bloodFeuds doesn't exist
  // in legacy schemas. The casus-belli grievance and the BloodFeud entity
  // travel together on legacy emit (both vanish; round-trip drops the feud
  // entirely from legacy save's perspective — correct per the "v12 features
  // don't exist on v11" contract).
  function stripBloodFeudGrievancesForLegacyEmit(
    houses: ReadonlyArray<[HouseId, House]>,
  ): Array<[HouseId, House]> {
    return houses.map(([id, h]) => [
      id,
      { ...h, grievances: h.grievances.filter((g) => g.source !== "BloodFeud") },
    ]);
  }
  ```
  Chains with the existing strip-cascade at toSaveV5..V11 emit-sites.

- **`migrate_v11_to_v12`.** Pure function `(SaveV11) → SaveV12` at `src/persist/migrations/v11-to-v12.ts`. Body follows the bare+wrap pattern. Three new House fields are seeded EMPTY (legacy player starts the post-P11 build with no inherited-secrets / sibling-rivals / blood-feuds — the v1 default; future v1.5 could backfill via a separate seed helper if multi-gen replay parity becomes desirable). Idempotent (already-populated arrays survive untouched). Concrete:
  ```ts
  // src/persist/migrations/v11-to-v12.ts (NEW at P11):
  // Matches the existing `migrate_v10_to_v11` precedent at src/persist/migrations/v10-to-v11.ts —
  // Bare→GameState→toSaveV{N+1} round-trip is the established migration pattern (NOT a divergence).
  // The Zod `.default([])` on the three new House fields handles parse-time backfill; the explicit
  // empty-array writes here are defense-in-depth + readability (same idiom as v10-to-v11's explicit
  // Map-spread before bootstrapPlayerArtifactsForMigration).
  import { SaveV11Schema, SaveV12Schema, fromSaveV11Bare, toSaveV12 } from "../schema";

  export function migrate_v11_to_v12(save: SaveV11): SaveV12 {
    const bare = fromSaveV11Bare(save);
    const houses = new Map(bare.houses);
    for (const [id, h] of houses) {
      houses.set(id, {
        ...h,
        siblingRivals: h.siblingRivals ?? [],
        inheritedSecrets: h.inheritedSecrets ?? [],
        bloodFeuds: h.bloodFeuds ?? [],
      });
    }
    return toSaveV12({ ...bare, houses });
  }
  ```
  - **Draw budget: ZERO.** Pure shape transformation. Asserted in `v11-to-v12.test.ts`: `expect(migrate_v11_to_v12(save).rng).toEqual(save.rng)`.
  - **Idempotence assertion** ships in `src/persist/migrations/v11-to-v12.idempotence.test.ts` via the `assertMigrationIdempotent` helper.
  - **`MIGRATIONS` registry extension** at `src/persist/migrations/index.ts`: append `{ from: 11, to: 12, migrate: (s: unknown) => migrate_v11_to_v12(SaveV11Schema.parse(s)), outputSchema: SaveV12Schema }` plus the imports.
  - **`fromSaveV11Bare`** (NEW at P11 — same precedent as P10's `fromSaveV10Bare`): live `fromSaveV11` (currently the unsplit form since V11 was live from P10 through pre-P11) splits into a Bare half (pure deserialization, no seeding) + a public wrapper. The Bare body mirrors `fromSaveV10Bare` shape — deserialize every Map, copy scalar fields, preserve elopement nullable, AND seed the three new House fields to `[]` (defense-in-depth duplicate of the `.default([])` parse-time backfill):
    ```ts
    // src/persist/schema.ts — P11 EDITS (extract Bare, refactor wrap):
    export function fromSaveV11Bare(save: SaveV11): GameState {
      const houses = deserializeRegistry<HouseId, House>(save.houses);
      // Defense-in-depth: ensure the three new fields are populated on every
      // legacy lift even if Zod .default([]) misses an edge case.
      const housesWithP11Fields = new Map<HouseId, House>();
      for (const [id, h] of houses) {
        housesWithP11Fields.set(id, {
          ...h,
          siblingRivals: h.siblingRivals ?? [],
          inheritedSecrets: h.inheritedSecrets ?? [],
          bloodFeuds: h.bloodFeuds ?? [],
        });
      }
      return {
        tick: save.tick,
        rng: deserializeRegistry<HouseId, RngState>(save.rng),
        houses: housesWithP11Fields,
        characters: deserializeRegistry<CharacterId, Character>(save.characters),
        // ... ~22 other field deserializations (unchanged from fromSaveV10Bare) ...
      };
    }
    export function fromSaveV11(save: SaveV11): GameState {
      return fromSaveV11Bare(save);  // No bootstrap seeding for P11 — three new fields default empty.
    }
    ```
  - **`fromSaveV1` through `fromSaveV11` public wrappers**: extend each to populate the three new House fields as `[]`. The `.default([])` Zod backfill handles this at parse time; the wrapper edits are defense-in-depth (P10 precedent: ~1 line per wrapper, 11 wrappers, ~11 LOC total).
  - **`src/persist/migrations/v1-to-v12-chain.test.ts`** (NEW file — additive chain-test per the v1-to-vN convention): walks every legacy save through the full migration chain `(V1 → V2 → ... → V12)` and asserts the bootstrapped V12 state from `createInitialState(playerSeed)` equals the migrated V12 state byte-for-byte (same hash). Parity holds because P11 adds no PRNG draws on either path AND no bootstrap seeding (three new fields default empty on both fresh-state and legacy paths).

- **New branded IDs** (`src/game/rng.ts` — per CLAUDE.md "branded-string Zod schema homes" convention):
  ```ts
  // src/game/rng.ts — P11 ADDITIONS:
  export type SiblingRivalActorId = string & { readonly __brand: "SiblingRivalActorId" };
  export type InheritedSecretId = string & { readonly __brand: "InheritedSecretId" };
  export type BloodFeudId = string & { readonly __brand: "BloodFeudId" };

  export const SiblingRivalActorIdSchema = z.string().transform((s) => s as SiblingRivalActorId);
  export const InheritedSecretIdSchema = z.string().transform((s) => s as InheritedSecretId);
  export const BloodFeudIdSchema = z.string().transform((s) => s as BloodFeudId);
  ```
  **Schema notes (resolves cycle-1-iter-2 B7).** The three branded ID schemas use `z.string().transform((s) => s as Branded)` — NO `.regex(...)` format constraint. Round-trip stability is byte-exact via string-as-string serialization, matching every prior branded ID schema (`WhisperIdSchema`, `ArtifactInstanceIdSchema`, etc.). The id-format strings ("siblingRival-{characterId}" etc.) are an internal convention used by factory functions; the schema layer does not enforce them.

  Plus deterministic-id factories per P6/P10 precedent. **Factories live in `src/game/fixtures/`, NOT `src/game/rules/`** (resolves cycle-1-iter-2 B3 — verified: `makeWhisperId` at `src/game/fixtures/whisperIdFactory.ts:16`, `makeArtifactInstanceId` + `makeForgeryId` + `makeThiefAttemptId` at `src/game/fixtures/artifacts.ts:193,204,216`, `makeSchemeId` at `src/game/fixtures/schemeIdFactory.ts:20`, `makeCourierPayloadId` at `src/game/fixtures/courierPayloadIdFactory.ts:14`, `makeMarriageId` at `src/game/fixtures/marriageIdFactory.ts:16`, `makeDuelId` at `src/game/fixtures/duelIdFactory.ts:13`). Three new factory files at P11:

  ```ts
  // src/game/fixtures/siblingRivalIdFactory.ts (NEW at P11):
  // SiblingRivalActorId is unique-by-construction (one actor per sibling Character).
  // No index counting — id derives directly from characterId. Pure function, no state read.
  export function makeSiblingRivalActorId(characterId: CharacterId): SiblingRivalActorId {
    return `siblingRival-${characterId}` as SiblingRivalActorId;
  }

  // src/game/fixtures/inheritedSecretIdFactory.ts (NEW at P11):
  // Index-counted within (houseId, generation) — walks house.inheritedSecrets to count entries
  // sharing the same originatingGenerationCount. Matches the P6 makeWhisperId precedent
  // (which walks state.whispers for index counting).
  export function makeInheritedSecretId(
    state: GameState,
    houseId: HouseId,
    originatingGenerationCount: number,
  ): InheritedSecretId {
    const house = state.houses.get(houseId);
    if (house === undefined) {
      throw new Error(`makeInheritedSecretId: no house ${houseId}`);
    }
    const inGenCount = house.inheritedSecrets.filter(
      (s) => s.originatingGenerationCount === originatingGenerationCount,
    ).length;
    return `inheritedSecret-gen${originatingGenerationCount}-${inGenCount}` as InheritedSecretId;
  }

  // src/game/fixtures/bloodFeudIdFactory.ts (NEW at P11):
  // Composite key (secret, rival) — unique-by-construction per (triggeringSecretId, offendingHouseId)
  // pair. The same secret can re-surface against the SAME rival only after the prior feud resolves
  // (resolved feuds persist in house.bloodFeuds with resolved: true; a re-surfacing then mints a new
  // feud entity with a disambiguating suffix). No state read needed for unique-pair construction.
  export function makeBloodFeudId(
    secretId: InheritedSecretId,
    rivalHouseId: HouseId,
    surfacingTick: number,
  ): BloodFeudId {
    // surfacingTick disambiguates re-surfacing of the same (secret, rival) pair post-resolution.
    return `bloodFeud-${secretId}-${rivalHouseId}-t${surfacingTick}` as BloodFeudId;
  }
  ```

  Note **`originatingGenerationCount`** field name on `InheritedSecretSchema` — the underlying House field is `house.generation` (singular, `z.number().int().nonnegative()` at `src/game/entities.ts:85`; NO `generationCount` field exists — resolves cycle-1-iter-2 B2). The InheritedSecret's `originatingGenerationCount` is a SNAPSHOT of `house.generation` at the tick of accumulation, used by the eviction format. Plan body references to `house.generationCount` are corrected to `house.generation` throughout (including the eviction-line format at the verification matrix and the ancestor-summary collapse format).

- **New entity schemas** (`src/game/entities.ts`). All three live alongside the P10 entity schemas. Reference constants directly per the P9-resolved cycle-correctness pattern (`entities.ts` already imports `./constants` at runtime):
  ```ts
  // src/game/entities.ts (P11 ADDITIONS):
  import {
    // ... existing P10 imports ...
    MAX_INHERITED_SECRETS,                  // NEW at P11
    SIBLING_RIVAL_HOSTILITY_MAX,            // NEW at P11
    BLOOD_FEUD_DECAY_TICKS_MAX,             // NEW at P11
  } from "./constants";

  export const SiblingRivalStateSchema = z.object({
    id: SiblingRivalActorIdSchema,
    characterId: CharacterIdSchema,           // FK to the promoted sibling Character
    hostility: z.number().int().min(0).max(SIBLING_RIVAL_HOSTILITY_MAX),
    lastActionTick: z.number().int().nonnegative(),
    reconciled: z.boolean(),                  // ONE-WAY LATCH (flips true on reconciliation success OR auto-reconciliation at hostility 0; never reverts to false)
    promotedAtTick: z.number().int().nonnegative(),  // provenance anchor for P14 ledger
  });
  export type SiblingRivalState = z.infer<typeof SiblingRivalStateSchema>;

  export const InheritedSecretSchema = z.object({
    id: InheritedSecretIdSchema,
    sourceWhisperId: WhisperIdSchema,         // FK to the source Whisper (dedupe key — resolves cycle-2-iter-3 B1)
    description: z.string(),                  // copied from the source Whisper.text at accumulation time
    originatingGenerationCount: z.number().int().nonnegative(),  // generation that accumulated this secret (snapshot of House.generation at copy time)
    originatingTick: z.number().int().nonnegative(),             // tick of accumulation (NOT of the original whisper)
    surfacedAgainstHouseId: HouseIdSchema.nullable(),             // null while unsurfaced; set on first surfacing roll hit. ONE-WAY LATCH — once set, never reverts.
    surfacedAtTick: z.number().int().nonnegative().nullable(),    // tick when surfaced flipped; null while unsurfaced.
  });
  export type InheritedSecret = z.infer<typeof InheritedSecretSchema>;

  export const BloodFeudSchema = z.object({
    id: BloodFeudIdSchema,
    offendingHouseId: HouseIdSchema,          // the rival house picked at surfacing
    triggeringSecretId: InheritedSecretIdSchema, // FK to the InheritedSecret that surfaced into this feud
    triggeringGrievanceId: GrievanceIdSchema,    // FK to the casus-belli Grievance minted at surfacing (resolves cycle-2-iter-3 B2)
    incurredAtTick: z.number().int().nonnegative(),
    resolved: z.boolean(),                    // ONE-WAY LATCH — flipped by duel resolution (covers satisfaction-demanded duel-mint path) OR generational-decay tick threshold
    resolvedAtTick: z.number().int().nonnegative().nullable(),  // tick of resolution; null while active
    resolutionKind: z.enum(["DuelWin", "DuelLoss", "GenerationalDecay"]).nullable(),  // null while active. SatisfactionDemanded dropped at cycle-2-iter-4 — satisfaction paths flow through duel resolution at v1.
  });
  export type BloodFeud = z.infer<typeof BloodFeudSchema>;

  // Existing HouseSchema widens (three new array fields, .default([]) backfill):
  // (in HouseSchema definition block, after the existing P8 `factionId` field)
  //   siblingRivals: z.array(SiblingRivalStateSchema).default([]),
  //   inheritedSecrets: z.array(InheritedSecretSchema).default([]),
  //   bloodFeuds: z.array(BloodFeudSchema).default([]),
  ```

- **Designer constants** (`src/game/constants.ts` — per CLAUDE.md "Designer constants in one place" §10). All values pinned with proximity comments citing spec §3 lines:
  ```ts
  // src/game/constants.ts (P11 ADDITIONS, grouped block):

  // --- Sibling-Rival promotion + action loop (spec §3 lines 480-485) ---

  /** Affection-delta threshold for sibling-rival promotion at succession (spec §3 line 480).
   *  Sibling whose (affection toward dead head − affection toward new heir) ≥ this value is promoted. */
  // SIBLING_RIVAL_PROMOTION_THRESHOLD retired at cycle-2-iter-7 (affection-delta formula
  // non-derivable from house-keyed affectionMap; replaced by trait-modified baseline).
  export const SIBLING_RIVAL_PROMOTION_BASELINE_HOSTILITY = 50;
  export const SIBLING_RIVAL_TRAIT_HOSTILITY_JADED = 15;
  export const SIBLING_RIVAL_TRAIT_HOSTILITY_AMBITIOUS = 15;
  export const SIBLING_RIVAL_TRAIT_HOSTILITY_CUNNING = 10;
  export const SIBLING_RIVAL_TRAIT_HOSTILITY_PIOUS = -10;

  /** Per-action hostility decay (spec §3 line 483). */
  export const SIBLING_RIVAL_HOSTILITY_PER_ACTION = -2;

  /** Failed-reconciliation hostility delta (spec §3 line 483). */
  export const SIBLING_RIVAL_HOSTILITY_PER_FAILED_RECONCILIATION = 5;

  /** Action cooldown (spec §3 line 481): rivals act only when currentTick − lastActionTick ≥ this. */
  export const SIBLING_RIVAL_ACTION_COOLDOWN_TICKS = 5;

  /** Reconciliation costs (spec §3 line 485). */
  export const SIBLING_RIVAL_RECONCILIATION_WEALTH_COST = 50;
  export const SIBLING_RIVAL_RECONCILIATION_REPUTATION_COST = 10;

  /** Reconciliation success-probability slope endpoints (spec §3 line 485 "inverse hostility").
   *  P(success) = SUCCESS_AT_HOSTILITY_0 + (hostility / 100) × (SUCCESS_AT_HOSTILITY_100 − SUCCESS_AT_HOSTILITY_0).
   *  i.e., 0.9 at hostility 0 (almost guaranteed; auto-reconciliation fires anyway) down to 0.1 at hostility 100. */
  export const SIBLING_RIVAL_RECONCILIATION_SUCCESS_AT_HOSTILITY_0 = 0.9;
  export const SIBLING_RIVAL_RECONCILIATION_SUCCESS_AT_HOSTILITY_100 = 0.1;

  /** Hostility cap (spec §3 line 483 "clamped [0, 100]"). */
  export const SIBLING_RIVAL_HOSTILITY_MAX = 100;
  export const SIBLING_RIVAL_HOSTILITY_MIN = 0;

  /** Initial hostility at promotion: derived inline by `deriveInitialHostility(character)`
   *  in src/game/rules/siblingRivals.ts, summing SIBLING_RIVAL_PROMOTION_BASELINE_HOSTILITY (50)
   *  with per-trait modifiers (Jaded +15, Ambitious +15, Cunning +10, Pious -10), then clamping
   *  to [1, SIBLING_RIVAL_HOSTILITY_MAX]. The `min 1` floor ensures every promoted sibling gets
   *  at least one cooldown-eligible action before auto-reconciliation at hostility 0 could fire.
   *  Earlier draft used a `SIBLING_RIVAL_PROMOTION_THRESHOLD` + affection-delta formula —
   *  retired at cycle-2-iter-7 because affectionMap is house-keyed (resolved). */

  /** Action-pool weights (spec §3 line 482, ordered heaviest → lightest).
   *  Sum is intentional ≤ 100 to permit "no action this tick" as a non-event branch (1.0 sum would force action every cooldown-eligible tick — too punishing). */
  export const SIBLING_RIVAL_ACTION_WEIGHTS = {
    GamblingDebt: 40,    // heaviest — direct wealth drain
    LeakSecret: 30,      // mid — generates inbound whisper about player
    PettySabotage: 20,   // mid — per-tick reputation drain
    AutoSabotageScheme: 10,  // lightest — auto-starts a player-targeted Sabotage scheme (uses P8 skipWealthDeduction)
  } as const;
  // Module-load assertion: every weight > 0; total ≤ 100 (currently 100; "no action" branch never fires).

  /** GamblingDebt action effect: wealth drain per fire. */
  export const SIBLING_RIVAL_GAMBLING_DEBT_WEALTH_DRAIN = 15;

  /** PettySabotage action effect: reputation drain per fire. */
  export const SIBLING_RIVAL_PETTY_SABOTAGE_REPUTATION_DRAIN = 2;

  /** LeakSecret action: produces a synthetic inbound Whisper (subject = player head, source = sibling).
   *  No magnitude constant — the whisper enters at verificationProgress: 0 and uses the existing P6 progress
   *  cadence. The "leak" is delivery-into-the-ledger, not damage magnitude. */

  // --- Inherited-Secrets ledger (spec §3 lines 498-503; §8 line 685) ---

  /** Ledger bound per §8 line 685 ("a fixed maximum of most-recent entries; older entries collapse into the ancestor summary").
   *  Twelve is enough to span ~3 generations of typical play without bloating the save format. */
  export const MAX_INHERITED_SECRETS = 12;

  /** Per-tick surfacing probability per active (unsurfaced) inherited-secret (spec §3 line 501 "small per-tick probability (sub-percent)").
   *  Basis points format (P10 FORGERY_SURFACING_PROBABILITY_BASIS_POINTS precedent): 50 / 10000 = 0.5%.
   *  Iterates over House.inheritedSecrets where surfacedAgainstHouseId === null. */
  export const INHERITED_SECRET_SURFACING_PROBABILITY_BASIS_POINTS = 50;

  /** Hostility threshold for "hostile rival" picker eligibility (spec §3 line 501; §7 line 655 codification).
   *  Surfacing roll picks lex-smallest rival HouseId among rivals with hostility ≥ this value. If none qualify,
   *  the roll is a MISSED ROLL — the secret stays active for a future roll (§7 line 655 edge case). */
  export const BLOOD_FEUD_RIVAL_HOSTILITY_THRESHOLD = 40;

  /** Affection penalty applied to ALL rival-associated characters at feud surfacing (spec §3 line 502 "large affection delta"). */
  export const BLOOD_FEUD_AFFECTION_PENALTY_PER_ASSOCIATE = 20;

  /** Generational-decay resolution: feud auto-resolves N ticks after surfacing if not duel-resolved earlier.
   *  Pinned to 50 (≈ 2 in-game years at the current tick:year mapping; long enough to feel multi-generational, short enough to clear before the next surfacing on the same secret would naturally fire). */
  export const BLOOD_FEUD_DECAY_TICKS_MAX = 50;
  ```
  Module-load assertions live alongside the constants block (e.g., `if (Object.values(SIBLING_RIVAL_ACTION_WEIGHTS).some((w) => w <= 0)) throw …`).

- **`GRIEVANCE_SOURCES` widening at `src/game/constants.ts:305`.** Changes from `["Sabotage", "FauxPas"] as const` to `["Sabotage", "FauxPas", "BloodFeud"] as const`. Strict TS will then require every exhaustive switch over `GrievanceSource` to handle the new variant. Audit sites (resolved via typecheck — no source-grep needed):
  ```bash
  # Find exhaustive switches/maps over GrievanceSource that need a new arm:
  rg -n "GrievanceSource" src/ --type ts | rg -v "test\.ts|spec\.ts"
  ```
  Expected additions: P14 ledger renderer (later phase — stub the BloodFeud arm now as a passthrough), any rules-layer code that filters grievances by source.

- **Pure-rule modules** — TWO new files:
  ```ts
  // src/game/rules/siblingRivals.ts (NEW at P11) — exports:
  export function promoteEligibleSiblingsAtSuccession(state: GameState, deadHeadId: CharacterId, newHeirId: CharacterId): GameState;
  export function applySiblingRivalActionPhase(state: GameState): GameState;
  // Body sketch (resolves cycle-3-iter-1 B1):
  //
  //   export function applySiblingRivalActionPhase(state: GameState): GameState {
  //     const playerHouse = state.houses.get(PLAYER_HOUSE_ID);
  //     if (playerHouse === undefined) return state;
  //     if (playerHouse.siblingRivals.length === 0) return state;
  //     // Lex-sort actors by id for deterministic per-tick draw order (CLAUDE.md pin).
  //     const sortedActors = [...playerHouse.siblingRivals].sort((a, b) => a.id.localeCompare(b.id));
  //     // Single per-house RNG (R1 decision — sibling-rivals share state.rng["player"]).
  //     // Each cooldown-eligible actor draws ONCE for action-pool selection.
  //     // Per CLAUDE.md "cooldown burns on ALL outcomes" (P8 pin inherited): lastActionTick advances even on a Skipped/no-eligible-target action.
  //     let acc = state;
  //     for (const actor of sortedActors) {
  //       if (actor.reconciled) continue;
  //       if (state.tick - actor.lastActionTick < SIBLING_RIVAL_ACTION_COOLDOWN_TICKS) continue;
  //       // Draw weighted action using the live drawNext pattern (resolves cycle-3-iter-3 B1
  //       // + cycle-3-iter-4 B1 — `drawWeighted` does NOT exist; `pickByScaledWeight` at
  //       // `src/game/rules/rivals.ts:112-122` is rival-specific (hardcoded `RivalActionKind`
  //       // return + `?? "LeakWhisper"` fallback), so it CANNOT be reused for sibling rivals
  //       // without parameterization. P11 ships an INDEPENDENT module-local helper in
  //       // siblingRivals.ts with the same shape but a sibling-specific kind enum + fallback.
  //       // Also: `computeEffectiveWeights` at rivals.ts is rival/faction-aware; siblings have
  //       // no equivalent — the weight table is the canonical scaled-weights source. The
  //       // module-local `computeCumulativeSiblingWeights` computes the partial-sum array.
  //
  //       const playerRng = acc.rng.get(PLAYER_HOUSE_ID)!;
  //       const { next: roll, rngState: newRng } = drawNext(playerRng);
  //       acc = { ...acc, rng: new Map(acc.rng).set(PLAYER_HOUSE_ID, newRng) };
  //
  //       // Module-local helpers in src/game/rules/siblingRivals.ts:
  //       // function computeCumulativeSiblingWeights(): readonly number[] {
  //       //   // Partial sums in the lex-stable kind order GamblingDebt < LeakSecret < PettySabotage < AutoSabotageScheme.
  //       //   const w = SIBLING_RIVAL_ACTION_WEIGHTS;
  //       //   return [w.GamblingDebt, w.GamblingDebt + w.LeakSecret, w.GamblingDebt + w.LeakSecret + w.PettySabotage, w.GamblingDebt + w.LeakSecret + w.PettySabotage + w.AutoSabotageScheme];
  //       // }
  //       // function pickSiblingActionByScaledWeight(cum: readonly number[], rollScaled: number): SiblingRivalActionKind {
  //       //   if (rollScaled < cum[0]) return "GamblingDebt";
  //       //   if (rollScaled < cum[1]) return "LeakSecret";
  //       //   if (rollScaled < cum[2]) return "PettySabotage";
  //       //   return "AutoSabotageScheme";  // explicit fallback — no `??` games
  //       // }
  //       const cum = computeCumulativeSiblingWeights();
  //       const rollScaled = Math.floor(roll * cum[cum.length - 1]);
  //       const pickedKind: SiblingRivalActionKind = pickSiblingActionByScaledWeight(cum, rollScaled);
  //       // Dispatch by action kind via dispatchSiblingRivalAction (B2 — sketched below).
  //       acc = dispatchSiblingRivalAction(acc, actor, pickedKind);
  //       // Hostility decay -2 per fired action (clamped). Cooldown advances unconditionally.
  //       // `updateSiblingRivalActor` is a module-local helper in siblingRivals.ts — pure clone-and-write-back
  //       // matching the aging.ts Branch 5 lazy-clone precedent. Signature:
  //       //   function updateSiblingRivalActor(
  //       //     state: GameState,
  //       //     actorId: SiblingRivalActorId,
  //       //     patch: Partial<Pick<SiblingRivalState, "hostility" | "lastActionTick" | "reconciled">>,
  //       //   ): GameState {
  //       //     const playerHouse = state.houses.get(PLAYER_HOUSE_ID);
  //       //     if (playerHouse === undefined) return state;
  //       //     const idx = playerHouse.siblingRivals.findIndex((sr) => sr.id === actorId);
  //       //     if (idx === -1) return state;
  //       //     const newSiblingRivals = [...playerHouse.siblingRivals];
  //       //     newSiblingRivals[idx] = { ...newSiblingRivals[idx], ...patch };
  //       //     return {
  //       //       ...state,
  //       //       houses: new Map(state.houses).set(PLAYER_HOUSE_ID, { ...playerHouse, siblingRivals: newSiblingRivals }),
  //       //     };
  //       //   }
  //       acc = updateSiblingRivalActor(acc, actor.id, {
  //         hostility: Math.max(SIBLING_RIVAL_HOSTILITY_MIN, Math.min(SIBLING_RIVAL_HOSTILITY_MAX, actor.hostility + SIBLING_RIVAL_HOSTILITY_PER_ACTION)),
  //         lastActionTick: state.tick,
  //       });
  //       // Auto-reconciliation check (spec §3 line 484).
  //       const after = acc.houses.get(PLAYER_HOUSE_ID)!.siblingRivals.find((sr) => sr.id === actor.id)!;
  //       if (after.hostility === 0) {
  //         acc = updateSiblingRivalActor(acc, actor.id, { reconciled: true });
  //         // Direct-publish via bus subscribers happens at wrapper layer; phase body stays pure.
  //       }
  //     }
  //     return acc;
  //   }
  //
  // **`dispatchSiblingRivalAction` body sketch (resolves cycle-3-iter-3 B2).** Pure function — applies
  // the selected action's mutation to GameState and returns new state. NEVER advances RNG (the action-pool
  // draw already happened in the caller); GamblingDebt/PettySabotage are deterministic given the picked
  // kind; LeakSecret + AutoSabotageScheme have downstream RNG consumers (makeWhisperId is index-counted,
  // not RNG-drawn; tryStartScheme has its own internal scheme-id factory which is index-counted too).
  //
  //   function dispatchSiblingRivalAction(
  //     state: GameState,
  //     actor: SiblingRivalState,
  //     pickedKind: SiblingRivalActionKind,
  //   ): GameState {
  //     const playerHouse = state.houses.get(PLAYER_HOUSE_ID);
  //     if (playerHouse === undefined) return state;
  //     switch (pickedKind) {
  //       case "GamblingDebt": {
  //         // Wealth drain (no clamp — wealth is unbounded per CLAUDE.md).
  //         const newPlayer = { ...playerHouse, wealth: playerHouse.wealth - SIBLING_RIVAL_GAMBLING_DEBT_WEALTH_DRAIN };
  //         return { ...state, houses: new Map(state.houses).set(PLAYER_HOUSE_ID, newPlayer) };
  //       }
  //       case "PettySabotage": {
  //         // Reputation drain (clamped [0, 100] per CLAUDE.md "Clamp at every mutation site").
  //         const newRep = Math.max(0, Math.min(100, playerHouse.reputation - SIBLING_RIVAL_PETTY_SABOTAGE_REPUTATION_DRAIN));
  //         const newPlayer = { ...playerHouse, reputation: newRep };
  //         return { ...state, houses: new Map(state.houses).set(PLAYER_HOUSE_ID, newPlayer) };
  //       }
  //       case "LeakSecret": {
  //         // Mint inbound Whisper. The literal MUST populate every WhisperSchema field (14 total at
  //         // src/game/entities.ts:254-269 — resolves cycle-3-iter-4 B2). makeWhisperId is index-counted
  //         // (walks state.whispers.values() — NOT RNG-drawn). Whisper status = Unverified; progress = 0;
  //         // verification cadence + cross-house transit handled by existing P6 whispers + courier phases.
  //         //
  //         // Destination: PLAYER_HOUSE_ID (the leak is INBOUND to the player house). arrivedAtTick = null
  //         // (courier in-flight; existing courier phase will set on arrival). weaponizedAs/weaponizedAtTick
  //         // null until the player decides to weaponize (P6 player action). scandalSheetAttribution null until
  //         // the scandal-sheet branch fires. accidentalSlipDripsRemaining = 0 (set by accidental-slip branch
  //         // only). llmGenerated = false (deterministic seed text; P18 LLM rewriting is a separate path).
  //         const whisperId = makeWhisperId(state, actor.characterId, playerHouse.headOfHouseCharacterId);
  //         const actorChar = state.characters.get(actor.characterId);
  //         const actorName = actorChar?.name ?? actor.characterId;  // fallback to id if char missing (defensive)
  //         // Sibling-rival is IN the player house (intra-house leak); no courier transit needed.
  //         // arrivedAtTick = state.tick (immediate delivery) — resolves cycle-3-iter-6 B2.
  //         // Verified live: whispers.ts:213-217 sets arrivedAtTick only when a CourierPayload exists;
  //         // whispers.ts:192 verification cadence gates on arrivedAtTick !== null. Setting it
  //         // directly here is the "same-house, no transit" precedent — no CourierPayload mint needed.
  //         const whisper: Whisper = {
  //           id: whisperId,
  //           text: `${actorName} leaks gossip about the head of house.`,  // P18 LLM may rewrite via llmGenerated path later
  //           originatingTick: state.tick,
  //           sourceCharacterId: actor.characterId,
  //           subjectCharacterId: playerHouse.headOfHouseCharacterId,
  //           destinationHouseId: PLAYER_HOUSE_ID,
  //           arrivedAtTick: state.tick,    // intra-house leak — immediate
  //           verificationProgress: 0,
  //           status: "Unverified",
  //           weaponizedAs: null,
  //           weaponizedAtTick: null,
  //           scandalSheetAttribution: null,
  //           accidentalSlipDripsRemaining: 0,
  //           llmGenerated: false,
  //         };
  //         return { ...state, whispers: new Map(state.whispers).set(whisperId, whisper) };
  //       }
  //       case "AutoSabotageScheme": {
  //         // Auto-start a Sabotage scheme against the player house. Verified live (resolves cycle-4-iter-2 B1):
  //         //   tryStartScheme(state, ownerHouseId, input) — 2nd arg is HouseId NOT CharacterId (src/game/rules/schemes.ts:185).
  //         //   SelfTarget gate at schemes.ts:272-274 rejects when `target.houseId === ownerHouseId`.
  //         // Sibling-rivals live IN the player house targeting the player head — intra-house Sabotage is the
  //         // entire point of the action. P11 widens `StartSchemeInput` with TWO new flags following the P8
  //         // `skipWealthDeduction` precedent:
  //         //   - skipWealthDeduction: true  (already shipped at P8 — applies to player-house ownership too)
  //         //   - skipSelfTargetGate: true   (NEW at P11 — bypasses the SelfTarget rejection for intra-house auto-sabotage)
  //         // The flag is FALSE by default; player-elected `startScheme` never sets it. Only the sibling-rival
  //         // action-roller fires Sabotage with the flag set.
  //         // selectAggressor concern (resolves cycle-4-iter-2 R14): tryStartScheme's internal selectAggressor
  //         // picks by archetype filters. For intra-house Sabotage, P11 also widens `StartSchemeInput` with:
  //         //   - explicitAggressorCharacterId?: CharacterId  (NEW at P11 — overrides selectAggressor when set)
  //         // Sibling-rival passes its own characterId as the explicitAggressor. Player-elected paths leave
  //         // the field unset and selectAggressor runs as normal.
  //         const result = tryStartScheme(state, PLAYER_HOUSE_ID, {
  //           kind: "Sabotage",
  //           targetCharacterId: playerHouse.headOfHouseCharacterId,
  //           skipWealthDeduction: true,
  //           skipSelfTargetGate: true,
  //           explicitAggressorCharacterId: actor.characterId,
  //         });
  //         return result.ok ? result.state : state;
  //       }
  //     }
  //   }
  //
  // **`SiblingRivalActionKind` type** (exported alongside SIBLING_RIVAL_ACTION_WEIGHTS):
  //   export type SiblingRivalActionKind = "GamblingDebt" | "LeakSecret" | "PettySabotage" | "AutoSabotageScheme";
  // Derives from `keyof typeof SIBLING_RIVAL_ACTION_WEIGHTS` at compile time.
  //
  // Per-tick PRNG draw budget: at most N draws per tick where N = `playerHouse.siblingRivals.length`
  // that are cooldown-eligible AND not reconciled. AutoSabotageScheme branches add 1-2 more draws
  // via tryStartScheme's internal id-counter + target-pick logic (matches P8 rival-action draw shape).

  // Reconciliation outcome envelope — matches applyProposalPure precedent
  // **Single concrete signature (resolves cycle-1-iter-2 B8 + cycle-2-iter-4 B2 + cycle-3-iter-1 B3).**
  //
  // Return type is ALWAYS the 2-field envelope `{ nextState: GameState; outcome: ReconciliationOutcome }`.
  // The OUTER envelope NEVER has an `ok` field. The discriminator lives ONLY on the INNER `outcome`.
  //
  // Three semantically distinct outcome variants:
  //   1. Eligibility passed + reconciliation succeeded:
  //      outcome = { ok: true, kind: "Success", flippedToReconciled: true }
  //      nextState = post-cost-deduction + hostility=0 + reconciled=true mutations applied.
  //   2. Eligibility passed + reconciliation rolled to failure:
  //      outcome = { ok: true, kind: "Failure", hostilityBumpedBy: 5 }
  //      nextState = post-cost-deduction + hostility+=5 mutations applied (still no flip-to-reconciled).
  //   3. Eligibility failed (gates: no active sibling-rival, already reconciled, insufficient wealth, wrong location, PlayerExiled, ElopementInProgress):
  //      outcome = { ok: false, reason: ReconciliationRejection-discriminated-union }
  //      nextState = input state UNCHANGED (no cost deduction, no mutations).
  //
  // Matches the applyProposalPure envelope precedent (verified at src/game/rules/proposal.ts:72-75).
  // The store-action wrapper inspects `outcome.ok` first (and on `true`, `outcome.kind`) to decide:
  // (a) whether to advance the tick (only on `outcome.ok === true`), (b) whether to direct-publish
  // SiblingRivalReconciled (only on `outcome.ok === true && outcome.kind === "Success"`).
  export function applyReconciliationAttempt(
    state: GameState,
    siblingCharacterId: CharacterId,
  ): { nextState: GameState; outcome: ReconciliationOutcome };

  export type ReconciliationOutcome =
    | { ok: true; kind: "Success"; flippedToReconciled: true }
    | { ok: true; kind: "Failure"; hostilityBumpedBy: number }
    | { ok: false; reason: ReconciliationRejection };

  // Rejection union (B9 — Modal-state gate folds in):
  export type ReconciliationRejection =
    | { kind: "NoActiveSiblingRival" }
    | { kind: "AlreadyReconciled" }
    | { kind: "InsufficientWealth"; have: number; need: number }    // matches majority precedent (artifacts.ts, elopement.ts, schemes.ts, etc. all use {have, need})
    | { kind: "WrongLocation"; current: LocationId }                 // matches bankruptcyEscape.ts:12 precedent; "high-society location" = LocationId === "Capital" (verified src/game/fixtures/locations.ts)
    | { kind: "PlayerExiled" }               // CLAUDE.md P6 pin
    | { kind: "ElopementInProgress" };       // CLAUDE.md P9 pin

  // ID factory lives in src/game/fixtures/siblingRivalIdFactory.ts (see "New branded IDs" section).

  // src/game/rules/inheritedSecrets.ts (NEW at P11) — exports:
  // Note 3-arg signature (resolves cycle-1-iter-2 R3) — call site passes (deadHeadId, newHeirId)
  // because the accumulation step reads whispers about the dead head's lineage AND filters out
  // whispers about post-succession heirs (the new heir's whisper history is "current generation",
  // not "inherited"). The playerHouseId is read from state.characters[deadHeadId].houseId inline.
  export function accumulateInheritedSecretsAtSuccession(
    state: GameState,
    deadHeadId: CharacterId,
    newHeirId: CharacterId,
  ): GameState;
  export function applyInheritedSecretSurfacingPhase(state: GameState): GameState;
  // Generational-decay is folded INTO applyInheritedSecretSurfacingPhase (resolves cycle-1-iter-2 R8).
  // Per-feud decay walk runs FIRST in the phase body (before the new-surfacing roll), so the same
  // tick can both resolve an expired feud AND open a new one without state-ordering ambiguity.
  // Resolves cycle-2-iter-3 B3 — body sketch:
  //
  //   export function applyInheritedSecretSurfacingPhase(state: GameState): GameState {
  //     // (1) Walk active feuds, flip to Resolved if tick - incurredAtTick >= BLOOD_FEUD_DECAY_TICKS_MAX.
  //     const playerHouse = state.houses.get(PLAYER_HOUSE_ID);
  //     if (playerHouse === undefined) return state;
  //     let newBloodFeuds: BloodFeud[] | null = null;
  //     for (let i = 0; i < playerHouse.bloodFeuds.length; i++) {
  //       const bf = playerHouse.bloodFeuds[i];
  //       if (bf.resolved) continue;
  //       if (state.tick - bf.incurredAtTick >= BLOOD_FEUD_DECAY_TICKS_MAX) {
  //         newBloodFeuds ??= [...playerHouse.bloodFeuds];
  //         newBloodFeuds[i] = { ...bf, resolved: true, resolvedAtTick: state.tick, resolutionKind: "GenerationalDecay" };
  //       }
  //     }
  //     // (2) Per-unsurfaced-secret roll (resolves cycle-3-iter-6 B1).
  //     // Iteration order: lex-sort by InheritedSecret.id for deterministic draw order.
  //     // Per-iteration accumulator pattern (CLAUDE.md P6 "per-iteration multi-Map accumulator").
  //     let accBloodFeuds: BloodFeud[] = newBloodFeuds ?? [...playerHouse.bloodFeuds];
  //     let accGrievances: Grievance[] = [...playerHouse.grievances];
  //     let accSecrets: InheritedSecret[] = [...playerHouse.inheritedSecrets];
  //     let accCharacters: Map<CharacterId, Character> | null = null;
  //     let accRng: RngState = state.rng.get(PLAYER_HOUSE_ID)!;
  //     const accAffectionMap: Map<ConversationPairKey, number> = new Map(state.affectionMap);
  //     const unsurfacedSecrets = [...playerHouse.inheritedSecrets]
  //       .filter((s) => s.surfacedAgainstHouseId === null)
  //       .sort((a, b) => a.id.localeCompare(b.id));
  //     for (const secret of unsurfacedSecrets) {
  //       // (2a) Per-secret roll against sub-percent surfacing probability.
  //       const { next: roll, rngState: newRng } = drawNext(accRng);
  //       accRng = newRng;
  //       const rollBp = Math.floor(roll * 10000);
  //       if (rollBp >= INHERITED_SECRET_SURFACING_PROBABILITY_BASIS_POINTS) continue;
  //       // (2b) Picker pool walk — lex-smallest of RIVAL_HOUSE_IDS_SET ∩ hostility ≥ threshold.
  //       const eligibleRivalIds = [...RIVAL_HOUSE_IDS_SET]
  //         .filter((rid) => (state.houses.get(rid)?.hostility ?? 0) >= BLOOD_FEUD_RIVAL_HOSTILITY_THRESHOLD)
  //         .sort();
  //       if (eligibleRivalIds.length === 0) {
  //         // §7 line 655 missed roll — secret stays active for a future tick.
  //         continue;
  //       }
  //       const picked = eligibleRivalIds[0];
  //       // (2c) Flip secret to surfaced. Lex-sort + index-in-place mutation on accSecrets.
  //       const secretIdx = accSecrets.findIndex((s) => s.id === secret.id);
  //       accSecrets[secretIdx] = {
  //         ...accSecrets[secretIdx],
  //         surfacedAgainstHouseId: picked,
  //         surfacedAtTick: state.tick,
  //       };
  //       // (2d) Two writes (per "Goal" pin): mint Grievance + mint BloodFeud, linked via triggeringGrievanceId.
  //       // Grievance id uses the inline template-literal precedent (verified store.ts:934 + schemes.ts:471).
  //       // No `makeGrievanceId` factory exists — id is `${perpetratorHouseId}:${source}:${tick}:${index-in-tick}`.
  //       // Index-in-tick is computed by walking acc grievances for matching perpetrator+source+tick combinations.
  //       const grievanceInTickIdx = accGrievances.filter(
  //         (g) => g.perpetratorHouseId === picked && g.source === "BloodFeud" && g.recordedAtTick === state.tick
  //       ).length;
  //       const grievanceId = `${picked}:BloodFeud:${state.tick}:${grievanceInTickIdx}` as GrievanceId;
  //       // Live GrievanceSchema (src/game/entities.ts:63-76) — fields: id, perpetratorHouseId, defendantCharacterId,
  //       // source, schemeId (nullable; null for non-Sabotage sources per the schema comment), recordedAtTick, resolved.
  //       // BloodFeud grievance has no individual defendant; rival head can be selected by a P-later
  //       // "challenge head" path. schemeId = null (no Sabotage scheme backing). resolved = false at mint.
  //       const grievance: Grievance = {
  //         id: grievanceId,
  //         perpetratorHouseId: picked,
  //         defendantCharacterId: null,
  //         source: "BloodFeud",
  //         schemeId: null,
  //         recordedAtTick: state.tick,
  //         resolved: false,
  //       };
  //       accGrievances.push(grievance);
  //       const feudId = makeBloodFeudId(secret.id, picked, state.tick);
  //       const feud: BloodFeud = {
  //         id: feudId,
  //         offendingHouseId: picked,
  //         triggeringSecretId: secret.id,
  //         triggeringGrievanceId: grievanceId,
  //         incurredAtTick: state.tick,
  //         resolved: false,
  //         resolvedAtTick: null,
  //         resolutionKind: null,
  //       };
  //       accBloodFeuds.push(feud);
  //       // (2e) Affection-penalty walk — every associate of `picked` rival house drops affection toward
  //       // the PLAYER HEAD. Key direction (resolves cycle-4-iter-1 B1): `makePairKey(rivalHouseId, playerHead)`
  //       // encodes "how the rival's house feels about the player head" — matches P10's `makePairKey(ch.houseId,
  //       // playerHead)` precedent at artifacts.ts:399 (Vain NPC drops affection toward player). The inverted
  //       // direction `makePairKey(PLAYER_HOUSE_ID, associateId)` would encode "player's affection toward
  //       // the associate" — the wrong way per spec §3 line 502 ("rival's associates drop affection toward player").
  //       const rivalActor = state.rivalActors.get(picked);
  //       if (rivalActor !== undefined) {
  //         const playerHead = playerHouse.headOfHouseCharacterId;
  //         // NOTE: even though every associate is in the SAME rival house, we still pass `picked` (the rival's
  //         // houseId) — the per-house affectionMap is keyed at the (rival-house, player-head) granularity.
  //         // The walk decreases ONE affectionMap entry per rival house (not per associate); we touch it ONCE.
  //         const key = makePairKey(picked, playerHead);
  //         const current = accAffectionMap.get(key) ?? 0;
  //         const delta = BLOOD_FEUD_AFFECTION_PENALTY_PER_ASSOCIATE * rivalActor.associatedCharacterIds.length;
  //         accAffectionMap.set(key, Math.max(0, Math.min(100, current - delta)));
  //         // Rationale for the per-associate-count scaling: spec §3 line 502 says "all of its associated
  //         // characters drop a large affection delta toward the player" — per-associate magnitude scaling
  //         // preserves the spec semantics under the single-key affectionMap shape.
  //       }
  //     }
  //     // (3) Single write-back of player house with updated arrays + RNG + affectionMap.
  //     const newPlayerHouse: House = {
  //       ...playerHouse,
  //       bloodFeuds: accBloodFeuds,
  //       grievances: accGrievances,
  //       inheritedSecrets: accSecrets,
  //     };
  //     return {
  //       ...state,
  //       houses: new Map(state.houses).set(PLAYER_HOUSE_ID, newPlayerHouse),
  //       rng: new Map(state.rng).set(PLAYER_HOUSE_ID, accRng),
  //       affectionMap: accAffectionMap,
  //     };
  //   }
  //
  // **Per-tick PRNG draw budget**: ONE draw per unsurfaced inherited-secret per tick (capped at MAX_INHERITED_SECRETS = 12).
  // Cap is tight enough that the surfacing phase consumes at most 12 player-house PRNG draws per tick. Per-feud-decay walk
  // consumes zero RNG draws (pure tick-delta check).

  // BloodFeud → Grievance wiring at duel resolution (resolves cycle-2-iter-3 B2 + cycle-2-iter-4 B1).
  //
  // **Correction on call sites**: `demandSatisfaction` is a STORE WRAPPER at `src/game/store.ts:1413` (NOT
  // a separate `src/game/rules/satisfaction.ts` module — verified via grep). Satisfaction-demanded paths
  // chain into duel resolution via that wrapper. Therefore BloodFeud resolution has a SINGLE wiring site:
  // inside `src/game/rules/duel.ts:resolveDuel`, after the existing grievance-resolved flip at line 178-180.
  // The wrapper's role is only to MINT the duel; the grievance + feud flip both happen at duel resolution.
  //
  // Concrete: `resolveDuel` extends to walk `playerHouse.bloodFeuds` for any feud where
  // `triggeringGrievanceId === grievanceId` AND `!resolved`, and flip
  // `{ resolved: true, resolvedAtTick: state.tick, resolutionKind: <derived from outcome> }`.
  //
  // **`SatisfactionDemanded` enum value motivation**: since satisfaction-demanded IS duel resolution at v1
  // (the only path to invoke `demandSatisfaction` produces a duel), `SatisfactionDemanded` is REDUNDANT
  // with `DuelWin`/`DuelLoss`. Plan PINS the v1 simplification: drop `SatisfactionDemanded` from the
  // resolutionKind enum. Final shape:
  //   resolutionKind: z.enum(["DuelWin", "DuelLoss", "GenerationalDecay"]).nullable();
  //
  // Future P-later phases that introduce non-duel resolution paths (e.g., a P-later "Public Apology"
  // action that resolves grievances without a duel) widen the enum then. v1 ships with 3 values.
  //
  // **Schema addition**: `BloodFeud.triggeringGrievanceId: GrievanceIdSchema` links the feud to its
  // casus-belli grievance. The two writes at surfacing time produce BOTH entities AND set the link:
  //   const grievance = makeGrievance({ source: "BloodFeud", ... });
  //   const feud = { ..., triggeringGrievanceId: grievance.id };
  //   playerHouse.grievances.push(grievance);
  //   playerHouse.bloodFeuds.push(feud);
  //
  // Resolution helpers exported from src/game/rules/inheritedSecrets.ts:
  //
  //   export function resolveBloodFeudByGrievance(
  //     state: GameState,
  //     grievanceId: GrievanceId,
  //     resolutionKind: Extract<BloodFeud["resolutionKind"], "DuelWin" | "DuelLoss">,
  //   ): GameState;
  //
  // Called ONLY from `src/game/rules/duel.ts:resolveDuel` after the grievance-resolved flip.
  // (Satisfaction-demanded paths flow through duel resolution per the iter-4 pin above; the store
  // wrapper at `src/game/store.ts:1413:demandSatisfaction` mints the duel and the resolution flips
  // both Grievance.resolved and BloodFeud.resolved via this single helper call site.)
  // The decay walk is cheap (per-feud tick-delta check) and benefits from running on the same RNG
  // draw budget as surfacing for replay-stability.

  // ID factories live in src/game/fixtures/inheritedSecretIdFactory.ts and
  // src/game/fixtures/bloodFeudIdFactory.ts (see "New branded IDs" section).
  ```
  Both files follow the CLAUDE.md "Pure-rule structural-sharing contract" (return new state via hand-rolled shallow Map clones + spread; never mutate input; never use Immer inside `src/game/rules/**`).

  **Sibling-rival vs cross-house rival distinction** (resolves B5 framing): `src/game/rules/rivals.ts` ships at P8 for CROSS-HOUSE rival actors (Ashford / Beaumont / Cavendish — registered in `RIVAL_HOUSES_FIXTURE`). `src/game/rules/siblingRivals.ts` ships at P11 for INTRA-HOUSE autonomous actors (promoted siblings of the player house). The two systems share a `weighted-roll-from-pool` shape but operate on disjoint state regions:
  - `rivals.ts` reads `state.rivalActors` (top-level Map, P8) and per-rival `state.rng[rivalHouseId]` entries.
  - `siblingRivals.ts` reads `house.siblingRivals` (per-house array, P11) and the SHARED player-house `state.rng["player"]` PRNG (R1 decision — see below).

  **Per-rival RNG seeding decision (R1).** Sibling-rival actors share the player house's RNG (`state.rng["player"]`) rather than minting per-actor RNG entries. Rationale:
  1. Sibling-rivals only exist within the player house (single-dynasty internal antagonist); a per-actor RNG would multiply seeded entries proportionally to dynasty turnover with no determinism benefit.
  2. The action-roller iterates `house.siblingRivals` lex-sorted by id (CLAUDE.md "Lex-sort iteration over identifier Maps" — applied to arrays via `.sort((a, b) => a.id.localeCompare(b.id))` before the consume-RNG loop) so per-tick draw order is deterministic across save/load even on the shared RNG.
  3. The P8 per-rival RNG pattern is appropriate for cross-house rivals (Ashford/Beaumont/Cavendish are independent dynasties); sibling-rivals are intra-dynasty extensions of the player's own RNG context.

- **`pruneOrphanedConversationKeys` death-cascade extension (B7).** TWO new branches added to the existing helper at **`src/game/rules/aging.ts:52`** (resolves cycle-1-iter-2 B1 — verified live: P10 added branches 6/7/8 at lines 194/201/257; P11 extends from branch 9):
  - **Branch 9 (P11)**: when a sibling-rival character dies, drop their entry from the player `house.siblingRivals` array (cleanup pruning). Lazy-clone of `house.siblingRivals` per the existing branch-5 lazy-clone precedent (P9 elopement cleanup). Gated on `playerHouse.siblingRivals.some((sr) => sr.characterId === deadChar.id)` so non-sibling-rival deaths are zero-cost.
  - **Branch 10 (P11)**: when ALL associated-characters of a rival house die (rival house dies-out via cumulative deaths), auto-resolve every Active blood-feud against that house with `resolutionKind: "GenerationalDecay"`. Edge case: if the rival house's `associatedCharacterIds` filters to zero alive after this death, every `bloodFeud.offendingHouseId === rivalHouseId && !bloodFeud.resolved` flips to resolved. Lazy-clone of `house.bloodFeuds`. **Predicate restriction**: this branch only fires when `RIVAL_HOUSE_IDS_SET.has(rivalHouseId)` — correct because the surfacing-phase picker pool is also restricted to `RIVAL_HOUSE_IDS_SET` (see "Picker pool restriction" pin below). Non-rival-house deaths cannot have produced an active feud, so the branch is a no-op for them. This is the death-cascade analog of the §7 line 655 "now-allied rival" semantics — the rival no longer has associates for the affection penalty to bite, so the feud has nothing left to actuate.

    **Iteration source pin (resolves cycle-1-iter-5 B1).** Branch 10 reads `associatedCharacterIds` from the **post-Branch-4 state**, i.e., `(newRivalActors ?? state.rivalActors).get(rivalHouseId)?.associatedCharacterIds` per the P8 lazy-accumulator pattern at `src/game/rules/aging.ts:139-191` (Branch 4 already lazy-clones `state.rivalActors` and writes a pruned `associatedCharacterIds` for the dead character's house). Reading from `newRivalActors` ensures the post-this-tick filter excludes the just-died character that triggered the cascade. The alive check uses `state.characters` (NOT a lazy-cloned newChars — character `alive: false` flips happen in the calling site BEFORE `pruneOrphanedConversationKeys` is invoked, so `state.characters` at helper-entry already reflects the death-set for this call).

    **Call-site contract for alive flips (resolves cycle-2-iter-5 B2 + cycle-2-iter-6 B1).** Every caller of `pruneOrphanedConversationKeys` MUST flip `Character.alive` BEFORE invoking the helper. Verified live callers (3 total, via `grep -rn pruneOrphanedConversationKeys src/game`):
    - `applyAgingStep` (`src/game/rules/aging.ts:335`) — year-pass deaths from age-out. Aging flips `alive: false` on `c.age >= c.deathAge` then calls the helper per dead character.
    - `resolveAssassination` (`src/game/rules/schemes.ts:634`) — tick-phase scheme resolution. Flips target `alive: false` then calls the helper.
    - `resolveDuel` (`src/game/rules/duel.ts:155`) — tick-phase duel terminal resolution. Flips loser `alive: false` then calls the helper.
    - **Note**: P9 elopement-sprint-character death routes through `applyAgingStep` (Branch 5 — sprint cleanup on dead sprint character via the year-pass death cascade). `resolveElopementTerminal` at `src/game/rules/elopement.ts:257` does NOT call the helper directly; it relies on the aging-path to surface dead sprint characters. Future P15+ death-cascade callers MUST adhere to this contract.

    The contract is enforced by a single load-bearing test: `pruneOrphanedConversationKeys.test.ts` constructs a deliberate violation (calls helper without flipping `alive`) and asserts the call produces wrong results — documenting the contract by counter-example. CLAUDE.md amendment candidate at close-out:

    > **`pruneOrphanedConversationKeys` call-site contract: every caller MUST flip `Character.alive = false` BEFORE invoking the helper, so the helper's internal `state.characters[id].alive` reads see the post-death state. Live callers (P11 baseline): `applyAgingStep`, `resolveAssassination`, `resolveDuel`. Every future death-cascade caller adheres to the same contract.**

    Concrete code:
    ```ts
    // src/game/rules/aging.ts — Branch 10 body (P11 ADDITION, after Branch 9):
    if (RIVAL_HOUSE_IDS_SET.has(deadChar.houseId)) {
      // Branch 4 may have lazy-cloned state.rivalActors; read post-Branch-4 state.
      const rivalsView = newRivalActors ?? state.rivalActors;
      const rivalActor = rivalsView.get(deadChar.houseId);
      if (rivalActor !== undefined) {
        // Filter alive associates against state.characters (deaths flipped pre-helper).
        const aliveAssociates = rivalActor.associatedCharacterIds.filter((cid) => {
          const c = state.characters.get(cid);
          return c !== undefined && c.alive;
        });
        if (aliveAssociates.length === 0) {
          // Rival house dies-out. Flip every active feud against this rival to Resolved.
          const playerHouse = (newHouses ?? state.houses).get(PLAYER_HOUSE_ID);
          if (playerHouse !== undefined && playerHouse.bloodFeuds.some(
            (bf) => bf.offendingHouseId === deadChar.houseId && !bf.resolved,
          )) {
            // Lazy-clone state.houses if not already cloned by a prior branch.
            newHouses ??= new Map(state.houses);
            const newPlayerHouse = {
              ...playerHouse,
              bloodFeuds: playerHouse.bloodFeuds.map((bf) =>
                bf.offendingHouseId === deadChar.houseId && !bf.resolved
                  ? { ...bf, resolved: true, resolvedAtTick: state.tick, resolutionKind: "GenerationalDecay" as const }
                  : bf,
              ),
            };
            newHouses.set(PLAYER_HOUSE_ID, newPlayerHouse);
          }
        }
      }
    }
    ```
    The lazy-clone-`state.houses` pattern matches Branch 5 (P9 elopement cleanup at `src/game/rules/aging.ts:160-191`), which was the first death-cascade branch to mutate `state.houses`. Branch 10's lazy-clone composes with Branch 5's — if BOTH fire in the same `pruneOrphanedConversationKeys` call (elopement sprint character + rival-die-out via cumulative same-tick deaths), the `newHouses ??=` guard collapses to a single clone. CLAUDE.md amendment candidate at P11 close-out:

    > **`pruneOrphanedConversationKeys` Branch 10 (P11) is the SECOND site to mutate `state.houses` via the lazy-clone helper pattern (Branch 5 was first at P9). The `newHouses ??= new Map(state.houses)` guard is the canonical composition site — every future death-cascade branch mutating `state.houses` follows the same lazy-`??=` pattern to collapse multi-branch same-call mutations to a single clone.**

  Future P15+ death-cascade extensions follow the lazy-clone-per-branch precedent (P7/P8/P9/P10/P11 carry the pattern).

- **Picker pool restriction (resolves cycle-1-iter-2 B5).** The blood-feud surfacing picker iterates **`RIVAL_HOUSE_IDS_SET` ∩ `hostility ≥ BLOOD_FEUD_RIVAL_HOSTILITY_THRESHOLD`**. The pool is the three P8-shipped rivals (Ashford/Beaumont/Cavendish); the Independent house (factionId="faction-crown", in `src/game/fixtures/rivals.ts`) is NOT in the pool — Independent is a Crown-aligned NPC pool, not a hostile rival. This pin both (a) makes the "deterministically picked hostile rival house" wording at spec §3 line 501 unambiguous in the conservative direction, and (b) makes Branch 10's `RIVAL_HOUSE_IDS_SET.has(rivalHouseId)` precondition correct by construction. Future v1.5 phases that introduce additional rival houses widen `RIVAL_HOUSE_IDS_SET` and the picker auto-includes them.

- **§7 line 650 "Sibling-rival promotion of a corpse" guard (B8).** Implementation is implicit-via-ordering AND explicit-via-filter, in that order:
  1. **Implicit**: `applySiblingRivalPromotionStep` runs at STEPS slot 4, AFTER `applyAgingStep` at slot 1 (which flips dead siblings to `alive: false`). Iterating `state.characters` at promotion time naturally returns dead siblings with `alive: false`.
  2. **Explicit**: the iteration filter (resolves cycle-2-iter-1 B3 — "sibling" is genealogical, NOT housemate-by-houseId) is:
     ```ts
     characters.values().filter((c) =>
       c.alive
       && c.houseId === playerHouseId
       && isAdult(c)
       && c.id !== newHeirId
       && c.id !== deadHeadId            // dead head is in the house; exclude
       && isSiblingOf(c, newHeirId, characters)  // genealogical filter
     );
     ```
     where `isSiblingOf(c, heirId, characters)` returns `true` iff BOTH characters have `parentCharacterIds !== null` AND their two-tuples share AT LEAST ONE parent id (full siblings: share both; half-siblings: share one). In-laws (no shared parent), spouses (no shared parent), uncles/aunts (share grandparents but not parents) DO NOT count. Verified live (resolves cycle-3-iter-1 B2): `parentCharacterIds: z.tuple([CharacterIdSchema, CharacterIdSchema]).nullable()` at `src/game/entities.ts:157` — a 2-tuple of non-nullable parent ids, OR `null` for first-generation characters with no recorded parents. The predicate operates on tuples-of-non-null-ids so the "share AT LEAST ONE parent" overlap is unambiguous. At v1, the conception flow always populates both slots (`parentCharacterIds: [head, spouse]`); half-siblings would require a remarriage + post-remarriage conception, both supported by the existing P7 marriage-dissolution + new-marriage flow. No schema widening at P11.

     **Null-parents semantics (resolves cycle-2-iter-2 B2).** `parentCharacterIds` is nullable per the live schema; baseline NPCs + the player head start with `parentCharacterIds === null` (no recorded parents). When BOTH the candidate sibling AND the new heir have `parentCharacterIds === null` (both first-generation), `isSiblingOf` returns **`false`** (vacuous overlap on null sets). Implication: first-generation NPCs in the player house are NOT promoted at the player head's first succession — only descendants conceived AFTER campaign start, whose `parentCharacterIds` is populated by the P7 conception flow, can be siblings. This is a deliberate v1 simplification per spec §3 line 217 ("succession plants a long-tail internal antagonist") — sibling-rivals only meaningfully appear after the FIRST player heir matures and ascends, by which point the conception flow has populated parent records. The implementer can verify this on the canonical 5-baseline-NPC fixture: at campaign-start-tick-zero succession (which only fires if the player head dies BEFORE conceiving an heir, in which case `applySuccessionStep` flips to the heirless branch and no promotion runs anyway), no NPC has `parentCharacterIds`, so the filter is vacuous. CLAUDE.md amendment candidate: **"Sibling-rival promotion requires `parentCharacterIds`-populated genealogy on BOTH candidate and heir. First-generation NPCs (parentCharacterIds null) are never promoted; promotion meaningfully fires from generation 2 onward."**

     The `isSiblingOf` helper is exported from `src/game/rules/siblingRivals.ts` and pure-functional (no state mutation; reads `parentCharacterIds` field from `Character`). Note **`isAdult(c)`** is NOT a live helper — the inline live form is `c.age >= ADULTHOOD_AGE_IN_YEARS` (resolves cycle-2-iter-2 R5); P11 either inlines this expression OR exports a new `isAdult` helper from `src/game/rules/siblingRivals.ts` (preferred — encapsulates the predicate, low-risk one-line helper).
  3. **Verification**: `siblingRivals.test.ts` ships a unit test that constructs a year-pass state where (a) the head dies (advancing tick to a year-pass boundary), (b) one sibling dies on the same year-pass tick, (c) one sibling survives. Promotion result: ONE sibling-rival actor (the survivor only).

  CLAUDE.md amendment candidate (R13): pin "Sibling-rival promotion runs at STEPS slot 4 (post-aging) so corpse-skip is implicit; the explicit `alive` filter is defense-in-depth and load-bearing for future STEPS reorderings."

- **Modal-state rule-layer gate (B9).** New player-elected action `reconcileSibling` at `src/game/store.ts` (store-action wrapper) calls `applyReconciliationAttempt` from the rule layer. Per CLAUDE.md "Modal-state rule-layer gate principle (P9 generalization of P6)" pin:
  - Wrapper rejection union extends with `| { kind: "PlayerExiled" }` and `| { kind: "ElopementInProgress" }` (rule-layer-evaluated gates BEFORE any pure-rule call body).
  - `reconcileSibling` is a PRE-TICK action: it mutates `house.wealth` / `house.reputation` / `house.siblingRivals` then calls `advanceTickPure`. Matches the P3 pre-tick action pattern (`travel` / `requestAudience` / etc.) so same-tick ordering invariants hold.
  - The wrapper publishes `SiblingRivalReconciled` direct (not via diff-helper) since reconciliation is player-elected and the wrapper owns the event provenance.
  - The wrapper also calls every tick-advancing publisher per the existing publisher set (B9 ties to S6 publisher-trio extension below).

- **Bus event partition (B6).** ONE new event module + publisher-set extension:
  - **`src/runtime/events/siblingRival.ts`** (NEW at P11) — `SiblingRivalEvent` discriminated union + `siblingRivalBus`:
    ```ts
    export type SiblingRivalEvent =
      | { kind: "SiblingRivalPromoted"; characterId: CharacterId; initialHostility: number; tick: number }
      | { kind: "SiblingRivalActed"; characterId: CharacterId; action: SiblingRivalActionKind; tick: number }
      | { kind: "SiblingRivalReconciled"; characterId: CharacterId; via: "Player" | "AutoAtZeroHostility"; tick: number };
    ```
  - **`src/runtime/events/inheritedSecret.ts`** (NEW at P11) — `InheritedSecretEvent` and `BloodFeudEvent` co-located (per-domain partition matches the spec section grouping):
    ```ts
    export type InheritedSecretEvent =
      | { kind: "InheritedSecretAccumulated"; secretId: InheritedSecretId; sourceWhisperId: WhisperId; tick: number }
      | { kind: "InheritedSecretEvicted"; secretId: InheritedSecretId; collapsedIntoAncestorSummary: string; tick: number }
      | { kind: "InheritedSecretSurfaced"; secretId: InheritedSecretId; againstHouseId: HouseId; tick: number };

    export type BloodFeudEvent =
      | { kind: "BloodFeudOpened"; feudId: BloodFeudId; offendingHouseId: HouseId; triggeringSecretId: InheritedSecretId; tick: number }
      | { kind: "BloodFeudResolved"; feudId: BloodFeudId; resolutionKind: BloodFeud["resolutionKind"]; tick: number };
    ```
  - **Diff-helper publishers** (called from store-action wrappers per the CLAUDE.md "Bus-event is a typed Map" pin):
    ```ts
    publishSiblingRivalTransitions(before, after, wrapperPublishedKeys?: ReadonlySet<string>): void;
    publishInheritedSecretTransitions(before, after): void;
    publishBloodFeudTransitions(before, after, wrapperPublishedKeys?: ReadonlySet<string>): void;
    ```
    The 3rd-arg `wrapperPublishedKeys` skip-rule pattern (CLAUDE.md P6 pin) applies to publishers whose events can ALSO be direct-published by a wrapper (e.g., `reconcileSibling` wrapper direct-publishes `SiblingRivalReconciled`, then `publishSiblingRivalTransitions` skips the matching transition to prevent double-publish).

- **Publisher-set extension (S6 fold — updates the CLAUDE.md "7/7/6 publisher set" pin to a new shape).** Three new publishers ride on tick-advancing wrappers:
  - `advanceTick` + the 4 P3 wrappers + `reconcileSibling` (the new P11 pre-tick wrapper): **10 publishers each** = 7 existing (characterDeaths + schemeTransitions + whisperTransitions + marriageTransitions + temptationLatchTransitions + elopementTransitions + artifactTransitions) + 3 new (siblingRivalTransitions + inheritedSecretTransitions + bloodFeudTransitions).
  - `proposeMarriage`: stays at **10 publishers** (the 7 existing + 3 new; no schemeTransitions because proposal doesn't run scheme resolution). Wait — the P10 truth-up has `proposeMarriage` at 7. Re-checking: proposeMarriage fires 7 = proposalOutcome (direct) + marriageTransitions + temptationLatchTransitions + characterDeaths + whisperTransitions + elopementTransitions + artifactTransitions. P11 adds 3 → **10 publishers**.
  - `runYearPass`: **9 publishers** = 6 existing (characterDeaths + whisperTransitions + marriageTransitions + temptationLatchTransitions + childMaturationTransitions + archetypeReclassificationsFromSuccession) + 3 new (siblingRivalTransitions + inheritedSecretTransitions + bloodFeudTransitions). Year-pass IS the accumulation site (succession step is inside year-pass) and the promotion site (new STEPS slot 4) — so all three new diff-helpers MUST ride on runYearPass even though they don't ride on it pre-P11.

  Resulting set: **{10, 10, 9}**. CLAUDE.md pin update: "10/10/9 publisher set across store wrappers (P11 truth-up, supersedes P10's 7/7/6)". Each group's exact membership documented in the wrapper bodies.

- **Player-elected action: `reconcileSibling`** (`src/game/store.ts`). Pre-tick action wrapper following the P3 pattern. Signature:
  ```ts
  // src/game/store.ts (NEW at P11):
  reconcileSibling(siblingCharacterId: CharacterId): { ok: true } | { ok: false; reason: ReconciliationRejection };
  ```
  Body (resolves cycle-2-iter-1 B2 + cycle-2-iter-4 B2 — uniform envelope + bind `advanceTickPure` once):
  ```ts
  // Sketch:
  reconcileSibling: (siblingCharacterId) => {
    const before = get();
    const { nextState, outcome } = applyReconciliationAttempt(before, siblingCharacterId);
    if (!outcome.ok) {
      return { ok: false, reason: outcome.reason };  // tick does NOT advance; nextState === before
    }
    // Bind the post-rule + post-tick state ONCE — matches P3 travel pattern at store.ts:551-554.
    const after = advanceTickPure(nextState);
    set((draft) => {
      overwriteFromGameState(draft, after);
    });
    // Publish 10 (the publisher set for tick-advancing wrappers).
    publishCharacterDeaths(before, after);
    publishSchemeTransitions(before, after);
    publishWhisperTransitions(before, after);
    publishMarriageTransitions(before, after);
    publishTemptationLatchTransitions(before, after);
    publishElopementTransitions(before, after);
    publishArtifactTransitions(before, after);
    const reconciledKeys = outcome.kind === "Success"
      ? new Set([`reconciled:${siblingCharacterId}`])
      : EMPTY_KEYS;
    publishSiblingRivalTransitions(before, after, reconciledKeys);
    publishInheritedSecretTransitions(before, after);
    publishBloodFeudTransitions(before, after);
    if (outcome.kind === "Success") {
      siblingRivalBus.publish({
        kind: "SiblingRivalReconciled",
        characterId: siblingCharacterId,
        via: "Player",
        tick: after.tick,
      });
    }
    return { ok: true };
  };
  ```
  Steps in prose:
  1. Read current `state` (snapshot as `before`). Apply `applyReconciliationAttempt(before, siblingCharacterId)` — returns `{ nextState, outcome }` always. Destructure both. On `outcome.ok === false` (eligibility-failing path), `nextState === before`; return the rejection directly with `outcome.reason`; the tick does NOT advance.
  2. On `outcome.ok === true` (Success OR Failure both qualify): `nextState` is the post-rule state (post-cost-deduction + post-attempt-roll mutations applied). Bind `after = advanceTickPure(nextState)` ONCE (NOT re-invoked inside `set()`).
  3. Inside `set()`: call `overwriteFromGameState(draft, after)`.
  4. After `set()` returns, publish all 10 publishers from the P11 publisher set, passing `(before, after)`. If `outcome.kind === "Success"`, also direct-publish `SiblingRivalReconciled { via: "Player" }` AND pass the matching `wrapperPublishedKeys` Set to `publishSiblingRivalTransitions` to skip the double-publish (per CLAUDE.md P6 pin). If `outcome.kind === "Failure"`, no direct-publish; the hostility-bump transition fires via `publishSiblingRivalTransitions` alone (no `SiblingRivalReconciled` event — failure stays in Active state).
  5. Return `{ ok: true }`.

  Test coverage in `reconcileSibling.test.ts` (new file): all 6 rejection variants + the success path + the gate matrix (PlayerExiled / ElopementInProgress sterilization).

- **`tryStartScheme` interaction (S3 fold + cycle-4-iter-2 B1 fold).** Sibling-rival action `AutoSabotageScheme` calls `tryStartScheme(state, PLAYER_HOUSE_ID, { kind: "Sabotage", targetCharacterId: playerHouse.headOfHouseCharacterId, skipWealthDeduction: true, skipSelfTargetGate: true, explicitAggressorCharacterId: actor.characterId })`. The 2nd arg is the OWNING HOUSE ID (verified `src/game/rules/schemes.ts:185`), NOT the actor's characterId. Three flags on `StartSchemeInput` cooperate to make intra-house Sabotage work:
  - `skipWealthDeduction: true` — P8-shipped field; rivals don't pay wealth for auto-actions.
  - `skipSelfTargetGate: true` — **NEW at P11**, widens `StartSchemeInput` per P8 precedent. Bypasses the SelfTarget rejection at `schemes.ts:272-274` (which would otherwise reject when `target.houseId === ownerHouseId` — intra-house Sabotage is the whole point of the action). Player-elected `startScheme` paths leave the flag false; rejection still fires for ordinary player Sabotage attempts against their own house.
  - `explicitAggressorCharacterId: actor.characterId` — **NEW at P11**, widens `StartSchemeInput`. Overrides `selectAggressor` (at `schemes.ts:281`) for the auto-action path. Player-elected paths leave the field undefined and `selectAggressor` runs its archetype-based pick. No new SchemeKind ships.

  Tests pin (a) the intra-house Sabotage success path (gate skipped, aggressor pinned to sibling-rival), (b) the player-elected ordinary-Sabotage rejection still fires when those flags are NOT set, (c) the cooldown burns on either outcome (CLAUDE.md P8 "cooldown burns on ALL outcomes" inherited).

- **CLAUDE.md updates (R13 fold).** Five new pins added at close-out:
  1. **"Sibling-rival promotion runs at year-pass STEPS slot 4 (post-aging, post-succession) so corpse-skip is implicit; the explicit `alive` filter is defense-in-depth and load-bearing for future STEPS reorderings."** (B8 codification + R9 codification.)
  2. **"Inherited-secrets ledger eviction lazily collapses oldest entry into `House.ancestorSummary` on push-past-`MAX_INHERITED_SECRETS`."** (R3 codification.) Format pinned: `Generation N inherited secret: <description text>` per evicted entry (where `N` is `house.generation` at the time of original accumulation, snapshotted in `InheritedSecret.originatingGenerationCount`).
  3. **"Blood-feud picker pool is `RIVAL_HOUSE_IDS_SET` ∩ `hostility ≥ BLOOD_FEUD_RIVAL_HOSTILITY_THRESHOLD`; picker returns lex-smallest of that set. Missed picks (empty intersection) burn no secret (§7 line 655 codification). Independent house is explicitly EXCLUDED — it's a Crown-aligned NPC pool, not a hostile rival."** (R4 + B5 codification.)
  4. **"P11 publisher set is 10/10/9 across tick-advancing wrappers, superseding the P10 truth-up of 7/7/6. The three new publishers (`publishSiblingRivalTransitions`, `publishInheritedSecretTransitions`, `publishBloodFeudTransitions`) ride on EVERY tick-advancing wrapper INCLUDING `runYearPass` (year-pass is the accumulation site for inherited-secrets and the promotion site for sibling-rivals). Group memberships: proposeMarriage = 10 (existing 7 + 3 new); advanceTick + 4 P3 wrappers + reconcileSibling = 10 each (existing 7 + 3 new); runYearPass = 9 (existing 6 + 3 new)."** (S6 codification.)
  5. **"Reconciliation outcome envelope: `applyReconciliationAttempt` returns `{ nextState; outcome }` ALWAYS (outer envelope has NO `ok` field). The `outcome` discriminator is `| { ok: true; kind: 'Success' | 'Failure' } | { ok: false; reason }`. The store-action wrapper inspects `outcome.ok` (and on `true`, `outcome.kind`) to decide tick-advance and direct-publish of `SiblingRivalReconciled`. Matches the `applyProposalPure` envelope precedent at `src/game/rules/proposal.ts:72-75`, NOT the bare-`GameState` `applyTravel` shape."** (B8 + cycle-3-iter-8 B1 codification.)

**Out of scope.**

- Cross-house marriages affecting hostility (§10 OQ 16 — deferred to v1.5 at P7 with `CrossHouseMarriageNotSupported` rejection).
- Dynasty Legacies (Renown Perks) — owned by P15. Plan body §7 cross-reference to "Dynasty perk award during the same tick as succession" is a POINTER to P15 ownership, NOT a P11 deliverable. P11 ships no `state.dynastyPerks` field shape; P15 introduces both the schema and the trigger evaluation. (R8 codification.)
- Sibling-rival ledger UI in `src/ui/` — P14 ledger tab work. P11 ships the pure rules + bus events; P14 wires the read surface.
- Blood-feud UI surface (separate tab in the ledger? row in an existing tab?) — P14 decision.
- Sibling-rival voluntary "fire" / disinheritance action — explicitly out of scope; only auto-reconciliation (hostility 0) and player-elected reconciliation (high-society action) flip the latch.
- Generated-flavor LLM rewriting of inherited-secret descriptions — P18 if it ships.

**Spec refs.** §3 "Sibling Rivals (Autonomous Slighted Heirs)" (lines 216-223), §3 "Inherited Secrets & Blood Feuds" (lines 240-247), §3 "Sibling-Rival Action Roller" (lines 478-486), §3 "Inherited Secrets & Blood-Feud Surfacing" (lines 498-503), §4 entity model (line 541 House lists, line 556 SiblingRivalState, line 557 BloodFeud, line 559 InheritedSecret), §7 edge cases (line 650 corpse-promotion, line 655 now-allied rival, line 656 dynasty-perk same-tick — last is P15-owned), §8 line 685 ledger bound.

**Key constants summary table.**

| Constant | Value | Spec ref |
|---|---|---|
| `SIBLING_RIVAL_PROMOTION_BASELINE_HOSTILITY` | 50 | §3 line 480 (trait-modifier proxy for the spec's "e.g. affection-delta" formula) |
| `SIBLING_RIVAL_TRAIT_HOSTILITY_JADED` | +15 | §3 line 480 |
| `SIBLING_RIVAL_TRAIT_HOSTILITY_AMBITIOUS` | +15 | §3 line 480 |
| `SIBLING_RIVAL_TRAIT_HOSTILITY_CUNNING` | +10 | §3 line 480 |
| `SIBLING_RIVAL_TRAIT_HOSTILITY_PIOUS` | -10 | §3 line 480 |
| `SIBLING_RIVAL_HOSTILITY_PER_ACTION` | -2 | §3 line 483 |
| `SIBLING_RIVAL_HOSTILITY_PER_FAILED_RECONCILIATION` | +5 | §3 line 483 |
| `SIBLING_RIVAL_ACTION_COOLDOWN_TICKS` | 5 | §3 line 481 |
| `SIBLING_RIVAL_RECONCILIATION_WEALTH_COST` | 50 | §3 line 485 |
| `SIBLING_RIVAL_RECONCILIATION_REPUTATION_COST` | 10 | §3 line 485 |
| `SIBLING_RIVAL_RECONCILIATION_SUCCESS_AT_HOSTILITY_0` | 0.9 | §3 line 485 |
| `SIBLING_RIVAL_RECONCILIATION_SUCCESS_AT_HOSTILITY_100` | 0.1 | §3 line 485 |
| `SIBLING_RIVAL_ACTION_WEIGHTS.GamblingDebt` | 40 | §3 line 482 |
| `SIBLING_RIVAL_ACTION_WEIGHTS.LeakSecret` | 30 | §3 line 482 |
| `SIBLING_RIVAL_ACTION_WEIGHTS.PettySabotage` | 20 | §3 line 482 |
| `SIBLING_RIVAL_ACTION_WEIGHTS.AutoSabotageScheme` | 10 | §3 line 482 |
| `SIBLING_RIVAL_GAMBLING_DEBT_WEALTH_DRAIN` | 15 | §3 line 221 |
| `SIBLING_RIVAL_PETTY_SABOTAGE_REPUTATION_DRAIN` | 2 | §3 line 221 |
| `MAX_INHERITED_SECRETS` | 12 | §8 line 685 |
| `INHERITED_SECRET_SURFACING_PROBABILITY_BASIS_POINTS` | 50 | §3 line 501 |
| `BLOOD_FEUD_RIVAL_HOSTILITY_THRESHOLD` | 40 | §3 line 501, §7 line 655 |
| `BLOOD_FEUD_AFFECTION_PENALTY_PER_ASSOCIATE` | 20 | §3 line 502 |
| `BLOOD_FEUD_DECAY_TICKS_MAX` | 50 | §3 line 245 |

**Machines.**
- Sibling-rival (Active → Reconciled) — one-way latch via `SiblingRivalState.reconciled: boolean`. Reachable from Active by (a) player reconciliation success, (b) auto-reconciliation at hostility 0. Reconciled state reverts the parallel `siblingRival` actor entity to dormant (no further per-tick action rolls); the underlying Character's role is unchanged. Per S13 / R10 decision: promotion does NOT mutate `Character.role` — sibling-rivals are parallel actor entities, not role overlays. The MASTER.md §5.2 entry at line 179 stays as-is.
- Blood feud (Active → Resolved) — one-way latch via `BloodFeud.resolved: boolean`. Reachable from Active by (a) duel-resolution outcome (covers BOTH player-initiated `challengeDuel` and `demandSatisfaction`-routed duels — `resolutionKind` records `DuelWin` or `DuelLoss`), or (b) generational-decay tick threshold (`resolutionKind: "GenerationalDecay"`). The iter-4 simplification dropped `SatisfactionDemanded` as a distinct resolutionKind — satisfaction-demanded is a duel-mint path, not a separate resolution outcome. NEW machine in MASTER.md §5.2 catalog (S10 fold) — add row: "Blood feud (P11) | Active → Resolved | Duel resolution (covers satisfaction-demanded route) or `BLOOD_FEUD_DECAY_TICKS_MAX` ticks after `incurredAtTick`".

**Edge cases (§7).**
- "Sibling-rival promotion of a corpse" (§7 line 650) — handled by post-aging STEPS slot 4 ordering + explicit `alive` filter in `promoteEligibleSiblingsAtSuccession` (B8 enforcement).
- "Inherited-secret surface against a now-allied rival" (§7 line 655) — handled by `BLOOD_FEUD_RIVAL_HOSTILITY_THRESHOLD` picker gate; if no rival qualifies, surfacing roll is a miss, secret stays active.
- "Dynasty perk award during the same tick as succession" (§7 line 656) — P15-owned (perks evaluated post-succession). P11 acknowledges only as a cross-reference; no implementation.

**Verification.**

| # | Scenario | Test file | Mechanism |
|---|---|---|---|
| 1 | Succession promotes every eligible adult sibling; initial hostility is trait-modified | `siblingRivals.test.ts` | Construct state with dead head + heir + 3 adult siblings (1 with Jaded, 1 with Pious, 1 trait-neutral); run year-pass; assert `house.siblingRivals.length === 3`, with hostility 65 / 40 / 50 respectively (baseline 50 + trait modifiers, clamped). |
| 2 | Succession skips corpse-sibling (§7 line 650) | `siblingRivals.test.ts` | Construct state where sibling dies on same year-pass tick as head; run year-pass; assert dead sibling NOT promoted. |
| 3 | Per-tick action roller fires gambling-debt at expected weight | `siblingRivals.test.ts` | Seeded RNG harness; advance 100 ticks; assert `GamblingDebt` action fired ~40% of cooldown-eligible ticks. |
| 4 | Player reconciliation succeeds proportional to inverse hostility | `reconcileSibling.test.ts` | Seeded harness; for hostility values [0, 25, 50, 75, 100], assert success rate matches `SUCCESS_AT_HOSTILITY_0 + (h/100) × (SUCCESS_AT_HOSTILITY_100 − SUCCESS_AT_HOSTILITY_0)` within ±5% over 1000 trials. |
| 5 | Auto-reconciliation at hostility 0 flips `reconciled: true` | `siblingRivals.test.ts` | Construct state with hostility 1 sibling-rival; fire 1 action (-2 delta → clamped to 0); assert next phase auto-flips to reconciled. |
| 6 | Inherited-secret accumulated on succession from Verified+Weaponized whispers | `inheritedSecrets.test.ts` | Construct state with mix of whispers (Unverified, Verified, Weaponized, Dismissed); run succession; assert only Verified + Weaponized about player house copied into ledger. |
| 7 | Ledger eviction at `MAX_INHERITED_SECRETS` collapses oldest into `ancestorSummary` | `inheritedSecrets.test.ts` | Construct state with 12 inherited-secrets; trigger 13th via succession; assert oldest (lowest `originatingTick`) evicted, `ancestorSummary` appends `Generation N inherited secret: <description>` line. |
| 8 | Surfacing roll picks lex-smallest rival with hostility ≥ threshold | `inheritedSecrets.test.ts` | Construct state with 3 rivals (hostilities 30/45/60); seeded RNG forces surfacing hit; assert pick lex-smallest among {hostility≥40}. |
| 9 | Surfacing roll against sub-threshold-only rivals burns no secret (§7 line 655) | `inheritedSecrets.test.ts` | Construct state with 3 rivals (hostilities 30/35/39); seeded RNG forces would-be hit; assert secret stays `surfacedAgainstHouseId: null`. |
| 10 | Blood-feud open applies `BLOOD_FEUD_AFFECTION_PENALTY_PER_ASSOCIATE` to all rival-associates | `inheritedSecrets.test.ts` | Construct state with 1 unsurfaced secret + 1 rival with 3 associates; force surfacing; assert each associate's `affection(→ player head)` drops by 20 (clamped). |
| 11 | Blood-feud resolved via duel removes from `Active` list | `inheritedSecrets.test.ts` | Construct state with 1 Active feud + duel resolution against offending house; assert `feud.resolved: true`, `feud.resolutionKind: "DuelWin"`. |
| 12 | Blood-feud resolved via satisfaction-demanded → duel-win pathway | `inheritedSecrets.test.ts` | Construct state + `demandSatisfaction(offendingHouseId, grievanceId)` store action (mints duel); resolve the duel to a Win; assert feud resolved with `resolutionKind: "DuelWin"`. Confirms the iter-4 simplification (satisfaction-demanded is a duel-mint path, not a separate resolution kind). |
| 13 | Blood-feud resolved via generational decay at `BLOOD_FEUD_DECAY_TICKS_MAX` | `inheritedSecrets.test.ts` | Construct state with active feud at tick T; advance to tick T+50; assert feud auto-resolves with `resolutionKind: "GenerationalDecay"`. |
| 14 | Replay 30-run hash stability with sibling-rival + inherited-secret active | `replayStability.test.ts` | Seeded campaign with succession + 100 ticks of sibling-rival activity + 50 ticks of inherited-secret activity; run 30x; assert identical final state hashes. |
| 15 | Modal-state gates fire on `reconcileSibling` wrapper | `reconcileSibling.test.ts` | Construct state with `house.exiled: true`, attempt `reconcileSibling`; assert rejection `{ kind: "PlayerExiled" }`. Same with `state.elopement !== null` → `{ kind: "ElopementInProgress" }`. |
| 16 | PHASES + STEPS array growth tests pin function-reference identity | `tickOrchestrator.test.ts`, `yearPass.test.ts` | Test-side `phaseOrderTracker` asserts `applyRivalActionPhase` stays terminal; `applySiblingRivalActionPhase` + `applyInheritedSecretSurfacingPhase` precede it. Year-pass STEPS asserts promotion AFTER succession. |
| 17 | `pruneOrphanedConversationKeys` branches 9 + 10 fire correctly | `aging.test.ts` (helper lives at `src/game/rules/aging.ts`) | Construct state with sibling-rival actor + dead sibling-character → assert actor removed (branch 9). Construct state with active blood-feud + all rival-associates dead → assert feud auto-resolved (branch 10). |
| 18 | `migrate_v11_to_v12` round-trip (idempotent + zero RNG drift) | `v11-to-v12.test.ts`, `v11-to-v12.idempotence.test.ts` | Standard migration test pattern + chain-test through v1-to-v12. |
| 19 | Boundary-rule lint clean (`src/game/rules/siblingRivals.ts` + `inheritedSecrets.ts`) | `eslint/boundaries.test.ts` | No imports outside `src/game/constants.ts`, `src/game/fixtures/**`, `src/game/rng.ts`, other rules. |
| 20 | `GrievanceSource` widening — exhaustive switch coverage for `"BloodFeud"` | typecheck | Strict TS rejects any switch missing the new arm; expected pass once P14 ledger renderer adds the stub. |

Playwright e2e (S11): `tests/e2e/p11-sibling-rival-and-feud.spec.ts` (new file) — open a campaign with seeded sibling-rival-eligible siblings, advance to succession via test-RNG override, verify sibling-rival promotion lands; advance ticks, verify hostility decay; reach hostility 0, verify auto-reconciliation flips actor to reconciled. Separate flow: seed inherited-secret + hostile rival, force surfacing, verify ledger update + affection penalty across rival-associates.

**Open question (§10).** Q3 (sibling-rival mechanic active in v1): **YES — committed.** Full mechanic ships in v1 per §3 line 218 design intent ("succession plants a long-tail internal antagonist"). Inherited Secrets + Blood Feuds ship in v1 as well (spec-decoupled from Q3 at §3 lines 240-247 + 498-503; no separate OQ row). At close-out, `plans/MASTER.md` §10 row #3 receives verbatim update:

> | 3 | Sibling-rival mechanic active in v1? | **Yes** (specced design intent at §3 line 218). **Resolved at P11** ([phases/11-sibling-rivals-secrets.md](./phases/11-sibling-rivals-secrets.md)); ships full mechanic plus Inherited Secrets and Blood Feuds. Ship-state parameters: `SIBLING_RIVAL_PROMOTION_BASELINE_HOSTILITY = 50` (trait-modified per `SIBLING_RIVAL_TRAIT_HOSTILITY_{JADED,AMBITIOUS,CUNNING,PIOUS}` modifiers), `SIBLING_RIVAL_ACTION_COOLDOWN_TICKS = 5`, `SIBLING_RIVAL_HOSTILITY_PER_ACTION = -2`, `SIBLING_RIVAL_HOSTILITY_PER_FAILED_RECONCILIATION = +5`, `MAX_INHERITED_SECRETS = 12`, `INHERITED_SECRET_SURFACING_PROBABILITY_BASIS_POINTS = 50`, `BLOOD_FEUD_RIVAL_HOSTILITY_THRESHOLD = 40`, `BLOOD_FEUD_AFFECTION_PENALTY_PER_ASSOCIATE = 20`, `BLOOD_FEUD_DECAY_TICKS_MAX = 50`. Three new House array fields with `.default([])` backward-compat; SaveV12. |

**Close out.** When the gates and verification items above are green, run `/close-phase P11` to update phase status in `plans/MASTER.md` §6 (Status: ✅ done), apply the §10 row #3 update verbatim, apply the five CLAUDE.md pins enumerated in "CLAUDE.md updates" above, append to `plans/SESSION-NOTES.md`, and commit the changes (no push).

## Accumulated Risks & Suggestions

*Passively collected from review cycles. Not blockers. Triaged at convergence.*

- [C1] Per-rival RNG seeding pattern carry-over from P8 unaddressed.
- [C1] Inherited-secrets accumulation timing + source-status filter (Verified vs Verified+Weaponized vs verified-at-any-point) undecided.
- [C1] Bounded ledger eviction algorithm undefined (numeric bound, "oldest" definition, collapse format, eager vs lazy fire).
- [C1] Blood-feud surfacing "deterministically chosen hostile rival house" picker algorithm absent.
- [C1] "Large affection penalty on all rival-associated characters" lacks a magnitude constant.
- [C1] Casus belli recording shape relative to existing Grievance entity (reuse vs parallel entity).
- [C1] "Generational decay" resolution mechanism for blood feuds undefined (tick threshold? next succession? linear decay?).
- [C1] Dynasty-perk same-tick edge case (§7 line 656) is P15-owned — clarify cross-reference framing in plan body.
- [C1] §7 "Sibling-rival promotion of a corpse" rule-layer enforcement site not pinned (implicit-via-post-aging-ordering vs explicit alive filter).
- [C1] Sibling-rival role transition shape ambiguous — promotion mutates Character.role to "SiblingRival" enum vs role unchanged with parallel actor state.
- [C1] §10 OQ row #3 update language vague — needs verbatim replacement text.
- [C1] Gap-to-fidelity 30x expansion needed — plan body is 30 lines vs P9/P10's 600+/1500+ lines.
- [C1] No CLAUDE.md amendment pinned — every prior multi-phase ships at least one non-negotiable or coding-convention pin.
- [C1] Adopt the P9/P10 structural skeleton verbatim (section headings: Goal · Why-now · What-does-NOT-change · In scope · Save format bump · Strip cascade for legacy emit · migrate · Lifter discipline · Designer constants · Pure-rule modules · Bus event partition · pruneOrphanedConversationKeys extension · Store-action wrappers · CLAUDE.md update · View component · §10 OQ additions · Phase index status update · Out of scope · Spec refs · Key constants summary table · Machines · Edge cases · Verification · Close out).
- [C1] Pin the v11→v12 bump explicitly.
- [C1] Enumerate the new SchemeKind impact — confirm rival-action AutoSabotageScheme reuses existing Sabotage kind via skipWealthDeduction (no new SchemeKind).
- [C1] List the explicit tryStartScheme rejection-union widening for the new sibling-rival reconciliation action.
- [C1] Pin the test-file fanout per cross-plan pattern #27 (save-roundtrip, v1-to-v12-chain, v11-to-v12.parity, v11-to-v12.test.ts + idempotence).
- [C1] Pin the publisher-trio-set extension framing (10/10/9 across tick-advancing wrappers, supersedes P10's 7/7/6).
- [C1] Promotion threshold definition: pin the threshold value and the affection-toward-dead-head key-shape read source.
- [C1] Action-pool weight constants: concrete integer weights with module-load assertion (all > 0; sum ≤ 100).
- [C1] Surfacing probability concrete value in basis points (per active secret per tick OR per year-pass — decide which clock).
- [C1] BloodFeud entity lifecycle (Active → Resolved) — list in MASTER.md §5.2 state-machine catalog.
- [C1] Verify the existing SiblingRival row in MASTER.md §5.2 line 179 is sufficient or needs widening (e.g., reconciled-from-AutoZero vs Player branches).
- [C1] Playwright e2e: open campaign, advance to succession via test-RNG override, verify promotion + decay + auto-reconciliation. Inherited-secret + surfacing + affection-penalty flow as a separate e2e.
- [C1] CLAUDE.md amendment candidates: corpse-skip-via-post-aging-ordering pin; lazy-collapse-into-ancestor-summary pin; blood-feud-picker-lex-rival-above-threshold pin (§7 line 655 codification).
- [C1] Per-house vs top-level Map shape decision for inherited-secrets ledger (per-house array matches spec line 541 + P5 grievance precedent).
- [C1] Picker-pool restriction: pin "rivals-only pool" vs "any hostile non-player house" (spec wording is ambiguous; v1 default rivals-only).
- [C1] Verified+Weaponized status filter source-of-truth uncertainty — Weaponized whispers about long-dead targets accumulated? Pin intent.
- [C1] Character.role mutation question on promotion (spec §3 line 484 "reverts to Dependent" — metaphorical vs literal).
- [C1] Edge cases section framing for §3 line 656 — reframe as "P15-owned; out of scope" to remove implementer confusion.
- [C1] Surfacing-roll per-tick PRNG draw budget unquantified — pin per-secret draw shape + RNG entry source.
- [C1] BLOOD_FEUD_DECAY_TICKS_MAX rationale weak — verify TICKS_PER_YEAR mapping for accurate comment.
- [C1] Lex-sort-vs-pool-walk OR-in-modify-table for applyBloodFeudGenerationalDecayPhase — pick "folded into surfacing phase" (option b).
- [C1] publishBloodFeudTransitions walk shape unspecified — diff walk per-house bloodFeuds arrays.
- [C1] proposeMarriage publisher count question — wasted publishInheritedSecretTransitions walk on proposal vs accept wasted overhead.
- [C1] v1-to-v12-chain.test.ts naming convention — additive new file vs in-place rename of v1-to-v11-chain.test.ts.
- [C1] PERSONA_CACHE_VERSION not bumped at P11 — confirm no LLM persona prompt format changes (negation pin).
- [C1] MASTER.md §10 row update needs explicit before/after pair so closeout-script can grep-for-replace cleanly.
- [C1] Strip cascade chain notation order at toSaveV5..V11 emitter — explicit modification step + confirm stripBloodFeudGrievancesForLegacyEmit position.
- [C1] Verification test row 17 (pruneOrphan branches) should reflect 9/10 numbering (was 6/7) to match the helper at src/game/rules/aging.ts.
- [C1] Why-now framing absent — add 2-sentence rationale tying P10 ledger richness to P11 inherited-secrets feed.
- [C1] Playwright e2e (line 485) too thin — spec the seed + test-RNG-override mechanism + assertion target concretely.
- [C1] Bare+wrap split rationale at V11 — pin "Split is structural-only at P11; future v12+ phase that introduces seeding will benefit from the Bare extraction."
- [C1] Module-load assertion "sum ≤ 100" comment contradiction — sum = 100 means "no action" branch never fires; drop or change.
- [C1] Spec ref citation for SIBLING_RIVAL_GAMBLING_DEBT_WEALTH_DRAIN / PETTY_SABOTAGE — label as "v1 default; designer-tunable" if spec doesn't pin magnitudes.
- [C1] CLAUDE.md publisher-set pin idiom — REPLACE 7/7/6 with 10/10/9 vs ADD P11 row (history-concat). Decide and apply consistently.
- [C1] Out-of-scope list missing P14-future-implementation pointer for "fire/disinheritance" UI affordance.
- [C1] `accumulateInheritedSecretsAtSuccession` whisper-filter predicate undocumented — subject = deadHeadId only? Any player-house character? Pin in body.
- [C1] `publishInheritedSecretTransitions` omits the 3rd-arg skip-rule that sibling-rival and blood-feud publishers carry — intentional (no wrapper direct-publishes InheritedSecret events) or oversight? Pin explicitly.
- [C1] Close-out pin-count off-by-one — body says "Five new pins" but Close-out line references "the four CLAUDE.md pins". Reconcile.
- [C1] Stale code comment at `src/game/store.ts:1333` ("publisher list (5)") may need updating to 10/10/9 during P11 close-out.
- [C1] `publishBloodFeudTransitions` diff target not pinned — Active→Resolved flips vs Opened-event-on-id-creation. Pin walk shape.
- [C1] Strip-cascade audit: verify "V1 through V11" emit-site count — V1 emits via `HousePreV4Schema` (raw object), not a strip-helper site; V8-V11 sites may or may not have existing strip helpers (audit `src/persist/schema.ts:toSaveV{1..11}` for each).
- [C1] V1 is NOT a strip-cascade site — strip cascade applies to V2-V11 (10 sites, not 11). Correct count in plan body.
- [C1] Edit path A/B labels in strip-cascade section may be flipped/conflated — path A widens omits, path B extends destructure; clarify which path applies to which emit-site set.
- [C1] Test case for `pruneOrphanedConversationKeys` branches 9 + 10 firing same call (sibling-rival actor + last-rival-associate die same tick) not enumerated in verification matrix.
- [C1] R10/S6 carry-over: raw `string` vs branded `HouseId` inconsistency between the two new strip helpers shipping in same diff — pick one convention.
- [C2] `AutoSabotageScheme` rejection handling unspecified — pin "cooldown burns on ALL outcomes" matching CLAUDE.md P8 cross-house rival pin.
- [C2] HousePreV{8-11} audit — Live SaveV7-V11 all use the live HouseSchema directly (`schema.ts:1011/1133/1271/1378/1492`); one new `HousePreV12Pre11Schema` covers all five. Pin in plan instead of leaving as audit-time discovery.
- [C2] Cost-deduction-on-failure invariant — pin "costs paid even on failure" per spec §3 line 485 ("per attempt" wording).
- [C2] Spec §3 line 484 "reverts to Dependent role" divergence — current plan keeps `Character.role` unchanged; pin metaphorical-vs-literal reading in MASTER.md §10 OQ table for visibility.
- [C2] `defaultHouseV{N}Fields` not explicitly enumerated as edit sites — pin "no edits needed because `.default([])` plus spread" as defense-in-depth note.
- [C2] Verification matrix #4 "1000 trials" — Vitest default timeout 5s; pin acceptable wall-clock or reduce trials with widened ±.
- [C2] No test enumerated for the Success/Failure envelope discriminator behavior in reconcileSibling store wrapper — add to matrix.
- [C2] Picker design intent — pin "rivals have hostility 0 in fresh campaigns; inherited-secret surfacing requires player-vs-rival prior antagonism" as deliberate gating semantics.
- [C2] Flow diagram / sequence list for `applyAgingStep → applyMaturationStep → applySuccessionStep → applySiblingRivalPromotionStep → applyConceptionStep` chain.
- [C2] Verification matrix #17 should also enumerate 5-way same-tick collision (sibling-rival actor + last rival-associate + elopement char + artifact owner + thief-attempt owner).
- [C2] Stale code comment at `src/game/store.ts:1333` (publisher list (5)) — add to close-out steps explicitly.
- [C2] Accumulation helper signature — pin whether per-dead-head or aggregated; pin non-player-house succession accumulation = no-op.
- [C2] CLAUDE.md amendment #1 wording — tighten "promotion's iteration filter must include `c.alive`; do NOT rely on STEPS-slot ordering alone" given append-only PHASES/STEPS non-negotiable.
- [C2] BloodFeudEvent file placement — co-located with InheritedSecretEvent in `inheritedSecret.ts`; consider splitting to `bloodFeud.ts` for per-domain parity.
- [C2] `accumulateInheritedSecretsAtSuccession` insertion gate — pin `house.id === PLAYER_HOUSE_ID` AND heirless-branch behavior (non-player succession + heirless head = no accumulation).
- [C2] BloodFeud resolution wiring through `duel.ts:178-180` (Grievance.resolved flip) → propagate to `BloodFeud.resolved`. Pin helper + verification matrix wiring test.
- [C2] `WrongLocation` rejection references "high-society location" — no live LocationKind matches; pin specific LocationId or define enum.
- [C2] `InsufficientWealth { required, have }` shape inconsistent with live mixed shapes (`{current,required}` vs `{have,need}`); pick one precedent.
- [C2] `pruneOrphanedConversationKeys` Branch 10 alive-check ordering vs `applyAgingStep` death-flips — inline-comment the contract.
- [C2] `applySiblingRivalActionPhase` modal-state gate interaction — phase runs unconditionally (only player-elected `reconcileSibling` gates); pin explicitly.
- [C2] Test #20 (`GrievanceSource` exhaustive switch) — P14 hasn't shipped at P11 close-out; ship placeholder stub or mark `it.todo()`.
