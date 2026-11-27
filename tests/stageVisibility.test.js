import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createMemoryKv, client, documentVerifier, draftPreparer, toDecision } from './helpers.js'

const kv = createMemoryKv()
vi.mock('../api/_lib/kv.js', () => ({ default: kv }))

const { default: handler } = await import('../api/v1/[...path].js')
const { putBlob } = await import('../api/_lib/blob.js')
const { getDb, schema } = await import('../api/_lib/db/client.js')
const { eq } = await import('drizzle-orm')
const { legacyToWorkflow } = await import('../src/config/workflow.js')

/*
 * Staff see a case while its current stage is one their role works on, plus the cases they
 * have worked on, read-only. Admins see everything.
 */

const prepareDraft = draftPreparer(kv, putBlob)
const admin = client(handler)
const officer = client(handler)
const colleague = client(handler)
const legal = client(handler)
const dsa = client(handler)
const applicant = client(handler)
let dsaId

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
const ok = async (promise) => {
  const response = await promise
  expect(response.status, JSON.stringify(response.body)).toBe(200)
  return response
}
const listed = async (who, id) => (await who.get('/applications?pageSize=200')).body.applications.some((row) => row.id === id)
/** Start the review and save terms: the case is at Appraisal. */
const toAppraisal = async (who, id) => ok(act(who, id, 'start_review'))
/** Through Appraisal: the case is at Underwriting. */
const toUnderwriting = async (who, id) => {
  await toAppraisal(who, id)
  await ok(act(who, id, 'save_terms'))
  await ok(act(who, id, 'transition', { actionId: 'appraised' }))
}
const toPendingApproval = async (who, id) => {
  await toAppraisal(who, id)
  await toDecision((action, extra) => act(who, id, action, extra), { verify: documentVerifier(who, id) })
  await ok(act(who, id, 'recommend', { verdict: 'approve', rationale: 'Affordable' }))
}

beforeAll(async () => {
  await admin.post('/auth/demo', { role: 'admin' })
  await officer.post('/auth/demo', { role: 'loan_officer' })
  await legal.post('/auth/demo', { role: 'legal_officer' })
  dsaId = (await dsa.post('/auth/demo', { role: 'dsa' })).body.user.id
  const invite = await admin.post('/users', { name: 'Colleague Officer', email: 'colleague.officer@example.com', role: 'loan_officer' })
  const token = decodeURIComponent(invite.body.inviteUrl.split('token=')[1])
  await colleague.post('/auth/password/set', { token, password: 'colleague-officer-pass' })

  // A recommendation goes to a second person, and the decision is the sales manager's (as on v10).
  await ok(admin.put('/settings/workflow', { requireSecondApproval: true, slaDays: 3, requireLegalReview: false }))
  const { published } = (await admin.get('/admin/workflow')).body
  expect(published.definition.states.some((state) => state.id === 'pending_approval')).toBe(true)
  const definition = { ...published.definition, states: published.definition.states.map((state) => (state.id === 'pending_approval' ? { ...state, roles: ['sales_manager'] } : state)) }
  await ok(admin.put('/admin/workflow/draft', { definition }))
  await ok(admin.post('/admin/workflow/publish', {}))
})

