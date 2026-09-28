import { list, del } from '@vercel/blob'
import kv from './kv.js'
import { purgeExpiredSessions } from './auth/sessions.js'
import { pullDisbursements, releaseStaleSends, retryDueSyncs } from './lms/sync.js'
import { expireOffers } from '../_handlers/workflow.js'
import { applyRetention } from './retention.js'
import { sendOverdueDigest } from './notify.js'

export const CRON_LAST_RUN_KEY = 'los:cron:last-run'

/*
 * The daily maintenance run: expired sessions and offers, the overdue digest, data
 * retention, LMS retries and payouts, and orphaned draft files (Blob objects have no TTL,
 * so files whose draft expired out of Redis are swept here). Each step is independent:
 * one failing does not stop the others. `origin` builds links in emails.
 */
export const runDailyMaintenance = async (origin) => {
  // What ran and when, for Admin → System health.
  const finish = async (summary) => {
    await kv.set(CRON_LAST_RUN_KEY, { at: new Date().toISOString(), ...summary }, { ex: 30 * 24 * 60 * 60 }).catch(() => {})
    return summary
  }

  // Signed-out and idle staff sessions are otherwise only removed when presented again.
  let sessionsPurged = true
  try {
    await purgeExpiredSessions()
  } catch (error) {
    sessionsPurged = false
    console.warn(`[cron] session purge skipped: ${error?.message || error}`)
  }

  // Offers the customer did not accept in time lapse.
  let offersExpired = null
  try {
    offersExpired = await expireOffers(origin)
  } catch (error) {
    console.warn(`[cron] offer expiry skipped: ${error?.message || error}`)
  }

  // One daily nudge about cases past the decision target.
  let overdue = null
  try {
    overdue = await sendOverdueDigest({ origin: origin })
  } catch (error) {
    console.warn(`[cron] overdue digest skipped: ${error?.message || error}`)
  }

  // Closed applications past their retention period are deleted with their files.
  let retention = null
  try {
    retention = await applyRetention()
  } catch (error) {
    console.warn(`[cron] retention skipped: ${error?.message || error}`)
  }

  // LMS hand-offs: interrupted sends become "uncertain" (a person checks), and queued or
  // clearly failed ones are tried again, up to the attempt cap.
  let lms = null
  try {
    await releaseStaleSends()
    lms = { ...(await retryDueSyncs()), ...(await pullDisbursements()) }
  } catch (error) {
    console.warn(`[cron] LMS retry skipped: ${error?.message || error}`)
  }

  // Nothing to sweep when no Blob store is linked (local runs, or a deployment before
  // the store is attached) — and `list` would throw on the missing token.
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return finish({ scanned: 0, deleted: 0, sessionsPurged, lms, offersExpired, retention, overdue, skipped: 'no blob store configured' })
  }

  let cursor
  let deleted = 0
  let scanned = 0

  do {
    const page = await list({ prefix: 'drafts/', cursor, limit: 1000 })
    cursor = page.cursor

    for (const blob of page.blobs) {
      scanned += 1
      const email = blob.pathname.split('/')[1]
      if (!email) continue
      const draftExists = await kv.exists(`draft:${email}`)
      if (!draftExists) {
        await del(blob.url)
        deleted += 1
      }
    }
  } while (cursor)

  return finish({ scanned, deleted, sessionsPurged, lms, offersExpired, retention, overdue })
}
