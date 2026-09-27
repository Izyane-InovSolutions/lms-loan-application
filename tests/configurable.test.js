import crypto from 'node:crypto'
import http from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createMemoryKv, client } from './helpers.js'

const kv = createMemoryKv()
vi.mock('../api/_lib/kv.js', () => ({ default: kv }))

const { default: handler } = await import('../api/v1/[...path].js')
const { putBlob } = await import('../api/_lib/blob.js')
const { sniffType } = await import('../api/_lib/fileChecks.js')
const { totpCode } = await import('../api/_lib/auth/totp.js')
const { priceLoan } = await import('../src/config/loanProducts.js')
const { encryptSecret, decryptSecret } = await import('../api/_lib/secrets.js')
const { runDailyMaintenance } = await import('../api/_lib/maintenance.js')
const { getDb, schema } = await import('../api/_lib/db/client.js')

const PDF = Buffer.from('%PDF-1.4\n% test file\n')

const prepareDraft = async (email, extra = {}) => {
  const token = crypto.randomBytes(12).toString('hex')
  const documents = {}
  const dataDocuments = {}
  for (const slot of ['payslips', 'bankStatements', 'nrcCopy', 'passportPhoto', 'tpin']) {
    const path = `personal.documents.${slot}`
    const stored = await putBlob(`drafts/${email}/${slot}.pdf`, PDF, { contentType: 'application/pdf' })
    documents[path] = { ...stored, filename: `${slot}.pdf`, contentType: 'application/pdf', size: PDF.length }
    dataDocuments[slot] = { __draftFile__: path }
  }
  await kv.set(`draft:${email}`, { documents })
  await kv.set(`draftToken:${token}`, email)
  return {
    token,
    body: {
      submissionKey: crypto.randomUUID(),
      loanType: 'personal',
      loanData: { amount: 5000, tenure: 6 },
      consents: { dataProcessing: true },
      data: {
        personalInfo: { firstName: 'Ada', surname: 'Phiri', phone: '971234567', email, nrc: '123456/78/9', birthDate: '1990-05-01' },
        employmentInfo: { residentialAddress: 'Lusaka' },
        documents: dataDocuments,
      },
      ...extra,
    },
  }
}

const applicant = client(handler)
const admin = client(handler)
const officer = client(handler)

const submit = async (email, extra) => {
  const { token, body } = await prepareDraft(email, extra)
  const response = await applicant.post('/applications', body, { authorization: `Bearer ${token}` })
  expect(response.status, JSON.stringify(response.body)).toBe(200)
  return response.body
}

/** Takes a submitted case to "approved" through the real workflow, with four-eyes off. */
const approve = async (id, { amount } = {}) => {
  let version = (await officer.get(`/applications/${id}`)).body.application.version
  const act = async (payload) => {
    const response = await officer.post(`/applications/${id}/actions`, { version, ...payload })
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    version = response.body.application.version
    return response
  }
  await act({ action: 'start_review' })
  for (const check of ['identity', 'documents', 'income']) await act({ action: 'check', check, done: true, note: 'Seen original' })
  return act({ action: 'recommend', verdict: 'approve', rationale: 'Affordable', ...(amount ? { amount } : {}) })
}

beforeAll(async () => {
  await admin.post('/auth/demo', { role: 'admin' })
  await officer.post('/auth/demo', { role: 'loan_officer' })
  await admin.put('/settings/workflow', { requireSecondApproval: false, officerApprovalLimit: 1000000, slaDays: 3 })
})

