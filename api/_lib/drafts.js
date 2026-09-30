import crypto from 'node:crypto'
import { and, eq, isNotNull, lt, or, sql } from 'drizzle-orm'
import { getDb, schema } from './db/client.js'
import { applicantFromData } from './applications.js'
import { STEP_SLUGS } from '../../src/config/applicationSteps.js'

const { applicationDrafts, users } = schema

/*
 * Unfinished applications as the workflow's first stage.
 *
 * The wizard saves each draft to Redis (api/draft), keyed by the applicant's email; that
 * record stays the source of truth for resuming. Every save also writes a summary row here
 * so the pipeline can list drafts, count them and follow them up. Indexing is best effort:
 * a database hiccup must never lose an applicant's save.
 */

export const DRAFT_TTL_SECONDS = 7 * 24 * 60 * 60

/** Gives a draft record its stable id, once. */
export const ensureDraftId = (draft) => {
  if (!draft.id) draft.id = crypto.randomUUID()
  return draft
}

const countDocuments = (draft) => Object.keys(draft.documents || {}).length

const toNumber = (value) => {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

/** The summary row for a draft record. */
export const summarizeDraft = (draft, email) => {
  const loanType = draft.loanType === 'business' ? 'business' : 'personal'
  const applicant = applicantFromData(loanType, loanType === 'personal' ? draft.personalData : draft.businessData)
  const attribution = draft.attribution || {}
  return {
    id: draft.id,
    email,
    loanType,
    applicantName: applicant.name || null,
    applicantPhone: applicant.phone || null,
    companyName: applicant.companyName || null,
    amount: toNumber(draft.loanData?.amount),
    tenure: Number.isInteger(Number(draft.loanData?.tenure)) && Number(draft.loanData?.tenure) > 0 ? Number(draft.loanData.tenure) : null,
    currentStep: Math.max(0, Number(draft.currentStep) || 0),
    stepCount: STEP_SLUGS[loanType].length,
    documentCount: countDocuments(draft),
    channel: attribution.channel || 'self',
    sourcedBy: attribution.sourcedBy || null,
    assignedRm: attribution.assignedRm || null,
    startedByStaff: Boolean(attribution.startedByStaff),
    contactConsentAt: draft.contactConsent?.at ? new Date(draft.contactConsent.at) : null,
    contactConsentVersion: draft.contactConsent?.version || null,
    lastSavedAt: new Date(draft.savedAt || Date.now()),
    expiresAt: new Date((draft.savedAt || Date.now()) + DRAFT_TTL_SECONDS * 1000),
  }
}

/** Writes or refreshes a draft's summary. Never throws. */
export const indexDraft = async (draft, email) => {
  if (!draft?.id || !email) return
  try {
    const row = summarizeDraft(draft, email)
    const db = await getDb()
    const { id, ...rest } = row
    await db
      .insert(applicationDrafts)
      .values(row)
      .onConflictDoUpdate({ target: applicationDrafts.id, set: { ...rest, updatedAt: new Date() } })
  } catch (error) {
    console.warn(`[drafts] summary not saved: ${error?.message || error}`)
  }
}

/** Removes a draft's summary: submitted, discarded or erased. Never throws. */
export const unindexDraft = async (id) => {
  if (!id) return
  try {
    const db = await getDb()
    await db.delete(applicationDrafts).where(eq(applicationDrafts.id, id))
  } catch (error) {
    console.warn(`[drafts] summary not removed: ${error?.message || error}`)
  }
}

/** Daily: summaries of drafts Redis has already let expire. */
export const purgeExpiredDraftSummaries = async () => {
  const db = await getDb()
  const removed = await db.delete(applicationDrafts).where(lt(applicationDrafts.expiresAt, new Date())).returning({ id: applicationDrafts.id })
  return removed.length
}

/**
 * Which drafts a staff member sees (`viewer` from getSessionUser). Drafts staff started are
 * listed as they are; a customer's own draft only once they agreed to be contacted about it.
 * Within that, the role's scope applies as it does to applications (applications.js).
 */
export const scopeDrafts = (viewer) => {
  const listable = or(eq(applicationDrafts.startedByStaff, true), isNotNull(applicationDrafts.contactConsentAt))
  const own = eq(applicationDrafts.sourcedBy, viewer.id)
  switch (viewer.scope) {
    case 'all':
      return listable
    case 'team':
      return and(
        listable,
        or(own, eq(applicationDrafts.assignedRm, viewer.id), sql`${applicationDrafts.sourcedBy} in (select ${users.id} from ${users} where ${users.managerId} = ${viewer.id})`)
      )
    case 'own':
      return and(listable, own)
    default:
      return sql`false`
  }
}
