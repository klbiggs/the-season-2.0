# P18 (Optional) — LLM Flavor Content

> Part of [The Season Master Plan](../MASTER.md). Prior: [P17 — Semantic Memory (Optional)](./17-semantic-memory.md).

**Goal.** Persist-once-generate-once flavor text for artifacts, NPCs, and a periodic scandal sheet.

**In scope.**
- Artifact backstories generated on first encounter; stored in save.
- NPC biographical notes generated on first significant interaction; stored.
- Periodic scandal-sheet aggregation reads recent event log and produces a stylized gossip column (read-only, no game-state mutation).
- Designer-authored stubs as fallback when generation fails.

**Out of scope.** Streaming token rendering (§10 OQ — DEFAULT: deferred).

**Spec refs.** §3 "Generated Flavor Content (LLM-Authored, Persisted)".

**Verification.** Re-reading the same content item returns persisted text verbatim; model not invoked on save/load.

**Close out.** When the gates and verification items above are green, run `/close-phase P18` to update phase status in `plans/MASTER.md` §6, append to `plans/SESSION-NOTES.md`, resolve any open questions answered during the work, and surface proposed `CLAUDE.md` additions and a commit message for approval.
