# P9 — Elopement Sprint Overlay

> Part of [The Season Master Plan](../MASTER.md). Prior: [P8 — Rival Houses, Patronesses & Duels](./08-rivals-patronesses.md). Next: [P10 — Artifacts, Wardrobe, Forgery & Theft](./10-artifacts.md).

**Goal.** The discovered-Seduction overlay: a 7-tile 1-D chase with three player actions.

**In scope.**
- Overlay view that suspends Map without unmounting it; "return to map" always available (loses the sprint).
- 7-tile track; player starts at tile 2; father starts at tile 0.
- Actions:
  - Push: player +1, father +1, player composure −5.
  - Fresh Horses: player +2, cost −10 wealth, capped 3 uses.
  - Surrender: father → tile 7, immediate loss.
- Win at player tile = 7: house reputation halved (clamped `[0, ∞)`).
- Loss at father tile = 7 OR player composure ≤ 0: +50 scandal.
- Framer Motion tile transitions.

**Out of scope.** Multi-turn suspicion mechanic (§10 OQ; deferred).

**Spec refs.** §3 "Elopement Sprint", §3 (under business logic), §7 view routing.

**Key rules / constants.** See above.

**Machines.** Elopement sprint (Running → Won | Lost).

**Edge cases (§7).** "Mid-conversation view exit" pattern applies — player navigating away mid-sprint loses by default; in-flight side-effects must check the overlay still exists.

**Verification.** Vitest on the resolver; Playwright: launch sprint via Seduction discovery → reach tile 7 → reputation halved on save state.

**Close out.** When the gates and verification items above are green, run `/close-phase P9` to update phase status in `plans/MASTER.md` §6, append to `plans/SESSION-NOTES.md`, resolve any open questions answered during the work, and surface proposed `CLAUDE.md` additions and a commit message for approval.
