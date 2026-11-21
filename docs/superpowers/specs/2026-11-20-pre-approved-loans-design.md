# Pre-approved loans for partner employees: design

Date: 2026-11-20 · Status: approved (revised: partner staff pre-screen, an officer issues the offer)

## Intent

The lender has MoUs with partner organisations. Partner employees can apply for loan products set up for their employer. Those loans are **pre-approved**: they skip appraisal, review, recommendation and approval.

1. **Pre-screening by the partner.** Someone at the partner, usually HR, confirms that the applicant works there, or says they don't. The partner's uploaded staff list helps them check.
2. **Offer issuance.** A sales manager or loan officer issues the offer, and the case goes straight to the offer state. Acceptance, signing, payout and the LMS hand-off work as they do today.

Why: the MoU means the lender has already accepted the risk for the partner's employees. Checking each case the usual way adds delay and nothing else.

## Goals

- An admin can mark a loan product as pre-approved for one partner.
- Admins keep a list of partners. Each partner has an MoU reference, an MoU end date, an active switch and a **staff list** uploaded as a CSV.
- A new built-in role, **Partner staff**, is linked to one partner. It sees only a "Partner requests" page listing its partner's applicants, and can confirm or refuse each one. It cannot see case pages, credit reports or anyone else's applications.
- After a partner confirms, a sales manager or loan officer gets the case to **issue the offer**. This requires the new `offers.issue` permission, which both roles have by default. One click moves the case to the offer state, with the same email, offer letter and LMS behaviour as a normal approval.
- Every step is on the timeline and in the audit log, naming the partner, the MoU and who acted.

## Non-goals

- Payroll deduction, and passing employer or MoU details to the LMS.
- Changing the workflow editor or adding workflow states. The pre-approval stage is recorded on the case, which stays in the workflow's start state until the offer is issued.
- Pricing per partner.

## Anti-goals

- **Pre-approval never declines anyone by itself.** A partner refusing, or any failed check, sends the case to normal review.
- **No offer is issued until the partner confirms,** the credit rules haven't recommended a decline, and the credit report is in wherever a credit check applies.
- **Partner staff never see more than they need:** the applicant's name, NRC, the requested amount, tenure and instalment, and the staff-list match. They never see documents, credit data or other partners' applicants.
- **No one can download the staff list.** Admins see counts and can look up one NRC.

## Approaches considered

| Approach | Trade-off | Result |
|---|---|---|
| Employer name match against the payslip | No list to keep, but weak proof | Not chosen |
| **Staff list from the partner** | Strong and auditable; the list must be kept current | **Chosen** |
| Partner HR confirms each applicant | Strongest, but needs partner users | **Added on top**, at the user's request: the list helps partner staff decide, and their confirmation is the check |

Two ways to model the stages were considered:

- **New workflow states:** states can only be limited by loan type, and a skip-to-offer edge would complicate the workflow editor.
- **A pre-approval stage recorded on the case** (`applications.pre_approval`), with the case kept in the start state: no workflow change is needed. The offer is issued through a new case action that enters the workflow's offer state the same way an approval does.

**The second was chosen.**

## Design

### Data (migration `0017_pre_approval.sql`)

- **Partners** are stored in settings (`settings.partners.list`), validated in the settings handler:
  ```js
  { id, name, mouReference, mouEndsOn /* YYYY-MM-DD */, active, staffList: { version, uploadedAt, uploadedByName, count } }
  ```
- **The staff list** goes in a new table, `partner_staff`: `id`, `partner_id`, `list_version`, `nrc` (normalised), `employee_number`, `name` and `created_at`, indexed on `(partner_id, nrc)`.
- **Users** gain a `partner_id` column, required for roles with the `partner` scope.
- **Applications** gain a `pre_approval` jsonb column:
  ```js
  { partnerId, partnerName, mouReference, stage: 'partner' | 'issue' | 'issued' | 'review',
    staffMatch: { onList, employeeNumber, name, listVersion },
    partnerDecision: { confirmed, note, employeeNumber, byName, at },
    issued: { byName, at }, reason }
  ```
- **The product** gains `preApproval: { enabled, partnerId, maxAmount }`. Only personal-loan products can use it, and a partner is required when it is on.

### Roles and permissions

- **New permissions:**
  - `partner.confirm`: "Confirm partner employees for pre-approved loans".
  - `offers.issue`: "Issue offers on pre-approved loans".
- **New scope:** `partner`, meaning "Only their partner's pre-approval requests". This scope sees no applications through the normal lists or case pages; it gets only the partner requests endpoints.
- **New built-in role:** `partner_staff` ("Partner staff"), with scope `partner` and permission `partner.confirm`.
- **Default holders of `offers.issue`:** sales managers and loan officers. Administrators hold everything.
- **Inviting a user** to a partner-scoped role requires choosing the partner.

