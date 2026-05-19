# P13 — Global Events & Era Progression

> Part of [The Season Master Plan](../MASTER.md). Prior: [P12 — Hyde Park Promenade](./12-promenade.md). Next: [P14 — Ledger View & Social Web Visualization](./14-ledger-social-web.md).

**Goal.** Three named global events with per-tick deltas, plus the one-way era transition.

**In scope.**
- 5%/tick chance rolls a candidate event; duplicate active type skipped.
- **WarEffort** (10 ticks): per-tick `+1 reputation, −2 wealth`; military-officer family members get temp positive Seduction-scheme multiplier AND small per-tick death probability at the front (deterministic seeded roll; OnCharacterDied cascade).
- **MarketCrash** (5 ticks, `−3 wealth`/tick).
- **MonarchsMood** (5 ticks): roll a favored culture; houses with an equipped artifact whose family matches → fixed per-tick reputation surge; houses without a match → `+1 scandal`/tick (NOT scandal doubling).
- Events terminate at absolute end-tick (recorded at start).
- Era auto-transition at fixed tick threshold (Earlier → Later, one-way).
- Era-gated travel: foreign capital blockaded in Earlier era unless Smuggling bypass earned (P5).
- Later era unlocks one-time research action: halves new courier transit times (floor 1).

**Out of scope.** None — this phase wraps the temporal/external-pressure layer.

**Spec refs.** §3 "Global Events", "Era Progression", "Cultural-Pivot Monarch's Mood".

**Machines.** Era (Earlier → Later); Global event (Active → Expired).

**Edge cases (§7).** "Cultural-pivot Monarch's Mood against no-artifact house" (only `+1 scandal`, no surge-negative branch).

**Open questions (§10).**
- **#21** — Should the cultural-pivot Monarch's Mood mechanic be active before the artifact registry ships? Default: **N/A** — our phase sequencing ships P10 (artifacts) before P13 (events), so the cultural-pivot's positive branch always has artifacts to match against. If P13 is ever pulled earlier, disable the cultural-pivot branch until P10 ships.

**Verification.** Vitest: deterministic event firing across 1000-tick simulation; absolute end-tick respected through save/load; cultural-pivot favored-culture roll uses the canonical seeded draw.

**Close out.** When the gates and verification items above are green, run `/close-phase P13` to update phase status in `plans/MASTER.md` §6, append to `plans/SESSION-NOTES.md`, resolve any open questions answered during the work, apply any `CLAUDE.md` additions, and commit the changes (no push).
