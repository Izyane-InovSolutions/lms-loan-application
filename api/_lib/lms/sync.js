import { and, eq, inArray, lt } from 'drizzle-orm'
import { getDb, schema } from '../db/client.js'
import { readBlob } from '../blob.js'
import { addEvent } from '../applications.js'
import { getSetting } from '../settings.js'
import { getLms, LmsError } from './index.js'
import { creditStaffIds, notifyUsers } from '../notify.js'
import { buildPersonalPayload, buildBusinessPayload } from '../../../src/utils/loanPayloadMapper.js'

const { applications, applicationDocuments, prescreens } = schema

// Cron retries clear failures this many times; after that a person has to look.
export const MAX_AUTOMATIC_ATTEMPTS = 3

const DIRECTOR_SLOT = /^director\.(\d+)\.(nrc|passportPhoto)$/

/** The Frappe payload for an application whose files are already uploaded (slot → file_url). */
const buildPayload = (application, fileUrls) => {
  const loanDetails = { amount: application.amount, tenure: application.tenure, totalAmount: application.totalRepayable }
  if (application.loanType === 'personal') {
    return buildPersonalPayload(application.data, fileUrls, loanDetails)
  }
  const uploaded = {}
  const directorUploaded = []
  Object.entries(fileUrls).forEach(([slot, url]) => {
    const director = DIRECTOR_SLOT.exec(slot)
    if (director) {
      const index = Number(director[1])
      directorUploaded[index] = { ...(directorUploaded[index] || {}), [director[2]]: url }
    } else {
      uploaded[slot] = url
    }
  })
  return buildBusinessPayload(application.data, uploaded, directorUploaded, loanDetails)
}

/**
 * Hands one application to the LMS. Safe to call repeatedly:
 *   - documents already uploaded keep their Frappe URL and are not sent again;
 *   - an application already synced, or in flight, is left alone;
 *   - when the create call gets no reply the outcome is unknown, so the case is marked
 *     `uncertain` and never retried automatically — someone checks the LMS first,
 *     because repeating it could file the loan twice.
 *
 * Returns the new sync status. Never throws for LMS problems; they are recorded.
 */
export const syncApplicationToLms = async (applicationId, { actor = null } = {}) => {
  const lms = await getLms()
  const db = await getDb()
  if (!lms) {
    await db.update(applications).set({ lmsSyncStatus: 'not_configured' }).where(eq(applications.id, applicationId))
    return 'not_configured'
  }

  // Claim the case: only one sync runs at a time, and only from a state that allows it.
  const [claimed] = await db
    .update(applications)
    .set({ lmsSyncStatus: 'sending', lmsError: null, updatedAt: new Date() })
    .where(and(eq(applications.id, applicationId), inArray(applications.lmsSyncStatus, ['pending', 'failed', 'not_configured'])))
    .returning()
  if (!claimed) return null

  try {
    // Duplicate guard: on any resend, ask the LMS whether it already has this application
    // (it carries our reference). If it does, record that instead of filing it again.
    if (claimed.lmsAttempts > 0) {
      const existing = await lms.findByReference(claimed.applicantEmail, claimed.reference).catch(() => null)
      if (existing) {
        await db
          .update(applications)
          .set({ lmsSyncStatus: 'synced', lmsReference: existing.name || null, lmsSyncedAt: new Date(), lmsError: null, updatedAt: new Date() })
          .where(eq(applications.id, applicationId))
        await addEvent(db, { applicationId, actor, type: 'lms', message: `Already in the LMS as ${existing.name || 'an existing record'}; not sent again` })
        return 'synced'
      }
    }

    const documents = await db.select().from(applicationDocuments).where(eq(applicationDocuments.applicationId, applicationId))
    const fileUrls = {}
    for (const document of documents) {
      if (!document.lmsFileUrl) {
        const stored = await readBlob(document)
        if (!stored) throw new LmsError(`The stored copy of "${document.label}" is missing.`)
        const lmsFileUrl = await lms.uploadFile({ data: stored.data, filename: document.filename, contentType: document.contentType })
        await db.update(applicationDocuments).set({ lmsFileUrl }).where(eq(applicationDocuments.id, document.id))
        document.lmsFileUrl = lmsFileUrl
      }
      fileUrls[document.slot] = document.lmsFileUrl
    }

    const payload = buildPayload(claimed, fileUrls)
    if (lms.referenceField) payload[lms.referenceField] = claimed.reference
    const { sendPrescreen } = await getSetting('lms')
    if (sendPrescreen) {
      const [prescreen] = await db.select().from(prescreens).where(eq(prescreens.applicationId, applicationId)).limit(1)
      if (prescreen) payload.ai_prescreening = JSON.stringify({ outcome: prescreen.outcome, rules: prescreen.ruleResults, review: prescreen.aiReview })
    }

    const { reference } = await lms.createApplication(payload)
    await db
      .update(applications)
      .set({ lmsSyncStatus: 'synced', lmsReference: reference, lmsSyncedAt: new Date(), lmsAttempts: claimed.lmsAttempts + 1, updatedAt: new Date() })
      .where(eq(applications.id, applicationId))
    await addEvent(db, { applicationId, actor, type: 'lms', message: reference ? `Sent to the LMS as ${reference}` : 'Sent to the LMS' })
    return 'synced'
  } catch (error) {
    const uncertain = error instanceof LmsError && error.uncertain
    const status = uncertain ? 'uncertain' : 'failed'
    const message = String(error?.message || error).slice(0, 500)
    console.warn(`[lms] sync ${status} for ${applicationId}: ${message}`)
    await db
      .update(applications)
      .set({ lmsSyncStatus: status, lmsError: message, lmsAttempts: claimed.lmsAttempts + 1, updatedAt: new Date() })
      .where(eq(applications.id, applicationId))
    await notifyUsers(await creditStaffIds(), {
      type: 'lms_problem',
      title: uncertain ? `${claimed.reference}: LMS receipt unconfirmed` : `${claimed.reference}: LMS hand-off failed`,
      body: uncertain ? 'Check the LMS before sending again.' : message,
      applicationId,
    }, { origin: process.env.APP_URL })
    await addEvent(db, {
      applicationId,
      actor,
      type: 'lms',
      message: uncertain
        ? 'The LMS did not confirm receipt. Check the LMS before sending again.'
        : `Sending to the LMS failed: ${message}`,
      detail: { status },
    })
    return status
  }
}