describe('building blocks', () => {
  it('prices flat and per-month interest, fixed and percentage fees', () => {
    expect(priceLoan(10000, 5, { interestRate: 0.05, interestBasis: 'loan', facilityFee: 175, facilityFeeType: 'fixed' })).toEqual({ interest: 500, fee: 175, total: 10675, monthly: 2135 })
    expect(priceLoan(10000, 5, { interestRate: 0.02, interestBasis: 'month', facilityFee: 0.01, facilityFeeType: 'percent' })).toEqual({ interest: 1000, fee: 100, total: 11100, monthly: 2220 })
  })

  it('recognises files by their contents, not their names', () => {
    expect(sniffType(PDF)).toBe('application/pdf')
    expect(sniffType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('image/jpeg')
    expect(sniffType(Buffer.from('<html><script>alert(1)</script></html>'))).toBe(null)
  })

  it('encrypts credentials so the stored value reveals nothing', () => {
    const stored = encryptSecret('lms-secret')
    expect(stored).not.toContain('lms-secret')
    expect(decryptSecret(stored)).toBe('lms-secret')
    expect(decryptSecret('enc:v1:bad')).toBe(null)
  })
})

describe('loan products from settings', () => {
  it('uses the configured pricing and limits for applicants and the server', async () => {
    const products = (await client(handler).get('/products')).body.products
    const personal = products.find((product) => product.id === 'personal')
    const saved = await admin.put('/settings/products', {
      personal: { ...personal, interestRate: 0.02, interestBasis: 'month', maxTenure: 12 },
      business: products.find((product) => product.id === 'business'),
    })
    expect(saved.status).toBe(200)
    const after = (await client(handler).get('/products')).body.products.find((product) => product.id === 'personal')
    expect(after.interestBasis).toBe('month')

    const { token, body } = await prepareDraft('longer@example.com', { loanData: { amount: 5000, tenure: 18 } })
    const tooLong = await applicant.post('/applications', body, { authorization: `Bearer ${token}` })
    expect(tooLong.body.code).toBe('invalid_tenure')

    const filed = await submit('priced@example.com')
    const detail = (await officer.get(`/applications/${filed.id}`)).body.application
    // 5000 + 2% × 6 months + K175, over 6 months
    expect(detail.totalRepayable).toBe(5775)

    const bad = await admin.put('/settings/products', { personal: { ...personal, minAmount: 9000, maxAmount: 100 }, business: products[1] })
    expect(bad.body.message).toContain('minimum amount is above the maximum')
    await admin.put('/settings/products', { personal, business: products.find((product) => product.id === 'business') })
  })
})

describe('terms and privacy notice', () => {
  it('starts with a placeholder, publishes new versions, and records the version consented to', async () => {
    const first = await client(handler).get('/legal/terms')
    expect(first.body.version).toBe(1)
    expect(first.body.body).not.toContain('Absa')
    expect((await admin.get('/admin/legal/terms')).body.placeholder).toBe(true)

    await admin.put('/admin/legal/terms/draft', { title: 'Loan agreement', body: 'These are the lender’s approved terms, version two.' })
    const published = await admin.post('/admin/legal/terms/publish', {})
    expect(published.body.published.version).toBe(2)
    expect((await client(handler).get('/legal/terms')).body.title).toBe('Loan agreement')

    const filed = await submit('consent@example.com')
    const consent = (await officer.get(`/applications/${filed.id}`)).body.consents.find((row) => row.type === 'data_processing')
    expect(consent.noticeVersion).toBe('terms-v2+privacy-v1')
  })
})

describe('offers', () => {
  const customerFor = async (email) => {
    const customer = client(handler)
    await kv.set(`otp:${email}`, { code: '424242', attempts: 0, createdAt: Date.now() }, { ex: 600 })
    await customer.post('/auth/customer', { email, code: '424242' })
    return customer
  }

  it('waits for the customer to accept before payout, and records the terms accepted', async () => {
    const filed = await submit('offer@example.com')
    const approved = await approve(filed.id, { amount: 4000 })
    expect(approved.body.application.status).toBe('approved')
    expect(approved.body.application.offerExpiresAt).toBeTruthy()

    // Paying out before acceptance is refused.
    const early = await officer.post(`/applications/${filed.id}/actions`, { action: 'mark_disbursed', version: approved.body.application.version })
    expect(early.body.code).toBe('invalid_state')

    const customer = await customerFor('offer@example.com')
    const mine = (await customer.get(`/me/applications/${filed.id}`)).body.application
    expect(mine.offer.amount).toBe(4000)
    expect((await customer.post(`/me/applications/${filed.id}/accept`)).status).toBe(200)

    const detail = (await officer.get(`/applications/${filed.id}`)).body
    expect(detail.application.status).toBe('accepted')
    expect(detail.consents.find((row) => row.type === 'offer').noticeVersion).toMatch(/^offer:K4000x6m/)
    const paid = await officer.post(`/applications/${filed.id}/actions`, { action: 'mark_disbursed', version: detail.application.version })
    expect(paid.body.application.status).toBe('disbursed')
  })

  it('lets the customer withdraw, and lapses offers not accepted in time', async () => {
    const withdrawn = await submit('changed.mind@example.com')
    const customer = await customerFor('changed.mind@example.com')
    expect((await customer.post(`/me/applications/${withdrawn.id}/withdraw`, { reason: 'Found another lender' })).status).toBe(200)
    expect((await officer.get(`/applications/${withdrawn.id}`)).body.application.status).toBe('withdrawn')

    const lapsing = await submit('slow@example.com')
    await approve(lapsing.id)
    const db = await getDb()
    const { eq } = await import('drizzle-orm')
    await db.update(schema.applications).set({ offerExpiresAt: new Date(Date.now() - 1000) }).where(eq(schema.applications.id, lapsing.id))
    const summary = await runDailyMaintenance('http://localhost')
    expect(summary.offersExpired).toBeGreaterThanOrEqual(1)
    expect((await officer.get(`/applications/${lapsing.id}`)).body.application.status).toBe('expired')
  })
})

describe('LMS connection from settings (against a stand-in Frappe)', () => {
  let server
  let baseUrl
  const created = []

  beforeAll(async () => {
    server = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://x')
      const send = (status, body) => {
        res.writeHead(status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(body))
      }
      if (req.headers.authorization !== 'token key123:secret456') return send(401, { exc_type: 'AuthenticationError' })
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      if (url.pathname === '/api/method/upload_file') return send(200, { message: { file_url: `/private/files/${created.length}.pdf` } })
      if (url.pathname.endsWith('create_custom_loan_application')) {
        const payload = JSON.parse(Buffer.concat(chunks).toString())
        created.push(payload)
        return send(200, { message: { name: `CLA-${created.length}` } })
      }
      if (url.pathname.endsWith('get_custom_loan_application_by_email')) {
        const email = url.searchParams.get('email')
        const rows = created.filter((payload) => payload.email === email).map((payload, index) => ({ name: `CLA-${index + 1}`, los_reference: payload.los_reference, loan_application_status: 'Disbursed' }))
        return rows.length ? send(200, { message: { data: rows } }) : send(404, { message: 'No Custom Loan Application found' })
      }
      send(404, {})
    })
    await new Promise((resolve) => server.listen(0, resolve))
    baseUrl = `http://localhost:${server.address().port}`
  })

  afterAll(() => server.close())

  const connection = (overrides = {}) => ({
    enabled: true,
    baseUrl,
    authMethod: 'token',
    apiKey: 'key123',
    apiSecret: 'secret456',
    methods: {
      login: '/api/method/auth_api.user_management.api.auth.login',
      upload: '/api/method/upload_file',
      create: '/api/method/rolaface_lms_app.modules.loan.custom_api.loanApplication.api.create_custom_loan_application',
      byEmail: '/api/method/rolaface_lms_app.modules.loan.custom_api.loanApplication.api.get_custom_loan_application_by_email',
    },
    referenceField: 'los_reference',
    statusField: 'loan_application_status',
    disbursedStatuses: ['Disbursed'],
    timeoutSeconds: 10,
    ...overrides,
  })

  it('tests a connection before it is saved, and never returns the secret', async () => {
    const wrong = await admin.post('/settings/lms/test', connection({ apiSecret: 'nope' }))
    expect(wrong.body.ok).toBe(false)
    const right = await admin.post('/settings/lms/test', connection())
    expect(right.body.ok).toBe(true)

    const saved = await admin.put('/settings/lmsConnection', connection())
    expect(saved.body.lmsConnection.apiSecret).toBe('')
    expect(saved.body.lmsConnection.apiSecretSet).toBe(true)
    // Saving again with the secret left blank keeps it.
    await admin.put('/settings/lmsConnection', connection({ apiSecret: '' }))
    expect((await admin.post('/settings/lms/test', {})).body.ok).toBe(true)
  })

  it('hands over an accepted loan with our reference, never twice, and picks up the payout', async () => {
    const filed = await submit('lms.customer@example.com')
    await approve(filed.id)
    const customer = client(handler)
    await kv.set('otp:lms.customer@example.com', { code: '515151', attempts: 0, createdAt: Date.now() }, { ex: 600 })
    await customer.post('/auth/customer', { email: 'lms.customer@example.com', code: '515151' })
    await customer.post(`/me/applications/${filed.id}/accept`)

    const synced = await (async () => {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const detail = (await officer.get(`/applications/${filed.id}`)).body.application
        if (detail.lmsSyncStatus === 'synced') return detail
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      throw new Error('never synced')
    })()
    expect(synced.lmsReference).toBe('CLA-1')
    expect(created[0].los_reference).toBe(filed.reference)
    expect(created[0].documents).toHaveLength(5)

    // A resend after an unconfirmed hand-off finds it already there instead of filing again.
    const db = await getDb()
    const { eq } = await import('drizzle-orm')
    await db.update(schema.applications).set({ lmsSyncStatus: 'failed', lmsReference: null }).where(eq(schema.applications.id, filed.id))
    await officer.post(`/applications/${filed.id}/lms/send`)
    expect(created).toHaveLength(1)
    expect((await officer.get(`/applications/${filed.id}`)).body.application.lmsReference).toBe('CLA-1')

    const summary = await runDailyMaintenance('http://localhost')
    expect(summary.lms.disbursed).toBe(1)
    expect((await officer.get(`/applications/${filed.id}`)).body.application.status).toBe('disbursed')
    await admin.put('/settings/lmsConnection', connection({ enabled: false }))
  })
})

