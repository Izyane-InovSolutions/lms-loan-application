import kv from '../_lib/kv.js'
import { consumeAiQuota } from '../_lib/aiQuota.js'
import { getAiProvider, AiUnavailableError, classifyAiFailure } from '../_lib/ai/index.js'
import { prescreenApplication } from '../_lib/ai/prescreen.js'

const resolveEmailFromToken = async (req) => {
  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null
  if (!token) return null
  return kv.get(`draftToken:${token}`)
}

/**
 * POST { loanType, applicant, loan, documents } with the applicant's draft token.
 *
 * `applicant` is the wizard's personalData / businessData section objects; only a
 * handful of non-sensitive fields are taken from it (see pickApplicant). `documents`
 * carries each slot's analysis from /api/ai/analyze-document plus the form mismatches
 * the client computed.
 *
 * Returns { prescreen }. The response holds the staff-only verdict as well as the
 * applicant guidance, because the browser is what forwards the application to the LMS;
 * the wizard only ever renders applicantGuidance.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ message: 'Method not allowed' })
  }

  const email = await resolveEmailFromToken(req)
  if (!email) {
    return res.status(401).json({ code: 'invalid_token', message: 'Missing or invalid draft token.' })
  }

  if (!(await getAiProvider())) {
    return res.status(503).json({ code: 'ai_unavailable', message: new AiUnavailableError().message })
  }

  const { loanType, applicant, loan, documents } = req.body || {}
  if (!['personal', 'business'].includes(loanType) || !loan) {
    return res.status(400).json({ message: 'loanType and loan are required.' })
  }

  if (!(await consumeAiQuota(email))) {
    return res.status(429).json({ code: 'quota_exceeded', message: 'Daily prescreen limit reached.' })
  }

  try {
    const prescreen = await prescreenApplication({ loanType, applicant, loan, documents })
    return res.status(200).json({ prescreen })
  } catch (error) {
    const failure = classifyAiFailure(error)
    console.error('[ai] prescreen failed', { loanType, code: failure.code, error: String(error?.message || error) })
    return res.status(failure.status).json({ code: failure.code, message: failure.message })
  }
}
