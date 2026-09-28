import { and, desc, eq, gte, ilike, lt, lte, or, sql } from 'drizzle-orm'
import { getDb, schema } from '../_lib/db/client.js'
import { text } from '../_lib/http.js'
import { requireUser } from '../_lib/rbac.js'

const { auditLog } = schema

const PAGE_SIZE = 50

/**
 * Newest first, paged by id (`before` = the last id of the previous page) so new
 * entries arriving between requests never shift a page.
 */
const listAudit = async (req, res, { query }) => {
  await requireUser(req, { permission: 'audit.view' })
  const db = await getDb()

  const filters = []
  const action = text(query.get('action'), 100)
  const actorId = query.get('actor')
  const entity = text(query.get('entity'), 200)
  const search = text(query.get('q'), 100)
  const from = query.get('from')
  const to = query.get('to')
  const before = Number(query.get('before'))

  if (action) filters.push(action.endsWith('.') ? ilike(auditLog.action, `${action}%`) : eq(auditLog.action, action))
  if (actorId) filters.push(eq(auditLog.actorId, actorId))
  if (entity) {
    const [entityType, entityId] = entity.split(':')
    filters.push(eq(auditLog.entityType, entityType))
    if (entityId) filters.push(eq(auditLog.entityId, entityId))
  }
  if (search) {
    const pattern = `%${search.replace(/[%_\\]/g, '\\$&')}%`
    filters.push(or(ilike(auditLog.actorLabel, pattern), ilike(auditLog.action, pattern), ilike(auditLog.entityId, pattern)))
  }
  if (from && !Number.isNaN(Date.parse(from))) filters.push(gte(auditLog.at, new Date(from)))
  if (to && !Number.isNaN(Date.parse(to))) filters.push(lte(auditLog.at, new Date(to)))
  if (Number.isInteger(before) && before > 0) filters.push(lt(auditLog.id, before))

  const rows = await db
    .select()
    .from(auditLog)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(auditLog.id))
    .limit(PAGE_SIZE + 1)

  const hasMore = rows.length > PAGE_SIZE
  const entries = rows.slice(0, PAGE_SIZE)
  return { entries, nextCursor: hasMore ? entries[entries.length - 1].id : null }
}

/** Distinct actions, for the filter menu. */
const listAuditActions = async (req) => {
  await requireUser(req, { permission: 'audit.view' })
  const db = await getDb()
  const rows = await db
    .select({ action: auditLog.action, count: sql`count(*)::int` })
    .from(auditLog)
    .groupBy(auditLog.action)
    .orderBy(auditLog.action)
  return { actions: rows }
}

export const auditRoutes = [
  ['GET', '/audit', listAudit],
  ['GET', '/audit/actions', listAuditActions],
]
