import { gt } from 'drizzle-orm'
import kv from './kv.js'
import { blobFolderName, deleteBlobs, listBlobs } from './blob.js'
import { getDb, schema } from './db/client.js'
import { purgeExpiredSessions } from './auth/sessions.js'
import { DRAFT_TTL_SECONDS, purgeExpiredDraftSummaries } from './drafts.js'
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

  // Drafts Redis has let expire leave the pipeline too.
  let draftsExpired = null
  try {
    draftsExpired = await purgeExpiredDraftSummaries()
  } catch (error) {
    console.warn(`[cron] draft expiry skipped: ${error?.message || error}`)
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

  let files = null
  try {
    files = await sweepDraftFiles()
  } catch (error) {
    console.warn(`[cron] draft file sweep skipped: ${error?.message || error}`)
  }

  return finish({ scanned: files?.scanned ?? 0, deleted: files?.deleted ?? 0, sessionsPurged, draftsExpired, lms, offersExpired, retention, overdue })
}

/*
 * Files of drafts that expired out of Redis (stored files have no TTL). Draft files live
 * under drafts/<email>/, but with the email made path-safe ("ada+loans@…" is stored as
 * "ada-loans@…"), so a folder name is not always its draft's key. A file is kept while a
 * draft has that key, while an unexpired indexed draft's email maps to the folder, or
 * while it is younger than a draft can live: any one of them is enough.
 */
const sweepDraftFiles = async () => {
  const db = await getDb()
  const indexed = await db
    .select({ email: schema.applicationDrafts.email })
    .from(schema.applicationDrafts)
    .where(gt(schema.applicationDrafts.expiresAt, new Date()))
  const liveFolders = new Set(indexed.map(({ email }) => blobFolderName(email)))
  const oldest = Date.now() - DRAFT_TTL_SECONDS * 1000
  const draftExists = new Map()

  let scanned = 0
  let deleted = 0
  for await (const file of listBlobs('drafts/')) {
    scanned += 1
    const folder = file.pathname.split('/')[1]
    if (!folder || liveFolders.has(folder) || file.uploadedAt.getTime() > oldest) continue
    if (!draftExists.has(folder)) draftExists.set(folder, Boolean(await kv.exists(`draft:${folder}`)))
    if (draftExists.get(folder)) continue
    await deleteBlobs([file])
    deleted += 1
  }
  return { scanned, deleted }
}
