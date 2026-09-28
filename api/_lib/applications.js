import { and, eq, or, sql } from 'drizzle-orm'
import { getDb, schema } from './db/client.js'
import { fail } from './http.js'

const { applications, applicationEvents, users } = schema

/**
 * Row-level visibility of applications — the one place it is defined.
 *
 *   admin, loan officer, sales manager   every application
 *   RM                                   assigned to them, sourced by them, or sourced by
 *                                        an agent who reports to them
 *   DSA                                  sourced by them
 *   customer                             their own (by account or by email)
 *
 * Returns a where-clause, or undefined for "no restriction".
 */
export const scopeApplications = (viewer) => {
  switch (viewer.role) {
    case 'admin':
    case 'loan_officer':
    case 'sales_manager':
      return undefined
    case 'rm':
      return or(
        eq(applications.assignedRm, viewer.id),
        eq(applications.sourcedBy, viewer.id),
        sql`${applications.sourcedBy} in (select ${users.id} from ${users} where ${users.managerId} = ${viewer.id})`
      )
    case 'dsa':
      return eq(applications.sourcedBy, viewer.id)
    case 'customer':
      return or(eq(applications.customerId, viewer.id), eq(applications.applicantEmail, viewer.email))
    default:
      // Unknown role: nothing.
      return sql`false`
  }
}

/** One application the viewer may see, or a 404 — never a 403, which would confirm it exists. */
export const findVisibleApplication = async (viewer, id) => {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) fail(404, 'Application not found.', 'not_found')
  const db = await getDb()
  const scope = scopeApplications(viewer)
  const [row] = await db
    .select()
    .from(applications)
    .where(scope ? and(eq(applications.id, id), scope) : eq(applications.id, id))
    .limit(1)
  if (!row) fail(404, 'Application not found.', 'not_found')
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
