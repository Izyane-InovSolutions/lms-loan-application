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

describe('two-step sign-in', () => {
  let officerId
  let secret

  it('is still asked for after a password reset', async () => {
    const invite = await admin.post('/users', { name: 'Reset Officer', email: 'reset.officer@example.com', role: 'loan_officer' })
    officerId = invite.body.user.id
    const person = client(handler)
    const inviteToken = decodeURIComponent(sentLinks.at(-1).url.split('token=')[1])
    await person.post('/auth/password/set', { token: inviteToken, password: 'reset-officer-pass' })
    ;({ secret } = (await person.post('/auth/2fa/setup')).body)
    await person.post('/auth/2fa/enable', { code: totpCode(secret) })

    await client(handler).post('/auth/password/forgot', { email: 'reset.officer@example.com' })
    const resetToken = decodeURIComponent(sentLinks.at(-1).url.split('token=')[1])
    const browser = client(handler)
    const reset = await browser.post('/auth/password/set', { token: resetToken, password: 'a-brand-new-pass' })
    expect(reset.body.twoFactorRequired).toBe(true)
    expect(reset.body.user).toBeUndefined()
    expect(browser.cookie).toBe('')
    expect((await browser.get('/auth/me')).body.user).toBeFalsy()
  })

  it('won’t take the same authenticator code twice', async () => {
    const code = totpCode(secret)
    const first = client(handler)
    const challenge = (await first.post('/auth/login', { email: 'reset.officer@example.com', password: 'a-brand-new-pass' })).body.challenge
    expect((await first.post('/auth/login/verify', { challenge, code })).status).toBe(200)

    const second = client(handler)
    const again = (await second.post('/auth/login', { email: 'reset.officer@example.com', password: 'a-brand-new-pass' })).body.challenge
    expect((await second.post('/auth/login/verify', { challenge: again, code })).status).toBe(400)
  })

  it('hands back an unused invite link, never a reset link, when the email fails', async () => {
    const { sendPasswordLinkEmail } = await import('../api/_lib/email.js')
    sendPasswordLinkEmail.mockRejectedValueOnce(new Error('mail server down'))
    const sent = await admin.post(`/users/${officerId}/password-link`)
    expect(sent.body).toMatchObject({ emailed: false, purpose: 'reset' })
    expect(sent.body.inviteUrl).toBeUndefined()
  })
})

describe('delegated team and role management', () => {
  let delegate

  beforeAll(async () => {
    const role = await admin.post('/roles', { label: 'Team admin', scope: 'all', permissions: ['users.view', 'users.manage', 'roles.manage'] })
    expect(role.status, JSON.stringify(role.body)).toBe(200)
    await admin.post('/users', { name: 'Tamara Delegate', email: 'delegate@example.com', role: role.body.role.key })
    delegate = client(handler)
    await delegate.post('/auth/password/set', { token: decodeURIComponent(sentLinks.at(-1).url.split('token=')[1]), password: 'delegate-strong-pass' })
    expect((await delegate.get('/auth/me')).body.user.email).toBe('delegate@example.com')
  })

  it('can’t hand out more access than the delegate holds', async () => {
    expect((await delegate.post('/users', { name: 'New Admin', email: 'new.admin@example.com', role: 'admin' })).body.code).toBe('beyond_own_access')
    expect((await delegate.post('/roles', { label: 'Everything', scope: 'all', permissions: ['settings.manage'] })).body.code).toBe('beyond_own_access')
    expect((await delegate.patch('/roles/team_admin', { permissions: ['users.view', 'users.manage', 'roles.manage', 'cases.decide'] })).body.code).toBe('beyond_own_access')

    const officers = (await admin.get('/users')).body.users.filter((user) => user.role === 'loan_officer')
    expect((await delegate.patch(`/users/${officers[0].id}`, { role: 'admin' })).body.code).toBe('beyond_own_access')
    const admins = (await admin.get('/users')).body.users.filter((user) => user.role === 'admin')
    expect((await delegate.patch(`/users/${admins[0].id}`, { resetTwoFactor: true })).body.code).toBe('beyond_own_access')
  })

  it('can share what the delegate holds, but not set their own approval limits', async () => {
    expect((await delegate.post('/roles', { label: 'Directory', scope: 'own', permissions: ['users.view'] })).status).toBe(200)
    const me = (await delegate.get('/auth/me')).body.user
    expect((await delegate.patch(`/users/${me.id}`, { approvalMax: 1000000 })).body.code).toBe('self_change')
  })
})
