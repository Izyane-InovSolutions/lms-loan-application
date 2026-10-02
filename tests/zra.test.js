import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const moduleKv = vi.hoisted(() => ({ get: async () => null, set: async () => 'OK', del: async () => {} }))
vi.mock('../api/_lib/kv.js', () => ({ default: moduleKv }))

const { createZraClient, createZraRequestGate, ZraError } = await import('../api/_lib/zra/client.js')
const { getDb, schema } = await import('../api/_lib/db/client.js')
const { eq } = await import('drizzle-orm')
const originalSecretsKey = process.env.LOS_SECRETS_KEY
const TEST_SECRETS_KEY = 'test-only-zra-encryption-key'

beforeEach(() => { process.env.LOS_SECRETS_KEY = TEST_SECRETS_KEY })
afterAll(() => {
  if (originalSecretsKey === undefined) delete process.env.LOS_SECRETS_KEY
  else process.env.LOS_SECRETS_KEY = originalSecretsKey
})

const createKv = () => {
  const values = new Map()
  return {
    async get(key) { return values.get(key) ?? null },
    async set(key, value, { nx = false } = {}) {
      if (nx && values.has(key)) return null
      values.set(key, value)
      return 'OK'
    },
    async del(key) { values.delete(key) },
    entries() { return [...values.entries()] },
  }
}

const noWait = async () => {}
const makeClient = (options) => createZraClient({
  ...options,
  tokenStore: options.tokenStore || options.kvStore || createKv(),
})

const CONFIG = {
  baseUrl: 'https://zws.test',
  apiKey: 'test-api-key',
  username: 'test-user',
  password: 'test-password',
}

const tokenBody = (overrides = {}) => ({
  header: { status: 'SUCCESS' },
  data: {
    tokenType: 'bearer',
    accessToken: 'access-1',
    expiresIn: 300,
    refreshToken: 'refresh-1',
    refreshExpiresIn: 1800,
    ...overrides,
  },
})

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
})

