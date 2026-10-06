import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createMemoryKv, client, draftPreparer } from './helpers.js'

const kv = createMemoryKv()
vi.mock('../api/_lib/kv.js', () => ({ default: kv }))

const { default: handler } = await import('../api/v1/[...path].js')
const { putBlob } = await import('../api/_lib/blob.js')
const { BUILT_IN_ROLES, PERMISSIONS } = await import('../src/config/roles.js')

const prepareDraft = draftPreparer(kv, putBlob)

const admin = client(handler)
const officer = client(handler)
const salesManager = client(handler)
const dsa = client(handler)
const applicant = client(handler)

/** Invites someone and signs them in with a password, as a real invite would. */
const invitee = async (name, email, role) => {
  const invite = await admin.post('/users', { name, email, role })
  expect(invite.status, JSON.stringify(invite.body)).toBe(200)
  const person = client(handler)
  const token = decodeURIComponent(invite.body.inviteUrl.split('token=')[1])
  await person.post('/auth/password/set', { token, password: `${email}-password` })
  return { person, id: invite.body.user.id }
}

const submit = async (email) => {
  const { token, body } = await prepareDraft(email)
  body.data.personalInfo.email = email
  const response = await applicant.post('/applications', body, { authorization: `Bearer ${token}` })
  expect(response.status, JSON.stringify(response.body)).toBe(200)
  return response.body.id
}

/** Runs one workflow action against the current version. */
const act = async (who, id, action, extra = {}) => {
  const { version } = (await admin.get(`/applications/${id}`)).body.application
  return who.post(`/applications/${id}/actions`, { action, version, ...extra })
}

const checkEverything = async (who, id) => {
  for (const check of ['identity', 'documents', 'income']) {
    expect((await act(who, id, 'check', { check, done: true, note: 'Original seen' })).status).toBe(200)
  }
}

beforeAll(async () => {
  await admin.post('/auth/demo', { role: 'admin' })
  await officer.post('/auth/demo', { role: 'loan_officer' })
  await salesManager.post('/auth/demo', { role: 'sales_manager' })
  await dsa.post('/auth/demo', { role: 'dsa' })
})

describe('built-in roles', () => {
  it('give the sales manager everything a relationship manager and a loan officer can do', () => {
    const manager = BUILT_IN_ROLES.sales_manager
    for (const permission of [...BUILT_IN_ROLES.rm.permissions, ...BUILT_IN_ROLES.loan_officer.permissions]) {
      expect(manager.permissions).toContain(permission)
    }
    expect(manager.scope).toBe('all')
    // Still not an administrator.
    expect(manager.permissions).not.toContain('settings.manage')
    expect(manager.permissions).not.toContain('roles.manage')
  })

  it('are sent to the browser with the signed-in person', async () => {
    const { body } = await salesManager.get('/auth/me')
    expect(body.user.permissions).toContain('cases.decide')
    expect(body.user.scope).toBe('all')
    expect(body.user.roleLabel).toBe('Sales manager')
    const forAdmin = (await admin.get('/auth/me')).body.user
    expect(forAdmin.permissions.sort()).toEqual(PERMISSIONS.filter((key) => !['applications.assist', 'team.lead'].includes(key)).sort())
  })
})

describe('administrators', () => {
  it('don’t bring business in: no assisted applications, referrals or team to lead', async () => {
    const forAdmin = (await admin.get('/auth/me')).body.user
    expect(forAdmin.permissions).not.toContain('applications.assist')
    expect(forAdmin.permissions).not.toContain('team.lead')
    // An assisted submission by an admin is refused rather than credited to them.
    const { token, body } = await prepareDraft('admin-assisted@example.com')
    body.data.personalInfo.email = 'admin-assisted@example.com'
    const refused = await admin.post('/applications', { ...body, assisted: true }, { authorization: `Bearer ${token}` })
    expect([401, 403]).toContain(refused.status)
  })

  it('still grant what they don’t hold: a role that brings business in, and inviting to it', async () => {
    const created = await admin.post('/roles', { label: 'Field agent', scope: 'own', permissions: ['applications.assist'] })
    expect(created.status, JSON.stringify(created.body)).toBe(200)
    const invited = await admin.post('/users', { name: 'Field Agent', email: 'field.agent@example.com', role: created.body.role.key })
    expect(invited.status, JSON.stringify(invited.body)).toBe(200)
  })
})

