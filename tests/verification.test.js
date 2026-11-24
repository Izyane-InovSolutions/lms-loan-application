import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createMemoryKv, client, draftPreparer } from './helpers.js'

const kv = createMemoryKv()
vi.mock('../api/_lib/kv.js', () => ({ default: kv }))

// Codes are captured instead of emailed or texted.
const sentCodes = []
const texts = []
let smsOn = false
vi.mock('../api/_lib/email.js', async (importOriginal) => ({
  ...(await importOriginal()),
  sendOtpEmail: vi.fn(async (email, code, details) => {
    sentCodes.push({ email, code, ...details })
  }),
}))
vi.mock('../api/_lib/sms.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getSms: vi.fn(async () => (smsOn ? { name: 'test', send: async (to, message) => texts.push({ to, message }) } : null)),
}))

const { default: handler } = await import('../api/v1/[...path].js')
const { default: draftHandler } = await import('../api/draft/index.js')
const { putBlob } = await import('../api/_lib/blob.js')
const { settleBackgroundTasks } = await import('../api/_lib/after.js')
const { redeemTicket, normalisePhone } = await import('../api/_lib/verification.js')
const { applicantId, maskEmail, maskPhone } = await import('../api/_lib/identityFlags.js')

const prepareDraft = draftPreparer(kv, putBlob)
const admin = client(handler)
const officer = client(handler)
const applicant = client(handler)
const visitor = client(handler)
const drafts = client(draftHandler)

const codeFor = (to) => {
  const email = sentCodes.filter((entry) => entry.email === to).at(-1)
  if (email) return email.code
  return texts.filter((entry) => entry.to === to).at(-1)?.message.match(/\d{6}/)?.[0]
}

/** A confirmed ticket for `contact` ({ channel, email | phone }), as the dialog gets one. */
const ticketFor = async (contact) => {
  expect((await visitor.post('/verification/start', contact)).status).toBe(200)
  const to = contact.channel === 'email' ? contact.email : normalisePhone(contact.phone)
  const checked = await visitor.post('/verification/check', { ...contact, code: codeFor(to) })
  expect(checked.status, JSON.stringify(checked.body)).toBe(200)
  // The wait between codes is per contact; tests ask again for the same one at once.
  await kv.del(`otp:start:${contact.channel}:${to}`)
  return checked.body.ticket
}

const personal = (email, phone = '971234567') => ({
  email,
  loanType: 'personal',
  currentStep: 1,
  personalData: { personalInfo: { firstName: 'Mutale', surname: 'Phiri', email, phone } },
  businessData: {},
  loanData: { amount: 8000, tenure: 6, income: 20000 },
})

/** Submits a personal application with these details; returns the response. */
const submit = async (email, { nrc, phone, verified } = {}) => {
  const { token, body } = await prepareDraft(email)
  if (verified) {
    const draft = await kv.get(`draft:${email}`)
    await kv.set(`draft:${email}`, { ...draft, verified })
  }
  body.data.personalInfo = { ...body.data.personalInfo, email, ...(nrc ? { nrc } : {}), ...(phone ? { phone } : {}) }
  const response = await applicant.post('/applications', body, { authorization: `Bearer ${token}` })
  await settleBackgroundTasks()
  return { response, token, body }
}

const caseOf = async (id) => (await officer.get(`/applications/${id}`)).body

beforeAll(async () => {
  await admin.post('/auth/demo', { role: 'admin' })
  await officer.post('/auth/demo', { role: 'loan_officer' })
})

describe('the code an applicant starts with', () => {
  it('is emailed, checked, and exchanged for a ticket that works once', async () => {
    expect((await visitor.post('/verification/start', { channel: 'email', email: 'Ada@Example.com' })).status).toBe(200)
    const sent = sentCodes.at(-1)
    expect(sent).toMatchObject({ email: 'ada@example.com', purpose: 'start' })
    expect((await visitor.post('/verification/check', { channel: 'email', email: 'ada@example.com', code: '000000' })).body.code).toBe('invalid_code')
    const checked = await visitor.post('/verification/check', { channel: 'email', email: 'ada@example.com', code: sent.code })
    expect(checked.body).toMatchObject({ channel: 'email', value: 'ada@example.com', ticket: expect.any(String) })
    expect(await redeemTicket(checked.body.ticket)).toEqual({ channel: 'email', value: 'ada@example.com' })
    expect(await redeemTicket(checked.body.ticket)).toBeNull()
    // Spent with the ticket: the same code can't be checked again.
    expect((await visitor.post('/verification/check', { channel: 'email', email: 'ada@example.com', code: sent.code })).status).toBe(400)
  })

  it('goes by text only when an SMS provider is set up', async () => {
    const refused = await visitor.post('/verification/start', { channel: 'phone', phone: '0971234567' })
    expect(refused.body.code).toBe('sms_unavailable')
    smsOn = true
    expect((await visitor.get('/products')).body.applicantVerification).toEqual({ required: true, sms: true })
    expect((await visitor.post('/verification/start', { channel: 'phone', phone: '0971234567' })).status).toBe(200)
    expect(texts.at(-1).to).toBe('+260971234567')
    const checked = await visitor.post('/verification/check', { channel: 'phone', phone: '971234567', code: codeFor('+260971234567') })
    expect(checked.body).toMatchObject({ channel: 'phone', value: '+260971234567' })
    // A second code straight away is refused.
    expect((await visitor.post('/verification/start', { channel: 'phone', phone: '971234567' })).status).toBe(200)
    expect((await visitor.post('/verification/start', { channel: 'phone', phone: '971234567' })).status).toBe(429)
    smsOn = false
  })
})