/** Queues a case for the LMS if the configured moment has come ('submit' or 'approval'). */
export const queueLmsSyncIfDue = async (application, moment) => {
  if (!(await getLms())) return false
  const { syncOn } = await getSetting('lms')
  if (syncOn !== moment) return false
  const db = await getDb()
  await db.update(applications).set({ lmsSyncStatus: 'pending' }).where(eq(applications.id, application.id))
  return true
}

/** Cron: pending cases, and clear failures under the attempt cap. */
export const retryDueSyncs = async () => {
  if (!(await getLms())) return { attempted: 0 }
  const db = await getDb()
  const due = await db
    .select({ id: applications.id })
    .from(applications)
    .where(
      inArray(applications.lmsSyncStatus, ['pending', 'failed'])
    )
    .limit(25)
  let attempted = 0
  for (const { id } of due) {
    const [row] = await db
      .select({ status: applications.lmsSyncStatus, attempts: applications.lmsAttempts })
      .from(applications)
      .where(eq(applications.id, id))
    if (row.status === 'failed' && row.attempts >= MAX_AUTOMATIC_ATTEMPTS) continue
    attempted += 1
    await syncApplicationToLms(id)
  }
  return { attempted }
}

/**
 * Cron: marks synced loans the LMS reports as paid out (status field and values set in
 * Settings → LMS connection) as disbursed here, so both systems agree.
 */
export const pullDisbursements = async () => {
  const lms = await getLms()
  if (!lms) return { checked: 0, disbursed: 0 }
  const db = await getDb()
  const candidates = await db
    .select()
    .from(applications)
    .where(and(eq(applications.lmsSyncStatus, 'synced'), inArray(applications.status, ['approved', 'accepted'])))
    .limit(50)
  let disbursed = 0
  for (const application of candidates) {
    const status = await lms.statusOf(application.applicantEmail, application.lmsReference, application.reference).catch(() => null)
    if (!status?.disbursed) continue
    await db.update(applications).set({ status: 'disbursed', updatedAt: new Date(), version: application.version + 1 }).where(eq(applications.id, application.id))
    await addEvent(db, { applicationId: application.id, actor: null, type: 'status', fromStatus: application.status, toStatus: 'disbursed', message: `Paid out, as reported by the LMS (${status.status})`, visibleToCustomer: true })
    disbursed += 1
  }
  return { checked: candidates.length, disbursed }
}

// Kept for the reconcile handler: a stuck 'sending' (the instance died mid-sync) becomes uncertain.
export const releaseStaleSends = async () => {
  const db = await getDb()
  await db
    .update(applications)
    .set({ lmsSyncStatus: 'uncertain', lmsError: 'The sync was interrupted. Check the LMS before sending again.' })
    .where(and(eq(applications.lmsSyncStatus, 'sending'), lt(applications.updatedAt, new Date(Date.now() - 15 * 60 * 1000))))
}
