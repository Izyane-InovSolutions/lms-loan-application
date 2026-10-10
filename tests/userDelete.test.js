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

/** Invites someone and signs them in with a password, as a real invite would. */
const invitee = async (name, email, role) => {
  const invite = await admin.post('/users', { name, email, role })
  expect(invite.status, JSON.stringify(invite.body)).toBe(200)
  const person = client(handler)
  const token = decodeURIComponent(invite.body.inviteUrl.split('token=')[1])
  await person.post('/auth/password/set', { token, password: `${email}-password` })
  return { person, id: invite.body.user.id }
}

const listed = async () => (await admin.get('/users')).body.users.map((user) => user.email)

let adminId

beforeAll(async () => {
  adminId = (await admin.post('/auth/demo', { role: 'admin' })).body.user.id
  await officer.post('/auth/demo', { role: 'loan_officer' })
})

describe('deleting a staff account', () => {
  it('removes an account nobody’s records mention, and frees the email', async () => {
    const invite = await admin.post('/users', { name: 'Wrong Person', email: 'mistake@example.com', role: 'loan_officer' })
    const deleted = await admin.del(`/users/${invite.body.user.id}`)
    expect(deleted.status, JSON.stringify(deleted.body)).toBe(200)
    expect(deleted.body.historyKept).toBe(false)
    expect(await listed()).not.toContain('mistake@example.com')
    expect((await admin.post('/users', { name: 'Right Person', email: 'mistake@example.com', role: 'loan_officer' })).status).toBe(200)
  })

  it('deletes an agent with history, keeping their name on what they brought in', async () => {
    const agent = await invitee('Dora Agent', 'dora.dsa@example.com', 'dsa')
    const code = (await agent.person.get('/auth/me')).body.user.referralCode
    const { token, body } = await prepareDraft('dora.customer@example.com')
    body.data.personalInfo.email = 'dora.customer@example.com'
    const filed = await applicant.post('/applications', { ...body, referralCode: code }, { authorization: `Bearer ${token}` })
    expect(filed.status).toBe(200)

    const deleted = await admin.del(`/users/${agent.id}`)
    expect(deleted.body).toMatchObject({ ok: true, historyKept: true })
    // Gone: off the team, signed out, and unable to sign in.
    expect(await listed()).not.toContain('dora.dsa@example.com')
    expect((await agent.person.get('/auth/me')).body.user).toBeNull()
    expect((await client(handler).post('/auth/login', { email: 'dora.dsa@example.com', password: 'dora.dsa@example.com-password' })).status).not.toBe(200)
    // The case still says who brought it in.
    const { application } = (await admin.get(`/applications/${filed.body.id}`)).body
    expect(application.sourcedBy).toBe(agent.id)
    expect((await admin.get(`/applications?status=all&sourcedBy=${agent.id}`)).body.applications[0].sourcedByName).toBe('Dora Agent')
    // Deleting again, or editing, finds nobody.
    expect((await admin.del(`/users/${agent.id}`)).status).toBe(404)
    expect((await admin.patch(`/users/${agent.id}`, { name: 'Back' })).status).toBe(404)
    // And the email can be used again.
    expect((await admin.post('/users', { name: 'Dora Again', email: 'dora.dsa@example.com', role: 'dsa' })).status).toBe(200)
  })

  it('never deletes yourself, and only someone allowed to manage the account', async () => {
    expect((await admin.del(`/users/${adminId}`)).body.code).toBe('self_change')
    const target = await admin.post('/users', { name: 'Someone', email: 'someone@example.com', role: 'dsa' })
    expect((await officer.del(`/users/${target.body.user.id}`)).status).toBe(403)
  })

  it('doesn’t let a deleted role member block deleting the role', async () => {
    await admin.post('/roles', { label: 'Short lived', scope: 'own', permissions: [] })
    const member = await admin.post('/users', { name: 'Temp', email: 'temp.role@example.com', role: 'short_lived' })
    expect((await admin.del('/roles/short_lived')).body.code).toBe('role_in_use')
    await admin.del(`/users/${member.body.user.id}`)
    expect((await admin.del('/roles/short_lived')).status).toBe(200)
  })
})
