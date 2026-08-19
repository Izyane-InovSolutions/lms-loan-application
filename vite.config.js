import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

// Serves the api/* Vercel Serverless Functions locally under `vite dev` (no
// `vercel dev`/project link required), so the draft-resume feature is testable
// without a deployed Vercel project. Uses the same handlers Vercel runs in
// production; only the KV/Blob backing stores differ locally (see api/_lib).
function localApiDevPlugin() {
  const routes = {
    '/api/otp/request': '/api/otp/request.js',
    '/api/otp/verify': '/api/otp/verify.js',
    '/api/draft': '/api/draft/index.js',
    '/api/draft/documents': '/api/draft/documents.js',
  }

  return {
    name: 'local-api-dev',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const [pathname] = req.url.split('?')
        const modulePath = routes[pathname]
        if (!modulePath) return next()

        res.status = (code) => {
          res.statusCode = code
          return res
        }
        res.json = (body) => {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(body))
        }

        const isMultipart = (req.headers['content-type'] || '').includes('multipart/form-data')
        if (!isMultipart && ['POST', 'PUT', 'DELETE'].includes(req.method)) {
          const chunks = []
          for await (const chunk of req) chunks.push(chunk)
          const raw = Buffer.concat(chunks).toString('utf8')
          req.body = raw ? JSON.parse(raw) : {}
        }

        try {
          const mod = await server.ssrLoadModule(modulePath, { fixStacktrace: true })
          await mod.default(req, res)
        } catch (error) {
          console.error('[local-api-dev]', error)
          if (!res.headersSent) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ message: 'Local dev API error', detail: String(error) }))
          }
        }
      })
    },
  }
}

// Serves files written by the local Blob fallback in api/_lib/blob.js.
function localBlobStaticPlugin() {
  return {
    name: 'local-blob-static',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url.startsWith('/local-blob/')) return next()
        const relative = decodeURIComponent(req.url.replace('/local-blob/', ''))
        const filePath = path.resolve(process.cwd(), '.local-blob', relative)
        fs.readFile(filePath, (err, data) => {
          if (err) {
            res.statusCode = 404
            res.end('Not found')
            return
          }
          res.end(data)
        })
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  // Vite only exposes VITE_-prefixed vars to app code by default; our api/*
  // handlers are plain Node code reading process.env directly (matching how
  // Vercel injects env vars in production), so load the rest in for them too.
  const env = loadEnv(mode, process.cwd(), '')
  Object.assign(process.env, env)

  return {
  plugins: [react(), localApiDevPlugin(), localBlobStaticPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), 'src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '/api')
      },
      '/erp-api': {
        target: 'https://api.erp.lms.rolaface.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/erp-api/, '')
      }
    }
  }
  }
})
