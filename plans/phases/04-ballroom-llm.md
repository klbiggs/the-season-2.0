# P4 — LLM Conversation & Ballroom

> Part of [The Season Master Plan](../MASTER.md). Prior: [P3 — Strategy Map](./03-strategy-map.md). Next: [P5 — Schemes](./05-schemes.md).

**Goal.** The signature surface. Players enter the ballroom at high-society, see up to 5 NPCs in a ring, select a target, optionally pin a tactic, type a freeform message, and receive in-character dialogue + deterministic state deltas.

**In scope.**
- Ballroom UI: 5 portrait cards in a CSS-grid ring; tactic buttons (Flattery, WittyBanter, SlyGossip, DeepEmpathy) that double as prefill + intent pin; stance toggle (Wallflower / Mingle / TargetedPursuit); message input; chat history (3 recent per pair).
- `llm/client.ts` with `AbortController` + 15s timeout + BYOK key + pre-flight key shape check.
- `llm/tools.ts` — `respond` tool schema; Zod validation on response.
- `llm/routing.ts` — Haiku default; Sonnet/Opus on empty `(houseId, targetCharId)` history.
- `llm/prompts/` — per-character persona block, marked with `cache_control: ephemeral`.
- `runtime/conversationOrchestrator.ts` — handles request lifecycle (Idle → Sending → Resolving → Done | Failed), guards post-await mutations with `requestId` ref.
- `game/rules/combat.ts` — affection delta `Base(10) + BonusTraits×15 + BonusMood×15`; composure delta `PenaltyTraits × −10`; flattery-vs-defensive instant-fail (`0 affection, −20 composure, +faux-pas`); witty-banter-vs-distracted zero-yield; stance multipliers (Wallflower ×0.5 affection + bonus whisper on SlyGossip synergy; Mingle baseline; TargetedPursuit ×1.25 against pinned target + doubled composure damage when sabotaged).
- Conversation-history pair key on `(houseId, targetCharId)` not actor — survives heir promotion (§7).

**Out of scope.** Scheme buttons inside ballroom (P5 wires them in); whisper generation via tool call (P6 enables `generateWhisper` tool); patroness veto on ball entry (P8); ball pre-composure penalty (P10).

**Spec refs.** §3 "Conversational Ballroom", "Stance Modifiers", §3 "Conversation Combat Math", "Language-Model Quality Modulation", §5 "Remote Large-Language-Model Service", §6, §7 conversation edge cases.

**Key rules / constants.**
- Quality multiplier clamped `[0.5, 1.5]`; modulates affection only, never composure.
- Unknown classifications fall back to pinned intent or Flattery.
- Faux-pas fires when composure ≤ 0 post-resolution; locks target Defensive 5 ticks.
- Conversation history bounded to 3 most-recent exchanges per `(house, target)` pair.

**Machines.** Conversation round-trip.

**Edge cases (§7).** "Mid-conversation view exit"; "Heir promotion mid-conversation"; "Mood-lock cascade prevention"; "Embedding service failure during conversation start" (P17 placeholder — for P4, just don't break if the embedding hook is absent).

**Open questions (§10).**
- **#5** — Route proposal / scheme completion / duel / monarch's audience to the more capable model in v1? Default: **No** — first-meeting only.
- **#13** — Expand the LLM tool surface beyond `generateWhisper` in v1? Default: **Whisper-only**.
- **#14** — NPC-initiated conversations (NPC speaks first when player enters orbit)? Default: **Deferred**.
- **#15** — Streaming dialogue (token-by-token with mid-stream cancellation)? Default: **No** — single-shot "thinking..." pattern.

**Verification.** All four failure paths tested (timeout, network, schema, missing key) — none advance the tick. Cache hit observable on the second turn against the same NPC (lower latency, lower input-token cost). Conversation history correctly survives a forced succession during a pending request.

**Close out.** When the gates and verification items above are green, run `/close-phase P4` to update phase status in `plans/MASTER.md` §6, append to `plans/SESSION-NOTES.md`, resolve any open questions answered during the work, and surface proposed `CLAUDE.md` additions and a commit message for approval.
