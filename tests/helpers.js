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
  const call = async (method, path, body, extraHeaders = {}) => {
    const req = {
      method,
      url: `/api/v1${path}`,
      headers: { host: 'localhost', cookie, ...(origin ? { origin } : {}), ...extraHeaders },
      body,
      socket: { remoteAddress: '127.0.0.1' },
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
    patch: (path, body = {}) => call('PATCH', path, body),
    put: (path, body = {}) => call('PUT', path, body),
    del: (path) => call('DELETE', path),
    get cookie() {
      return cookie
    },
  }
}
