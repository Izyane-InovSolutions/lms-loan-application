import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createMemoryKv, client, signaturePng } from './helpers.js'

const kv = createMemoryKv()
vi.mock('../api/_lib/kv.js', () => ({ default: kv }))

const { default: handler } = await import('../api/v1/[...path].js')
const { brandName } = await import('../api/_lib/branding.js')
const { lenderName } = await import('../api/_lib/offerDocuments.js')
const { consentText } = await import('../src/config/consent.js')
const { DEFAULT_BRAND_NAME } = await import('../src/config/branding.js')

const admin = client(handler)
const officer = client(handler)
const visitor = client(handler)
const PNG = signaturePng(64, 64)

beforeAll(async () => {
  await admin.post('/auth/demo', { role: 'admin' })
  await officer.post('/auth/demo', { role: 'loan_officer' })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('branding', () => {
  it('starts with the shipped name and logo', async () => {
    expect((await visitor.get('/branding')).body).toEqual({ name: DEFAULT_BRAND_NAME, logoUrl: null })
    expect((await visitor.get('/branding/logo')).status).toBe(404)
  })

  it('is changed by admins only', async () => {
    expect((await officer.put('/settings/branding', { name: 'Chuma Loans' })).status).toBe(403)
    expect((await officer.upload('/admin/branding/logo', { filename: 'logo.png', contentType: 'image/png', data: PNG })).status).toBe(403)
    expect((await visitor.del('/admin/branding/logo')).status).toBe(401)
  })

  it('renames the product everywhere that reads it', async () => {
    expect((await admin.put('/settings/branding', { name: ' x ' })).status).toBe(400)
    const saved = await admin.put('/settings/branding', { name: '  Chuma   Loans ' })
    expect(saved.status, JSON.stringify(saved.body)).toBe(200)
    expect(saved.body.branding.name).toBe('Chuma Loans')

    expect((await visitor.get('/branding')).body.name).toBe('Chuma Loans')
    expect(await brandName()).toBe('Chuma Loans')
    // The lender in offer documents follows the brand unless the deployment names one.
    expect(await lenderName()).toBe('Chuma Loans')
    vi.stubEnv('LENDER_NAME', 'Chuma Finance Ltd')
    expect(await lenderName()).toBe('Chuma Finance Ltd')
    // The authenticator app lists the account under the brand.
    expect((await admin.post('/auth/2fa/setup')).body.otpauthUrl).toContain(encodeURIComponent('Chuma Loans:'))
    expect(consentText('crb', 'Chuma Loans')).toContain('I authorise Chuma Loans to request')
  })

  it('never takes a logo from the settings body', async () => {
    await admin.put('/settings/branding', { name: 'Chuma Loans', logo: { pathname: 'applications/someone/nrc.pdf', url: 'x', contentType: 'image/png', version: '1' } })
    expect((await visitor.get('/branding')).body.logoUrl).toBeNull()
  })

  it('serves an uploaded logo, and goes back to the default', async () => {
    expect((await admin.upload('/admin/branding/logo', { filename: 'doc.pdf', contentType: 'application/pdf', data: Buffer.from('%PDF-1.4\n% not a logo\n') })).body.code).toBe('unsupported_type')
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    expect((await admin.upload('/admin/branding/logo', { filename: 'logo.svg', contentType: 'image/svg+xml', data: svg })).status).toBe(400)

    const uploaded = await admin.upload('/admin/branding/logo', { filename: 'logo.png', contentType: 'image/png', data: PNG })
    expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(200)
    const { logoUrl } = (await visitor.get('/branding')).body
    expect(logoUrl).toMatch(/^\/api\/v1\/branding\/logo\?v=/)

    const logo = await visitor.get(logoUrl.replace('/api/v1', ''))
    expect(logo.status).toBe(200)
    expect(logo.headers['content-type']).toBe('image/png')
    expect(Buffer.from(logo.body).equals(PNG)).toBe(true)
    expect(logo.headers['cache-control']).toContain('immutable')

    expect((await admin.del('/admin/branding/logo')).status).toBe(200)
    expect((await visitor.get('/branding')).body.logoUrl).toBeNull()
    expect((await visitor.get('/branding/logo')).status).toBe(404)
  })
})
