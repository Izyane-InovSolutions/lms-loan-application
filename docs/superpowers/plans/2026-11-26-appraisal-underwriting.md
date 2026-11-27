# Appraisal sets the terms, Underwriting verifies — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Loan appraisal sets each loan's final terms (amount, tenure, frequency, rate, method, effective date, charges, schedule); Underwriting verifies assets (valuation + legal) and the loan's documents; each stage's Approve only moves on, and the credit decision stays configured in the workflow.

**Architecture:** A pure terms engine (`src/config/loanTerms.js`) shared by browser and server; a workflow state setting `work: 'terms' | 'underwriting'` that the engine holds Approve on; completeness rules for underwriting in a pure module (`src/config/underwriting.js`); new jsonb `applications.terms`; the case page gets Loan terms and Underwriting tabs. Terms flow into the decision, the offer letter and the LMS hand-off.

**Tech Stack:** React 18 + Tailwind (shadcn-style `@/components/ui`), Node API handlers (`api/_handlers`, `api/_lib`), drizzle-orm on Postgres / PGlite, Vitest (PGlite in memory, `tests/helpers.js` clients).

**Spec:** `docs/superpowers/specs/2026-11-26-appraisal-underwriting-design.md`

## Global Constraints

- The case page keeps its tabs and action bar; no full-screen workspace, stepper or journey sidebar.
- Interest rate is **% per year, 0.1–300**; the default keeps today's price at the requested tenure (basis `month` → rate × 12; basis `loan` → rate × 12 ÷ requested tenure).
- Frequencies: monthly (default), fortnightly, weekly, quarterly. Calculations: flat (default), reducing balance. Interest type: fixed / variable (label only).
- **Charges are paid upfront**: net disbursed = approved amount − charges, must be > 0; charges are never added to instalments.
- **Terms are locked after Appraisal**: decision dialogs show them read-only and take no amount/tenure; changing them means sending the case back to Appraisal.
- `approvedAmount / approvedTenure / monthlyInstalment / totalRepayable` are written only at an approve decision; until then the terms are "Proposed".
- Open cases on older workflow versions (`appraisal: true`, no `work`) behave exactly as today.
- Migrations are hand-written (installed drizzle-kit 0.18 can't generate): SQL file + `meta/_journal.json` entry + `meta/00NN_snapshot.json` (copy the previous snapshot, add the column, new `id`, `prevId` = previous `id`).
- Audit every save (action, case reference, counts; never document contents).
- Commit only when the user asks; tasks end with a passing test run instead of a commit unless told otherwise.

## Review Focus

1. **Weekly / fortnightly periods on short tenures** (e.g. 1 month weekly = 4.33 periods) — periods round to a whole number ≥ 1 and the schedule still sums to the total repayable. Test in Task 1.
2. **Charges that eat the loan** (charges ≥ approved amount, or a 100% charge) — refused with "Charges can't be the whole loan" (net disbursed must be > 0). Test in Task 1.
3. **A case sent back from Underwriting to Appraisal** — saved terms stay, Appraisal's Approve works again, and Underwriting's completeness isn't lost. Test in Task 3.
4. **Cases on an older workflow version** (`appraisal: true`) — valuation hold, checklist and decision amounts behave as today. Test in Task 3 and Task 4.
5. **A re-uploaded required document** (new copy via "Ask the applicant") — its verification is gone and Underwriting's Approve is held again. Test in Task 5.

---

### Task 1: Terms engine

**Files:**
- Create: `src/config/loanTerms.js`
- Test: `tests/loanTerms.test.js`

**Interfaces:**
- Produces (all pure, browser + server):
  - `FREQUENCIES: { monthly: { label: 'Monthly', perYear: 12 }, fortnightly: { label: 'Fortnightly', perYear: 26 }, weekly: { label: 'Weekly', perYear: 52 }, quarterly: { label: 'Quarterly', perYear: 4 } }`
  - `CALCULATIONS: { flat: 'Flat', reducing: 'Reducing balance' }`
  - `INTEREST_TYPES` re-exported from `loanProducts.js`
  - `CHARGE_NAMES: ['Processing fee', 'VAT', 'Insurance', 'Legal fee', 'Valuation fee']`
  - `defaultTerms(product, application, today = new Date()) → Terms` where `Terms = { amount, tenure, frequency, annualRate /* percent */, interestType, calculation, effectiveDate /* 'YYYY-MM-DD' */, charges: [{ name, type: 'fixed' | 'percent', value /* K or percent */ }] }`. The product's facility fee becomes the first charge `{ name: 'Facility fee', type: product.facilityFeeType, value: fixed K, or product.facilityFee × 100 for percent }`.
  - `checkTerms(input, product) → { terms: Terms, errors: { [field]: message } }` (`errors` empty = valid; numbers coerced; charges with blank names dropped).
  - `periodsFor(tenure, frequency) → integer ≥ 1` = `Math.max(1, Math.round(tenure × perYear ÷ 12))`.
  - `chargeAmount(charge, amount) → number` (2 dp).
  - `scheduleFor(terms, start = terms.effectiveDate) → [{ number, due: 'YYYY-MM-DD', instalment, principal, interest, balance }]`. Due dates: monthly +1 month per row, quarterly +3, fortnightly +14 days, weekly +7, first row one period after `start`.
  - `summarizeTerms(terms) → { periods, instalment, totalInterest, totalCharges, totalRepayable, netDisbursed, firstDue, lastDue }` (`totalRepayable` = amount + interest; charges excluded).

- [ ] **Step 1: Write the failing tests** in `tests/loanTerms.test.js`:

```js
const product = { minAmount: 500, maxAmount: 100000, minTenure: 1, maxTenure: 24, interestRate: 0.1, interestBasis: 'loan', facilityFee: 175, facilityFeeType: 'fixed', interestType: 'fixed' }
it('defaults keep today’s price at the requested tenure', () => {
  const terms = defaultTerms(product, { amount: 10000, tenure: 6 }, new Date('2026-11-26T12:00:00'))
  expect(terms).toMatchObject({ amount: 10000, tenure: 6, frequency: 'monthly', annualRate: 20, calculation: 'flat', effectiveDate: '2026-11-26', charges: [{ name: 'Facility fee', type: 'fixed', value: 175 }] })
  expect(summarizeTerms(terms).totalInterest).toBe(1000) // == priceLoan interest today
  expect(defaultTerms({ ...product, interestRate: 0.04, interestBasis: 'month' }, { amount: 10000, tenure: 6 }).annualRate).toBe(48)
})
it('flat: equal instalments, the last absorbs rounding', () => {
  const s = summarizeTerms({ amount: 10000, tenure: 12, frequency: 'monthly', annualRate: 24, calculation: 'flat', effectiveDate: '2026-01-15', charges: [] })
  expect(s).toMatchObject({ periods: 12, instalment: 1033.33, totalInterest: 2400, totalRepayable: 12400, firstDue: '2026-02-15', lastDue: '2027-01-15' })
  const rows = scheduleFor({ amount: 10000, tenure: 12, frequency: 'monthly', annualRate: 24, calculation: 'flat', effectiveDate: '2026-01-15', charges: [] })
  expect(rows.at(-1)).toMatchObject({ instalment: 1033.37, balance: 0 })
})
it('reducing balance: annuity instalment, interest on the balance', () => {
  const rows = scheduleFor({ amount: 10000, tenure: 12, frequency: 'monthly', annualRate: 24, calculation: 'reducing', effectiveDate: '2026-01-15', charges: [] })
  expect(rows[0]).toMatchObject({ instalment: 945.6, interest: 200, principal: 745.6 })
  expect(rows.at(-1).balance).toBe(0)
  expect(summarizeTerms({ amount: 10000, tenure: 12, frequency: 'monthly', annualRate: 24, calculation: 'reducing', effectiveDate: '2026-01-15', charges: [] }).totalInterest).toBeCloseTo(1347.15, 0)
})
it('weekly on a short tenure rounds to whole periods and still adds up', () => {
  const terms = { amount: 1000, tenure: 1, frequency: 'weekly', annualRate: 52, calculation: 'flat', effectiveDate: '2026-01-01', charges: [] }
  const rows = scheduleFor(terms)
  expect(rows).toHaveLength(4)
  expect(rows[0].due).toBe('2026-01-08')
  expect(rows.reduce((sum, row) => sum + row.instalment, 0)).toBeCloseTo(summarizeTerms(terms).totalRepayable, 2)
})
it('charges come off the payout', () => {
  const s = summarizeTerms({ amount: 350000, tenure: 12, frequency: 'monthly', annualRate: 24, calculation: 'flat', effectiveDate: '2026-01-15', charges: [{ name: 'Processing fee', type: 'percent', value: 2 }] })
  expect(s).toMatchObject({ totalCharges: 7000, netDisbursed: 343000 })
})
it('refuses terms out of range, charges that eat the loan, and a missing date', () => {
  const base = defaultTerms(product, { amount: 10000, tenure: 6 })
  expect(checkTerms({ ...base, annualRate: 0 }, product).errors.annualRate).toMatch(/0\.1% and 300%/)
  expect(checkTerms({ ...base, annualRate: 301 }, product).errors.annualRate).toBeTruthy()
  expect(checkTerms({ ...base, amount: 200 }, product).errors.amount).toMatch(/K500 and K100,000/)
  expect(checkTerms({ ...base, tenure: 30 }, product).errors.tenure).toMatch(/1 and 24 months/)
  expect(checkTerms({ ...base, charges: [{ name: 'Insurance', type: 'percent', value: 100 }] }, product).errors.charges).toMatch(/can’t be the whole loan/)
  expect(checkTerms({ ...base, effectiveDate: '' }, product).errors.effectiveDate).toBeTruthy()
  expect(checkTerms({ ...base, frequency: 'daily' }, product).errors.frequency).toBeTruthy()
  expect(checkTerms(base, product).errors).toEqual({})
})
```

- [ ] **Step 2: Run** `npx vitest run tests/loanTerms.test.js` — expect FAIL (module not found).
- [ ] **Step 3: Implement** `src/config/loanTerms.js` with the interfaces above. Rounding to 2 dp per row; flat instalment = round2((amount + interest) ÷ periods), last row = remainder; reducing instalment = round2(P·r ÷ (1 − (1 + r)^−n)), r = annualRate ÷ 100 ÷ perYear, each row interest = round2(balance × r), last row clears the balance. Flat total interest = amount × annualRate/100 × tenure/12. Date arithmetic on `YYYY-MM-DD` strings in UTC (no time-zone drift); month addition clamps to the month's last day.
- [ ] **Step 4: Run** `npx vitest run tests/loanTerms.test.js` — expect PASS.

---

### Task 2: Terms on the case (storage, saving, holds)

**Files:**
- Create: `api/_lib/db/migrations/0021_loan_terms.sql` (`ALTER TABLE "applications" ADD COLUMN "terms" jsonb;`), `meta/0021_snapshot.json`, journal entry `0021_loan_terms`
- Modify: `api/_handlers/workflowConfig.js` (`sanitizeWorkflow` keeps `work` when it is `'terms'` or `'underwriting'`, drops anything else — needed here so tests can publish a terms stage; Task 3 builds on it), `api/_lib/db/schema.js` (applications: `terms: jsonb('terms')`), `api/_lib/workflow.js` (utility action `save_terms`; hold on leaving a `work: 'terms'` state; `workflowView.state.work`, `state.termsHold`), `api/_handlers/applications.js` (case response unchanged shape: `application.terms` comes with the row), `src/admin/pages/AuditPage.jsx` (`'application.save_terms': 'Saved the loan terms'`)
- Test: `tests/loanTermsCase.test.js`

**Interfaces:**
- Consumes: `checkTerms`, `summarizeTerms`, `defaultTerms` (Task 1).
- Produces:
  - `applications.terms` = `{ ...Terms, summary: summarizeTerms(terms), savedBy, savedByName, savedAt }`.
  - Utility action `POST /applications/:id/actions { action: 'save_terms', version, terms }` — `requireCase(viewer, 'cases.work')`, case owner rules as other utilities, only while the case's state has `work === 'terms'` (else 409 `invalid_state` "The loan terms are set at the appraisal stage."); invalid → 400 `invalid_terms` with `errors` in the body. Event "Loan terms saved: K… over … months, …% a year (flat|reducing balance), … instalments of K…". Audit `application.save_terms` `{ reference, amount, tenure }`.
  - `termsHold(application) → string | null` in `src/config/loanTerms.js`: null when `application.terms` is saved and valid for the product, else `"the loan terms"`.
  - In `applyAction` (api/_lib/workflow.js), a forward non-reject action out of a state with `work === 'terms'` fails 409 `terms_incomplete` "Moving on waits for the loan terms." when `termsHold` is non-null; `blockedReason` returns `"Moves on once the loan terms are saved."` for that move.

- [ ] **Step 1: Write the failing tests** (`tests/loanTermsCase.test.js`, setup as `tests/workflowEditor.test.js`: memory kv, admin + loan_officer demo clients, `submit()` helper; publish a workflow whose `appraisal` state has `work: 'terms'` (and no `appraisal` flag) via `PUT /admin/workflow/draft` + `POST /admin/workflow/publish`):
  - Saving a draft with `work: 'terms'` keeps it; `work: 'other'` is dropped.
  - `save_terms` outside the terms stage → 409 `invalid_state`.
  - At the terms stage: invalid terms → 400 `invalid_terms` with `errors.annualRate`; valid → 200, `application.terms.summary.instalment` set, timeline has "Loan terms saved".
  - The stage's move before saving → 409 `terms_incomplete`; after saving → 200.
  - `application.approvedAmount` is still null after leaving Appraisal.
- [ ] **Step 2: Run** `npx vitest run tests/loanTermsCase.test.js` — expect FAIL.
- [ ] **Step 3: Implement** the migration, schema column, `termsHold`, `save_terms` and the hold.
- [ ] **Step 4: Run** the test file and `npx vitest run` — expect PASS, no regressions.

---

### Task 3: Stage roles in the workflow and the new default graph

**Files:**
- Modify: `src/config/workflow.js` (`legacyToWorkflow`, `validateWorkflow`, `STAGE_WORK = { terms: 'Sets the loan terms', underwriting: 'Underwriting checks' }`), `src/config/stages.js` (`DEFAULT_CHECKLIST`: identity, documents, income `requiredToApprove: false`), `src/admin/workflow/StateDrawer.jsx` (a "What this stage does" select: None / Sets the loan terms / Underwriting checks, under Options; the "Collateral appraisal" toggle shown only when the state already has `appraisal: true`), `DEFAULT_STAGE_NAMES` (add `decision: 'Credit decision'`)
- Test: `tests/workflowEngine.test.js` (extend), `tests/workflowEditor.test.js` (extend)

**Interfaces:**
- Produces:
  - State field `work?: 'terms' | 'underwriting'`.
  - Default graph: `submitted` → `appraisal` (`work: 'terms'`, no `appraisal` flag, action `{ id: 'appraised', label: 'Approve', kind: 'move', to: review[0]?.id || 'in_review', permission: 'cases.work' }`) → review sub-stages → `in_review` (label = Underwriting name, `work: 'underwriting'`, action `{ id: 'underwritten', label: 'Approve', kind: 'move', to: 'decision', permission: 'cases.work' }`) → `decision` (label `'Credit decision'`, `legacyStatus: 'in_review'`, `askApplicant: true`, holding today's `in_review` actions: recommend or approve/reject singleStep, with `options.checks: requiredToApprove`) → `pending_approval` (its Send back stays `to: 'in_review'`).
  - `validateWorkflow` errors: two states with the same `work` that can both apply to one loan type → "Only one stage can set the loan terms." / "Only one stage can do the underwriting checks."; a `terms` state reachable only after an approve/recommend action → "The loan terms must be set before the credit decision."
- Consumes: Task 2's hold (for `terms`); Task 5 adds the `underwriting` hold.

- [ ] **Step 1: Write the failing tests**:
  - `legacyToWorkflow({})`: `appraisal` has `work: 'terms'` and no `appraisal` flag; `in_review` has `work: 'underwriting'` and a single move labelled Approve to `decision`; `decision` holds `recommend`; with `workflow.requireSecondApproval: false`, `decision` holds approve/reject with `singleStep`.
  - An unsecured case passes through Appraisal? **No**: `resolveState(def, 'appraisal', { form: 'personal', collateral: false }).id === 'appraisal'`.
  - `legacyStateOf` for a case with status `in_review` → `'in_review'` (Underwriting), not `decision`.
  - `validateWorkflow` with two `work: 'terms'` states → the error above.
  - Review Focus 3: submit → start review → save terms → Approve to Underwriting → `pending_approval`'s Send back (or an added return from `in_review` to `appraisal`) back to Appraisal → `application.terms` still present → Approve again → 200.
  - Review Focus 4: a published version whose appraisal state has `appraisal: true` (no `work`) still holds on valuation and skips unsecured loans as today.
- [ ] **Step 2: Run** `npx vitest run tests/workflowEngine.test.js tests/workflowEditor.test.js` — expect FAIL.
- [ ] **Step 3: Implement** the graph, validation, sanitizer, checklist defaults, the editor select, and update `withCurrentStageNames` so a legacy-managed workflow is regenerated with the new graph (cases at `in_review` stay at `in_review`).
- [ ] **Step 4: Run** the two files, then `npx vitest run` — expect PASS. Fix existing tests that assumed `in_review` holds `recommend` (they now act at `decision`; add a helper that moves a case through Appraisal and Underwriting).

---

### Task 4: The decision uses the appraised terms

**Files:**
- Modify: `api/_lib/workflow.js` (`terms()`, recommend branch, `decision()`), `src/admin/case/CasePage.jsx` (decide/recommend dialogs: a read-only terms summary in `before`, no amount/tenure)
- Test: `tests/loanTermsCase.test.js` (extend)

**Interfaces:**
- Consumes: `application.terms` (Task 2), `summarizeTerms` (Task 1).
- Produces: when `application.terms` exists, `terms(application, input, settings)` returns `{ amount: terms.amount, tenure: terms.tenure }` and ignores `input.amount/tenure`; at approve, `changes` also set `monthlyInstalment = summary.instalment`, `totalRepayable = summary.totalRepayable`; the approver band check uses the terms amount. Without `application.terms`, behaviour is unchanged (older versions).

- [ ] **Step 1: Write the failing tests**: after terms (K12,000, 12 months, 24%, reducing) and Underwriting, recommend approve with `amount: 5000` → the recommendation row's amount is 12000; approve → `approvedAmount 12000`, `approvedTenure 12`, `monthlyInstalment` = `summarizeTerms(terms).instalment`, `totalRepayable` = its total; a decline leaves `approvedAmount` null; a case on an `appraisal: true` version still takes `amount` from the dialog input as today (Review Focus 4).
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** in `api/_lib/workflow.js`; in `CasePage.jsx` show, in the recommend/decide dialogs' `before`, "Terms from appraisal: K… over … months · …% a year, flat|reducing · K… per period (… instalments) · charges K… · paid out K…", and the cover warning from Task 5 when present.
- [ ] **Step 4: Run** the file and `npx vitest run` — expect PASS.

---

### Task 5: Underwriting — valuation, legal verification, document verification

**Files:**
- Create: `src/config/underwriting.js`
- Modify: `api/_handlers/workflow.js` (`saveValuation` accepts the new fields; new `PUT /applications/:id/legal/:index`, `POST /applications/:id/legal/:index/documents/:slot`; `verify` accepts `target: 'document'` from `cases.work` too for required documents), `api/_lib/workflow.js` (hold on leaving a `work: 'underwriting'` state; `workflowView.state.underwriting = underwritingStatus(...)`), `src/config/appraisal.js` (export `lendingCover(application, catalog) → { lendingValue, short: boolean }`), `src/admin/pages/AuditPage.jsx` (labels for `application.legal_saved`, `application.legal_document_added`)
- Test: `tests/underwriting.test.js`

**Interfaces:**
- Valuation record (`applications.valuations[i]`) gains: `asset: { type, assetId, owner, description, location }`, `valuationAmount`, `method: 'market' | 'income' | 'cost' | 'other'`, `valuerCompany`, `valuerLicence`, `valuerContact`, `remark`. Existing fields keep their names (`valuer` = valuer name, `valuedOn`, `marketValue`, `forcedSaleValue`). Saving requires `reportId` to exist ("Attach the valuation report first.", 400 `report_required`) — only in a `work: 'underwriting'` state; older versions keep today's rule.
- Legal record (`applications.verifications.legal[i]`): `{ title: { number, owner, details }, verifiedBy: { name, firm, role: 'advocate' | 'conveyancer' | 'legal_officer' | 'other', licence }, checks: { title_authenticity, ownership, encumbrance, litigation, regulatory, search_report }: { done: boolean, note }, documents: { [slotKey]: { label, required, documentId } }, remark, by, byName, at }`. Default slots: `title_deed` ("Title deed / ownership document", required), `search_report` (required), `legal_opinion` (optional); "Add document" adds `other_<n>`. Permission `legal.verify`.
- `LEGAL_CHECKS = [['title_authenticity', 'Title authenticity'], ['ownership', 'Ownership verification'], ['encumbrance', 'Existing encumbrance check'], ['litigation', 'Litigation check'], ['regulatory', 'Regulatory check'], ['search_report', 'Search report verification']]` in `src/config/underwriting.js`.
- `requiredDocumentsFor(application, documents, product) → [document]` — current copies (not superseded, not system) of the product's required slots (`requestableSlots`), excluding `collateral.*`, `valuation.*`, `legal.*`.
- `underwritingStatus(application, documents, product, catalog, workflowSettings) → { valuation: [{ index, label, complete, missing: [string] }], legal: [...same], documents: [{ id, label, status: 'verified' | 'issue' | 'unchecked' }], complete: boolean, hold: string | null }`. `requireValuation === false` drops valuation from `complete`; `requireLegalReview === false` drops legal. Valuation complete = reportId + marketValue > 0 + valuedOn; legal complete = required slots have documentId + all six checks done; documents complete = every required document `verified` (a verification is keyed by document id, so a new copy is `unchecked`).
- Hold: forward non-reject action out of `work: 'underwriting'` → 409 `underwriting_incomplete` "Moving on waits for: …" (`hold` text); `blockedReason` "Moves on once underwriting is complete: …".

- [ ] **Step 1: Write the failing tests** (`tests/underwriting.test.js`):
  - Unsecured case at Underwriting: `state.underwriting.valuation` and `.legal` empty; Approve held until each required document is verified via `POST /applications/:id/verifications { target: 'document', id, status: 'verified' }` (by the loan officer); then 200.
  - Secured case: valuation save without a report → 400 `report_required`; upload report then save → complete; legal save with 5 of 6 checks → still held, listing "Litigation check"; with all six and both required documents → complete; Approve → 200.
  - Review Focus 5: verify a document, then the applicant sends a new copy through an info request → that document is `unchecked` and Approve is held again.
  - `lendingCover` short when the terms amount exceeds lending value; never blocks Approve.
  - Legal save by a loan officer (no `legal.verify`) → 403.
- [ ] **Step 2: Run** `npx vitest run tests/underwriting.test.js` — expect FAIL.
- [ ] **Step 3: Implement** the module, handlers and hold.
- [ ] **Step 4: Run** the file and `npx vitest run` — expect PASS.

---

### Task 6: Offer letter, payout and LMS use the terms

**Files:**
- Modify: `api/_lib/offerDocuments.js` (`mergeValuesFor`, `scheduleValues`), `src/config/templates.js` (new fields), `api/_lib/lms/sync.js` (`loanDetails`), the `pay_out` branch in `api/_lib/workflow.js` (store `terms.paidOutOn`)
- Test: `tests/facilityLetter.test.js` / `tests/templates.test.js` (extend), `tests/loanTermsCase.test.js` (LMS payload)

**Interfaces:**
- Consumes: `scheduleFor`, `summarizeTerms`, `FREQUENCIES`, `CALCULATIONS`.
- Produces merge fields (when `application.terms` exists; otherwise today's values): `interest_rate` ("24% a year"), `interest_type`, `calculation_method`, `repayment_frequency`, `effective_date`, `instalment` (and `monthly_instalment` kept as an alias), `number_of_instalments`, `charges` (one per line "Processing fee: K7,000.00"), `total_charges`, `net_disbursed`, `repayment_schedule` (from `scheduleFor(terms, payoutDate || effectiveDate)`), `first_repayment_date`.
- LMS `loanDetails` adds: `approvedAmount`, `interestRatePercentPerYear`, `interestType`, `calculationMethod`, `repaymentFrequency`, `effectiveDate`, `charges: [{ name, amount }]`, `netDisbursed`, `schedule: [{ number, dueDate, instalment, principal, interest, balance }]` (from the payout date once paid out).

- [ ] **Step 1: Write the failing tests**: an approved case with terms renders an offer letter whose values include `net_disbursed: 'K343,000.00'` and a schedule whose first line is dated one month after the effective date; after `pay_out` on a later date, the schedule's dates start one period after the payout date with the same amounts; the LMS payload for that case has `repaymentFrequency: 'monthly'`, `calculationMethod: 'reducing'` and `netDisbursed`. A case without terms renders as today.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the files and `npx vitest run` — expect PASS.

---

### Task 7: Case page — Loan terms and Underwriting tabs

**Files:**
- Create: `src/admin/case/LoanTermsPanel.jsx`, `src/admin/case/UnderwritingPanel.jsx`
- Modify: `src/admin/case/CasePage.jsx` (tabs, header "Proposed" / "Instalment"), `src/admin/case/LegalReview.jsx` (keep for older-version cases only), `src/admin/case/CasePanels.jsx` (StagesPanel shows the two stages' completeness)
- Test: `npx vite build`, `npx eslint src`, and a Playwright render with mocked `/api/v1/applications/:id` (pattern from earlier previews: import the page's own React/router URLs from its transformed source)

**Interfaces:**
- Consumes: `workflow.state.work`, `workflow.state.termsHold`, `workflow.state.underwriting` (Tasks 2, 5); `defaultTerms`, `checkTerms`, `summarizeTerms`, `scheduleFor`, `FREQUENCIES`, `CALCULATIONS`, `CHARGE_NAMES` (Task 1); endpoints from Tasks 2 and 5.
- `LoanTermsPanel({ application, product, editable, onSave(terms) })`: "Final loan terms" (requested read-only with "At application"; approved amount with "Eligibility: K…" hint; tenure; frequency), "Interest rate & calculation method" (rate % a year; fixed/variable; flat/reducing; effective date), "Fees & charges" (Add charge: name from `CHARGE_NAMES` or own, fixed K or %; remove), a "Summary of terms" card (from `summarizeTerms`, or "Fix the highlighted fields to see the summary") and a "Repayment schedule" view (table from `scheduleFor`). Field errors from `checkTerms` shown under each field. Read-only when `editable` is false.
- `UnderwritingPanel({ application, documents, workflow, may, onChanged })`: per asset, "Asset valuation" (asset details → valuation report upload first, then the valuation fields → remark) and "Legal verification" (documents with Attach / rename / Add document, title information, verified by, the six checks with notes, remark); then "Document verification" (each required document: View, Verified / Issue found with note). Each section shows "complete" or what is missing (from `workflow.state.underwriting`).
- Tabs: AI Analysis, Details, Documents, **Loan terms** (when the case has terms or is at a `terms` state), **Underwriting** (when at or past a `work: 'underwriting'` state; the old Collateral tab only for cases on versions with `appraisal: true`), Workflow, Timeline. The tab for the current stage's work opens by default.

- [ ] **Step 1:** Build `LoanTermsPanel.jsx`; render it with mocked data (editable, invalid rate, valid with a 2% processing fee, reducing balance) and screenshot at 1280 and 390 px wide; check no horizontal page scroll.
- [ ] **Step 2:** Build `UnderwritingPanel.jsx`; render secured (one asset, incomplete legal) and unsecured (documents only) cases; screenshot both widths.
- [ ] **Step 3:** Wire the tabs, header and dialogs in `CasePage.jsx`; render a case at Appraisal and at Underwriting with mocks; check the Approve button is greyed with the hold reason on hover until complete.
- [ ] **Step 4: Run** `npx eslint src --ext .js,.jsx`, `npx vite build`, `npx vitest run` — expect no errors, build OK, all tests pass.
