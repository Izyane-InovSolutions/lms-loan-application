import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createMemoryKv, client, draftPreparer, signedAcceptance, documentVerifier, toDecision } from './helpers.js'

const kv = createMemoryKv()
vi.mock('../api/_lib/kv.js', () => ({ default: kv }))

const { default: handler } = await import('../api/v1/[...path].js')
const { putBlob } = await import('../api/_lib/blob.js')
const { getDb, schema } = await import('../api/_lib/db/client.js')
const { eq, sql } = await import('drizzle-orm')
const { getWorkflowVersion, getPublishedWorkflow, saveDraftWorkflow, publishDraftWorkflow, isLegacyManaged, clearWorkflowCache } = await import('../api/_lib/workflowVersions.js')
const { legacyStateOf, legacyToWorkflow, resolveState, validateWorkflow } = await import('../src/config/workflow.js')

const prepareDraft = draftPreparer(kv, putBlob)
const admin = client(handler)
const officer = client(handler)
const salesManager = client(handler)
let salesManagerId
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
  // Approval without legal sign-off: these tests are about what comes before and after it (tests/legalReview.test.js covers the gate).
  await admin.put('/settings/workflow', { requireSecondApproval: true, slaDays: 3, requireLegalReview: false })
  await officer.post('/auth/demo', { role: 'loan_officer' })
  salesManagerId = (await salesManager.post('/auth/demo', { role: 'sales_manager' })).body.user.id
})

