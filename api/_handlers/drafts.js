import { and, desc, eq } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import kv from '../_lib/kv.js'
import { getDb, schema } from '../_lib/db/client.js'
import { appOrigin, fail } from '../_lib/http.js'
import { requirePermission, requireUser } from '../_lib/rbac.js'
import { recordAudit } from '../_lib/audit.js'
import { generateToken } from '../_lib/token.js'
import { sendDraftReminderEmail } from '../_lib/email.js'
import { DRAFT_TTL_SECONDS, scopeDrafts, unindexDraft } from '../_lib/drafts.js'
import { LOAN_TYPE_LABELS } from '../../src/config/applications.js'
import { STEP_TITLES } from '../../src/config/applicationSteps.js'

const { applicationDrafts, users } = schema
const sourcer = alias(users, 'sourcer')

/*
 * Drafts for staff: the pipeline's first column. Everything here needs drafts.view and
 * stays within the viewer's scope (scopeDrafts), and a customer's own draft is only
 * listed once they agreed to be contacted about it.
 */

const REMINDER_GAP_MS = 24 * 60 * 60 * 1000

const toItem = ({ draft, sourcedByName }) => ({
  ...draft,
  sourcedByName: sourcedByName ?? null,
  nextStep: STEP_TITLES[draft.loanType]?.[draft.currentStep] || null,
})

const visibleDraft = async (viewer, id) => {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) fail(404, 'Draft not found.', 'not_found')
  const db = await getDb()
  const [row] = await db
    .select({ draft: applicationDrafts, sourcedByName: sourcer.name })
    .from(applicationDrafts)
    .leftJoin(sourcer, eq(sourcer.id, applicationDrafts.sourcedBy))
    .where(and(eq(applicationDrafts.id, id), scopeDrafts(viewer)))
    .limit(1)
  if (!row) fail(404, 'Draft not found.', 'not_found')
  // Redis holds the draft itself. If it has already expired there, so has the draft.
  const stored = await kv.get(`draft:${row.draft.email}`)
  if (!stored || stored.id !== row.draft.id) {
    await unindexDraft(row.draft.id)
    fail(404, 'This draft has expired or been submitted.', 'not_found')
  }
  return { row, stored }
}

const listDrafts = async (req) => {
  const viewer = await requireUser(req, { permission: 'drafts.view' })
  const db = await getDb()
  const rows = await db
    .select({ draft: applicationDrafts, sourcedByName: sourcer.name })
    .from(applicationDrafts)
    .leftJoin(sourcer, eq(sourcer.id, applicationDrafts.sourcedBy))
    .where(scopeDrafts(viewer))
    .orderBy(desc(applicationDrafts.lastSavedAt))
    .limit(200)
  const now = Date.now()
  return { drafts: rows.map(toItem).filter((item) => new Date(item.expiresAt).getTime() > now) }
}

/** One draft, with what has been entered so far, for a follow-up call. */
const getDraft = async (req, res, { params }) => {
  const viewer = await requireUser(req, { permission: 'drafts.view' })
  const { row, stored } = await visibleDraft(viewer, params.id)
  await recordAudit({ req, actor: viewer, action: 'draft.viewed', entityType: 'draft', entityId: row.draft.id, detail: { email: row.draft.email } })
  return {
    draft: toItem(row),
    data: row.draft.loanType === 'personal' ? stored.personalData || {} : stored.businessData || {},
    loanData: stored.loanData || {},
    documents: Object.entries(stored.documents || {}).map(([path, ref]) => ({ path, filename: ref?.filename || path })),
  }
}

/**
 * Continues a draft in the wizard, as when an agent sits down with the customer: returns a
 * draft token like the customer's own resume does (api/otp/verify.js). The customer still
 * confirms the submission with the code emailed to them.
 */
const resumeDraft = async (req, res, { params }) => {
  const viewer = await requireUser(req, { permission: 'drafts.view' })
  requirePermission(viewer, 'applications.assist', 'Your role can’t fill in applications for customers.')
  const { row, stored } = await visibleDraft(viewer, params.id)
  const draftToken = generateToken()
  await kv.set(`draftToken:${draftToken}`, row.draft.email, { ex: DRAFT_TTL_SECONDS })
  await recordAudit({ req, actor: viewer, action: 'draft.resumed', entityType: 'draft', entityId: row.draft.id, detail: { email: row.draft.email } })
  return { draftToken, draft: stored }
}

/** Emails the applicant a nudge to finish, at most once a day. */
const remindApplicant = async (req, res, { params }) => {
  const viewer = await requireUser(req, { permission: 'drafts.view' })
  const { row } = await visibleDraft(viewer, params.id)
  const draft = row.draft
  if (!draft.contactConsentAt && !draft.startedByStaff) fail(403, 'The applicant hasn’t agreed to be contacted about this draft.', 'no_consent')
  if (draft.remindedAt && Date.now() - new Date(draft.remindedAt).getTime() < REMINDER_GAP_MS) {
    fail(429, 'A reminder already went out in the last 24 hours.', 'recently_reminded')
  }
  try {
    await sendDraftReminderEmail(draft.email, {
      name: (draft.applicantName || '').split(' ')[0],
      product: (LOAN_TYPE_LABELS[draft.loanType] || 'loan').toLowerCase(),
      url: `${appOrigin(req)}/?resume=1`,
      staffName: viewer.name,
    })
  } catch (error) {
    console.warn(`[drafts] reminder not sent: ${error?.message}`)
    fail(502, 'The reminder couldn’t be emailed. Check the email settings and try again.', 'email_failed')
  }
  const db = await getDb()
  await db.update(applicationDrafts).set({ remindedAt: new Date() }).where(eq(applicationDrafts.id, draft.id))
  await recordAudit({ req, actor: viewer, action: 'draft.reminded', entityType: 'draft', entityId: draft.id, detail: { email: draft.email } })
  return { ok: true, remindedAt: new Date().toISOString() }
}

// After applicationRoutes, so GET /drafts/file (the wizard's own file download) keeps its handler.
export const draftRoutes = [
  ['GET', '/drafts', listDrafts],
  ['GET', '/drafts/:id', getDraft],
  ['POST', '/drafts/:id/resume', resumeDraft],
  ['POST', '/drafts/:id/remind', remindApplicant],
]
