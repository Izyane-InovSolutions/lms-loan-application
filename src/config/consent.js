/**
 * The exact consent wording shown to applicants. Each consent row stores the version it
 * was given against, so change the version whenever the words change — never edit a
 * published version in place.
 */
export const CONSENT_NOTICES = {
  data_processing: {
    version: 'dp-2026-09b',
    text:
      'I agree that Loan Origination may use the information and documents in this application to assess it, verify my identity and ' +
      'income, and manage any loan that follows, as described in the terms. Staff access is recorded.',
  },
  location: {
    version: 'loc-2026-09',
    text:
      'Share my current location with this application. It helps prevent someone applying in my name and is only seen by ' +
      'staff reviewing it. This is optional.',
  },
  // Asked on the first step, before anything is saved to our servers.
  draft_contact: {
    version: 'draft-2026-09b',
    text:
      'I agree that the Loan Origination team may see this application while I fill it in, and contact me by phone or email to ' +
      'help me finish it. We save your progress as you go; an unfinished application is deleted after 7 days without changes.',
  },
  crb: {
    version: 'crb-2026-09b',
    text:
      'I authorise Loan Origination to request my credit report from a licensed credit reference bureau to assess this application.',
  },
}
