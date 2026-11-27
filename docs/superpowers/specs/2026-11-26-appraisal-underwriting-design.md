# Appraisal sets the terms, Underwriting verifies — design

Date: 2026-11-26
Status: draft, for approval (decisions from the review folded in)

## Why

The credit team's process (shown in reference screenshots from another system) splits the two middle stages differently from the app today:

- **Loan appraisal** is where an officer structures the loan: the final amount, tenure, frequency, rate, calculation method, effective date and charges, with the repayment schedule that follows.
- **Underwriting** is where the security and the paperwork are verified: each asset is valued and its title checked; a loan without assets has its documents verified.

Today, Appraisal only values collateral (and is skipped for unsecured loans), Underwriting is a checklist + recommendation, and decision-time terms are just "what was asked for", priced flat and monthly from the product. The screenshots are a reference for *what each stage does*, not for its layout: the case page keeps its current look.

## Goals

1. Every loan gets its final terms set at Loan appraisal, and those terms are what the borrower is offered, repays and what the LMS receives.
2. Underwriting verifies each pledged asset (valuation and legal) and, for every loan, the documents the loan requires (identity, income and the rest).
3. What a stage does is configured in the workflow editor, not tied to stage names.
4. A stage's **Approve** only moves the case on, once that stage's work is complete. The credit decision stays wherever the workflow puts it (approve / reject actions, four-eyes states), as today.

## Non-goals

- Copying the screenshots' layout (full-screen modal, journey sidebar, stepper). The case page keeps its tabs and action bar.
- Changing who makes the credit decision or how four-eyes works.
- Variable-rate repricing over the loan's life. "Variable" is recorded as the interest type and passed on; the schedule uses today's rate.
- Penalties, insurance premiums calculated from tables, grace periods, balloon payments.

## Anti-goals

- Terms shown on the case that differ from the offer letter or the LMS.
- An Approve button that lets work through incomplete without saying what is missing.
- Breaking existing cases: open cases on older workflow versions must keep working.

## Approaches considered

- **A. Stage roles set in the workflow, work shown on the case page (chosen).** A state is marked "sets the loan terms" or "underwriting checks" in the workflow editor; the case page gets Loan terms and Underwriting tabs; a stage's Approve is held until its work is complete. Most work, but stages can be renamed, reordered or reused and the credit decision stays configurable, as the owner asked.
- **B. Fixed stages.** The same tabs and holds tied to the stages named Appraisal and Underwriting in code. Quicker, but breaks when stages are renamed or reordered in the editor.
- **C. Large dialogs from the action buttons.** "Set loan terms" and "Underwrite" open dialogs like Recommend does. Least new screen work, but per-asset valuation and legal work is cramped, and the work is hard to revisit.

## How it is built (approach A, chosen)

### 1. Stage roles in the workflow

A workflow state gets an optional **`work`** setting (one of):

- `terms` — "Sets the loan terms" (Loan appraisal)
- `underwriting` — "Underwriting checks" (Underwriting)

Set in the workflow editor's state drawer, beside the existing toggles. The existing `appraisal: true` flag ("Collateral appraisal", skipped without collateral) is retired for new versions: valuation moves into `underwriting`.

