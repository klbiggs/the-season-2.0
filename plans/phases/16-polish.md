# P16 — Polish: Audio, i18n, Procedural Identity

> Part of [The Season Master Plan](../MASTER.md). Prior: [P15 — Dynasty Legacies & Renown Perks](./15-dynasty-legacies.md). Next: [P17 — Semantic Memory (Optional)](./17-semantic-memory.md).

**Goal.** Ship-quality finish: audio cues, single translation table, procedural NPC generation for crowd density.

**In scope.**
- Audio system: single ambient mixer; cues tied to existing gameplay events (faux-pas, sabotage success, scheme completion); Howler.js as the audio engine.
- Single translation table — all UI text reachable through one i18n key registry; `react-i18next` or Lingui.
- Procedural NPC generation: seeded from name banks + canonical 32-trait pool with archetype-aware distributions; persisted at first creation.

**Out of scope.** Localization to specific languages beyond English in v1.

**Spec refs.** §3 "Audio, Localization & Procedural Identity (Content Tier)".

**Verification.** Audio cues fire on the right events; flipping locale shows the i18n stub; procedural NPCs persisted across save/load.

**Close out.** When the gates and verification items above are green, run `/close-phase P16` to update phase status in `plans/MASTER.md` §6, append to `plans/SESSION-NOTES.md`, resolve any open questions answered during the work, and surface proposed `CLAUDE.md` additions and a commit message for approval.
