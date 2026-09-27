import os from 'node:os'
import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Deliberately separate from vite.config.js, which copies .env into process.env: tests
// must never reach a real database, Redis, Blob store or mail server, whatever .env says.
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(process.cwd(), 'src') },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    env: {
      LOS_PGLITE_DIR: 'memory://',
      LOS_LOCAL_BLOB_DIR: path.join(os.tmpdir(), `los-test-blob-${process.pid}`),
      LMS_PROVIDER: 'none',
      CRB_PROVIDER: 'demo',
      GEOCODER: '',
      DATABASE_URL: '',
      KV_REST_API_URL: '',
      KV_REST_API_TOKEN: '',
      UPSTASH_REDIS_REST_URL: '',
      UPSTASH_REDIS_REST_TOKEN: '',
      BLOB_READ_WRITE_TOKEN: '',
      EMAIL_HOST: 'invalid.invalid',
      EMAIL_PORT: '2525',
      LOS_DEMO_ENABLED: 'true',
      GEMINI_API_KEY: '',
    },
    // PGlite takes a moment to boot and migrate on first use.
    testTimeout: 30000,
  },
})
