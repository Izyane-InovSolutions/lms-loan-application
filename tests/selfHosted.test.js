import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryKv } from './helpers.js'

// A folder of its own: the shared test folder holds other files' drafts, which this
// file's maintenance run would otherwise judge by its own Redis and database.
const BLOB_DIR = path.join(os.tmpdir(), `los-test-blob-selfhosted-${process.pid}`)
process.env.LOS_LOCAL_BLOB_DIR = BLOB_DIR

const kv = createMemoryKv()
vi.mock('../api/_lib/kv.js', () => ({ default: kv }))
// Its default export throws on any property access, which Vitest's module loading makes
// when kv.js is imported afresh below. Only createClient is used, and not by these tests.
vi.mock('@vercel/kv', () => ({ createClient: vi.fn() }))

const { createRedisKv } = await import('../api/_lib/redisKv.js')
const { putBlob, readBlob, checkBlobStore } = await import('../api/_lib/blob.js')
const { indexDraft } = await import('../api/_lib/drafts.js')
const { runDailyMaintenance } = await import('../api/_lib/maintenance.js')
const { clientIp } = await import('../api/_lib/http.js')

afterEach(() => {
  vi.unstubAllEnvs()
})

/** Just enough of an ioredis client: string values, NX, and the arguments it was given. */
const fakeRedis = () => {
  const values = new Map()
  const calls = []
  return {
    calls,
    values,
    async get(key) {
      return values.has(key) ? values.get(key) : null
    },
    async set(key, value, ...args) {
      calls.push(['set', key, value, ...args])
      if (args.includes('NX') && values.has(key)) return null
      values.set(key, value)
      return 'OK'
    },
    async incr(key) {
      const next = Number(values.get(key) || 0) + 1
      values.set(key, String(next))
      return next
    },
    async del(...keys) {
      return keys.filter((key) => values.delete(key)).length
    },
    async exists(...keys) {
      return keys.filter((key) => values.has(key)).length
    },
    async expire() {
      return 1
    },
  }
}

describe('Redis store', () => {
  it('stores JSON, so objects, strings and counters come back as they went in', async () => {
    const client = fakeRedis()
    const store = createRedisKv(client)
    await store.set('draft:a@example.com', { step: 2, documents: {} })
    await store.set('draftToken:t', 'a@example.com')
    await store.set('code', '123456')
    expect(await store.get('draft:a@example.com')).toEqual({ step: 2, documents: {} })
    expect(await store.get('draftToken:t')).toBe('a@example.com')
    // Upstash would hand this back as the number 123456.
    expect(await store.get('code')).toBe('123456')
    expect(await store.incr('rate')).toBe(1)
    expect(await store.get('rate')).toBe(1)
    expect(await store.get('missing')).toBeNull()
  })

  it('maps @vercel/kv options onto SET, and answers null when NX stops the write', async () => {
    const client = fakeRedis()
    const store = createRedisKv(client)
    expect(await store.set('lock', 'u1', { nx: true, ex: 180 })).toBe('OK')
    expect(await store.set('lock', 'u2', { nx: true, ex: 180 })).toBeNull()
    await store.set('draft', {}, { keepTtl: true })
    expect(client.calls[0]).toEqual(['set', 'lock', '"u1"', 'EX', 180, 'NX'])
    expect(client.calls[2]).toEqual(['set', 'draft', '{}', 'KEEPTTL'])
    expect(await store.exists('lock')).toBe(1)
  })
})

describe('store selection on a deployment', () => {
  const freshKv = async () => {
    vi.resetModules()
    vi.doUnmock('../api/_lib/kv.js')
    const { default: store } = await import('../api/_lib/kv.js')
    vi.doMock('../api/_lib/kv.js', () => ({ default: kv }))
    return store
  }

  it('refuses the file store in production unless LOS_LOCAL_KV_FILE chooses it', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('REDIS_URL', '')
    vi.stubEnv('LOS_LOCAL_KV_FILE', '')
    const unconfigured = await freshKv()
    expect(() => unconfigured.get('x')).toThrow(/REDIS_URL/)

    vi.stubEnv('LOS_LOCAL_KV_FILE', path.join(BLOB_DIR, 'kv.json'))
    const file = await freshKv()
    await file.set('x', { ok: true })
    expect(await file.get('x')).toEqual({ ok: true })
  })
})

describe('draft file sweep on local storage', () => {
  const PDF = Buffer.from('%PDF-1.4\n% test file\n')
  const age = (stored, days) => {
    const when = new Date(Date.now() - days * 86400000)
    fs.utimesSync(path.join(BLOB_DIR, stored.pathname), when, when)
  }

  it('deletes only files no live draft can own', async () => {
    const orphan = await putBlob('drafts/gone@example.com/nrc.pdf', PDF)
    const recent = await putBlob('drafts/gone-recently@example.com/nrc.pdf', PDF)
    const live = await putBlob('drafts/live@example.com/nrc.pdf', PDF)
    // "+" is not path-safe, so this draft's folder is "ada-loans@example.com".
    const plus = await putBlob('drafts/ada+loans@example.com/nrc.pdf', PDF)
    expect(plus.pathname).toBe('drafts/ada-loans@example.com/nrc.pdf')
    for (const stored of [orphan, live, plus]) age(stored, 10)
    age(recent, 1)

    await kv.set('draft:live@example.com', { documents: {} })
    await indexDraft({ id: crypto.randomUUID(), loanType: 'personal', personalData: {}, savedAt: Date.now() }, 'ada+loans@example.com')

    const summary = await runDailyMaintenance('http://localhost')
    expect(summary).toMatchObject({ scanned: 4, deleted: 1 })
    expect(await readBlob(orphan)).toBeNull()
    for (const kept of [recent, live, plus]) expect(await readBlob(kept)).not.toBeNull()
  })

  it('reports whether the folder can be written', async () => {
    expect(await checkBlobStore()).toEqual({ ok: true, kind: 'local folder' })
  })
})

describe('the visitor’s address', () => {
  const request = (headers) => ({ headers, socket: { remoteAddress: '172.18.0.5' } })

  it('takes X-Forwarded-For from a proxy that replaces it (Caddy)', () => {
    expect(clientIp(request({ 'x-forwarded-for': '41.72.10.1' }))).toBe('41.72.10.1')
    expect(clientIp(request({}))).toBe('172.18.0.5')
  })

  it('behind Cloudflare, trusts only CF-Connecting-IP, so a forged X-Forwarded-For changes nothing', () => {
    vi.stubEnv('CLIENT_IP_HEADER', 'CF-Connecting-IP')
    // Cloudflare appends the real address to whatever the visitor sent.
    expect(clientIp(request({ 'x-forwarded-for': '10.9.9.9, 41.72.10.1', 'cf-connecting-ip': '41.72.10.1' }))).toBe('41.72.10.1')
    // Not through Cloudflare (a health check from the host): the connection's own address.
    expect(clientIp(request({ 'x-forwarded-for': '10.9.9.9' }))).toBe('172.18.0.5')
  })
})
