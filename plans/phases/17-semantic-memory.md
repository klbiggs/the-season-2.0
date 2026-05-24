# P17 (Optional) — Semantic Memory (Embedding Retrieval)

> Part of [The Season Master Plan](../MASTER.md). Prior: [P16 — Procedural NPC Generation](./16-procedural-npcs.md). Next: [P18 — LLM Flavor Content (Optional)](./18-llm-flavor.md).

**Goal.** Surface deep historical context in conversation prompts beyond the 3-exchange recency window.

**In scope.**
- Voyage AI client (or OpenAI fallback) for `voyage-3-lite` embeddings.
- Subscribe to exchange completion, whisper publication, scheme completion, casus belli recording, succession.
- One-time lore-corpus pass at first game start.
- Index in IndexedDB sidecar; bounded by entry count; FIFO eviction by tick.
- Retrieval filtered by `(houseId, npcId)` where applicable.
- Recency window preserved; semantic hits ADDED as a separate prompt section.
- Pin embedding model identifier in save.

**Out of scope.** Cross-house retrieval (§3 explicitly out-of-scope for initial implementation).

**Spec refs.** §3 "Real Semantic Memory", §5 "Optional Embedding Service".

**Edge cases (§7).** "Embedding service failure during conversation start" (build prompt with recency window only; log miss).

**Open questions (§10).**
- **#12** — Is the embedding-based semantic-memory subsystem active in v1, or deferred? Default: **Deferred to v1.5** — the 3-exchange recency window is sufficient for first release; this phase is marked optional in the index.

**Verification.** Semantic hit observable on prompts; failed embedding doesn't block conversation; save sidecar round-trips.

**Close out.** When the gates and verification items above are green, run `/close-phase 17` to update phase status in `plans/MASTER.md` §6, append to `plans/SESSION-NOTES.md`, resolve any open questions answered during the work, apply any `CLAUDE.md` additions, and commit the changes (no push).