describe('ZRA client', () => {
  it('authenticates first, then performs lookup with the cached access token', async () => {
    const calls = []
    const fetchImpl = vi.fn(async (url, options) => {
      calls.push({ url: String(url), options })
      if (String(url).endsWith('/zws/auth/login')) return jsonResponse(tokenBody())
      return jsonResponse({ header: { status: 'SUCCESS' }, data: { tpin: '1234567890', name: 'UAT Test Person' } })
    })
    const client = makeClient({ config: CONFIG, fetchImpl, kvStore: createKv(), requestGate: noWait })

    const authResult = await client.authenticate()
    const lookupResult = await client.lookup('NRC', 'UAT-TEST')

    expect(authResult).toEqual({ authenticated: true })
    expect(lookupResult.taxpayer).toMatchObject({ tpin: '1234567890', name: 'UAT Test Person' })
    expect(calls.map(({ url }) => url)).toEqual([
      'https://zws.test/zws/auth/login',
      'https://zws.test/zws/v1/taxpayer-lookup',
    ])
    expect(calls[1].options.headers.Authorization).toBe('Bearer access-1')
    expect(JSON.stringify(authResult)).not.toMatch(/accessToken|refreshToken/i)
  })

  it('reuses a valid token for authenticate and supports forcing a fresh login', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(tokenBody()))
    const client = makeClient({ config: CONFIG, fetchImpl, kvStore: createKv(), requestGate: noWait })

    await client.authenticate()
    await client.authenticate()
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    await client.authenticate({ force: true })
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    await client.refreshAccessToken()
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('makes a generic authenticated request and rejects paths outside ZWS', async () => {
    const calls = []
    const fetchImpl = vi.fn(async (url, options) => {
      calls.push({ url: String(url), options })
      return String(url).endsWith('/zws/auth/login')
        ? jsonResponse(tokenBody())
        : jsonResponse({ header: { status: 'SUCCESS' }, data: { value: 'ok' } })
    })
    const client = makeClient({ config: CONFIG, fetchImpl, kvStore: createKv(), requestGate: noWait })

    await expect(client.makeRequest('/zws/v1/status')).resolves.toEqual({ value: 'ok' })
    expect(calls.at(-1).options.method).toBe('GET')
    expect(calls.at(-1).options.headers.Authorization).toBe('Bearer access-1')
    await expect(client.makeRequest('https://other.example/resource')).rejects.toMatchObject({ code: 'zra_invalid_endpoint' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('authenticates and performs a TPIN lookup using the documented headers and payload', async () => {
    const calls = []
    const fetchImpl = vi.fn(async (url, options) => {
      calls.push({ url: String(url), options })
      if (String(url).endsWith('/zws/auth/login')) return jsonResponse(tokenBody())
      return jsonResponse({
        header: { status: 'SUCCESS' },
        data: { tpin: '1234567890', name: 'Test Applicant', idType: 'NRC', idNumber: '123456/78/9', brn: null },
      })
    })
    const client = makeClient({ config: CONFIG, fetchImpl, kvStore: createKv(), requestGate: noWait })

    const result = await client.lookup('NRC', ' 123456/78/9 ')

    expect(result).toEqual({
      found: true,
      taxpayer: { tpin: '1234567890', name: 'Test Applicant', idType: 'NRC', idNumber: '123456/78/9', brn: null },
    })
    expect(calls).toHaveLength(2)
    expect(JSON.parse(calls[0].options.body)).toEqual({ username: 'test-user', password: 'test-password' })
    expect(calls[1].url).toBe('https://zws.test/zws/v1/taxpayer-lookup')
    expect(JSON.parse(calls[1].options.body)).toEqual({ lookupType: 'NRC', lookupValue: '123456/78/9' })
    expect(calls.every(({ options }) => options.headers['X-Api-Key'] === 'test-api-key')).toBe(true)
    expect(calls[1].options.headers.Authorization).toBe('Bearer access-1')
    expect(calls.every(({ options }) => options.redirect === 'error')).toBe(true)
  })

  it('refreshes an expiring access token and uses the rotated token', async () => {
    let currentTime = Date.now()
    const calls = []
    const fetchImpl = vi.fn(async (url, options) => {
      calls.push({ url: String(url), options })
      if (String(url).endsWith('/zws/auth/login')) return jsonResponse(tokenBody())
      if (String(url).endsWith('/zws/auth/refresh-token')) {
        return jsonResponse(tokenBody({ accessToken: 'access-2', refreshToken: 'refresh-2' }))
      }
      return jsonResponse({ header: { status: 'SUCCESS' }, data: { tpin: '123', name: 'Test' } })
    })
    const client = makeClient({ config: CONFIG, fetchImpl, now: () => currentTime, kvStore: createKv(), requestGate: noWait })

    await client.lookup('TPIN', '123')
    currentTime += 240_000
    await client.lookup('TPIN', '123')

    expect(calls.filter(({ url }) => url.endsWith('/zws/auth/login'))).toHaveLength(1)
    const refreshCall = calls.find(({ url }) => url.endsWith('/zws/auth/refresh-token'))
    expect(JSON.parse(refreshCall.options.body)).toEqual({ refreshToken: 'refresh-1' })
    expect(calls.at(-1).options.headers.Authorization).toBe('Bearer access-2')
  })

  it('logs in again and retries a taxpayer lookup once after HTTP 401', async () => {
    const calls = []
    let loginCount = 0
    let lookupCount = 0
    const fetchImpl = vi.fn(async (url, options) => {
      const address = String(url)
      calls.push({ url: address, options })
      if (address.endsWith('/zws/auth/login')) {
        loginCount += 1
        return jsonResponse(tokenBody({ accessToken: `access-${loginCount}` }))
      }
      lookupCount += 1
      if (lookupCount === 1) return jsonResponse({}, 401)
      return jsonResponse({ header: { status: 'SUCCESS' }, data: { tpin: '123', name: 'Test Applicant' } })
    })
    const client = makeClient({ config: CONFIG, fetchImpl, kvStore: createKv(), requestGate: noWait })

    const result = await client.lookup('NRC', '123456/78/9')

    expect(result.taxpayer).toMatchObject({ tpin: '123', name: 'Test Applicant' })
    expect(calls.map(({ url }) => url)).toEqual([
      'https://zws.test/zws/auth/login',
      'https://zws.test/zws/v1/taxpayer-lookup',
      'https://zws.test/zws/auth/login',
      'https://zws.test/zws/v1/taxpayer-lookup',
    ])
    expect(calls[1].options.headers.Authorization).toBe('Bearer access-1')
    expect(calls[3].options.headers.Authorization).toBe('Bearer access-2')
  })

  it('reuses encrypted tokens across client instances without logging in again', async () => {
    const sharedKv = createKv()
    const calls = []
    const fetchImpl = vi.fn(async (url, options) => {
      calls.push({ url: String(url), options })
      if (String(url).endsWith('/zws/auth/login')) return jsonResponse(tokenBody())
      return jsonResponse({ header: { status: 'SUCCESS' }, data: { tpin: '123', name: 'Test' } })
    })
    const firstClient = makeClient({ config: CONFIG, fetchImpl, kvStore: sharedKv, requestGate: noWait })
    const secondClient = makeClient({ config: CONFIG, fetchImpl, kvStore: sharedKv, requestGate: noWait })

    await Promise.all([firstClient.lookup('TPIN', '123'), secondClient.lookup('TPIN', '123')])

    expect(calls.filter(({ url }) => url.endsWith('/zws/auth/login'))).toHaveLength(1)
    expect(calls.filter(({ url }) => url.endsWith('/zws/v1/taxpayer-lookup'))).toHaveLength(2)
    expect(sharedKv.entries()).toHaveLength(1)
    expect(sharedKv.entries()[0][1]).toMatch(/^enc:v1:/)
  })

  it('persists encrypted tokens in Postgres for reuse by another client instance', async () => {
    const config = { ...CONFIG, apiKey: 'database-persistence-test-key' }
    const calls = []
    const fetchImpl = vi.fn(async (url, options) => {
      calls.push({ url: String(url), options })
      if (String(url).endsWith('/zws/auth/login')) return jsonResponse(tokenBody())
      return jsonResponse({ header: { status: 'SUCCESS' }, data: { tpin: '123', name: 'Test' } })
    })
    const firstClient = createZraClient({ config, fetchImpl, kvStore: createKv(), requestGate: noWait })
    const secondClient = createZraClient({ config, fetchImpl, kvStore: createKv(), requestGate: noWait })

    await firstClient.lookup('TPIN', '123')
    const db = await getDb()
    const rows = await db.select().from(schema.settings)
    const tokenRow = rows.find(({ key }) => key.startsWith('los:zra:tokens:'))

    expect(tokenRow.value.encrypted).toMatch(/^enc:v1:/)
    expect(tokenRow.value.encrypted).not.toContain('access-1')
    await secondClient.lookup('TPIN', '123')

    expect(calls.filter(({ url }) => url.endsWith('/zws/auth/login'))).toHaveLength(1)
    await db.delete(schema.settings).where(eq(schema.settings.key, tokenRow.key))
  })

  it('does not emit debug diagnostics to the terminal', async () => {
    const originalDebug = process.env.ZRA_DEBUG
    const logged = vi.spyOn(console, 'info').mockImplementation(() => {})
    const fetchImpl = vi.fn(async (url) => String(url).endsWith('/zws/auth/login')
      ? jsonResponse(tokenBody())
      : jsonResponse({ header: { status: 'SUCCESS' }, data: { tpin: '123', name: 'Test' } }))

    try {
      process.env.ZRA_DEBUG = 'true'
      await makeClient({ config: CONFIG, fetchImpl, kvStore: createKv(), requestGate: noWait })
        .lookup('NRC', 'private-test-identifier')

      expect(logged).not.toHaveBeenCalled()
    } finally {
      logged.mockRestore()
      if (originalDebug === undefined) delete process.env.ZRA_DEBUG
      else process.env.ZRA_DEBUG = originalDebug
    }
  })

  it('waits for the shared two-second request gate before another upstream call', async () => {
    let attempts = 0
    const pauses = []
    const gate = createZraRequestGate({
      kvStore: { async set() { attempts += 1; return attempts === 1 ? null : 'OK' } },
      sleep: async (milliseconds) => pauses.push(milliseconds),
      now: () => 1000,
    })

    await gate()

    expect(attempts).toBe(2)
    expect(pauses).toEqual([100])
  })

  it('fails closed without a configured encryption key before making a ZRA request', async () => {
    delete process.env.LOS_SECRETS_KEY
    const fetchImpl = vi.fn()
    const client = makeClient({ config: CONFIG, fetchImpl, kvStore: createKv(), requestGate: noWait })

    await expect(client.lookup('NRC', 'UAT-TEST')).rejects.toMatchObject({ code: 'zra_not_configured' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('returns not found for the documented taxpayer-not-found response', async () => {
    const fetchImpl = vi.fn(async (url) => String(url).endsWith('/zws/auth/login')
      ? jsonResponse(tokenBody())
      : jsonResponse({ header: { status: 'ERROR', errorCode: '5000' }, data: null }))
    const client = makeClient({ config: CONFIG, fetchImpl, kvStore: createKv(), requestGate: noWait })

    await expect(client.lookup('NRC', '123456/78/9')).resolves.toEqual({ found: false })
  })

  it('treats an HTTP 404 as not found and rejects invalid lookup types before network access', async () => {
    const fetchImpl = vi.fn(async (url) => String(url).endsWith('/zws/auth/login')
      ? jsonResponse(tokenBody())
      : jsonResponse({}, 404))
    const client = makeClient({ config: CONFIG, fetchImpl, kvStore: createKv(), requestGate: noWait })

    await expect(client.lookup('PASSPORT', 'P123')).resolves.toEqual({ found: false })
    const callsBeforeInvalidType = fetchImpl.mock.calls.length
    await expect(client.lookup('EMAIL', 'person@example.test')).rejects.toMatchObject({ code: 'zra_invalid_lookup' })
    expect(fetchImpl).toHaveBeenCalledTimes(callsBeforeInvalidType)
  })

  it('requires HTTPS and does not expose ZRA response bodies in errors', async () => {
    expect(() => createZraClient({ config: { ...CONFIG, baseUrl: 'http://zws.test' } })).toThrow(ZraError)
    const fetchImpl = vi.fn(async (url) => String(url).endsWith('/zws/auth/login')
      ? jsonResponse(tokenBody())
      : jsonResponse({ errorMessage: 'sensitive server detail' }, 500))
    const client = makeClient({ config: CONFIG, fetchImpl, kvStore: createKv(), requestGate: noWait })

    await expect(client.lookup('TPIN', '123')).rejects.toMatchObject({
      code: 'zra_upstream_error',
      message: 'ZRA returned an unsuccessful response.',
    })
  })

  it('allows HTTP only when explicitly enabled for local UAT and rejects it in production', async () => {
    const keys = ['ZRA_ALLOW_HTTP_UAT', 'ZRA_UAT_MODE', 'ZRA_UAT_SMOKE_ENABLED', 'NODE_ENV', 'VERCEL', 'VERCEL_ENV']
    const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
    const calls = []
    const fetchImpl = vi.fn(async (url) => {
      calls.push(String(url))
      return String(url).endsWith('/zws/auth/login')
        ? jsonResponse(tokenBody())
        : jsonResponse({ header: { status: 'SUCCESS' }, data: { tpin: '123', name: 'UAT Test' } })
    })

    try {
      process.env.ZRA_ALLOW_HTTP_UAT = 'true'
      process.env.ZRA_UAT_MODE = 'true'
      process.env.ZRA_UAT_SMOKE_ENABLED = 'true'
      process.env.NODE_ENV = 'test'
      delete process.env.VERCEL
      process.env.VERCEL_ENV = ''

      const client = makeClient({ config: { ...CONFIG, baseUrl: 'http://zws.test' }, fetchImpl, kvStore: createKv(), requestGate: noWait })
      await expect(client.lookup('NRC', 'UAT-TEST')).resolves.toMatchObject({ found: true })
      expect(calls).toEqual([
        'http://zws.test/zws/auth/login',
        'http://zws.test/zws/v1/taxpayer-lookup',
      ])

      process.env.NODE_ENV = 'production'
      expect(() => createZraClient({ config: { ...CONFIG, baseUrl: 'http://zws.test' }, fetchImpl })).toThrow(ZraError)
    } finally {
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })
})