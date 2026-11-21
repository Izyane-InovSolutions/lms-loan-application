# Applicant Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Applicants verify their email or phone with a one-time code before the draft is saved. Staff are warned when an ID and contact details don't match earlier applications.

**Architecture:**
- **Verification:** two router endpoints issue and check `start` codes. A successful check returns a short-lived ticket, which `POST /draft` (and a later `PUT /draft`) exchanges for `draft.verified`.
- **Submission:** submit refuses a draft whose verified contact no longer matches the form. It copies the verification to `applications.contact_verification`, and stores ID and contact mismatches in `applications.identity_flags`.
- **Pre-screening:** a new fact, `id_contact_mismatch`, exposes the flags to the credit rules.

**Tech Stack:** Node API handlers, Drizzle on Postgres or PGlite, KV (Redis or memory), React and Vite, Vitest.

**Spec:** docs/superpowers/specs/2026-11-21-applicant-verification-design.md

## Global Constraints

- **Setting:** `customerOptions.verifyAtStart`, default `true`. When it's off, nothing is required.
- **Codes:**
  - The purpose is `start`.
  - KV keys are `otp:start:email:<email>` and `otp:start:phone:<+260…>`.
  - Codes expire after 10 minutes, with a 60-second wait between requests.
  - Request caps match `api/otp/request.js`: 30 per IP per hour, 15 per contact per day.
- **Ticket:** KV `verify-ticket:<token>` = `{ channel, value }`, valid for 30 minutes and used once.
- **Agent-assisted drafts** (`assisted` with a staff session) never need verification.
- **Masking:**
  - email: `a…@gmail.com`
  - phone: `+260 9…456`
  - ID: `…78/9` (last four characters)
- **Error codes:** `verification_required` is 401 on POST /draft and 409 at submit.

## Review Focus

1. **A draft resumed by email code from before this feature** has no `verified`. Resuming proves the email, so `otp/verify.js` sets `verified` to email.
2. **The applicant edits the verified phone after verifying by SMS.** Submit refuses with 409, and the wizard re-verifies the new number.
3. **Same NRC typed with different spacing or slashes** (`123456 78 9` and `123456/78/9`) must still match. Normalise to alphanumerics, lower case.
4. **Phone stored as 9 digits, 0-prefixed, or +260** must compare equal. Normalise to the last 9 digits.
5. **No SMS provider set up:** the phone channel is refused by the server (`sms_unavailable`) and hidden in the dialog.

---

### Task 1: Codes, tickets and the setting

**Files:**
- Create: `api/_lib/verification.js`, `api/_handlers/verification.js`
- Modify: `api/_lib/otp.js` (add `'start'`), `api/_lib/settings.js`, `api/_handlers/settings.js:568`, `api/v1/[...path].js`, `api/_handlers/applications.js` `listProducts`
- Test: `tests/verification.test.js`

**Interfaces (produces):**
- `normalisePhone(value) → '+260XXXXXXXXX' | null`
- `contactOf(loanType, data) → { email, phone }` (personal: `personalInfo.email` and `.phone`; business: `directorInfo.applicantEmail` and `.applicantPhone`)
- `redeemTicket(ticket) → { channel, value } | null`, which deletes the ticket
- `verificationRequired() → Promise<boolean>`
- Routes:
  - `POST /verification/start {channel, email?, phone?}` → `{ sent: true }`
  - `POST /verification/check {channel, email?, phone?, code}` → `{ ticket }`
- `listProducts` adds `applicantVerification: { required, sms }`.

**Steps:**
- [ ] Test: an email code is issued and checked, returning a ticket that redeems once only. A wrong code gives 400. Phone without SMS gives `sms_unavailable`.
- [ ] Implement, reusing `storeOtp`, `checkOtp` and `consumeOtp` with subject `email:<x>` or `phone:<+260…>`, and `textCustomer` for SMS.
- [ ] Run `npx vitest run tests/verification.test.js`. It should pass.

### Task 2: Drafts and submission require a verified contact

**Files:**
- Modify: `api/draft/index.js`, `api/otp/verify.js`, `api/_handlers/applications.js` (`submitApplication`), `api/_lib/db/schema.js`
- Create: migration `0018_applicant_verification.sql`, plus its snapshot and journal entry
- Test: `tests/verification.test.js`, `tests/helpers.js`, and the tests that write `draft:` keys directly, so they seed `verified`

**Steps:**
- [ ] Test:
  - POST /draft without a ticket gives 401 `verification_required`.
  - With a ticket for the same email, the draft has `verified`.
  - A ticket for a different contact gives 401.
  - With the setting off, no ticket is needed.
  - Assisted drafts need none.
  - Submit with a changed phone after verifying by phone gives 409. A PUT with a ticket for the new phone fixes it.
  - The application has `contactVerification`.
- [ ] Implement: `applications.contact_verification` and `identity_flags` (jsonb), POST and PUT ticket handling, submit check, and resume sets email `verified`.
- [ ] Run the tests. They should pass.

### Task 3: ID and contact mismatch flags

**Files:**
- Create: `api/_lib/identityFlags.js`
- Modify: `api/_handlers/applications.js`, `api/_lib/prescreen/facts.js`, `src/config/creditRules.js` (fact `id_contact_mismatch`, boolean, no default rule), `src/admin/case/CasePage.jsx` (warning)
- Test: `tests/verification.test.js`

**Interfaces:**
- `identityFlags(db, { loanType, data, email, phone }) → [{ kind: 'id_other_contact' | 'contact_other_id', reference, applicationId, contact?, id?, verified }]`, at most 5.

**Steps:**
- [ ] Test:
  - A second application with the same NRC and another email is flagged `id_other_contact`, with a masked email and the first reference.
  - The same phone with another NRC is flagged `contact_other_id`.
  - The fact `id_contact_mismatch` is true.
  - A clean application has no flags.
- [ ] Implement: SQL on `applications`, comparing normalised IDs and phones. Add a timeline event when flagged.
- [ ] Run the tests. They should pass.

### Task 4: Wizard dialog and settings switch

**Files:**
- Create: `src/components/application/VerifyContactDialog.jsx`
- Modify: `src/services/draftApi.js`, `src/hooks/useApplicationDraft.js` (holds the ticket, and treats `verification_required` as a pause rather than an error), `src/pages/DashboardPage.tailwind.jsx` (opens the dialog on the first-step Continue and on a 409 at submit), `src/admin/pages/SettingsPage.jsx`

**Steps:**
- [ ] Implement. Then run `npm run lint` and `npx vite build`; both should be clean.

### Task 5: Docs and the full suite

- [ ] Update `docs/SYSTEM-WALKTHROUGH.md` (scenarios) and the `README.md` settings row.
- [ ] Run `npx vitest run`. All tests should pass.
