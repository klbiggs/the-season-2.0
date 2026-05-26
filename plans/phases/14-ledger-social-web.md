# P14 — Ledger View & Social Web Visualization

> Part of [The Season Master Plan](../MASTER.md). Prior: [P13 — Global Events & Era Progression](./13-global-events-era.md). Next: [P15 — Dynasty Legacies & Renown Perks](./15-dynasty-legacies.md).

**Goal.** Make all the accumulated state legible. Ship the canonical Ledger as a fourth top-level view (sibling of Map / Ballroom / Promenade, suppressed by the Elopement overlay) with **8 tabs** — Whispers, Schemes, Family Tree, Patronesses, Grievances, Rivals, Staff, Artifacts. P11 and P13 content folds into existing tabs (Sibling Rivals under Family Tree; Inherited Secrets + Blood Feuds + Faction Tension under Rivals; Global Events already chip-rowed in MapView at P13 per `src/ui/map/MapView.tsx:106-148` — chip row stays MapView-only at v1, cross-view visibility deferred to v1.5 as a parallel-shape extension of the P14 exile-banner hoist if playtest surfaces a need). The Social Web ships alongside Family Tree as a togglable sub-view rendered by `react-force-graph-2d` with `framer-motion`-driven portrait-slide reactions on faux-pas / sabotage-success / proposal-rejection.

P14 is the FIRST phase that **does not bump the save format** since P0 — it is reading-only over already-persisted state. **No new top-level `GameState` fields, no new entity schemas, no new bus events, no new rules-layer modules, no new orchestrator phases, no `PERSONA_CACHE_VERSION` bump, no migration ladder extension.** Every mutation surface routes through actions that already exist on `SeasonStore` (P3 `refreshWardrobe`; P5 `cancelScheme`; P6 `weaponizeWhisper` / `dismissWhisper` / `assignStaff` / `spymasterIntercept`; P7 `assignTutor` / `chooseTutorBonusTrait`; P8 `demandSatisfaction`; P10 `equipArtifact` / `unequipArtifact` / `commissionForgery` / `thwartTheft`; P11 `reconcileSibling`; P13 `researchFastCouriers`). The ONLY package-manifest change is two new dependency adds: `framer-motion` and `react-force-graph-2d` (the latter pulls `d3-force` transitively).

P14 is also the FIRST phase to **remove load-bearing UI surfaces** rather than add them. The four inline ledger panels currently rendered in `MapView`'s right sidebar (`ActiveSchemesPanel`, `WhisperLedgerPanel`, `StaffPanel`, `SpymasterInterceptCard`) MOVE to their owning tabs inside `LedgerView` — they are NOT duplicated. The Map sidebar shrinks to `LocationDetailsPanel` alone. A "View Ledger" button in `TopBar` is the canonical entry point. Existing Playwright + Vitest assertions against `MapView`'s sidebar panel selectors get re-pointed at the new `LedgerView` tabs (concrete migration list in the test plan below).

**What does NOT change (load-bearing).** `SAVE_VERSION_CURRENT` STAYS at `13`. No `SaveV14Schema`, no `toSaveV14`, no `fromSaveV14`, no `migrate_v13_to_v14`, no `v1-to-v14-chain.test.ts`. `GameStateSchema` adds zero fields. `hashableState` projection adds zero keys. `selectGameState` and `overwriteFromGameState` add zero writes. `PHASES` count stays at **14** with `applyRivalActionPhase` terminal. Year-pass `STEPS` length stays at **5**. The **11/11/9 publisher set** from P13 stays exact — P14 publishes nothing new and subscribes only on the read side. `PERSONA_CACHE_VERSION` stays at `"v4"` (no persona-prompt change — Ledger reads `Character` already loaded into the persona via P13). `TRAITS` length stays at **33**. `SCHEME_KINDS` length stays at **7**. `GLOBAL_EVENT_KINDS` set stays at the three P13 kinds. No new branded IDs, no new constants section in `src/game/constants.ts` (the only numerics introduced are UI-local layout values living in the rendering modules — out of scope for the canonical constants registry per CLAUDE.md "Designer constants in one place" carve-out for pixel sizes).

**In scope.**

- **New dependencies in `package.json`.** **Three** adds, pinned per CLAUDE.md "determinism-sensitive deps are exact-pinned" — none participate in `hashableState` or save serialization, so a `~` patch-range is acceptable per the established convention (other deps use `~`). Concrete diff:
  ```jsonc
  // package.json — P14 EDITS (alphabetical placement in "dependencies" / "devDependencies"):
  "dependencies": {
    "dexie": "~4.0.10",
    "framer-motion": "~12.0.0",        // P14 ADDITION — portrait-slide reactions
    "immer": "~10.1.1",
    "react": "~19.0.0",
    "react-dom": "~19.0.0",
    "react-force-graph-2d": "~1.27.0", // P14 ADDITION — Social Web canvas
    "seedrandom": "3.0.5",
    "zod": "~3.24.1",
    "zustand": "~5.0.2"
  },
  "devDependencies": {
    // ... existing alphabetical entries ...
    "@testing-library/react": "~16.1.0", // P14 ADDITION — UI render + DOM-assert harness for the new ledger tab tests
    // ... rest of existing entries ...
  }
  ```
  **`@testing-library/react` decision (resolves B1 of cycle-1-iter-2 / B2 of cycle-2-iter-1 / C1).** Pick `@testing-library/react ~16.1.0` (compat with React 19). P14 is the first phase to ship a tabful of UI components that need user-event-shaped tests (button click → store dispatch → DOM re-render assertion). The existing project test style (pure-rule Vitest + selector tests over Zustand vanilla) covers every rules-layer test today, but the per-tab UI tests at items 5-17, 22-29 of the verification matrix specifically need click + render + DOM-query — the rules-layer pattern doesn't extend. Adding testing-library now also costs the implementer ~zero extra setup beyond a single `vitest.config.ts` `environment: "jsdom"` flag (`jsdom` is already installed per `package.json:46`). Acceptable transitive dep cost: `@testing-library/dom` is the only transitive add of note (~150KB unpacked, dev-only). Companion `@testing-library/jest-dom` is OPTIONAL — only needed if the tests use `toBeInTheDocument()` etc. matchers; the implementer can ship without and use bare DOM assertions per the existing project style if preferred.

  `react-force-graph-2d` pulls `d3-force` + `kapsule` transitively; no explicit transitive pin needed (neither feeds the deterministic hash). Verify post-install via `pnpm install` that no peer-dep warning blocks the tree (React 19 + Framer Motion 12 + testing-library 16 is the compat triple; force-graph carries no React peer cap).

  **Vitest jsdom environment edit (resolves B2 cycle-3-iter-1).** `vitest.config.ts:6` currently sets `environment: "node"`. Every new `*.test.tsx` shipped at P14 needs DOM globals (`document`, `window`, etc.) — without the edit, all ~20 new render tests throw `ReferenceError: document is not defined` at module load. Resolution pick: **per-test-file `// @vitest-environment jsdom` directive on every new `*.test.tsx`** (NOT a global flip). Rationale: the global flip would impose jsdom overhead on every existing rules-layer test (~150 files); the per-file directive scopes the jsdom cost to only the UI tests that need it. `jsdom ~25.0.1` is already installed at `package.json:50` — no new dep. Concrete pattern for every new UI test file:
  ```ts
  // @vitest-environment jsdom
  // src/ui/ledger/tabs/FamilyTreeTab.test.tsx (etc.):
  import { render } from "@testing-library/react";
  // ... rest of the test ...
  ```
  Verification: post-implementation `pnpm test src/ui/` MUST pass cleanly. Add to verification matrix item #34 as part of the `pnpm test` step.

- **`src/App.tsx` shell — fourth view branch.** Routing precedence (top-to-bottom): Elopement overlay → Ballroom → Promenade → **Ledger (NEW)** → Map (default). Mirrors the existing precedence pattern at `src/App.tsx:56-68`. Concrete edit:
  ```tsx
  // src/App.tsx — P14 EDITS:

  // Add state hook + import:
  import { LedgerView } from "./ui/ledger/LedgerView";
  // ...
  const [inLedger, setInLedger] = useState(false);

  // Routing precedence (replace the existing conditional ladder):
  {elopement !== null ? (
    <ElopementOverlay store={store} />
  ) : inBallroom ? (
    <BallroomView store={store} onExit={() => setInBallroom(false)} />
  ) : inPromenade ? (
    <PromenadeView store={store} onExit={() => setInPromenade(false)} />
  ) : inLedger ? (
    // P14 NEW BRANCH — Ledger is suppressed by Elopement (modal-state precedence)
    // but takes precedence over Map. Entry via TopBar; exit returns to Map.
    <LedgerView store={store} onExit={() => setInLedger(false)} />
  ) : (
    <MapView
      store={store}
      onEnterBallroom={() => setInBallroom(true)}
      onEnterPromenade={() => setInPromenade(true)}
      onEnterLedger={() => setInLedger(true)}
    />
  )}
  ```
  `MapView` signature widens to accept `onEnterLedger?: (() => void) | undefined` — symmetric with the existing `onEnterBallroom` / `onEnterPromenade` props. The threading site lives at `src/App.tsx:65-67`.

  **Elopement-modal precedence.** When `state.elopement !== null` while Ledger is open, the next render swaps to `ElopementOverlay`. The Ledger view component does NOT need its own modal-state gate (the parent shell handles it). On Elopement resolution, the player returns to whichever view they came from — the `setInLedger(true)` state persists across the overlay's lifetime per the standard React local-state semantics. Acceptable v1 behavior.

- **`src/ui/shared/TopBar.tsx` — "View Ledger" button.** New button added to TopBar's right side, between the existing wealth/reputation display and the SettingsMenu mount. Concrete behavior: dispatches `onEnterLedger` prop callback (threaded down through `App.tsx`). Disabled when `state.elopement !== null` (modal-state visual signal — matches the rule-layer gate principle). Concrete signature widening:
  ```tsx
  // src/ui/shared/TopBar.tsx — P14 EDITS:
  type Props = {
    store: SeasonStore;
    onEnterLedger?: (() => void) | undefined;  // NEW at P14
  };

  // Inside the component, alongside existing TopBar content:
  <button
    type="button"
    onClick={onEnterLedger}
    disabled={elopement !== null}
    data-testid="open-ledger-btn"
    className="..."
  >
    View Ledger
  </button>
  ```
  Threading: `App.tsx` already mounts `<TopBar store={store} />` at line 40. The edit passes the new prop: `<TopBar store={store} onEnterLedger={() => setInLedger(true)} />`. SettingsMenu mount line 41 is unchanged.

