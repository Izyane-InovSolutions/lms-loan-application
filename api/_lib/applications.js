import { and, eq, or, sql } from 'drizzle-orm'
import { getDb, schema } from './db/client.js'
import { fail } from './http.js'
import { stageCondition } from './visibility.js'
import { caseWorkflow, worksOnStage } from './workflow.js'

const { applications, applicationEvents, users } = schema

/**
 * Row-level visibility of applications — the one place it is defined. Staff see what
 * their role's scope allows (roles.js; `viewer` comes from getSessionUser):
 *
 *   all    every application (admin, sales manager and loan officer by default)
 *   team   brought in by or assigned to them, assigned to them as RM, or brought in by
 *          someone who reports to them (RM by default)
 *   own    brought in by or assigned to them (DSA by default)
 *   partner  none: a partner's staff only see their partner's requests (api/_handlers/partners.js)
 *
 * Customers see their own, by account or by email. Returns a where-clause, or undefined
 * for "no restriction".
 */
export const scopeApplications = (viewer) => {
  if (viewer.role === 'customer') return or(eq(applications.customerId, viewer.id), eq(applications.applicantEmail, viewer.email))
  const own = or(eq(applications.sourcedBy, viewer.id), eq(applications.assignedOfficer, viewer.id))
  switch (viewer.scope) {
    case 'all':
      return undefined
    case 'team':
      return or(
        own,
        eq(applications.assignedRm, viewer.id),
        sql`${applications.sourcedBy} in (select ${users.id} from ${users} where ${users.managerId} = ${viewer.id})`
      )
    case 'own':
      return own
    default:
      // A role that no longer exists: nothing.
      return sql`false`
  }
}

/**
 * Everything that decides which applications `viewer` sees: their role's scope, then the
 * stages their role works on plus the cases they have worked on (visibility.js). Every list,
 * count and case lookup for staff goes through this. A where-clause, or undefined.
 */
export const scopeFor = async (viewer) => {
  const parts = [scopeApplications(viewer), await stageCondition(viewer)].filter(Boolean)
  return parts.length ? and(...parts) : undefined
}

/**
 * One application the viewer may see, or a 404 — never a 403, which would confirm it exists.
 * With `change`, for anything that changes the case: a 403 unless their role works on the
 * stage it is at (a case they only worked on before is theirs to read, not to change).
 */
export const findVisibleApplication = async (viewer, id, { change = false } = {}) => {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) fail(404, 'Application not found.', 'not_found')
  const db = await getDb()
  const scope = await scopeFor(viewer)
  const [row] = await db
    .select()
    .from(applications)
    .where(scope ? and(eq(applications.id, id), scope) : eq(applications.id, id))
    .limit(1)
  if (!row) fail(404, 'Application not found.', 'not_found')
  if (change && viewer.role !== 'admin' && viewer.role !== 'customer') {
    const { flow, state } = await caseWorkflow(row)
    if (!worksOnStage(viewer, state, flow.definition)) fail(403, 'This case is at a stage your role doesn’t work on.', 'read_only')
  }
  return row
}

export const actorLabel = (actor) => (actor ? actor.name : 'System')

/** Appends to a case timeline. `db` may be a transaction. */
export const addEvent = (db, { applicationId, actor, type, fromStatus = null, toStatus = null, message = null, detail = {}, visibleToCustomer = false }) =>
  db.insert(applicationEvents).values({
    applicationId,
    actorId: actor?.id ?? null,
    actorLabel: actorLabel(actor),
    type,
    fromStatus,
    toStatus,
    message,
    detail,
    visibleToCustomer,
  })

export const nextReference = async (db) => {
  const result = await db.execute(sql`select nextval('application_reference_seq') as n`)
  const n = Number((result.rows || result)[0].n)
  return `LOS-${new Date().getFullYear()}-${String(n).padStart(6, '0')}`
}

/** Display name for the applicant, from the wizard's data. */
export const applicantFromData = (loanType, data) => {
  if (loanType === 'personal') {
    const info = data?.personalInfo || {}
    return {
      name: [info.firstName, info.middleName, info.surname].filter(Boolean).join(' ').trim(),
      email: String(info.email || '').trim().toLowerCase(),
      phone: info.phone || null,
      companyName: null,
    }
  }
  const director = data?.directorInfo || {}
  return {
    name: [director.applicantFirstName, director.applicantMiddleName, director.applicantLastName].filter(Boolean).join(' ').trim(),
    email: String(director.applicantEmail || '').trim().toLowerCase(),
    phone: director.applicantPhone || null,
    companyName: data?.businessInfo?.companyName || null,
  }
}
