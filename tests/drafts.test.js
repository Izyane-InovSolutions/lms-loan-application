import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createMemoryKv, client, draftPreparer } from './helpers.js'

const kv = createMemoryKv()
vi.mock('../api/_lib/kv.js', () => ({ default: kv }))

// Reminders go out by email; the test mail server does not exist.
const sentReminders = []
vi.mock('../api/_lib/email.js', async (importOriginal) => ({
  ...(await importOriginal()),
  sendDraftReminderEmail: vi.fn(async (email, details) => {
    sentReminders.push({ email, ...details })
  }),
}))

const { default: handler } = await import('../api/v1/[...path].js')
const { default: draftHandler } = await import('../api/draft/index.js')
const { putBlob } = await import('../api/_lib/blob.js')

const prepareDraft = draftPreparer(kv, putBlob)

const admin = client(handler)
const salesManager = client(handler)
const officer = client(handler)
const dsa = client(handler)
const rm = client(handler)
const applicant = client(handler)
const drafts = client(draftHandler)

const personal = (email, { firstName = 'Mutale', amount = 8000 } = {}) => ({
  email,
  loanType: 'personal',
  currentStep: 1,
  personalData: { personalInfo: { firstName, middleName: '', surname: 'Phiri', phone: '977000111', email } },
  businessData: {},
  loanData: { amount, tenure: 6 },
})

// Each address's draft token, as the wizard keeps it: the first save starts the draft,
// later ones continue it with the token (a draft can't be reopened by address alone).
const tokens = new Map()

/** Saves a draft as the wizard does; `as` is a staff client for an assisted save. */
const saveDraft = async (body, { as } = {}) => {
  const payload = as ? { ...body, assisted: true } : body
  const token = tokens.get(body.email)
  const headers = { ...(as ? { cookie: as.cookie } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) }
  const response = token ? await drafts.put('/draft', payload, headers) : await drafts.post('/draft', payload, headers)
  expect(response.status, JSON.stringify(response.body)).toBe(200)
  if (response.body.draftToken) tokens.set(body.email, response.body.draftToken)
  return response.body
}

const listed = async (who) => (await who.get('/drafts')).body.drafts?.map((draft) => draft.email) || []

beforeAll(async () => {
  await admin.post('/auth/demo', { role: 'admin' })
  await salesManager.post('/auth/demo', { role: 'sales_manager' })
  await officer.post('/auth/demo', { role: 'loan_officer' })
  await dsa.post('/auth/demo', { role: 'dsa' })
  await rm.post('/auth/demo', { role: 'rm' })
})

