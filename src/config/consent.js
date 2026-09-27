/**
 * The exact consent wording shown to applicants. Each consent row stores the version it
 * was given against, so change the version whenever the words change — never edit a
 * published version in place.
 */
export const CONSENT_NOTICES = {
  data_processing: {
    version: 'dp-2026-09',
    text:
      'I agree that iZyane may use the information and documents in this application to assess it, verify my identity and ' +
      'income, and manage any loan that follows, as described in the terms. Staff access is recorded.',
  },
  location: {
    version: 'loc-2026-09',
    text:
      'Share my current location with this application. It helps prevent someone applying in my name and is only seen by ' +
      'staff reviewing it. This is optional.',
  },
  crb: {
    version: 'crb-2026-09',
    text:
      'I authorise iZyane to request my credit report from a licensed credit reference bureau to assess this application.',
  },
}
