import formidable from 'formidable'
import fs from 'node:fs/promises'
import { fail } from './http.js'
import { checkUpload } from './fileChecks.js'

// Vercel refuses request bodies over 4.5 MB before the function runs; this is the backstop.
const MAX_FILE_SIZE = 4.5 * 1024 * 1024

/**
 * Reads a multipart request carrying one `file` plus text fields. Returns
 * { fields, file: { data, filename, contentType, size } }. Only PDFs and photos are
 * accepted — the formats the wizard asks for.
 */
export const readSingleUpload = async (req) => {
  const form = formidable({ maxFileSize: MAX_FILE_SIZE, maxFiles: 1 })
  let fields
  let files
  try {
    ;[fields, files] = await form.parse(req)
  } catch (error) {
    const tooLarge = error?.code === 1009 || /maxFileSize/i.test(String(error?.message))
    fail(tooLarge ? 413 : 400, tooLarge ? 'That file is too large. Upload a file of 4 MB or less.' : 'Could not read the uploaded file.', tooLarge ? 'file_too_large' : 'bad_upload')
  }
  const file = files.file?.[0]
  if (!file) fail(400, 'Choose a file to upload.', 'invalid_input')
  const data = await fs.readFile(file.filepath)
  await fs.unlink(file.filepath).catch(() => {})
  // Judged by the contents, not the browser's name or type (see fileChecks.js).
  const contentType = await checkUpload(data)
  const flat = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]))
  return { fields: flat, file: { data, filename: file.originalFilename || 'document', contentType, size: file.size } }
}
