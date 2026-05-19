# P6 — Whispers, Espionage & Staff

> Part of [The Season Master Plan](../MASTER.md). Prior: [P5 — Schemes](./05-schemes.md). Next: [P7 — Family, Marriage & Succession](./07-family-succession.md).

**Goal.** Whispers travel from source to player home via courier, accumulate verification progress, and can be weaponized down three branches. Staff espionage produces inbound whispers; Greedy staff can be turned.

**In scope.**
- Whisper data shape; per-pair courier transit table; verification progress per tick.
- Synergy-hit whisper generation (ballroom combat side-effect — keyed on bonus trait/mood match, NOT post-modulation sign).
- LLM `generateWhisper` tool call additive on top of deterministic synergy whisper.
- Wallflower stance bonus whisper on SlyGossip synergy hit (targets a deterministically picked non-target NPC).
- Three weaponization branches:
  - Blackmail (modest scandal cost; one-round target-attribute flip; consumes whisper).
  - Scandal Sheet (large target reputation drop; fixed attribution probability; on attribution → player house exiled, terminal endgame).
  - Accidental Slip (multi-tick drip-feed reputation reduction on target via subsequent conversation turns).
- Staff member shape; loyalty drift; per-tick bribery probability for low-loyalty Greedy staff; assignments (snoop / bribe-driver / intercept-mail / none / bribed-by-rival).
- Spymaster archetype: mail-interception action drops 1 in-flight inbound courier payload per cadence.
- Verified-secret pruning on character death; orphan-key cleanup in conversation history.

**Out of scope.** Inherited-secrets ledger across generations (P11); blood feuds (P11); semantic-memory whisper indexing (P17).

**Spec refs.** §3 "Espionage & Whisper Ledger", "Whisper Weaponization Branches", "Staff Espionage", §7 "Conversation history orphan keys", "Rival-house associated-character pruning", "Staff bribery while assigned to mail interception".

**Key rules / constants.**
- Whisper progresses Unverified → Verified at progress 100.
- Conversation-synergy whisper keys on bonus-flag synergy, not on affection sign.
- Bribed staff immediately cease outbound outputs; next mail-interception slot forfeit.
- Scandal Sheet attribution → player house marked exiled, end-of-campaign condition fires.

**Machines.** Whisper (Unverified → Verified → Weaponized | Dismissed).

**Edge cases (§7).** "Conversation history orphan keys"; "Staff bribery while assigned to mail interception"; "Inherited-secret surface against a now-allied rival" (P11); "Rival-house associated-character pruning".

**Open questions (§10).**
- **#19** — Staff-espionage subsystem in v1? Default: **Yes** (specced; gives player a whisper-generation lever beyond conversation synergy hits).
- **#20** — Ship all three weaponization branches (Blackmail / Scandal Sheet / Accidental Slip) simultaneously or one at a time? Default: **All three** in v1.

**Verification.** Vitest: per-branch outcomes; staff loyalty drift over 100-tick simulation; courier transit reproducibility; whisper generation determinism across replays.

**Close out.** When the gates and verification items above are green, run `/close-phase P6` to update phase status in `plans/MASTER.md` §6, append to `plans/SESSION-NOTES.md`, resolve any open questions answered during the work, apply any `CLAUDE.md` additions, and commit the changes (no push).