describe('the default graph: appraisal sets the terms, underwriting checks, then the decision', () => {
  const byId = (definition, id) => definition.states.find((state) => state.id === id)

  it('sets the terms at Appraisal for every loan, and decides after Underwriting', () => {
    const definition = legacyToWorkflow({})
    const appraisal = byId(definition, 'appraisal')
    expect(appraisal.work).toBe('terms')
    expect(appraisal.appraisal).toBeUndefined()
    expect(appraisal.actions).toEqual([{ id: 'appraised', label: 'Approve', kind: 'move', to: 'in_review', permission: 'cases.work' }])
    const underwriting = byId(definition, 'in_review')
    expect(underwriting).toMatchObject({ label: 'Underwriting', work: 'underwriting', legacyStatus: 'in_review' })
    expect(underwriting.actions).toEqual([{ id: 'underwritten', label: 'Approve', kind: 'move', to: 'decision', permission: 'cases.work' }])
    const decision = byId(definition, 'decision')
    expect(decision).toMatchObject({ label: 'Credit decision', legacyStatus: 'in_review', askApplicant: true })
    expect(decision.actions.map((action) => [action.id, action.kind, action.to])).toEqual([['recommend', 'recommend', 'pending_approval']])
    expect(byId(definition, 'pending_approval').actions.find((action) => action.kind === 'return').to).toBe('in_review')
    const { errors, categories } = validateWorkflow(definition)
    expect(errors).toEqual([])
    expect(categories).toMatchObject({ appraisal: 'in_review', in_review: 'in_review', decision: 'in_review', pending_approval: 'pending_approval' })
    // An unsecured loan no longer passes Appraisal by.
    expect(resolveState(definition, 'appraisal', { form: 'personal', collateral: false }).id).toBe('appraisal')
  })

  it('lets the decision approve or decline alone with four-eyes off', () => {
    const definition = legacyToWorkflow({ workflow: { requireSecondApproval: false } })
    const decision = byId(definition, 'decision')
    expect(decision.actions.map((action) => [action.kind, action.options.singleStep])).toEqual([
      ['approve', true],
      ['reject', true],
    ])
    expect(byId(definition, 'in_review').actions.map((action) => action.id)).toEqual(['underwritten'])
    expect(validateWorkflow(definition).errors).toEqual([])
  })

  it('puts the review stages between Appraisal and Underwriting', () => {
    const definition = legacyToWorkflow({ stages: { review: [{ id: 'document_check', label: 'Document check', checks: [], roles: [], products: [] }] } })
    expect(byId(definition, 'appraisal').actions[0].to).toBe('document_check')
    expect(byId(definition, 'document_check').actions[0].to).toBe('in_review')
    expect(validateWorkflow(definition).errors).toEqual([])
  })

  it('maps a case in review to Underwriting, not the decision', () => {
    expect(legacyStateOf(legacyToWorkflow({}), { status: 'in_review', loanType: 'personal', stageProgress: {} })).toBe('in_review')
  })

  it('allows one stage per loan to set the terms, one to underwrite, and terms before the decision', () => {
    const definition = legacyToWorkflow({})
    const twice = (work) => ({ ...definition, states: definition.states.map((state) => (state.id === 'submitted' || state.id === 'appraisal' || state.id === 'in_review' ? { ...state, work } : state)) })
    const messages = (candidate) => validateWorkflow(candidate).errors.map((error) => error.message)
    expect(messages(twice('terms'))).toContain('Only one stage can set the loan terms.')
    expect(messages(twice('underwriting'))).toContain('Only one stage can do the underwriting checks.')
    // Each for a different loan type is fine.
    const split = {
      ...definition,
      states: definition.states.map((state) => {
        if (state.id === 'appraisal') return { ...state, products: ['personal'] }
        if (state.id === 'in_review') return { ...state, work: 'terms', products: ['business'] }
        return state
      }),
    }
    expect(messages(split).filter((message) => /loan terms/.test(message))).toEqual([])
    // Terms set after the recommendation come too late.
    const late = { ...definition, states: definition.states.map((state) => (state.id === 'appraisal' ? { ...state, work: undefined } : state.id === 'pending_approval' ? { ...state, work: 'terms' } : state)) }
    expect(messages(late)).toContain('The loan terms must be set before the credit decision.')
  })
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
    expect(await consistent(id)).toMatchObject({ state: 'appraisal', status: 'in_review' })
    await toDecision((action, extra) => act(officer, id, action, extra), { verify: documentVerifier(officer, id) })
    expect(await consistent(id)).toMatchObject({ state: 'decision', status: 'in_review' })
    for (const check of ['identity', 'documents', 'income']) await act(officer, id, 'check', { check, done: true })
    expect(await consistent(id)).toMatchObject({
      checks: {
        identity: { done: true, note: '' },
        documents: { done: true, note: '' },
        income: { done: true, note: '' },
      },
    })
    await act(officer, id, 'request_info', { message: 'Send a clearer NRC please' })
    expect(await consistent(id)).toMatchObject({ state: 'decision', status: 'info_requested' })
    expect((await act(officer, id, 'recommend', { verdict: 'approve', rationale: 'Fine' })).body.code).toBe('invalid_state')
    await act(officer, id, 'cancel_request', { reason: 'Found it in the file' })
    expect(await consistent(id)).toMatchObject({ status: 'in_review' })
  })

  it('lets underwriting ask the applicant for more before it decides', async () => {
    const other = await submit('underwriting-asks@example.com')
    await act(officer, other, 'start_review')
    await toDecision((action, extra) => act(officer, other, action, extra), { verify: documentVerifier(officer, other) })
    for (const check of ['identity', 'documents', 'income']) await act(officer, other, 'check', { check, done: true })
    await act(officer, other, 'recommend', { verdict: 'approve', rationale: 'Affordable' })
    expect(await consistent(other)).toMatchObject({ state: 'pending_approval', status: 'pending_approval' })
    const asked = await act(admin, other, 'request_info', { message: 'Send your latest bank statement' })
    expect(asked.status, JSON.stringify(asked.body)).toBe(200)
    expect(await consistent(other)).toMatchObject({ state: 'pending_approval', status: 'info_requested' })
    await act(admin, other, 'cancel_request', { reason: 'Received by email' })
    expect(await consistent(other)).toMatchObject({ state: 'pending_approval', status: 'pending_approval' })
  })

  it('follows the settings while nobody has published from the editor', async () => {
    // Four-eyes off: the officer's recommendation becomes the decision, for open cases too.
    expect((await admin.put('/settings/workflow', { requireSecondApproval: false, slaDays: 3, requireLegalReview: false })).status).toBe(200)
    const moved = await consistent(id)
    expect(moved.workflowVersion).toBe(2)
    // A case keeps its stage when the remade workflow still has it.
    expect(moved.state).toBe('decision')
    const approved = await act(officer, id, 'recommend', { verdict: 'approve', rationale: 'Affordable' })
    expect(approved.body.application.status, JSON.stringify(approved.body)).toBe('approved')
    expect(await consistent(id)).toMatchObject({ state: 'approved' })
    await admin.put('/settings/workflow', { requireSecondApproval: true, slaDays: 3, requireLegalReview: false })
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
    expect(application.state).toBe('appraisal')
    expect((await getWorkflowVersion(application.workflowVersion)).legacy).toBe(true)
    // Settings changes no longer rewrite the workflow.
    await admin.put('/settings/workflow', { requireSecondApproval: false, slaDays: 3, requireLegalReview: false })
    expect((await row(before)).workflowVersion).toBe(application.workflowVersion)
    await admin.put('/settings/workflow', { requireSecondApproval: true, slaDays: 3, requireLegalReview: false })
  })

  it('moves a case through its states, by the roles each names', async () => {
    expect((await move(officer, id, 'prescreen')).status).toBe(200)
    expect(await consistent(id)).toMatchObject({ state: 'prescreening', status: 'in_review' })

    // Prescreening is the loan officers’: a sales manager who hasn't worked the case doesn't see it there.
    expect((await move(salesManager, id, 'underwrite', { verdict: 'approve', rationale: 'Fine' })).status).toBe(404)
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
    // Closed: no stage there is anyone's to work, so it is read-only (stageVisibility.test.js).
    expect((await move(officer, id, 'pay')).body.code).toBe('read_only')
  })

  it('holds booking and payout until the offer’s conditions are met', async () => {
    const other = await submit('conditions@example.com')
    await move(officer, other, 'prescreen')
    await act(officer, other, 'check', { check: 'identity', done: true, note: 'NRC seen' })
    await move(officer, other, 'underwrite', { verdict: 'approve', rationale: 'Affordable' })
    const approved = await move(salesManager, other, 'approve', { rationale: 'Agreed', conditions: 'Payroll deduction confirmed by the employer\n- Life cover in place' })
    expect(approved.status, JSON.stringify(approved.body)).toBe(200)
    const conditions = (await row(other)).checks.conditions
    expect(conditions.map((condition) => [condition.id, condition.text, condition.met])).toEqual([
      ['c1', 'Payroll deduction confirmed by the employer', false],
      ['c2', 'Life cover in place', false],
    ])
    await act(officer, other, 'record_acceptance', await signedAcceptance(kv, 'conditions@example.com'))
    // In the disbursement state: payout waits, and the case page says why.
    expect((await move(officer, other, 'pay')).body.code).toBe('conditions_open')
    const detail = (await officer.get(`/applications/${other}`)).body
    expect(detail.workflow.actions.find((action) => action.kind === 'pay_out').blocked).toMatch(/^Payout waits for the offer’s conditions/)

    expect((await officer.post(`/applications/${other}/conditions/c1`, { met: true, note: 'HR letter received' })).status).toBe(200)
    expect((await move(officer, other, 'pay')).body.message).toMatch(/Life cover in place/)
    const done = await officer.post(`/applications/${other}/conditions/c2`, { met: true })
    expect(done.body.application.checks.conditions.every((condition) => condition.met)).toBe(true)
    expect(done.body.events.some((event) => event.message === 'Condition met: Payroll deduction confirmed by the employer (HR letter received)')).toBe(true)
    expect((await officer.post(`/applications/${other}/conditions/nope`, { met: true })).status).toBe(404)
    expect((await move(officer, other, 'pay', { note: 'EFT 9' })).status).toBe(200)
  })

  it('still finishes the old case on its old workflow', async () => {
    await toDecision((action, extra) => act(officer, before, action, extra), { verify: documentVerifier(officer, before) })
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
    // A manager following the case (its RM) sees it, though prescreening isn't theirs.
    await (await getDb()).update(schema.applications).set({ assignedRm: salesManagerId }).where(eq(schema.applications.id, id))
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

describe('a role named on a state never grants a permission it lacks', () => {
  const clerk = client(handler)
  let clerkRole
  // CUSTOM with underwriting given to a role that may work cases but not decide them.
  const withClerk = () => ({
    ...CUSTOM,
    states: CUSTOM.states.map((state) => (state.id === 'underwriting' ? { ...state, roles: [clerkRole] } : state)),
  })

  beforeAll(async () => {
    const created = await admin.post('/roles', { label: 'Credit clerk', scope: 'all', permissions: ['cases.work', 'applications.note'] })
    expect(created.status, JSON.stringify(created.body)).toBe(200)
    clerkRole = created.body.role.key
    const invite = await admin.post('/users', { name: 'Chanda Clerk', email: 'clerk@example.com', role: clerkRole })
    await clerk.post('/auth/password/set', { token: decodeURIComponent(invite.body.inviteUrl.split('token=')[1]), password: 'chanda-strong-pass' })
  })

  it('is refused by the editor when it can’t take the state’s actions', async () => {
    const saved = await admin.put('/admin/workflow/draft', { definition: withClerk(), note: 'Clerk decides' })
    expect(saved.status).toBe(200)
    const problem = saved.body.validation.errors.find((error) => error.stateId === 'underwriting')
    expect(problem.message).toMatch(/Credit clerk.*“Approve” or “Reject”.*Approve or decline/)
    const published = await admin.post('/admin/workflow/publish', {})
    expect(published.status).toBe(400)
    expect(published.body.code).toBe('invalid_workflow')
    await admin.del('/admin/workflow/draft')
  })

  it('can’t approve even on a workflow saved before that check', async () => {
    await saveDraftWorkflow(withClerk(), 'Saved before the check', { id: null })
    await publishDraftWorkflow({ id: null }, 'Saved before the check')
    const id = await submit('clerk-case@example.com')
    await move(officer, id, 'prescreen')
    await act(officer, id, 'check', { check: 'identity', done: true, note: 'NRC seen' })
    expect((await move(officer, id, 'underwrite', { verdict: 'approve', rationale: 'Affordable' })).status).toBe(200)
    expect(await consistent(id)).toMatchObject({ state: 'underwriting' })

    // The case page says so, and the server refuses.
    const actions = (await clerk.get(`/applications/${id}`)).body.workflow.actions
    expect(actions.find((action) => action.id === 'approve').blocked).toBe('Your role can’t do this.')
    expect(actions.find((action) => action.id === 'back').blocked).toBeNull()
    const attempt = await move(clerk, id, 'approve', { rationale: 'Clerk approves' })
    expect(attempt.status).toBe(403)
    expect(await consistent(id)).toMatchObject({ state: 'underwriting', status: 'pending_approval' })
    // What the role does allow, it can still do there.
    expect((await move(clerk, id, 'back', { rationale: 'Check the employer' })).status).toBe(200)
  })

  it('keeps roles from losing a permission the published workflow relies on', async () => {
    // Prescreening is the loan officers', and its Reject needs "Approve or decline".
    const officers = (await admin.get('/roles')).body.roles.find((role) => role.key === 'loan_officer')
    const refused = await admin.patch('/roles/loan_officer', { permissions: officers.permissions.filter((permission) => permission !== 'cases.decide') })
    expect(refused.status).toBe(409)
    expect(refused.body.code).toBe('role_in_workflow')
    expect(refused.body.message).toMatch(/Prescreening/)
    expect((await admin.get('/roles')).body.roles.find((role) => role.key === 'loan_officer').permissions).toContain('cases.decide')
    // A permission no state relies on can still go.
    expect((await admin.patch('/roles/loan_officer', { permissions: officers.permissions.filter((permission) => permission !== 'rules.view') })).status).toBe(200)
    await admin.post('/roles/loan_officer/reset', {})
  })
})

/** The default graph as it was before Appraisal set the terms: Appraisal values collateral (secured loans only), Underwriting recommends. */
const formerDefault = () => {
  const definition = legacyToWorkflow({})
  const decision = definition.states.find((state) => state.id === 'decision')
  return {
    ...definition,
    states: definition.states
      .filter((state) => state.id !== 'decision')
      .map((state) => {
        if (state.id === 'appraisal') return { ...state, work: undefined, appraisal: true, actions: [{ id: 'appraised', label: 'Appraisal done', kind: 'move', to: 'in_review', permission: 'cases.work' }] }
        if (state.id === 'in_review') return { ...state, work: undefined, actions: decision.actions }
        return state
      }),
  }
}
const SECURED = { items: [{ code: 'MV-CAR', type: 'motor_vehicle', name: 'Passenger vehicle', description: 'Toyota Hilux ABC 1234', value: 180000, haircut: 0.3, ltv: 0.7 }] }

describe('sending a case back to Appraisal', () => {
  beforeAll(async () => {
    const definition = legacyToWorkflow({})
    const states = definition.states.map((state) =>
      state.id === 'in_review' ? { ...state, actions: [...state.actions, { id: 'back', label: 'Send back', kind: 'return', to: 'appraisal', permission: 'cases.work', options: { requireNote: true } }] } : state
    )
    await saveDraftWorkflow({ ...definition, legacy: undefined, states }, 'Underwriting can send back', { id: null })
    await publishDraftWorkflow({ id: null }, 'Underwriting can send back')
  })

  it('keeps the saved terms, so Appraisal can approve again', async () => {
    const id = await submit('terms-again@example.com')
    expect((await act(officer, id, 'start_review')).status).toBe(200)
    expect(await consistent(id)).toMatchObject({ state: 'appraisal', status: 'in_review' })
    expect((await act(officer, id, 'save_terms')).status).toBe(200)
    expect((await move(officer, id, 'appraised')).status).toBe(200)
    expect(await consistent(id)).toMatchObject({ state: 'in_review' })
    expect((await move(officer, id, 'back', { rationale: 'Tenure too long' })).status).toBe(200)
    const back = await consistent(id)
    expect(back.state).toBe('appraisal')
    expect(back.terms?.summary?.instalment).toBeGreaterThan(0)
    const again = await move(officer, id, 'appraised')
    expect(again.status, JSON.stringify(again.body)).toBe(200)
    expect(await consistent(id)).toMatchObject({ state: 'in_review' })
  })
})

describe('a version still valuing collateral at Appraisal', () => {
  beforeAll(async () => {
    await saveDraftWorkflow({ ...formerDefault(), legacy: undefined }, 'Collateral appraisal', { id: null })
    await publishDraftWorkflow({ id: null }, 'Collateral appraisal')
  })

  it('holds a secured loan on its valuation, and passes an unsecured one by', async () => {
    const secured = await submit('former-secured@example.com')
    const db = await getDb()
    const data = (await row(secured)).data
    await db.update(schema.applications).set({ data: { ...data, collateral: SECURED } }).where(eq(schema.applications.id, secured))
    await act(officer, secured, 'start_review')
    expect(await consistent(secured)).toMatchObject({ state: 'appraisal' })
    const held = await move(officer, secured, 'appraised')
    expect(held.status).toBe(409)
    expect(held.body.code).toBe('valuation_incomplete')

    const unsecured = await submit('former-unsecured@example.com')
    await act(officer, unsecured, 'start_review')
    expect(await consistent(unsecured)).toMatchObject({ state: 'in_review' })
    expect((await act(officer, unsecured, 'recommend', { verdict: 'approve', rationale: 'Affordable' })).status).toBe(200)
  })
})

describe('a workflow still made from the settings, on the former default', () => {
  it('is remade with the new graph, keeping cases in review at Underwriting', async () => {
    const db = await getDb()
    const id = await submit('former-legacy@example.com')
    const [{ max }] = await db.select({ max: sql`max(${schema.workflowVersions.version})::int` }).from(schema.workflowVersions)
    await db.update(schema.workflowVersions).set({ status: 'retired' }).where(eq(schema.workflowVersions.status, 'published'))
    await db.insert(schema.workflowVersions).values({ version: max + 1, status: 'published', definition: formerDefault(), legacy: true, note: 'Former default', publishedAt: new Date() })
    await db.update(schema.applications).set({ state: 'in_review', status: 'in_review', workflowVersion: max + 1 }).where(eq(schema.applications.id, id))

    clearWorkflowCache()
    const current = await getPublishedWorkflow()
    expect(current).toMatchObject({ version: max + 2, legacy: true })
    expect(current.definition.states.find((state) => state.id === 'appraisal')).toMatchObject({ work: 'terms' })
    expect(current.definition.states.find((state) => state.id === 'decision')).toBeTruthy()
    expect(await consistent(id)).toMatchObject({ state: 'in_review', workflowVersion: max + 2 })
  })
})
