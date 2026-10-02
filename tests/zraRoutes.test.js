import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryKv, client } from './helpers.js'

const kv = createMemoryKv()
const lookupMock = vi.fn()
const authenticateMock = vi.fn()
vi.mock('../api/_lib/kv.js', () => ({ default: kv }))
vi.mock('../api/_lib/audit.js', () => ({ recordAudit: vi.fn(async () => {}) }))
vi.mock('../api/_lib/zra/config.js', () => ({
  getZraConfig: vi.fn(async () => ({
    source: 'environment',
    config: { baseUrl: 'https://zws.test', apiKey: 'test-api-key', username: 'test-user', password: 'test-password' },
  })),
}))
vi.mock('../api/_lib/zra/client.js', () => ({
  createZraClient: vi.fn(() => ({ lookup: lookupMock, authenticate: authenticateMock })),
  ZraError: class ZraError extends Error {
    constructor(message, code) {
      super(message)
      this.code = code
    }
  },
}))

const { default: handler } = await import('../api/v1/[...path].js')
const { recordAudit } = await import('../api/_lib/audit.js')
const { createZraClient } = await import('../api/_lib/zra/client.js')

let originalEnvironment

beforeEach(async () => {
  await kv.del('los:zra:uat-lookup-rate')
  originalEnvironment ||= {
    uat: process.env.ZRA_UAT_MODE,
    smoke: process.env.ZRA_UAT_SMOKE_ENABLED,
    applicationLookup: process.env.ZRA_APPLICATION_LOOKUP_ENABLED,
    nodeEnv: process.env.NODE_ENV,
    vercelEnv: process.env.VERCEL_ENV,
  }
  vi.stubEnv('ZRA_UAT_MODE', 'true')
  vi.stubEnv('ZRA_UAT_SMOKE_ENABLED', 'true')
  vi.stubEnv('ZRA_APPLICATION_LOOKUP_ENABLED', 'true')
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('VERCEL_ENV', '')
  authenticateMock.mockReset().mockResolvedValue({ authenticated: true })
  lookupMock.mockReset().mockResolvedValue({
    found: true,
    taxpayer: { tpin: '1234567890', name: 'UAT Test Person', idType: 'NRC', idNumber: '123456/78/9', brn: null },
  })
  vi.mocked(recordAudit).mockClear()
})

