import kv from '../kv.js'
import { generateToken } from '../token.js'
import { getSetting } from '../settings.js'
import { reportError } from '../errors.js'
import { kycLookup } from './client.js'
import { normaliseId } from '../identityFlags.js'
import { ID_FIELDS, KYC_ID_TYPES, KYC_PRESETS, maskContactEmail, maskMobile } from '../../../src/config/kyc.js'
import { isNrc, normaliseNrc } from '../../../src/config/partners.js'
import { isValidPassportNumber } from '../../../src/config/applicantRules.js'

/*
 * Looked-up customer records, kept on the server (never in the browser) until they are
 * used: under a reference for 30 minutes while the applicant confirms a code, then with
 * the draft (kyc-draft:<draft id>) until the application is submitted. Only the mapped
 * fields are kept, never the platform's whole answer.
 */

export const LOOKUP_TTL_SECONDS = 30 * 60
const DRAFT_TTL_SECONDS = 7 * 24 * 60 * 60

const lookupKey = (reference) => `kyc-lookup:${reference}`
const draftKey = (draftId) => `kyc-draft:${draftId}`

/** The ID as the platform is asked for it, or null when it isn't one: NRC 123456/78/9, a passport, or a 10-digit TPIN. */
export const cleanKycId = (idType, value) => {
  if (idType === 'nrc') {
    const digits = normaliseNrc(value).replace(/\D/g, '')
    const nrc = digits.length === 9 ? `${digits.slice(0, 6)}/${digits.slice(6, 8)}/${digits.slice(8)}` : normaliseNrc(value)
    return isNrc(nrc) ? nrc : null
  }
  if (idType === 'passport') {
    const passport = String(value || '').replace(/\s/g, '').toUpperCase()
    return isValidPassportNumber(passport) ? passport : null
  }
  if (idType === 'tpin') {
    const tpin = String(value || '').replace(/\D/g, '')
    return tpin.length === 10 ? tpin : null
  }
  return null
}

/** The lookups switched on, for the apply form: { nrc: true, passport: false, tpin: true }; null when off. */
export const kycAvailability = async () => {
  const config = await getSetting('kyc')
  if (!config.enabled) return null
  return Object.fromEntries(Object.keys(KYC_ID_TYPES).map((type) => [type, Boolean(config.lookups?.[type]?.enabled && config.lookups[type].path)]))
}

/**
 * Looks `id` up and keeps what was found under a new reference. Returns { found, reference,
 * entry } or { found: false, failed } — the platform's failure is reported for staff, and
 * the applicant simply fills the form in.
 */
export const lookUpAndKeep = async (idType, id, { by = null } = {}) => {
  const config = await getSetting('kyc')
  const result = await kycLookup(config, idType, id)
  if (result.status === 'error') {
    // Our own wording and the HTTP status only: the platform's answer may hold personal details.
    await reportError({ source: 'kyc', message: result.error, route: 'customer lookup', detail: { idType, httpStatus: result.httpStatus } })
  }
  const entry = {
    found: result.status === 'found',
    failed: result.status === 'error',
    idType,
    id,
    form: KYC_ID_TYPES[idType].form,
    idField: ID_FIELDS[idType],
    values: result.values || {},
    contacts: result.contacts || {},
    source: KYC_PRESETS[config.preset]?.label || 'Custom',
    by,
    at: new Date().toISOString(),
  }
  const reference = generateToken()
  await kv.set(lookupKey(reference), entry, { ex: LOOKUP_TTL_SECONDS })
  return { reference, entry }
}

export const getLookup = async (reference) => (typeof reference === 'string' && /^[0-9a-f]{48}$/.test(reference) ? kv.get(lookupKey(reference)) : null)

/** The masked contacts on record an applicant chooses between. */
export const maskedContacts = (entry) => ({ mobile: maskMobile(entry.contacts?.mobile), email: maskContactEmail(entry.contacts?.email) })

/** The values an applicant who confirmed `contact` ('record', 'other' or 'agent') may have filled in. */
export const valuesFor = (entry, contact, otherContact = { policy: 'none' }) => {
  if (!entry?.found) return {}
  if (contact === 'record' || contact === 'agent') return entry.values
  if (otherContact.policy === 'all') return entry.values
  if (otherContact.policy === 'fields') return Object.fromEntries(Object.entries(entry.values).filter(([field]) => otherContact.fields.includes(field)))
  return {}
}

/** Keeps the lookup with the draft, with how the applicant confirmed, until it is submitted. */
export const attachToDraft = async (draftId, reference, contact) => {
  const entry = await getLookup(reference)
  if (!entry || !draftId) return null
  await kv.set(draftKey(draftId), { ...entry, contact }, { ex: DRAFT_TTL_SECONDS })
  return { reference, contact }
}

export const draftLookup = (draftId) => (draftId ? kv.get(draftKey(draftId)) : null)
export const forgetDraftLookup = (draftId) => (draftId ? kv.del(draftKey(draftId)) : null)

/**
 * What the application keeps of the lookup (applications.kyc): what the record held and
 * how the applicant confirmed. The values only when the ID submitted is the one looked up.
 */
export const applicationKyc = (entry, submittedId) => {
  if (!entry) return null
  const sameId = normaliseId(entry.id) === normaliseId(submittedId)
  return {
    found: entry.found,
    failed: entry.failed || false,
    source: entry.source,
    idType: entry.idType,
    contact: sameId ? entry.contact : 'none',
    idChanged: !sameId,
    contactsOnRecord: maskedContacts(entry),
    values: sameId ? entry.values : {},
    at: entry.at,
  }
}
