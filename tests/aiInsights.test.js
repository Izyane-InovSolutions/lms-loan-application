import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createMemoryKv, client, draftPreparer } from './helpers.js'

const kv = createMemoryKv()
vi.mock('../api/_lib/kv.js', () => ({ default: kv }))

// A model is "set up", and its review is canned: what's tested is whether it is asked.
const review = { recommendation: 'refer', riskLevel: 'medium', score: 55, summary: 'Canned review.', flags: [], missingInformation: [], applicantGuidance: [] }
const prescreenApplication = vi.fn(async () => review)
vi.mock('../api/_lib/ai/prescreen.js', () => ({ prescreenApplication }))
vi.mock('../api/_lib/ai/index.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getAiProvider: vi.fn(async () => ({ name: 'test', label: 'Test model' })),
}))

const { default: handler } = await import('../api/v1/[...path].js')
const { default: applicantPrescreen } = await import('../api/ai/prescreen.js')
const { putBlob } = await import('../api/_lib/blob.js')
const { settleBackgroundTasks } = await import('../api/_lib/after.js')

const prepareDraft = draftPreparer(kv, putBlob)
const admin = client(handler)
const officer = client(handler)
const applicant = client(handler)
const wizard = client(applicantPrescreen)

const submit = async (email) => {
  const { token, body } = await prepareDraft(email)
  body.data.personalInfo.email = email
  const response = await applicant.post('/applications', body, { authorization: `Bearer ${token}` })
  expect(response.status, JSON.stringify(response.body)).toBe(200)
  await settleBackgroundTasks()
  return { id: response.body.id, token }
}
const setInsights = async (insights) => {
  const { ai } = (await admin.get('/settings')).body.settings
  const saved = await admin.put('/settings/ai', { ...ai, insights })
  expect(saved.status, JSON.stringify(saved.body)).toBe(200)
  return saved.body.ai
}

beforeAll(async () => {
  await admin.post('/auth/demo', { role: 'admin' })
  await officer.post('/auth/demo', { role: 'loan_officer' })
})

describe('AI insights', () => {
  it('are on by default: the review runs and staff are told to show it', async () => {
    expect((await admin.get('/settings')).body.settings.ai.insights).toBe(true)
    const { id } = await submit('insights-on@example.com')
    const { body } = await officer.get(`/applications/${id}`)
    expect(body.aiInsights).toBe(true)
    expect(body.prescreen.aiReview).toMatchObject({ score: 55 })
  })

  it('switched off: no review is asked for, staff are told to hide any, and the wizard gets none', async () => {
    expect((await setInsights(false)).insights).toBe(false)
    prescreenApplication.mockClear()
    const { id } = await submit('insights-off@example.com')
    expect(prescreenApplication).not.toHaveBeenCalled()
    const { body } = await officer.get(`/applications/${id}`)
    expect(body.aiInsights).toBe(false)
    expect(body.prescreen.aiReview).toBeNull()
    // The policy rules still run.
    expect(body.prescreen.ruleResults.length).toBeGreaterThan(0)

    // An applicant still filling in the form gets no AI guidance.
    const { token } = await prepareDraft('insights-off-wizard@example.com')
    const guidance = await wizard.post('/', { loanType: 'personal', loan: { amount: 5000, tenure: 6 }, applicant: {}, documents: [] }, { authorization: `Bearer ${token}` })
    expect(guidance.status).toBe(503)
    expect(guidance.body.code).toBe('ai_insights_off')
    expect(prescreenApplication).not.toHaveBeenCalled()
    await setInsights(true)
  })
})
