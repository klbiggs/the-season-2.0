# P23 — Marriage, Family & Lifespan Depth (v1.5)

> **Status: 📋 planned (skeleton).** Track: v1.5. Source: [MASTER.md §11.2-B](../MASTER.md#112-v15--deferred-backlog-aggregated-deduped).
> Resolves the deferred §10 marriage/lifespan open questions (Q4/Q16/Q17/Q18) and the family-depth non-goals from P7.

## Depends on
P7 (family/marriage/succession), P8 (rivals — for cross-house hostility cascade), P16 (procedural society).

## Goal
Deepen the family subsystem: marriage reaches across houses, betrothals exist before adulthood, lifespans vary by trait/gender, and archetype classification can react to mid-life change.

## In scope
- **Cross-house marriages with rivals + hostility/alliance cascade (Q16).** Remove the `CrossHouseMarriageNotSupported` rejection; model the alliance/hostility effect.
- **Pre-adulthood betrothals (Q17).** New Betrothal entity + Pending/Honored/Broken lifecycle; remove the `TargetTooYoung` rejection.
- **Trait-modifier + gender-skewed lifespans (Q18).** Modulate the base `[70,95]` `LIFESPAN_RANGE` without silently re-rolling existing characters.
- **Mid-life archetype reclassification (Q4).** Explicit reclassify call on trait acquisition / role flip (the latch is "succession + maturation only" today).
- **Random-archetype trait-pool-pick in maturation.** Adds an RNG draw to `applyMaturationStep`.
- **Tutor reassignment after maturation** (today rejected `ChildAlreadyAdult`); **re-widowing role flip** (Spouse → Spinster on partner death).
- **Procedural marriages between society NPCs; society NPCs as HeadOfHouse.**

## Out of scope
The marriage-proposal UI affordance (P20 ships it). The Society roster view (P22). Seduction/elopement depth (P24).

## Cross-cutting impact
- **No migration / no save-version bump** (pre-release posture — see the §6 "Migration posture" note). New Betrothal Map + any new fields are edited into the single live schema in place; dev saves reset. **Lifespan re-derivation is free pre-release** — no migration needed (no saves in the wild; the replay harness runs fresh seeds, so changing `LIFESPAN_RANGE` derivation only re-baselines the harness intentionally, never re-rolls an in-the-wild save).
- **Determinism discipline still binds:** new top-level fields (betrothals Map) get the full quad-sync + `hashable-state` wiring; save/load round-trips.
- **New RNG draws** (maturation pick, betrothal/marriage rolls, lifespan modifiers) → replay-harness extension; rivals-run-last preserved.
- **`PERSONA_CACHE_VERSION` bump** if betrothal/cross-house-marriage status enters `buildPersonaPrompt` (this is a cache-key bump, not a save migration).
- **New bus events** (betrothal lifecycle) following the per-domain diff-publisher pattern.

## Verification (definition of done)
- Cross-house marriage modulates hostility deterministically; betrothal lifecycle round-trips through current-schema save/load.
- Lifespan derivation changes re-baseline the replay harness intentionally; 30-run replay green afterward. (No legacy-save concern pre-release — dev saves reset.)
- Archetype reclassification fires only at its declared triggers; classifier determinism contract intact.

## References
spec §3 (Marriage/Succession, archetype classification); MASTER §10 Q4/Q16/Q17/Q18, §11.2-B; P7, P8, P16; CLAUDE.md lifespan-distribution + archetype-latch + marriage-invariant pins.
