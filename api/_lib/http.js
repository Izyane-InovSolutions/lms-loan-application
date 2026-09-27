/*
 * Request plumbing for the /api/v1 router: errors that carry a status, a tiny path
 * matcher, and the checks every mutating request goes through.
 */

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message)
    this.status = status
    this.code = code
  }
}

/** Throws an HttpError. `code` is a stable machine-readable reason the client can branch on. */
export const fail = (status, message, code) => {
  throw new HttpError(status, message, code)
}

export const parseCookies = (req) =>
  Object.fromEntries(
    (req.headers.cookie || '')
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=')
        return index === -1 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))]
      })
  )

export const clientIp = (req) =>
  String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || null

/** Origin used in emailed links. APP_URL wins so links never point at a preview host by accident. */
export const appOrigin = (req) => {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '')
  const host = req.headers['x-forwarded-host'] || req.headers.host
  const proto = req.headers['x-forwarded-proto'] || (process.env.VERCEL ? 'https' : 'http')
  return `${proto}://${host}`
}

/*
 * Session cookies are SameSite=Lax, which already stops cross-site POSTs from carrying
 * them. Checking Origin as well closes the remaining gaps (older browsers, same-site
 * subdomains) for every request that changes something.
 */
const assertSameOrigin = (req) => {
  const origin = req.headers.origin
  if (!origin) return
  const host = req.headers['x-forwarded-host'] || req.headers.host
  let originHost
  try {
    originHost = new URL(origin).host
  } catch {
    fail(403, 'Cross-origin requests are not allowed.', 'cross_origin')
  }
  if (originHost !== host) fail(403, 'Cross-origin requests are not allowed.', 'cross_origin')
}

const compile = (pattern) => {
  const keys = []
  const source = pattern
    .split('/')
    .map((segment) => {
      if (!segment.startsWith(':')) return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      keys.push(segment.slice(1))
      return '([^/]+)'
    })
    .join('/')
  return { regex: new RegExp(`^${source}/?$`), keys }
}

/**
 * Builds the single request handler behind api/v1/[...path].js.
 *
 * `routes` is a list of [method, pattern, handler]; patterns are relative to /api/v1 and
 * may contain :params. Handlers receive (req, res, { params, query }) and either return
 * a JSON-serialisable value (sent with 200) or write the response themselves.
 */
export const createRouter = (routes) => {
  const compiled = routes.map(([method, pattern, handler]) => ({ method, handler, ...compile(pattern) }))

  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')

    const url = new URL(req.url, 'http://localhost')
    const path = url.pathname.replace(/^\/api\/v1/, '') || '/'

    try {
      const candidates = compiled.filter((route) => route.regex.test(path))
      if (!candidates.length) fail(404, 'Not found.', 'not_found')
      const route = candidates.find((candidate) => candidate.method === req.method)
      if (!route) {
        res.setHeader('Allow', [...new Set(candidates.map((candidate) => candidate.method))].join(', '))
        fail(405, 'Method not allowed.', 'method_not_allowed')
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') assertSameOrigin(req)

      const match = route.regex.exec(path)
      const params = Object.fromEntries(route.keys.map((key, index) => [key, decodeURIComponent(match[index + 1])]))
      const result = await route.handler(req, res, { params, query: url.searchParams })
      if (!res.writableEnded && !res.headersSent) res.status(200).json(result ?? { ok: true })
    } catch (error) {
      if (res.headersSent) return
      if (error instanceof HttpError) {
        return res.status(error.status).json({ code: error.code || null, message: error.message })
      }
      console.error(`[api] ${req.method} ${path} failed: ${error?.message || error}`)
      // Loaded lazily: the error log needs the database, and http.js must not.
      import('./errors.js')
        .then(({ reportError }) => reportError({ source: 'server', message: error?.message || String(error), stack: error?.stack, route: `${req.method} ${path.replace(/[0-9a-f-]{36}/gi, ':id')}` }))
        .catch(() => {})
      return res.status(500).json({ code: 'server_error', message: 'Something went wrong on our side. Please try again.' })
    }
  }
}

/** Trimmed string input, capped so a pasted novel cannot bloat a row. */
export const text = (value, max = 500) => String(value ?? '').trim().slice(0, max)

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const email = (value) => {
  const normalized = text(value, 254).toLowerCase()
  return EMAIL_PATTERN.test(normalized) ? normalized : null
}