describe('a legal officer', () => {
  it('sees a case only from Underwriting, then read-only once it moves on', async () => {
    const before = (await legal.get('/applications?pageSize=200')).body
    const dashboardBefore = (await legal.get('/dashboard')).body
    const id = await submit('vis-legal@example.com')

    // At Pre-screening: nowhere to be seen.
    const after = (await legal.get('/applications?pageSize=200')).body
    expect(after.applications.some((row) => row.id === id)).toBe(false)
    expect(after.total).toBe(before.total)
    expect(after.statusCounts).toEqual(before.statusCounts)
    const dashboardAfter = (await legal.get('/dashboard')).body
    expect(dashboardAfter.kpis.pipeline).toEqual(dashboardBefore.kpis.pipeline)
    expect(dashboardAfter.openByStatus).toEqual(dashboardBefore.openByStatus)
    expect((await legal.get(`/applications/${id}`)).status).toBe(404)

    // At Appraisal: still not.
    await toAppraisal(officer, id)
    expect(await listed(legal, id)).toBe(false)
    expect((await legal.get(`/applications/${id}`)).status).toBe(404)

    // At Underwriting: listed, and it opens to work on.
    await ok(act(officer, id, 'save_terms'))
    const appraised = await ok(act(officer, id, 'transition', { actionId: 'appraised' }))
    expect(await listed(legal, id)).toBe(true)
    const open = await legal.get(`/applications/${id}`)
    expect(open.status).toBe(200)
    expect(open.body.workflow.readOnly).toBe(false)
    expect((await legal.get('/dashboard')).body.kpis.pipeline.count).toBe(dashboardBefore.kpis.pipeline.count + 1)

    // The legal officer verifies one document; the officer the rest, and approves.
    const [first, ...rest] = appraised.body.workflow.state.underwriting.documents
    await ok(documentVerifier(legal, id)(first.id))
    for (const document of rest) await ok(documentVerifier(officer, id)(document.id))
    await ok(act(officer, id, 'transition', { actionId: 'underwritten' }))

    // At the credit decision: still theirs to read, not to change.
    expect(await listed(legal, id)).toBe(true)
    const readOnly = await legal.get(`/applications/${id}`)
    expect(readOnly.status).toBe(200)
    expect(readOnly.body.workflow.state.id).toBe('decision')
    expect(readOnly.body.workflow.readOnly).toBe(true)
    // A note is open on a case they see, but the legal officer's role doesn't write notes (applications.note).
    const note = await act(legal, id, 'note', { message: 'Looked again' })
    expect(note.status).toBe(403)
    expect(note.body.code).toBe('forbidden')
    const legalSave = await legal.put(`/applications/${id}/legal/0`, {})
    expect(legalSave.status).toBe(403)
    expect(legalSave.body.code).toBe('read_only')
    const reverify = await documentVerifier(legal, id)(first.id)
    expect(reverify.body.code).toBe('read_only')
  })
})

describe('a loan officer', () => {
  it('sees its own case at a stage it doesn’t work, read-only, but not a colleague’s', async () => {
    const mine = await submit('vis-mine@example.com')
    await toPendingApproval(officer, mine)
    const theirs = await submit('vis-theirs@example.com')
    await toPendingApproval(colleague, theirs)

    const own = await officer.get(`/applications/${mine}`)
    expect(own.status).toBe(200)
    expect(own.body.workflow.state.id).toBe('pending_approval')
    expect(own.body.workflow.readOnly).toBe(true)
    expect(await listed(officer, mine)).toBe(true)
    const decide = await act(officer, mine, 'decide', { verdict: 'approve', rationale: 'Mine' })
    expect(decide.body.code).toBe('read_only')

    expect(await listed(officer, theirs)).toBe(false)
    expect((await officer.get(`/applications/${theirs}`)).status).toBe(404)
  })
})

describe('the dashboard workload', () => {
  it('counts only the cases the officer may see', async () => {
    const before = (await officer.get('/dashboard')).body.queue
    const adminBefore = (await admin.get('/dashboard')).body.queue
    const id = await submit('vis-dashboard@example.com')
    await toPendingApproval(colleague, id)
    expect((await officer.get(`/applications/${id}`)).status).toBe(404)
    const after = (await officer.get('/dashboard')).body.queue
    expect(after.awaitingDecision).toBe(before.awaitingDecision)
    expect(after.unassigned).toBe(before.unassigned)
    expect(after.overdue).toBe(before.overdue)
    expect((await admin.get('/dashboard')).body.queue.awaitingDecision).toBe(adminBefore.awaitingDecision + 1)
  })
})

