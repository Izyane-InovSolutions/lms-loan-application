import formidable from 'formidable'
import fs from 'node:fs/promises'
import kv from '../_lib/kv.js'
import { putBlob } from '../_lib/blob.js'

const DRAFT_TTL_SECONDS = 7 * 24 * 60 * 60
// Vercel caps a function's request body at 4.5 MB and rejects anything larger before
// this handler runs, so a higher limit here would be fiction. Clients validate at 4 MB
// (see DashboardPage) — this is the backstop for anything that skips that check.
const MAX_FILE_SIZE = 4.5 * 1024 * 1024

const resolveEmailFromToken = async (req) => {
  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null
  if (!token) return null
  return kv.get(`draftToken:${token}`)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ message: 'Method not allowed' })
  }

  const email = await resolveEmailFromToken(req)
  if (!email) {
    return res.status(401).json({ message: 'Missing or invalid draft token.' })
  }

  const form = formidable({ maxFileSize: MAX_FILE_SIZE })
  let fields
  let files
  try {
    ;[fields, files] = await form.parse(req)
  } catch (error) {
    // formidable throws on an oversized or malformed upload; without this the throw
    // surfaces as a bare 500 with no JSON body for the client to read a message from.
    const tooLarge = error?.code === 1009 || /maxFileSize/i.test(String(error?.message))
    return res
      .status(tooLarge ? 413 : 400)
      .json({ message: tooLarge ? 'That file is too large. Upload a file of 4 MB or less.' : 'Could not read the uploaded file.' })
  }
  const fieldKey = fields.fieldKey?.[0]
  const file = files.file?.[0]

  if (!fieldKey || !file) {
    return res.status(400).json({ message: 'fieldKey and file are required.' })
  }

  const draft = await kv.get(`draft:${email}`)
  if (!draft) {
    return res.status(404).json({ message: 'Draft not found.' })
  }

  const buffer = await fs.readFile(file.filepath)
  const blob = await putBlob(`drafts/${email}/${fieldKey}-${file.originalFilename}`, buffer, {
    contentType: file.mimetype,
  })
  await fs.unlink(file.filepath).catch(() => {})

  const documentRef = {
    url: blob.url,
    filename: file.originalFilename,
    contentType: file.mimetype,
    size: file.size,
    uploadedAt: Date.now(),
  }

  draft.documents = { ...(draft.documents || {}), [fieldKey]: documentRef }
  draft.savedAt = Date.now()
  await kv.set(`draft:${email}`, draft, { ex: DRAFT_TTL_SECONDS })

  return res.status(200).json({ fieldKey, ...documentRef })
}
