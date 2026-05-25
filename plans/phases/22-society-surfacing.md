# P22 — Society & World Surfacing (v1.5)

> **Status: 📋 planned (skeleton).** Track: v1.5. Source: [MASTER.md §11.2-A](../MASTER.md#112-v15--deferred-backlog-aggregated-deduped) + the §10 V1.5 marquee row + society-facing items from §11.2-J.
> Makes the non-player world (rivals + the ~25 procedural society) visible and slowly alive. The "Society / The Ton" view is the single most-cited deferred item across P14/P16/P18.

## Depends on
P14 (social web + ledger), P16 (procedural society), P18 (flavor content).

## Goal
The player can see and read the wider world — society NPCs and rivals — not just their own house, and that world doesn't silently empty out over generations.

## In scope
- **"Society / The Ton" view** (§10 V1.5 row). Togglable text roster + spatial sub-view over `INDEPENDENT_HOUSE_ID` + rivals, reusing `react-force-graph-2d`; ship as a third Family-Tree-tab toggle state coexisting with the player-perspective web (Q9 "coexist" precedent).
- **NPC→player inbound Social Web edges.** Render the `affectionMap` keys currently dropped by the player-outbound guard at `SocialWebView.tsx:63`.
- **Player-house-member NPC bios.** Extend the P18 flavor `revealNpcBio` trigger beyond ballroom conversation targets.
- **Procedural portraits.** Replace the initial-letter glyph placeholder (resolves the P14↔P16 contradiction); deterministic per `CharacterId`.
- **Founder procedural naming.** Replace the hardcoded "Player I".
- **Ongoing society replenishment.** Death-driven / yearly trickle to refill society as members age out (today society only erodes).

## Out of scope
Society marriages / society NPCs as HeadOfHouse (→ P23). Rival economy / succession (→ P25).

## Cross-cutting impact
- **No migration / no save-version bump** (pre-release posture — see the §6 "Migration posture" note). Founder naming and any new replenishment-tracking field are edited into the single live schema in place; dev saves reset via `npm run reset-save`. Founder-name change is free pre-release (no content-rewriting migration).
- **Determinism discipline still binds:** any new top-level field gets the full quad-sync (schema↔projection↔selector↔`overwriteFromGameState`) + `hashable-state` wiring; save/load of the current schema must round-trip.
- **Replenishment consumes RNG** → thread a deterministic stream (society sub-stream, like P16's transient procedural stream) and extend the 30-run replay harness; preserve "rivals run last among RNG-consuming phases."
- Roster/social-web rendering is UI-only. The Society view reuses the P14 force-graph surface. Verify the P16 "social web is player-house-only" trip-hazard is intentionally lifted only for the new view.

## Verification (definition of done)
- Society + rivals are visible without prior player conversation; player-perspective web unchanged when toggled off.
- Replay harness deterministic with replenishment active across 30 runs.
- Current-schema save/load round-trips the new fields; trip-wires green or updated with rationale. (No migration — dev saves reset on schema change.)

## References
spec §2/§3 (society, social web); MASTER §10 V1.5 row, §11.2-A + portraits/founder/replenishment from J; P14, P16, P18; CLAUDE.md P16 society trip-hazard + P19 next-migration note.
