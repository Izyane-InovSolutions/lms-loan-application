import kv from '../_lib/kv.js'
import { deleteBlobsForDraft } from '../_lib/blob.js'
import { normalizeEmail, generateToken } from '../_lib/token.js'

const DRAFT_TTL_SECONDS = 7 * 24 * 60 * 60

const pickDraftFields = (body) => {
  const { loanType, currentStep, personalData, businessData, loanData } = body || {}
  return { loanType, currentStep, personalData, businessData, loanData }
}

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
    const draft = {
      ...(existing || {}),
      ...pickDraftFields(req.body),
      documents: existing?.documents || {},
      savedAt: Date.now(),
    }
    await kv.set(`draft:${email}`, draft, { ex: DRAFT_TTL_SECONDS })

    const token = generateToken()
    await kv.set(`draftToken:${token}`, email, { ex: DRAFT_TTL_SECONDS })

    return res.status(200).json({ draftToken: token, draft })
  }

  const tokenAuth = await resolveTokenAuth(req)
  if (!tokenAuth) {
    return res.status(401).json({ message: 'Missing or invalid draft token.' })
  }

  if (req.method === 'PUT') {
    const existing = await kv.get(`draft:${tokenAuth.email}`)
    if (!existing) {
      return res.status(404).json({ message: 'Draft not found.' })
    }
    const draft = {
      ...existing,
      ...pickDraftFields(req.body),
      savedAt: Date.now(),
    }
    await kv.set(`draft:${tokenAuth.email}`, draft, { ex: DRAFT_TTL_SECONDS })
    await kv.expire(`draftToken:${tokenAuth.token}`, DRAFT_TTL_SECONDS)
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
    await kv.del(`draft:${tokenAuth.email}`)
    await kv.del(`draftToken:${tokenAuth.token}`)
    return res.status(200).json({ message: 'Draft cleared.' })
  }

  res.setHeader('Allow', 'POST, PUT, GET, DELETE')
  return res.status(405).json({ message: 'Method not allowed' })
}
