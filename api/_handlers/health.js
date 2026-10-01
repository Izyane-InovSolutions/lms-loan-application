import crypto from 'node:crypto'
import { desc, eq, isNull, sql } from 'drizzle-orm'
import kv from '../_lib/kv.js'
import { getDb, schema } from '../_lib/db/client.js'
import { clientIp, fail, text } from '../_lib/http.js'
import { requireUser } from '../_lib/rbac.js'
import { reportError } from '../_lib/errors.js'
import { describeLms } from '../_lib/lms/index.js'
import { describeAi } from '../_lib/ai/index.js'
import { describeCrb } from '../_lib/crb/index.js'
import { getSms } from '../_lib/sms.js'
import { CRON_LAST_RUN_KEY, runDailyMaintenance } from '../_lib/maintenance.js'
import { appOrigin } from '../_lib/http.js'
import { recordAudit } from '../_lib/audit.js'
import { checkBlobStore } from '../_lib/blob.js'

const { errorReports } = schema


/** Public, rate-limited: errors from browsers, sent by the error handlers in the app. */
const clientError = async (req) => {
  const ip = clientIp(req) || 'unknown'
  const key = `los:client-errors:${crypto.createHash('sha256').update(ip).digest('hex')}`
  const count = await kv.incr(key)
  if (count === 1) await kv.expire(key, 60 * 60)
  if (count > 30) return { ok: true }
  const page = text(req.body?.url, 300).replace(/[?#].*$/, '')
  await reportError({
    source: 'browser',
    message: text(req.body?.message, 500) || 'Unknown browser error',
    stack: text(req.body?.stack, 4000) || null,
    route: page.replace(/^https?:\/\/[^/]+/, '').replace(/[0-9a-f-]{36}/gi, ':id') || null,
    detail: { userAgent: String(req.headers['user-agent'] || '').slice(0, 200) },
  })
  return { ok: true }
}

/** Admin → System health: connections, the daily job, and grouped errors. */
const health = async (req, res, { query }) => {
  await requireUser(req, { permission: 'system.health' })
  const db = await getDb()
  const showResolved = query.get('resolved') === '1'
  const started = Date.now()
  let database = { ok: true }
  try {
    await db.execute(sql`select 1`)
    database.milliseconds = Date.now() - started
  } catch (error) {
    database = { ok: false, message: error.message }
  }
  const [errors, [{ open }], lastCron, lms] = await Promise.all([
    db
      .select()
      .from(errorReports)
      .where(showResolved ? undefined : isNull(errorReports.resolvedAt))
      .orderBy(desc(errorReports.lastSeenAt))
      .limit(100),
    db.select({ open: sql`count(*)::int` }).from(errorReports).where(isNull(errorReports.resolvedAt)),
    // A store that is down shows as a failed check below, not as a broken page.
    Promise.resolve().then(() => kv.get(CRON_LAST_RUN_KEY)).catch(() => null),
    describeLms(),
  ])
  const redisOk = await Promise.resolve()
    .then(() => kv.exists('los:health:probe'))
    .then(() => true, () => false)
  return {
    checks: {
      database: { ...database, kind: process.env.DATABASE_URL ? 'postgres' : 'local' },
      storage: await checkBlobStore(),
      redis: { ok: redisOk, kind: process.env.REDIS_URL ? 'Redis' : process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL ? 'Upstash Redis' : 'local file' },
      email: { ok: Boolean(process.env.EMAIL_HOST && process.env.EMAIL_HOST_USER) },
      lms,
      ai: await describeAi().then(({ active, fallbacks }) => ({
        ok: Boolean(active),
        kind: active ? [active, ...fallbacks].map((entry) => `${entry.label} (${entry.model})`).join(', then ') : null,
      })),
      crb: describeCrb(),
      sms: { ok: Boolean(await getSms()) },
      virusScan: { ok: Boolean(process.env.CLAMAV_HOST) },
      secretsKey: { ok: Boolean(process.env.LOS_SECRETS_KEY) },
    },
    cron: lastCron || null,
    errors,
    openErrors: open,
  }
}

const resolveError = async (req, res, { params }) => {
  const actor = await requireUser(req, { permission: 'system.health' })
  const id = Number(params.id)
  if (!Number.isInteger(id)) fail(404, 'Not found.', 'not_found')
  const db = await getDb()
  await db.update(errorReports).set({ resolvedAt: new Date(), detail: sql`${errorReports.detail} || ${JSON.stringify({ resolvedBy: actor.name })}::jsonb` }).where(eq(errorReports.id, id))
  return { ok: true }
}

/** Runs the daily maintenance now (it otherwise runs on Vercel's cron). */
const runMaintenance = async (req) => {
  const actor = await requireUser(req, { permission: 'system.health' })
  const summary = await runDailyMaintenance(appOrigin(req))
  await recordAudit({ req, actor, action: 'system.maintenance_run', detail: summary })
  return summary
}

export const healthRoutes = [
  ['POST', '/admin/health/run-maintenance', runMaintenance],
  ['POST', '/client-errors', clientError],
  ['GET', '/admin/health', health],
  ['POST', '/admin/health/errors/:id/resolve', resolveError],
]
