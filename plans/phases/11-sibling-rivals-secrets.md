# P11 — Sibling Rivals & Inherited Secrets / Blood Feuds

> Part of [The Season Master Plan](../MASTER.md). Prior: [P10 — Artifacts, Wardrobe, Forgery & Theft](./10-artifacts.md). Next: [P12 — Hyde Park Promenade](./12-promenade.md).

**Goal.** Two long-tail multi-generational systems that activate on succession.

**In scope.**
- Sibling-rival promotion at succession: each adult sibling whose hostility derivation (affection-delta toward dead head vs new heir) exceeds threshold is promoted to autonomous actor.
- Per-tick action roller: `currentTick − lastActionTick ≥ 5` AND not reconciled. Weighted pool: gambling-debt (heaviest), leak-secret, petty sabotage, auto-start a Sabotage scheme (lightest).
- Hostility delta: `−2` per action; `+5` on failed reconciliation; clamped `[0, 100]`.
- Reconciliation action at high-society: `−50 wealth, −10 reputation`; success probability proportional to inverse hostility; auto-reconciliation at hostility 0 → reverts to Dependent role.
- Inherited secrets ledger: at succession, copy in all verified whispers ABOUT the player house; bounded by entry count with oldest collapsing into per-generation ancestor summary.
- Blood-feud surfacing: per-tick sub-percent probability per active inherited-secret; picks a deterministically chosen hostile rival house; records casus belli; large affection penalty on all rival-associated characters; active feud appended; resolved by duel, satisfaction-demanded, or generational decay.
- Edge case: surfacing roll against rival whose hostility has since dropped below activation threshold → missed roll, secret stays active.

**Out of scope.** Cross-house marriages affecting hostility (§10 OQ).

**Spec refs.** §3 "Sibling Rivals (Autonomous Slighted Heirs)", "Inherited Secrets & Blood Feuds", "Sibling-Rival Action Roller", "Inherited Secrets & Blood-Feud Surfacing".

**Key rules / constants.** Above.

**Machines.** Sibling-rival (Active → Reconciled).

**Edge cases (§7).** "Sibling-rival promotion of a corpse"; "Inherited-secret surface against a now-allied rival"; "Dynasty perk award during the same tick as succession" (P15 — perks evaluated post-succession).

**Verification.** Vitest: 5-generation simulation reproducible; bounded-ledger eviction correct; reconciliation probability slope correct.

**Open question (§10).** Whether sibling-rival mechanic is active in v1. Default: YES (it's specced); if scope cut, drop into v1.5.

**Close out.** When the gates and verification items above are green, run `/close-phase P11` to update phase status in `plans/MASTER.md` §6, append to `plans/SESSION-NOTES.md`, resolve any open questions answered during the work, and surface proposed `CLAUDE.md` additions and a commit message for approval.
