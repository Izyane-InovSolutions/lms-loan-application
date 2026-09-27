import net from 'node:net'
import { fail } from './http.js'

/*
 * What an upload really is, and whether it is safe to keep.
 *
 * The browser's file name and content type are claims; the first bytes are facts. Every
 * upload is accepted only if its contents are a PDF or a photo format we take.
 *
 * Virus scanning is optional: set CLAMAV_HOST (and CLAMAV_PORT, default 3310) to a clamd
 * server and each file is streamed to it before it is stored. If the scanner cannot be
 * reached the upload is still accepted and the failure logged — unless
 * CLAMAV_REQUIRED=true, which refuses uploads while scanning is down.
 */

const startsWith = (buffer, bytes, offset = 0) => bytes.every((byte, index) => buffer[offset + index] === byte)

/** The real type from the file's signature, or null for anything we do not accept. */
export const sniffType = (buffer) => {
  if (!buffer || buffer.length < 12) return null
  if (startsWith(buffer, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf' // %PDF-
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) && startsWith(buffer, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp'
  // HEIC/HEIF: an ISO box "ftyp" with a heic-family brand (iPhone photos).
  if (startsWith(buffer, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = buffer.subarray(8, 12).toString('ascii')
    if (['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) return 'image/heic'
  }
  return null
}

/**
 * Throws a 400 unless the contents are an accepted type. `allowed` narrows it (e.g.
 * ['application/pdf'] for slots that take PDFs only). Returns the detected type, which
 * is what should be stored — never the browser's claim.
 */
export const assertAcceptableFile = (buffer, { allowed } = {}) => {
  const detected = sniffType(buffer)
  if (!detected) fail(400, 'This file isn’t a PDF or a photo we can accept. Upload a PDF, JPG or PNG.', 'unsupported_type')
  if (allowed && !allowed.includes(detected)) {
    fail(400, allowed.length === 1 && allowed[0] === 'application/pdf' ? 'Upload this document as a PDF.' : 'This file type isn’t accepted here.', 'unsupported_type')
  }
  return detected
}

const CHUNK = 64 * 1024

/** Streams the file to clamd (INSTREAM). Resolves { clean, signature } or rejects if unreachable. */
const clamdScan = (buffer, { host, port, timeoutMs = 15000 }) =>
  new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port })
    let reply = ''
    const done = (error, result) => {
      socket.destroy()
      if (error) reject(error)
      else resolve(result)
    }
    socket.setTimeout(timeoutMs, () => done(new Error('scanner timed out')))
    socket.on('error', (error) => done(error))
    socket.on('data', (data) => {
      reply += data.toString('utf8')
    })
    socket.on('end', () => {
      const text = reply.replace(/\0/g, '').trim()
      if (/OK$/.test(text)) done(null, { clean: true })
      else if (/FOUND$/.test(text)) done(null, { clean: false, signature: text.replace(/^stream:\s*/, '').replace(/\s*FOUND$/, '') })
      else done(new Error(`unexpected scanner reply: ${text.slice(0, 80)}`))
    })
    socket.on('connect', () => {
      socket.write('zINSTREAM\0')
      for (let offset = 0; offset < buffer.length; offset += CHUNK) {
        const chunk = buffer.subarray(offset, offset + CHUNK)
        const size = Buffer.alloc(4)
        size.writeUInt32BE(chunk.length)
        socket.write(size)
        socket.write(chunk)
      }
      socket.write(Buffer.alloc(4))
    })
  })

/** Refuses infected files when a scanner is configured. See the header for the fail-open rule. */
export const assertVirusFree = async (buffer) => {
  const host = (process.env.CLAMAV_HOST || '').trim()
  if (!host) return
  try {
    const result = await clamdScan(buffer, { host, port: Number(process.env.CLAMAV_PORT) || 3310 })
    if (!result.clean) {
      console.warn(`[scan] rejected an upload: ${result.signature}`)
      fail(400, 'This file failed our security scan and wasn’t accepted. Upload a different copy.', 'infected')
    }
  } catch (error) {
    if (error?.status) throw error
    console.warn(`[scan] could not scan an upload: ${error?.message}`)
    if (process.env.CLAMAV_REQUIRED === 'true') fail(503, 'We can’t check uploads right now. Try again in a few minutes.', 'scan_unavailable')
  }
}

/** Both checks, returning the detected content type. */
export const checkUpload = async (buffer, options) => {
  const type = assertAcceptableFile(buffer, options)
  await assertVirusFree(buffer)
  return type
}
