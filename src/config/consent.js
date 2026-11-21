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
    version: 'loc-2026-10',
    text:
      'We record your current location when you submit, to help prevent someone applying in your name. Your browser will ' +
      'ask you to allow it. Only staff reviewing your application see it.',
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
  // When the workspace makes the check part of every application (Settings → Credit bureau,
  // askConsent off): shown as a notice, not a choice, and recorded as shown.
  crb_notice: {
    version: 'crb-notice-2026-11',
    text: 'As part of assessing this application, {name} will request your credit report from a licensed credit reference bureau.',
  },
  // A product pre-approved for an employer's staff (src/config/partners.js): shown, and recorded as shown.
  partner_notice: {
    version: 'partner-notice-2026-11',
    text:
      'This loan is pre-approved for {partner} staff. To confirm you work there, {name} shares your name, NRC or passport number, ' +
      'date of birth, phone number, occupation and employer, with your ID copy, photo and payslips, with {partner}.',
  },
}

/**
 * Whether an application's consent rows allow a credit bureau check: the applicant ticked
 * the consent, or was shown the notice that the check is part of every application.
 */
export const allowsCreditCheck = (consents = []) => consents.some((consent) => (consent.type === 'crb' || consent.type === 'crb_notice') && consent.granted)

/** The wording of a notice with the brand name filled in. */
export const consentText = (type, name = DEFAULT_BRAND_NAME, { partner = 'your employer' } = {}) =>
  (CONSENT_NOTICES[type]?.text || '').replaceAll('{name}', name || DEFAULT_BRAND_NAME).replaceAll('{partner}', partner || 'your employer')
