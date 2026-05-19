# P15 — Dynasty Legacies & Renown Perks

> Part of [The Season Master Plan](../MASTER.md). Prior: [P14 — Ledger View & Social Web Visualization](./14-ledger-social-web.md). Next: [P16 — Polish](./16-polish.md).

**Goal.** Three permanent house-level perks awarded on cross-generational milestones.

**In scope.**
- **Patronage perk:** awarded after 3 consecutive heirs survive to natural death; permanent multiplier on events hosted at the rural estate.
- **Seduction perk:** awarded after 4 cumulative successful Seductions across all generations; permanent positive base addition + halved discovery-scandal.
- **Whispers perk:** awarded after fixed cumulative Weaponized whispers across all generations; halves whisper verification time + adds intercept probability on inbound whispers about the player house.
- Perks evaluated at end of every tick, after all rolls (§7 edge case).
- Round-trip through save/load.

**Out of scope.** Retroactive awards for pre-perk campaigns (§10 OQ — DEFAULT: NO).

**Spec refs.** §3 "Dynasty Legacies (Renown Perks)", "Dynasty-Legacy Award Triggers".

**Machines.** None.

**Edge cases (§7).** "Dynasty perk award during the same tick as succession" (compute against post-succession state).

**Open questions (§10).**
- **#22** — Retroactively award dynasty perks to players whose pre-perk campaigns already satisfy the trigger conditions, or going-forward only? Default: **Going-forward only** — clean semantics; avoids a one-time "perk explosion" on the first load after this phase ships.

**Verification.** Vitest: trigger conditions over 5-generation simulation; save-roundtrip preserves perks.

**Close out.** When the gates and verification items above are green, run `/close-phase P15` to update phase status in `plans/MASTER.md` §6, append to `plans/SESSION-NOTES.md`, resolve any open questions answered during the work, apply any `CLAUDE.md` additions, and commit the changes (no push).
