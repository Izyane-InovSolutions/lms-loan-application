import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createMemoryKv, client, emailCode } from './helpers.js'

const kv = createMemoryKv()
vi.mock('../api/_lib/kv.js', () => ({ default: kv }))

// Codes and password links are captured instead of emailed.
const sentCodes = []
const sentLinks = []
vi.mock('../api/_lib/email.js', async (importOriginal) => ({
  ...(await importOriginal()),
  sendOtpEmail: vi.fn(async (email, code, details) => {
    sentCodes.push({ email, code, ...details })
  }),
  sendPasswordLinkEmail: vi.fn(async (email, details) => {
    sentLinks.push({ email, ...details })
  }),
}))

const { default: handler } = await import('../api/v1/[...path].js')
const { default: draftHandler } = await import('../api/draft/index.js')
const { default: requestCode } = await import('../api/otp/request.js')
const { default: verifyCode } = await import('../api/otp/verify.js')
const { default: cron } = await import('../api/cron/purge-expired-drafts.js')
const { totpCode } = await import('../api/_lib/auth/totp.js')
const { fillPlaceholders } = await import('../src/config/templates.js')

const admin = client(handler)
const drafts = client(draftHandler)
const codes = client(requestCode)
const resume = client(verifyCode)

const personal = (email, firstName = 'Mutale') => ({
  email,
  loanType: 'personal',
  currentStep: 1,
  personalData: { personalInfo: { firstName, surname: 'Phiri', email } },
  businessData: {},
  loanData: { amount: 8000, tenure: 6 },
})
const bearer = (token) => ({ authorization: `Bearer ${token}` })
const lastCode = (email) => sentCodes.filter((entry) => entry.email === email).at(-1)?.code

beforeAll(async () => {
  await admin.post('/auth/demo', { role: 'admin' })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('drafts', () => {
  it('can’t be taken over by starting one under the same email', async () => {
    const owner = await drafts.post('/draft', personal('owner@example.com', 'Owner'))
    expect(owner.status).toBe(200)

    const intruder = await drafts.post('/draft', personal('owner@example.com', 'Intruder'))
    expect(intruder.status).toBe(409)
    expect(intruder.body.code).toBe('draft_exists')
    expect(intruder.body.draft).toBeUndefined()
    expect(intruder.body.draftToken).toBeUndefined()

    // The owner's answers are untouched, and their token still continues it.
    const mine = await drafts.get('/draft', bearer(owner.body.draftToken))
    expect(mine.body.draft.personalData.personalInfo.firstName).toBe('Owner')
    expect((await drafts.post('/draft', personal('owner@example.com', 'Owner'), bearer(owner.body.draftToken))).status).toBe(200)
  })

  it('can’t be overwritten by moving another draft onto its email', async () => {
    const other = await drafts.post('/draft', personal('someone-else@example.com', 'Else'))
    const moved = await drafts.put('/draft', personal('owner@example.com', 'Moved'), bearer(other.body.draftToken))
    expect(moved.status).toBe(409)
    expect(moved.body.code).toBe('email_in_use')
    const victim = await kv.get('draft:owner@example.com')
    expect(victim.personalData.personalInfo.firstName).toBe('Owner')
  })

  it('is resumed on a new device with the emailed resume code', async () => {
    expect((await codes.post('/otp/request', { email: 'owner@example.com' })).status).toBe(200)
    const resumed = await resume.post('/otp/verify', { email: 'owner@example.com', code: lastCode('owner@example.com') })
    expect(resumed.status).toBe(200)
    expect(resumed.body.draft.personalData.personalInfo.firstName).toBe('Owner')
  })
})

describe('emailed codes', () => {
  it('only work for what they were sent for', async () => {
    await drafts.post('/draft', personal('consenting@example.com'))
    expect((await codes.post('/otp/request', { email: 'consenting@example.com', purpose: 'consent', agentName: 'The Bank Manager' })).status).toBe(200)
    const sent = sentCodes.at(-1)
    // The email names the signed-in agent, never one the caller made up.
    expect(sent.agentName).toBe('')

    // A consent code read out to an agent neither signs them in as the customer nor opens the draft.
    const customer = client(handler)
    expect((await customer.post('/auth/customer', { email: 'consenting@example.com', code: sent.code })).status).toBe(400)
    expect((await resume.post('/otp/verify', { email: 'consenting@example.com', code: sent.code })).status).toBe(400)
  })

  it('refuse a burst of parallel guesses, even with the right code after', async () => {
    await emailCode(kv, 'login', 'burst@example.com', '246810')
    const guesses = Array.from({ length: 30 }, (_, n) => client(handler).post('/auth/customer', { email: 'burst@example.com', code: String(100000 + n) }))
    await Promise.all(guesses)
    expect((await client(handler).post('/auth/customer', { email: 'burst@example.com', code: '246810' })).status).not.toBe(200)
  })

  it('stop working for an address after too many wrong guesses in a day, even with fresh codes', async () => {
    for (let round = 0; round < 4; round += 1) {
      await emailCode(kv, 'login', 'patient@example.com', '135790')
      for (let guess = 0; guess < 5; guess += 1) await client(handler).post('/auth/customer', { email: 'patient@example.com', code: '000001' })
    }
    await emailCode(kv, 'login', 'patient@example.com', '135790')
    expect((await client(handler).post('/auth/customer', { email: 'patient@example.com', code: '135790' })).status).toBe(429)
  })
})
