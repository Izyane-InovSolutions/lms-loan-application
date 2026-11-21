# Pre-approved Partner Loans Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Partner-employee loan products go from submission to partner confirmation, then to an offer issued by an officer, skipping appraisal, review and approval.

**Architecture:**
- A `pre_approval` jsonb column on the application tracks the side track (`partner → issue → issued | review`) while the case stays in the workflow's start state.
- Partner staff (a new `partner` scope) get their own minimal endpoints, never case pages.
- "Issue offer" is a new workflow utility action, `issue_offer`. It enters the offer state through `entryChanges`, so the existing handler post-processing (offer documents, customer email, LMS hand-off) runs unchanged.

**Tech Stack:** Node API handlers, Drizzle and Postgres (memory-backed in tests), React with Tailwind in the admin, and Vitest.

**Spec:** `docs/superpowers/specs/2026-11-20-pre-approved-loans-design.md`

## Global Constraints

- Partner staff see only: applicant name, NRC, amount, tenure, monthly instalment, submitted date, staff-list match and partner decision.
- Pre-approval never declines a case. Every fallback sets `stage: 'review'` and adds a timeline reason.
- Personal-form products only, and `preApproval.partnerId` is required when it is enabled.
- The staff list is never downloadable. The audit log records counts, never NRCs.
- Migration name: `0017_pre_approval.sql`.

## Review Focus

1. **Partner staff opening `/applications/:id` must get a 404.** The test is in Task 4.
2. **A partner user whose `partner_id` is null sees nothing**, rather than every partner's requests. The test is in Task 4.
3. **Issuing twice, or issuing after "Start the review", is refused (409).** The test is in Task 5.
4. **CSV NRC normalisation.** `" 123456/78/9 "` and `123456/78/9` must match, and a header row in any case is accepted. The test is in Task 2.
5. **Refusing as one partner a request that belongs to another partner returns a 404.** The test is in Task 4.

---

### Task 1: Schema, config and settings

**Files:**
- Create: `api/_lib/db/migrations/0017_pre_approval.sql`
- Create: `src/config/partners.js`
- Modify: `api/_lib/db/schema.js`
- Modify: `api/_lib/settings.js`
- Modify: `api/_handlers/settings.js`
- Modify: `src/config/loanProducts.js`
- Modify: `src/config/roles.js`
- Test: `tests/preApproval.test.js`

**Interfaces (produces):**
- **Partner helpers in `src/config/partners.js`:**
  - `normaliseNrc(value) → string`, with whitespace removed.
  - `partnerActive(partner, today = new Date()) → boolean`.
  - `parseStaffCsv(text) → { rows: [{ nrc, employeeNumber, name }], errors: [lineNumber] }`.
- **Settings:** `settings.partners = { list: [] }`.
- **Products:** `product.preApproval = { enabled:false, partnerId:null, maxAmount:null }`.
- **Roles:**
  - Built-in role `partner_staff`.
  - Permissions `partner.confirm` and `offers.issue`.
  - Scope `partner`.
- **Schema:**
  - Table `partner_staff`.
  - `users.partnerId`.
  - `applications.preApproval`.

**Steps:**
- [ ] Write tests:
  - Products: `PUT /settings/products` rejects pre-approval on a business form or with no partner, and accepts a valid one.
  - Partners: `PUT /settings/partners` validates the name, MoU reference and an ISO date.
  - Parser: `parseStaffCsv` normalises NRCs and reports bad lines.
- [ ] Implement. Then run `npx vitest run tests/preApproval.test.js`; the tests should pass.

### Task 2: Staff list upload and NRC lookup

**Files:**
- Create: `api/_handlers/partners.js`, registered in `api/v1/[...path].js`
- Create: `api/_lib/partners.js`
- Test: `tests/preApproval.test.js`

**Interfaces (produces):**
- **Routes** (all need `settings.manage`):
  - `POST /admin/partners/:id/staff`, body `{ csv }` → `{ count, errors }`
  - `GET /admin/partners/:id/staff?nrc=` → `{ found, employeeNumber, name }`
- **Lookup:** `staffMatch(partnerId, nrc) → { onList, employeeNumber, name, listVersion }`.

**Steps:**
- [ ] Write tests:
  - Upload replaces the previous list.
  - Bad rows are listed by line number.
  - An officer gets a 403.
  - The lookup finds a normalised NRC.
- [ ] Implement. The insert and the delete of the old version run in one transaction, and the settings' `staffList` metadata is bumped. Run the tests.

