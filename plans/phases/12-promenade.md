# P12 — Hyde Park Promenade

> Part of [The Season Master Plan](../MASTER.md). Prior: [P11 — Sibling Rivals & Inherited Secrets](./11-sibling-rivals-secrets.md). Next: [P13 — Global Events & Era Progression](./13-global-events-era.md).

**Goal.** Daytime low-risk alternative to the ballroom at the high-society location.

**In scope.**
- Action available only at high-society; consumes 1 tick.
- Deterministic single-NPC selection from present NPCs via per-house seeded draw.
- Three actions: witty-banter equivalent, deep-empathy equivalent, "compliment mount" (gated on partner owning a mount-family artifact; fixed affection bonus; no composure cost).
- No faux-pas penalty.
- Player owning a mount-family artifact + Mingle stance → per-promenade affection bonus.

**Out of scope.** Carriage-driver staff bribery (P6 already handled).

**Spec refs.** §3 "Hyde Park Daytime Promenade", "Hyde Park Promenade" (business logic).

**Machines.** None new.

**Edge cases.** None unique.

**Verification.** Vitest: NPC selection deterministic; mount-bonus stacking; Vitest mock with/without mount artifact.

**Close out.** When the gates and verification items above are green, run `/close-phase P12` to update phase status in `plans/MASTER.md` §6, append to `plans/SESSION-NOTES.md`, resolve any open questions answered during the work, and surface proposed `CLAUDE.md` additions and a commit message for approval.