- **`src/ui/ledger/LedgerView.tsx` (NEW).** The 8-tab shell. **shadcn install decision (resolved at P14): v1 hand-rolls.** Verified live: no `src/components/` directory; zero `@/components/ui` hits in `src/`. shadcn `Tabs` install is a v1.5 candidate per MASTER.md §2 (documented choice but not pre-required); v1 ships hand-rolled DOM with `role="tablist"` + `role="tab"` + `role="tabpanel"` + `aria-selected` + `aria-controls`, with a `Tab` discriminated-union enum in `LedgerView` React-local state. Tab order:
  1. **Family Tree** (default tab on first open — most-frequently-read per playtest priors)
  2. **Whispers**
  3. **Schemes**
  4. **Patronesses**
  5. **Grievances**
  6. **Rivals**
  7. **Staff**
  8. **Artifacts**

  Props:
  ```tsx
  type Props = {
    store: SeasonStore;
    onExit: () => void;
  };
  ```
  Header chrome: a "← Back to Map" button (top-left) firing `onExit`; the tab strip; and the active tab's `data-testid="ledger-tab-{name}"` panel mount point. The tab name persists in React local state for the view's lifetime (no URL routing; no GameState write). Re-entering the Ledger resets to default tab — acceptable v1 behavior, matches the Promenade / Ballroom session-state-discards-on-reload precedent.

  **No render-time fetches; no async work.** Every tab reads from the Zustand store via `useShallow` selectors. The view is fully synchronous and pure.

