import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createMemoryKv, client, draftPreparer, signedAcceptance } from './helpers.js'

const kv = createMemoryKv()
vi.mock('../api/_lib/kv.js', () => ({ default: kv }))

const { default: handler } = await import('../api/v1/[...path].js')
const { putBlob } = await import('../api/_lib/blob.js')
const { getDb, schema } = await import('../api/_lib/db/client.js')
const { eq } = await import('drizzle-orm')
const { getWorkflowVersion, saveDraftWorkflow, publishDraftWorkflow, isLegacyManaged } = await import('../api/_lib/workflowVersions.js')

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

const row = async (id) => {
  const db = await getDb()
  const [application] = await db.select().from(schema.applications).where(eq(schema.applications.id, id))
  return application
}

/** The case's status is always its state's category (or info_requested while it waits on the applicant). */
const consistent = async (id) => {
  const application = await row(id)
  const flow = await getWorkflowVersion(application.workflowVersion)
  if (application.status !== 'info_requested') expect(application.status).toBe(flow.analysis.categories[application.state])
  return application
}

const act = async (who, id, action, extra = {}) => {
  const { version } = await row(id)
  return who.post(`/applications/${id}/actions`, { action, version, ...extra })
}
const move = (who, id, actionId, extra = {}) => act(who, id, 'transition', { actionId, ...extra })

beforeAll(async () => {
  await admin.post('/auth/demo', { role: 'admin' })
  await officer.post('/auth/demo', { role: 'loan_officer' })
  await salesManager.post('/auth/demo', { role: 'sales_manager' })
})

describe('the workflow made from today’s settings', () => {
  let id

  it('puts new applications in its start state, with the status to match', async () => {
    id = await submit('legacy@example.com')
    const application = await consistent(id)
    expect(application).toMatchObject({ state: 'submitted', status: 'submitted', workflowVersion: 1 })
    expect(await isLegacyManaged()).toBe(true)
  })

  it('keeps status and state together through the usual journey', async () => {
    await act(officer, id, 'start_review')
    expect(await consistent(id)).toMatchObject({ state: 'in_review', status: 'in_review' })
    for (const check of ['identity', 'documents', 'income']) await act(officer, id, 'check', { check, done: true, note: 'Seen' })
    await act(officer, id, 'request_info', { message: 'Send a clearer NRC please' })
    expect(await consistent(id)).toMatchObject({ state: 'in_review', status: 'info_requested' })
    expect((await act(officer, id, 'recommend', { verdict: 'approve', rationale: 'Fine' })).body.code).toBe('invalid_state')
    await act(officer, id, 'cancel_request', { reason: 'Found it in the file' })
    expect(await consistent(id)).toMatchObject({ status: 'in_review' })
  })

  it('follows the settings while nobody has published from the editor', async () => {
    // Four-eyes off: the officer's recommendation becomes the decision, for open cases too.
    expect((await admin.put('/settings/workflow', { requireSecondApproval: false, slaDays: 3 })).status).toBe(200)
    const moved = await consistent(id)
    expect(moved.workflowVersion).toBe(2)
    expect(moved.state).toBe('in_review')
    const approved = await act(officer, id, 'recommend', { verdict: 'approve', rationale: 'Affordable' })
    expect(approved.body.application.status, JSON.stringify(approved.body)).toBe('approved')
    expect(await consistent(id)).toMatchObject({ state: 'approved' })
    await admin.put('/settings/workflow', { requireSecondApproval: true, slaDays: 3 })
  })

  it('maps cases with no state yet onto it', async () => {
    const other = await submit('unmapped@example.com')
    await act(officer, other, 'start_review')
    const db = await getDb()
    await db.update(schema.applications).set({ state: null, workflowVersion: null }).where(eq(schema.applications.id, other))
    await admin.put('/settings/stages', { labels: { in_review: 'Assessment' }, review: [], approval: [], closing: [] })
    expect(await consistent(other)).toMatchObject({ state: 'in_review' })
  })
})

