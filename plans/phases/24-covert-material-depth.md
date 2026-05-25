# P24 — Covert Operations & Material Assets Depth (v1.5)

> **Status: 📋 planned (skeleton).** Track: v1.5. Source: [MASTER.md §11.2-C/E/I](../MASTER.md#112-v15--deferred-backlog-aggregated-deduped).
> Deepens the player's covert apparatus (schemes / seduction / elopement / staff) and material assets (artifacts / forgery / wardrobe) — the forge→Treason loop and the downstairs network.

## Depends on
P5 (schemes), P6 (whispers/staff), P9 (elopement), P10 (artifacts/forgery/theft), P15 (dynasty perks — for staff loyalty effects).

## Goal
The covert and material subsystems gain the depth deferred at v1: graduated seduction discovery, player agency over who acts, procedural/decaying artifacts, and a manageable staff roster.

## In scope
- **Schemes / seduction / elopement (§11.2-C).** Multi-tick Seduction-discovery suspicion (Q6 — consume the reserved `Scheme.accumulatedAffection`); aggressor-selector UI (player picks the family member); Abandonment/Divorce action dissolving a prior marriage on elopement win (Q25; new cost surface + `MarriageRecord` field); multi-character / rival-driven / NPC-initiated elopement sprints (`state.elopement` singleton → per-house Map); pursuit-speed trait modifiers; composure-driven mood transitions from scheme completions; Smuggling blockade-bypass dead-state cleanup; randomized/synthetic-NPC starting schemes.
- **Artifacts / forgery (§11.2-E).** Procedural artifact generation; per-artifact-family wardrobe decay (Q10); Observant-trait forgery detection (Q11 — parallel cascade); NPC-initiated thefts; explicit forger picker (multiple Rakes); rival-owned artifact loops.
- **Staff (§11.2-I).** Hire-staff (`makeStaffId`) + fire-staff affordances (verify P15 didn't already ship fire); promote-staff-to-character rule; BribeDriver subject-selection specialization; dynasty-perk loyalty effects + procedural staff identity.

## Out of scope
Rival succession / economy (P25). Additional LLM tool surfaces e.g. `generateGrievance` (P26).

## Cross-cutting impact
- **No migration / no save-version bump** (pre-release posture — see the §6 "Migration posture" note). The per-house elopement Map (was a singleton), procedural artifact/staff records, runtime-created staff ids, the new `MarriageRecord` field, and the now-consumed `accumulatedAffection` are all edited into the single live schema in place; dev saves reset. The aggressor-selector changing the lex-smallest default is likewise free pre-release.
- **Determinism discipline still binds:** new top-level fields get the full quad-sync + `hashable-state` wiring; save/load round-trips.
- **Multiple new RNG draws** (per-tick suspicion rolls, procedural artifact/staff generation, theft) → replay-harness extension; **rivals run last among RNG-consuming phases preserved**.
- New bus events (suspicion, abandonment, staff lifecycle). Per-family decay touches `constants.ts`.

## Verification (definition of done)
- Multi-tick suspicion is deterministic and round-trips current-schema save/load; per-house elopement Map round-trips; procedural artifacts + hired staff are deterministic per seed.
- 30-run replay green; new draws threaded through the correct per-house RNG streams.
- Staff hire/fire/promote round-trip; per-family decay tunable from `constants.ts`.

## References
spec §3 (Schemes, Elopement, Wardrobe/Artifacts/Forgery, Staff); MASTER §10 Q6/Q10/Q11/Q25, §11.2-C/E/I; P5, P6, P9, P10, P15; CLAUDE.md scheme-input-widening / elopement modal-gate / artifact strip-cascade / per-iteration-accumulator pins.
