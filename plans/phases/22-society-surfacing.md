# P22 — Society & World Surfacing (v1.5)

> **Status: 📋 planned (detailed).** Track: v1.5. Source: [MASTER.md §11.2-A](../MASTER.md#112-v15--deferred-backlog-aggregated-deduped) + the §10 V1.5 marquee row + society-facing items from §11.2-J.
> Makes the non-player world (rivals + the ~20 procedural society) visible and slowly alive. The "Society / The Ton" view is the single most-cited deferred item across P14/P16/P18.

## Depends on
P14 (social web + ledger), P16 (procedural society), P18 (flavor content).

## Goal
The player can see and read the wider world — society NPCs and rivals — not just their own house, and that world doesn't silently empty out over generations.

## Locked design decisions (this session)
1. **Portraits = deterministic colored monogram.** Keep the initial-letter glyph; derive a deterministic background color (HSL) from a UI-local hash of the `CharacterId`, with a faction-tinted ring. No new dependency, no identicon grid. (Chosen over a geometric identicon / external avatar lib for smallest-change scope.)
2. **Replenishment = top-up-to-floor.** Floor is the procedural cohort target `PROCEDURAL_NPC_COUNT` (= 20). Each year-pass: `deficit = PROCEDURAL_NPC_COUNT − aliveProceduralNpcCount`; `arrivals = clamp(deficit, 0, SOCIETY_MAX_ARRIVALS_PER_YEAR)`; generate in the **current** `state.era` (not the founding era). The 5 hand-authored baseline NPCs are NOT topped up (fixtures age out permanently); only the `proc-npc-` cohort is maintained.
3. **Founder = full procedural name** matching descendants: `${given} ${dynastySurnameForHouse(PLAYER_HOUSE_ID)}`, given-name picked deterministically (UI-free, RNG-free hash pick) from the founding-era bank by founder id + gender. Drops the regnal `"I"`. (`STARTING_HEAD_CHARACTER_ID` unchanged.)

## In scope

### A. "Society / The Ton" view — third Family-Tree-tab mode
- Replace the binary `showWeb` toggle in `FamilyTreeTab.tsx` with a **3-mode segmented control**: `Family` | `Social Web` | `The Ton` (`mode: "family" | "web" | "society"`). `Family` and `Social Web` are the existing surfaces unchanged in behavior (web gains inbound edges, item B).
- New `src/ui/society/SocietyView.tsx`: renders **all alive `INDEPENDENT_HOUSE_ID` characters (baseline + procedural + replenished) plus all rival-house characters**, grouped by house, lex-sorted within house. Each row: monogram portrait (item D), name, age, role, archetype, mood, faction, inline traits, equipped-artifact count, and a "Who is this?" bio expander (item C, reuses `revealNpcBio` — already works for non-player NPCs).
- `SocietyView` carries its **own** list/spatial pill toggle (mirrors the existing `Family`↔`Web` pattern, scoped to society — `societySpatial: boolean`). Spatial sub-view reuses `react-force-graph-2d` via a new pure `buildSocietyGraphData`:
  - **Nodes:** every alive Independent + rival character (faction-colored) plus the player head (gold, for affection anchoring). Society NPCs the player never met render as unconnected nodes (acceptable "crowd" density).
  - **Links:** all `affectionMap` edges, both directions — outbound `(PLAYER_HOUSE_ID, npcId)` and inbound `(npcHouseId, playerHeadId)` (the inbound edge is attributed to the holder house's head-of-house node, since inbound affection is house-keyed — see item B).
- Alive-only in both sub-views (dead NPCs excluded; matches roster semantics).

### B. NPC→player inbound Social Web edges
- `affectionMap` keys are `(holderHouseId, objectCharacterId)`. Today `buildSocialGraphData` (`SocialWebView.tsx:58`) renders only outbound keys (`houseId === PLAYER_HOUSE_ID`) and drops the rest at the guard (`:73`). Inbound keys are `(npcHouseId, playerHouseCharId)`, written house-level by `artifacts.ts:398` (forgery-surface Vain-NPC affection drop) and `inheritedSecrets.ts:209` (blood-feud rival affection drop).
- Add a `direction: "outbound" | "inbound"` field to `SocialLink`. For each inbound key, render an edge from the holder house's **head-of-house character node** (added to the node set if not already present) to **the player head node** — both inbound writers (`artifacts.ts:398`, `inheritedSecrets.ts:209`) key the player head specifically (`headOfHouseCharacterId`), never a generic player-house member, so the parsed `characterId` is always the head. Distinct rendering: inbound links use a faction-tinted color + a directional arrow (`linkDirectionalArrowLength`) so direction reads at a glance; outbound links keep the existing style.
- This lifts the P16 "social web is player-house-only" trip-hazard **partially** on the player web (only the heads that hold inbound affection appear) and **fully** on the Ton view. Document both in the `SocialWebView.tsx` / `SocietyView.tsx` header comments.

### C. Player-house-member NPC bios
- Lift the `character.houseId === PLAYER_HOUSE_ID` early-return in `store.ts:revealNpcBio` (`:1855`) so player-family members can also generate a bio. `FlavorContentKind` `"NpcBio"` is unchanged (a save-persisted enum value — do NOT rename it). Caveat: the bio prompt (`server/prompts/flavor.ts:38`) hardcodes a third-person society-gossip framing ("a member of London society … as the ton would gossip of them"), which is slightly off for the player's own kin. Acceptable at v1 (flavor is gameplay-inert prose); a kin-aware prompt variant is a future-polish candidate, not P22 scope.
- Surface a "Who is this?" expander on `FamilyTreeTab` `CharacterRow` (mirror the ballroom `PortraitCard` pattern: persisted `bio:${id}` text if present, else the designer stub from `flavorStubFor`). The expander calls `revealNpcBio` on open.
- Determinism: `revealNpcBio` is UI-triggered, flag-gated (`flavorContentEnabled`), fire-and-forget — never fires in tests/replay. Lifting the gate is hash-neutral.

### D. Procedural portraits (deterministic colored monogram)
- New `src/ui/shared/monogram.ts`: `monogramStyle(id: string, factionId?: FactionId): { backgroundColor: string; ringColor: string }`. Background = `hsl(hash(id) % 360, …)` via a small UI-local string hash (cosmetic — NOT the game's `fnv1a32`, NOT hash-relevant, so it stays UI-local per the "UI-local values live in src/ui" precedent). Ring = `factionColor(factionId)` (reuse `socialWeb/colors.ts`).
- Apply to the avatar circles in `FamilyTreeTab` `CharacterRow` and `SocietyView` rows. Force-graph nodes keep their existing faction coloring (unchanged).
- Resolves the P14↔P16 portraits contradiction (was a glyph placeholder; now deterministic per `CharacterId`). Update the P14 portraits Out-of-scope deferral note + the §11.2-J pointer to "shipped at P22 as a colored monogram." **Caution:** that note was already amended at P21 (MASTER §11.3 #1), and it is NOT at `14-…:326` (line 326 is the `lint:boundaries` carve-out paragraph) — `grep` the literal portraits text in `plans/phases/14-ledger-social-web.md` and diff before editing rather than trusting a remembered line number / `old_string`.

### E. Founder procedural naming
- Replace the hardcoded `"Player I"` produced via `STARTING_HEAD_NAME` in `bootstrap.ts`. Add `founderName(characterId, houseId): string` (in `nameBanks.ts`, alongside `dynastySurnameForHouse`): gender from `hashCharIdToGender(characterId)`, given name = `GIVEN_NAMES["Earlier"][gender][fnv1a32(characterId) % bank.length]`, surname = `dynastySurnameForHouse(houseId)`. **No new RNG draw** — bootstrap draw budget stays at 1 (player deathAge only).
- `STARTING_HEAD_NAME` is removed/repurposed; `STARTING_HEAD_CHARACTER_ID` unchanged. This touches **more than the four "Player I" string sites** — removing the export breaks its consumers too. Update:
  - `bootstrap.test.ts:4` (the `STARTING_HEAD_NAME` import) + `:44` (`expect(character.name).toBe(STARTING_HEAD_NAME)` assertion) — assert against `founderName(STARTING_HEAD_CHARACTER_ID, PLAYER_HOUSE_ID)` instead. (`:40` is only the human-readable `it(...)` description.)
  - `succession.test.ts:58` and `:205` — plain `name: "Player I"` fields → the derived name.
  - `succession.test.ts:81` — `ancestorSummary[0]` = `"G0: Player I (b. -24, d. 70)"` is a **format string** carrying the regnal suffix, not a bare name; the rename changes the embedded name within the `G{n}: {name} (b. …, d. …)` format. Assert structurally (e.g., `toContain(founderName(...))`), not a literal.

### F. Ongoing society replenishment (the one new gameplay rule)
- New pure `src/game/rules/societyReplenishment.ts`: `applySocietyReplenishmentStep(state: GameState): GameState`.
  - `aliveProceduralNpcCount` = alive characters with id prefix `PROCEDURAL_NPC_ID_PREFIX` in `INDEPENDENT_HOUSE_ID`.
  - `deficit = PROCEDURAL_NPC_COUNT − aliveProceduralNpcCount`; `arrivals = clamp(deficit, 0, SOCIETY_MAX_ARRIVALS_PER_YEAR)`. Zero arrivals ⇒ zero draws (no-op, hash-neutral).
  - RNG: draw from the **existing** `state.rng[INDEPENDENT_HOUSE_ID]` stream (already seeded `${seed}|independent` at `store.ts:156`, already in the projection/hash) — write the advanced `RngState` back. No new `state.rng` entry. **Coupling note:** this stream is NOT quiet — `applyMoodDriftPhase` (`moods.ts:60-89`) draws from it every tick (it iterates all houses incl. Independent). The 8N replenishment draws therefore shift every subsequent Independent mood-drift draw. This is fully deterministic (the replay harness sequences both consistently), but it is a real interleaving, not a private stream. Also note the bootstrap procedural cohort was drawn from a SEPARATE transient `${seed}|procedural-npcs` stream (`bootstrap.ts:181`) that is discarded — so replenishment has NO draw-continuity with the initial cohort (it picks up the `|independent` stream wherever mood drift left it). Both are intended; just don't assume one continuous society draw sequence.
  - IDs: `startIndex = totalProceduralNpcCount` (alive + dead `proc-npc-` entries; contiguous from 0 because characters are never deleted — same "walk existing entries for the next index" pattern as `makeWhisperId`/`makeArtifactInstanceId`). New ids are `proc-npc-${startIndex + k}`.
  - Era: `state.era` (current) — drives name banks so a Later-era ton gets Later names.
  - Generation reuses `generateSocietyNpcs`, widened with a `startIndex` param (default 0; bootstrap passes 0). Per-NPC budget stays the fixed 8 draws.
- **Year-pass STEPS placement** (`yearPass.ts`): insert at the new penultimate slot — `[aging, maturation, succession, promotion, conception, societyReplenishment, evaluateDynastyPerks]` (STEPS grows 6→7). After aging so a just-died NPC counts against the floor the same year; before `evaluateDynastyPerks`, which **stays the RNG-free terminal step** ("only RNG-free terminal evaluations may follow RNG-consuming phases" — this is a year-pass STEP, not a tick PHASE, so "rivals run last" is untouched).
- No new bus event for arrivals (they surface in the Ton roster next render). Verify the `runYearPass` diff-publishers (characterDeaths, etc.) don't misfire on newly-added alive keys (new key ⇒ no `before` entry ⇒ diff helpers skip).

## Out of scope
Society marriages / society NPCs as HeadOfHouse (→ P23). Rival economy / succession / rival replenishment (→ P25 — rivals are canonical fixtures, not topped up here). Identicon/external-avatar portraits (chose monogram). NPC-initiated conversations (→ P26). New affection-model edges between NPCs (none exist in the data; the Ton graph shows only player-anchored affection).

## Cross-cutting impact
- **No save-version bump, no new top-level `GameState` field, no quad-sync change.** Only `state.characters` grows (already in the `serializeRegistry` projection); RNG reuses the existing `INDEPENDENT_HOUSE_ID` stream; id-minting and floor-counting derive from existing state. (Matches the P14 reading-only / P20 UI-wiring "bump nothing" precedent, plus one new pure rule.)
- **Determinism discipline still binds.** Founder rename changes the fresh-state hash (character name is in `hashableState`); replenishment adds new draws on the Independent stream. **No manual re-baseline needed** — `replay-harness.test.ts:33` computes `baseline = runOnce(REPLAY_SEEDS[0])` at runtime and compares the other 29 runs to it (self-referential), so the rename + new draws are absorbed automatically; there is NO hardcoded hash string to edit. Just confirm 30-run determinism still holds. (Free pre-release regardless — the harness runs fresh seeds, never loaded saves.)
- **Replay coverage for replenishment.** The general harness's tick/year budget likely won't outlive any procedural NPC (deathAge 70–95 vs age 20–55 ⇒ ~15–75 year-passes), so it may fire zero arrivals. Add a **dedicated determinism test** that drives enough year-passes (or seeds a depleted society) to force ≥1 replenishment cycle and asserts identical state hashes across ≥30 runs.
- **No `PERSONA_CACHE_VERSION` bump** (persona prompt unchanged). **No new bus events.**
- **Trip-hazard lift documented** (item B): player web partial, Ton view full.
- **`revealNpcBio` gate lift** (item C): player-house bios now generate; `FlavorContentKind` enum unchanged; hash-neutral.

## Files
**New:** `src/game/rules/societyReplenishment.ts` + `.test.ts` (incl. determinism multi-run test); `src/ui/society/SocietyView.tsx` + `.test.tsx`; `src/ui/shared/monogram.ts` (+ `.test.ts`).
**Modified:** `src/game/constants.ts` (`SOCIETY_MAX_ARRIVALS_PER_YEAR`); `src/game/rules/proceduralNpcs.ts` (`startIndex` param; `aliveProceduralNpcCount` / `totalProceduralNpcCount` helpers); `src/runtime/yearPass.ts` (STEPS insert); `src/game/bootstrap.ts` (founder name); `src/game/fixtures/nameBanks.ts` (`founderName`); `src/game/fixtures/names.ts` (drop/repurpose `STARTING_HEAD_NAME`); `src/ui/socialWeb/SocialWebView.tsx` + `buildSocialGraphData` + `.test.ts` (inbound edges); `src/ui/ledger/tabs/FamilyTreeTab.tsx` (3-mode control + monogram + bio expander); `src/game/store.ts` (`revealNpcBio` gate lift); tests referencing `"Player I"` / `STARTING_HEAD_NAME` (`bootstrap.test.ts:4/40/44`, `succession.test.ts:58/81/205`); `src/game/replay-harness.test.ts` (confirm green — no hardcoded hash to edit); the P14 portraits-deferral doc note + §11.2-J pointer (grep literal text first — see item D).

## Verification (definition of done)
- Society + rivals are visible (roster + spatial) in the new Ton mode without prior player conversation; `Family` and `Social Web` modes unchanged when not selected.
- Inbound edges render on the player Social Web with legible direction; outbound edges unchanged.
- Player-house members can reveal a bio; the expander shows stub-then-persisted text.
- Procedural portraits render a deterministic per-`CharacterId` colored monogram with a faction ring.
- Founder spawns with a full procedural name; descendants/founder share the dynasty surname.
- Replenishment tops the procedural cohort back toward `PROCEDURAL_NPC_COUNT` as members die, capped at `SOCIETY_MAX_ARRIVALS_PER_YEAR`/year, in the current era; never deletes; ids never collide.
- `pnpm test` / `lint` / `typecheck` / `knip` green. 30-run replay deterministic (self-referential baseline — no hardcoded hash to edit; just confirm `replay-harness.test.ts` stays green) **plus a dedicated replenishment-active determinism test passing across ≥30 runs**. Current-schema save/load round-trips (no migration; dev saves reset on the founder-rename/derivation change).

## References
spec §2/§3 (society, Social Web §256-262, Procedural Identity §273-278); MASTER §10 V1.5 row, §11.2-A + portraits/founder/replenishment from §11.2-J, §11.3 #1 (portraits contradiction); P14, P16, P18; CLAUDE.md P16 society trip-hazard, transient-substream + 8-draw-budget pins, P15 "rivals run last among RNG-consuming phases" + zero-seeded-counter, P19/§6 migration posture.

## Accumulated Risks & Suggestions
*Passively collected from review cycles. Not blockers. Triaged at convergence.*

- [C1] R1. "Re-baseline the harness's expected hash" is a phantom artifact: `replay-harness.test.ts:33` computes `baseline = run-0 hash` at runtime and compares 30 runs to it — NO hardcoded hash string exists. Founder-rename + new draws absorb automatically. Reword to "no manual re-baseline needed; harness baseline is self-referential — just confirm 30-run determinism holds." `[applied]` — reworded Cross-cutting "Determinism discipline" bullet + Verification line + Files entry.
- [C1] R2. `INDEPENDENT_HOUSE_ID` rng stream is NOT quiet: `applyMoodDriftPhase` (moods.ts:60-89) draws from it every tick (iterates all houses incl. Independent). Item F's replenishment draws 8N from the SAME stream, shifting subsequent Independent mood-drift draws (deterministic, fine for replay). Also: the bootstrap cohort came from a TRANSIENT `|procedural-npcs` stream (bootstrap.ts:181), NOT `|independent` — "reuse the existing stream" has no continuity with the initial cohort. Acknowledge the coupling in item F. `[applied]` — added a "Coupling note" to item F's RNG bullet.
- [C1] S1. Test edit-list undercount: 4 "Player I" sites, not "three". `succession.test.ts:81` is `ancestorSummary[0]` = "G0: Player I (b. -24, d. 70)" (FORMAT string, not a name field — rename changes the regnal-suffix format). `STARTING_HEAD_NAME` removal also breaks `bootstrap.test.ts:4` (import) + `:44` (the `expect(character.name).toBe(STARTING_HEAD_NAME)` assertion), not just the `:40` description. `[applied]` — item E now enumerates all consumer sites + format-string note.
- [C1] S2. Item C: the NpcBio flavor prompt (`server/prompts/flavor.ts:38`) hardcodes "a member of London society … as the ton would gossip of them" — society-external framing, slightly off for the player's OWN kin. Defensible (flavor is inert prose) but acknowledge the third-person-gossip framing rather than claiming it "reads fine" unqualified. `[applied]` — item C "reads fine" claim replaced with the framing caveat.
- [C1] S3. Item B over-generalizes: inbound affection keys (artifacts.ts:398, inheritedSecrets.ts:209) always target the PLAYER HEAD char id, never a generic player-house member. "to the player-house target character" → "to the player head node". `[applied]` — item B reworded to "player head node".
- [C1] S4. Item D portraits doc-update target (`14-…:326`) was ALREADY amended at P21 (MASTER §11.3 line 493). The `old_string` the plan wants to edit may already read differently — diff the literal text at `14-…:326` before editing. `[applied]` — item D + Files entry now warn to grep the literal text (line 326 is the lint carve-out, not portraits).
