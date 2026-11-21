# Customer record (KYC) lookup: design

## Intent

The LOS is used by different institutions. Each one keeps its customers' KYC records somewhere: a core banking system, a KYC hub such as iZyane's, or another platform.

When an application starts, the customer gives an ID number:

- an NRC or passport for a personal loan
- a TPIN for a business loan

The system looks that ID up in the institution's own platform and fills the form with what the institution already holds. That saves typing and gives cleaner data.

Doing this safely also gives a stronger identity check. The confirmation code goes to the contact **on the institution's record**, not to one the applicant typed.

## Goals

- **Any platform, no code changes.** Admins connect their platform under Settings by describing:
  - the connection
  - one lookup per ID type
  - how to read the answer
  - which field fills which form field
- **Presets** fill all of that in one click. The first is iZyane KYC hub. The second is a "Standard format", for institutions that would rather build to ours.
- **Test lookup** shows the platform's raw answer next to what would be filled.
- **Applicants:** the code goes to the record's mobile or email, which the applicant chooses. They may instead use a different contact; what happens then is a setting (below).
- **Agents:** they look the customer up and the form fills straight away. There's no code, and each lookup is audited.
- **Staff:** they see on the case whether a record was found, how the applicant confirmed, and where the submitted details differ from the record.

## Non-goals

- Fetching documents from the platform, such as the photo, signature or ID scans. **Documents are always uploaded by hand.**
- Looking up the applying director by NRC on a business loan. Business lookups are by TPIN only, for now.
- Writing anything back to the institution's platform.

## Anti-goals

- **No reading someone else's record by knowing their ID number.** Applicants never receive record data before confirming a code sent to the record's own contact, except as the "different contact" setting allows.
- **Never in the applicant's browser:** the photo, signature, next of kin and any field that isn't mapped.
- **No secrets in clear:** stored credentials are encrypted, like the LMS, ZRA and SMS ones.

## Approaches considered

- **A connector admins configure, with presets (chosen).** It covers any HTTP/JSON platform. Presets keep the common cases to one click, and a fixed "Standard format" preset still serves institutions that want a contract.
- **Built-in adapters per platform.** This is how the credit bureau works. It's simpler for admins, but needs a developer for every new institution.
- **A fixed format only.** It's the least work for us and pushes all the work onto each institution.

## Design

### Settings → Customer records (KYC)

A new settings tab. All of it is stored as setting `kyc`.

**1. Switch**

| Setting | Meaning |
| --- | --- |
| On / off | Off by default |
| Preset | Fills the fields below; anything can still be edited after |

**2. Connection**

| Setting | Meaning |
| --- | --- |
| Base URL | Must be `https` on a deployment, as for the credit bureau |
| Timeout | In seconds; 10 by default |
| Authentication | One of: none; API key in a header (header name and key); bearer token; basic (username and password); OAuth 2 client credentials (token URL, client ID, client secret, scope, with the token cached until it expires) |
| Extra headers | Any further name and value pairs |

**3. Lookups**

There are three lookups: NRC, passport and TPIN. Each can be switched on or off and has:

- **Method:** GET or POST.
- **Path:** for example `/api/v1/external/customers/lookup/?id_number={id}`. `{id}` is URL-encoded.
- **Body template:** for POST only.

The NRC and passport lookups fill the personal form. The TPIN lookup fills the business form.

**4. Reading the answer**

| Setting | Meaning |
| --- | --- |
| Found when | An HTTP 2xx, and optionally a JSON path equal to a value, for example `status` = `success` |
| Not found when | HTTP 404, or that check failing. Any other answer is an error. |
| Record at | The JSON path to the record, for example `data` |

**5. Field mapping**

There's one mapping for personal records and one for business records. Each row says:

- the **form field** it fills, chosen from a list of the form's fields
- the **record path** it comes from, for example `first_name` or `profession.0`
- a **tidy-up**, chosen from:
  - **as is**
  - **phone:** to the form's 9 digits
  - **date:** to YYYY-MM-DD
  - **choice:** matched to the form's options ignoring case, with demonyms, so "Zambian" becomes Zambia
  - **upper** or **lower** case

Two extra targets mark the **contact on record**, the mobile and the email the code may go to. They're usually the same paths as the form's phone and email.

**6. Applicant uses a different contact**

What happens when the applicant chooses not to use the contact on record:

| Option | What it does |
| --- | --- |
| **Don't fill** (default) | They confirm their own contact and fill the form themselves |
| **Fill only these fields** | Ticked from the mapping's fields |
| **Fill everything** | |
| **Not allowed** | They must use the contact on record, or contact the lender |