describe('starting a draft', () => {
  it('needs a ticket for the form’s own email or phone', async () => {
    const none = await drafts.post('/draft', personal('start@example.com'))
    expect(none.status).toBe(401)
    expect(none.body.code).toBe('verification_required')
    expect(await kv.get('draft:start@example.com')).toBeNull()

    const someoneElses = await ticketFor({ channel: 'email', email: 'other@example.com' })
    expect((await drafts.post('/draft', { ...personal('start@example.com'), verificationTicket: someoneElses })).status).toBe(401)

    const ticket = await ticketFor({ channel: 'email', email: 'start@example.com' })
    const started = await drafts.post('/draft', { ...personal('start@example.com'), verificationTicket: ticket })
    expect(started.status, JSON.stringify(started.body)).toBe(200)
    expect((await kv.get('draft:start@example.com')).verified).toMatchObject({ channel: 'email', value: 'start@example.com' })
  })

  it('takes a ticket for the phone on the form too', async () => {
    smsOn = true
    const ticket = await ticketFor({ channel: 'phone', phone: '955123456' })
    smsOn = false
    const started = await drafts.post('/draft', { ...personal('byphone@example.com', '955123456'), verificationTicket: ticket })
    expect(started.status, JSON.stringify(started.body)).toBe(200)
    expect((await kv.get('draft:byphone@example.com')).verified).toMatchObject({ channel: 'phone', value: '+260955123456' })
  })

  it('needs nothing when the workspace turns codes off', async () => {
    const options = (await admin.get('/settings')).body.settings.customerOptions
    expect(options.verifyAtStart).toBe(true)
    expect((await admin.put('/settings/customerOptions', { ...options, verifyAtStart: false })).status).toBe(200)
    expect((await visitor.get('/products')).body.applicantVerification.required).toBe(false)
    expect((await drafts.post('/draft', personal('nocode@example.com'))).status).toBe(200)
    await admin.put('/settings/customerOptions', options)
  })
})

describe('submitting', () => {
  it('refuses a contact changed after confirming it, until the new one is confirmed', async () => {
    const email = 'changed@example.com'
    const { response, token, body } = await submit(email, { nrc: '222222/22/2', phone: '966000111', verified: { channel: 'phone', value: '+260966000222', at: Date.now() } })
    expect(response.status).toBe(409)
    expect(response.body).toMatchObject({ code: 'verification_required', message: expect.stringMatching(/changed your phone number/) })

    smsOn = true
    const ticket = await ticketFor({ channel: 'phone', phone: '966000111' })
    smsOn = false
    const saved = await drafts.put('/draft', { loanType: 'personal', personalData: body.data, verificationTicket: ticket }, { authorization: `Bearer ${token}` })
    expect(saved.status, JSON.stringify(saved.body)).toBe(200)
    const filed = await applicant.post('/applications', body, { authorization: `Bearer ${token}` })
    expect(filed.status, JSON.stringify(filed.body)).toBe(200)
    expect((await caseOf(filed.body.id)).application.contactVerification).toMatchObject({ channel: 'phone', value: '+260966000111' })
  })

  it('refuses a draft never confirmed', async () => {
    const email = 'never@example.com'
    const { token, body } = await prepareDraft(email)
    const draft = await kv.get(`draft:${email}`)
    delete draft.verified
    await kv.set(`draft:${email}`, draft)
    const response = await applicant.post('/applications', body, { authorization: `Bearer ${token}` })
    expect(response.body.code).toBe('verification_required')
  })
})