afterAll(() => {
  vi.unstubAllEnvs()
  for (const [key, value] of Object.entries({
    ZRA_UAT_MODE: originalEnvironment?.uat,
    ZRA_UAT_SMOKE_ENABLED: originalEnvironment?.smoke,
    ZRA_APPLICATION_LOOKUP_ENABLED: originalEnvironment?.applicationLookup,
    NODE_ENV: originalEnvironment?.nodeEnv,
    VERCEL_ENV: originalEnvironment?.vercelEnv,
  })) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('ZRA UAT routes', () => {
  it('hides Swagger routes when UAT access is disabled', async () => {
    vi.stubEnv('ZRA_UAT_MODE', 'false')
    const anonymous = client(handler)

    const response = await anonymous.get('/zra/docs')

    expect(response.status).toBe(404)
  })

  it('allows Swagger and UAT lookup from local loopback without LOS sign-in', async () => {
    const localClient = client(handler)
    const docs = await localClient.get('/zra/docs')
    const swaggerAsset = await localClient.get('/zra/assets/swagger-ui-bundle.js')
    const spec = await localClient.get('/zra/openapi.json')
    const response = await localClient.post('/zra/lookup', { lookupType: 'NRC', lookupValue: 'UAT-TEST' })

    expect(docs.status).toBe(200)
    expect(docs.headers['content-security-policy']).toContain('frame-ancestors \'none\'')
    expect(docs.body).toContain('ZRA UAT Lookup API')
    expect(docs.body).not.toContain('unpkg.com')
    expect(swaggerAsset.status).toBe(200)
    expect(swaggerAsset.headers['content-type']).toContain('application/javascript')
    expect(swaggerAsset.body.length).toBeGreaterThan(1000)
    expect(spec.status).toBe(200)
    expect(spec.body.paths['/auth/login']).toBeUndefined()
    expect(spec.body.tags).toContainEqual(expect.objectContaining({ name: 'ZRA Integration' }))
    expect(spec.body.paths['/zra/authenticate'].post.tags).toContain('ZRA Integration')
    expect(spec.body.paths['/zra/authenticate'].post.requestBody.content['application/json'].schema.$ref)
      .toBe('#/components/schemas/ZraAuthenticationRequest')
    expect(spec.body.paths['/zra/lookup'].post.operationId).toBe('zraUatTaxpayerLookup')
    expect(spec.body.paths['/zra/application-lookup'].post.operationId).toBe('zraApplicantLookup')
    expect(response.status).toBe(200)
    expect(response.body.taxpayer.tpin).toBe('1234567890')
    expect(lookupMock).toHaveBeenCalledWith('NRC', 'UAT-TEST')
  })

  it('verifies NRC, TPIN, or passport with consent and returns fields for application autofill', async () => {
    const localClient = client(handler)
    const auth = await localClient.post('/zra/authenticate', {
      baseUrl: 'https://zws.uat.example',
      apiKey: 'uat-api-key',
      username: 'uat-user',
      password: 'uat-password',
    })

    expect(auth.status).toBe(200)

    for (const [lookupType, lookupValue] of [
      ['NRC', '123456/78/9'],
      ['TPIN', '1234567890'],
      ['PASSPORT', 'AB123456'],
      ['BRN', 'BRN-UAT-123'],
    ]) {
      const response = await localClient.post('/zra/application-lookup', { lookupType, lookupValue, consent: true })

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({
        found: true,
        taxpayer: { tpin: '1234567890', name: 'UAT Test Person' },
      })
    }

    expect(lookupMock.mock.calls).toEqual([
      ['NRC', '123456/78/9'],
      ['TPIN', '1234567890'],
      ['PASSPORT', 'AB123456'],
      ['BRN', 'BRN-UAT-123'],
    ])
  })

  it('requires applicant consent before sending an identifier to ZRA', async () => {
    const localClient = client(handler)

    const response = await localClient.post('/zra/application-lookup', { lookupType: 'NRC', lookupValue: '123456/78/9' })

    expect(response.status).toBe(400)
    expect(response.body.code).toBe('zra_consent_required')
    expect(lookupMock).not.toHaveBeenCalled()
  })

  it('authenticates to ZRA using server configuration without returning tokens', async () => {
    const localClient = client(handler)
    const credentials = {
      baseUrl: 'https://zws.uat.example',
      apiKey: 'uat-api-key',
      username: 'uat-user',
      password: 'uat-password',
    }

    const response = await localClient.post('/zra/authenticate', credentials)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ authenticated: true, message: 'Authenticated with ZRA.' })
    expect(JSON.stringify(response.body)).not.toMatch(/accessToken|refreshToken/i)
    expect(JSON.stringify(response.body)).not.toContain(credentials.apiKey)
    expect(JSON.stringify(response.body)).not.toContain(credentials.password)
    expect(authenticateMock).toHaveBeenCalledTimes(1)
    expect(createZraClient).toHaveBeenCalledWith({ config: credentials })
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      actor: null,
      action: 'zra.uat_authenticated',
      detail: { authenticated: true },
    }))
  })

  it('audits only non-sensitive metadata and respects the lookup rate limit', async () => {
    const localClient = client(handler)
    const body = { lookupType: 'NRC', lookupValue: '123456/78/9' }

    const response = await localClient.post('/zra/lookup', body)
    const limited = await localClient.post('/zra/lookup', body)

    expect(response.status).toBe(200)
    expect(response.body.taxpayer.tpin).toBe('1234567890')
    expect(lookupMock).toHaveBeenCalledTimes(1)
    expect(lookupMock).toHaveBeenCalledWith('NRC', '123456/78/9')
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'zra.uat_lookup',
      entityId: 'zra',
      actor: null,
      detail: { lookupType: 'NRC', found: true },
    }))
    const zraAudit = recordAudit.mock.calls.map(([entry]) => entry).find((entry) => entry.action === 'zra.uat_lookup')
    expect(JSON.stringify(zraAudit.detail)).not.toContain(body.lookupValue)
    expect(limited.status).toBe(429)
  })

  it('does not expose the UAT route in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const anonymous = client(handler)

    expect((await anonymous.get('/zra/openapi.json')).status).toBe(404)
  })
})