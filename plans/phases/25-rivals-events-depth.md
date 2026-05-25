# P25 — Rivals, Factions, Global Events & Era Depth (v1.5)

> **Status: 📋 planned (skeleton).** Track: v1.5. Source: [MASTER.md §11.2-D/F](../MASTER.md#112-v15--deferred-backlog-aggregated-deduped).
> Brings the adversarial world (rivals, factions) and the world-state layer (global events, era, military) to full depth — removing the documented v1 limitations (dormant-on-death rivals, inert MilitaryOfficer).

## Depends on
P8 (rivals/patronesses/duels), P10 (artifacts — for rival artifact context), P13 (global events / era / officer scaffolding).

## Goal
Rivals are durable, economically real adversaries that can act on the player; the world-state layer offers more events and an activated military axis.

## In scope
- **Rivals / factions (§11.2-D).** Rival succession / auto-promote-heir (remove dormant-on-death); rival economic model (wealth gates rival schemes; remove the economy/succession skip gate); NPC-initiated duels (Q14 — rivals demand satisfaction); per-rival LLM persona prompts (rivals as conversation targets, reusing the P4 cache infra); faction-tension graphical visualization (Q8); withdraw-grievance non-duel resolution (own publisher); `findGrievanceAcrossHouses` / global-grievances inbox.
- **Global events / era / military (§11.2-F).** Additional global event types; `Culture` enum + per-family `culturalAffinity` (Q21); **`MilitaryOfficer` acquisition paths** (OfficerCommission scheme / MilitaryAcademy location / wider conception) + officer-cohort bootstrap seeding — activates the v1 dormant branches; mid-event end-tick mutation (extend/end early); WarEffort draftable-archetypes toggle; era-flip animation/banner; multi-tick research-action sequence; per-house courier-research halving for non-player houses.

## Out of scope
Rival-owned artifact loops (P24 owns the artifact system). The shared conversation/LLM cache infra changes (P26).

## Cross-cutting impact
- **No migration / no save-version bump** (pre-release posture — see the §6 "Migration posture" note). Rival succession state, officer cohort, additional event kinds, and the `Culture` enum + per-family affinity tags are edited into the single live schema in place; dev saves reset.
- **Determinism discipline still binds:** new top-level fields get the full quad-sync + `hashable-state` wiring; save/load round-trips.
- **New RNG draws** (rival succession, NPC-initiated duels, additional event rolls) → replay-harness extension; **rivals-run-last contract preserved** (any new RNG-consuming phase precedes the rival phase; the RNG-free `evaluateDynastyPerks` stays terminal).
- **`PERSONA_CACHE_VERSION` bump** (rival personas; Culture in persona — a cache-key bump, not a save migration). New bus events. Faction-tension viz reuses `react-force-graph-2d`. Per the P16 note, the BohemianRake officer path already partly activates MilitaryOfficer — extend, don't duplicate.

## Verification (definition of done)
- A dead rival head promotes a rival heir deterministically; rival schemes deduct rival wealth; NPC-initiated duels resolve via the existing 12-exchange resolver.
- Officer death rolls + WarEffort×Seduction multiplier fire with a real acquisition path; 30-run replay green.
- Faction-tension viz renders without perturbing the numeric matrix data; current-schema save/load round-trips the new fields.

## References
spec §3/§7 (Rivals, Patronesses, Duels, Global Events, Era); MASTER §10 Q8/Q14/Q21, §11.2-D/F; P8, P10, P13; CLAUDE.md rival-cooldown / per-rival-RNG-seeding / MilitaryOfficer-activation / MonarchsMood pins.
