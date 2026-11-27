# Roles see cases at their own stages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff see a case only when its current stage is one their role works on, plus cases they've worked on (read-only); admins, customers and partner staff unchanged.

**Architecture:** A visibility module works out, per viewer, the (workflow version, state) pairs they work on from every workflow version in use, and turns that plus "worked on" into one SQL condition ANDed with today's scope. Changing a case requires working on its current stage (with a short list of utilities their permissions already confine to their own cases). The case page shows a read-only note.

**Tech Stack:** Node API (`api/_lib`, `api/_handlers`), drizzle-orm SQL, React case page, Vitest (PGlite in memory).

**Spec:** `docs/superpowers/specs/2026-11-27-stage-visibility-design.md`

## Global Constraints

- Stage rule: a viewer works on a stage when it names their role, or names no roles and needs a permission the role has (an action's permission; the offer stage's `offers.record`; a `work: 'terms'` stage `cases.work`; a `work: 'underwriting'` stage `cases.work` or `legal.verify`).
- "Worked on" = `sourcedBy`, `assignedOfficer`, `assignedRm` or `stateAssignee` is them, or they are the actor of any `application_events` row for the case.
- Admins see everything; customers and partner staff keep their rules; scope still narrows first.
- Not visible → 404 (as today), never 403.
- Read-only copy (verbatim): "Read only — this case is at a stage your role doesn’t work on."
- No commits unless the owner asks.

## Review Focus

1. **An agent (scope own) on their own case at a stage they don't work** — still visible, and can still withdraw it / record the customer's acceptance / add a document. Test in Task 1.
2. **A case on an old workflow version** whose stage ids differ — visibility uses that case's own version. Test in Task 1.
3. **A legal officer** — sees Underwriting cases and ones they verified; not Pre-screening/Appraisal cases they never touched (list, counts, dashboard, direct link 404). Test in Task 1.
4. **A role whose permissions change in Team → Roles** — visibility follows on the next request (no stale cache beyond the request). Test in Task 1.
5. **Admin** — unaffected everywhere. Test in Task 1.

---

### Task 1: Server — stage visibility and read-only

**Files:**
- Create: `api/_lib/visibility.js`
- Modify: `api/_lib/workflow.js` (export `worksOnStage`, used by `worksOn`), `api/_lib/applications.js` (`scopeApplications` → async `scopeFor`; `findVisibleApplication(viewer, id, { change = false } = {})`), `api/_handlers/applications.js` (list ~440, export ~785, getApplication), `api/_handlers/dashboard.js` (~32), `api/_handlers/workflow.js`, `api/_handlers/stageDocuments.js` (mutating handlers pass `{ change: true }`), `api/_lib/workflow.js` `workflowView` (adds `readOnly`)
- Test: `tests/stageVisibility.test.js`

**Interfaces:**
- `worksOnStage(viewer, state) → boolean` (api/_lib/workflow.js): today's `worksOn` plus the work-stage permissions in Global Constraints; `worksOn` delegates to it.
- `visibleStagePairs(viewer) → Promise<Array<[version: number, stateId: string]>>` (api/_lib/visibility.js): over every workflow version referenced by applications plus the published one (`getWorkflowVersion`).
- `stageCondition(viewer) → Promise<SQL | undefined>`: `undefined` for admin / customer / partner roles; else `(workflow_version, state) in pairs OR worked-on`.
- `scopeFor(viewer) → Promise<SQL | undefined>` (api/_lib/applications.js) = `and(scopeApplications(viewer), await stageCondition(viewer))`; all three list/count/dashboard callers and `findVisibleApplication` use it.
- `findVisibleApplication(viewer, id, { change: true })` additionally fails 403 `read_only` "This case is at a stage your role doesn’t work on." unless admin or `worksOnStage(viewer, currentState)`.
- Utilities allowed on a visible case without working its stage (their own permission checks still apply): `withdraw`, `record_acceptance`, and `POST /applications/:id/documents` (adding a document). Every other mutating endpoint listed in the spec's "Everywhere" uses `{ change: true }`.
- `workflowView(...).readOnly: boolean` = not admin and not `worksOnStage(viewer, state)`.

- [ ] **Step 1: Write the failing tests** (`tests/stageVisibility.test.js`; setup like `tests/underwriting.test.js`: demo sign-ins for admin, loan_officer, legal_officer, dsa; `submit()`; `toDecision`/`documentVerifier` from tests/helpers.js):
  - Legal officer: a case at Pre-screening it never touched is absent from `GET /applications` and its `statusCounts`, from `GET /dashboard` totals, and `GET /applications/:id` → 404; once the case is at Underwriting it is listed and opens; after the legal officer verifies something and the case moves to Credit decision, it still opens with `workflow.readOnly === true`, and `POST .../actions` / `PUT .../legal/0` → 403 `read_only`.
  - Loan officer: sees its own case at `pending_approval` read-only; doesn't see a colleague's case there.
  - DSA (scope own): its own case at Appraisal is listed; `withdraw` still works on it.
  - Admin sees every case.
  - A case on an old-style published version (copy the setup from tests/loanTermsCase.test.js's old-version test) is visible to the roles that work its stage in that version.
  - Removing `legal.verify` from the legal officer's role (`PATCH /roles/legal_officer`) hides Underwriting cases it never touched on the next request.
- [ ] **Step 2: Run** `npx vitest run tests/stageVisibility.test.js` — expect FAIL.
- [ ] **Step 3: Implement** the module, `scopeFor`, `{ change: true }` on mutating handlers, `readOnly`.
- [ ] **Step 4: Run** the file, then `npx vitest run` — expect PASS. Fix existing tests only where they relied on a role seeing stages it doesn't work (keep their intent; prefer acting as a role that works the stage).

---

### Task 2: Case page — read-only

**Files:**
- Modify: `src/admin/case/CasePage.jsx`
- Test: `npx vite build`, `npx eslint src --ext .js,.jsx`, Playwright render with mocked `GET /api/v1/applications/:id` returning `workflow.readOnly: true`

**Interfaces:**
- Consumes: `workflow.readOnly` (Task 1).
- When `workflow.readOnly`: no action buttons in the header bar (Withdraw / acceptance stay where the viewer's permissions allow them, per Task 1's allowed list), panels that edit (Loan terms, Underwriting, figures, valuation) render read-only, and a muted note under the header with the Global Constraints copy.

- [ ] **Step 1:** Implement; render a read-only and a normal case with mocks; screenshot both at 1280 px; confirm the note and that no edit controls show.
- [ ] **Step 2: Run** `npx eslint src --ext .js,.jsx`, `npx vite build`, `npx vitest run` — 0 errors, build OK, all pass.