### Task 3: Entering the track on submission

**Files:**
- Create: `api/_lib/preApproval.js`
- Modify: `api/_handlers/applications.js`, the afterResponse block after `autoPullCreditReport`
- Test: `tests/preApproval.test.js`

**Interfaces (produces):** `enterPreApproval(applicationId) → application | null`.

**Steps:**
- [ ] Write tests:
  - A pre-approved product with a partner whose MoU is in date sets `preApproval.stage === 'partner'` and records `staffMatch`.
  - A lapsed MoU sets stage `review` and adds the reason event.
  - An amount over `maxAmount` sets `review`.
  - A product that isn't pre-approved leaves `preApproval` null.
- [ ] Implement. The update is guarded by the case version and the start state. Partner users are notified (`notifyUsers`, users with `partner_id` set and the `partner.confirm` permission). Run the tests.

### Task 4: Partner scope and the partner requests endpoints

**Files:**
- Modify: `api/_lib/applications.js` (scope `partner` → `sql\`false\``)
- Modify: `api/_lib/drafts.js` (the same)
- Modify: `api/_lib/roles.js` (`SCOPE_RANK`)
- Modify: `api/_handlers/users.js` (`partnerId` on invite and update; required for a partner-scope role)
- Modify: `api/_handlers/partners.js`
- Test: `tests/preApproval.test.js`

**Interfaces (produces):**
- `GET /partner/requests?view=pending|recent` → `{ requests: [{ id, reference, applicantName, nrc, amount, tenure, monthlyInstalment, submittedAt, staffMatch, partnerDecision, stage, partnerName }] }`
- `POST /partner/requests/:id`, body `{ decision: 'confirm'|'refuse', note, employeeNumber, version }`

**Steps:**
- [ ] Write tests:
  - A partner user sees only their own partner's requests.
  - A partner user gets a 404 on `/applications/:id`.
  - A partner user with a null partner sees none.
  - Confirm moves the stage to `issue`.
  - Refuse needs a note, moves the stage to `review` and adds a timeline event.
  - Acting on another partner's request gives a 404.
- [ ] Implement. Admins (scope `all`) see every partner's requests. Run the tests.

### Task 5: Issuing the offer and leaving the track

**Files:**
- Modify: `api/_lib/workflow.js`:
  - add the UTILITY actions `issue_offer` and `leave_pre_approval`
  - make start_review drop the track
  - add `preApproval` to `workflowView`
- Modify: `api/_handlers/workflow.js`, if the post-processing needs `result.approved`
- Test: `tests/preApproval.test.js`

**Interfaces (produces):**
- **`issue_offer`:** input `{ amount?, tenure?, version }`. It returns hints `{ approved:true, notify, handToLms, enteredOffer }`, like an approval.
- **`leave_pre_approval`:** input `{ rationale, version }`.

**Steps:**
- [ ] Write tests:
  - Issue before the partner confirms → 409.
  - Prescreen outcome `decline` → 409.
  - The issuer is the case's `sourcedBy` → 403.
  - An amount over `maxAmount` → 400.
  - The happy path: the case reaches the offer state, with `offerExpiresAt` set, `approvedAmount`, a decision appraisal, stage `issued`, and a customer notification.
  - Issuing twice → 409.
  - `leave_pre_approval` → stage `review`.
  - start_review on a case in the track → stage `review`.
- [ ] Implement. The offer target is the first `approve` action in the definition whose resolved target is an offer state. The action requires the `offers.issue` permission. Run the full suite.

### Task 6: Admin screens

**Files:**
- Create: `src/admin/pages/PartnersTab.jsx`
- Create: `src/admin/pages/PartnerRequestsPage.jsx`
- Create: `src/admin/case/PreApprovalPanel.jsx`
- Modify:
  - `src/admin/pages/SettingsPage.jsx` (the Partners tab)
  - `src/admin/pages/ProductsTab.jsx` (the Pre-approval section)
  - `src/admin/pages/UsersPage.jsx` (the partner select)
  - `src/admin/navigation.js` and `src/admin/AdminApp.jsx` (the route; partner staff land on Partner requests)
  - `src/admin/case/CasePage.jsx` (the badge and the panel)

**Steps:**
- [ ] Build each screen as the spec describes, then run `npx vite build`; it should succeed.
- [ ] Run `npx vitest run`; the full suite should pass.

### Task 7: Docs

- [ ] Add a pre-approval stage, the partner settings and the scenarios to `docs/SYSTEM-WALKTHROUGH.md`, and a README line.
