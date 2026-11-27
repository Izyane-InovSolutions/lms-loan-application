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
        states: [
          ...published.states.map((state) => (['declined', 'in_review'].includes(state.id) ? { ...state, disabled: true } : state)),
          { id: '../../etc', label: 'Odd one', type: 'final', extra: 'x', actions: [{ label: 'Go', kind: 'teleport', to: 'in_review' }] },
        ],
      },
    })
    expect(body.draft.definition.injected).toBeUndefined()
    const odd = body.draft.definition.states.at(-1)
    expect(odd).toMatchObject({ id: 'etc', type: 'work' })
    // A state can be turned off; the built-in ends stay on.
    expect(body.draft.definition.states.find((state) => state.id === 'in_review').disabled).toBe(true)
    expect(body.draft.definition.states.find((state) => state.id === 'declined').disabled).toBeUndefined()
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
    // On to Underwriting, which version 2 keeps.
    await act(officer, inReview, 'save_terms')
    await act(officer, inReview, 'transition', { actionId: 'appraised' })
    inNew = await submit('editor-new@example.com')

    // Without the default start and Appraisal states: applications now start straight in review.
    const states = published.states.filter((state) => !['submitted', 'appraisal'].includes(state.id)).map((state) => ({ ...state, legacyStatus: undefined }))
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

describe('restoring an earlier workflow version', () => {
  it('puts the version into the draft, leaving the published one in force', async () => {
    expect((await officer.post('/admin/workflow/restore', { version: 1 })).status).toBe(403)
    expect((await admin.post('/admin/workflow/restore', { version: 999 })).status).toBe(404)
    expect((await admin.post('/admin/workflow/restore', { version: 'x' })).status).toBe(400)

    const before = (await admin.get('/admin/workflow')).body
    expect(before.history.length).toBeGreaterThan(1)
    const old = (await admin.get('/admin/workflow')).body.history.at(-1).version
    const { status, body } = await admin.post('/admin/workflow/restore', { version: old })
    expect(status).toBe(200)
    expect(body.draft.note).toBe(`Restored from version ${old}`)

    const after = (await admin.get('/admin/workflow')).body
    expect(after.published.version).toBe(before.published.version)
    expect(after.draft.definition.states.map((state) => state.id)).toEqual(body.draft.definition.states.map((state) => state.id))
    // Publishing it makes a new version: history is never rewritten.
    expect(body.validation.errors).toEqual([])
    expect((await admin.post('/admin/workflow/publish', {})).status).toBe(200)
    expect((await admin.get('/admin/workflow')).body.published.version).toBe(before.published.version + 1)
  })
})

describe('the audit log of a workflow action', () => {
  it('names the stages it moved between, and is found by the case reference', async () => {
    const id = await submit('audit-detail@example.com')
    const browser = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36'
    const { reference } = (await admin.get(`/applications/${id}`, { 'user-agent': browser })).body.application
    expect((await act(officer, id, 'start_review')).status).toBe(200)
    const { entries } = (await admin.get(`/audit?q=${encodeURIComponent(reference)}`)).body
    const entry = entries.find((row) => row.action === 'application.start_review')
    expect(entry, JSON.stringify(entries.map((row) => row.action))).toBeTruthy()
    expect(entry.detail).toMatchObject({ reference, fromStage: expect.any(String), toStage: expect.any(String) })
    expect(entry.detail.fromStage).not.toBe(entry.detail.toStage)
    // Each entry keeps the browser it came from.
    const opened = entries.find((row) => row.action === 'application.viewed' && row.userAgent)
    expect(opened?.userAgent).toBe(browser)
  })
})

describe('what a stage does', () => {
  it('starts with Appraisal setting the terms and Underwriting doing the checks', async () => {
    // Version 1 was made from the settings.
    const { definition } = (await admin.post('/admin/workflow/restore', { version: 1 })).body.draft
    expect(definition.states.find((state) => state.id === 'appraisal').work).toBe('terms')
    expect(definition.states.find((state) => state.id === 'in_review').work).toBe('underwriting')
    await admin.del('/admin/workflow/draft')
  })

  it('refuses two stages that both set the terms for a loan, and keeps the setting on in-progress states only', async () => {
    const { published } = (await admin.get('/admin/workflow')).body
    const states = published.definition.states.map((state) => {
      if (state.id === 'in_review') return { ...state, work: 'terms' }
      if (state.id === 'paid_out') return { ...state, work: 'terms' }
      return state.id === 'appraisal' ? { ...state, work: 'terms' } : state
    })
    const saved = await admin.put('/admin/workflow/draft', { definition: { ...published.definition, states } })
    expect(saved.status).toBe(200)
    expect(saved.body.draft.definition.states.find((state) => state.id === 'paid_out').work).toBeUndefined()
    expect(saved.body.validation.errors.map((error) => error.message)).toContain('Only one stage can set the loan terms.')
    expect((await admin.post('/admin/workflow/publish', {})).status).toBe(400)
    await admin.del('/admin/workflow/draft')
  })
})
