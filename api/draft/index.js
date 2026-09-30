import kv from '../_lib/kv.js'
import { deleteBlobsForDraft } from '../_lib/blob.js'
import { normalizeEmail, generateToken } from '../_lib/token.js'
import { getSessionUser } from '../_lib/auth/sessions.js'
import { can } from '../_lib/rbac.js'
import { attributionFor, resolveReferral } from '../_lib/attribution.js'
import { DRAFT_TTL_SECONDS, ensureDraftId, indexDraft, unindexDraft } from '../_lib/drafts.js'
import { CONSENT_NOTICES } from '../../src/config/consent.js'
// Each alias is a full copy written on every save, so the list is capped rather than
// growing once per edit to the email field. Keeping the most recent few covers the
// realistic case (a typo corrected once or twice) without unbounded writes.
const MAX_DRAFT_ALIASES = 5

const pickDraftFields = (body) => {
  const { loanType, currentStep, personalData, businessData, loanData } = body || {}
  return { loanType, currentStep, personalData, businessData, loanData }
}

// The draft is keyed by email so the OTP flow can find it, but the email lives in the
// form and stays editable. Mirrors getEmail() in useApplicationDraft.js.
const emailFromBody = (body) =>
  normalizeEmail(
    body?.loanType === 'personal'
      ? body?.personalData?.personalInfo?.email
      : body?.businessData?.directorInfo?.applicantEmail
  )

/**
 * Who the draft is credited to, fixed on the first save that can tell: an agent filling it
 * in (`assisted`, with their staff session), else the referral link the applicant came
 * through. A customer's own save never takes a draft away from the agent who started it.
 */
const withAttribution = async (req, draft) => {
  if (draft.attribution?.startedByStaff) return draft
  if (req.body?.assisted) {
    const session = await getSessionUser(req).catch(() => null)
    if (can(session, 'applications.assist')) {
      return { ...draft, attribution: { ...(await attributionFor(session, session.referralCode)), startedByStaff: true } }
    }
  }
  if (!draft.attribution && req.body?.referralCode) {
    const referrer = await resolveReferral(req.body.referralCode)
    if (referrer) return { ...draft, attribution: { ...(await attributionFor(referrer, referrer.referralCode)), startedByStaff: false } }
  }
  return draft
}

/**
 * The applicant's agreement, on the first step, that staff may see this draft and contact
 * them about finishing it. Recorded once, with the wording's version; a later save without
 * it does not undo it (discarding the draft does).
 */
const withContactConsent = (req, draft) => {
  if (draft.contactConsent || req.body?.contactConsent !== true) return draft
  return { ...draft, contactConsent: { at: Date.now(), version: CONSENT_NOTICES.draft_contact.version } }
}

const prepare = async (req, draft) => ensureDraftId(withContactConsent(req, await withAttribution(req, draft)))

const resolveTokenAuth = async (req) => {
  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null
  if (!token) return null
  const email = await kv.get(`draftToken:${token}`)
  return email ? { email, token } : null
}

export default async function handler(req, res) {
  if (req.method === 'POST') {
    const email = normalizeEmail(req.body?.email)
    if (!email) {
      return res.status(400).json({ message: 'A valid email address is required.' })
    }

    const existing = await kv.get(`draft:${email}`)
    const draft = await prepare(req, {
      ...(existing || {}),
      ...pickDraftFields(req.body),
      documents: existing?.documents || {},
      savedAt: Date.now(),
    })
    await kv.set(`draft:${email}`, draft, { ex: DRAFT_TTL_SECONDS })
    await indexDraft(draft, email)

    const token = generateToken()
    await kv.set(`draftToken:${token}`, email, { ex: DRAFT_TTL_SECONDS })

    return res.status(200).json({ draftToken: token, draft })
  }

  const tokenAuth = await resolveTokenAuth(req)
  if (!tokenAuth) {
    return res.status(401).json({ code: 'invalid_token', message: 'Missing or invalid draft token.' })
  }

  if (req.method === 'PUT') {
    // The token outlived its draft: the application was submitted (which deletes the
    // draft), or the draft was replaced from another tab or device. The token still
    // proves whose email this is, so start the draft again rather than refusing the save
    // — refusing left the applicant unable to submit at all.
    const existing = (await kv.get(`draft:${tokenAuth.email}`)) || { documents: {} }
    const draft = await prepare(req, {
      ...existing,
      ...pickDraftFields(req.body),
      savedAt: Date.now(),
    })

    // The draft is keyed by an address the applicant can still edit, so correcting a
    // typo mid-application changes where it belongs. Every address used so far is kept
    // pointing at the current record: resume then works with whichever one they enter,
    // and no key is ever deleted — an earlier version of this moved the record and
    // removed the old key, which silently destroyed drafts mid-session.
    const nextEmail = emailFromBody(req.body) || tokenAuth.email
    const keys = [...new Set([...(existing.aliases || []), tokenAuth.email, nextEmail])].slice(-MAX_DRAFT_ALIASES)
    draft.aliases = keys

    await Promise.all(keys.map((key) => kv.set(`draft:${key}`, draft, { ex: DRAFT_TTL_SECONDS })))
    await kv.set(`draftToken:${tokenAuth.token}`, nextEmail, { ex: DRAFT_TTL_SECONDS })
    await indexDraft(draft, nextEmail)

    return res.status(200).json({ draft })
  }

  if (req.method === 'GET') {
    const draft = await kv.get(`draft:${tokenAuth.email}`)
    if (!draft) {
      return res.status(404).json({ message: 'Draft not found.' })
    }
    return res.status(200).json({ draft })
  }

  if (req.method === 'DELETE') {
    const draft = await kv.get(`draft:${tokenAuth.email}`)
    if (draft) {
      await deleteBlobsForDraft(draft)
    }
    // Clearing has to reach every address the record was written under, or a leftover
    // copy would let a submitted or discarded application resume from the dead.
    const keys = [...new Set([...(draft?.aliases || []), tokenAuth.email])]
    await Promise.all(keys.map((key) => kv.del(`draft:${key}`)))
    await kv.del(`draftToken:${tokenAuth.token}`)
    await unindexDraft(draft?.id)
    return res.status(200).json({ message: 'Draft cleared.' })
  }

  res.setHeader('Allow', 'POST, PUT, GET, DELETE')
  return res.status(405).json({ message: 'Method not allowed' })
}
