import { DEFAULT_BRAND_NAME } from './branding.js'

/**
 * The exact consent wording shown to applicants. Each consent row stores the version it
 * was given against, so change the version whenever the words change — never edit a
 * published version in place.
 *
 * `{name}` is the brand name from Settings → Branding (consentText fills it in). A name
 * change is recorded in the audit log, so the wording given at any moment can be told
 * from the version plus the name in force then; the version covers the rest.
 */
export const CONSENT_NOTICES = {
  data_processing: {
    version: 'dp-2026-09b',
    text:
      'I agree that {name} may use the information and documents in this application to assess it, verify my identity and ' +
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
    version: 'draft-2026-10',
    text:
      'The {name} team may see this application while you fill it in, and contact you by phone or email to help you ' +
      'finish it. We save your progress as you go; an unfinished application is deleted after 7 days without changes.',
  },
  crb: {
    version: 'crb-2026-09b',
    text:
      'I authorise {name} to request my credit report from a licensed credit reference bureau to assess this application.',
  },
}

/** The wording of a notice with the brand name filled in. */
export const consentText = (type, name = DEFAULT_BRAND_NAME) => (CONSENT_NOTICES[type]?.text || '').replaceAll('{name}', name || DEFAULT_BRAND_NAME)
