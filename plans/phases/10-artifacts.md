# P10 — Artifacts, Wardrobe, Forgery & Theft

> Part of [The Season Master Plan](../MASTER.md). Prior: [P9 — Elopement Sprint Overlay](./09-elopement.md). Next: [P11 — Sibling Rivals & Inherited Secrets](./11-sibling-rivals-secrets.md).

**Goal.** The artifact loop: equip for reputation, wardrobe ages per ball, Bohemian Rake forges, surfacing rolls cascade onto Vain NPCs, thieves attempt against high-reputation houses, Spymaster thwarts.

**In scope.**
- Artifact registry: id, display name, family enum (sapphires, tiara, snuffbox, phaeton, mount, family-deed, ancestral-portrait, etc.), reputation bonus, scandal-risk-while-worn, optional trait grants, forgeable flag, forge wealth cost (when forgeable).
- Equipping → reputation bonus + trait grants while equipped.
- Wardrobe decay: per-artifact last-refresh tick; "out of season" after fixed refresh-interval since last refresh.
- Pre-ball composure penalty: fixed per out-of-season equipped artifact, applied BEFORE conversation phase; snapshot at ball entry, no mid-ball recompute.
- Wardrobe refresh action (already exists from P3): consumes fixed wealth; resets refresh tick on all equipped artifacts.
- Forgery commission: requires living Bohemian Rake; cost wealth; record forger identity + tick.
- Forgery surfacing: sub-percent per-tick roll on each unsurfaced forgery; on surface, every Vain NPC → Defensive locked for fixed period AND drops fixed affection delta toward player.
- Thief notice: per-tick small probability gated on (a) house reputation ≥ high threshold AND (b) at least one equipped artifact at or above valuable-threshold.
- Thwart action: requires living Spymaster; costs wealth + 1 in-flight payload slot; high success probability.
- Theft against unequipped artifact: auto-thwarted with no thwart cost (§7).
- **Treason Framing scheme** (7th scheme; gated on at least one unsurfaced forgery): completion drops rival reputation, raises rival hostility, marks forgery surfaced.

**Out of scope.** Procedural artifact generation (§3 Audio/Localization tier in P16); generated artifact backstories (P18).

**Spec refs.** §3 "Wardrobe, Artifacts & Heirlooms", "Forgery & Theft", "Treason Framing", "Wardrobe Decay & Pre-Ball Composure Penalty", "Forgery Surfacing", "Thief Notice & Thwart", §7 multiple edge cases.

**Key rules / constants.** Specific thresholds (refresh-interval, valuable threshold, theft probability, surfacing probability) live in `game/constants.ts`; tuneable.

**Machines.** Forgery (Unsurfaced → Surfaced).

**Edge cases (§7).** "Wardrobe refresh during bankruptcy" (warn but allow); "Out-of-season artifact equipped mid-ball" (snapshot at entry); "Theft against an unequipped artifact" (auto-thwarted, no cost); "Forgery surfacing cascade" (transactional — all Vain NPCs locked together).

**Open questions (§10).**
- **#7** — Ship Treason Framing in v1 alongside the artifact registry, or defer until after artifacts are stable? Default: **Yes — ships with P10** (it's the apex outcome of the forgery loop; deferring leaves the loop incomplete).
- **#10** — Wardrobe seasonal decay: global tick threshold or per-artifact-family (some fashions age faster)? Default: **Global tick** in v1; per-family decay is a v1.5 candidate.
- **#11** — Should forged artifacts be detectable by Observant-trait NPCs at a probability, or stay hidden until the per-tick surfacing roll fires? Default: **Hidden until surfacing roll** (simpler; matches §3 surfacing semantics).

**Verification.** Vitest: surfacing roll deterministic across replay; cascade lock applied transactionally; pre-ball snapshot semantics; Treason Framing consumes the forgery exactly once.

**Close out.** When the gates and verification items above are green, run `/close-phase P10` to update phase status in `plans/MASTER.md` §6, append to `plans/SESSION-NOTES.md`, resolve any open questions answered during the work, apply any `CLAUDE.md` additions, and commit the changes (no push).
