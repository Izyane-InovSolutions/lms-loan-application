import crypto from 'node:crypto'
import zlib from 'node:zlib'
import { Readable } from 'node:stream'

/*
 * Drives API handlers in-process with minimal stand-ins for Node's req/res, the same
 * surface Vercel and the dev server hand them.
 */

export const createMemoryKv = () => {
  const map = new Map()
  const live = (key) => {
    const entry = map.get(key)
    if (!entry) return undefined
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      map.delete(key)
      return undefined
    }
    return entry
  }
  return {
    async get(key) {
      return live(key)?.value ?? null
    },
    async set(key, value, options = {}) {
      const existing = live(key)
      // Redis SET NX: nothing written, and null back, when the key is already there.
      if (options.nx && existing) return null
      const expiresAt = options.ex ? Date.now() + options.ex * 1000 : options.keepTtl ? existing?.expiresAt ?? null : null
      map.set(key, { value, expiresAt })
      return 'OK'
    },
    async del(key) {
      map.delete(key)
    },
    async incr(key) {
      const existing = live(key)
      const value = (Number(existing?.value) || 0) + 1
      map.set(key, { value, expiresAt: existing?.expiresAt ?? null })
      return value
    },
    async expire(key, seconds) {
      const existing = live(key)
      if (existing) existing.expiresAt = Date.now() + seconds * 1000
    },
    async exists(key) {
      return live(key) ? 1 : 0
    },
  }
}

const createRes = () => {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    headersSent: false,
    writableEnded: false,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value
    },
    status(code) {
      this.statusCode = code
      return this
    },
    json(body) {
      this.body = body
      this.headersSent = true
      this.writableEnded = true
      return this
    },
    end(data) {
      this.body = data
      this.headersSent = true
      this.writableEnded = true
    },
  }
  return res
}

/**
 * A client with its own cookie jar, like one browser.
 *   const admin = client(handler); await admin.post('/auth/demo', { role: 'admin' })
 */
export const client = (handler, { origin } = {}) => {
  let cookie = ''
  const call = async (method, path, body, extraHeaders = {}, rawBody = null) => {
    const fields = {
      method,
      url: `/api/v1${path}`,
      headers: { host: 'localhost', cookie, ...(origin ? { origin } : {}), ...extraHeaders },
      body,
      socket: { remoteAddress: '127.0.0.1' },
    }
    // A raw body (a multipart upload) arrives as a stream, as from a real browser.
    let req = fields
    if (rawBody) {
      req = Object.assign(new Readable({ read() {} }), fields)
      req.push(rawBody)
      req.push(null)
    }
    const res = createRes()
    await handler(req, res)
    const setCookie = res.headers['set-cookie']
    if (setCookie) {
      const [pair] = String(setCookie).split(';')
      cookie = pair.endsWith('=') ? '' : pair
    }
    return { status: res.statusCode, body: res.body, headers: res.headers }
  }
  return {
    get: (path, headers) => call('GET', path, undefined, headers),
    post: (path, body = {}, headers) => call('POST', path, body, headers),
    patch: (path, body = {}, headers) => call('PATCH', path, body, headers),
    put: (path, body = {}, headers) => call('PUT', path, body, headers),
    del: (path, headers) => call('DELETE', path, undefined, headers),
    /** A multipart/form-data POST with one `file`, as the workspace's upload buttons send. */
    upload: (path, { filename, contentType, data, fields = {} }, headers) => {
      const boundary = `----test${crypto.randomBytes(8).toString('hex')}`
      const raw = Buffer.concat([
        ...Object.entries(fields).map(([key, value]) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`)),
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`),
        data,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ])
      return call('POST', path, undefined, { 'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': String(raw.length), ...headers }, raw)
    },
    get cookie() {
      return cookie
    },
  }
}

const PDF = Buffer.from('%PDF-1.4\n% test\n')

/**
 * Puts a ready-to-submit draft in place, as the wizard would have: files in storage,
 * record in Redis. `kv` and `putBlob` are the test file's own (mocked) stores.
 */
export const draftPreparer = (kv, putBlob) => async (email, { withNrc = true } = {}) => {
  const token = crypto.randomBytes(12).toString('hex')
  const slots = ['payslips', 'bankStatements', 'passportPhoto', 'tpin', ...(withNrc ? ['nrcCopy'] : [])]
  const documents = {}
  const dataDocuments = {}
  for (const slot of slots) {
    const path = `personal.documents.${slot}`
    const stored = await putBlob(`drafts/${email}/${slot}-file.pdf`, PDF, { contentType: 'application/pdf' })
    documents[path] = { ...stored, filename: `${slot}.pdf`, contentType: 'application/pdf', size: PDF.length }
    dataDocuments[slot] = { __draftFile__: path }
  }
  await kv.set(`draft:${email}`, { documents })
  await kv.set(`draftToken:${token}`, email)
  // The server's own AI result for the payslip: net pay makes debt-to-income computable.
  await kv.set(`aiAnalysis:${email}:payslips`, {
    analysis: { docType: 'payslips', matchesExpectedType: true, legibility: 'clear', extracted: { holderName: 'Ada Banda', netPay: '10000' }, issues: [], authenticityConcerns: [] },
    filename: 'payslips.pdf',
    size: PDF.length,
  })
  return {
    token,
    body: {
      submissionKey: crypto.randomUUID(),
      loanType: 'personal',
      loanData: { amount: 5000, tenure: 6 },
      consents: { dataProcessing: true, location: true, crb: true },
      location: { latitude: -15.41, longitude: 28.28, accuracy: 20 },
      data: {
        personalInfo: { firstName: 'Ada', middleName: '', surname: 'Banda', phone: '971234567', email, nrc: '123456/78/9', birthDate: '1990-05-01' },
        employmentInfo: { residentialAddress: 'Lusaka', occupation: 'Teacher', employerName: 'MoE' },
        documents: dataDocuments,
      },
    },
  }
}

/** A small PNG (a diagonal stroke, transparent background), standing in for a drawn signature. */
export const signaturePng = (width = 300, height = 100) => {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf) => {
    let c = 0xffffffff
    for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const check = Buffer.alloc(4)
    check.writeUInt32BE(crc(body))
    return Buffer.concat([length, body, check])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  const rows = []
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4)
    for (let x = 0; x < width; x += 1) row.writeUInt32BE(Math.abs((x * height) / width - y) < 2 ? 0x1a2230ff : 0, 1 + x * 4)
    rows.push(row)
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))])
}

/** Puts a code in `kv` as if it had been emailed to `email` for `purpose` (api/_lib/otp.js). */
export const emailCode = (kv, purpose, email, code) => kv.set(`otp:${purpose}:${email}`, { id: crypto.randomUUID(), code, createdAt: Date.now() }, { ex: 600 })

/**
 * What a customer (or staff, for an in-person acceptance) sends to accept a signed offer:
 * a drawn signature and the emailed code, which is put in `kv` as if it had been emailed —
 * for signing it themselves ("sign") and in person ("offer") alike.
 */
export const signedAcceptance = async (kv, email, { name = 'Ada Banda', code = '777888' } = {}) => {
  await Promise.all(['sign', 'offer'].map((purpose) => emailCode(kv, purpose, email, code)))
  return { agreed: true, code, signature: { name, method: 'drawn', image: `data:image/png;base64,${signaturePng().toString('base64')}` } }
}