describe('a direct sales agent', () => {
  it('sees the case it brought in at Appraisal, and can still withdraw it', async () => {
    const id = await submit('vis-dsa@example.com')
    const db = await getDb()
    await db.update(schema.applications).set({ sourcedBy: dsaId }).where(eq(schema.applications.id, id))
    await toAppraisal(officer, id)

    expect(await listed(dsa, id)).toBe(true)
    const open = await dsa.get(`/applications/${id}`)
    expect(open.status).toBe(200)
    expect(open.body.workflow.readOnly).toBe(true)
    const withdrawn = await act(dsa, id, 'withdraw', { reason: 'The customer changed their mind' })
    expect(withdrawn.status, JSON.stringify(withdrawn.body)).toBe(200)
    expect(withdrawn.body.application.status).toBe('withdrawn')
  })
})

describe('an administrator', () => {
  it('sees every case', async () => {
    const db = await getDb()
    const all = await db.select({ id: schema.applications.id }).from(schema.applications)
    const { body } = await admin.get('/applications?pageSize=200')
    expect(body.total).toBe(all.length)
    for (const { id } of all) expect((await admin.get(`/applications/${id}`)).status).toBe(200)
  })
})

describe('a role whose permissions change', () => {
  afterAll(() => admin.post('/roles/legal_officer/reset', {}))

  it('stops seeing Underwriting cases it never touched on the next request', async () => {
    const id = await submit('vis-role-change@example.com')
    await toUnderwriting(officer, id)
    expect(await listed(legal, id)).toBe(true)
    await ok(admin.patch('/roles/legal_officer', { permissions: ['applications.note'] }))
    expect(await listed(legal, id)).toBe(false)
    expect((await legal.get(`/applications/${id}`)).status).toBe(404)
  })
})

/** An old-style version: in_review holds the decision (recommend), no underwriting stage; `inReview` overrides that state. */
const oldStyleDefinition = (inReview = {}) => {
  const base = legacyToWorkflow({})
  const decision = base.states.find((state) => state.id === 'decision')
  return {
    ...base,
    legacy: undefined,
    states: base.states
      .filter((state) => state.id !== 'decision')
      .map((state) => {
        if (state.id === 'appraisal') return { ...state, work: undefined, appraisal: true, actions: [{ id: 'appraised', label: 'Appraisal done', kind: 'move', to: 'in_review', permission: 'cases.work' }] }
        if (state.id === 'in_review') return { ...state, work: undefined, actions: decision.actions, ...inReview }
        return state
      }),
  }
}
const publish = async (definition) => {
  await ok(admin.put('/admin/workflow/draft', { definition }))
  await ok(admin.post('/admin/workflow/publish', {}))
}

describe('a case on an older workflow version', () => {
  it('is visible to the roles that work its stage in that version', async () => {
    await admin.post('/roles/legal_officer/reset', {})
    const { published: current } = (await admin.get('/admin/workflow')).body
    // In this version in_review is the loan officers' alone.
    await publish(oldStyleDefinition({ roles: ['loan_officer'] }))
    const id = await submit('vis-old-version@example.com')
    // This version's start_review goes straight to in_review.
    await ok(act(officer, id, 'start_review'))
    const oldVersion = (await admin.get(`/applications/${id}`)).body.application.workflowVersion

    // A newer version, where in_review is Underwriting again (the legal officer's), is published.
    await publish(current.definition)
    const fresh = (await admin.get(`/applications/${id}`)).body
    expect(fresh.application.workflowVersion).toBe(oldVersion)
    expect(fresh.application.state).toBe('in_review')

    // A colleague who never touched it still sees it: the loan officers work in_review in its version.
    expect(await listed(colleague, id)).toBe(true)
    expect((await colleague.get(`/applications/${id}`)).body.workflow.readOnly).toBe(false)
    // The legal officer doesn't work in_review in that version.
    expect(await listed(legal, id)).toBe(false)
    expect((await legal.get(`/applications/${id}`)).status).toBe(404)
  })

  it('without an underwriting stage, is the legal officer’s where it approves or recommends', async () => {
    const { published: current } = (await admin.get('/admin/workflow')).body
    await publish(oldStyleDefinition())
    const id = await submit('vis-old-legal@example.com')
    // Pre-screening only moves on: not the legal officer's.
    expect(await listed(legal, id)).toBe(false)
    expect((await legal.get(`/applications/${id}`)).status).toBe(404)

    // in_review recommends, where the old legal sign-off holds approval: seen, and theirs to verify.
    await ok(act(officer, id, 'start_review'))
    await publish(current.definition)
    expect(await listed(legal, id)).toBe(true)
    const open = (await legal.get(`/applications/${id}`)).body
    expect(open.workflow.readOnly).toBe(false)
    const document = open.documents.find((entry) => entry.source !== 'system')
    await ok(documentVerifier(legal, id)(document.id))
  })
})

