# P7 — Family, Marriage & Succession

> Part of [The Season Master Plan](../MASTER.md). Prior: [P6 — Whispers, Espionage & Staff](./06-whispers-espionage.md). Next: [P8 — Rival Houses, Patronesses & Duels](./08-rivals-patronesses.md).

**Goal.** Full multi-generation lifecycle: proposals, conception, child traits, tutor assignment, archetype classification, succession with `−20` reputation penalty, ancestor summary.

**In scope.**
- Marriage proposal flow: requires affection ≥ 80 AND house reputation ≥ 40; acceptance prob `0.5 + (aff−80)/20 × 0.45` clamped `[0,1]`; rejection `+5 scandal`.
- Conception every 2 years per active marriage until either parent reaches 40.
- Child trait inheritance: 2 from union ∪; 1 with 30% novelty / 70% union.
- Tutor archetype assignment to children; +1 trait at adulthood from per-archetype 2-option pool (Spymaster: Observant/Cunning; Bohemian: Jaded/Melancholic; etc.); guide-opinion effect at fixed cooldown; reassignment costs wealth; locked at adulthood.
- Archetype auto-classification at succession + child maturation (pure first-match-wins per §3):
  - Spinster + (Cunning OR Observant) → Spymaster.
  - Unwed adult male + (Frivolous OR Romantic OR Jaded) → Bohemian Rake.
  - Unwed adult + (Intellectual OR Sophisticated) → Tutor.
  - Exile role OR (ImpoverishedNobility OR Rustic) → Country Exile.
  - Else None.
- Succession: heir resolution (family pool → adult children → promotion); generation counter increment; ancestor summary line; spouse marriage record marked dissolved; genealogical record preserved.
- Happiness field on every character `[0, 100]`; per-tick drain when spouse carries Dull trait; below-threshold unlock discounted-Seduction temptation hook.

**Out of scope.** Sibling-rival promotion (P11); inherited-secrets transfer at succession (P11); dynasty perks (P15).

**Spec refs.** §3 "Marriage, Conception & Succession", "Tutor Influence", "Family Archetype Auto-Classification", "Happiness Drain From Dull-Spouse Marriages", §10 OQ on classification recompute timing.

**Key rules / constants.** See above; all clamps re-applied at mutation sites.

**Machines.** Marriage (Active → Dissolved). Archetype classification is a pure function, not a machine.

**Edge cases (§7).** "Sibling-rival promotion of a corpse"; "Tutor reassignment after maturation"; "Conversation history orphan keys" on death; "Affection/Composure mutation from multiple sites".

**Verification.** Vitest: proposal slope at boundaries (0.5 at 80, 0.95 at 100); conception cadence over 50-year campaign; archetype classification against fixture sets; succession with multiple eligible heirs deterministic.

**Open questions (§10).**
- **#4** — Should mid-life trait acquisition trigger archetype reclassification? Default: **No** — classification runs only at succession + child maturation per §3.
- **#16** — Cross-house marriages with rival-house NPCs (alliance-driven hostility shifts) in v1? Default: **Deferred** to v1.5.
- **#17** — Pre-adulthood betrothals (children of different houses pre-committed to a future marriage)? Default: **Deferred** to v1.5.
- **#18** — Character lifespans fixed value or rolled per-character (uniform-in-range or trait-modified)? Default: **Rolled per-character** so siblings have varied lifespans.
- **#23** — Dull-spouse happiness threshold: auto-unlock the discounted-Seduction temptation hook, or only when player explicitly elects from ledger? Default: **Auto-unlock on threshold crossing** (less friction; matches the spec's "deliberate temptation hook" framing).

**Close out.** When the gates and verification items above are green, run `/close-phase P7` to update phase status in `plans/MASTER.md` §6, append to `plans/SESSION-NOTES.md`, resolve any open questions answered during the work, apply any `CLAUDE.md` additions, and commit the changes (no push).
