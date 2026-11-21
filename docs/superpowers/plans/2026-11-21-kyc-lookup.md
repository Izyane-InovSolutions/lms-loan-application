# Customer Record (KYC) Lookup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Institutions connect their own KYC platform in Settings. Applicants (confirmed by a code to the record's contact) and agents (no code) get the form filled from it.

**Architecture:** A generic HTTP connector (`api/_lib/kyc/`) reads setting `kyc`: connection, auth, three lookups, an answer check, and personal and business mappings.

- **Public lookup:** `POST /kyc/lookup` keeps the mapped record in KV under a reference and returns only masked contacts.
- **Record contact:** `POST /verification/start` and `/check` accept `{reference, contact: 'mobile' | 'email'}` to send to the contact on record. The check returns the fill values with the ticket.
- **Agent lookup:** `POST /kyc/lookup/assisted` returns the values directly.
- **Submission:** copies the draft's KYC reference into `applications.kyc`.

**Tech Stack:** Node API handlers, Drizzle, KV, React and Vite, Vitest.

**Spec:** docs/superpowers/specs/2026-11-21-kyc-lookup-design.md

## Global Constraints

- **Setting `kyc` (flat, so secrets fit `SECRET_FIELDS`):**
  - `enabled`, `preset`, `baseUrl`, `timeoutSeconds` (10)
  - `authType`: `none`, `apiKey`, `bearer`, `basic` or `oauth`
  - `apiKeyHeader`, `apiKey`*, `bearerToken`*, `username`, `password`*, `tokenUrl`, `clientId`, `clientSecret`*, `scope`
  - `headers` `[{name, value}]`
  - `lookups` `{ nrc|passport|tpin: { enabled, method, path, body } }`
  - `foundPath`, `foundValue`, `recordPath`
  - `mappings` `{ personal: [{ field, path, tidy }], business: [...] }`
  - `otherContact` `{ policy: 'none' | 'fields' | 'all' | 'refuse', fields: [] }`

  \* encrypted
- **Mapping targets:** form paths such as `personalInfo.firstName`, plus `contact.mobile` and `contact.email`.
- **Tidy-ups:** `none`, `phone` (to 9 digits), `date` (YYYY-MM-DD), `choice` (matched to the field's options ignoring case, with demonyms), `upper`, `lower`.
- **Record in KV:** `kyc-lookup:<ref>`, kept 30 minutes.
- **Public lookup limits:** 20 per IP per hour, 5 per ID per hour.
- **Never sent to the browser:** the raw answer, or unmapped fields.
- **`https`** is required on a deployment.

## Review Focus

1. **A platform answer that is not JSON, or HTML on a 200.** This is an error. The applicant falls back quietly; staff see it in the audit log.
2. **A record whose mobile is `260968009727`.** The SMS goes to `+260968009727`, and the form shows `968009727`.
3. **An applicant choosing "different contact" under `refuse`.** The server refuses with 403, not only the UI.
4. **An applicant with a reference for one ID who then edits the ID on the form.** The submission's `kyc` must match the submitted ID; otherwise it's recorded as `contact: 'none'`.
5. **Test lookup with a secret left blank for a different host.** The stored secret is not sent (as `testLms` does).

---

### Task 1: Connector and settings

- **Create:** `src/config/kyc.js` (targets, tidy-ups, presets, `applyMapping(record, mapping, form)`, `readPath`), `api/_lib/kyc/client.js` (`kycLookup(config, idType, id) → { status: 'found' | 'not_found' | 'error', record?, values?, contacts?, httpStatus, ms }`, with OAuth token caching).
- **Modify:**
  - `api/_lib/settings.js`: defaults and `SECRET_FIELDS.kyc`.
  - `api/_handlers/settings.js`: validator, and `POST /settings/kyc/test` (`{ form?, idType, id }` → `{ status, httpStatus, ms, raw (redacted), values }`).
- **Tests** in `tests/kyc.test.js`, against a stand-in HTTP server:
  - the iZyane preset maps the sample answer: phone 9 digits, Male, Single, Zambia
  - 404 is not found
  - HTML is an error
  - each auth type sends its headers; OAuth fetches a token once
  - test lookup redacts secrets and keeps stored secrets from another host

### Task 2: Lookup endpoints and the code to the contact on record

- **Create:** `api/_handlers/kyc.js`:
  - `POST /kyc/lookup` (public, limited): `{ found, reference, contacts: { mobile, email } (masked), otherContact }`
  - `POST /kyc/lookup/assisted` (`applications.assist`): `{ found, reference, values }`, audited
- **Modify:**
  - `api/_handlers/verification.js`: start and check accept `{ reference, contact }`, sending to the record's contact. Check returns `{ ticket, values }`. With `other`, check returns the values the policy allows; `refuse` gives 403.
  - `api/_lib/verification.js`: tickets carry `kyc: { reference, contact }`.
  - `api/draft/index.js`: stores `draft.kyc`.
  - `listProducts`: adds `kyc: { enabled, lookups }`.
- **Tests:**
  - only masked contacts are returned
  - a code to the record mobile, then check, returns the values
  - "other" under each policy
  - `refuse` gives 403
  - not found
  - agents get values without a code; non-staff get 403
  - rate limit

### Task 3: On the application

- **Modify:**
  - `schema.js` and migration 0019: `applications.kyc` jsonb.
  - `submitApplication`: copies the KV record and how they confirmed, only when the submitted ID matches the looked-up one.
  - `prescreen/facts.js` and `creditRules.js`: fact `kyc_confirmed_on_record`.
  - `CasePanels.jsx`: a `KycPanel` showing each field's record value against the submitted one.
- **Tests:** the submission keeps it; a changed ID gives `none`; the fact is set.

### Task 4: Screens

- **Create:** `src/admin/pages/KycTab.jsx`, covering connection, lookups, answer, mappings, the other-contact policy and test lookup.
- **Modify:**
  - `SettingsPage.jsx`: the new tab.
  - `VerifyContactDialog.jsx` (`ConfirmItsYou`): the ID step and the choice of record contact.
  - `DashboardPage.tailwind.jsx`: applies the values and shows the agent's "Look up customer" box.
- Then run `npm run lint`, `npx vite build` and the full `npx vitest run`, and update the docs.
