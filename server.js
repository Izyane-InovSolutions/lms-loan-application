/*
 * Production API server for self-hosted (Linux) deployments.
 *
 * On Vercel the files under api/ run as serverless functions; `npm run dev` mounts them
 * through vite.config.js. This does the same for a plain Node process: nginx serves dist/
 * and proxies /api/* here. The route table mirrors localApiDevPlugin in vite.config.js —
 * add a route in both places.
 *
 *   npm start        (environment from the process, else .env.local / .env)
 */
import './scripts/load-env.js'
import http from 'node:http'
import { sql } from 'drizzle-orm'

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

const server = http.createServer(async (req, res) => {
  const [pathname] = req.url.split('?')
  if (pathname === '/healthz') return health(res)

  const modulePath = routes[pathname] || (pathname.startsWith(V1_PREFIX) ? V1_MODULE : null)
  if (!modulePath) {
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
      for await (const chunk of req) chunks.push(chunk)
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

server.listen(PORT, HOST, () => console.log(`LOS API listening on http://${HOST}:${PORT}`))

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
