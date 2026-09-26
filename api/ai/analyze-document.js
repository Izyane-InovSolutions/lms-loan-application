import formidable from 'formidable'
import fs from 'node:fs/promises'
import kv from '../_lib/kv.js'
import { consumeAiQuota } from '../_lib/aiQuota.js'
import { getAiProvider, AiUnavailableError, AiUnsupportedInputError } from '../_lib/ai/index.js'
import { DOCUMENT_SPECS, analyzeDocument } from '../_lib/ai/documents.js'

// Same backstop as api/draft/documents.js: Vercel rejects bodies over 4.5 MB before this
// handler runs, and the client already caps files at 4 MB.
const MAX_FILE_SIZE = 4.5 * 1024 * 1024

const resolveEmailFromToken = async (req) => {
  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null
  if (!token) return null
  return kv.get(`draftToken:${token}`)
}

const normalizeMimeType = (file) => {
  const declared = (file.mimetype || '').toLowerCase()
  if (declared === 'application/pdf' || declared.startsWith('image/')) return declared
  // Some browsers send an empty or generic type for PDFs picked from cloud drives.
  return /\.pdf$/i.test(file.originalFilename || '') ? 'application/pdf' : declared
}

/**
 * POST multipart { docType, file } with the applicant's draft token.
 *
 * 200 { status: 'analyzed', analysis }  — findings for the upload
 * 200 { status: 'skipped', reason }     — the configured model cannot read this file type
 * 503 { code: 'ai_unavailable' }        — no provider configured; clients hide the feature
 *
 * Nothing is stored server-side: the result is returned to the wizard, which shows it
 * under the upload and later passes it to /api/ai/prescreen.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ message: 'Method not allowed' })
  }

  const email = await resolveEmailFromToken(req)
  if (!email) {
    return res.status(401).json({ message: 'Missing or invalid draft token.' })
  }

  const provider = getAiProvider()
  if (!provider) {
    return res.status(503).json({ code: 'ai_unavailable', message: new AiUnavailableError().message })
  }

  const form = formidable({ maxFileSize: MAX_FILE_SIZE })
  let fields
  let files
  try {
    ;[fields, files] = await form.parse(req)
  } catch (error) {
    const tooLarge = error?.code === 1009 || /maxFileSize/i.test(String(error?.message))
    return res
      .status(tooLarge ? 413 : 400)
      .json({ message: tooLarge ? 'That file is too large to check.' : 'Could not read the uploaded file.' })
  }

  const docType = fields.docType?.[0]
  const file = files.file?.[0]
  if (!file || !DOCUMENT_SPECS[docType]) {
    if (file) await fs.unlink(file.filepath).catch(() => {})
    return res.status(400).json({ message: 'A known docType and a file are required.' })
  }

  try {
    const mimeType = normalizeMimeType(file)
    if (!provider.acceptsMimeType(mimeType)) {
      return res.status(200).json({ status: 'skipped', reason: `${provider.model} cannot read ${mimeType || 'this file type'}.` })
    }

    if (!(await consumeAiQuota(email))) {
      return res.status(429).json({ message: 'Daily document check limit reached.' })
    }

    const data = await fs.readFile(file.filepath)
    const analysis = await analyzeDocument({ docType, file: { mimeType, data } })
    return res.status(200).json({ status: 'analyzed', analysis })
  } catch (error) {
    if (error instanceof AiUnsupportedInputError) {
      return res.status(200).json({ status: 'skipped', reason: error.message })
    }
    console.error('[ai] document analysis failed', { docType, error: String(error?.message || error) })
    return res.status(502).json({ message: 'Document check failed.' })
  } finally {
    await fs.unlink(file.filepath).catch(() => {})
  }
}