- **Default graph** (`legacyToWorkflow`): Pre-screening → **Appraisal** (`work: 'terms'`, all loans, no longer skipped without collateral; one move, *Approve*) → **Underwriting** (`in_review`, `work: 'underwriting'`; one move, *Approve*) → **Credit decision** (new state `decision`, holding what `in_review` holds today: *Recommend* when four-eyes is on, *Approve / Decline* when off) → **Underwriting: approval** (`pending_approval`, unchanged, four-eyes only) → Offer issuance → Loan booking. Underwriting keeps the legacy status `in_review`; Credit decision also maps to `in_review`. Send-back targets that pointed at `in_review` keep doing so. Every stage keeps its configured return/decline actions. *(Builder's call, confirmed with the owner: "Approve only moves on; the decision is configured in the workflow".)*
- **Existing workspaces.** A workflow still generated from the settings ("legacy-managed") is regenerated with the new graph automatically, and open cases are mapped as today's regeneration does (cases at `in_review` stay at Underwriting). A workflow an admin has published from the editor is not changed: the editor offers the new "What this stage does" setting, and a version still carrying `appraisal: true` behaves exactly as today, so open cases on it are unaffected.
- Validation: at most one `terms` state and one `underwriting` state per subject (loan type), and the `terms` state must come before any decision (approve/reject) state.

**Approve.** In a `terms` or `underwriting` state, the forward move action is labelled **Approve** by default (renamable, like any action). It is held back — greyed, the reason on hover, as other held actions already are — until that stage's work is complete (below). Return/decline actions configured on the state are never held.

### 2. Loan appraisal: the terms

A case gets a **`terms`** record (new `applications.terms` jsonb), edited on a new **Loan terms** tab while the case is in the `terms` state (read-only before and after, for everyone who can see the case):

| Field | Rule |
|---|---|
| Requested | Read-only, from the application |
| Approved amount | Within the product's min–max. Shown beside it: what the applicant is eligible for (`data.eligibility.maxAmount`), as a hint, not a limit |
| Tenure (months) | Within the product's min–max |
| Repayment frequency | Monthly (default), fortnightly, weekly, quarterly |
| Interest rate | % **per year**, 0.1–300. Default from the product, chosen so the default price equals today's at the requested tenure: basis *per month* → × 12; basis *per loan* → rate × 12 ÷ requested tenure. The default isn't re-derived when the officer changes the tenure (they see the rate) |
| Interest type | Fixed / Variable. Default from the product's `interestType` |
| Calculation | Flat / Reducing balance. Default: flat (what products do today) |
| Effective date | Required; defaults to today. The schedule's first instalment falls one period after it |
| Fees & charges | Zero or more: name (Processing fee, VAT, Insurance, Legal fee, Valuation fee, or own name), amount as a fixed K figure or % of the approved amount. The product's facility fee is pre-filled as the first charge |

Beside the form: a **summary** (approved amount, rate and method, instalment per period, number of instalments, total interest, total charges, total repayable, first and last due dates) and a **Repayment schedule** view (number, due date, instalment, principal, interest, balance). Until the form is valid, the summary says which fields need fixing.

**Calculation** (new pure module `src/config/loanTerms.js`, shared by browser and server, unit-tested):

- Periods = tenure in months × periods per month (weekly 52/12, fortnightly 26/12, quarterly 1/3), rounded to whole periods; period rate = annual rate ÷ periods per year.
- Flat: interest = principal × annual rate × tenure/12; equal instalments of (principal + interest) ÷ periods.
- Reducing balance: standard annuity instalment; each row's interest = balance × period rate.
- **Charges are paid upfront** (owner's decision): they come off the amount paid out and are not added to the instalments. **Net disbursed** = approved amount − charges (must be > 0). Total repayable = principal + interest; total cost of credit = interest + charges. Amounts rounded to the ngwee; the last instalment absorbs rounding.
- **Dates.** The schedule is built from the effective date (first instalment one period after it). At payout, the due dates are rebuilt from the payout date with the same amounts; the LMS receives the rebuilt schedule.

**Where the terms go:**

- Until the credit decision they are **proposed terms**, kept only in `applications.terms` (shown on the Loan terms tab and the header as "Proposed").
- **Locked after Appraisal** (owner's decision): the recommend / decide dialogs show the appraised terms read-only (amount, tenure, rate, method, instalment, charges, net disbursed); they no longer take an amount or tenure. To change the terms, the case is sent back to Appraisal; the saved terms stay as the starting point and Appraisal is approved again. The approver's band is checked against the appraised amount.
- At an **approve** decision, the case's `approvedAmount`, `approvedTenure`, `monthlyInstalment` (shown as "Instalment" with its frequency) and `totalRepayable` are set from the terms, and the `appraisals` decision row records them. A decline leaves them empty.
- The offer letter / facility letter use the terms' schedule, charges and net disbursed; the LMS hand-off sends approved amount, rate, method, frequency, effective date, charges, net disbursed and the schedule.
- A case on an older workflow version with no `terms` stage keeps today's behaviour (product pricing, amount/tenure in the dialogs).

Who: anyone with `cases.work` on the case, at the `terms` stage (the existing ownership rules apply). Saving is a utility action (`save_terms`), audited and on the timeline; saving again while still at the stage overwrites.

### 3. Underwriting

A new **Underwriting** tab replaces the Collateral tab. It has up to three sections, each with its own completeness:

**a. Asset valuation** (one card per pledged asset; absent without assets)

- Asset details, carried from the application and editable: asset type, asset ID, registered owner, description (required), location.
- Valuation — the report must be attached first (PDF/JPG/PNG, up to 20 MB; existing upload): valuation amount, method (Market comparison, Income, Cost, Other), market value (required), forced-sale value (≤ market value), valuation date (required, not in the future), valuer name, valuer company, licence number, contact.
- Remark (free text, optional).
- Complete when: report attached, market value and date set.
- **Cover warning:** once valued, if the approved amount is above the assets' total lending value (value × (1 − haircut) × LTV), Underwriting and the decision dialog show a warning with both figures. It never holds Approve: the decision is the approver's judgement.

Extends today's `valuations[index]` record (new fields added; existing valuations stay valid). Permission as today (`cases.work`). Existing rules that use the valued market value (lending value, LTV) are unchanged.

**b. Legal verification** (one card per pledged asset; absent without assets)

- Documents: Title deed / ownership document (required), Search report (required), Legal opinion (optional), and "Add document" for others (name + file). Each slot can be renamed. Files stored as case documents (`legal.<index>.<slot>`).
- Title information: title / registration no., registered owner, registration details.
- Verified by: name, firm, role (Advocate, Conveyancer, Legal officer, Other), licence number.
- Legal checks (each ticked, with an optional note): Title authenticity, Ownership verification, Existing encumbrance check, Litigation check, Regulatory check, Search report verification.
- Remark.
- Complete when: required documents attached and all six checks ticked.

Done by the `legal.verify` permission (legal officer), as today. Replaces today's generic verify/issue per collateral item; an "issue found" note stays possible on each check (unticked with a note = issue).

**c. Document verification** (every loan)

The required documents on the case (the product's required slots, or, for a matched product, the common set plus those asked for later), the current copy of each, with **Verified / Issue found** and a note, by anyone with `legal.verify` or `cases.work`. A re-upload (a new copy) needs verifying again. An issue is resolved by a new copy ("Ask the applicant") or overridden with a note by the same people. Complete when every required document is verified.

**Checklist.** In the new default, identity / documents / income are no longer required ticks (document verification replaces them): `DEFAULT_CHECKLIST` marks them not required for new versions and the decision actions' `checks` drop them. Credit bureau and site visit stay as optional ticks. A workspace's custom checklist (Settings → Stages) is left as it is.

**Approve** in the underwriting state is held until every section present is complete. A loan without assets therefore needs only document verification. (The current Settings switches "Require valuation" / "Require legal review" keep working: off, that section doesn't hold Approve.)

### 4. Case page

- Tabs: AI Analysis, Details, Documents, **Loan terms**, **Underwriting**, Workflow, Timeline. Loan terms and Underwriting appear once the case reaches (or has passed) those stages, and open by default when the case is at that stage.
- The Workflow tab's Stages panel shows the two stages' completeness.
- The header's "Monthly instalment" becomes "Instalment" with its frequency once terms exist.

## Constraints

- Open cases on older workflow versions keep today's behaviour (`appraisal: true`, checklist).
- New columns via a hand-written migration (installed drizzle-kit is too old to generate): `applications.terms jsonb`, plus new fields inside existing `valuations` / `verifications` jsonb (no column changes).
- Every change audited (action, case reference, counts — no document contents).
- Mobile: forms stack; the schedule table scrolls inside its box.

## Left to the builder

- Exact copy, icons and component split.
- The LMS payload field names for the new terms (follow `lms/sync.js` conventions).
- Offer letter template tokens for the schedule and charges.
- Whether the decision dialog repeats the terms summary or links to the Loan terms tab.
