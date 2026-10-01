/*
 * Production server for self-hosted deployments (Docker, or Linux with systemd).
 *
 * On Vercel the files under api/ run as serverless functions; `npm run dev` mounts them
 * through vite.config.js. This does the same for a plain Node process, and serves the
 * built site from dist/ too, so a container needs nothing else in front of it but TLS.
 * (On the systemd setup nginx serves dist/ itself and proxies only /api/* here.) The route
 * table mirrors localApiDevPlugin in vite.config.js — add a route in both places.
 *
 *   npm start        (environment from the process, else .env.local / .env)
 *
 *   HOST, PORT              where to listen (127.0.0.1:3001; the Docker image uses 0.0.0.0)
 *   LOS_SCHEDULER=true      run the daily maintenance here instead of from a cron job
 */
import './scripts/load-env.js'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import sirv from 'sirv'
import { sql } from 'drizzle-orm'
import { settleBackgroundTasks } from './api/_lib/after.js'
import { startScheduler } from './api/_lib/scheduler.js'

const routes = {
  '/api/otp/request': '/api/otp/request.js',
  '/api/otp/verify': '/api/otp/verify.js',
  '/api/otp/verify-email': '/api/otp/verify-email.js',
  '/api/draft': '/api/draft/index.js',
  '/api/draft/documents': '/api/draft/documents.js',
  '/api/ai/analyze-document': '/api/ai/analyze-document.js',
  '/api/ai/prescreen': '/api/ai/prescreen.js',
  '/api/cron/purge-expired-drafts': '/api/cron/purge-expired-drafts.js',
}
const V1_PREFIX = '/api/v1/'
const V1_MODULE = '/api/v1/[...path].js'

const PORT = Number(process.env.PORT) || 3001
const HOST = process.env.HOST || '127.0.0.1'
// JSON bodies are small; uploads (multipart, parsed by their handlers) are capped at 4 MB.
const MAX_JSON_BYTES = 6 * 1024 * 1024
// How long a shutdown waits for requests and background tasks (an LMS hand-off) to finish.
// Keep it under the container's stop grace period (stop_grace_period in docker-compose.yml).
const SHUTDOWN_GRACE_MS = Number(process.env.LOS_SHUTDOWN_GRACE_MS) || 20000

// The built site. Hashed files under assets/ never change, so browsers keep them; the page
// itself is always revalidated so a deploy shows up at once. Unknown paths get the page
// (client-side routes).
const DIST = path.resolve(process.cwd(), 'dist')
const site = fs.existsSync(path.join(DIST, 'index.html'))
  ? sirv(DIST, {
      single: true,
      etag: true,
      setHeaders: (res, pathname) => {
        res.setHeader('Cache-Control', pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache')
      },
    })
  : null

const health = async (res) => {
  try {
    const { getDb } = await import('./api/_lib/db/client.js')
    await (await getDb()).execute(sql`select 1`)
    res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}')
  } catch (error) {
    console.error('[healthz]', error?.message || error)
    res.writeHead(503, { 'Content-Type': 'application/json' }).end('{"ok":false}')
  }
}

// Set here rather than only in the Caddyfile, so they hold behind any proxy (a Cloudflare
// Tunnel adds none of them). A handler that sets its own value replaces these.
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  ...(String(process.env.APP_URL || '').startsWith('https://') ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}),
}

const server = http.createServer(async (req, res) => {
  const [pathname] = req.url.split('?')
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value)
  if (pathname === '/healthz') return health(res)

  const modulePath = routes[pathname] || (pathname.startsWith(V1_PREFIX) ? V1_MODULE : null)
  if (!modulePath) {
    if (site && !pathname.startsWith('/api/') && ['GET', 'HEAD'].includes(req.method)) return site(req, res)
    res.statusCode = 404
    return res.end('Not found')
  }

  res.status = (code) => {
    res.statusCode = code
    return res
  }
  res.json = (body) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(body))
  }

  try {
    // Multipart uploads are parsed by the handler itself (formidable); everything else is JSON.
    const isMultipart = (req.headers['content-type'] || '').includes('multipart/form-data')
    if (!isMultipart && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      const chunks = []
      let size = 0
      for await (const chunk of req) {
        size += chunk.length
        if (size > MAX_JSON_BYTES) return res.status(413).json({ message: 'The request is too large.' })
        chunks.push(chunk)
      }
      const raw = Buffer.concat(chunks).toString('utf8')
      try {
        req.body = raw ? JSON.parse(raw) : {}
      } catch {
        return res.status(400).json({ message: 'Invalid JSON body.' })
      }
    }
    const mod = await import(`.${modulePath}`)
    await mod.default(req, res)
  } catch (error) {
    console.error('[server]', error)
    if (!res.headersSent) res.status(500).json({ message: 'Something went wrong on our side.' })
  }
})

let stopScheduler = null
server.listen(PORT, HOST, () => {
  console.log(`LOS listening on http://${HOST}:${PORT}${site ? '' : ' (API only: no dist/ to serve)'}`)
  if (process.env.LOS_SCHEDULER === 'true') {
    const origin = (process.env.APP_URL || '').replace(/\/+$/, '')
    if (origin) stopScheduler = startScheduler({ origin })
    else console.error('[scheduler] not started: set APP_URL, the site address used in emailed links.')
  }
})

// Docker stops a container with SIGTERM, then kills it after its grace period. Stop taking
// requests, let those in flight and any background tasks finish, then exit.
let stopping = false
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, async () => {
    if (stopping) return
    stopping = true
    console.log(`[server] ${signal}: finishing requests and background tasks`)
    stopScheduler?.()
    const deadline = setTimeout(() => process.exit(1), SHUTDOWN_GRACE_MS + 2000)
    deadline.unref()
    await new Promise((resolve) => {
      server.close(resolve)
      server.closeIdleConnections()
    })
    if (!(await settleBackgroundTasks(SHUTDOWN_GRACE_MS))) console.warn('[server] background tasks still running at shutdown')
    process.exit(0)
  })
}
