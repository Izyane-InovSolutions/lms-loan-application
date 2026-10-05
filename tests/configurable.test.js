import crypto from 'node:crypto'
import http from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createMemoryKv, client, signedAcceptance, emailCode } from './helpers.js'

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
const { getZraConfig } = await import('../api/_lib/zra/config.js')
const { generateJson } = await import('../api/_lib/ai/index.js')
const { signAwsRequest } = await import('../api/_lib/ai/cloud/aws.js')

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

describe('ZRA connection settings', () => {
  it('stores credentials encrypted, masks them in settings responses, and prefers database config', async () => {
    const values = {
      enabled: true,
      baseUrl: 'https://zws.test',
      apiKey: 'zra-settings-api-key',
      username: 'zra-settings-user',
      password: 'zra-settings-password',
      timeoutSeconds: 10,
    }

    const response = await admin.put('/settings/zra', values)

    expect(response.status).toBe(200)
    expect(response.body.zra).toMatchObject({
      enabled: true,
      baseUrl: values.baseUrl,
      apiKey: '',
      apiKeySet: true,
      username: '',
      usernameSet: true,
      password: '',
      passwordSet: true,
    })
    const db = await getDb()
    const [row] = await db.select().from(schema.settings).where((await import('drizzle-orm')).eq(schema.settings.key, 'zra')).limit(1)
    expect(row.value.apiKey).toMatch(/^enc:v1:/)
    expect(row.value.username).toMatch(/^enc:v1:/)
    expect(row.value.password).toMatch(/^enc:v1:/)

    const resolved = await getZraConfig()
    expect(resolved.source).toBe('database')
    expect(resolved.config).toMatchObject({
      baseUrl: values.baseUrl,
      apiKey: values.apiKey,
      username: values.username,
      password: values.password,
      timeoutSeconds: values.timeoutSeconds,
    })

    await admin.put('/settings/zra', { enabled: false, baseUrl: '', timeoutSeconds: 10 })
  })

  it('rejects a non-HTTPS ZRA address', async () => {
    const response = await admin.put('/settings/zra', {
      enabled: true,
      baseUrl: 'http://zws.test',
      timeoutSeconds: 10,
    })

    expect(response.status).toBe(400)
    expect(response.body.code).toBe('invalid_input')
  })

  it('tests the saved database connection without returning ZRA tokens', async () => {
    const originalSecretsKey = process.env.LOS_SECRETS_KEY
    process.env.LOS_SECRETS_KEY = 'test-zra-settings-secrets-key'
    const configured = await admin.put('/settings/zra', {
      enabled: true,
      baseUrl: 'https://zws.test',
      apiKey: 'zra-settings-api-key',
      username: 'zra-settings-user',
      password: 'zra-settings-password',
      timeoutSeconds: 10,
    })
    expect(configured.status).toBe(200)
    const originalFetch = globalThis.fetch
    const calls = []
    globalThis.fetch = vi.fn(async (url, options) => {
      calls.push({ url: String(url), options })
      return new Response(JSON.stringify({
        header: { status: 'SUCCESS' },
        data: {
          tokenType: 'bearer',
          accessToken: 'test-access-token',
          expiresIn: 300,
          refreshToken: 'test-refresh-token',
          refreshExpiresIn: 1800,
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })

    try {
      const result = await admin.post('/settings/zra/test', {})

      expect(result.status).toBe(200)
      expect(result.body, JSON.stringify(result.body)).toMatchObject({ ok: true })
      expect(JSON.stringify(result.body)).not.toMatch(/test-access-token|test-refresh-token/)
      expect(calls).toHaveLength(1)
      expect(calls[0].url).toBe('https://zws.test/zws/auth/login')
      expect(calls[0].options.headers['X-Api-Key']).toBe('zra-settings-api-key')
    } finally {
      globalThis.fetch = originalFetch
      if (originalSecretsKey === undefined) delete process.env.LOS_SECRETS_KEY
      else process.env.LOS_SECRETS_KEY = originalSecretsKey
    }
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
    await emailCode(kv, 'login', email, '424242')
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
    const accepted = await customer.post(`/me/applications/${filed.id}/accept`, await signedAcceptance(kv, 'offer@example.com'))
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200)

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
    await emailCode(kv, 'login', 'lms.customer@example.com', '515151')
    await customer.post('/auth/customer', { email: 'lms.customer@example.com', code: '515151' })
    await customer.post(`/me/applications/${filed.id}/accept`, await signedAcceptance(kv, 'lms.customer@example.com'))

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

describe('AI provider from settings (against stand-in Gemini and Mistral)', () => {
  const calls = []
  let geminiStatus = 200
  const realFetch = globalThis.fetch
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

  beforeAll(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const target = String(url)
      if (target.startsWith('https://generativelanguage.googleapis.com/')) {
        calls.push({ provider: 'gemini', key: init.headers['x-goog-api-key'], body: JSON.parse(init.body) })
        if (geminiStatus !== 200) return json(geminiStatus, { error: { code: geminiStatus, message: 'This model is currently experiencing high demand.', status: 'UNAVAILABLE' } })
        return json(200, { candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] })
      }
      if (target === 'https://api.mistral.ai/v1/ocr') {
        calls.push({ provider: 'mistral-ocr', body: JSON.parse(init.body) })
        return json(200, { pages: [{ index: 0, markdown: 'PAYSLIP Ada Phiri Net pay 12500.00' }] })
      }
      if (target.startsWith('https://api.mistral.ai/')) {
        calls.push({ provider: 'mistral', key: init.headers.Authorization, body: JSON.parse(init.body) })
        return json(200, { choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }] })
      }
      if (target === 'https://api.anthropic.com/v1/messages?beta=true' || target === 'https://api.anthropic.com/v1/messages') {
        const headers = new Headers(init.headers)
        calls.push({ provider: 'anthropic', key: headers.get('x-api-key'), beta: headers.get('anthropic-beta'), body: JSON.parse(init.body) })
        return json(200, {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: 'claude-opus-5-5',
          content: [{ type: 'text', text: '{"ok":true}' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
        })
      }
      if (target === 'http://gemma.test:11434/v1/chat/completions') {
        calls.push({ provider: 'openai-compatible', body: JSON.parse(init.body) })
        return json(200, { choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }] })
      }
      return realFetch(url, init)
    })
  })

  afterAll(async () => {
    vi.mocked(globalThis.fetch).mockRestore()
    // Back to the environment (no keys in tests), so later suites run with AI off.
    await admin.put('/settings/ai', {
      provider: 'environment',
      fallback: true,
      fallbacks: ['gemini', 'mistral'],
      ocr: 'off',
      geminiApiKey: null,
      mistralApiKey: null,
      anthropicApiKey: null,
      geminiModel: '',
      mistralModel: '',
      openaiCompatibleBaseUrl: '',
      openaiCompatibleModel: '',
    })
  })

  const ask = () =>
    generateJson({
      system: 'Check the file.',
      text: 'Is it ok?',
      files: [{ mimeType: 'application/pdf', data: PDF }],
      schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false },
      schemaName: 'check',
    })

  it('switches providers from Settings without returning the keys', async () => {
    expect((await admin.get('/settings')).body.integrations.ai.active).toBeNull()

    const saved = await admin.put('/settings/ai', { provider: 'mistral', fallback: false, geminiApiKey: 'g-key', mistralApiKey: 'm-key', geminiModel: '', mistralModel: '' })
    expect(saved.body.ai.mistralApiKey).toBe('')
    expect(saved.body.ai.mistralApiKeySet).toBe(true)
    expect((await admin.get('/settings')).body.integrations.ai.active).toMatchObject({ name: 'mistral', model: 'mistral-small-latest' })

    calls.length = 0
    expect((await ask()).provider).toBe('mistral')
    expect(calls).toHaveLength(1)
    expect(calls[0].key).toBe('Bearer m-key')
    expect(calls[0].body.messages[1].content.find((part) => part.type === 'document_url').document_url).toMatch(/^data:application\/pdf;base64,/)

    await admin.put('/settings/ai', { provider: 'gemini', fallback: false, geminiModel: 'gemini-test-model' })
    calls.length = 0
    const answer = await ask()
    expect(answer).toMatchObject({ provider: 'gemini', model: 'gemini-test-model', result: { ok: true } })
    expect(calls[0].key).toBe('g-key')
  })

  it('falls back to the other provider when the chosen one is overloaded', async () => {
    geminiStatus = 503
    await admin.put('/settings/ai', { provider: 'gemini', fallback: true, fallbacks: ['gemini', 'mistral'], geminiModel: '' })
    calls.length = 0
    expect((await ask()).provider).toBe('mistral')
    // One attempt on the busy model, not a round of retries, before moving on.
    expect(calls.map((call) => call.provider)).toEqual(['gemini', 'mistral'])

    const test = await admin.post('/settings/ai/test', { service: 'gemini' })
    expect(test.body.ok).toBe(false)
    expect((await admin.post('/settings/ai/test', { service: 'mistral', values: { mistralModel: 'mistral-large-latest' } })).body).toMatchObject({ ok: true })
    geminiStatus = 200
  })

  it('checks with Claude, asking for structured output and the server-side fallback', async () => {
    await admin.put('/settings/ai', { provider: 'anthropic', fallback: false, anthropicApiKey: 'a-key' })
    calls.length = 0
    expect(await ask()).toMatchObject({ provider: 'anthropic', model: 'claude-opus-5-5', result: { ok: true } })
    const [call] = calls
    expect(call.key).toBe('a-key')
    expect(call.beta).toContain('server-side-fallback-2026-07-01')
    expect(call.body.fallbacks).toBe('default')
    expect(call.body.output_config).toMatchObject({ format: { type: 'json_schema' }, effort: 'medium' })
    expect(call.body.messages[0].content[0]).toMatchObject({ type: 'document', source: { type: 'base64', media_type: 'application/pdf' } })
  })

  it('reads PDFs through the OCR step for a self-hosted model that only takes images', async () => {
    const selfHosted = {
      provider: 'openai-compatible',
      fallback: false,
      openaiCompatibleBaseUrl: 'http://gemma.test:11434/v1',
      openaiCompatibleModel: 'gemma3:27b',
      ocr: 'mistral-ocr',
      ocrMode: 'when_needed',
    }
    await admin.put('/settings/ai', selfHosted)
    expect((await admin.get('/settings')).body.integrations.ai.ocr).toMatchObject({ name: 'mistral-ocr', mode: 'when_needed' })
    calls.length = 0
    expect(await ask()).toMatchObject({ provider: 'openai-compatible', ocr: 'mistral-ocr' })
    expect(calls.map((call) => call.provider)).toEqual(['mistral-ocr', 'openai-compatible'])
    const sent = calls[1].body.messages[1].content
    expect(sent).toHaveLength(1)
    expect(sent[0].text).toContain('Net pay 12500.00')

    // Without OCR the self-hosted model can't take the PDF at all.
    await admin.put('/settings/ai', { ...selfHosted, ocr: 'off' })
    await expect(ask()).rejects.toThrow(/cannot read application\/pdf/)
  })

  it('rejects a service account key that is not one, and unknown services', async () => {
    const bad = await admin.put('/settings/ai', { googleServiceAccount: '{"type":"user"}' })
    expect(bad.status).toBe(400)
    expect(bad.body.message).toMatch(/service account/)
    expect((await admin.post('/settings/ai/test', { service: 'nope' })).body.ok).toBe(false)
  })

  it('signs AWS requests as in AWS’s published SigV4 test vector', () => {
    const signed = signAwsRequest({
      method: 'GET',
      host: 'example.amazonaws.com',
      path: '/',
      body: '',
      region: 'us-east-1',
      service: 'service',
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      now: new Date('2015-08-30T12:36:00Z'),
      signPayloadHeader: false,
    })
    expect(signed.headers.Authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31'
    )
  })
})