- **Per-tab specifications.** Each tab lives in `src/ui/ledger/tabs/{TabName}Tab.tsx`. Three tabs WRAP existing inline panels (WhispersTab → existing `WhisperLedgerPanel`; SchemesTab → existing `ActiveSchemesPanel` + a completed/cancelled history sub-section that's NEW at P14; StaffTab → existing `StaffPanel` + existing `SpymasterInterceptCard`). The remaining 5 tabs are NEW components. Selectors enumerated below — all use `useShallow` to bundle subscriptions into a single re-render per tick per CLAUDE.md "single re-render per tick" pin from the P5 `ActiveSchemesPanel` (`src/ui/ledger/ActiveSchemesPanel.tsx:7-12` comment).

  - **`FamilyTreeTab.tsx` (NEW)** — text-first hierarchical render of the player house's characters grouped by generation. Each row shows: portrait placeholder (initial-letter glyph; P22 ships a deterministic colored monogram), name, age, role (HeadOfHouse/Heir/Dependent/Spouse/Spinster/Exile/Bohemian), archetype (Spymaster/BohemianRake/Tutor/CountryExile/None), mood, equipped-artifact-badge count, trait pills (max 6 inline, "+N more" link). **Sibling-rival sub-section** per CLAUDE.md "P11 publisher set" pin AND the Q3-resolved design (`MASTER.md` §10 Q3): `siblingRivals` is a PER-HOUSE array, NOT a per-Character field (verified live at `src/game/entities.ts:169` — `HouseSchema.siblingRivals: z.array(SiblingRivalStateSchema).default([])`). Source: `state.houses.get(PLAYER_HOUSE_ID).siblingRivals.filter(sr => sr.reconciled === false)`. Per-row, resolve the character via `state.characters.get(sr.characterId)` to render name + age + traits alongside the rival-actor metadata (hostility 0-100, action cooldown remaining ticks). **Cooldown derivation (resolves B3 cycle-4-iter-3).** `SiblingRivalState` carries `lastActionTick: z.number().int().nonnegative()` (NOT nullable, verified live at `src/game/entities.ts:92` — promoted siblings get `lastActionTick: state.tick` at promotion time, so the initial cooldown burns at promotion). Derive cooldown-remaining via `Math.max(0, sr.lastActionTick + SIBLING_RIVAL_ACTION_COOLDOWN_TICKS - state.tick)` (constant `SIBLING_RIVAL_ACTION_COOLDOWN_TICKS = 5` verified live at `src/game/constants.ts:742`). When the derivation evaluates to 0 the row shows "Ready"; otherwise shows the integer tick count. No null-handling branch needed — the schema rejects null at parse time. "Reconcile" button gated on `wealth >= SIBLING_RIVAL_RECONCILIATION_WEALTH_COST + reputation >= SIBLING_RIVAL_RECONCILIATION_REPUTATION_COST` (cost values from `src/game/constants.ts` — read live at render time, not hardcoded). Click handler dispatches `store.reconcileSibling(sr.characterId)` per the live store signature at `src/game/store.ts:348-352`. **Social Web toggle**: a "View Social Web" pill toggle at the top of the tab routes to `<SocialWebView />` (see Social Web section below) within the SAME tab panel — does NOT create a 9th tab per the Q9 "coexist" resolution. The toggle state lives in `FamilyTreeTab` local state; resets to text view on tab-switch or Ledger-exit.

    Tutor sub-affordances: for every `Character` with `role === "Dependent" && age < ADULTHOOD_AGE_IN_YEARS` AND `assignedTutorCharacterId === null`, render an "Assign Tutor" dropdown listing eligible adult Tutor-archetype characters in the player house; click dispatches `store.assignTutor(childId, tutorId)`. Constant name verified live at `src/game/constants.ts:27` (`ADULTHOOD_AGE_IN_YEARS = 18`) — do NOT use the shorter `ADULTHOOD_AGE` (does not exist; typecheck-fails). **`PendingTutorTraitChoice` filter form**: the Map shape is `Map<CharacterId, PendingTutorTraitChoice>` per `src/game/entities.ts:566` — the Map KEY IS the child id. The render filter MUST be `[...state.pendingTutorTraitChoices.entries()].filter(([childId]) => state.characters.get(childId)?.houseId === PLAYER_HOUSE_ID)` (deref the child via `state.characters.get` to read its house), NOT a key-shape match against the Map keys directly. For every passing entry, render a "Choose tutor bonus trait" panel with the 2-option choice read from **the entry's snapshot `acceptableTraitIds: [TraitId, TraitId]` tuple** (verified live at `src/game/entities.ts:272` — the snapshot is captured at maturation tick precisely so post-maturation pool widenings don't invalidate pending choices). Do NOT read from `ARCHETYPE_MATURATION_TRAIT_POOL` at render time — the live pool would diverge from the snapshot if a future patch widens the pool while a pending choice is open. Click dispatches `store.chooseTutorBonusTrait(childId, traitId)`. Both action affordances exist on `SeasonStore` since P7 — UI consumer is new at P14.

  - **`WhispersTab.tsx` (WRAPPER)** — directly mounts the existing `WhisperLedgerPanel` (`src/ui/ledger/WhisperLedgerPanel.tsx`) inside the tab panel. ZERO behavioral changes to the panel — it already renders Unverified / Verified / Weaponized sections with the three weaponize buttons + Dismiss. The wrapping shell adds tab-page chrome (a section title, an empty-state "No whispers yet" coverage for the Verified+Weaponized empty case the panel doesn't currently cover). The panel REMAINS importable from `src/ui/ledger/WhisperLedgerPanel.tsx` (its location does not change). MapView's import of it is REMOVED (see the inline-panel removal bullet below).

  - **`SchemesTab.tsx` (WRAPPER + NEW history sub-section)** — wraps existing `ActiveSchemesPanel` for the Active section; adds NEW sub-sections for Completed and Cancelled / Failed history grouped by status. History rows show: scheme kind (from `scheme.kind`), target name (from `state.characters.get(scheme.targetCharacterId).name` or "—" for target-less Smuggling), started tick (from `scheme.startedAtTick`), ended tick (from `scheme.resolvedAtTick`), and outcome prose derived from `scheme.status` + `scheme.failureReason` discriminants ONLY — these are the live fields on `SchemeSchema` at `src/game/entities.ts:299-309`. Do NOT reference `scandalDelta` on the Scheme entity (does not exist — the `scandalDelta` carried by the `SeductionDiscovered` bus event payload at `src/runtime/events/scheme.ts:67-72` is NOT mirrored onto the persisted entity; the cross-validation pin against "selector-driven, not bus-driven" stands). Reads `[...state.schemes.values()].filter(s => s.status !== "Active").sort((a, b) => a.id.localeCompare(b.id))` (lex-sort discipline matches `ActiveSchemesPanel` + `moods.ts` precedent). NO new actions on history rows (history is read-only by design). The "Cancel" affordance on Active rows is unchanged — already routes through `store.cancelScheme(schemeId)` per the existing panel.

    **Per-row `data-testid` contract (resolves B1 cycle-2-iter-3 + B1 cycle-4-iter-1).** Tab-shell mount: `data-testid="ledger-tab-schemes"`. Active section list: `data-testid="schemes-active-list"` (wraps the existing `ActiveSchemesPanel` mount unchanged). History section lists: `data-testid="schemes-history-completed-list"`, `data-testid="schemes-history-cancelled-list"`, `data-testid="schemes-history-failed-list"` per the three discriminants of `scheme.status !== "Active"`. Per-row testid (history): `data-testid="scheme-history-row-{schemeId}"` (the branded `SchemeId` string is unique by construction; no collision).

    **Active-row cancel-button testid backfill (in-scope at P14).** The existing `src/ui/ledger/ActiveSchemesPanel.tsx` ships ZERO `data-testid` attributes today (verified live — only BEM CSS class names like `active-schemes-panel__cancel`). Verification matrix #6's "cancel-button dispatch" needs a stable locator. **Pick: add `data-testid="active-scheme-cancel-{schemeId}"` to the cancel button in `ActiveSchemesPanel.tsx` at line 64 (the existing `<button type="button" className="active-schemes-panel__cancel" ...>` element) as part of P14.** The edit is backwards-compat-safe (additive HTML attribute; no other consumer reads the BEM class via DOM query). Per-row testid (active): `data-testid="active-scheme-cancel-{schemeId}"`. Verification matrix item #6's "cancel-button dispatch" reads this testid for the click target.

  - **`PatronessesTab.tsx` (NEW)** — renders every entry in `state.patronesses` (the top-level `Map<PatronessId, PatronessRecord>` seeded at P8). Per CLAUDE.md MASTER.md §10 Q1 resolution: patronesses are NOT per-house — there are 5 canonical patronesses, each with a `favor: number` ([0, 100], starts at 50). Row layout per patroness: display name, faction affiliation (from `factionId`; resolved to display name via the **4-faction** fixture at `src/game/fixtures/factions.ts:20-25` — `FACTION_IDS.length === 4`: `court`, `ton`, `country`, `crown`. Patronesses are affiliated with 3 of those 4 — Crown has no patroness per the fixture comment at line 24), favor score with a colored bar (green ≥ 60, yellow 40-59, orange 20-39, red < 20 — the < 20 visual cue surfaces the impending veto per spec §3 line 116). NO inline action affordance — patroness favor is mutated by the orchestrator (per-tick erosion on scandal ≥ 50; monarch's-audience +5 boost). Plain reading view.

    Faction-tension matrix sub-section (per CLAUDE.md MASTER.md §10 Q8 resolution at P8: "numeric in rival ledger only" — P14 picks the Patronesses tab as the canonical home because tension reads against patroness factions specifically, AND because the Rivals tab is already dense with rival-actor / inherited-secret / blood-feud content). Renders a **4×4 numeric matrix** from `state.factionTensions` (the `Map<FactionPairKey, number>` from P8, which carries **6 unordered pairs** = `FACTION_IDS choose 2`, verified live at `src/game/fixtures/factions.ts:74` — `FACTION_PAIRS.length !== 6` module-load assertion). Diagonal blank; mirror-symmetric across diagonal (each `factionTensions` entry is keyed by an unordered pair, so cell `(i, j)` and `(j, i)` read the same value). **Row/column header order: `FACTION_IDS` declaration order** (`faction-court / faction-ton / faction-country / faction-crown` per `src/game/fixtures/factions.ts:20-25`), NOT lex order. Rationale: matches `FACTIONS_FIXTURE` rendering convention elsewhere; lex would re-order to `country / court / crown / ton` and confuse readers familiar with the declaration-order convention. **Display labels resolve via `FACTION_DISPLAY_NAMES`** from `src/game/fixtures/factions.ts:29-34` (`["Court", "Ton", "Country", "Crown"]`) — do NOT render raw `faction-*` ids to the user. Each cell shows the tension value (0-100). No interactivity at v1.

  - **`GrievancesTab.tsx` (NEW)** — renders the player house's grievances. Source: `state.houses.get(PLAYER_HOUSE_ID).grievances` (the per-house `Grievance[]` array from P5 widened at P8 with `defendantCharacterId`). Two sub-sections by status:
    - **Outstanding** (`resolved === false`): grouped by `perpetratorHouseId`. Each row shows perpetrator house name, offense kind (kind discriminator), recorded-at tick, defendant character name (if `defendantCharacterId !== null`). Action affordance: "Demand Satisfaction" button gated on `defendantCharacterId !== null && defenderAlive && !defenderExiled && !playerExiled && elopement === null` (the rule-layer gates inside `demandSatisfaction` handle the full validation; UI greys out the button when ANY gate would reject — read the live rejection types from `src/game/store.ts:DemandSatisfactionRejection`). Click dispatches `store.demandSatisfaction(perpetratorHouseId, grievanceId)` and renders the returned `{ duelId, outcome }` in an inline result strip (or a brief modal toast).
    - **Resolved** (`resolved === true`): history list — perpetrator name, offense, `recordedAtTick`, "Resolved" badge ONLY (no resolved tick — `GrievanceSchema` at `src/game/entities.ts:69-82` does NOT carry a `resolvedAtTick` field; only `resolved: boolean` + `recordedAtTick`. The `resolvedAtTick` field at `entities.ts:125` belongs to `BloodFeudSchema`, NOT `GrievanceSchema` — easy misread). Read-only.

    Per CLAUDE.md §10 Q24 resolution: legacy V5-V8 grievances default `defendantCharacterId: null` ("LegacyGrievanceUnactionable") — the button is greyed for those rows with hover-tooltip prose: "Legacy grievance — defendant unrecorded."

  - **`RivalsTab.tsx` (NEW)** — renders every entry in `state.rivalActors` (the per-rival-house `Map<HouseId, RivalActorState>` from P8). Per-rival row: house display name, hostility (0-100), last-action tick, cooldown-remaining display, associated-character count. **Null-handling for `lastActionTick` (resolves B2 cycle-4-iter-3):** `RivalActorState.lastActionTick: number | null` per `src/game/entities.ts:399` (`null` means never-acted; comment at line 393 makes the sentinel explicit). The cooldown-remaining derivation MUST guard the null branch BEFORE the arithmetic: render the literal string `"Ready"` (with no cooldown bar) when `rival.lastActionTick === null`; otherwise render `Math.max(0, rival.lastActionTick + RIVAL_ACTION_COOLDOWN_TICKS - state.tick)` ticks. Constant `RIVAL_ACTION_COOLDOWN_TICKS = 8` verified live at `src/game/constants.ts:558`. The last-action-tick cell renders `"—"` (em-dash) in the null branch instead of the literal `null`. NO inline action affordance against the rival itself (no v1 "declare war" or "extend olive branch" action; v1.5 candidate).

    **Inherited Secrets sub-section** (per CLAUDE.md MASTER.md §10 Q3 resolution at P11): renders the player house's `state.houses.get(PLAYER_HOUSE_ID).inheritedSecrets` array. Per-secret row: description text, originating generation, surfacing-roll status (Unsurfaced / Surfaced — Surfaced secrets show the blood-feud they triggered). Capped at `MAX_INHERITED_SECRETS` (12); the ledger pre-collapses overflow into the `ancestorSummary` per CLAUDE.md "Inherited-secrets ledger eviction" pin — surface a "+N collapsed into ancestor summary" footer line when relevant.

    **Blood Feuds sub-section**: renders `state.houses.get(PLAYER_HOUSE_ID).bloodFeuds` array. Per-feud row (field names verified live at `src/game/entities.ts:118-127`): offending house display name (from `bloodFeud.offendingHouseId`), triggering inherited secret (truncated, resolved via `state.houses[PLAYER].inheritedSecrets.find(s => s.id === bloodFeud.triggeringSecretId)`), triggering grievance id (`bloodFeud.triggeringGrievanceId`), incurred-at tick (`bloodFeud.incurredAtTick`), decay-remaining ticks (`BLOOD_FEUD_DECAY_TICKS_MAX - (state.tick - bloodFeud.incurredAtTick)`, clamped at 0), and a resolved badge when `bloodFeud.resolved === true` showing `bloodFeud.resolutionKind` (`DuelWin` / `DuelLoss` / `GenerationalDecay`) + `bloodFeud.resolvedAtTick`. Field-name discipline: do NOT use `recordedTick` (does not exist — typecheck-fails) or "rival house" framing (the field is `offendingHouseId`; resolved offending houses may be non-rival via future v1.5 widening). Read-only at v1 (no "settle the feud" action — resolution happens via the duel / satisfaction-demanded paths surfaced in GrievancesTab).

  - **`StaffTab.tsx` (WRAPPER)** — directly mounts existing `StaffPanel` (`src/ui/ledger/StaffPanel.tsx`) + existing `SpymasterInterceptCard` (`src/ui/ledger/SpymasterInterceptCard.tsx`). ZERO behavioral changes to either; the wrapper adds a tab-page title and groups the two as logical sub-sections (Staff Roster / Spymaster Action). Both panels REMAIN importable from their existing module paths.

  - **`ArtifactsTab.tsx` (NEW — closes the P10 UI gap).** P10 shipped the rules layer + store wrappers (`equipArtifact` / `unequipArtifact` / `commissionForgery` / `thwartTheft`) + bus events (`artifactBus`) + selectors but NO UI consumer. P14 ships the consumer:
    - **Player inventory list.** Source: `[...state.artifactInstances.values()].filter(a => a.ownerHouseId === PLAYER_HOUSE_ID)` lex-sorted by id. Grouped by `ownerCharacterId` (one expandable accordion per character; default collapsed when > 1 character holds artifacts). Per-instance row:
      - Display name (from `ARTIFACT_REGISTRY.get(instance.definitionId).displayName`)
      - Family badge (from `def.family`)
      - Equipped state pill (read against `state.characters.get(ownerCharacterId).equippedArtifactIds.includes(instance.id)`)
      - Wardrobe-decay badge: rendered **only on currently-equipped instances** (suppressed on unequipped per resolution of B3 cycle-2-iter-2). In-season (`state.tick - lastRefreshTick <= WARDROBE_REFRESH_INTERVAL_TICKS`) renders green; out-of-season renders red with "Refresh wardrobe" hint. **Rationale:** `applyWardrobeRefresh` at `src/game/rules/wardrobeRefresh.ts:55-66` only resets `lastRefreshTick` on EQUIPPED instances (loop iterates `ch.equippedArtifactIds`). An unequipped instance's clock is never advanced, so an unconditional badge would render "out-of-season" indefinitely with no action available to clear it — the wardrobe-decay PENALTY only fires on equipped artifacts per `applyPreBallComposurePenaltyPure`, so the badge is meaningful only when the instance is equipped. Unequipped instances render no decay badge (the inventory row still shows reputation bonus + scandal-risk + forged-flag + equipped-state pill, just not the seasonal indicator)
      - Reputation bonus (from `def.reputationBonusWhileEquipped` — display unconditionally so the player can compare un-equipped vs equipped contribution)
      - Scandal-risk-while-worn (from `def.scandalRiskWhileEquipped`)
      - Forged badge (from `instance.forgedFlag` — visual marker; surfaced forgeries additionally show the surfacing tick read from the `state.forgeries` Map by `forgedArtifactInstanceId` FK)
    - **Equip / Unequip buttons.** Per-row. Equip greyed when (a) character already equips ANY instance of the same family (max-one-per-family rule enforced by `applyEquipArtifactPure`; UI mirrors the rejection), or (b) character is dead (`alive === false`), or (c) modal-state gates fire (`PlayerExiled` / `ElopementInProgress`). Unequip greyed when not currently equipped. Click handlers dispatch `store.equipArtifact(characterId, instanceId)` / `store.unequipArtifact(characterId, instanceId)`; rejection prose surfaces via inline toast (reuse `ActionRejectionToast` from `src/ui/map/ActionRejectionToast.tsx`).
    - **Wardrobe refresh affordance.** A single "Refresh Wardrobe" button at the top of the inventory list. Cost label reads `WARDROBE_REFRESH_WEALTH_COST` from `src/game/constants.ts`. Gated on `currentLocation === "Capital"` (the rule-layer rejection `WrongLocation` is the source of truth; UI greys + tooltip). Click dispatches the existing P3 `store.refreshWardrobe()` action — reused; NO new action shipped.
    - **Forgery ledger (sub-section).** Gated on the player house having at least one alive `BohemianRake`-archetype character. Selector (wrapped in `useShallow` for consistency with the per-tab subscription convention pinned in the LedgerView shell): `useShallow((s) => ({ hasRake: [...s.characters.values()].some(c => c.houseId === PLAYER_HOUSE_ID && c.alive && c.archetype === "BohemianRake"), forgeries: s.forgeries, characters: s.characters }))`. When ungated, renders a single sentence: "Forgery requires a living Bohemian Rake in the household." When gated, lists every `state.forgeries` entry whose owning character is in the player house. Per-row: forger name, forged-at tick, status (Unsurfaced / Surfaced at tick N), referenced `ArtifactInstance` summary. **Commission button**: opens a dropdown of every forgeable `ArtifactDefinition` (`def.forgeable === true` in `ARTIFACT_REGISTRY`); each row shows the family + the `forgeWealthCost`. Selecting an entry dispatches `store.commissionForgery(forgerCharacterId, definitionId)`. **Forger picker determinism**: the UI passes the **lex-smallest characterId** among `(c.alive && c.archetype === "BohemianRake" && c.houseId === PLAYER_HOUSE_ID)` (matches the `moods.ts` "lex-sort iteration over identifier Maps" CLAUDE.md non-negotiable so the picker is stable across re-renders even before multiple-Rake gameplay matters). Future v1.5 widening could expose an explicit forger picker if multiple Rakes coexist.
    - **Thief-attempt banners and resolution history.** Sub-section. Source: `state.thiefAttempts`. **In-flight** (`thwarted === null`) entries render as a prominent banner-style row at the TOP of the Artifacts tab (above the inventory list) with a red border + "Thwart Attempt" button. The button is gated per the live `applyThwartTheftPure` 4-predicate filter (living Spymaster archetype in player house + `wealth >= THWART_WEALTH_COST` + at least one `InFlight` `Inbound` interceptable courier in `state.couriers` — verify the exact predicate list against `src/game/rules/artifacts.ts` at implementation time). Constant name verified live at `src/game/constants.ts:689` (`THWART_WEALTH_COST = 15`) — do NOT use the longer `SPYMASTER_THWART_WEALTH_COST` (does not exist; typecheck-fails). Click dispatches `store.thwartTheft(thiefAttemptId)`; outcome banner switches to a brief success/failure result-strip and the row migrates to history on the next render tick. **Resolved** (`thwarted !== null`) entries collapse into a History sub-section sorted by `noticedAtTick` descending.

    **Reputation projection display.** TopBar today renders only campaignName + currentLocation + headAge + tick (verified live at `src/ui/shared/TopBar.tsx`) — it does NOT render wealth or `getEffectiveReputation`. P14 ships a TopBar widening as a separate sub-bullet (immediately below) to add a wealth + effective-reputation read-out; ArtifactsTab then surfaces the per-instance contribution so the player can reconcile the new TopBar total against the inventory. Without the TopBar widening, the artifact equip/unequip outcome is invisible to the player except inside ArtifactsTab itself.

  - **Persistent exile-banner relocation (resolves B2 cycle-4-iter-1).** Today the exile banner lives ONLY in `src/ui/map/MapView.tsx:110-119` — when the player has Ledger / Ballroom / Promenade open at exile-trigger time (e.g., Scandal Sheet attribution → ScandalSheetAttribution → exile flip), the banner is invisible. Per CLAUDE.md "Modal-state rule-layer gate principle (P9 generalization of P6)" and the cross-view modal-state surface requirement, P14 HOISTS the exile banner from `MapView` into the persistent chrome at `src/App.tsx` (between the existing TopBar mount and the view-routing block). All four views (Map / Ballroom / Promenade / Ledger) and the Elopement overlay then share the signal. Concrete edits:
    ```tsx
    // src/App.tsx — P14 EDIT (insert between the TopBar row at lines 39-42 and the
    // CorruptSaveBanner at line 43):

    // P14: hoisted from MapView so the exile banner surfaces across every view.
    // Selector reads the player house's exile flag; renders unconditionally when
    // true (no view-routing dependency).
    const isExiled = store((s) => s.houses.get(PLAYER_HOUSE_ID)?.exiled === true);
    // ... inside JSX, between TopBar row and CorruptSaveBanner:
    {isExiled && (
      <div
        role="alert"
        aria-live="assertive"
        className="bg-red-900 text-white px-6 py-3 font-bold text-center"
        data-testid="exile-banner"
      >
        House Exiled — Campaign Ended. Start a new game from the Settings menu.
      </div>
    )}

    // src/ui/map/MapView.tsx — P14 EDIT (REMOVE the existing exile-banner block at lines 100-119):
    //   const isExiled = house?.exiled === true;
    //   ... and the {isExiled && (<div role="alert" ... data-testid="exile-banner">...</div>)} block.
    // The `data-testid="exile-banner"` selector survives — only its mount site moves.
    ```
    Verification matrix #30 (MapView inline-panel removal) extends to also assert the exile-banner is NO LONGER inside MapView. NEW verification matrix item: see #36 added below.

  - **TopBar widening (sub-bullet of the TopBar "View Ledger" button bullet above).** Two new read-outs added to `src/ui/shared/TopBar.tsx`, between the existing `head-age-readout` and `tick-readout` cells:
    ```tsx
    // src/ui/shared/TopBar.tsx — P14 EDITS (selector + cells):

    // Selector (alongside existing tick/campaignName/headAge/currentLocation). Wrapped in
    // useShallow per the WhisperLedgerPanel.tsx:17-22 precedent — `getEffectiveReputation`
    // reads BOTH s.houses AND s.characters; without useShallow, every unrelated mutation
    // to either Map causes a re-render. The bundle returns primitives so the shallow-
    // equality check matches Zustand's default selector semantics:
    const { wealth, effectiveReputation } = store(useShallow((s) => ({
      wealth: s.houses.get(PLAYER_HOUSE_ID)?.wealth ?? null,
      effectiveReputation:
        s.houses.get(PLAYER_HOUSE_ID) !== undefined
          ? getEffectiveReputation(s, PLAYER_HOUSE_ID)  // import from src/game/rules/artifacts.ts
          : null,
    })));

    // Cells (insert before the existing tick-readout div):
    <div className="text-sm text-stone-600" data-testid="wealth-readout">
      Wealth: <span className="font-medium text-stone-800">{wealth ?? "—"}</span>
    </div>
    <div className="text-sm text-stone-600" data-testid="effective-reputation-readout">
      Reputation: <span className="font-medium text-stone-800">{effectiveReputation ?? "—"}</span>
    </div>
    ```
    Verify the live `getEffectiveReputation` export path at implementation time via `grep -rn 'export function getEffectiveReputation' src/game/`. The selector relies on Zustand re-rendering whenever `state.houses` or `state.characters` mutates (equip/unequip dispatches both `equipArtifact`'s pure mutation AND any reputation projection input change). Verification matrix item #23 reads this new TopBar cell.

- **Social Web visualization (`src/ui/socialWeb/SocialWebView.tsx` NEW).** `react-force-graph-2d` wrapper rendering the player house's outbound affection network. The graph is computed from existing GameState reads — NO new GameState fields, NO new buses, NO orchestrator phases:
  - **Nodes**: every `Character` `c` such that EITHER `c.houseId === PLAYER_HOUSE_ID` OR there exists an entry in `state.affectionMap` keyed by `${PLAYER_HOUSE_ID}|${c.id}`. Player-house characters render with a distinct color (gold border); other characters render with their house's faction color (read from `state.houses.get(c.houseId).factionId` → faction color from a P14-local `FACTION_COLOR_BY_ID` constant in `src/ui/socialWeb/colors.ts` — NOT a runtime fixture; pure rendering value).
  - **Edges**: every entry in `state.affectionMap` whose key starts with `${PLAYER_HOUSE_ID}|` (parsed via `parsePairKey(key)` and filtered to `parsed.houseId === PLAYER_HOUSE_ID`). The pair-key shape per `src/game/conversation/types.ts:17` is `${HouseId}|${CharacterId}` where the HouseId is the **owner's** house (the perspective the affection score is FROM). Use the typed helper `parsePairKey(key)` (live at `src/game/conversation/types.ts:41-49` — returns `{ houseId, characterId }` typed correctly); do NOT use raw `split("|")`. **Pair-key direction (corrected at B3 cycle-4-iter-2).** NPC-side affection keys DO exist in `state.affectionMap` — concretely, `makePairKey(ch.houseId, playerHead)` is written by `src/game/rules/artifacts.ts:399` (forgery surfacing → Vain NPCs' affection toward player) and analogous sites at `src/game/rules/inheritedSecrets.ts:209` (blood-feud affection penalty from rival-associates toward player), `src/game/rules/schemes.ts:465, 595` (scheme-target sites where `ownerHouseId` may be a rival), and `src/game/rules/whispers.ts:297` (owner-toward-subject pair). Player-side keys come from `makePairKey(PLAYER_HOUSE_ID, npcCharId)` at `src/game/store.ts:952, 2009` (ballroom + promenade speaker sides) and `src/game/rules/promenade.ts:247` and `src/game/rules/proposal.ts:157`. **P14 scope decision: render player-OUTBOUND edges only** (filter to `parsed.houseId === PLAYER_HOUSE_ID`). NPC-to-player edges are intentionally DEFERRED to v1.5 — at v1 the Social Web's purpose is "player-perspective social distance" per spec §3 line 256-262 ("the player house's affection network"). Rendering both directions doubles edge density and forces a bidirectional-edge force-graph configuration that v1 doesn't need. Edge weight = `affection / 100` (0.0-1.0); force-graph edge strength uses this directly (higher affection → shorter rest-length → portrait clusters closer to player).
  - **Pan + zoom + drag**: native `react-force-graph-2d` features; no per-node custom interaction beyond the library default.
  - **Reactive animations** via `framer-motion`. Hook: `src/ui/socialWeb/useSocialWebReactions.ts` (NEW). **Mount location: INSIDE `SocialWebView`** (NOT FamilyTreeTab top-level). Rationale: cues are visualization-only — subscribing while the player is in the text view of FamilyTreeTab is pure overhead; the events that would fire while the graph is hidden cannot affect any rendered cue. The hook's subscriptions live ONLY while the graph component is mounted (subscriptions re-register on every toggle into the graph view; events fired during the text-view interval are silently dropped — acceptable v1 behavior since cues are presentation-only and not load-bearing for state correctness). Subscribes via `useBusEvent` to (LIVE payload field names verified at the cited line numbers; field name drift is a known regression bait at v1):
    - `conversationBus` `"FauxPasFired"` (verified live at `src/runtime/events/conversation.ts:68-72`; payload: `{ kind, tick, targetCharacterId, lockUntilTick, wasAlreadyLocked }`) → emits a "slide-away" cue for `event.targetCharacterId`. Note: only the ballroom path publishes `FauxPasFired` — `sendPromenadeMessage` does NOT (verified: zero grep hits in `src/game/rules/promenade.ts` and the store wrapper). The Social Web slide reaction therefore fires only from ballroom faux-pas at v1.
    - `schemeBus` `"SchemeCompleted"` (verified live at `src/runtime/events/scheme.ts:51-56`; payload is FLAT: `{ kind, tick, schemeId, schemeKind, ownerHouseId, targetCharacterId }` — NO nested `scheme` object). Subscriber filter + null-guard: `if (event.schemeKind !== "Sabotage" || event.targetCharacterId === null) return;` (resolves B3 cycle-3-iter-1). The type is `targetCharacterId: CharacterId | null` (Smuggling is the canonical target-less scheme; the type-system permits null for any future target-less scheme kind too). The null-guard is BELT-AND-SUSPENDERS — narrowly, Sabotage always carries a target at v1, so the `schemeKind` filter already excludes Smuggling — but the cue Map shape is `Map<CharacterId, AnimationCue>` and TypeScript strict-mode rejects a `null` Map key, so the guard is REQUIRED by the type system before the `cue.set(event.targetCharacterId, ...)` write. Cue uses `event.targetCharacterId` directly after the guard.
    - `familyBus` `"ProposalRejected"` (verified live at `src/runtime/events/family.ts:29-34`; payload: `{ kind, proposerId, targetId, scandalDelta, tick }` — the target-field name is **`targetId`**, NOT `targetCharacterId`). Cue uses `event.targetId`.

    Each cue is a `{ characterId: CharacterId; expiresAtMs: number }` entry in a local `Map<CharacterId, AnimationCue>`. The cue TTL is `SOCIAL_WEB_SLIDE_DURATION_MS = 2000` (P14-local UI constant; not in `src/game/constants.ts` — pure rendering value). While a cue is active, the corresponding force-graph node's per-node force is temporarily augmented with a "repel from player" vector via the library's `nodeCanvasObject` override — concrete implementation defers to `react-force-graph-2d` docs (use Context7 MCP at implementation time per CLAUDE.md "Always use Context7 MCP" pin).
  - **Reading-only.** Zero mutation affordances. The Social Web does NOT expose equip/unequip, weaponize, dismiss, or any other action — those live in their owning tabs. Per spec §3 line 262 "Reading-only view; all mutations happen elsewhere."
  - **Performance budget.** Player house ≈ 8 characters; outbound affection edges typically 15-40 at mid-campaign. Well within `react-force-graph-2d`'s 1000+ node design envelope. No virtualization needed.

- **Inline-panel REMOVAL from `src/ui/map/MapView.tsx`.** The four inline ledger panel imports + mounts (`ActiveSchemesPanel`, `WhisperLedgerPanel`, `StaffPanel`, `SpymasterInterceptCard` — verified live at `src/ui/map/MapView.tsx:8-11, 177-181`) are REMOVED. The sidebar shrinks to `LocationDetailsPanel` alone. The panel COMPONENTS themselves remain at their existing file paths (`src/ui/ledger/*.tsx`); only the MapView's mount sites are removed. Concrete diff:
  ```tsx
  // src/ui/map/MapView.tsx — P14 EDITS:

  // Lines 8-11 — REMOVE these imports:
  //   import { ActiveSchemesPanel } from "../ledger/ActiveSchemesPanel";
  //   import { SpymasterInterceptCard } from "../ledger/SpymasterInterceptCard";
  //   import { StaffPanel } from "../ledger/StaffPanel";
  //   import { WhisperLedgerPanel } from "../ledger/WhisperLedgerPanel";

  // Lines 175-181 — REMOVE the panel mounts; sidebar becomes:
  <div className="w-80 space-y-4">
    <LocationDetailsPanel
      store={store}
      location={currentLocation}
      onEnterBallroom={onEnterBallroom}
      onEnterPromenade={onEnterPromenade}
    />
    {/* P14: ledger panels MOVED into the dedicated LedgerView (TopBar entry).
        Map sidebar is location-focused. */}
  </div>

  // MapView Props type — ADD onEnterLedger prop:
  type Props = {
    store: SeasonStore;
    onEnterBallroom?: (() => void) | undefined;
    onEnterPromenade?: (() => void) | undefined;
    onEnterLedger?: (() => void) | undefined;  // NEW at P14
  };
  ```
  Per CLAUDE.md "Avoid backwards-compatibility hacks": delete the imports outright; do not leave `// @ts-ignore` or commented imports. The Tailwind classes referenced only by the removed panels (e.g., `whisper-ledger-panel__*` BEM-style class names inside `WhisperLedgerPanel`) STAY because the panels themselves still exist as importable components — they're now consumed by Ledger tabs.

- **Animation hook discipline.** `useSocialWebReactions.ts` is the only NEW subscription site. It MUST pair each `useBusEvent` registration with the existing hook's automatic cleanup (`src/runtime/events/useBusEvent.ts` already handles unsubscribe-on-unmount per CLAUDE.md §3 "every subscription pairs with a cleanup unsubscribe"). Multiple buses → multiple `useBusEvent` calls inside the same hook body; React's hook rules (always-called, no conditionals) apply.

- **No-op for save-format chain tests.** `src/persist/migrations/v1-to-v13-chain.test.ts` (the live chain test at P13) STAYS green without modification — P14 makes ZERO save-format changes. No `v1-to-v14-chain.test.ts` is shipped. CONFIRM this in the P14 verification matrix: "Re-run `pnpm test` after P14 ships; the v1-to-v13-chain test must STILL be the longest-walk chain test in the suite."

- **Hash-extension test is unchanged.** `src/game/schema-projection-selector-extension.test.ts` STAYS green — P14 widens neither schema nor projection nor selector nor overwriteFromGameState. CONFIRM this in verification.

- **Lint boundaries.** UI imports are unchanged in shape: `src/ui/**` imports from `src/game/store.ts`, `src/game/entities.ts` (types), `src/game/constants.ts` (designer values), `src/game/conversation/types.ts` (pair-key parsing), `src/runtime/events/**` (bus subscriptions), `src/game/fixtures/**` (rendering: faction colors, artifact registry, archetype trait pools). `src/ui/socialWeb/SocialWebView.tsx` adds `react-force-graph-2d` and `framer-motion` imports — these are external deps, no boundary rule cares about external imports. `src/ui/ledger/tabs/FamilyTreeTab.tsx` imports `SocialWebView` from a sibling subdirectory — verify `boundaries.test.ts` doesn't prohibit `ui → ui` cross-subdirectory imports (it doesn't per the existing `MapView → ledger/*` precedent at `src/ui/map/MapView.tsx:8-11` pre-P14 removal).

  **`PLAYER_HOUSE_ID` + brand-type import path discipline (load-bearing — resolves B1 cycle-3-iter-1).** ESLint rule (b) at `eslint.config.js:114-118` disallows UI from importing `game-rng` directly: `from: ["ui", ...], disallow: ["game-rng"], message: "game/rng must not be imported from UI..."`. **Verified live: `pnpm lint:boundaries` currently fails with 11 errors** — type-only imports (`import type { StaffId } from "../../game/rng"`) DO fail the rule today (plugin-boundaries does not natively distinguish type-only imports). Affected files: `src/ui/ledger/StaffPanel.tsx:8`, `src/ui/ledger/WhisperLedgerPanel.tsx:9`, `src/ui/ledger/SpymasterInterceptCard.tsx:8`, `src/ui/ballroom/SchemeButtons.tsx:18-19`, `src/ui/ballroom/PortraitRing.tsx:4`, `src/ui/ballroom/BallroomView.tsx:11`, `src/ui/elopement/ElopementOverlay.tsx:13`, `src/ui/promenade/PromenadeView.tsx:18` (count confirmed = 11 errors across 8 files).

  **Resolution pick: widen `src/game/rng.seeds.ts` to re-export the brand types** consumed by UI. The seeds module already lives in the `game-other` element (boundary-clean for UI consumers) and already re-exports `PLAYER_HOUSE_ID` at line 9. Adding brand-type re-exports is a one-line addition per type — zero runtime cost (TypeScript erases type-only re-exports at compile time, so the "Re-export does NOT launder the boundary — production rules MUST import directly from `../rng`" comment at `rng.seeds.ts:8` continues to hold for value imports). Concrete edit:
  ```ts
  // src/game/rng.seeds.ts — P14 EDITS (append after existing PLAYER_HOUSE_ID line):

  // P14: brand-type re-exports for UI consumers. Type-only re-exports (TS-erased
  // at compile time) — runtime determinism boundary stays intact because no
  // runtime artifact crosses. Rules-layer still imports directly from "./rng"
  // per the existing module-header comment.
  export type {
    CharacterId,
    HouseId,
    WhisperId,
    StaffId,
    SchemeId,
    GrievanceId,
    DuelId,
    ArtifactInstanceId,
    ForgeryId,
    ThiefAttemptId,
    PromenadeSessionId,
    BallSessionId,
    GlobalEventId,
    BloodFeudId,
    InheritedSecretId,
    PatronessId,
    MarriageId,
    CourierPayloadId,
    SiblingRivalActorId,  // P14: FamilyTreeTab sibling-rival sub-section row keys
    FactionId,            // P14: PatronessesTab faction-color + matrix headers
    FactionPairKey,       // P14: factionTensions matrix Map iteration
  } from "./rng";
  ```
  **List exhaustiveness pin (resolves B9 cycle-4-iter-4).** The block above is the FINAL list for P14 (not "implementer-audited" — exhaustively walked against per-tab specs: FamilyTreeTab needs `CharacterId` + `HouseId` + `SiblingRivalActorId` + `TraitId` (TraitId already re-exportable via `fixtures/traits.ts` per existing precedent); WhispersTab needs `WhisperId` + `CharacterId`; SchemesTab needs `SchemeId` + `CharacterId`; PatronessesTab needs `PatronessId` + `FactionId` + `FactionPairKey`; GrievancesTab needs `GrievanceId` + `HouseId` + `CharacterId` + `DuelId`; RivalsTab needs `HouseId` + `CharacterId` + `BloodFeudId` + `InheritedSecretId`; StaffTab needs `StaffId` + `CharacterId`; ArtifactsTab needs `ArtifactInstanceId` + `ForgeryId` + `ThiefAttemptId` + `CharacterId`; SocialWebView needs `CharacterId` + `HouseId`). All brands enumerated above; the block IS the contract. Verify via `grep -n '^export type' src/game/rng.ts` at implementation time as a defense-in-depth check, but do not re-derive the list — trust this block as canonical.

  **Migration step (in-scope at P14, NOT deferred).** P14 ships:
  1. The `rng.seeds.ts` widening above (1 file).
  2. Migration of every pre-existing violator to import brand types from `rng.seeds` (8 files; `import type {...} from "../../game/rng"` → `import type {...} from "../../game/rng.seeds"`).
  3. Every NEW UI module (LedgerView, 8 tab files, SocialWebView, useSocialWebReactions, TopBar widening) imports both `PLAYER_HOUSE_ID` and any brand types from `rng.seeds`, NEVER from `rng`.

  After the migration, `pnpm lint:boundaries` MUST drop from 11 errors to **2 errors** — NOT 0. The 2 residual errors are PRE-EXISTING rule-(a) violations in the rules layer (NOT P14-introduced, NOT in the P14 8-file UI migration scope, NOT in the ledger feature surface): `src/game/rules/inheritedSecrets.ts:38` and `src/game/rules/siblingRivals.ts:42` (both `import type { GameState } from "../store"` — the violation is that `GameState` should import from `src/game/entities.ts:600` instead of `../store`, since rules-layer files cannot import from the store). These 2 violations predate P14 and are explicitly OUT OF SCOPE — fixing them is a 2-file `import type` source swap that belongs in a separate cleanup commit or follow-up phase (e.g., P19 pre-ship cleanup). Verification matrix item #34 reflects the carve-out: assert `pnpm lint:boundaries` produces EXACTLY 2 errors, both in the carved-out rules files, post-migration. Future widening of the carve-out (e.g., a fresh rule-(a) violation introduced by a later phase) reopens P14's verification.

- **Accessibility minima.** Tab strip uses ARIA `role="tablist"` / `role="tab"` / `aria-selected` / `aria-controls`. Action buttons have `aria-label` matching their button text. Social Web has `role="img" aria-label="Social Web visualization — affection network"` on the canvas wrapper. The graph is visual-only; screen-reader users get the textual Family Tree view (the toggle defaults to text, so AT users see the accessible version by default).

**Out of scope.**

- Real character portraits (initial-letter glyph at v1 — procedural portraits are a v1.5 item, §11.2-J; P16 deferred them). <!-- P21 §11.3-1 fix: P16 did not ship portraits; the deferral is the single authority. P22 update: shipped as a deterministic colored monogram (per-CharacterId hashed background + faction ring) in FamilyTreeTab + SocietyView, not a full identicon. -->
- URL routing for tab selection (Ledger tab state is React-local; no `?tab=whispers` query param). v1.5 candidate if playtest reveals deep-linking demand.
- Activity / Event log tab (no aggregated "everything that happened recently" view). The TopBar chip row covers global events at P13; per-domain history lives inside each tab's own sub-sections. v1.5 candidate.
- Sortable / filterable tables. Every list is lex-sorted by id at render time; no column-sort UI. v1.5 candidate.
- Real-time multi-user collaboration on the Social Web (not a multi-user app).
- Editing affection values directly from the Social Web (rule-violating — all mutations stay in their orchestrators).
- A "fast-forward to next interesting event" affordance from the Ledger (deferred — `advanceTick` is the canonical time-pump; auto-tick-while-idle is a v1.5 quality-of-life feature).
- Procedural-content tabs (LLM-generated scandal-sheet column from spec §3 line 271 — that's P18).
- shadcn install if not already present. If the repo doesn't yet have shadcn `Tabs` installed at P14 start, hand-roll DOM tabs (per the implementation note in the LedgerView bullet). Adding shadcn is a separate CLAUDE.md amendment.

**Spec refs.** §3 "Ledger View" (line 152-157), "Social Web Visualization" (line 256-262), "Wardrobe, Artifacts & Heirlooms" (line 167-174), "Forgery & Theft" (line 176-183), "Patronesses & Faction Politics" (line 113-119), "Duels & Grievances" (line 121-126 — for Grievances tab "Demand Satisfaction" affordance), "Sibling Rivals" (line 216-223 — for FamilyTreeTab sub-section), "Inherited Secrets & Blood Feuds" (line 240-246 — for RivalsTab sub-sections). §10 OQ#9 (Social Web vs textual — RESOLVED to coexist).

**Open questions (§10).**

- **#9** — Should the Social Web visualization replace the textual family/affection ledgers in v1, or coexist? **RESOLVED at P14: Coexist.** Family Tree tab is text-first; the Social Web is a togglable sub-view within the same tab (pill toggle at top of FamilyTreeTab; resets to text on tab-switch). Rationale: text view is scannable for exact affection values and accessible to AT users; Social Web is the spatial reading view for relative social distance. Drop a tab in v1.5 if playtest proves redundancy.

**Verification matrix.**

| # | Surface | Check | How verified |
|---|---|---|---|
| 1 | Package manifest | `framer-motion ~12.0.0` + `react-force-graph-2d ~1.27.0` present in `package.json` `dependencies`; `pnpm install` completes without peer-dep error | `cat package.json \| grep -E 'framer-motion\|react-force-graph'` + clean `pnpm install` run |
| 2 | Routing | TopBar "View Ledger" button opens LedgerView; "Back to Map" returns to MapView | Playwright: click `[data-testid=open-ledger-btn]`, assert `[data-testid=ledger-view]` visible; click back, assert `[data-testid=map-view]` visible |
| 3 | Modal precedence | When `state.elopement !== null`, Ledger is suppressed and ElopementOverlay renders even if Ledger was open | Vitest: render `App` with `store.elopement` set; assert ElopementOverlay mounts and LedgerView does not |
| 4 | Tab navigation | Each of the 8 tabs activates on click and renders its panel | Playwright: iterate tab labels, click each, assert `[data-testid=ledger-tab-{name}]` visible |
| 5 | Whispers tab — existing panel reuse | Verified whispers show 3 weaponize buttons + Dismiss; clicking Blackmail dispatches `weaponizeWhisper` | Vitest: render WhispersTab on a state with one Verified whisper; spy `store.weaponizeWhisper`; assert call shape on Blackmail click |
| 6 | Schemes tab — history sub-section | Completed / Cancelled / Failed schemes render in history; Active schemes render in active section; cancel button on Active routes to `cancelScheme` | Vitest: seed state with schemes of each status; assert per-status counts + cancel-button dispatch |
| 7 | Family Tree — text view | Player-house characters render grouped by generation; age, role, archetype, mood, traits visible | Vitest: render FamilyTreeTab; assert per-character row count = `characters.filter(houseId === PLAYER_HOUSE_ID).length` |
| 8 | Family Tree — sibling-rival sub-section | Unreconciled sibling-rivals render with hostility + Reconcile button; Reconcile dispatches `store.reconcileSibling` | Vitest: seed state with one unreconciled sibling-rival; assert button present + dispatch on click |
| 9 | Family Tree — tutor sub-affordances | Dependents w/o tutor render Assign-Tutor dropdown; pending trait choices render 2-option picker | Vitest: seed state with one untutored dependent + one pending tutor-trait choice; assert UI surfaces both affordances |
| 10 | Social Web toggle | Pill toggle switches FamilyTreeTab between text and force-graph view; resets to text on tab-switch | Playwright: open tab, toggle, assert canvas present; switch tab, return, assert text view |
| 11 | Social Web — node + edge count | Nodes = union(player-house chars, affectionMap targets); edges = affectionMap entries keyed by `${PLAYER_HOUSE_ID}\|` | Vitest: render SocialWebView on a seeded affectionMap; assert node/edge counts match selector output |
| 12 | Social Web — faux-pas reaction (ballroom-only) | `conversationBus.publish({ kind: "FauxPasFired", tick, targetCharacterId: X, lockUntilTick, wasAlreadyLocked })` triggers a slide-away cue for X. NEGATIVE CONTROL: dispatching `store.sendPromenadeMessage(...)` (or any other non-ballroom code path) does NOT trigger a cue — verifies the ballroom-only publish boundary per `src/game/store.ts:1224` | Vitest: render SocialWebView; publish FauxPasFired → assert cue Map contains X with non-zero TTL. Separately: invoke promenade send path → assert cue Map remains empty (negative control protects against v1.5 promenade-FauxPas widenings silently double-firing the cue) |
| 13 | Social Web — sabotage reaction | `schemeBus.publish({ kind: "SchemeCompleted", tick, schemeId, schemeKind: "Sabotage", ownerHouseId, targetCharacterId: Y })` triggers slide-away for Y (flat payload per `src/runtime/events/scheme.ts:51-56`; filter is `event.schemeKind === "Sabotage"`) | Vitest: same as 12 with sabotage event |
| 14 | Social Web — proposal-rejection reaction | `familyBus.publish({ kind: "ProposalRejected", proposerId, targetId: Z, scandalDelta, tick })` triggers slide-away for Z (field name is `targetId`, NOT `targetCharacterId`, per `src/runtime/events/family.ts:29-34`) | Vitest: same as 12 with proposal-rejected event |
| 15 | Patronesses tab | `PATRONESSES_FIXTURE.length` patronesses render with favor scores + faction colors (4-faction palette per `src/game/fixtures/factions.ts:20-25`; the patroness rows map to 3 of 4 factions — Crown has no patroness per the fixture comment at `factions.ts:24`); faction-tension matrix renders with diagonal blank, mirror-symmetric off-diagonal, and `FACTION_PAIRS.length` unique tension values | Vitest: render PatronessesTab on bootstrap state; assert `rows.length === PATRONESSES_FIXTURE.length` (derives from the fixture so a future widening auto-cascades); assert matrix has `FACTION_IDS.length` rows × `FACTION_IDS.length` cols, diagonal cells blank, and the off-diagonal value-set's distinct count equals `FACTION_PAIRS.length` |
| 16 | Grievances tab — outstanding | Outstanding grievances render; "Demand Satisfaction" greyed when `defendantCharacterId === null` | Vitest: seed state with one legacy + one post-P8 grievance; assert button-disabled state per row |
| 17 | Grievances tab — demand action | Clicking Demand Satisfaction on actionable grievance dispatches `demandSatisfaction` with correct args | Vitest: spy + click; assert dispatch shape; assert returned duel outcome renders in result strip |
| 18 | Rivals tab | Each rival in `state.rivalActors` renders with hostility + cooldown + associated-character count | Vitest: render RivalsTab on P8 bootstrap state; assert `[...rows].length === RIVAL_HOUSE_IDS_SET.size` (NOT a hardcoded `3` — derives from the module-load-asserted set size at `src/game/fixtures/rivals.ts:158` so a future v1.5 rival-widening auto-cascades through the test) |
| 19 | Rivals tab — inherited secrets | `state.houses[PLAYER].inheritedSecrets` renders with Unsurfaced/Surfaced status; "+N collapsed" footer when length > `MAX_INHERITED_SECRETS` | Vitest: seed 13 secrets; assert 12 rows + "+1 collapsed" footer |
| 20 | Rivals tab — blood feuds | `state.houses[PLAYER].bloodFeuds` renders per-row with `offendingHouseId` resolved to display name, triggering secret (via `triggeringSecretId` FK), `incurredAtTick`, decay-remaining (`BLOOD_FEUD_DECAY_TICKS_MAX - (state.tick - incurredAtTick)` clamped), and a resolved badge w/ `resolutionKind` + `resolvedAtTick` when `resolved === true` | Vitest: seed one unresolved + one resolved blood feud; assert row contents include the live field names (per `src/game/entities.ts:118-127`) |
| 21 | Staff tab — wrapper | StaffPanel + SpymasterInterceptCard mount inside the tab without regression | Playwright: existing staff/spymaster tests re-pointed at `[data-testid=ledger-tab-staff]` |
| 22 | Artifacts tab — inventory | Player-owned artifacts render grouped by holder; equip/unequip buttons gated per family + alive | Vitest: seed 3 starter artifacts; assert button states for valid + invalid equip targets |
| 23 | Artifacts tab — equip dispatch | Equip button dispatches `store.equipArtifact`; the new `[data-testid=effective-reputation-readout]` TopBar cell (added by the P14 TopBar widening sub-bullet) updates after equip | Vitest: spy + click + assert TopBar's new effective-reputation-readout cell re-renders with the post-equip value from `getEffectiveReputation` |
| 24 | Artifacts tab — wardrobe-decay badges (equipped-only) | EQUIPPED instances with `state.tick - lastRefreshTick > WARDROBE_REFRESH_INTERVAL_TICKS` render out-of-season badge; UNEQUIPPED instances render NO decay badge regardless of `lastRefreshTick` (B3 cycle-2-iter-2 resolution) | Vitest: seed state with three instances — equipped+in-season, equipped+overdue, unequipped+overdue; assert badge present only on the second |
| 25 | Artifacts tab — refresh wardrobe | Button gated on Capital; click dispatches `refreshWardrobe`; all equipped instances' `lastRefreshTick` reset to `state.tick` | Vitest: seed at Capital + overdue badges; click; assert badges clear after re-render |
| 26 | Artifacts tab — forgery ledger gate | Sub-section hidden when no living BohemianRake; visible + Commission affordance available when present | Vitest: render without/with Rake; assert visibility flip |
| 27 | Artifacts tab — commission forgery | Commission dropdown lists every `forgeable: true` definition; click dispatches `commissionForgery` | Vitest: spy + click on each forgeable; assert dispatch shape |
| 28 | Artifacts tab — thief-attempt banner | In-flight `ThiefAttempt` renders as red-bordered banner at top of tab with Thwart button | Vitest: seed `thiefAttempts` with `thwarted: null` entry; assert banner DOM |
| 29 | Artifacts tab — thwart dispatch | Thwart button gated on living Spymaster + wealth + InFlight Inbound courier; click dispatches `thwartTheft` | Vitest: seed valid state; spy + click; assert dispatch + outcome strip |
| 30 | MapView inline-panel removal | The 4 inline ledger panels are NOT mounted inside the MapView sidebar | Playwright: navigate to MapView; assert NO `.staff-panel`, `.whisper-ledger-panel`, `.spymaster-intercept-card`, `.active-schemes-panel` CSS-class elements are present in the page (the panels ship BEM-only CSS classes, no `data-testid` attributes — verified live across all 4 panel modules). Sidebar must contain only `LocationDetailsPanel`. Selector form: `await expect(page.locator('.staff-panel')).toHaveCount(0);` etc. — repeat for all 4 panel class roots |
| 31 | Save-format stability | `SAVE_VERSION_CURRENT === 13`; no SaveV14Schema; `v1-to-v13-chain.test.ts` is the longest chain test | `grep -n 'SAVE_VERSION_CURRENT' src/persist/schema.ts` (output line must read `SAVE_VERSION_CURRENT = 13`) + `ls src/persist/migrations/v1-to-v*-chain.test.ts \| sort -V \| tail -1` (output must be exactly `src/persist/migrations/v1-to-v13-chain.test.ts`) — both runnable, not eyeball-grep |
| 32 | Hash-extension test | `src/game/schema-projection-selector-extension.test.ts` passes without modification | `pnpm test schema-projection-selector-extension` |
| 33 | Determinism unchanged | 30-run replay harness produces identical hashes — Ledger is reading-only | `pnpm test replay-harness` (existing test) |
| 34 | `pnpm test` / `pnpm lint` / `pnpm typecheck` | All green | Run all three before close-out |
| 34a | `pnpm lint:boundaries` (post-migration) | EXACTLY 2 residual errors, both in carved-out rules-layer files (`src/game/rules/inheritedSecrets.ts:38`, `src/game/rules/siblingRivals.ts:42` — pre-existing rule-(a) `GameState from "../store"` violations explicitly out of P14 scope per the "Lint boundaries" bullet) | Run `pnpm lint:boundaries`; assert `2 problems (2 errors, 0 warnings)` and that the 2 error paths match exactly those two files. Reopens P14 verification if a third error appears |
| 35 | Playwright golden path | Open Ledger → cycle through 8 tabs → equip an artifact → toggle Social Web → trigger faux-pas → see slide-away → exit Ledger → state preserved | New e2e test at `tests/e2e/ledger.spec.ts` |
| 36 | Persistent exile banner (P14 hoist) | Exile banner mounted in `App.tsx` shell renders across Map / Ballroom / Promenade / Ledger when `house.exiled === true`; the existing `data-testid="exile-banner"` selector reads it in every view | Playwright: trigger exile (Scandal Sheet attribution path); navigate Map → Ledger → Ballroom; assert `[data-testid=exile-banner]` visible in each |

**Test plan.**

- **Vitest (`src/ui/ledger/**.test.tsx`, `src/ui/socialWeb/**.test.tsx`)** — one test file per tab component + one per Social Web hook. Render with `@testing-library/react` (verify presence in `devDependencies` at implementation time; if absent, add per the same `~`-pin convention). Mock the store via Zustand's vanilla `create` helper + the existing `__test-utils__/factories.ts` patterns. Assert dispatch shapes by spying on `store.{action}` rather than re-running the rules layer.

- **Vitest (`src/ui/socialWeb/useSocialWebReactions.test.tsx`)** — render the hook in isolation via `renderHook`; publish synthetic events on each of `conversationBus` / `schemeBus` / `familyBus`; assert the returned cue Map mutates. Verify cleanup-on-unmount drops every subscription (publish post-unmount → cue Map unchanged).

- **Playwright (`tests/e2e/ledger.spec.ts` NEW + `tests/e2e/map-smoke.spec.ts` audit)** — Net-new test for the golden path (verification matrix item 35). Verified live: `tests/e2e/` currently contains ONLY `map-smoke.spec.ts` — there are no existing whisper / staff / spymaster / scheme-cancel e2e specs to re-point (those flows are covered today by Vitest tests against the inline panels, not by Playwright). Audit `map-smoke.spec.ts` at implementation time: if any of its assertions read DOM selectors that move from MapView's sidebar into LedgerView tabs (`[data-testid=*staff*]`, `[data-testid=*whisper*]`, `[data-testid=*scheme*]`, etc.), prepend `await page.click('[data-testid=open-ledger-btn]'); await page.click('[data-testid=ledger-tab-{name}]')` to the affected test setup. If no such selectors exist (likely, given the map-smoke scope), the file needs no changes.

- **Cross-validation against P10's bus events.** The existing P10 `artifactBus` events (`ArtifactEquipped`, `ArtifactUnequipped`, `ForgeryCreated`, `ThiefAttemptStarted`, `TheftResolved`, `ForgerySurfaced`) are NOT subscribed to by P14 UI (the tab reads state directly via selectors; bus is for cross-cutting reactions like the Social Web slide-aways). Add a Vitest note in `ArtifactsTab.test.tsx` documenting that the tab is selector-driven, not bus-driven, to prevent future drift toward bus-driven UI (which would risk dropped events between tab mount and event publish).

- **Determinism guard.** The replay harness STAYS untouched. P14 adds NO new RNG draws, no new tick-phase mutations, no new orchestrator side-effects. The Vitest `replay-harness.test.ts` must still produce 30 identical hashes after P14 ships.

**Close out.** When every verification-matrix item is green AND `pnpm test` / `pnpm lint` / `pnpm typecheck` are clean AND the Playwright golden path passes in a browser, run `/close-phase 14` to update phase status in `plans/MASTER.md` §6, append to `plans/SESSION-NOTES.md`, resolve OQ #9 ("coexist" — already the default), apply any `CLAUDE.md` additions surfaced during implementation, and commit the changes (no push).

## Accumulated Risks & Suggestions

*Passively collected from review cycles. Not blockers. Triaged at convergence. Each item carries one explicit triage tag: `[folded into <surface>]` (resolved in body), `[deferred to v1.5: <reason>]` (out of P14 scope), or `[still-open]` (gate the implementer should address before declaring done).*

- [C1] `@testing-library/react` is not installed; plan defers the install decision to implementation time. Pin the install in the dependency-add bullet alongside framer-motion / react-force-graph-2d, OR redesign the test plan to avoid testing-library (e.g., snapshot-render via Zustand vanilla store + direct DOM assertion matching the existing project test style of pure-rule + selector tests). `[folded into "New dependencies" bullet — chose ~16.1.0 install per the B2 cycle-2-iter-2 resolution]`
- [C1] TopBar wealth/reputation display doesn't exist today (live TopBar at `src/ui/shared/TopBar.tsx` renders campaign name, current location, head age, tick — no wealth, no reputation, no `getEffectiveReputation` consumer). Drop the "wealth/reputation display" framing OR pin the TopBar extension as a separate sub-bullet (with its own selector body + verification step). `[folded into "TopBar widening" sub-bullet in ArtifactsTab section + verification matrix #23]`
- [C1] Unequipped wardrobe-decay badges are permanently stale. `applyWardrobeRefresh` at `src/game/rules/wardrobeRefresh.ts:55-66` only resets `lastRefreshTick` on EQUIPPED artifacts (loop body iterates `ch.equippedArtifactIds`). Unequipped instances retain their stale `lastRefreshTick` forever. Either acknowledge this in the ArtifactsTab spec ("unequipped artifacts always show stale wardrobe badge until equip-then-refresh-then-unequip clears") or suppress the badge on unequipped instances. `[folded into ArtifactsTab inventory row spec + verification matrix #24 — suppress on unequipped per B3 cycle-2-iter-2 resolution]`
- [C1] shadcn install decision left to implementer ("if shadcn isn't yet installed in the repo, hand-roll DOM..."). Commit one branch: either check shadcn install status now and pin, or explicitly state "v1 hand-rolls; shadcn install is v1.5 candidate." `[folded into LedgerView body — pinned "v1 hand-rolls; shadcn is v1.5 candidate" per F4-I5 batch fold]`
- [C1] Reference `parsePairKey()` helper instead of "split-on-`|`". Live `src/game/conversation/types.ts:41-49` exports `parsePairKey(key)` returning `{ houseId, characterId }` — already typed correctly. `[folded into Social Web Edges body bullet + pair-key direction disambiguation per B1 cycle-2-iter-2 resolution]`
- [C1] Pin `PLAYER_HOUSE_ID` import path: existing UI imports from `../../game/rng.seeds` (MapView.tsx:3, TopBar.tsx:2). ESLint rule blocks `ui → game-rng` directly; pinning the `rng.seeds` path avoids the lint-fail discovery loop. `[folded into "Lint boundaries" bullet — PLAYER_HOUSE_ID + brand-type import path discipline paragraph; widened to include the rng.seeds.ts brand re-exports and 8-file migration step per B1 cycle-3-iter-1 resolution]`
- [C1] RivalsTab "3 rival rows" assertion should read off `RIVAL_HOUSE_IDS_SET.size` so a future v1.5 widening doesn't silently break the test. Reframe as `assert rivalActors.size === RIVAL_HOUSE_IDS_SET.size`. `[folded into verification matrix #18 per F4-I5 batch fold]`
- [C1] ArtifactsTab "Commission" forger picker — pin lex-id ordering. The "first alive BohemianRake" needs determinism criteria: "lex-smallest characterId among `(c.alive && c.archetype === 'BohemianRake' && c.houseId === PLAYER_HOUSE_ID)`." `[folded into ArtifactsTab Forgery ledger sub-section per F4-I5 batch fold]`
- [C1] SchemesTab history reads — pin lex-sort by id (matches the moods.ts and ActiveSchemesPanel precedent). Plan body says `[...state.schemes.values()].filter(s => s.status !== "Active")` but doesn't make the sort explicit. `[still-open]`
- [C2] `SchemeCompleted.targetCharacterId` is `CharacterId | null` per `src/runtime/events/scheme.ts:51-57`. Social Web sabotage-reaction subscriber must null-guard before emitting the slide cue: `if (event.targetCharacterId === null) return;`. Without the guard, a Smuggling (target-less) scheme completion would attempt a slide-away against `null` and break the cue Map shape. `[folded into Social Web Reactive animations bullet — null-guard pinned in the subscriber filter line per B3 cycle-3-iter-1 resolution]`
- [C2] Exile signal during Ledger lifetime: `MapView.tsx:110-119` renders the exile banner; if the player has Ledger open when exile triggers (e.g., Scandal Sheet attribution mid-session), LedgerView has no equivalent banner. Either route the exile banner into the persistent TopBar chrome (so it surfaces across Map / Ledger / Ballroom / Promenade alike) or pin a per-view exile signal in LedgerView's shell. `[folded into "Persistent exile-banner relocation" sub-bullet in ArtifactsTab section + verification matrix #36 per B2 cycle-4-iter-1 resolution — hoisted into App.tsx persistent chrome]`
- [C2] Verification matrix #12 (FauxPasFired reaction) doesn't pin the mode-condition assertion. Plan body line 156 correctly notes "only the ballroom path publishes FauxPasFired" — but the test doesn't assert that fact, so a future v1.5 promenade-FauxPas widening would silently double-fire the cue without test breakage. Pin: assert publish from `conversationBus` triggers the cue AND assert that calling `sendPromenadeMessage` (or any other path) does NOT trigger it. `[applied]`
- [C2] PatronessesTab matrix verification (#15) over-specifies cell counts ("16 cells = 4 diagonal + 12 valued, of which 6 unique pairs duplicated by mirror"). Reframe as "`FACTION_PAIRS.length === 6` unique values, mirror-rendered" so a future faction-count change (v1.5 candidate) auto-cascades through the assertion. `[applied]`
- [C2] Verify WhispersTab "No whispers yet" empty-state isn't already covered by `WhisperLedgerPanel.tsx` itself before adding a wrapper. Live panel at lines 31-37 already renders an empty-state for the all-zero case. Simplicity rule: don't add wrapping chrome that duplicates panel-internal coverage. `[still-open]`
- [C2] Verification matrix #31 chain-length assertion is currently eyeball-grep ("v1-to-v13-chain.test.ts is the longest chain test"). Pin as a runnable command: `ls src/persist/migrations/v1-to-v*-chain.test.ts | sort -V | tail -1` must output `v1-to-v13-chain.test.ts`. Makes the assertion automation-friendly. `[applied]`
- [C3] Event-loss during Elopement-precedence transitions: when Elopement triggers mid-Ledger, `useSocialWebReactions` unmounts (parent shell precedence) — subscriptions clean up correctly. When Elopement resolves and the player returns to Ledger (still showing FamilyTreeTab via React local state), subscriptions re-register but events fired during the elopement interval are lost. Acceptable v1 behavior (Social Web is presentation-only and elopement gates most mutation publishes), but should be acknowledged inline alongside the existing v1-acceptable-behavior note in the modal-precedence paragraph. `[still-open]`
- [C3] TopBar widening snippet should pin the `getEffectiveReputation` import path (live at `src/game/rules/artifacts.ts:114`). Confirm whether `ui → game-rules` triggers `pnpm lint:boundaries` (likely default-"allow" per the existing import shape, but worth verifying before the implementer hits a surprise lint-fail). `[still-open]`
- [C3] ArtifactsTab forgery-ledger gate `[...state.characters.values()].some(...)` re-derives per render. Memoize via `useShallow` for consistency with other tabs. Cost is trivial at v1 character counts but the pattern matters for future-phase character-count growth. `[folded into ArtifactsTab Forgery ledger sub-section per F4-I5 batch fold]`
- [C3] Pin "UI-local constant" convention in CLAUDE.md as a v1.5 follow-up (out of P14 scope to amend). `SOCIAL_WEB_SLIDE_DURATION_MS` is the first UI-local constant justified via "pure rendering value" — future phases (procedural portraits, scandal-sheet column at P18) need to know where UI-only constants live (suggested location: `src/ui/{module}/constants.ts` per-module, NOT consolidated). `[deferred to v1.5: cross-phase CLAUDE.md amendment, not a P14 deliverable]`
- [C4] BloodFeud row-rendering uses live field names (`offendingHouseId`, `incurredAtTick`, `triggeringSecretId`, `triggeringGrievanceId`, `resolved`, `resolvedAtTick`, `resolutionKind`) per `src/game/entities.ts:118-127`. `[folded into "Blood Feuds sub-section" body + verification matrix #20]`
- [C4] TopBar `effective-reputation-readout` selector pattern: pin `useShallow` wrapping for the multi-Map read (matches the `WhisperLedgerPanel.tsx:17-22` precedent). Without it, the default selector subscription may cause excessive re-renders OR (depending on referential equality) silently swallow updates. `[applied]`
- [C4] Cross-view navigation state recovery: when Ledger → Ballroom (via any future affordance) → exit Ballroom, `BallroomView.onExit` doesn't touch `inLedger`. Acceptable v1 behavior (player returns to Ledger) but pin in body. Similarly, Elopement-resolve preserves `inLedger=true` per React-local-state semantics. `[still-open]`
- [C4] `useSocialWebReactions` mount location: subscribe inside `SocialWebView` (subscriptions live only while graph is visible — events fired while in text view are lost) OR `FamilyTreeTab` top level (always subscribes regardless of toggle). Pin the intended pattern. Recommend `SocialWebView`-scoped: cues are visualization-only, so subscriptions outside the visualization window are pure overhead. `[applied]`
- [C4] `state.factionTensions` matrix header row order: plan says "lex-sort by `FACTION_IDS` member" but live `FACTION_IDS` declaration order (`court / ton / country / crown`) differs from lex order (`country / court / crown / ton`). Pin which order is intended; recommend declaration order (matches `FACTIONS_FIXTURE` rendering elsewhere). `[folded into PatronessesTab Faction-tension matrix sub-section — pinned declaration order + FACTION_DISPLAY_NAMES labels per F4-I5 batch fold]`
- [C5] Vitest jsdom environment: `vitest.config.ts:6` currently sets `environment: "node"`. Testing-library tests will throw "ReferenceError: document is not defined" at first run. Pin the config edit in the dependency-add bullet: either flip global to `"jsdom"` (matches `jsdom` already in `devDependencies` at `package.json:50`) with per-file `// @vitest-environment node` exceptions for the rules-layer tests, OR add per-test-file `// @vitest-environment jsdom` directives on every new `*.test.tsx`. `[folded into "New dependencies" bullet — chose per-file directive per B2 cycle-3-iter-1 resolution]`
- [C5] `PendingTutorTraitChoice` render filter form: plan says "for every state.pendingTutorTraitChoices entry whose child is in the player house." The Map shape is `Map<CharacterId, PendingTutorTraitChoice>` per `src/game/entities.ts:566` — the filter must dereference the child via `state.characters.get(childId)?.houseId === PLAYER_HOUSE_ID`, NOT key-filter the Map (the Map key IS the child id). Pin the exact filter form to prevent implementer-time confusion. `[applied]`
- [C6] Cancel-button locator gap in SchemesTab verification (#6). The Active section cancel button lives inside the existing `src/ui/ledger/ActiveSchemesPanel.tsx`, which ships ZERO `data-testid` attributes today. The plan's per-row testid contract (added in cycle-2-iter-3) covers the NEW history rows but inherits the old panel's testid-free DOM for the cancel button. Either add a backwards-compat-safe `data-testid="active-scheme-cancel-{schemeId}"` to the existing `ActiveSchemesPanel` cancel button (in the same change), OR pin that #6's "cancel-button dispatch" assertion uses text/role queries (`getByRole('button', { name: 'Cancel' })`). `[folded into SchemesTab "Per-row data-testid contract" — Active-row cancel-button testid backfill pinned per B1 cycle-4-iter-1 resolution]`