describe('a team lead (scope team)', () => {
  it('sees its team’s cases at any stage, read-only where it doesn’t work, and no one else’s', async () => {
    const rm = client(handler)
    const rmId = (await rm.post('/auth/demo', { role: 'rm' })).body.user.id
    const db = await getDb()
    await db.update(schema.users).set({ managerId: rmId }).where(eq(schema.users.id, dsaId))
    const team = await submit('vis-team@example.com')
    await db.update(schema.applications).set({ sourcedBy: dsaId }).where(eq(schema.applications.id, team))
    await toAppraisal(officer, team)
    const other = await submit('vis-not-team@example.com')
    await toAppraisal(officer, other)

    expect(await listed(rm, team)).toBe(true)
    const open = await rm.get(`/applications/${team}`)
    expect(open.status).toBe(200)
    expect(open.body.workflow.readOnly).toBe(true)
    // A note is still theirs to add (applications.note); moving the case on is not.
    await ok(act(rm, team, 'note', { message: 'Following up' }))
    expect((await act(rm, team, 'transition', { actionId: 'appraised' })).body.code).toBe('read_only')

    expect(await listed(rm, other)).toBe(false)
    expect((await rm.get(`/applications/${other}`)).status).toBe(404)

    // Handing its team's case to someone who works the stage is still a manager's to do (cases.assign);
    // taking it themselves, or working it, is not.
    const officerId = (await officer.get('/auth/me')).body.user.id
    expect((await act(rm, team, 'assign', { officerId: rmId })).body.code).toBe('read_only')
    const assigned = await act(rm, team, 'assign', { officerId })
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(200)
    expect(assigned.body.application.assignedOfficer).toBe(officerId)
    await ok(act(rm, team, 'note', { message: 'Handed over' }))
  })
})

describe('the LMS hand-off', () => {
  it('can be reconciled and sent on a paid-out case, without the read-only check', async () => {
    const id = await submit('vis-lms@example.com')
    await toAppraisal(officer, id)
    const db = await getDb()
    await db.update(schema.applications).set({ state: 'paid_out', status: 'disbursed', lmsSyncStatus: 'uncertain' }).where(eq(schema.applications.id, id))
    expect((await officer.get(`/applications/${id}`)).body.workflow.readOnly).toBe(true)

    const reconciled = await officer.post(`/applications/${id}/lms/reconcile`, { found: false })
    expect(reconciled.status, JSON.stringify(reconciled.body)).toBe(200)
    expect(reconciled.body.application.lmsSyncStatus).toBe('failed')
    // Send goes on to its own checks (here: no LMS connected), not read_only.
    const sent = await officer.post(`/applications/${id}/lms/send`, {})
    expect(sent.body.code).not.toBe('read_only')
    expect(sent.body.code).toBe('lms_not_configured')
  })
})

describe('working a stage, against only seeing it', () => {
  it('lets a legal officer see and verify at Underwriting, but not be offered or take the case there', async () => {
    const id = await submit('vis-legal-assign@example.com')
    await toUnderwriting(officer, id)
    const legalId = (await legal.get('/auth/me')).body.user.id

    const assignees = await ok(admin.get(`/applications/${id}/assignees`))
    expect(assignees.body.people.some((person) => person.id === legalId)).toBe(false)
    expect(assignees.body.people.some((person) => person.role === 'legal_officer')).toBe(false)
    const take = await act(legal, id, 'take')
    expect(take.status).toBe(403)
    expect(take.body.code).toBe('forbidden')
    const assignSelf = await act(legal, id, 'assign', {})
    expect(assignSelf.status).toBe(403)

    expect(await listed(legal, id)).toBe(true)
    const open = await ok(legal.get(`/applications/${id}`))
    expect(open.body.workflow.readOnly).toBe(false)
    const [first] = open.body.workflow.state.underwriting.documents
    await ok(documentVerifier(legal, id)(first.id))
  })
})

