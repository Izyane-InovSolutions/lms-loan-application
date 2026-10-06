import { desc, eq } from 'drizzle-orm'
import { getDb, schema } from '../db/client.js'
import { addEvent } from '../applications.js'
import { caseWorkflow, systemTransition } from '../workflow.js'
import { getSetting } from '../settings.js'
import { getAiProvider } from '../ai/index.js'
import { prescreenApplication } from '../ai/prescreen.js'
import { findFormMismatches } from '../../../src/utils/documentChecks.js'
import { evaluateRules } from '../../../src/config/creditRules.js'
import { computeFacts, expectedFor } from './facts.js'
import { getPublishedRuleset, rulesetFlatRules } from './rulesets.js'
import { addressDistance } from '../geo.js'
import { factReasons, factSources } from './reasons.js'
import { getCrb } from '../crb/index.js'

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
  const distance = await addressDistance(application, applicantPoint || null).catch(() => ({ km: null, gps: null, address: {}, reason: 'The distance couldn’t be worked out.' }))
  const facts = computeFacts(application, documents, { locations: points, crbScore: crb?.score ?? null, locationDistanceKm: distance.km, addressFound: distance.address?.found ?? null })
  const ruleset = await getPublishedRuleset()
  const { outcome, results: evaluated } = evaluateRules(rulesetFlatRules(ruleset), facts, application.loanType)
  // Each unknown fact says why, in words an officer can act on; each document figure says
  // where it came from (read by the AI, or entered by an officer).
  const reasons = factReasons(application, documents, facts, { aiOn: Boolean(await getAiProvider()), distance, crbProvider: Boolean(getCrb()) })
  const sources = factSources(application, facts)
  const results = evaluated.map((result) => ({
    ...result,
    ...(reasons[result.fact] && (result.state === 'not_evaluated' || result.operator === 'missing') ? { reason: reasons[result.fact] } : {}),
    ...(sources[result.fact] ? { source: sources[result.fact] } : {}),
  }))

  let aiReview = null
  let aiError = null
  if (await getAiProvider()) {
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

  // Kept with the facts (no column of their own): why each unknown one is unknown, and where each document figure came from.
  const values = { rulesetVersion: ruleset.version, facts: { ...facts, _notes: { reasons, sources, location: { gps: distance.gps, address: distance.address, km: distance.km } } }, ruleResults: results, outcome, aiReview, aiError, updatedAt: new Date() }
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
  // Only while nobody has picked the case up: the start state, at the version read here.
  if (autoDecline && outcome === 'decline' && application.status === 'submitted') {
    const [current] = await db.select().from(applications).where(eq(applications.id, applicationId)).limit(1)
    const { flow } = await caseWorkflow(current)
    await systemTransition(db, current, 'declined', {
      expectState: flow.definition.start,
      changes: { decidedAt: new Date() },
      event: { type: 'status', message: 'Declined automatically by the credit rules', visibleToCustomer: true },
    })
  }

  return stored
}