describe('the sales manager', () => {
  it('reviews and decides cases, with four-eyes still applying', async () => {
    const id = await submit('sm-case@example.com')
    expect((await act(salesManager, id, 'start_review')).status).toBe(200)
    await checkEverything(salesManager, id)
    expect((await act(salesManager, id, 'recommend', { verdict: 'approve', rationale: 'Affordable and verified' })).status).toBe(200)
    // Their own recommendation: someone else decides.
    const own = await act(salesManager, id, 'decide', { verdict: 'approve', rationale: 'Agreed' })
    expect(own.body.code).toBe('four_eyes')
    expect((await act(officer, id, 'decide', { verdict: 'approve', rationale: 'Agreed' })).body.application.status).toBe('approved')
  })

  it('decides a loan officer’s recommendation', async () => {
    const id = await submit('sm-decides@example.com')
    await act(officer, id, 'start_review')
    await checkEverything(officer, id)
    await act(officer, id, 'recommend', { verdict: 'decline', rationale: 'Income not verified' })
    const decided = await act(salesManager, id, 'decide', { verdict: 'decline', rationale: 'Agreed with the officer' })
    expect(decided.body.application.status).toBe('declined')
  })

  it('sees the whole team, the pipeline and the credit rules, but not settings', async () => {
    expect((await salesManager.get('/users')).status).toBe(200)
    expect((await salesManager.get('/rules')).status).toBe(200)
    expect((await salesManager.get('/officers')).body.officers.some((person) => person.role === 'sales_manager')).toBe(true)
    expect((await salesManager.get('/settings')).status).toBe(403)
    expect((await salesManager.post('/roles', { label: 'X', scope: 'own', permissions: [] })).status).toBe(403)
  })
})

