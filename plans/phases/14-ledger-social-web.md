# P14 — Ledger View & Social Web Visualization

> Part of [The Season Master Plan](../MASTER.md). Prior: [P13 — Global Events & Era Progression](./13-global-events-era.md). Next: [P15 — Dynasty Legacies & Renown Perks](./15-dynasty-legacies.md).

**Goal.** Make all the accumulated state legible. The ledger is the player's reading view.

**In scope.**
- 7-tab ledger: Whispers, Schemes, Family Tree, Patronesses, Grievances, Rivals, Staff.
- Inline action affordances per tab (e.g., "demand satisfaction" on a Grievance row; cancel on an active Scheme; weaponize on a Verified whisper).
- Social Web visualization: `react-force-graph-2d` rendering the player house's affection network; portrait nodes; edges weighted by affection; pan/zoom; reactive Framer Motion slides on faux-pas, sabotage success, proposal rejection.
- Reading-only; all mutations stay in their orchestrators.

**Out of scope.** Decision on whether Social Web replaces textual family/affection ledger (§10 OQ — DEFAULT: coexist).

**Spec refs.** §3 "Ledger View", "Social Web Visualization".

**Open questions (§10).**
- **#9** — Should the Social Web visualization replace the textual family/affection ledgers in v1, or coexist? Default: **Coexist** — the textual ledgers are accessible and easier to scan for exact values; the Social Web is the spatial reading view. Drop a tab in v1.5 if both prove redundant.

**Verification.** Manual + Playwright: open each tab; trigger a faux-pas; see the corresponding portrait slide away; affection edge weights match underlying state.

**Close out.** When the gates and verification items above are green, run `/close-phase P14` to update phase status in `plans/MASTER.md` §6, append to `plans/SESSION-NOTES.md`, resolve any open questions answered during the work, apply any `CLAUDE.md` additions, and commit the changes (no push).
