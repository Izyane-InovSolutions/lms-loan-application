# Roles see cases at their own stages — design (short)

Date: 2026-11-27 · Status: draft, for approval

## Why
A role should only see the cases it works on. Today a role's scope (all / team / own / partner) decides visibility, so a legal officer (scope "all") sees every case at every stage, though it only does Underwriting's legal checks.

## What changes
- **Stage rule (approach A, chosen):** on top of its scope, a staff member sees a case when the case's **current stage is one their role works on** in that case's workflow version — the stage names their role, or names no roles and needs a permission the role has (an action's permission; the offer stage's `offers.record`; for a "Sets the loan terms" stage `cases.work`; for an "Underwriting checks" stage `cases.work` or `legal.verify`).
- **Past cases, read-only (owner's decision):** they also keep seeing a case they **have worked on** — they brought it in, it's assigned to them (officer, RM, or taken at a stage), or they appear on its timeline — after it moves on. They can open and read it but can't act on it: the server refuses any change to a case whose current stage they don't work on, and the case page shows no action buttons and a "Read only — this case is at a stage your role doesn't work on" note.
- **Unchanged:** administrators see everything; customers and partner staff keep their own rules; scope still narrows first (an "own" agent still sees only their cases — always including the ones they brought in).
- **Everywhere:** applications list and its counts, pipeline, dashboard, search, CSV export, the case page and its documents (404 when not visible, as today).

## Example (workflow v10)
Legal officer: sees cases at Underwriting, plus ones they've verified (read-only). Loan officer: Pre-screening, Appraisal, Underwriting, Credit decision, plus their own cases at later stages (read-only). Sales manager: as today's stages they work on, plus their team's (scope).

## Approaches considered
- **A. Stages the role works on, from the workflow (chosen):** nothing new to set up; follows workflow changes.
- **B. An explicit stage list per role in Team → Roles:** full control, but another setting to keep in step with the workflow.

## Left to the builder
How the stage rule becomes a database filter (e.g. the visible (version, stage) pairs worked out from the published and in-use workflow versions), the read-only note's look, test layout.