describe('configuring roles', () => {
  it('adds a custom role whose members can do only what it grants', async () => {
    const created = await admin.post('/roles', {
      label: 'Credit analyst',
      description: 'Checks documents; does not recommend.',
      scope: 'all',
      permissions: ['cases.work', 'applications.note', 'rules.view'],
    })
    expect(created.status, JSON.stringify(created.body)).toBe(200)
    expect(created.body.role).toMatchObject({ key: 'credit_analyst', builtIn: false, scope: 'all' })

    const { person: analyst } = await invitee('Ana Analyst', 'ana.analyst@example.com', 'credit_analyst')
    expect((await analyst.get('/auth/me')).body.user.roleLabel).toBe('Credit analyst')

    const id = await submit('analyst-case@example.com')
    expect((await act(analyst, id, 'start_review')).status).toBe(200)
    await checkEverything(analyst, id)
    const recommend = await act(analyst, id, 'recommend', { verdict: 'approve', rationale: 'Looks fine' })
    expect(recommend.status).toBe(403)
    expect((await analyst.get('/users')).status).toBe(403)
  })

  it('refuses unknown permissions and scopes', async () => {
    expect((await admin.post('/roles', { label: 'Broken', scope: 'own', permissions: ['cases.fly'] })).status).toBe(400)
    expect((await admin.post('/roles', { label: 'Broken', scope: 'everywhere', permissions: [] })).status).toBe(400)
  })

  it('limits a role with the "own" scope to its own applications', async () => {
    await admin.post('/roles', { label: 'Branch clerk', scope: 'own', permissions: ['applications.note'] })
    const { person: clerk } = await invitee('Clara Clerk', 'clara.clerk@example.com', 'branch_clerk')
    await submit('not-the-clerks@example.com')
    expect((await clerk.get('/applications')).body.applications).toHaveLength(0)
  })

  it('applies a change to a built-in role at once, and resets it', async () => {
    const withoutDecide = BUILT_IN_ROLES.loan_officer.permissions.filter((permission) => permission !== 'cases.decide')
    expect((await admin.patch('/roles/loan_officer', { permissions: withoutDecide })).status).toBe(200)

    const id = await submit('no-decide@example.com')
    await act(salesManager, id, 'start_review')
    await checkEverything(salesManager, id)
    await act(salesManager, id, 'recommend', { verdict: 'decline', rationale: 'Too much existing debt' })
    expect((await act(officer, id, 'decide', { verdict: 'decline', rationale: 'Agreed' })).status).toBe(403)

    const reset = await admin.post('/roles/loan_officer/reset', {})
    expect(reset.body.role.permissions).toContain('cases.decide')
    expect((await act(officer, id, 'decide', { verdict: 'decline', rationale: 'Agreed' })).status).toBe(200)
  })

  it('keeps the administrator role fixed and undeletable', async () => {
    expect((await admin.patch('/roles/admin', { permissions: [] })).status).toBe(403)
    expect((await admin.del('/roles/admin')).body.code).toBe('locked_role')
    expect((await officer.del('/roles/rm')).status).toBe(403)
  })

  it('deletes a built-in role nobody holds, and brings it back with its defaults', async () => {
    // Someone holds the DSA role, so it stays.
    expect((await admin.del('/roles/dsa')).body.code).toBe('role_in_use')

    await admin.patch('/roles/rm', { label: 'Account manager' })
    expect((await admin.del('/roles/rm')).body.code).toBe('role_in_use')
    // Its members move to another role first, as an admin would in Team.
    for (const person of (await admin.get('/users')).body.users.filter((user) => user.role === 'rm')) {
      expect((await admin.patch(`/users/${person.id}`, { role: 'loan_officer' })).status).toBe(200)
    }
    const deleted = await admin.del('/roles/rm')
    expect(deleted.status, JSON.stringify(deleted.body)).toBe(200)
    const after = (await admin.get('/roles')).body
    expect(after.roles.map((role) => role.key)).not.toContain('rm')
    expect(after.removed).toEqual([expect.objectContaining({ key: 'rm', label: BUILT_IN_ROLES.rm.label })])
    // Nobody can be given a role that's gone.
    expect((await admin.post('/users', { name: 'Late Hire', email: 'late.rm@example.com', role: 'rm' })).status).toBe(400)

    const restored = await admin.post('/roles/rm/restore', {})
    expect(restored.body.role).toMatchObject({ key: 'rm', label: BUILT_IN_ROLES.rm.label, customized: false })
    expect((await admin.get('/roles')).body.removed).toEqual([])
    expect((await admin.post('/roles/rm/restore', {})).status).toBe(404)
  })

  it('refuses to delete a role the workflow still names', async () => {
    const { getPublishedWorkflow, saveDraftWorkflow, discardDraftWorkflow } = await import('../api/_lib/workflowVersions.js')
    await admin.post('/roles', { label: 'Queue keeper', scope: 'all', permissions: [...PERMISSIONS] })
    const { definition } = await getPublishedWorkflow()
    const named = { ...definition, states: definition.states.map((state, index) => (index === 0 ? { ...state, roles: ['queue_keeper'] } : state)) }
    await saveDraftWorkflow(named, 'Name the queue keeper', { id: null })
    const refused = await admin.del('/roles/queue_keeper')
    expect(refused.body.code, JSON.stringify(refused.body)).toBe('role_in_workflow')
    await discardDraftWorkflow()
    expect((await admin.del('/roles/queue_keeper')).status).toBe(200)
  })

  it('refuses to delete a role someone still holds, and records changes in the audit log', async () => {
    expect((await admin.del('/roles/credit_analyst')).body.code).toBe('role_in_use')
    await admin.post('/roles', { label: 'Temporary', scope: 'own', permissions: [] })
    expect((await admin.del('/roles/temporary')).status).toBe(200)
    const { body } = await admin.get('/audit?action=role.')
    expect(body.entries.map((entry) => entry.action)).toEqual(expect.arrayContaining(['role.created', 'role.updated', 'role.reset', 'role.deleted']))
  })

  it('lets a custom role bring business in and credits it', async () => {
    await admin.post('/roles', { label: 'Branch agent', scope: 'own', permissions: ['applications.assist', 'applications.note'] })
    // Only active accounts refer, so the agent finishes setting up first.
    const { person: agent, id: agentId } = await invitee('Bobby Branch', 'bobby.branch@example.com', 'branch_agent')
    const code = (await agent.get('/auth/me')).body.user.referralCode
    expect(code).toBeTruthy()
    const { token, body } = await prepareDraft('branch-referred@example.com')
    body.data.personalInfo.email = 'branch-referred@example.com'
    body.referralCode = code
    const submitted = await applicant.post('/applications', body, { authorization: `Bearer ${token}` })
    const row = (await admin.get(`/applications/${submitted.body.id}`)).body.application
    expect(row).toMatchObject({ channel: 'branch_agent', sourcedBy: agentId })
    // A plain DSA still can't see it.
    expect((await dsa.get(`/applications/${submitted.body.id}`)).status).toBe(404)
  })
})