describe('two-step sign-in', () => {
  it('asks for a code after the password, accepts a recovery code once, and can be required by role', async () => {
    const invite = await admin.post('/users', { name: 'Tumelo Officer', email: 'tumelo@example.com', role: 'loan_officer' })
    const person = client(handler)
    await person.post('/auth/password/set', { token: decodeURIComponent(invite.body.inviteUrl.split('token=')[1]), password: 'tumelo-strong-pass' })

    const { secret } = (await person.post('/auth/2fa/setup')).body
    expect((await person.post('/auth/2fa/enable', { code: '000000' })).body.code).toBe('invalid_code')
    const { recoveryCodes } = (await person.post('/auth/2fa/enable', { code: totpCode(secret) })).body
    expect(recoveryCodes).toHaveLength(10)

    const fresh = client(handler)
    const first = await fresh.post('/auth/login', { email: 'tumelo@example.com', password: 'tumelo-strong-pass' })
    expect(first.body.twoFactorRequired).toBe(true)
    expect(fresh.cookie).toBe('')
    expect((await fresh.post('/auth/login/verify', { challenge: first.body.challenge, code: '123456' })).status).toBe(400)
    const second = await fresh.post('/auth/login/verify', { challenge: first.body.challenge, code: totpCode(secret) })
    expect(second.body.user.email).toBe('tumelo@example.com')

    const other = client(handler)
    const again = await other.post('/auth/login', { email: 'tumelo@example.com', password: 'tumelo-strong-pass' })
    expect((await other.post('/auth/login/verify', { challenge: again.body.challenge, code: recoveryCodes[0] })).body.usedRecoveryCode).toBe(true)
    const reuse = await client(handler).post('/auth/login', { email: 'tumelo@example.com', password: 'tumelo-strong-pass' })
    expect((await client(handler).post('/auth/login/verify', { challenge: reuse.body.challenge, code: recoveryCodes[0] })).status).toBe(400)

    // Required for officers: a demo officer without it can only reach setup.
    await admin.put('/settings/security', { requireTwoFactorRoles: ['sales_manager'] })
    const manager = client(handler)
    const invited = await admin.post('/users', { name: 'Mapalo Sales', email: 'mapalo@example.com', role: 'sales_manager' })
    await manager.post('/auth/password/set', { token: decodeURIComponent(invited.body.inviteUrl.split('token=')[1]), password: 'mapalo-strong-pass' })
    expect((await manager.get('/applications')).body.code).toBe('two_factor_setup_required')
    expect((await manager.get('/auth/me')).body.user.twoFactorSetupRequired).toBe(true)
    expect((await manager.post('/auth/2fa/setup')).status).toBe(200)
    await admin.put('/settings/security', { requireTwoFactorRoles: [] })
  })
})

