# P3 — Strategy Map & Locations

> Part of [The Season Master Plan](../MASTER.md). Prior: [P2 — Save/Load & Migrations](./02-save-migrations.md). Next: [P4 — LLM Conversation & Ballroom](./04-ballroom-llm.md).

**Goal.** Make the game playable in a minimal sense — the player can travel between 7 locations, accumulate per-tick deltas, and trigger location-bound actions. UI: an illustrated map with 7 absolutely-positioned location pins.

**In scope.**
- 7 location fixtures with: per-tick deltas, eligible actions, era-gating flags.
- Travel action (costs 1 tick).
- Location-bound action: bankruptcy escape valve at rural estate (`+50 wealth, +5 scandal`).
- Location-bound trait acquisition: "rustic" at rural estate after fixed consecutive ticks; "sophisticated" / "polyglot" at continental finishing-schools (20% per tick + moderate wealth drain).
- Monarch's-audience action at high-society location.
- Wardrobe-refresh action at high-society location (P10 will use this for forgery/wardrobe — for now refresh just resets a tick counter).
- Map UI: absolute-positioned DOM pins over an SVG/illustrated backdrop; click → travel.

**Out of scope.** Ball entry (P4 ballroom), Hyde Park promenade (P12), Smuggling era-gating (P5 + P13), railway research (P13), artifact-equipped pre-ball composure penalty (P10).

**Spec refs.** §3 "Strategy Map", "Location-Bound Trait Acquisition & Risk Asymmetry", "Monarch's-Audience Resolution".

**Key rules / constants.**
- Monarch's audience: reputation ≥ 30; 30-tick cooldown; full success at ≥ 50 wipes scandal to 0, +5 to all patronesses, costs `−50 wealth, −10 reputation`; partial 30–49 same cost + `+10 scandal`; full success also drops rival hostility `−5` (fires before rival action phase on same tick).
- Continental seduction-cities (canal city, renaissance city): lower reputation penalty during Seduction; higher inbound-courier scandal probability (fixed scalar).

**Machines.** None new.

**Edge cases (§7).** "Same-tick monarch's audience and rival action" — audience must drop hostility before rival action phase on the same tick.

**Verification.** Manual: travel + tick consumption visible; audience resolves correctly across all tiers; tick replay across 100 ticks reproduces deterministic location-tick counters.

**Close out.** When the gates and verification items above are green, run `/close-phase P3` to update phase status in `plans/MASTER.md` §6, append to `plans/SESSION-NOTES.md`, resolve any open questions answered during the work, and surface proposed `CLAUDE.md` additions and a commit message for approval.
