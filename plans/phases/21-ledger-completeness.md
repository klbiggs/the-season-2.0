# P21 — Ledger Completeness & Notifications (v1.1 hardening)

> **Status: 📋 planned (skeleton).** Track: v1.1 (UI-correctness, no new gameplay rules). Source: [MASTER.md §11.1](../MASTER.md#111-ui-surfacing-gaps-v1-fix-candidates) + [§11.3](../MASTER.md#113-plan--doc-inconsistencies).
> Gives every persisted subsystem a readout and bridges async outcomes into the core loop. Closes the remaining §11.1 gaps after P20.

## Depends on
P14 (ledger), P20 (core-loop surfaces land first).

## Goal
Every persisted `GameState` subsystem identified in the §11 audit has a ledger/HUD readout, and tick-later outcomes (scheme resolution, etc.) reach the player without forcing a ledger dig.

## In scope
- **Duels history (HIGH).** Render `state.duels` (casualties, win/loss, grievance resolved) — new section or tab; today only the just-resolved outcome flashes from React-local state (`GrievancesTab.tsx:33,57`).
- **Marriages roster (HIGH).** Render `state.marriages` (spouses, dissolved, `viaElopement`).
- **Couriers readout (MEDIUM).** In-flight whisper couriers + interception state (makes Spymaster intercept legible).
- **Character happiness / composure / temptation-latch (MEDIUM)** in `FamilyTreeTab` — exposes the Dull-spouse → temptation flow.
- **Scheme-outcome notifications (MEDIUM).** Toast/banner on `SchemeCompleted` / `SchemeFailed` / `SeductionDiscovered`.
- **LOW items.** Scheme-launch rejection toasts (replace the `console.warn` at `SchemeButtons.tsx:87`); enter-ballroom rejection surface (`SessionAlreadyOpen` race); `proposalsLog` / `tutorAssignmentsLog` history rendering.
- **§11.3 doc fixes.** Stale `SpymasterInterceptCard` "disabled until P7" comment; stale `BallroomView.tsx:68` faux-pas comment (if not fixed in P20); reconcile the P14↔P16 portraits contradiction note; correct the P13 `MilitaryOfficer` "inert" note.

## Out of scope
New gameplay rules. The Society/Ton view (→ P22). QoL: tabs library / sorting / URL routing / event-log subsystem (→ P27).

## Cross-cutting impact
UI-only: reads existing `GameState` + existing buses. **No save-format bump, no hash/projection change, no new bus events.** Trip-wires + replay harness stay green untouched.

## Verification (definition of done)
- Every "Not-surfaced / Partial" subsystem in the §11 ledger audit (duels, marriages, couriers, happiness/composure/temptation, proposals/tutor logs) has a readout, cited.
- The four §11.3 doc inconsistencies are resolved in code/plan.
- All existing suites pass unchanged; `pnpm lint`/`typecheck`/`knip` clean.

## References
MASTER §11.1 (remaining HIGH/MEDIUM/LOW) + §11.3; P14, P20.
