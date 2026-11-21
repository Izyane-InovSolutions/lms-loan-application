import http from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createMemoryKv, client, draftPreparer } from './helpers.js'

const kv = createMemoryKv()
vi.mock('../api/_lib/kv.js', () => ({ default: kv }))

// Codes are captured instead of emailed or texted.
const sentCodes = []
const texts = []
vi.mock('../api/_lib/email.js', async (importOriginal) => ({
  ...(await importOriginal()),
  sendOtpEmail: vi.fn(async (email, code, details) => {
    sentCodes.push({ email, code, ...details })
  }),
}))
vi.mock('../api/_lib/sms.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getSms: vi.fn(async () => ({ name: 'test', send: async (to, message) => texts.push({ to, message }) })),
}))

const { default: handler } = await import('../api/v1/[...path].js')
const { default: draftHandler } = await import('../api/draft/index.js')
const { putBlob } = await import('../api/_lib/blob.js')
const { settleBackgroundTasks } = await import('../api/_lib/after.js')
const { KYC_PRESETS, applyMapping, tidyValue } = await import('../src/config/kyc.js')

const prepareDraft = draftPreparer(kv, putBlob)
const admin = client(handler)
const officer = client(handler)
const agent = client(handler)
const visitor = client(handler)
const applicant = client(handler)
const drafts = client(draftHandler)

// The iZyane sample answer, trimmed.
const RECORD = {
  id: 283,
  nationality: 'Zambian',
  title: 'Mr',
  first_name: 'Zawadi',
  other_name: null,
  surname: 'kayoka',
  dob: '1992-09-30',
  gender: 'male',
  marital_status: 'single',
  id_type: 'NRC',
  id_number: '297976/26/1',
  tpin: '2979762613',
  residential_address: '42D213 Kabwata Estates',
  mobile_number: '260968009727',
  email: 'zawadikayoka4@gmail.com',
  employment_type: 'Employment',
  next_of_kin: 'tanjiro kayoka',
  next_of_kin_contact: '260971938765',
  next_of_kin_relationship: 'Son',
  passport_photo: '/api/v1/media/customer_photos/selfie.png',
  specimen_signature: '/api/v1/media/signatures/signature.png',
  employer_name: 'izyane inovsolutions and payments limited',
}

