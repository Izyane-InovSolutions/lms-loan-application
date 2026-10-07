import { eq, sql } from 'drizzle-orm'
import { getDb, schema } from '../db/client.js'
import { addEvent } from '../applications.js'
import { createZraClient, missingZraConfig, ZraError } from './client.js'
import { getZraConfig } from './config.js'
import { companiesMatch, namesMatch } from '../../../src/utils/documentChecks.js'

const { applications, applicationDocuments } = schema

const digits = (value) => String(value || '').replace(/\D/g, '')

/**
 * What is sent to ZRA for an application: a personal loan by the applicant's NRC, a
 * business loan by the company's TPIN. Nothing else is ever looked up.
 */
export const zraIdentifierFor = (application) => {
  const data = application.data || {}
  if (application.loanType === 'personal') {
    const nrc = data.personalInfo?.nrc?.trim()
    return nrc ? { lookupType: 'NRC', lookupValue: nrc } : null
  }
  const tpin = digits(data.businessInfo?.tpin)
  return tpin ? { lookupType: 'TPIN', lookupValue: tpin } : null
}

/** Who the application says the taxpayer is: the applicant, or the company. */
const declaredName = (application) => {
  const data = application.data || {}
  if (application.loanType === 'business') return data.businessInfo?.companyName || application.companyName || ''
  const info = data.personalInfo || {}
  return [info.firstName, info.middleName, info.surname].filter(Boolean).join(' ') || application.applicantName
}

/**
 * Checks the applicant with ZRA after submission, out of the applicant's sight, and keeps
 * the result on the case for staff (`checks.zra`). Personal loans are looked up by NRC,
 * business loans by TPIN. The TPIN ZRA returns is also compared with the one printed on
 * the uploaded TPIN or tax documents.
 *
 * Advisory only: it never blocks or changes the application. Does nothing when no ZRA
 * connection is set up (Settings → Integrations).
 */
export const verifyApplicationWithZra = async (applicationId, { clientFactory = createZraClient } = {}) => {
  const { config } = await getZraConfig()
  if (missingZraConfig(config).length) return null

  const db = await getDb()
  const [application] = await db.select().from(applications).where(eq(applications.id, applicationId)).limit(1)
  if (!application) return null
  const identifier = zraIdentifierFor(application)
  if (!identifier) return null

  let result
  try {
    const lookup = await clientFactory({ config }).lookup(identifier.lookupType, identifier.lookupValue)
    if (!lookup.found) {
      result = { status: 'not_found' }
    } else {
      const { taxpayer } = lookup
      const name = declaredName(application)
      const nameMatches = application.loanType === 'business' ? companiesMatch(name, taxpayer.name) : namesMatch(name, taxpayer.name)

      // The TPIN on the uploaded ZRA documents should be the one ZRA holds.
      const documents = await db.select().from(applicationDocuments).where(eq(applicationDocuments.applicationId, applicationId))
      const printed = documents
        .map((document) => ({ slot: document.slot, label: document.label, tpin: document.aiAnalysis?.extracted?.tpinNumber }))
        .filter((document) => document.tpin)
      const documentMismatches = printed.filter((document) => digits(document.tpin) !== digits(taxpayer.tpin)).map(({ slot, label, tpin }) => ({ slot, label, tpin }))

      result = {
        status: nameMatches && !documentMismatches.length ? 'verified' : 'mismatch',
        tpin: taxpayer.tpin,
        name: taxpayer.name,
        nameMatches,
        documentMismatches,
      }
    }
  } catch (error) {
    if (!(error instanceof ZraError)) throw error
    result = { status: 'unavailable', reason: error.code }
  }

  const stored = { ...result, lookupType: identifier.lookupType, at: new Date().toISOString() }
  // Merged into the column so an officer's checklist ticks made meanwhile are kept.
  await db
    .update(applications)
    .set({ checks: sql`coalesce(${applications.checks}, '{}'::jsonb) || ${JSON.stringify({ zra: stored })}::jsonb` })
    .where(eq(applications.id, applicationId))
  await addEvent(db, {
    applicationId,
    actor: null,
    type: 'zra',
    message: ZRA_MESSAGES[stored.status](stored),
    detail: { status: stored.status, lookupType: stored.lookupType },
  })
  return stored
}

export const ZRA_MESSAGES = {
  verified: (zra) => `ZRA verified the ${zra.lookupType} (TPIN ${zra.tpin}, ${zra.name})`,
  mismatch: (zra) =>
    `ZRA found ${zra.name} (TPIN ${zra.tpin}), but ${[!zra.nameMatches && 'the name differs from the application', zra.documentMismatches?.length && 'the TPIN on the documents differs'].filter(Boolean).join(' and ')}`,
  not_found: (zra) => `ZRA has no taxpayer with this ${zra.lookupType}`,
  unavailable: () => 'The ZRA check could not run; verify the taxpayer manually',
}
