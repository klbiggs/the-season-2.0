# P1 — Tick Engine & Pure Rules

> Part of [The Season Master Plan](../MASTER.md). Prior: [P0 — Foundation](./00-foundation.md). Next: [P2 — Save/Load & Migrations](./02-save-migrations.md).

**Goal.** Implement the fixed-phase-order tick orchestrator, the canonical House and Character data shapes, and the first batch of pure rules (economy, mood drift). Year-pass action lives here too (aging, conception cycle, succession entry-point).

**In scope.**
- `runtime/tickOrchestrator.ts` — fixed phase order per §3 ("time advance → economy → courier draining → scheme resolution → global-event roll → mood drift → rival-house action roll"). Stubs for empty phases.
- `game/rules/economy.ts` — tier classification (Solvent ≥ 0, Hemorrhaging −100 < w < 0, Embarrassed −500 < w ≤ −100, Ruined ≤ −500). Per-tick deltas per §3.
- `game/rules/moods.ts` — 15% reroll chance per active character per tick from weighted pool (Receptive 4 / Defensive 2 / Distracted 2 / Jealous 1; Grieving narrative-only); faux-pas reactive lock for 5 ticks.
- `game/rules/courier.ts` — symmetric per-location-pair transit table.
- Year-pass action: ages all alive characters by 1; processes succession if player died (heir resolution per §3); processes one conception cycle per active marriage if both spouses under 40.
- Vitest suites for each rule, hitting clamp boundaries and exact thresholds.

**Out of scope.** Strategy map UI (P3), schemes (P5), conversation (P4), rivals (P8), patronesses (P8), elopement (P9), artifacts (P10).

**Spec refs.** §3 "Tick-Driven Time Advancement", "Economy & Bankruptcy", "Mood Transitions", "Marriage, Conception & Inheritance", "Succession". §8 "Determinism".

**Key rules / constants.**
- Bankruptcy per-tick deltas: Hemorrhaging `−2 w, −1 r`; Embarrassed `−3 w, −1 r, +1 s`; Ruined `−5 w, −2 r, +2 s`.
- Reputation and scandal clamped `[0, 100]`; affection `[0, 100]`; wealth uncapped.
- All clamps applied at mutation sites, not display.
- Conception fires every 2 years per active marriage until either parent reaches age 40.
- Trait inheritance: 2 from union ∪ + 1 with 30% novelty / 70% from union.
- Succession `−20` reputation penalty on heir inheritance.

**Machines.** Mood (Receptive | Defensive(locked) | Distracted | Jealous | Grieving). Bankruptcy tier.

**Edge cases (§7).** "Affection/Composure mutation from multiple sites" (clamp at every site); "Conversation history orphan keys" (placeholder, populated in P4); "Sibling-rival promotion of a corpse" (succession only considers living adult siblings).

**Verification.** Each rule has Vitest coverage; tick orchestrator runs 1000 ticks deterministically; mood drift weighted-pool distribution matches expected within 2%.

**Close out.** When the gates and verification items above are green, run `/close-phase P1` to update phase status in `plans/MASTER.md` §6, append to `plans/SESSION-NOTES.md`, resolve any open questions answered during the work, and surface proposed `CLAUDE.md` additions and a commit message for approval.
