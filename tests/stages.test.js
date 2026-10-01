import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createMemoryKv, client, draftPreparer, signedAcceptance } from './helpers.js'

const kv = createMemoryKv()
vi.mock('../api/_lib/kv.js', () => ({ default: kv }))

const { default: handler } = await import('../api/v1/[...path].js')
const { putBlob } = await import('../api/_lib/blob.js')

const prepareDraft = draftPreparer(kv, putBlob)

const admin = client(handler)
const officer = client(handler)
const salesManager = client(handler)
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

const tick = async (who, id, checks) => {
  for (const check of checks) expect((await act(who, id, 'check', { check, done: true, note: 'Seen' })).status).toBe(200)
}

const FLOW = {
  labels: { in_review: 'Assessment' },
  checklist: [
    { key: 'identity', label: 'Identity verified', requiredToApprove: true },
    { key: 'documents', label: 'Documents reviewed', requiredToApprove: true },
    { key: 'income', label: 'Income or cash flow verified', requiredToApprove: true },
    { key: 'site_visit', label: 'Site visit', requiredToApprove: false },
    { label: 'Employer called' },
  ],
  review: [
    { label: 'Document check', checks: ['documents'] },
    { label: 'Field verification', checks: ['site_visit'], roles: ['loan_officer'] },
  ],
  approval: [{ label: 'Credit committee' }],
  closing: [{ label: 'Security documents signed', products: ['personal'] }],
}

beforeAll(async () => {
  await admin.post('/auth/demo', { role: 'admin' })
  await officer.post('/auth/demo', { role: 'loan_officer' })
  await salesManager.post('/auth/demo', { role: 'sales_manager' })
})

describe('configuring the flow', () => {
  it('saves stages with stable keys, and only admins may', async () => {
    expect((await officer.put('/settings/stages', FLOW)).status).toBe(403)
    const saved = await admin.put('/settings/stages', FLOW)
    expect(saved.status, JSON.stringify(saved.body)).toBe(200)
    const { stages } = saved.body
    expect(stages.review.map((stage) => stage.id)).toEqual(['document_check', 'field_verification'])
    expect(stages.checklist.at(-1).key).toBe('employer_called')
    expect(stages.approval[0]).toMatchObject({ id: 'credit_committee', differentPerson: true })
    expect(stages.labels.in_review).toBe('Assessment')
    // Every staff member can read it, for the pipeline and status names.
    expect((await officer.get('/stages')).body.stages.review).toHaveLength(2)
  })

  it('refuses a stage with no name', async () => {
    const response = await admin.put('/settings/stages', { ...FLOW, review: [{ label: '' }] })
    expect(response.status).toBe(400)
  })
})

describe('a case going through the stages', () => {
  let id

  it('needs review stages done, in order and with their checks, before a recommendation', async () => {
    id = await submit('staged@example.com')
    await act(officer, id, 'start_review')
    await tick(officer, id, ['identity', 'income'])

    const early = await act(officer, id, 'recommend', { verdict: 'approve', rationale: 'Fine' })
    expect(early.body.code).toBe('stages_incomplete')
    expect((await act(officer, id, 'complete_stage', { stage: 'field_verification' })).body.code).toBe('stage_order')
    expect((await act(officer, id, 'complete_stage', { stage: 'document_check' })).body.code).toBe('checks_incomplete')

    await tick(officer, id, ['documents'])
    expect((await act(officer, id, 'complete_stage', { stage: 'document_check', note: 'All present' })).status).toBe(200)

    // Field verification is for loan officers only (admins can always act).
    await tick(officer, id, ['site_visit'])
    expect((await act(salesManager, id, 'complete_stage', { stage: 'field_verification' })).status).toBe(403)
    const done = await act(officer, id, 'complete_stage', { stage: 'field_verification' })
    expect(done.body.application.stageProgress.field_verification).toMatchObject({ done: true, byName: 'Mwila Sakala' })

    expect((await act(officer, id, 'recommend', { verdict: 'approve', rationale: 'Affordable' })).body.application.status).toBe('pending_approval')
  })

  it('holds the decision until the committee, someone other than the recommender, signs off', async () => {
    expect((await act(salesManager, id, 'decide', { verdict: 'approve', rationale: 'Agreed' })).body.code).toBe('stages_incomplete')
    expect((await act(officer, id, 'complete_stage', { stage: 'credit_committee' })).body.code).toBe('four_eyes')
    expect((await act(salesManager, id, 'complete_stage', { stage: 'credit_committee', note: 'Minutes 12/9' })).status).toBe(200)
  })

  it('makes the committee sit again when a case is sent back', async () => {
    await act(salesManager, id, 'decide', { verdict: 'return', rationale: 'Check the employer' })
    const { body } = await admin.get(`/applications/${id}`)
    expect(body.application.stageProgress.credit_committee).toBeUndefined()
    expect(body.application.stageProgress.field_verification.done).toBe(true)
    await act(officer, id, 'recommend', { verdict: 'approve', rationale: 'Employer confirmed' })
    await act(salesManager, id, 'complete_stage', { stage: 'credit_committee' })
    expect((await act(salesManager, id, 'decide', { verdict: 'approve', rationale: 'Agreed' })).body.application.status).toBe('approved')
  })

  it('keeps payout, and the LMS hand-off, waiting for the closing stages', async () => {
    // The customer accepts in person, reading back the code emailed to them.
    const accepted = await act(officer, id, 'record_acceptance', await signedAcceptance(kv, 'staged@example.com'))
    expect(accepted.body.application.status, JSON.stringify(accepted.body)).toBe('accepted')
    expect((await act(officer, id, 'mark_disbursed')).body.code).toBe('stages_incomplete')
    expect((await act(officer, id, 'complete_stage', { stage: 'security_documents_signed' })).status).toBe(200)
    expect((await act(officer, id, 'mark_disbursed')).body.application.status).toBe('disbursed')
  })

  it('reopens a stage and those after it while its part of the flow is open', async () => {
    const other = await submit('reopen@example.com')
    await act(officer, other, 'start_review')
    await tick(officer, other, ['documents', 'site_visit'])
    await act(officer, other, 'complete_stage', { stage: 'document_check' })
    await act(officer, other, 'complete_stage', { stage: 'field_verification' })
    const reopened = await act(officer, other, 'reopen_stage', { stage: 'document_check', reason: 'Payslip was for the wrong month' })
    expect(reopened.status).toBe(200)
    expect(reopened.body.application.stageProgress).toEqual({})
  })
})
