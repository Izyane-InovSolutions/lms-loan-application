import { fail, text } from '../_lib/http.js'
import { requireUser } from '../_lib/rbac.js'
import { recordAudit } from '../_lib/audit.js'
import { getSetting } from '../_lib/settings.js'
import { ipOf, rateKey, underLimit } from '../_lib/rateLimit.js'
import { cleanKycId, kycAvailability, lookUpAndKeep, maskedContacts } from '../_lib/kyc/lookups.js'
import { KYC_ID_TYPES } from '../../src/config/kyc.js'

/*
 * Looking a customer up on the institution's platform as an application starts
 * (docs/superpowers/specs/2026-11-21-kyc-lookup-design.md):
 *
 *   POST /kyc/lookup           { idType, id } — public. Says only whether there is a record and
 *                              the masked contacts on it; the record stays on the server until
 *                              the applicant confirms a code (verification.js).
 *   POST /kyc/lookup/assisted  { idType, id } — agents (applications.assist): the values at once,
 *                              no code. Audited.
 */


const readRequest = async (body) => {
  const available = await kycAvailability()
  const idType = body?.idType
  if (!available || !Object.hasOwn(KYC_ID_TYPES, idType) || !available[idType]) fail(404, 'Customer lookups aren’t available.', 'kyc_off')
  const id = cleanKycId(idType, text(body?.id, 40))
  if (!id) fail(400, idType === 'nrc' ? 'Enter your NRC as 123456/78/9.' : idType === 'tpin' ? 'Enter the 10-digit TPIN.' : 'Enter your passport number: 6 to 12 letters and numbers.', 'invalid_id')
  return { idType, id }
}

const lookup = async (req) => {
  const { idType, id } = await readRequest(req.body)
  // Settings → Customer records → Lookup limits.
  const { limits } = await getSetting('kyc')
  if (
    !(await underLimit(rateKey('kyc-lookup-ip', ipOf(req)), limits.perIpPerHour, 60 * 60)) ||
    !(await underLimit(rateKey('kyc-lookup-id', `${idType}:${id}`), limits.perIdPerHour, 60 * 60))
  ) {
    fail(429, 'Too many lookups. Please try again later, or fill the form in yourself.', 'rate_limited')
  }
  const { reference, entry } = await lookUpAndKeep(idType, id)
  const { otherContact } = await getSetting('kyc')
  const contacts = maskedContacts(entry)
  // A record no code can reach (no contact on it) is treated as no record.
  const reachable = entry.found && Boolean(contacts.mobile || contacts.email)
  return {
    found: reachable,
    reference,
    id,
    ...(reachable ? { contacts, otherContactAllowed: otherContact.policy !== 'refuse' } : {}),
  }
}

const assistedLookup = async (req) => {
  const actor = await requireUser(req, { permission: 'applications.assist' })
  const { idType, id } = await readRequest(req.body)
  const { reference, entry } = await lookUpAndKeep(idType, id, { by: actor.id })
  await recordAudit({ req, actor, action: 'kyc.looked_up', entityType: 'customer', entityId: `${idType}:${id.slice(-4)}`, detail: { idType, found: entry.found, failed: entry.failed } })
  return { found: entry.found, failed: entry.failed, reference, id, idField: entry.idField, values: entry.found ? entry.values : {} }
}

export const kycRoutes = [
  ['POST', '/kyc/lookup', lookup],
  ['POST', '/kyc/lookup/assisted', assistedLookup],
]