### Flow

1. **On submission,** after pre-screening and the automatic credit check, `enterPreApproval` runs. The case enters the track (`stage: 'partner'`) when all of these hold:
   - The product has `preApproval.enabled` and the case is still in the start state.
   - The partner exists, is active and its MoU is in date.
   - The applicant pledged no collateral.
   - The amount is within `maxAmount`, when one is set.

   If the product is pre-approved but a check fails, the case stays in normal review (`stage: 'review'`) and the timeline gives the reason. When it enters the track, the timeline says "Sent to [Partner] to confirm employment", the staff-list match is recorded, and the partner's users are notified.
2. **Partner staff** open Partner requests and see their pending applicants, with an "On staff list (employee no. X)" or "Not on the staff list" badge.
   - **Confirm:** they confirm with an optional employee number and note. The stage becomes `issue`, and users holding `offers.issue` are notified.
   - **Refuse:** they refuse with a reason. The stage becomes `review`, and the timeline says "[Partner] did not confirm employment: [reason]", so the case continues as a normal application.
3. **Offer issuance.** On the case page, the pre-approval panel shows the partner's confirmation, the staff-list match, the credit rules result and the credit report state. It has two actions:
   - **Issue offer**, with the amount and tenure prefilled. They can be lowered, but must stay within the product's limits and `maxAmount`. Issuing is blocked while any of these hold:
     - the partner hasn't confirmed
     - the credit rules recommended a decline
     - a credit check applies and no report is in
     - the issuer brought the case in (four-eyes)

     Approval limits don't apply, because the MoU sets the limit. Issuing records a decision appraisal, sets the approved terms and `decidedAt`, and enters the offer state that the workflow's approve action leads to. If the workflow has none, issuing is refused with a clear message. The customer then gets the usual approval email and offer documents.
   - **Send to full review**, with a reason. The stage becomes `review`, and the case continues as normal.
4. **"Start the review"** on a case in the track also takes it out of the track to normal review, and the timeline says so.

### Screens

- **Settings → Partners:** a list of partners and an add/edit dialog. Each partner has its staff list status, an "Upload staff list (CSV)" button and a "Check an NRC" lookup. The CSV's columns are `nrc`, `employee_number` and `name`. Each upload replaces the list, and bad rows are reported by line number.
- **The loan product dialog** gains a Pre-approval section: an on/off switch, a partner select and an optional limit.
- **Team → Users** shows a partner select when the chosen role has the partner scope.
- **Partner requests** is a new page, the only page partner staff see. It has pending and recent tabs.
- **The case page** gets a "Pre-approved · [Partner]" badge and the pre-approval panel with its actions.

### Tests

- Product and partner validation.
- Staff list upload: replace, bad rows, admin-only access, and the NRC lookup.
- Entering the track, with each fallback reason.
- Partner scope: partner staff only see their own partner's pending requests and get 404 on case pages; partner confirm and refuse.
- Issuing: the blocks (no confirmation, credit check pending, a decline outcome, four-eyes, over the limit), and the happy path reaching the offer state with the offer expiry, the approval email and the decision record.
- "Start the review" dropping the case out of the track.

## Calls made (for the user to check)

1. **Officer checks are skipped on this route:** the checklist, appraisal, review stages and recommendation. The partner's confirmation, the credit rules and a person issuing the offer stand in for them.
2. **Collateral, or an amount above the limit, sends the case to normal review.**
3. **Approval limits don't apply to issuing.** The product's pre-approved limit caps the amount instead.
4. **Partner staff see only a minimal summary,** never case pages.
5. **Personal-loan products only.** There is no full staff-list download, and nothing new goes to the LMS.

## Revision 2026-11-21: the partner reviews; the case is held

- **The partner reviews before answering** (the "employment check only" option). Partner staff can open each request while it waits for them. They see the applicant's name, NRC or passport, date of birth, phone, occupation and stated employer. They also see the ID copy, photo and payslips (`PARTNER_DOCUMENT_SLOTS`). Bank statements, TPIN, address, next of kin and the loan purpose are never shown. Each view and document opening is audited. Once the partner has answered, they can no longer open the request.
- **Applicants are told** on the submit step, and the notice is recorded as consent type `partner_notice`.
- **Held for the partner.** A pre-approved product's case starts in a new `prescreen` stage when it is submitted, then moves to `partner`. In both stages only system administrators can act on it: the workflow and the validation endpoints refuse everyone else with `409 held_for_partner`. Notes and the customer's own actions still go through. The case page is read-only for everyone else.
- **Not stranded.** If the product stops being pre-approved before the case reaches the partner, the case is released to review instead.