// A stand-in platform: answers like the iZyane hub, and records what it was sent.
const platform = { requests: [], mode: 'ok', tokens: 0 }
let server
let baseUrl

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://local')
    if (url.pathname === '/oauth/token') {
      platform.tokens += 1
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ access_token: 'token-123', expires_in: 3600 }))
    }
    platform.requests.push({ path: url.pathname, id: url.searchParams.get('id_number'), headers: req.headers })
    if (platform.mode === 'html') {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      return res.end('<html>Login</html>')
    }
    if (url.searchParams.get('id_number') !== '297976/26/1') {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ status: 'error', message: 'Customer not found' }))
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'success', message: 'Customer found', data: RECORD }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`

  await admin.post('/auth/demo', { role: 'admin' })
  await officer.post('/auth/demo', { role: 'loan_officer' })
  await agent.post('/auth/demo', { role: 'dsa' })
  const saved = await admin.put('/settings/kyc', {
    ...KYC_PRESETS.izyane.settings,
    enabled: true,
    preset: 'izyane',
    baseUrl,
    authType: 'apiKey',
    apiKeyHeader: 'X-Api-Key',
    apiKey: 'secret-key',
  })
  expect(saved.status, JSON.stringify(saved.body)).toBe(200)
})

afterAll(() => server?.close())

const lastCode = () => sentCodes.at(-1)?.code || texts.at(-1)?.message.match(/\d{6}/)?.[0]

describe('mapping a record', () => {
  it('tidies values for the form', () => {
    expect(tidyValue('260968009727', 'phone')).toBe('968009727')
    expect(tidyValue('male', 'choice', ['Male', 'Female'])).toBe('Male')
    expect(tidyValue('Zambian', 'choice', ['Kenya', 'Zambia'])).toBe('Zambia')
    expect(tidyValue('Martian', 'choice', ['Kenya', 'Zambia'])).toBeNull()
    expect(tidyValue('30/09/1992', 'date')).toBe('1992-09-30')
    expect(tidyValue(['A', 'B'], 'none')).toBe('A, B')
    expect(tidyValue('Daughter', 'choice', ['Parent', 'Child'])).toBe('Child')
    expect(tidyValue('Employment (Salaried)', 'choice', ['Employed', 'Retired'])).toBe('Employed')
  })

  it('maps the iZyane answer, never the photo or signature', () => {
    const { values, contacts } = applyMapping(RECORD, KYC_PRESETS.izyane.settings.mappings.personal, 'personal')
    expect(values).toMatchObject({
      'personalInfo.firstName': 'Zawadi',
      'personalInfo.surname': 'kayoka',
      'personalInfo.phone': '968009727',
      'personalInfo.email': 'zawadikayoka4@gmail.com',
      'personalInfo.gender': 'Male',
      'personalInfo.maritalStatus': 'Single',
      'personalInfo.birthDate': '1992-09-30',
      'employmentInfo.nationality': 'Zambia',
      'employmentInfo.occupation': 'Employed',
      'employmentInfo.nextOfKinName': 'tanjiro kayoka',
      'employmentInfo.nextOfKinPhone': '971938765',
      'employmentInfo.nextOfKinRelationship': 'Child',
    })
    expect(values['personalInfo.middleName']).toBeUndefined()
    expect(JSON.stringify(values)).not.toMatch(/selfie|signature/)
    expect(contacts).toEqual({ mobile: '+260968009727', email: 'zawadikayoka4@gmail.com' })
  })
})

describe('Settings → Customer records', () => {
  it('keeps the API key secret, and tests a lookup with the saved connection', async () => {
    const { kyc } = (await admin.get('/settings')).body.settings
    expect(kyc).toMatchObject({ enabled: true, apiKey: '', apiKeySet: true })
    const test = await admin.post('/settings/kyc/test', { idType: 'nrc', id: '297976/26/1' })
    expect(test.body).toMatchObject({ status: 'found', httpStatus: 200, values: { 'personalInfo.firstName': 'Zawadi' }, contacts: { mobile: '+260968009727' } })
    expect(test.body.raw.data.specimen_signature).toBe('[hidden]')
    expect(platform.requests.at(-1).headers['x-api-key']).toBe('secret-key')
    expect((await admin.post('/settings/kyc/test', { idType: 'nrc', id: '111111/11/1' })).body.status).toBe('not_found')
    expect((await officer.post('/settings/kyc/test', { idType: 'nrc', id: '297976/26/1' })).status).toBe(403)
  })

  it('never sends the saved key to another address in a test', async () => {
    const { kyc } = (await admin.get('/settings')).body.settings
    const other = await admin.post('/settings/kyc/test', { idType: 'nrc', id: '297976/26/1', form: { ...kyc, baseUrl: `http://localhost:${new URL(baseUrl).port}` } })
    expect(other.body.status).toBe('found')
    expect(platform.requests.at(-1).headers['x-api-key']).toBe('')
  })

  it('signs in with OAuth client credentials, fetching the token once', async () => {
    const { kyc } = (await admin.get('/settings')).body.settings
    const form = { ...kyc, authType: 'oauth', tokenUrl: `${baseUrl}/oauth/token`, clientId: 'los', clientSecret: 'shh' }
    await admin.post('/settings/kyc/test', { idType: 'nrc', id: '297976/26/1', form })
    await admin.post('/settings/kyc/test', { idType: 'nrc', id: '297976/26/1', form })
    expect(platform.tokens).toBe(1)
    expect(platform.requests.at(-1).headers.authorization).toBe('Bearer token-123')
  })

  it('refuses a lookup path without {id}, and an unknown form field', async () => {
    const { kyc } = (await admin.get('/settings')).body.settings
    expect((await admin.put('/settings/kyc', { ...kyc, lookups: { ...kyc.lookups, nrc: { enabled: true, method: 'GET', path: '/lookup' } } })).status).toBe(400)
    expect((await admin.put('/settings/kyc', { ...kyc, mappings: { personal: [{ field: 'personalInfo.password', path: 'x' }], business: [] } })).status).toBe(400)
  })

  it('treats an answer that isn’t JSON as an error', async () => {
    platform.mode = 'html'
    expect((await admin.post('/settings/kyc/test', { idType: 'nrc', id: '297976/26/1' })).body).toMatchObject({ status: 'error', error: expect.stringMatching(/wasn’t JSON/) })
    platform.mode = 'ok'
  })
})

