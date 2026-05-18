# P5 — Schemes & Multi-Tick Operations

> Part of [The Season Master Plan](../MASTER.md). Prior: [P4 — LLM Conversation & Ballroom](./04-ballroom-llm.md). Next: [P6 — Whispers, Espionage & Staff](./06-whispers-espionage.md).

**Goal.** Six scheme types resolvable across ticks, with prerequisite gating, atomic cost deduction, and completion effects. Scheme launch surfaces on ballroom NPC and as a ledger panel.

**In scope.**
- Six schemes (Courting, Sabotage, Seduction, Chaperone, Smuggling, Assassination) with §3 costs/durations/prerequisites.
- Family archetype skeleton (Spinster / Bohemian Rake / Country Exile) — enough to gate prerequisites; full classification logic in P7.
- Scheme cancellation (refunds nothing).
- Scheme resolution at completion → effects on target.
- Sabotage records a grievance (§3 "Duels & Grievances" — duel resolution lives in P8).
- Seduction discovery branch fires Elopement Sprint (P9 implements the overlay).
- Era restriction enforcement for Smuggling: reject at start if completion would land past era transition.
- "Active scheme" ledger panel (proper view comes in P14; here it's an inline list with cancel buttons).

**Out of scope.** Treason Framing (P10 — artifact-dependent); elopement sprint overlay UI (P9); duel resolution (P8).

**Spec refs.** §3 "Schemes", "Scheme Costs, Durations & Requirements", §7 "Era-flip during a Smuggling scheme", "Cancellation of in-flight Seduction by Chaperone".

**Key rules / constants.**

| Scheme | Cost | Ticks | Effect | Prereq |
|---|---|---|---|---|
| Courting | 10 | 5 | +40 affection | — |
| Sabotage | 15 | 3 | −30 composure, grievance | — |
| Seduction | 25 | 7 | +80 affection or discovery → elopement | — |
| Chaperone | 5 | 1 | Cancels in-flight Seductions on same target | Spinster archetype |
| Smuggling | 20 | 4 | One-shot blockade bypass flag | Earlier era; completion before era flip |
| Assassination | 50 | 6 | Target dies; +25 scandal | Bohemian or Country Exile archetype |

- Smuggling: cannot start if previous pass unclaimed; cannot start if completion past era-transition (rejected pre-deduction).
- Chaperone completion cancels ALL in-flight Seductions targeting the same character.

**Machines.** Scheme (Active → Completed | Cancelled | Failed).

**Edge cases (§7).** "Era-flip during a Smuggling scheme" (reject at start; no-op on bypass flag at completion if era already flipped); "Cancellation of in-flight Seduction by Chaperone"; "Action gating bypassed by mid-flight scheme starts" (start-time gates that took resources cannot be retroactively invalidated; completion-time checks must NOT double-charge).

**Open questions (§10).**
- **#6** — Seduction discovery one-shot binary or expanded multi-tick suspicion mechanic? Default: **One-shot** (matches §3 Elopement Sprint scope; multi-tick suspicion is a v1.5 candidate).

**Verification.** Vitest: each scheme effect; Chaperone vs multiple in-flight Seductions; Smuggling rejection at era-edge tick; atomic gating (no partial state mutation on rejection).

**Close out.** When the gates and verification items above are green, run `/close-phase P5` to update phase status in `plans/MASTER.md` §6, append to `plans/SESSION-NOTES.md`, resolve any open questions answered during the work, and surface proposed `CLAUDE.md` additions and a commit message for approval.
