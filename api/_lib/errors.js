import crypto from 'node:crypto'
import { sql } from 'drizzle-orm'
import { getDb, schema } from './db/client.js'

/*
 * The error log behind Admin → System health. Identical errors are grouped by a
 * fingerprint (source, message, route) and counted, so a flood of one failure stays one
 * row. Reporting never throws: if the database is the problem, the console still has it.
 */

const MAX_MESSAGE = 500
const MAX_STACK = 4000

// Numbers, ids and long hex vary between occurrences of the same bug; strip them so they group.
const normalise = (message) => String(message).replace(/[0-9a-f]{8,}|\d+/gi, '#').slice(0, 200)

export const reportError = async ({ source, message, stack = null, route = null, detail = {} }) => {
  const text = String(message || 'Unknown error').slice(0, MAX_MESSAGE)
  const fingerprint = crypto.createHash('sha1').update(`${source}|${normalise(text)}|${route || ''}`).digest('hex')
  try {
    const db = await getDb()
    await db
      .insert(schema.errorReports)
      .values({ fingerprint, source, message: text, stack: stack ? String(stack).slice(0, MAX_STACK) : null, route, detail })
      .onConflictDoUpdate({
        target: schema.errorReports.fingerprint,
        set: {
          count: sql`${schema.errorReports.count} + 1`,
          lastSeenAt: new Date(),
          message: text,
          stack: stack ? String(stack).slice(0, MAX_STACK) : null,
          // A recurrence reopens an error someone marked resolved.
          resolvedAt: null,
        },
      })
  } catch (error) {
    console.error(`[errors] could not record an error: ${error?.message}`)
  }
}
