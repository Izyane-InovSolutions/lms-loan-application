# Applicant verification at the start: design

## Intent

Stop someone from starting an application in another person's name or with another person's ID.

A one-time code only proves the applicant controls an email address or phone. So the design has two parts:

1. The code, before the application starts.
2. A link between each ID and the contacts it was verified with. Staff are warned when an ID turns up with a new contact.

Together with the document match and live-photo check that already exist, staff get the signals they need.

## Goals

- **Code before the form is saved.** An applicant can't save the form until they enter a code sent to their email, or by SMS to their phone.
- **Re-check on change.** If they change the verified email or phone, they verify again before they can submit.
- **Warn staff about mismatches.** Staff are warned when the NRC (or passport) on a submission has been used before with different contact details. They're also warned when this verified contact has been used before with a different ID.

## Non-goals

- Blocking, or sending a code to the old contact. The user chose to flag only.
- Checking a phone number's SIM registration name with MTN or Airtel. That needs a provider integration we don't have.
- Changing how an applicant resumes a draft. That stays as it is: a code to the email the draft is saved under.

## Anti-goals

- Genuine customers who changed their phone or email must never be stopped.
- Staff must never be shown another customer's full contact details. They see them masked, plus the earlier application's reference.

## Approaches considered

- **Verify on the first save of step 1 (chosen).** The code dialog appears when they press Continue on the first step. That's when the draft is first created and they have just typed their email and phone. This matches "when they're starting to fill in", and nothing is stored until they've verified.
- **Verify before the form opens.** This would be a separate screen asking for a contact before any questions. But it asks for the email and phone twice, since the form asks for them anyway.
- **Verify only at submission.** This is just as strong against impersonation and has less friction. But it isn't what was asked for, and unverified drafts with someone else's details would sit on the system for up to 7 days.

## Design

### Settings

A new switch, **Settings → Credit workflow → Applicant experience → "Confirm it's them with a code"**, stored as `customerOptions.verifyAtStart`.

- It's on by default.
- It applies to new drafts only.
- Applications from before the switch, or made while it was off, are simply not marked verified.

### The code

- **New purpose `start`** in `api/_lib/otp.js`. Codes are keyed by channel: `otp:start:email:<email>` and `otp:start:phone:<+260…>`. The existing limits apply: 10-minute expiry, a 60-second wait between requests, hourly and daily caps, and limited wrong guesses.
- **Phone codes** go out with `textCustomer` (`api/_lib/sms.js`), in E.164 format via `toZambianE164`.
- **Choosing a channel:** the applicant picks email or phone. The phone option appears only when an SMS provider is set up. Otherwise the dialog sends to their email without asking.
- **Local testing:** `LOS_DEV_LOG_CODES` prints the code in local dev, as it already does for email.

### Starting the draft

1. `POST /draft` takes `verification: { channel, code }`.
2. The server checks the code against the email or phone in the form before creating anything.
3. The draft records `verified: { channel, value, at }`.
4. Without a valid code the request is refused with `401 verification_required`. The wizard then opens the code dialog.
5. **Agent-assisted drafts skip this step.** The customer's consent code at submission already confirms them.

### Changing the verified contact

- Later `PUT /draft` saves are allowed with a changed email or phone.
- At submission, the server compares the verified value with the form's current one for that channel. If they differ, it refuses with `409 verification_required`.
- The wizard then shows the code dialog for the new value and records the new verification on the draft.

### On the application

New jsonb column `applications.contact_verification`, set by the server from the draft and never from the request:

```
{ channel, value, at }
```

This needs migration 0018, written by hand.

### Staff warning: ID and contact mismatch

At submission, the server looks for earlier applications:

- **Same ID, different contact:** the same NRC, or passport number for non-Zambians, used with a different email or phone.
- **Same contact, different ID:** this verified email or phone used with a different NRC or passport.

For personal loans this uses the applicant's ID. For business loans it uses the applying director's.

If anything matches, the server:

- **Stores the matches** as `applications.identity_flags`, in the same migration:
  - kind: `id_other_contact` or `contact_other_id`
  - the earlier application's reference
  - the masked contact or ID
  - whether that contact was verified
- **Adds a timeline event** saying what was found.
- **Shows a warning** at the top of the case page. Staff who can see the earlier application get a link to it.
- **Adds a pre-screening fact**, `id_contact_mismatch` (yes or no), so admins can write a rule that refers these cases. No rule is added by default. (Built as `id_contact_mismatch`, because `identity_mismatches` already names the document name/NRC mismatch count.)

### Masking

- **Emails** show the first letter and the domain: `a…@gmail.com`.
- **Phones** show the last three digits: `+260 9…456`.
- **IDs** show the last four characters.

## Left to the builder

- The code dialog's exact wording and layout. It reuses the resume dialog's style.
- Index choices for the lookup, for example on `applicant_phone`.

## Revision 2026-11-21: confirm before the form opens

At the user's request the code now comes before any question (the "verify before the form opens" approach above).

- A start screen, "First, confirm it's you", takes the email, plus a mobile number when texts can be sent. The applicant confirms one of them with a code.
- The form then opens with those details filled in, and the draft is saved with the ticket.
- **Who skips the start screen:**
  - agents' customers
  - drafts that already have a server copy (for example, resumed with the emailed code)
  - while the "resume or start fresh" choice for this device's copy is open
- The dialog stays as a fallback for submitting with changed contact details, or for reaching a save without the start screen.

