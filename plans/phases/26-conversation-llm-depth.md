# P26 — Conversation, LLM, Memory & Promenade Depth (v1.5)

> **Status: 📋 planned (skeleton).** Track: v1.5. Source: [MASTER.md §11.2-G/H](../MASTER.md#112-v15--deferred-backlog-aggregated-deduped).
> Deepens the conversation subsystem (routing, tools, memory) and the Hyde Park promenade mode. The determinism boundary is unchanged: the LLM layer never advances the gameplay PRNG.

## Depends on
P4 (ballroom/LLM round-trip), P12 (promenade), P17 (semantic memory), P18 (flavor).

## Goal
Conversation gets smarter (cross-house memory, key-moment routing, richer tools) and the promenade gains the tactical depth deferred at P12.

## In scope
- **LLM / memory (§11.2-G).** Cross-house semantic retrieval (relax the player-house-only index filter); second embedding provider (OpenAI/Voyage) behind `/api/llm/embed`; re-embedding historical passages on model change; Pro-routed "key moment" model overrides (proposal/scheme/duel/audience); NPC-initiated conversations (Q14); streaming dialogue + streaming flavor (Q15 — reverses the v1 single-shot decision); additional LLM tool surfaces (`generateGrievance`) + persona cache-key extension for multi-character scene composition; per-character bio/backstory authoring UI; flavor regenerate.
- **Promenade (§11.2-H).** Stance toggle inside promenade (gate the mount bonus on `stance === "Mingle"`); mood/trait synergy on promenade tactics; multi-NPC promenade scene; `ComplimentMount` as a ballroom tactic (extend the 3 synergy maps + bump the `TACTICS.length` module-load guard); `sendPromenadeMessage` / `exitPromenade` exile + elopement post-await short-circuits (close the deliberate P12 modal-gate divergence).

## Out of scope
Wiring rivals as conversation targets (P25 owns rival personas; this phase owns the shared cache/routing infra they reuse).

## Cross-cutting impact
- **`PERSONA_CACHE_VERSION` bump** (multi-character cache key; NPC-initiated framing — which MUST ride per-turn `contents`, not `systemInstruction`, per the P12 cache mutual-exclusion lesson).
- **Server routing changes** (`server/routing.ts` key-moment overrides). Streaming reverses the orchestrator's single-shot `generateContent` contract (Q15) and adds a partial-token render path + mid-stream cancellation.
- **`ComplimentMount` ballroom widening** touches the `TACTICS.length !== 5` guard + `TACTIC_BONUS_MOOD` / `CONVERSATION_TRAIT_BONUSES` / `CONVERSATION_TRAIT_PENALTIES` per the P12 TACTICS-widening pin.
- Semantic index stays a **Dexie sidecar out of the replay hash** (P17 contract); flavor authoring touches the in-hash `flavorText` save field (additive). Replay harness stays green (LLM never invoked in the harness).

## Verification (definition of done)
- Cross-house retrieval ranks correctly; streaming degrades to single-shot cleanly on failure; key-moment routing picks Pro at the declared moments.
- `ComplimentMount` synergy + the bumped TACTICS guard are pinned by `combat.test.ts`; promenade modal short-circuits covered.
- 30-run replay green; LLM failure paths (timeout/network/schema/cancelled) all covered.

## References
spec §5/§7 (Conversation, Promenade, Semantic Memory); MASTER §10 Q14/Q15, §11.2-G/H; P4, P12, P17, P18; CLAUDE.md promenade-modal / per-mode-framing / TACTICS-widening / persona-cache / semantic-sidecar / flavor pins.