In every case the case is noted for staff.

**7. Test lookup**

An ID box. The result shows the HTTP status, how long it took, the raw JSON with secrets redacted, and the form fields that would be filled. Nothing is stored except an audit entry.

### Applicant flow

This extends the "First, confirm it's you" start screen.

1. **Lookup on.** The start screen first asks for the ID: NRC or passport (choosing the nationality decides which), or TPIN for business.
2. `POST /kyc/lookup {loanType, idType, id}`. It's public and rate-limited per IP and per ID. It returns only:
   - `found`
   - a lookup reference
   - the masked contacts on record, for example `+260 96…727` and `z…@gmail.com`
   - whether a different contact is allowed

   The record itself is kept on the server, in KV for 30 minutes under the reference.
3. **Found:** they choose a contact on record, or "a different email or mobile" if allowed.
   - **A contact on record:** the code goes to the record's contact. `POST /verification/check` with the reference returns the ticket **and the fill values**. The form opens filled, with the ID set. The draft records `kyc: { reference, contact: 'record' }`.
   - **A different contact:** the existing email or phone code flow runs. The fill values follow the setting above. The draft records `contact: 'other'`.
4. **Not found, or the platform failed:** the existing email or phone flow, with the ID kept. The applicant sees "We couldn't find your details, so fill them in below" and never the platform's error. Staff see the error in System health and the audit log.
5. **Lookup off:** exactly as today.

### Agent flow

Agents skip the code. At the top of the first step there's a **Look up customer** box (ID type and number).

- `POST /kyc/lookup/assisted` needs the `applications.assist` permission.
- It returns the fill values straight away and is audited (who, which ID, found or not).
- The draft records `kyc: { reference, contact: 'agent' }`.

### Filling

- Fill values go into the form's fields and stay editable.
- Fields are filled only where the form is still empty, except the ID, which is set.
- A small note above the form says "Filled from your records at {institution}. Check and correct anything out of date."

### On the case

New jsonb column `applications.kyc`, set by the server at submission from the draft's reference. It holds:

- `found`, `source` (the preset name or "Custom"), `contact` (`record`, `other` or `agent`)
- the masked contacts on record
- the **mapped record values**, but never the raw answer
- when the record was looked up

A **Customer record** panel on the Details tab shows:

- whether a record was found, and how the applicant confirmed
- each mapped field with **the record's value next to the submitted one**, with differences highlighted

A new pre-screening fact, `kyc_confirmed_on_record`, is yes or no:

- **Yes:** the applicant confirmed with a contact on the record, or an agent looked them up.
- **No:** a record was found, but the applicant used another contact or changed the ID.
- **Not known:** they weren't looked up, or weren't found.

Admins can write a rule on it. No rule is added by default.

This was planned as `kyc_contact` with four values. It became yes or no because the policy rules work best with yes/no facts.

The existing ID and contact check stays as it is.

### Errors and health

- System health shows the connection's state, using the last test or the last failure.
- Platform failures are reported through `reportError` with the HTTP status only, never the body, because it may contain personal data.

## Left to the builder

- Exact wording and layout of the settings tab and start screen.
- The list of form fields offered as mapping targets: the personal and business form fields that hold applicant-typed text, dates or choices.
- The shape of the "Standard format" preset's request and response, kept as close to the iZyane one as possible.

## Built-in decisions (implementation)

- **The lookup stays on the server, never in the browser.** It is kept in KV under a reference for 30 minutes, then with the draft (`kyc-draft:<draft id>`, 7 days) until submission.
- **A record with no mobile or email on it** is treated as not found, because no code could reach it.
- **An applicant may skip the ID step** ("I'll fill the form in myself"). This leads to the usual flow with nothing filled and nothing recorded.
- **Email when confirmed by mobile:** if the applicant confirms by mobile and the record has no email, they're asked for an email to keep the application under.

## Revision 2026-11-21: occupation and next of kin

At the user's request, records also fill:

- **Occupation:** from iZyane's `employment_type`.
- **Next of kin:** name, phone and relationship, from `next_of_kin`, `next_of_kin_contact` and `next_of_kin_relationship`.

This replaces the earlier rule that next of kin never reaches the applicant's browser. It still only arrives after a code to the contact on record, or as the different-contact setting allows. Photos and signatures are still never fetched.

The `choice` tidy-up now knows common wordings:

- employment: "Employment" and "Employment (Salaried)" become Employed
- relationships: Son and Daughter become Child, Wife becomes Spouse, Brother becomes Sibling
- nationalities, as before

