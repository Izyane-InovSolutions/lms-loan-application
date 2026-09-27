import { getDb, schema } from './db/client.js'
import { clientIp } from './http.js'

/**
 * Appends to the audit trail. `actor` is the signed-in user, or null for the system and
 * for unauthenticated events (a failed sign-in). Keep `detail` free of secrets: it is
 * shown verbatim to administrators.
 */
export const recordAudit = async ({ req, actor, action, entityType = null, entityId = null, detail = {} }) => {
  const db = await getDb()
  await db.insert(schema.auditLog).values({
    actorId: actor?.id ?? null,
    actorLabel: actor ? `${actor.name} <${actor.email}>` : 'System',
    action,
    entityType,
    entityId: entityId == null ? null : String(entityId),
    detail,
    ip: req ? clientIp(req) : null,
  })
}
