# P14 — Ledger View & Social Web Visualization

> Part of [The Season Master Plan](../MASTER.md). Prior: [P13 — Global Events & Era Progression](./13-global-events-era.md). Next: [P15 — Dynasty Legacies & Renown Perks](./15-dynasty-legacies.md).

**Goal.** Make all the accumulated state legible. The ledger is the player's reading view.

**In scope.**
- **8-tab ledger**: Whispers, Schemes, Family Tree, Patronesses, Grievances, Rivals, Staff, **Artifacts**.
- Inline action affordances per tab (e.g., "demand satisfaction" on a Grievance row; cancel on an active Scheme; weaponize on a Verified whisper).
- **Artifacts tab specifics** (closes the P10 UI gap — P10 shipped the rules layer + store wrappers + bus events but no UI surface; the action affordances exist as `store.equipArtifact` / `store.unequipArtifact` / `store.commissionForgery` / `store.thwartTheft` since P10's commit but have no UI consumer until P14):
  - Player inventory list: every `ArtifactInstance` whose `ownerCharacterId` is in the player house. Group by `ownerCharacterId`; show display name, family, equipped/unequipped, `lastRefreshTick` derived "in-season" / "out-of-season" badge (per `WARDROBE_REFRESH_INTERVAL_TICKS`), reputation bonus, scandal-risk-while-worn, `forgedFlag` (visual marker for forgeries).
  - Equip/unequip buttons per row — gated by character-alive + max-one-per-family (rule layer enforces; UI greys out invalid targets).
  - Forgery ledger (sub-section, gated on player house having any Bohemian Rake archetype family member): list every `ForgeryRecord` with status (Unsurfaced / Surfaced + surfacedAtTick), forger character, forged tick. Commission button (gated on living Bohemian Rake + wealth >= ArtifactDefinition.forgeWealthCost).
  - Thief-attempt notifications: in-flight `ThiefAttempt` entries (`thwarted: null`) get a prominent banner-style row with a "Thwart" button (gated on living Spymaster + wealth + InFlight Inbound interceptable courier — see `applyThwartTheftPure`'s 4-predicate filter). Resolved attempts (`thwarted: boolean`) collapse into a history sub-section.
  - Wardrobe refresh affordance: the existing `refreshWardrobe` P3 action gets surfaced here too (action affordance under the inventory). Cost: `WARDROBE_REFRESH_WEALTH_COST` from constants; gated on `currentLocation === "Capital"` (rule layer rejects elsewhere).
- Social Web visualization: `react-force-graph-2d` rendering the player house's affection network; portrait nodes; edges weighted by affection; pan/zoom; reactive Framer Motion slides on faux-pas, sabotage success, proposal rejection.
- Reading-only; all mutations stay in their orchestrators.

**Out of scope.** Decision on whether Social Web replaces textual family/affection ledger (§10 OQ — DEFAULT: coexist).

**Spec refs.** §3 "Ledger View", "Social Web Visualization".

**Open questions (§10).**
- **#9** — Should the Social Web visualization replace the textual family/affection ledgers in v1, or coexist? Default: **Coexist** — the textual ledgers are accessible and easier to scan for exact values; the Social Web is the spatial reading view. Drop a tab in v1.5 if both prove redundant.

**Verification.** Manual + Playwright: open each tab; trigger a faux-pas; see the corresponding portrait slide away; affection edge weights match underlying state. **Artifacts tab additionally**: equipping a sapphires instance updates the inventory row badge + `getEffectiveReputation` re-renders in the TopBar; commissioning a forgery on a state with a living Bohemian Rake + sufficient wealth creates a new `ForgeryRecord` row; an in-flight `ThiefAttempt` (seeded via tick-advance under high reputation) surfaces a banner with a working Thwart button; refreshing wardrobe at Capital resets every equipped instance's `lastRefreshTick` to current `state.tick` and clears the out-of-season badges.

**Close out.** When the gates and verification items above are green, run `/close-phase P14` to update phase status in `plans/MASTER.md` §6, append to `plans/SESSION-NOTES.md`, resolve any open questions answered during the work, apply any `CLAUDE.md` additions, and commit the changes (no push).