describe('an applicant looked up as they start', () => {
  it('learns only that there is a record, and the masked contacts on it', async () => {
    expect((await visitor.get('/products')).body.kyc).toEqual({ nrc: true, passport: true, tpin: false })
    const found = await visitor.post('/kyc/lookup', { idType: 'nrc', id: '297976 26 1' })
    expect(found.body).toEqual({ found: true, reference: expect.any(String), id: '297976/26/1', contacts: { mobile: '+260 96…727', email: 'z…@gmail.com' }, otherContactAllowed: true })
    expect((await visitor.post('/kyc/lookup', { idType: 'nrc', id: '111111/11/1' })).body).toMatchObject({ found: false })
    expect((await visitor.post('/kyc/lookup', { idType: 'nrc', id: '12345' })).body.code).toBe('invalid_id')
    expect((await visitor.post('/kyc/lookup', { idType: 'tpin', id: '1234567890' })).body.code).toBe('kyc_off')
  })

  it('gets the record’s details after a code to the mobile on record, and keeps them to the application', async () => {
    const { reference } = (await visitor.post('/kyc/lookup', { idType: 'nrc', id: '297976/26/1' })).body
    expect((await visitor.post('/verification/start', { reference, contact: 'mobile' })).status).toBe(200)
    expect(texts.at(-1).to).toBe('+260968009727')
    expect((await visitor.post('/verification/check', { reference, contact: 'mobile', code: '000000' })).status).toBe(400)
    const checked = await visitor.post('/verification/check', { reference, contact: 'mobile', code: lastCode() })
    expect(checked.body).toMatchObject({ channel: 'phone', value: '+260968009727', fill: { idField: 'personalInfo.nrc', id: '297976/26/1', values: { 'personalInfo.firstName': 'Zawadi' } } })

    // The form as filled; the draft keeps the record (not the browser), and the application gets it.
    const email = 'zawadikayoka4@gmail.com'
    const { token, body } = await prepareDraft(email)
    const draft = await kv.get(`draft:${email}`)
    await kv.del(`draft:${email}`)
    const personalInfo = { ...body.data.personalInfo, email, phone: '968009727', nrc: '297976/26/1', firstName: 'Zawadi', surname: 'kayoka' }
    const started = await drafts.post('/draft', { email, loanType: 'personal', personalData: { personalInfo }, verificationTicket: checked.body.ticket })
    expect(started.status, JSON.stringify(started.body)).toBe(200)
    expect(started.body.draft.kyc).toEqual({ reference, contact: 'record' })
    expect(JSON.stringify(started.body)).not.toMatch(/Kabwata/)
    // The test's uploaded files, onto the draft just started.
    await kv.set(`draft:${email}`, { ...(await kv.get(`draft:${email}`)), documents: draft.documents })
    body.data.personalInfo = personalInfo
    const filed = await applicant.post('/applications', body, { authorization: `Bearer ${started.body.draftToken}` })
    expect(filed.status, JSON.stringify(filed.body)).toBe(200)
    expect(token).toBeTruthy()
    await settleBackgroundTasks()
    const detail = (await officer.get(`/applications/${filed.body.id}`)).body
    expect(detail.application.kyc).toMatchObject({ found: true, contact: 'record', source: 'iZyane KYC hub', contactsOnRecord: { mobile: '+260 96…727' }, values: { 'employmentInfo.residentialAddress': '42D213 Kabwata Estates' } })
    expect(detail.prescreen.facts.kyc_confirmed_on_record).toBe(true)
  })

  it('with another contact, fills what the workspace allows, or refuses it', async () => {
    const { kyc } = (await admin.get('/settings')).body.settings
    // Kept from the last lookup: looking the same ID up again would reach its hourly limit.
    let looked
    const viaOther = async () => {
      looked = (await visitor.post('/kyc/lookup', { idType: 'nrc', id: '297976/26/1' })).body
      const { reference } = looked
      const email = `other${sentCodes.length}@example.com`
      const started = await visitor.post('/verification/start', { reference, channel: 'email', email })
      if (started.status !== 200) return started
      return visitor.post('/verification/check', { reference, channel: 'email', email, code: lastCode() })
    }
    expect((await viaOther()).body.fill.values).toEqual({})

    await admin.put('/settings/kyc', { ...kyc, otherContact: { policy: 'fields', fields: ['personalInfo.firstName', 'personalInfo.surname'] } })
    expect((await viaOther()).body.fill.values).toEqual({ 'personalInfo.firstName': 'Zawadi', 'personalInfo.surname': 'kayoka' })

    await admin.put('/settings/kyc', { ...kyc, otherContact: { policy: 'refuse', fields: [] } })
    const refused = await viaOther()
    expect(refused.status).toBe(403)
    expect(refused.body.code).toBe('other_contact_refused')
    expect(looked.otherContactAllowed).toBe(false)
    await admin.put('/settings/kyc', { ...kyc, otherContact: { policy: 'none', fields: [] } })
  })

  it('stops after a few lookups of the same ID', async () => {
    let last
    for (let attempt = 0; attempt < 6; attempt += 1) last = await client(handler).post('/kyc/lookup', { idType: 'passport', id: 'ZN123456' })
    expect(last.status).toBe(429)
    // Raised in Settings: the same ID can be looked up again at once.
    const { kyc } = (await admin.get('/settings')).body.settings
    expect(kyc.limits).toEqual({ perIdPerHour: 5, perIpPerHour: 20 })
    expect((await admin.put('/settings/kyc', { ...kyc, limits: { perIdPerHour: 0, perIpPerHour: 20 } })).status).toBe(400)
    expect((await admin.put('/settings/kyc', { ...kyc, limits: { perIdPerHour: 50, perIpPerHour: 100 } })).status).toBe(200)
    expect((await client(handler).post('/kyc/lookup', { idType: 'passport', id: 'ZN123456' })).status).toBe(200)
    await admin.put('/settings/kyc', kyc)
  })
})

describe('an agent', () => {
  it('gets the details at once, audited, without a code', async () => {
    const looked = await agent.post('/kyc/lookup/assisted', { idType: 'nrc', id: '297976/26/1' })
    expect(looked.body).toMatchObject({ found: true, idField: 'personalInfo.nrc', values: { 'personalInfo.firstName': 'Zawadi' } })
    expect((await visitor.post('/kyc/lookup/assisted', { idType: 'nrc', id: '297976/26/1' })).status).toBe(401)
    const audit = (await admin.get('/audit?action=kyc.looked_up')).body
    expect(JSON.stringify(audit)).toMatch(/kyc.looked_up/)
  })
})
