# P8 — Rival Houses, Patronesses & Duels

> Part of [The Season Master Plan](../MASTER.md). Prior: [P7 — Family, Marriage & Succession](./07-family-succession.md). Next: [P9 — Elopement Sprint Overlay](./09-elopement.md).

**Goal.** Three canonical rivals with action loops, five patronesses with favor scores, faction tension counters, and the 12-exchange duel resolver.

**In scope.**
- 3 rival houses with names, factions, starting reputations and hostilities; hostility decay `−1`/tick; activation threshold 25; action cooldown 8 ticks.
- Action pool weights: LeakWhisper 3, PettySabotage 2, OpenSabotage 2, RaiseFactionTension 1; tension-biased weighting toward OpenSabotage at high faction tension.
- 5 patronesses; favor `[0, 100]` starting 50; per-tick erosion `−1` when scandal ≥ 50 on a deterministically-picked patroness; doubles when tension toward her affiliation ≥ 50; full-success monarch's audience `+5` to all.
- Ball veto when any patroness's favor < 20 (rejection prose names the snubbing patroness(es)).
- 4 factions; pairwise tension counters cap at 100.
- Grievance recording (Sabotage success, public faux-pas).
- "Demand satisfaction" action → duel.
- Duel resolver: each duellist starts at 100 composure; conversation-math base 25 with ×2 composure multiplier; challenger first; 12-exchange cap → stalemate favors defender; decisive loss → 50/50 killed vs wounded.

**Out of scope.** Sibling-rival actors (P11); rival-house cross-marriage (§10 OQ; deferred).

**Spec refs.** §3 "Rival Houses", "Patronesses & Faction Politics", "Duels & Grievances", "Patroness Favor".

**Key rules / constants.** See above.

**Machines.** No new (rival hostility/action is a per-tick roll, not a machine).

**Edge cases (§7).** "Rival-house associated-character pruning" on character death; "Same-tick monarch's audience and rival action" (audience drops hostility before rival action roll).

**Open questions (§10).**
- **#1** — On succession, should the new heir inherit the patronesses' favor scores or should they reset? Default: **Inherit** (continuity over reset; matches the multi-generation arc framing).
- **#2** — Rival-house registry procedurally seeded per campaign or canonical? Default: **Canonical** (matches prior implementation; predictability for testing and determinism replay).
- **#8** — Visualize faction tension graphically (beyond per-pair numeric counter)? Default: **No** — numeric in rival ledger only in v1.

**Verification.** Vitest: rival action pool distribution matches weights over 10k tick simulation; patroness erosion and audience offset; duel resolver — symmetry of challenger advantage; stalemate-favor-defender invariant; killed-vs-wounded 50/50 over 1000 trials within tolerance.

**Close out.** When the gates and verification items above are green, run `/close-phase P8` to update phase status in `plans/MASTER.md` §6, append to `plans/SESSION-NOTES.md`, resolve any open questions answered during the work, and surface proposed `CLAUDE.md` additions and a commit message for approval.