describe('notes and field visits on a case seen read-only', () => {
  it('lets a direct sales agent note and log a visit on its own case at Appraisal, but not move it', async () => {
    const id = await submit('vis-dsa-note@example.com')
    const db = await getDb()
    await db.update(schema.applications).set({ sourcedBy: dsaId }).where(eq(schema.applications.id, id))
    await toAppraisal(officer, id)
    expect((await dsa.get(`/applications/${id}`)).body.workflow.readOnly).toBe(true)

    await ok(act(dsa, id, 'note', { message: 'Spoke to the customer' }))
    await ok(dsa.post(`/applications/${id}/visits`, { latitude: -15.4, longitude: 28.3, accuracy: 12, note: 'At the shop' }))
    const moved = await act(dsa, id, 'transition', { actionId: 'appraised' })
    expect(moved.status).toBe(403)
    expect(moved.body.code).toBe('read_only')
  })
})

describe('a sales manager who leads a team', () => {
  const manager = client(handler)
  let managerId
  const inviteAgent = async (name, email, extra = {}) => (await ok(admin.post('/users', { name, email, role: 'dsa', ...extra }))).body
  const paidOutCase = async (email, sourcedBy) => {
    const id = await submit(email)
    await toAppraisal(officer, id)
    const db = await getDb()
    await db.update(schema.applications).set({ sourcedBy, state: 'paid_out', status: 'disbursed' }).where(eq(schema.applications.id, id))
    return id
  }
  const userId = async (email) => {
    const db = await getDb()
    const [row] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email))
    return row.id
  }

  beforeAll(async () => {
    managerId = (await manager.post('/auth/demo', { role: 'sales_manager' })).body.user.id
  })

  it('still sees a reporting agent’s paid-out case, read-only', async () => {
    await inviteAgent('Team Agent', 'vis-team-agent@example.com', { managerId })
    const agentId = await userId('vis-team-agent@example.com')
    const id = await paidOutCase('vis-sm-team@example.com', agentId)
    expect(await listed(manager, id)).toBe(true)
    const open = await ok(manager.get(`/applications/${id}`))
    expect(open.body.workflow.readOnly).toBe(true)
  })

  it('doesn’t see another agent’s hidden case in that agent’s report', async () => {
    await inviteAgent('Other Agent', 'vis-other-agent@example.com')
    const agentId = await userId('vis-other-agent@example.com')
    const id = await paidOutCase('vis-sm-other@example.com', agentId)
    expect((await manager.get(`/applications/${id}`)).status).toBe(404)
    const report = await ok(manager.get(`/reports/agents/${agentId}`))
    expect(report.body.recent.some((row) => row.id === id)).toBe(false)
    // The administrator's report lists it.
    expect((await ok(admin.get(`/reports/agents/${agentId}`))).body.recent.some((row) => row.id === id)).toBe(true)
  })
})

describe('other ways to reach a hidden case', () => {
  it('hides its documents and its reference from search', async () => {
    const id = await submit('vis-leak@example.com')
    const full = (await admin.get(`/applications/${id}`)).body
    const document = full.documents.find((entry) => entry.id)
    expect(document).toBeTruthy()
    expect((await admin.get(`/applications/${id}/documents/${document.id}`)).status).toBe(200)
    expect((await legal.get(`/applications/${id}`)).status).toBe(404)
    expect((await legal.get(`/applications/${id}/documents/${document.id}`)).status).toBe(404)

    const { reference } = full.application
    expect((await admin.get(`/applications?q=${encodeURIComponent(reference)}`)).body.applications.some((row) => row.id === id)).toBe(true)
    const search = await ok(legal.get(`/applications?q=${encodeURIComponent(reference)}`))
    expect(search.body.applications).toEqual([])
  })
})
