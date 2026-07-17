---
name: open-phase
description: Open a phase of plans/MASTER.md and drive it to done. Reads the phase subplan plus the spec sections it references, checks dependencies, marks the phase in-progress in MASTER.md §6, resolves the subplan's open questions (surfacing §10 items instead of silently picking different defaults), fleshes a skeleton subplan into a full implementation plan, runs /planning:converge-plan on it, commits the converged plan, then implements end-to-end until pnpm test/lint/typecheck/knip are green. Use when starting work on a phase, or when the user says "open phase N", "start phase N", or "work phase N".
argument-hint: [phase-number | phase-file]
---

# Open Phase

Opening phase **$ARGUMENTS** of `plans/MASTER.md` and carrying it from subplan to a green gate.
Follow the 8 steps in order, run from the repo root (or the active worktree).

**Plan conventions (The Season).** Master = `plans/MASTER.md` (§6 Phase Index, §10 open questions,
§11.2 v1.5 backlog); phases = `plans/phases/NN-name.md` (resolve a bare number by globbing
`plans/phases/<N>*.md` — mind lettered sub-phases like `24a-`). Authority order when documents
disagree: `greenfield-spec.md` (WHAT/WHY) wins over subplan and code — EXCEPT where an open question
has been resolved in writing: a CLAUDE.md supersession pin or a `Resolved:` entry in MASTER §10 wins
over stale spec/subplan text. open-phase carries the phase up to implementation and a green gate;
the final phase commit, Verification walk, and §6 status flip to ✅ are `/close-phase`'s job.

## Step 1 — Resolve the target phase

Parse `$ARGUMENTS`: a phase number (e.g. `25`) or a phase-file path. A number resolves via glob
`plans/phases/<N>*.md`. If empty, infer from the branch/worktree name or recent commits; if still
ambiguous, ask the user. Then read in full before editing anything: the subplan; MASTER §6 and §10;
the §11.2 backlog rows the subplan cites (v1.5 phases); the `greenfield-spec.md` sections and the
CLAUDE.md pins named in the subplan's References line.

## Step 2 — Dependency check

Compare the subplan's "Depends on" list against the §6 Phase Index Status column. If a prerequisite
phase is not `✅ done`, warn the user and ask whether to proceed before continuing.

## Step 3 — Mark in-progress

In the §6 Phase Index table, add a **Status** column if absent (`—` · `🚧 in progress` · `✅ done`),
then set this phase's row to `🚧 in progress`. Edit only the active row; keep the diff minimal — do
not reflow other rows or restyle the table.

## Step 4 — Resolve open questions

Read the subplan's open-question/risk items and every MASTER §10 question it references (e.g. "Q14").
Per CLAUDE.md, never silently pick a different default than the one §10 lists. For each:

- §10 lists a recommended default and nothing in the subplan or spec contradicts it → adopt it and
  record `Resolved: … — <one-line rationale>` in the subplan (and update the §10 row).
- Genuinely open, contradicted, or contract-level (touches save schema, determinism, RNG draw
  budgets, or a cross-phase interface) → batch ALL such items into ONE `AskUserQuestion` and write
  each answer into the subplan (and §10). Do not auto-decide a contract-level gap.

## Step 5 — Flesh the subplan into a full plan

v1.5 subplans ship as scoped skeletons (`Status: 📋 planned (skeleton)` — Goal / In scope / Out of
scope / Cross-cutting impact / Verification). Expand in place into a concrete, buildable plan:
per-file steps, described function-level changes, edge cases, and exact test assertions — conforming
to the referenced spec sections, the CLAUDE.md pins (quad-sync, hashable-state, rivals-run-last,
publisher-set recount, PERSONA_CACHE_VERSION, migration posture), and the phase's In scope / Out of
scope lists (**Out of scope is binding** — anything that feels missing is owned by another phase).
Update the subplan's `Status:` line to reflect it is now fleshed/in progress.

## Step 6 — Converge the plan, then commit it

Invoke `/planning:converge-plan <phase-file-path>` and let it run to convergence. It edits the phase
file in place and then applies a post-convergence Advisory-Triage pass that writes more `[applied]`
edits — both are part of the converged result; apply its recommended fixes.

**Compatibility fallback:** if the installed converge-plan only accepts a basename under
`~/.claude/plans/`, stage a copy at `~/.claude/plans/<basename>.md` (abort if a *different* plan of
that basename already lives there), converge there, then sync the converged file back to the repo
path only after convergence AND triage finish — the converged copy wins; remove the staged copy only
after a verified byte-for-byte sync-back.

Then commit the plan edits (subplan + MASTER.md) in the project's precedent style —
`PNN: converge plan (<short slug>) — fold load-bearing items into body` — using specific paths with
`git add` (never `-A`/`.`). No push. No trailer.

## Step 7 — Implement (auto)

Execute the converged plan: create/modify exactly the files it names. Run the gate iteratively until
green: `pnpm test` (including the 30-run replay harness where determinism is touched), `pnpm lint`,
`pnpm typecheck`, `pnpm knip`. Commit at natural checkpoints in the `PNN (WIP): <slice>` precedent
style (specific paths, no push, no trailer). Route any newly-discovered contract-level ambiguity to
`AskUserQuestion` rather than guessing. For UI-touching slices, exercise the golden path in a
browser — if you cannot, say so explicitly rather than claiming success.

## Step 8 — Summary + handoff

Report: phase opened; open questions resolved (and how); files created/changed; the convergence
stats from converge-plan's completion block; and the gate status. Recommend `/close-phase <N>` to
walk §Verification, flip the §6 status, append SESSION-NOTES, and make the final commit — open-phase
leaves the phase `🚧 in progress`.
