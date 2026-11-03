import { and, desc, eq } from 'drizzle-orm'
import kv from '../kv.js'
import { getDb, schema } from '../db/client.js'
import { addEvent } from '../applications.js'
import { recordAudit } from '../audit.js'
import { reportError } from '../errors.js'
import { runPrescreen } from '../prescreen/run.js'
import { getSetting } from '../settings.js'
import { CrbError, getCrb, refreshCrb } from './index.js'
import { identityFor } from './identity.js'

const { consents, crbReports } = schema

/*
 * Pulling a credit bureau report for a case: by an officer (Run credit check), or on its own
 * as the application arrives, as part of pre-screening (Settings → Credit bureau, autoPull).
 * Only ever with the applicant's recorded consent, for the person the application is about;
 * each pull is kept, so the case shows every enquiry made.
 */

// Long enough to cover the bureau's timeout plus loading its WSDL.
const CRB_LOCK_SECONDS = 180
// Our own setup, not the bureau, is at fault for these.
const CRB_SETUP_CODES = new Set(['crb_not_configured', 'crb_contract_mismatch', 'crb_insecure_url'])

/** Why a pull didn't happen, with the HTTP status an officer's request answers with. */
export class CreditPullError extends Error {
  constructor(status, message, code) {
    super(message)
    this.status = status
    this.code = code
  }
}

const crbEventMessage = (crb, score, report, unchanged) => {
  if (crb.sample) return `Credit bureau score ${score} (sample data)`
  const headline =
    report.found === false
      ? `Credit bureau: no report for this NRC${report.responseCode === null || report.responseCode === undefined ? '' : ` (response code ${report.responseCode})`}`
      : `Credit bureau score ${score ?? 'not given'}${report.grade ? `, grade ${report.grade}` : ''}`
  const notes = [
    report.testIdentity && `bureau test identity ${report.testIdentity.nrc}, not the applicant`,
    unchanged && 'unchanged since the previous report',
    report.identity?.mismatch && 'the bureau returned a different NRC — check before relying on it',
  ]
  return [headline, ...notes.filter(Boolean)].join('; ')
}

/**
 * Pulls a report for `application` and runs the prescreen again (the score is a rule input).
 * `actor` is the officer, or null for the automatic pull. Throws CreditPullError when it
 * can't: no bureau, no consent, a pull already running, or the bureau's own failure.
 */
export const pullCreditReport = async (application, { actor = null, req = null } = {}) => {
  await refreshCrb({ force: true })
  const crb = getCrb()
  if (!crb) throw new CreditPullError(400, 'No credit bureau is connected.', 'crb_not_configured')
  const db = await getDb()
  const [consent] = await db
    .select()
    .from(consents)
    .where(and(eq(consents.applicationId, application.id), eq(consents.type, 'crb'), eq(consents.granted, true)))
    .limit(1)
  if (!consent) throw new CreditPullError(403, 'The applicant has not consented to a credit bureau check.', 'no_consent')
  let identity
  try {
    identity = identityFor(application)
  } catch (error) {
    // An NRC the bureau can't be asked about: said as the officer's request answers.
    throw new CreditPullError(error.status || 400, error.message, error.code || 'crb_identity')
  }

  // One pull at a time per case: a double click, or two officers at once, would
  // otherwise make two enquiries at the bureau.
  const lockKey = `los:crb-pull:${application.id}`
  if ((await kv.set(lockKey, actor?.id || 'system', { nx: true, ex: CRB_LOCK_SECONDS })) === null) {
    throw new CreditPullError(409, 'A credit report is already being pulled for this application. Try again in a moment.', 'crb_in_progress')
  }
  let pulled
  try {
    pulled = await crb.fetchReport(identity)
  } catch (error) {
    if (!(error instanceof CrbError)) throw error
    // Only our own wording is recorded: the bureau's reply may echo the applicant's details.
    const message = error.uncertain ? `${error.message} It may still have recorded the enquiry.` : error.message
    await addEvent(db, { applicationId: application.id, actor, type: 'crb', message: `${actor ? 'Credit' : 'Automatic credit'} bureau check failed: ${message}` })
    await recordAudit({ req, actor, action: 'application.crb_failed', entityType: 'application', entityId: application.id, detail: { provider: crb.name, code: error.code, uncertain: error.uncertain, automatic: !actor } })
    await reportError({ source: 'crb', message: `${error.code}: ${error.message}`, route: actor ? 'POST /applications/:id/crb' : 'automatic pull', detail: { provider: crb.name } })
    throw new CreditPullError(CRB_SETUP_CODES.has(error.code) ? 503 : 502, message, error.code)
  } finally {
    await kv.del(lockKey)
  }

  const { score, report } = pulled
  const [previous] = await db
    .select({ report: crbReports.report })
    .from(crbReports)
    .where(eq(crbReports.applicationId, application.id))
    .orderBy(desc(crbReports.createdAt))
    .limit(1)
  const unchanged = Boolean(report.fingerprint) && previous?.report?.fingerprint === report.fingerprint
  await db.transaction(async (tx) => {
    await tx.insert(crbReports).values({ applicationId: application.id, provider: crb.name, score, report, requestedBy: actor?.id ?? null })
    await addEvent(tx, { applicationId: application.id, actor, type: 'crb', message: `${actor ? '' : 'Pre-screening: '}${crbEventMessage(crb, score, report, unchanged)}` })
  })
  await recordAudit({
    req,
    actor,
    action: 'application.crb_checked',
    entityType: 'application',
    entityId: application.id,
    detail: { provider: crb.name, automatic: !actor, ...(report.requestNo ? { bureauRequest: report.requestNo } : {}), ...(report.identity?.mismatch ? { identityMismatch: true } : {}) },
  })
  await runPrescreen(application.id, actor ? { actor } : {})
  return { score, report }
}

/**
 * Pre-screening's credit check, as an application arrives: when the workspace has it on
 * (Settings → Credit bureau), a bureau is connected and the applicant consented. Never
 * fails the submission: a failure is on the case's timeline for an officer to retry.
 */
export const autoPullCreditReport = async (application) => {
  if ((await getSetting('crb')).autoPull === false) return null
  await refreshCrb()
  if (!getCrb()) return null
  try {
    return await pullCreditReport(application)
  } catch (error) {
    if (!(error instanceof CreditPullError)) throw error
    // The bureau's own failures are on the timeline already; say why nothing else was pulled.
    if (['no_consent', 'crb_in_progress'].includes(error.code)) return null
    if (!error.code?.startsWith('crb_') || error.code === 'crb_identity') {
      await addEvent(await getDb(), { applicationId: application.id, actor: null, type: 'crb', message: `Automatic credit bureau check skipped: ${error.message}` })
    }
    return null
  }
}