// A flow like the screenshot's, published from the editor's store.
const CUSTOM = {
  start: 'intake',
  checklist: [{ key: 'identity', label: 'Identity verified', requiredToApprove: true }],
  states: [
    { id: 'intake', label: 'Intake', type: 'work', actions: [{ id: 'prescreen', label: 'Send to prescreening', kind: 'move', to: 'prescreening', options: { claim: true } }] },
    {
      id: 'prescreening',
      label: 'Prescreening',
      type: 'work',
      roles: ['loan_officer'],
      askApplicant: true,
      actions: [
        { id: 'underwrite', label: 'Send to underwriting', kind: 'recommend', to: 'underwriting', options: { checks: ['identity'] } },
        { id: 'back', label: 'Return', kind: 'return', to: 'intake' },
        { id: 'reject', label: 'Reject', kind: 'reject', to: 'declined' },
      ],
    },
    {
      id: 'underwriting',
      label: 'Underwriting',
      type: 'work',
      roles: ['sales_manager'],
      actions: [
        { id: 'approve', label: 'Approve', kind: 'approve', to: 'offer', options: { fourEyes: true } },
        { id: 'back', label: 'Return', kind: 'return', to: 'prescreening' },
        { id: 'reject', label: 'Reject', kind: 'reject', to: 'declined' },
      ],
    },
    { id: 'offer', label: 'Offer', type: 'offer', offer: { onAccept: 'disbursement' }, actions: [] },
    { id: 'disbursement', label: 'Disbursement', type: 'work', handToLms: true, actions: [{ id: 'pay', label: 'Mark as paid out', kind: 'pay_out', to: 'paid_out' }] },
    { id: 'paid_out', label: 'Approved', type: 'final', actions: [] },
    { id: 'declined', label: 'Rejected', type: 'final', actions: [] },
    { id: 'withdrawn', label: 'Withdrawn', type: 'final', actions: [] },
    { id: 'expired', label: 'Offer expired', type: 'final', actions: [] },
  ],
}

describe('a workflow published from the editor', () => {
  let before
  let id

  beforeAll(async () => {
    before = await submit('before-publish@example.com')
    await act(officer, before, 'start_review')
    await saveDraftWorkflow(CUSTOM, 'Screenshot flow', { id: null })
    await publishDraftWorkflow({ id: null }, 'Screenshot flow')
  })

  it('ends legacy management, and new applications follow it', async () => {
    expect(await isLegacyManaged()).toBe(false)
    id = await submit('custom@example.com')
    expect(await consistent(id)).toMatchObject({ state: 'intake', status: 'submitted' })
  })

  it('leaves open cases on the version they started with', async () => {
    const application = await consistent(before)
    expect(application.state).toBe('in_review')
    expect((await getWorkflowVersion(application.workflowVersion)).legacy).toBe(true)
    // Settings changes no longer rewrite the workflow.
    await admin.put('/settings/workflow', { requireSecondApproval: false, slaDays: 3 })
    expect((await row(before)).workflowVersion).toBe(application.workflowVersion)
    await admin.put('/settings/workflow', { requireSecondApproval: true, slaDays: 3 })
  })

  it('moves a case through its states, by the roles each names', async () => {
    expect((await move(officer, id, 'prescreen')).status).toBe(200)
    expect(await consistent(id)).toMatchObject({ state: 'prescreening', status: 'in_review' })

    // Prescreening is the loan officers’.
    expect((await move(salesManager, id, 'underwrite', { verdict: 'approve', rationale: 'Fine' })).status).toBe(403)
    expect((await move(officer, id, 'underwrite', { verdict: 'approve', rationale: 'Fine' })).body.code).toBe('checks_incomplete')
    await act(officer, id, 'check', { check: 'identity', done: true, note: 'NRC seen' })
    const recommended = await move(officer, id, 'underwrite', { verdict: 'approve', rationale: 'Affordable' })
    expect(recommended.status, JSON.stringify(recommended.body)).toBe(200)
    expect(await consistent(id)).toMatchObject({ state: 'underwriting', status: 'pending_approval' })

    // Underwriting is the sales managers’; a return goes back a step.
    expect((await move(officer, id, 'approve', { rationale: 'Mine' })).status).toBe(403)
    expect((await move(salesManager, id, 'back', { rationale: 'Check the employer' })).status).toBe(200)
    expect(await consistent(id)).toMatchObject({ state: 'prescreening' })
    await move(officer, id, 'underwrite', { verdict: 'approve', rationale: 'Employer confirmed' })

    const approved = await move(salesManager, id, 'approve', { rationale: 'Agreed' })
    expect(approved.status, JSON.stringify(approved.body)).toBe(200)
    const offered = await consistent(id)
    expect(offered).toMatchObject({ state: 'offer', status: 'approved' })
    expect(offered.offerExpiresAt).toBeTruthy()
  })

  it('takes the offer, then pays out', async () => {
    const accepted = await act(officer, id, 'record_acceptance', await signedAcceptance(kv, 'custom@example.com'))
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200)
    expect(await consistent(id)).toMatchObject({ state: 'disbursement', status: 'accepted' })
    expect((await move(officer, id, 'pay', { note: 'EFT 1234' })).status).toBe(200)
    expect(await consistent(id)).toMatchObject({ state: 'paid_out', status: 'disbursed' })
    expect((await move(officer, id, 'pay')).body.code).toBe('invalid_state')
  })

  it('still finishes the old case on its old workflow', async () => {
    for (const check of ['identity', 'documents', 'income']) await act(officer, before, 'check', { check, done: true, note: 'Seen' })
    expect((await act(officer, before, 'recommend', { verdict: 'approve', rationale: 'Fine' })).body.application.status).toBe('pending_approval')
    expect(await consistent(before)).toMatchObject({ state: 'pending_approval' })
  })
})

