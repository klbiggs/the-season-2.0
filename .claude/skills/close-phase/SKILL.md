---
name: close-phase
description: Close out a phase of plans/MASTER.md. Runs pnpm test/lint/typecheck, walks the phase subplan's §Verification list, updates the phase status in MASTER.md §6 (adds a Status column on first run), appends a section to plans/SESSION-NOTES.md, resolves any open questions answered during the work, applies any CLAUDE.md additions, and commits the changes (no push). Use when wrapping up work on P0–P18, or when the user says "close out", "wrap up phase X", or "finish phase X".
argument-hint: [phase-number]
allowed-tools: Bash(pnpm test*) Bash(pnpm lint*) Bash(pnpm typecheck*) Bash(git status*) Bash(git diff*) Bash(git log*) Bash(git add*) Bash(git commit*)
---

# Close Phase

Closing out work on phase **$ARGUMENTS** of `plans/MASTER.md`. Follow the 8 steps below in order. Surface gaps and failures explicitly — don't claim done-ness on items you didn't exercise.

## Step 1 — Confirm the active phase

- Read `plans/MASTER.md` §6 (Phase Index) and the matching subplan at `plans/phases/NN-name.md`.
- If `$ARGUMENTS` is empty: infer from the git branch name or recent commits. If still ambiguous, ask the user.
- If multiple phases are in flight, ask which one to close.
- Anchor on the phase's **In scope** / **Out of scope** lists before evaluating anything else. Work that bled across phase boundaries is itself a finding to surface.

## Step 2 — Run the gate commands

Run all three in parallel. Report each result distinctly. Do NOT mask failures.

```!
pnpm test
pnpm lint
pnpm typecheck
```

If any fail, **stop here**. Fixing the failure is part of the closeout, not an after-the-fact cleanup. Report the failure with file:line references and wait for direction.

## Step 3 — Walk the phase's §Verification list

Re-read the subplan's `**Verification.**` paragraph. For each item, confirm it was actually exercised in this session or in tests that ran clean:

- Vitest suites for the phase's pure modules → passing AND at expected coverage on `src/game/rules/**`.
- Determinism replay assertions → 30-run identical-hash invariant where the phase touches it.
- UI golden path (UI-touching phases) → exercised in a browser. If you can't verify, say so — don't claim success.
- Save-migration round-trip (schema-touching phases) → an old-version fixture loads, migrates, and matches expected state.
- LLM failure paths (LLM-touching phases) → all four (timeout, network, schema, missing key) covered by tests per `CLAUDE.md` §LLM integration specifics.

Output one line per Verification item: ✅ exercised / ❌ failed / ⚠ not exercised.

## Step 4 — Update phase status in MASTER.md §6

The Phase Index table currently has columns `# | Phase | Subplan | Depends on`. On the first close ever, add a **Status** column (values: `—` not started, `🚧 in progress`, `✅ done`). Update only the active phase row to `✅ done`. Keep the diff minimal — don't reflow unrelated rows or restyle the table.

If any Verification item from Step 3 came back ❌ or ⚠, do NOT mark the phase done. Use `🚧 in progress` and record the blocker in Step 5.

## Step 5 — Append to `plans/SESSION-NOTES.md`

Create the file on first close (with a top-level `# The Season — Session Notes` header). Append one section per closeout. Skip empty subsections rather than leave them blank:

```markdown
## $PHASE — closed YYYY-MM-DD

**Decisions made:**
- …

**Open questions hit:**
- …

**Deferred / next-up:**
- …

**Files of note:**
- src/path/to/file.ts:LN
```

Use today's date in `YYYY-MM-DD` from the current date in context.

## Step 6 — Resolve open questions in the subplan

Re-read the phase subplan's `**Open questions (§10).**` block. For each OQ:

- **Resolved during the work** → edit the subplan: replace `Default: X` with `Resolved: X — <one-line rationale>`. Also update the corresponding row in `plans/MASTER.md` §10 (change the Default column to `Resolved: X`).
- **Deferred unchanged** → leave as-is.
- **New OQ emerged that wasn't in §10** → surface it to the user and offer to add it to the phase's OQ block AND `plans/MASTER.md` §10 with a recommended default.

## Step 7 — Apply CLAUDE.md additions

If any new convention, invariant, or recurring trip-hazard emerged that future sessions need, edit `CLAUDE.md` directly to add it. Show the diff in your output for transparency, but do not wait for approval — apply the edit in this step. Things that belong here:

- A new "always do X" / "never do Y" rule discovered the hard way.
- A new file location or naming convention adopted during this phase.
- A new verification command added to the gate list.

Things that do NOT belong in CLAUDE.md (and should stay in subplans or SESSION-NOTES):

- Phase-specific implementation details.
- One-off decisions that don't apply across phases.

If nothing qualifies, skip the edit — report `CLAUDE.md: <none>` in the summary.

## Step 8 — Commit changes (do not push)

Run `git status` and `git diff --stat`. If there are uncommitted changes from this phase plus the closeout edits above, draft a commit message in the project's style and create the commit.

Use specific paths with `git add` (never `-A` / `-u` / `.`). The closeout-edit paths are predictable: `plans/MASTER.md`, `plans/SESSION-NOTES.md`, the active phase subplan, `CLAUDE.md` (if Step 7 applied an edit). Combine with the phase's source/test changes shown in `git status`.

Pass the commit message via HEREDOC. Include the trailer:

```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

Do NOT push. Do NOT amend. If a pre-commit hook fails, fix the issue and create a new commit — do not bypass with `--no-verify`.

Skip this step entirely if `git status` is clean.

## Final output

End with a single-screen summary block. Format:

```
Phase $PHASE closeout summary
─────────────────────────────
Gates:           ✅ test  ✅ lint  ✅ typecheck
Verification:    N/N exercised (or list failures)
MASTER.md:       Status → ✅ done   [or 🚧 in progress: <blocker>]
SESSION-NOTES:   appended (N lines)
Open questions:  N resolved / N deferred / N new
CLAUDE.md:       <none> | <N additions applied>
Commit:          <none> | <sha> <subject>
```