describe('drafts in the pipeline', () => {
  it('keeps a customer’s own draft private until they agree to be contacted', async () => {
    await saveDraft(personal('private@example.com'))
    expect(await listed(admin)).not.toContain('private@example.com')
    expect(await listed(salesManager)).not.toContain('private@example.com')

    await saveDraft({ ...personal('private@example.com'), contactConsent: true })
    expect(await listed(salesManager)).toContain('private@example.com')
    const [row] = (await salesManager.get('/drafts')).body.drafts.filter((draft) => draft.email === 'private@example.com')
    expect(row).toMatchObject({ applicantName: 'Mutale Phiri', amount: 8000, currentStep: 1, stepCount: 5, nextStep: 'Residence & Employment', startedByStaff: false })
    expect(row.contactConsentAt).toBeTruthy()
  })

  it('does not take consent back on a later save without it', async () => {
    await saveDraft(personal('private@example.com'))
    expect(await listed(salesManager)).toContain('private@example.com')
  })

  it('lists an agent’s drafts for them, their RM and the whole-book roles only', async () => {
    await saveDraft(personal('assisted@example.com'), { as: dsa })
    expect(await listed(dsa)).toContain('assisted@example.com')
    expect(await listed(rm)).toContain('assisted@example.com')
    expect(await listed(admin)).toContain('assisted@example.com')
    // The DSA does not see other people's drafts, even consented ones.
    expect(await listed(dsa)).not.toContain('private@example.com')
  })

  it('credits a referred draft to the referrer', async () => {
    await saveDraft({ ...personal('referred-draft@example.com'), contactConsent: true, referralCode: 'demodsa' })
    expect(await listed(dsa)).toContain('referred-draft@example.com')
  })

  it('needs the drafts permission', async () => {
    expect((await officer.get('/drafts')).status).toBe(403)
  })

  it('shows what was entered, and lets an agent continue it', async () => {
    const [row] = (await dsa.get('/drafts')).body.drafts.filter((draft) => draft.email === 'assisted@example.com')
    const detail = await dsa.get(`/drafts/${row.id}`)
    expect(detail.body.data.personalInfo.firstName).toBe('Mutale')
    expect(detail.body.loanData.amount).toBe(8000)

    const resumed = await dsa.post(`/drafts/${row.id}/resume`)
    expect(resumed.status).toBe(200)
    expect(resumed.body.draft.id).toBe(row.id)
    // The token works for the wizard's own saves.
    const save = await drafts.put('/draft', { ...personal('assisted@example.com', { amount: 9000 }), currentStep: 3 }, { authorization: `Bearer ${resumed.body.draftToken}` })
    expect(save.status).toBe(200)
    const [updated] = (await dsa.get('/drafts')).body.drafts.filter((draft) => draft.email === 'assisted@example.com')
    expect(updated).toMatchObject({ amount: 9000, currentStep: 3, nextStep: 'Loan Terms' })

    // Viewing the whole book is not the same as filling in for customers.
    const noAssist = await admin.patch('/roles/sales_manager', { permissions: ['drafts.view', 'pipeline.view'] })
    expect(noAssist.status).toBe(200)
    expect((await salesManager.post(`/drafts/${row.id}/resume`)).status).toBe(403)
    await admin.post('/roles/sales_manager/reset', {})
  })

  it('hides drafts outside the viewer’s scope, even by id', async () => {
    const [row] = (await admin.get('/drafts')).body.drafts.filter((draft) => draft.email === 'private@example.com')
    expect((await dsa.get(`/drafts/${row.id}`)).status).toBe(404)
  })

  it('sends a reminder at most once a day', async () => {
    const [row] = (await salesManager.get('/drafts')).body.drafts.filter((draft) => draft.email === 'private@example.com')
    const first = await salesManager.post(`/drafts/${row.id}/remind`)
    expect(first.status).toBe(200)
    expect(sentReminders.at(-1)).toMatchObject({ email: 'private@example.com', name: 'Mutale', product: 'personal loan' })
    expect(sentReminders.at(-1).url).toMatch(/\/\?resume=1$/)
    expect((await salesManager.post(`/drafts/${row.id}/remind`)).body.code).toBe('recently_reminded')
  })

  it('leaves the pipeline once discarded', async () => {
    const { draftToken } = await saveDraft({ ...personal('discarded@example.com'), contactConsent: true })
    expect(await listed(admin)).toContain('discarded@example.com')
    await drafts.del('/draft', { authorization: `Bearer ${draftToken}` })
    expect(await listed(admin)).not.toContain('discarded@example.com')
  })
})

describe('submitting a draft', () => {
  it('moves it out of drafts, keeps the agent’s credit and records the up-front consent', async () => {
    const email = 'finished@example.com'
    // The agent starts it with the customer…
    const saved = await saveDraft({ ...personal(email), contactConsent: true }, { as: dsa })
    expect(await listed(dsa)).toContain(email)

    // …and the customer finishes it alone: the documents go in, then they submit.
    const { token, body } = await prepareDraft(email)
    const stored = await kv.get(`draft:${email}`)
    await kv.set(`draft:${email}`, { ...saved.draft, ...stored, id: saved.draft.id, attribution: saved.draft.attribution, contactConsent: saved.draft.contactConsent })
    body.data.personalInfo.email = email
    const submitted = await applicant.post('/applications', body, { authorization: `Bearer ${token}` })
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200)

    expect(await listed(dsa)).not.toContain(email)
    const { body: detail } = await admin.get(`/applications/${submitted.body.id}`)
    expect(detail.application.channel).toBe('dsa')
    expect(detail.consents.map((consent) => consent.type)).toContain('draft_contact')
  })

  it('counts drafts on the dashboard', async () => {
    const { body } = await salesManager.get('/dashboard')
    expect(body.drafts.count).toBeGreaterThanOrEqual(2)
    expect((await officer.get('/dashboard')).body.drafts).toBeUndefined()
  })
})
