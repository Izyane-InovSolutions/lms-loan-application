/*
 * Frappe LMS over its REST methods, called from the server only — the browser never
 * sees these credentials.
 *
 * Everything the LMS team may name differently is configuration (Settings → LMS
 * connection, see SETTING_DEFAULTS.lmsConnection): method paths, the field that carries
 * our reference, the status field and which statuses mean "paid out", timeouts.
 *
 * Authentication:
 *   token      Frappe API key pair, "Authorization: token key:secret" (preferred)
 *   password   the login method, whose session id is then sent as `sid`
 */

const TIMEOUT_UPLOAD_MS = 120000
const TIMEOUT_CREATE_MS = 180000

export class LmsError extends Error {
  constructor(message, { status = null, uncertain = false } = {}) {
    super(message)
    this.name = 'LmsError'
    this.status = status
    // No response came back, so the LMS may or may not have acted on the request.
    this.uncertain = uncertain
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Frappe tucks the human message into `_server_messages` (a JSON string of JSON strings). */
const frappeMessage = (body) => {
  try {
    const first = JSON.parse(body?._server_messages || '[]')[0]
    if (first) return JSON.parse(first).message
  } catch {
    // fall through
  }
  const message = body?.message
  if (typeof message === 'string') return message
  if (typeof message?.message === 'string') return message.message
  return body?.exception || null
}

const listFrom = (body) => {
  const value = body?.message?.data ?? body?.data ?? body?.message
  return Array.isArray(value) ? value : []
}

export const createFrappeLms = (config) => {
  const baseUrl = config.baseUrl
  const methods = config.methods
  const defaultTimeout = Math.max(5, Number(config.timeoutSeconds) || 60) * 1000
  let sid = null

  // Frappe resolves a path against the base like any URL, so a path that names another
  // host ("//elsewhere/…") would take our credentials with it. Only the LMS host is used.
  const lmsUrl = (path) => {
    const url = new URL(path, baseUrl)
    if (url.origin !== new URL(baseUrl).origin) throw new LmsError('The LMS method path must stay on the LMS address.')
    return url
  }

  const login = async () => {
    // In the body, not the query string, where proxies and access logs would keep the password.
    const response = await fetch(lmsUrl(methods.login), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usr: config.username, pwd: config.password }),
      signal: AbortSignal.timeout(defaultTimeout),
    })
    const body = await response.json().catch(() => ({}))
    const nextSid = body?.message?.data?.sid || body?.message?.sid
    if (!response.ok || !nextSid) throw new LmsError(frappeMessage(body) || `LMS sign-in failed (${response.status}).`, { status: response.status })
    sid = nextSid
    return sid
  }

  /**
   * One request. `retry` repeats transient failures (no response, 502–504) — only for
   * calls that are safe to repeat. Creating an application is not.
   */
  const request = async (path, { method = 'GET', params = {}, body, timeout = defaultTimeout, retry = true, raw = false } = {}) => {
    const attempts = retry ? 3 : 1
    let lastError
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const url = lmsUrl(path)
      Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value))
      const headers = typeof body === 'string' ? { 'Content-Type': 'application/json' } : {}
      if (config.authMethod === 'token') headers.Authorization = `token ${config.apiKey}:${config.apiSecret}`
      // Frappe reads the session from its "sid" cookie; kept out of the URL for the same reason.
      else headers.Cookie = `sid=${sid || (await login())}`

      let response
      try {
        response = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeout) })
      } catch (error) {
        lastError = new LmsError(`The LMS did not respond (${error.name === 'TimeoutError' ? 'timed out' : error.message}).`, { uncertain: true })
        if (attempt < attempts) await wait(600 * 2 ** (attempt - 1))
        continue
      }

      // An expired session: sign in again once and repeat.
      if ((response.status === 401 || response.status === 403) && config.authMethod !== 'token' && attempt === 1) {
        sid = null
        continue
      }
      if (raw && response.ok) return response
      const payload = await response.json().catch(() => ({}))
      if (response.ok) return payload
      lastError = new LmsError(frappeMessage(payload) || `The LMS answered ${response.status}.`, { status: response.status })
      if (![502, 503, 504].includes(response.status) || attempt === attempts) break
      await wait(600 * 2 ** (attempt - 1))
    }
    throw lastError
  }

  const listByEmail = async (email) => {
    try {
      return listFrom(await request(methods.byEmail, { params: { email } }))
    } catch (error) {
      // The LMS answers 404 when an email has no applications at all.
      if (error.status === 404) return []
      throw error
    }
  }

  return {
    name: 'frappe',
    referenceField: config.referenceField,

    /** Uploads one file as a private attachment and returns its Frappe file_url. */
    async uploadFile({ data, filename, contentType }) {
      const form = new FormData()
      form.append('file', new Blob([data], { type: contentType || 'application/octet-stream' }), filename)
      form.append('is_private', '1')
      const body = await request(methods.upload, { method: 'POST', body: form, timeout: TIMEOUT_UPLOAD_MS })
      const fileUrl = body?.message?.file_url
      if (!fileUrl) throw new LmsError('The LMS accepted the upload but returned no file URL.')
      return fileUrl
    },

    /** Files the application. Never retried: a lost reply is reported as uncertain instead. */
    async createApplication(payload) {
      const body = await request(methods.create, { method: 'POST', body: JSON.stringify(payload), timeout: TIMEOUT_CREATE_MS, retry: false })
      const message = body?.message
      const reference = message?.name || message?.data?.name || message?.application?.name || null
      return { reference, response: message ?? null }
    },

    listByEmail,

    /**
     * The LMS record carrying our reference, if the LMS already has this application —
     * the duplicate guard before any resend. Null when it cannot tell (field not stored).
     */
    async findByReference(email, reference) {
      if (!config.referenceField) return null
      const rows = await listByEmail(email)
      return rows.find((row) => row?.[config.referenceField] === reference) || null
    },

    /** The LMS status of one of our synced applications, and whether it counts as paid out. */
    async statusOf(email, lmsReference, ourReference) {
      const rows = await listByEmail(email)
      const row = rows.find((entry) => entry?.name === lmsReference || (config.referenceField && entry?.[config.referenceField] === ourReference))
      if (!row) return null
      const status = row[config.statusField] ?? row.status ?? null
      return { status, disbursed: (config.disbursedStatuses || []).some((value) => String(value).toLowerCase() === String(status).toLowerCase()) }
    },

    /** Checks the address and credentials without changing anything. */
    async testConnection() {
      const started = Date.now()
      if (config.authMethod !== 'token') await login()
      await listByEmail('connection-test@example.invalid')
      return { ok: true, milliseconds: Date.now() - started }
    },

    /** Downloads an LMS attachment (for staff viewing an application that came from the LMS). */
    async fetchFile(fileUrl) {
      const response = await request(fileUrl.startsWith('/') ? fileUrl : `/${fileUrl}`, { raw: true })
      return { data: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get('content-type') }
    },
  }
}
