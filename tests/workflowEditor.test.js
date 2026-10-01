import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createMemoryKv, client, draftPreparer } from './helpers.js'

const kv = createMemoryKv()
vi.mock('../api/_lib/kv.js', () => ({ default: kv }))

const { default: handler } = await import('../api/v1/[...path].js')
const { putBlob } = await import('../api/_lib/blob.js')

const prepareDraft = draftPreparer(kv, putBlob)
const admin = client(handler)
const officer = client(handler)
const applicant = client(handler)

const submit = async (email) => {
  const { token, body } = await prepareDraft(email)
  body.data.personalInfo.email = email
  const response = await applicant.post('/applications', body, { authorization: `Bearer ${token}` })
  expect(response.status, JSON.stringify(response.body)).toBe(200)
  return response.body.id
}
const act = async (who, id, action, extra = {}) => {
  const { version } = (await admin.get(`/applications/${id}`)).body.application
  return who.post(`/applications/${id}/actions`, { action, version, ...extra })
}

beforeAll(async () => {
  await admin.post('/auth/demo', { role: 'admin' })
  await officer.post('/auth/demo', { role: 'loan_officer' })
})

describe('the Workflow editor', () => {
  let published
  let inReview
  let inNew

  it('is for those who manage settings', async () => {
    expect((await officer.get('/admin/workflow')).status).toBe(403)
    expect((await officer.put('/admin/workflow/draft', { definition: {} })).status).toBe(403)
    const { body } = await admin.get('/admin/workflow')
    expect(body.published).toMatchObject({ version: 1, legacy: true })
    expect(body.draft).toBeNull()
    published = body.published.definition
  })

  it('keeps only what a workflow has, with safe ids', async () => {
    const { body } = await admin.put('/admin/workflow/draft', {
      definition: {
        ...published,
        injected: true,
        states: [...published.states, { id: '../../etc', label: 'Odd one', type: 'final', extra: 'x', actions: [{ label: 'Go', kind: 'teleport', to: 'in_review' }] }],
      },
    })
    expect(body.draft.definition.injected).toBeUndefined()
    const odd = body.draft.definition.states.at(-1)
    expect(odd).toMatchObject({ id: 'etc', type: 'work' })
    expect(odd.extra).toBeUndefined()
    expect(odd.actions[0].kind).toBe('move')
    // It isn't reachable from the start, so the draft can't be published as it is.
    expect(body.validation.errors.map((error) => error.message).join(' ')).toMatch(/can’t be reached/)
  })

  it('refuses to publish a workflow with problems, saying what they are', async () => {
    const response = await admin.post('/admin/workflow/publish', {})
    expect(response.status).toBe(400)
    expect(response.body.code).toBe('invalid_workflow')
    expect(response.body.errors.length).toBeGreaterThan(0)
  })

  it('publishes a fixed draft for new applications', async () => {
    inReview = await submit('editor-review@example.com')
    await act(officer, inReview, 'start_review')
    inNew = await submit('editor-new@example.com')

    // Without the default "New" state: applications now start straight in review.
    const states = published.states.filter((state) => state.id !== 'submitted').map((state) => ({ ...state, legacyStatus: undefined }))
    const draft = await admin.put('/admin/workflow/draft', { definition: { ...published, start: 'in_review', states } })
    expect(draft.body.validation.errors).toEqual([])
    const response = await admin.post('/admin/workflow/publish', { note: 'Skip intake' })
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    expect(response.body.published).toMatchObject({ version: 2, legacy: false })

    const fresh = await submit('editor-after@example.com')
    expect((await admin.get(`/applications/${fresh}`)).body.workflow.state.id).toBe('in_review')
    expect((await officer.get('/workflow')).body.current.version).toBe(2)
  })

  it('moves open cases to the new version where their state still exists', async () => {
    const before = (await admin.get('/admin/workflow')).body.history
    expect(before.find((entry) => entry.version === 1).openCases).toBe(2)
    const moved = await admin.post('/admin/workflow/move-cases', {})
    expect(moved.body).toEqual({ moved: 1, kept: 1 })
    expect((await admin.get(`/applications/${inReview}`)).body.workflow.version).toBe(2)
    // "New" is gone from version 2, so that case finishes on version 1.
    const stayed = (await admin.get(`/applications/${inNew}`)).body.workflow
    expect(stayed).toMatchObject({ version: 1, state: { id: 'submitted' } })
  })
})
