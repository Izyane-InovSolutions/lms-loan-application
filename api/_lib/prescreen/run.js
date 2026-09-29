import { desc, eq } from 'drizzle-orm'
import { getDb, schema } from '../db/client.js'
import { addEvent } from '../applications.js'
import { getSetting } from '../settings.js'
import { getAiProvider } from '../ai/index.js'
import { prescreenApplication } from '../ai/prescreen.js'
import { findFormMismatches } from '../../../src/utils/documentChecks.js'
import { evaluateRules } from '../../../src/config/creditRules.js'
import { computeFacts, expectedFor } from './facts.js'
import { getPublishedRuleset, rulesetFlatRules } from './rulesets.js'
import { addressDistanceKm } from '../geo.js'

const { applications, applicationDocuments, prescreens, locations, crbReports } = schema

/** The inputs to computeFacts for one application, read fresh. */
export const loadFactInputs = async (applicationId) => {
  const db = await getDb()
  const [[application], documents, points, [crb]] = await Promise.all([
    db.select().from(applications).where(eq(applications.id, applicationId)),
    db.select().from(applicationDocuments).where(eq(applicationDocuments.applicationId, applicationId)),
    db.select().from(locations).where(eq(locations.applicationId, applicationId)),
    db.select().from(crbReports).where(eq(crbReports.applicationId, applicationId)).orderBy(desc(crbReports.createdAt)).limit(1),
  ])
  return { application, documents, points, crb }
}

/**
 * Prescreens one application: computes facts, applies the published credit rules, and —
 * when a model is configured — asks it to explain the result for the officer. The AI
 * never changes the outcome; the rules decide it.
 *
 * Re-running replaces the previous prescreen (after new documents, a CRB report, or new
 * rules). Returns the stored prescreen.
 */
export const runPrescreen = async (applicationId, { actor = null } = {}) => {
  const db = await getDb()
  const { application, documents, points, crb } = await loadFactInputs(applicationId)
  if (!application) return null

  const applicantPoint = points.find((point) => point.source === 'applicant') || points[0]
  const locationDistanceKm = applicantPoint ? await addressDistanceKm(application, applicantPoint).catch(() => null) : null
  const facts = computeFacts(application, documents, { locations: points, crbScore: crb?.score ?? null, locationDistanceKm })
  const ruleset = await getPublishedRuleset()
  const { outcome, results } = evaluateRules(rulesetFlatRules(ruleset), facts, application.loanType)

  let aiReview = null
  let aiError = null
  if (getAiProvider()) {
    try {
      aiReview = await prescreenApplication({
        loanType: application.loanType,
        applicant: application.data,
        loan: { amount: application.amount, tenure: application.tenure, monthlyInstalment: application.monthlyInstalment, totalRepayable: application.totalRepayable },
        documents: documents.map((document) => ({
          docType: document.docType,
          slot: document.label,
          required: true,
          attached: true,
          analysis: document.aiAnalysis,
          formMismatches: document.aiAnalysis ? findFormMismatches(document.aiAnalysis, expectedFor(application.loanType, application.data, document.slot)) : [],
        })),
        ruleResults: results.filter((result) => result.state !== 'passed'),
      })
    } catch (error) {
      aiError = String(error?.message || error).slice(0, 300)
      console.warn(`[prescreen] AI review failed for ${application.reference}: ${aiError}`)
    }
  }

  const values = { rulesetVersion: ruleset.version, facts, ruleResults: results, outcome, aiReview, aiError, updatedAt: new Date() }
  const [stored] = await db
    .insert(prescreens)
    .values({ applicationId, ...values })
    .onConflictDoUpdate({ target: prescreens.applicationId, set: values })
    .returning()

  const fired = results.filter((result) => result.state === 'fired')
  await addEvent(db, {
    applicationId,
    actor,
    type: 'prescreen',
    message: `Credit rules v${ruleset.version}: ${outcome === 'pass' ? 'passed' : outcome === 'refer' ? 'refer to an officer' : 'decline recommended'}${fired.length ? ` (${fired.length} ${fired.length === 1 ? 'concern' : 'concerns'})` : ''}`,
    detail: { outcome, rulesetVersion: ruleset.version },
  })

  // Automatic decline is an explicit administrator choice; by default a person decides.
  const { autoDecline } = await getSetting('prescreen')
  if (autoDecline && outcome === 'decline' && application.status === 'submitted') {
    await db.update(applications).set({ status: 'declined', decidedAt: new Date(), version: application.version + 1, updatedAt: new Date() }).where(eq(applications.id, applicationId))
    await addEvent(db, { applicationId, actor: null, type: 'status', fromStatus: 'submitted', toStatus: 'declined', message: 'Declined automatically by the credit rules', visibleToCustomer: true })
  }

  return stored
}