describe('data protection', () => {
  it('exports and erases a person, but keeps loan records', async () => {
    const declined = await submit('erase.me@example.com')
    const summary = (await admin.get('/admin/data-requests?email=erase.me@example.com')).body
    expect(summary.applications).toHaveLength(1)
    expect(summary.canErase).toBe(true)

    const exported = await admin.get('/admin/data-requests/export?email=erase.me@example.com')
    const payload = JSON.parse(exported.body.toString())
    expect(payload.applications[0].reference).toBe(declined.reference)
    expect(JSON.stringify(payload)).not.toContain('submissionKey')

    expect((await admin.post('/admin/data-requests/erase', { email: 'erase.me@example.com', confirm: 'wrong@example.com' })).status).toBe(400)
    const erased = await admin.post('/admin/data-requests/erase', { email: 'erase.me@example.com', confirm: 'erase.me@example.com' })
    expect(erased.body.erased.applications).toBe(1)
    expect((await officer.get(`/applications/${declined.id}`)).status).toBe(404)

    const kept = (await admin.get('/admin/data-requests?email=offer@example.com')).body
    expect(kept.canErase).toBe(false)
    expect((await admin.post('/admin/data-requests/erase', { email: 'offer@example.com', confirm: 'offer@example.com' })).body.code).toBe('retention_required')
  })

  it('deletes closed applications once their retention period has passed', async () => {
    const old = await submit('old.withdrawn@example.com')
    const db = await getDb()
    const { eq } = await import('drizzle-orm')
    await db.update(schema.applications).set({ status: 'withdrawn', withdrawnAt: new Date(Date.now() - 200 * 86400000) }).where(eq(schema.applications.id, old.id))
    const summary = await runDailyMaintenance('http://localhost')
    expect(summary.retention.withdrawn).toBeGreaterThanOrEqual(1)
    expect((await officer.get(`/applications/${old.id}`)).status).toBe(404)
  })
})

describe('notifications and health', () => {
  it('tells credit staff about new applications and lets them mark them read', async () => {
    await submit('notify@example.com')
    const inbox = await (async () => {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const response = await officer.get('/notifications')
        if (response.body.notifications.some((row) => row.type === 'new_application')) return response.body
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      throw new Error('no notification')
    })()
    expect(inbox.unread).toBeGreaterThan(0)
    expect((await officer.post('/notifications/read', { all: true })).body.unread).toBe(0)
  })

  it('records browser errors, groups repeats, and shows them to admins only', async () => {
    const browser = client(handler)
    for (let index = 0; index < 3; index += 1) {
      await browser.post('/client-errors', { message: `Cannot read properties of undefined (reading 'x') at row ${index}`, url: 'http://localhost/admin/applications/1234' })
    }
    const report = (await admin.get('/admin/health')).body
    const grouped = report.errors.find((row) => row.source === 'browser')
    expect(grouped.count).toBe(3)
    expect(report.checks.database.ok).toBe(true)
    expect((await officer.get('/admin/health')).status).toBe(403)
  })
})