describe('what the workspace shows of a case’s workflow', () => {
  let id

  it('lists the state’s actions, and says why someone can’t take one', async () => {
    id = await submit('queue@example.com')
    await move(officer, id, 'prescreen')
    const forOfficer = (await officer.get(`/applications/${id}`)).body.workflow
    expect(forOfficer.state).toMatchObject({ id: 'prescreening', askApplicant: true })
    expect(forOfficer.actions.map((action) => [action.id, action.kind, action.blocked])).toEqual([
      ['underwrite', 'recommend', null],
      ['back', 'return', null],
      ['reject', 'reject', null],
    ])
    const forManager = (await salesManager.get(`/applications/${id}`)).body.workflow
    expect(forManager.actions[0].blocked).toMatch(/Waiting for loan officer/)
  })

  it('queues cases for the roles a state names, until someone takes them', async () => {
    await act(officer, id, 'check', { check: 'identity', done: true, note: 'NRC seen' })
    await move(officer, id, 'underwrite', { verdict: 'approve', rationale: 'Affordable' })
    const queued = async (who) => (await who.get('/applications?assigned=queue&pageSize=200')).body.applications.map((row) => row.id)
    expect(await queued(salesManager)).toContain(id)
    expect(await queued(officer)).not.toContain(id)
    expect((await salesManager.get('/dashboard')).body.queue.inMyQueue).toBeGreaterThan(0)

    // Taking it here doesn't change who owns the case.
    const owner = (await row(id)).assignedOfficer
    expect((await act(salesManager, id, 'take')).status).toBe(200)
    expect(await row(id)).toMatchObject({ assignedOfficer: owner })
    expect((await row(id)).stateAssignee).toBeTruthy()
    expect((await act(officer, id, 'take')).status).toBe(403)
  })
})

describe('a state turned off', () => {
  // Intake → Field check → Prescreening, with Field check off.
  const withFieldCheck = (disabled) => ({
    ...CUSTOM,
    states: [
      { ...CUSTOM.states[0], actions: [{ id: 'field', label: 'Send to field check', kind: 'move', to: 'field_check', options: { claim: true } }] },
      { id: 'field_check', label: 'Field check', type: 'work', disabled, actions: [{ id: 'prescreen', label: 'Send to prescreening', kind: 'move', to: 'prescreening' }] },
      ...CUSTOM.states.slice(1),
    ],
  })

  it('is passed straight through, and its setup kept', async () => {
    await saveDraftWorkflow(withFieldCheck(true), 'Field check off', { id: null })
    const published = await publishDraftWorkflow({ id: null }, 'Field check off')
    expect(published.definition.states.find((state) => state.id === 'field_check')).toMatchObject({ disabled: true, label: 'Field check' })
    const id = await submit('field-off@example.com')
    expect((await move(officer, id, 'field')).status).toBe(200)
    expect(await consistent(id)).toMatchObject({ state: 'prescreening', status: 'in_review' })
  })

  it('takes cases again once turned back on', async () => {
    await saveDraftWorkflow(withFieldCheck(false), 'Field check on', { id: null })
    await publishDraftWorkflow({ id: null }, 'Field check on')
    const id = await submit('field-on@example.com')
    expect((await move(officer, id, 'field')).status).toBe(200)
    expect(await consistent(id)).toMatchObject({ state: 'field_check', status: 'in_review' })
  })
})