describe('ID and contact check', () => {
  it('reads and masks IDs and contacts', () => {
    expect(applicantId('personal', { personalInfo: { nrc: '123456 78 9' } })).toBe('123456789')
    expect(applicantId('personal', { personalInfo: { nrc: '123456/78/9', passportNumber: 'AK12' }, employmentInfo: { nationality: 'Kenya' } })).toBe('ak12')
    expect(maskEmail('ada@gmail.com')).toBe('a…@gmail.com')
    expect(maskPhone('0971234456')).toBe('+260 9…456')
  })

  it('warns staff when an ID comes back with other contact details, or contact details with another ID', async () => {
    const first = await submit('first@example.com', { nrc: '333333/33/3', phone: '977111222' })
    expect(first.response.status, JSON.stringify(first.response.body)).toBe(200)
    const clean = await caseOf(first.response.body.id)
    expect(clean.application.identityFlags).toEqual([])
    expect(clean.prescreen.facts.id_contact_mismatch).toBe(false)

    // Same NRC (typed differently), another email and phone.
    const second = await submit('second@example.com', { nrc: '333333 33 3', phone: '977999888' })
    const flagged = await caseOf(second.response.body.id)
    expect(flagged.application.identityFlags).toEqual([
      expect.objectContaining({ kind: 'id_other_contact', reference: clean.application.reference, channel: 'email', contact: 'f…@example.com', verified: true }),
    ])
    expect(flagged.prescreen.facts.id_contact_mismatch).toBe(true)
    expect(flagged.events.some((event) => /ID and contact check: this ID was used on/.test(event.message))).toBe(true)

    // The first phone again, with another NRC.
    const third = await submit('third@example.com', { nrc: '444444/44/4', phone: '0977111222' })
    const other = await caseOf(third.response.body.id)
    expect(other.application.identityFlags).toEqual([expect.objectContaining({ kind: 'contact_other_id', reference: clean.application.reference, channel: 'phone', id: '…3333' })])
  })
})

describe('filling the form from their last loan', () => {
  it('answers only for a confirmed draft, by the contact it was confirmed with, and only when offered', async () => {
    const email = 'returning@example.com'
    const first = await submit(email, { nrc: '555555/55/5', phone: '966555444' })
    expect(first.response.status, JSON.stringify(first.response.body)).toBe(200)
    const reference = (await caseOf(first.response.body.id)).application.reference

    // No token: nothing, whatever email is asked about.
    expect((await visitor.get(`/prefill?type=personal&email=${email}`)).status).toBe(401)

    // Their new draft, confirmed by email.
    const { token } = await prepareDraft(email)
    const byEmail = await visitor.get('/prefill?type=personal', { authorization: `Bearer ${token}` })
    expect(byEmail.body).toMatchObject({ from: { reference }, formState: { personalData: { personalInfo: { nrc: '555555/55/5' } } } })
    expect(JSON.stringify(byEmail.body)).not.toMatch(/__draftFile__/)

    // Confirmed by phone instead: found by the phone, not the email.
    const other = 'newaddress@example.com'
    const byPhoneDraft = await prepareDraft(other)
    await kv.set(`draft:${other}`, { ...(await kv.get(`draft:${other}`)), verified: { channel: 'phone', value: '+260966555444', at: Date.now() } })
    expect((await visitor.get('/prefill?type=personal', { authorization: `Bearer ${byPhoneDraft.token}` })).body.from.reference).toBe(reference)

    // Not confirmed: nothing.
    const unconfirmed = await prepareDraft('unconfirmed@example.com')
    const draft = await kv.get('draft:unconfirmed@example.com')
    delete draft.verified
    await kv.set('draft:unconfirmed@example.com', draft)
    expect((await visitor.get('/prefill?type=personal', { authorization: `Bearer ${unconfirmed.token}` })).body.formState).toBeNull()

    // Switched off by the workspace.
    const options = (await admin.get('/settings')).body.settings.customerOptions
    expect(options.prefillFromLastLoan).toBe(true)
    await admin.put('/settings/customerOptions', { ...options, prefillFromLastLoan: false })
    expect((await visitor.get('/prefill?type=personal', { authorization: `Bearer ${token}` })).body.formState).toBeNull()
    expect((await visitor.get('/customer-options')).body.prefillFromLastLoan).toBe(false)
    await admin.put('/settings/customerOptions', options)
  })
})

describe('a staff member’s email', () => {
  const staffEmail = 'demo.loan-officer@demo.los.local'
  it('can’t be used to start an application', async () => {
    const response = await visitor.post('/verification/start', { channel: 'email', email: staffEmail.toUpperCase() })
    expect(response.status).toBe(403)
    expect(response.body.code).toBe('staff_account')
    expect(sentCodes.some((entry) => entry.email === staffEmail)).toBe(false)
  })

  it('can’t be the applicant’s email on a submitted application', async () => {
    // A draft under that email, as one from before this check would be.
    const { token, body } = await prepareDraft(staffEmail)
    body.data.personalInfo.email = staffEmail
    const response = await applicant.post('/applications', body, { authorization: `Bearer ${token}` })
    expect(response.status).toBe(403)
    expect(response.body.code).toBe('staff_account')
  })
})
