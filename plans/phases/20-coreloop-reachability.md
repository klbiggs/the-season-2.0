# P20 — Core-Loop Reachability & Legibility (v1.1 hardening)

> **Status: 📋 planned (skeleton).** Track: v1.1 (UI-correctness, no new gameplay rules). Source: [MASTER.md §11.1](../MASTER.md#111-ui-surfacing-gaps-v1-fix-candidates).
> Wires already-built store actions to UI affordances and surfaces already-persisted state. The decisive item is the unreachable `proposeMarriage` — without it the dynasty loop cannot be played through the UI.

## Depends on
P7 (proposal rules + `store.proposeMarriage`), P9 (elopement), P4 (ballroom), P14 (ledger / family tree).

## Goal
Make the core dynasty loop **reachable** (the player can marry → conceive → succeed entirely through the UI) and **legible** (endgame-critical scalars and the dramatic payoffs are visible at the point of action).

## In scope
- **`proposeMarriage` UI affordance (CRITICAL).** A propose control on family-tree rows and/or a ballroom/social-web target action that calls `store.proposeMarriage(targetCharacterId)` (built at `store.ts:1504`) and renders the returned `ProposalOutcome` — Accepted, plus prose for every rejection reason (`CrossHouseMarriageNotSupported`, `TargetTooYoung`, already-married, exiled, etc.). **No new rules.**
- **Scandal + generation readout (HIGH).** Add player-house `scandal` to the TopBar with a proximity-to-exile cue (spec §3 L462), plus `generation` / `ancestorSummary`.
- **Elopement Won/Lost outcome surface (HIGH).** Subscribe to `ElopementResolved` and render a win (rep-halve / marriage mint) or loss (+50 scandal) banner before/at overlay unmount.
- **Faux-pas ballroom surfacing (MEDIUM).** Subscribe `BallroomView` to `FauxPasFired`; show a blunder banner + per-portrait mood-lock indicator. Fix the stale `BallroomView.tsx:68` comment.
- **Conversation turn-result readout (MEDIUM).** Surface `affectionDelta` / `synergy` / `moodHint` from `ConversationResolved` (today only `composureDelta` is consumed); add a running affection/standing readout for the selected NPC.

## Out of scope
Any new gameplay rules. Marriage roster / duels history / couriers / happiness readouts (→ P21). v1.5 marriage expansions (→ P23). QoL tabs/sorting/routing (→ P27).

## Cross-cutting impact
UI-only: reads existing `GameState` + existing bus events. **No save-format bump, no hash/projection/selector/overwrite change, no `PERSONA_CACHE_VERSION` bump, no new bus events, no new rules modules.** Follows the P14 "reading-only UI phase bumps nothing" precedent (proposeMarriage already mutates via its existing, tested action). The schema-projection-selector + hashable-state trip-wires and the 30-run replay harness must stay green untouched.

## Verification (definition of done)
- A fresh campaign can propose → accept → conceive → succeed through the UI alone (Playwright golden path).
- Every CRITICAL/HIGH/MEDIUM item in §11.1 has a visible surface, cited.
- All existing Vitest + trip-wire + replay suites pass unchanged. `pnpm lint`/`typecheck`/`knip` clean.

## References
spec §3 (Marriage, Conception & Succession); MASTER §11.1 (CRITICAL/HIGH/MEDIUM); CLAUDE.md proposeMarriage publisher-set pin; P7, P9, P4, P14.
