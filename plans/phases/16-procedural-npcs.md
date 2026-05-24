# P16 — Procedural NPC Generation

> Part of [The Season Master Plan](../MASTER.md). Prior: [P15 — Dynasty Legacies & Renown Perks](./15-dynasty-legacies.md). Next: [P17 — Semantic Memory (Optional)](./17-semantic-memory.md).

**Goal.** Procedurally seed a larger non-player-character population beyond the hand-crafted fixture set so the world feels populated for late-campaign play.

**In scope.**
- Name banks (given names, surnames) keyed by era and gender; canonical lists in `src/game/fixtures/nameBanks.ts`.
- Archetype-aware trait distributions over the canonical 32-trait pool in `src/game/fixtures/traits.ts` (e.g., Dependent archetype draws from one weighted subset; Bohemian Rake from another).
- Deterministic seeded generation — drawn from the campaign RNG, never `Math.random`. Same seed produces the same procedural population.
- Persisted at first creation: generated characters land in `state.characters` like any other character and round-trip through the save/load contract.
- Hooked into the existing character-creation sites that currently rely on the hand-crafted fixture (e.g., Independent-house adolescents, rival-house associates, social-web filler).
- Acquisition path for the wired-but-inert `MilitaryOfficer` trait (CLAUDE.md P13 pin): widening the archetype trait pool to include `MilitaryOfficer` for at least one archetype activates the WarEffort officer-death + Seduction-multiplier rule branches by single-table edit. No `TRAITS` widening, no rule-branch wiring, no save-version bump, no persona-cache bump.

**Out of scope.**
- LLM-generated NPC biographical text (P18 — consumes the procedural NPCs created here).
- Portrait generation (procedural-flat or fixture-portrait stays at v1).
- Procedural artifact generation (§10 Q10 v1.5 candidate).

**Spec refs.** §3 "Procedural Identity (Content Tier)" — "Procedural non-player characters are seeded from name banks plus the canonical 32-trait pool with archetype-aware distributions; each generated character's identity is persisted at first creation".

**Dependencies.** P0 (RNG), P1 (Character schema + trait pool), P7 (archetype classification). Independent of P14/P15.

**Determinism.** Procedural NPC creation consumes the player-house RNG stream (or a dedicated procedural-NPC sub-stream — pick at implementation time and document the choice in CLAUDE.md). Never `Math.random`. The replay harness verifies identical NPC populations across 30 runs of the same seed.

**Save migration.** New `SaveV{N+1}` only if procedural NPCs introduce new `Character` fields (likely no — name + traits + archetype already exist). If the addition is purely additive to `state.characters`, no schema change. Legacy lifters should consider whether procedural NPCs are retroactively seeded into pre-P16 saves — recommended **yes** via an idempotent helper following the P4 `seedIndependentIntoLegacyState` precedent (CLAUDE.md "Bare+wrap lifter pattern for additive migrations").

**Verification.** Vitest: deterministic generation under fixed seed (30-run hash parity); save/load round-trip preserves procedural NPCs verbatim; archetype-aware distribution produces statistically expected trait mixes (e.g., generated Dependent-archetype NPCs draw from the Dependent trait pool, not the Bohemian Rake pool); a generated `MilitaryOfficer`-tagged NPC actually trips the P13 WarEffort officer-death branch in an end-to-end test.

**Close out.** When the gates and verification items above are green, run `/close-phase 16` to update phase status in `plans/MASTER.md` §6, append to `plans/SESSION-NOTES.md`, resolve any open questions answered during the work, apply any `CLAUDE.md` additions, and commit the changes (no push).
