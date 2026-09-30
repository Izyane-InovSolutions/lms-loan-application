import crypto from 'node:crypto'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { getDb, schema } from '../_lib/db/client.js'
import { fail } from '../_lib/http.js'
import { requireUser } from '../_lib/rbac.js'
import { recordAudit } from '../_lib/audit.js'
import { putBlob } from '../_lib/blob.js'
import { nextReference } from '../_lib/applications.js'
import { computeFacts } from '../_lib/prescreen/facts.js'
import { getPublishedRuleset, rulesetFlatRules } from '../_lib/prescreen/rulesets.js'
import { demoEnabled } from './auth.js'
import { DOCUMENT_SLOTS } from '../../src/config/applications.js'
import { evaluateRules } from '../../src/config/creditRules.js'
import { priceLoan } from '../../src/config/loanProducts.js'
import { CONSENT_NOTICES } from '../../src/config/consent.js'

/*
 * Sample applications for walkthroughs, only where demo sign-in is on. Every row is
 * marked `data.__demo`, uses @demo.los.local emails, and is removed by "Clear sample data".
 */

const { applications, applicationDocuments, applicationEvents, prescreens, appraisals, users, consents, locations } = schema

const FIRST = ['Chanda', 'Mwila', 'Bwalya', 'Mutale', 'Thandiwe', 'Kelvin', 'Natasha', 'Musonda', 'Chipo', 'Mulenga', 'Lweendo', 'Nkandu', 'Kasonde', 'Mapalo', 'Temwani', 'Chileshe', 'Mubanga', 'Namwinga', 'Kondwani', 'Luyando']
const LAST = ['Banda', 'Phiri', 'Mwale', 'Zulu', 'Tembo', 'Lungu', 'Mbewe', 'Sakala', 'Musonda', 'Chanda', 'Kalaba', 'Mumba', 'Daka', 'Ngoma', 'Sichone', 'Mwansa']
const EMPLOYERS = ['Zambia Sugar', 'ZESCO', 'Ministry of Health', 'Stanbic Bank', 'Copperbelt University', 'MTN Zambia', 'Shoprite', 'Lusaka City Council']
const COMPANIES = ['Kafue Agro Supplies', 'Chisokone Hardware', 'Mwinilunga Honey Co', 'Lusaka Fresh Foods', 'Copperbelt Logistics', 'Kabwe Print Works', 'Livingstone Tours', 'Ndola Auto Parts']
const TOWNS = [
  { name: 'Lusaka', lat: -15.4167, lng: 28.2833 },
  { name: 'Kitwe', lat: -12.8024, lng: 28.2132 },
  { name: 'Ndola', lat: -12.9587, lng: 28.6366 },
  { name: 'Kabwe', lat: -14.4469, lng: 28.4464 },
  { name: 'Livingstone', lat: -17.8419, lng: 25.8543 },
]

// Deterministic: the same demo every time, so a walkthrough can be rehearsed.
const rng = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296
  return seed / 4294967296
}

/** A one-page PDF saying it is a sample — a real file the viewer can open. */
const samplePdf = (title) => {
  const text = `Sample ${title} - demo data, not a real document`
  const stream = `BT /F1 18 Tf 60 760 Td (${text.replace(/[()\\]/g, '')}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let body = '%PDF-1.4\n'
  const offsets = objects.map((object, index) => {
    const offset = body.length
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
    return offset
  })
  const xref = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(body)
}

const STATUS_MIX = ['submitted', 'submitted', 'in_review', 'in_review', 'info_requested', 'pending_approval', 'approved', 'approved', 'approved', 'declined', 'disbursed']

const seed = async (req) => {
  if (!demoEnabled()) fail(403, 'Sample data is only available where demo access is on.', 'demo_disabled')
  const actor = await requireUser(req, { permission: 'settings.manage' })
  const db = await getDb()
  const random = rng(20260927)
  const pick = (list) => list[Math.floor(random() * list.length)]

  // Staff to attribute and decide cases: the demo users (created if missing).
  const ensure = async (role, name) => {
    const email = `demo.${role.replace('_', '-')}@demo.los.local`
    const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1)
    if (existing) return existing
    const [created] = await db.insert(users).values({ email, name, role, status: 'active', isDemo: true, referralCode: ['dsa', 'rm'].includes(role) ? `DEMO${role.toUpperCase()}` : null }).returning()
    return created
  }
  const rm = await ensure('rm', 'Chanda Lungu')
  const dsa = await ensure('dsa', 'Kelvin Mbewe')
  if (!dsa.managerId) await db.update(users).set({ managerId: rm.id }).where(eq(users.id, dsa.id))
  const officer = await ensure('loan_officer', 'Mwila Sakala')
  const approver = await ensure('admin', 'Natasha Kalaba')
  // A second agent under the same RM, so leaderboards have a comparison.
  const [secondAgent] = await db
    .insert(users)
    .values({ email: 'demo.dsa-2@demo.los.local', name: 'Grace Zulu', role: 'dsa', status: 'active', isDemo: true, managerId: rm.id, referralCode: 'DEMODSA2' })
    .onConflictDoNothing()
    .returning()
  const agents = [dsa, secondAgent || (await db.select().from(users).where(eq(users.email, 'demo.dsa-2@demo.los.local')))[0]]

  const files = {}
  for (const docType of [...new Set([...DOCUMENT_SLOTS.personal, ...DOCUMENT_SLOTS.business].map((slot) => slot.docType)), 'directorNrc', 'directorPassportPhoto']) {
    files[docType] = await putBlob(`demo/sample-${docType}.pdf`, samplePdf(docType), { contentType: 'application/pdf' })
  }

  const ruleset = await getPublishedRuleset()
  const rulesetRules = rulesetFlatRules(ruleset)
  const count = Math.min(120, Math.max(10, Number(req.body?.count) || 60))
  let created = 0

  for (let index = 0; index < count; index += 1) {
    const loanType = random() < 0.62 ? 'personal' : 'business'
    const first = pick(FIRST)
    const last = pick(LAST)
    const name = `${first} ${last}`
    const email = `${first}.${last}.${index}@demo.los.local`.toLowerCase()
    const town = pick(TOWNS)
    const daysAgo = Math.floor(random() * 58) + 1
    const submittedAt = new Date(Date.now() - daysAgo * 86400000 - Math.floor(random() * 36000000))
    const amount = loanType === 'personal' ? Math.round((2000 + random() * 38000) / 500) * 500 : Math.round((15000 + random() * 285000) / 1000) * 1000
    const tenure = pick([3, 6, 6, 12, 12, 18, 24])
    const status = daysAgo < 3 ? 'submitted' : pick(STATUS_MIX)
    const channelRoll = random()
    const sourcedBy = channelRoll < 0.45 ? null : channelRoll < 0.85 ? pick(agents) : rm
    const netPay = Math.round((3000 + random() * 22000) / 100) * 100
    const birthYear = 1966 + Math.floor(random() * 36)

    const data =
      loanType === 'personal'
        ? {
            __demo: true,
            personalInfo: { firstName: first, middleName: '', surname: last, phone: `97${String(1000000 + index * 7919).slice(0, 7)}`, email, nrc: `${String(100000 + index * 37).slice(0, 6)}/${String(10 + (index % 80))}/1`, gender: '', maritalStatus: '', birthDate: `${birthYear}-0${1 + (index % 9)}-15` },
            employmentInfo: { residentialAddress: `Plot ${100 + index}, ${town.name}`, occupation: pick(['Teacher', 'Nurse', 'Accountant', 'Engineer', 'Sales officer', 'Clerk']), employerName: pick(EMPLOYERS), nationality: 'Zambian', principalObjectiveOfLoan: pick(['School fees', 'Medical bills', 'Home improvement', 'Car repair']), nextOfKinName: `${pick(FIRST)} ${last}`, nextOfKinPhone: '971234567', nextOfKinEmail: `kin${index}@demo.los.local`, nextOfKinRelationship: 'Sibling' },
            documents: {},
          }
        : {
            __demo: true,
            businessInfo: { companyName: pick(COMPANIES), businessType: 'Private limited company', establishedDate: `${2008 + Math.floor(random() * 17)}-03-01`, natureOfBusiness: pick(['Retail', 'Agriculture', 'Transport', 'Printing', 'Tourism']), registeredOffice: `${town.name} CBD`, collateralPledged: pick(['Vehicle', 'Equipment', 'Title deed', 'Stock']), purposeOfLoan: pick(['Fund an order', 'Working capital', 'Buy equipment']) },
            directorInfo: { directors: [{ name, phone: '971234567', email, nrc: `${String(200000 + index * 41).slice(0, 6)}/11/1` }], applicantFirstName: first, applicantMiddleName: '', applicantLastName: last, applicantPhone: '971234567', applicantEmail: email, applicantNrc: `${String(200000 + index * 41).slice(0, 6)}/11/1`, applicantGender: '', applicantMaritalStatus: '', applicantBirthDate: `${birthYear}-06-01`, applicantAddress: `${town.name}`, applicantPosition: 'Director', applicantNationality: 'Zambian' },
            documents: {},
          }

    const id = crypto.randomUUID()
    const slots = [...DOCUMENT_SLOTS[loanType].map((slot) => ({ ...slot })), ...(loanType === 'business' ? [{ slot: 'director.0.nrc', label: 'Director 1 NRC', docType: 'directorNrc' }, { slot: 'director.0.passportPhoto', label: 'Director 1 passport photo', docType: 'directorPassportPhoto' }] : [])]
    const wrongDoc = random() < 0.08
    const documentRows = slots.map((slot) => ({
      applicationId: id,
      slot: slot.slot,
      docType: slot.docType,
      label: slot.label,
      pathname: files[slot.docType].pathname,
      url: files[slot.docType].url,
      filename: `${slot.slot}.pdf`,
      contentType: 'application/pdf',
      size: 700,
      source: 'applicant',
      aiAnalysis: slot.docType.toLowerCase().includes('photo')
        ? null
        : {
            sample: true,
            docType: slot.docType,
            detectedType: wrongDoc && slot.docType === 'bankStatements' ? 'utility bill' : slot.label.toLowerCase(),
            matchesExpectedType: !(wrongDoc && slot.docType === 'bankStatements'),
            legibility: random() < 0.07 ? 'partly_legible' : 'clear',
            extracted: {
              ...(slot.docType === 'payslips' ? { holderName: name, netPay: String(netPay), grossPay: String(Math.round(netPay * 1.35)) } : {}),
              ...(slot.docType === 'bankStatements' ? { holderName: loanType === 'personal' ? name : data.businessInfo.companyName, averageMonthlyCredits: String(Math.round(netPay * (loanType === 'personal' ? 1.1 : 9))) } : {}),
              ...(slot.docType === 'latestTaxComplianceReturn' ? { turnover: String(Math.round(amount * (1 + random() * 6))) } : {}),
              ...(slot.docType === 'orderOrInvoice' ? { amount: String(Math.round(amount * (0.7 + random() * 0.9))) } : {}),
            },
            issues: [],
            authenticityConcerns: random() < 0.04 ? ['Font on the totals line differs from the rest of the document.'] : [],
          },
    }))

    const decided = ['approved', 'declined', 'disbursed'].includes(status)
    const decidedAt = decided ? new Date(submittedAt.getTime() + (6 + random() * 90) * 3600000) : null
    const assignedOfficer = status === 'submitted' ? null : officer.id

    await db.transaction(async (tx) => {
      const reference = await nextReference(tx)
      await tx.insert(applications).values({
        id,
        reference,
        submissionKey: `demo-${id}`,
        loanType,
        status,
        applicantEmail: email,
        applicantName: name,
        applicantPhone: '971234567',
        companyName: loanType === 'business' ? data.businessInfo.companyName : null,
        amount,
        tenure,
        totalRepayable: priceLoan(amount, tenure).total,
        monthlyInstalment: priceLoan(amount, tenure).monthly,
        data,
        channel: sourcedBy ? sourcedBy.role : 'self',
        sourcedBy: sourcedBy?.id ?? null,
        assignedRm: sourcedBy ? (sourcedBy.role === 'rm' ? sourcedBy.id : rm.id) : null,
        assignedOfficer,
        referralCode: sourcedBy?.referralCode ?? null,
        checks: ['pending_approval', 'approved', 'accepted', 'disbursed'].includes(status)
          ? { identity: { done: true, note: 'NRC checked against photo', by: officer.name }, documents: { done: true, note: 'All present and current', by: officer.name }, income: { done: true, note: 'Payslips match bank credits', by: officer.name } }
          : {},
        infoRequest: status === 'info_requested' ? { message: 'Please upload your latest bank statement covering the last three months.', requestedBy: officer.name, requestedAt: new Date(submittedAt.getTime() + 86400000).toISOString() } : null,
        approvedAmount: ['approved', 'accepted', 'disbursed'].includes(status) ? amount : null,
        approvedTenure: ['approved', 'accepted', 'disbursed'].includes(status) ? tenure : null,
        offerExpiresAt: status === 'approved' ? new Date(Date.now() + 10 * 86400000) : null,
        acceptedAt: ['accepted', 'disbursed'].includes(status) && decidedAt ? new Date(decidedAt.getTime() + 86400000) : null,
        lmsSyncStatus: 'not_configured',
        submittedAt,
        decidedAt,
        createdAt: submittedAt,
        updatedAt: decidedAt || submittedAt,
      })
      await tx.insert(applicationDocuments).values(documentRows.map((row) => ({ ...row, createdAt: submittedAt })))
      const hasLocation = random() < 0.8
      await tx.insert(consents).values([
        { applicationId: id, type: 'data_processing', granted: true, noticeVersion: CONSENT_NOTICES.data_processing.version, method: sourcedBy ? 'customer_code' : 'applicant_checkbox', capturedBy: sourcedBy?.id ?? null, createdAt: submittedAt },
        { applicationId: id, type: 'crb', granted: random() < 0.7, noticeVersion: CONSENT_NOTICES.crb.version, method: sourcedBy ? 'customer_code' : 'applicant_checkbox', capturedBy: sourcedBy?.id ?? null, createdAt: submittedAt },
        { applicationId: id, type: 'location', granted: hasLocation, noticeVersion: CONSENT_NOTICES.location.version, method: sourcedBy ? 'customer_code' : 'applicant_checkbox', capturedBy: sourcedBy?.id ?? null, createdAt: submittedAt },
      ])
      if (hasLocation) {
        await tx.insert(locations).values({
          applicationId: id,
          source: sourcedBy ? 'field_visit' : 'applicant',
          latitude: Number((town.lat + (random() - 0.5) * 0.08).toFixed(6)),
          longitude: Number((town.lng + (random() - 0.5) * 0.08).toFixed(6)),
          accuracyMeters: 10 + Math.floor(random() * 60),
          note: sourcedBy ? 'Captured by the agent when submitting' : null,
          capturedBy: sourcedBy?.id ?? null,
          capturedByName: sourcedBy?.name ?? null,
          capturedAt: submittedAt,
        })
      }

      const application = { loanType, data, amount, tenure, monthlyInstalment: priceLoan(amount, tenure).monthly }
      const facts = computeFacts(application, documentRows, { locations: hasLocation ? [{}] : [] })
      const { outcome, results } = evaluateRules(rulesetRules, facts, loanType)
      await tx.insert(prescreens).values({
        applicationId: id,
        rulesetVersion: ruleset.version,
        facts,
        ruleResults: results,
        outcome,
        aiReview: {
          sample: true,
          recommendation: outcome === 'pass' ? 'proceed' : outcome === 'refer' ? 'review' : 'decline_likely',
          riskLevel: outcome === 'pass' ? 'low' : outcome === 'refer' ? 'medium' : 'high',
          summary:
            outcome === 'pass'
              ? 'Documents are complete and consistent, and the repayment is comfortably affordable on the stated income. Sample review.'
              : 'Some of the credit rules raised concerns that an officer should look at before deciding. Sample review.',
          flags: results.filter((result) => result.state === 'fired').map((result) => ({ category: 'other', severity: result.outcome === 'warn' ? 'low' : 'medium', detail: result.message })),
          missingInformation: [],
          applicantGuidance: [],
        },
        createdAt: submittedAt,
        updatedAt: submittedAt,
      })

      const event = (values) => tx.insert(applicationEvents).values({ applicationId: id, detail: {}, ...values })
      await event({ at: submittedAt, actorId: sourcedBy?.id ?? null, actorLabel: sourcedBy?.name || 'Applicant', type: 'status', toStatus: 'submitted', message: sourcedBy ? `Submitted by ${sourcedBy.name} on the customer’s behalf` : 'Application submitted', visibleToCustomer: true })
      await event({ at: new Date(submittedAt.getTime() + 60000), actorLabel: 'System', type: 'prescreen', message: `Policy rules v${ruleset.version}: ${outcome === 'pass' ? 'passed' : outcome === 'refer' ? 'refer to an officer' : 'decline recommended'}` })
      if (status !== 'submitted') {
        await event({ at: new Date(submittedAt.getTime() + 3 * 3600000), actorId: officer.id, actorLabel: officer.name, type: 'status', fromStatus: 'submitted', toStatus: 'in_review', message: 'Review started', visibleToCustomer: true })
      }
      if (status === 'info_requested') {
        await event({ at: new Date(submittedAt.getTime() + 86400000), actorId: officer.id, actorLabel: officer.name, type: 'info_request', fromStatus: 'in_review', toStatus: 'info_requested', message: 'Please upload your latest bank statement covering the last three months.', visibleToCustomer: true })
      }
      if (['pending_approval', 'approved', 'declined', 'disbursed'].includes(status)) {
        const verdict = status === 'declined' ? 'decline' : 'approve'
        const rationale = verdict === 'approve' ? 'Affordable on verified income; documents consistent.' : 'Repayment would exceed affordability on verified income.'
        const recommendedAt = decidedAt ? new Date((submittedAt.getTime() + decidedAt.getTime()) / 2) : new Date(submittedAt.getTime() + 2 * 86400000)
        await tx.insert(appraisals).values({ applicationId: id, kind: 'recommendation', verdict, amount: verdict === 'approve' ? amount : null, tenure: verdict === 'approve' ? tenure : null, rationale, officerId: officer.id, officerName: officer.name, createdAt: recommendedAt })
        await event({ at: recommendedAt, actorId: officer.id, actorLabel: officer.name, type: 'recommendation', fromStatus: 'in_review', toStatus: 'pending_approval', message: `Recommended ${verdict === 'approve' ? `approval of K${amount.toLocaleString()} over ${tenure} months` : 'decline'}: ${rationale}` })
        if (decided) {
          await tx.insert(appraisals).values({ applicationId: id, kind: 'decision', verdict, amount: verdict === 'approve' ? amount : null, tenure: verdict === 'approve' ? tenure : null, rationale: 'Agree with the recommendation.', officerId: approver.id, officerName: approver.name, createdAt: decidedAt })
          await event({ at: decidedAt, actorId: approver.id, actorLabel: approver.name, type: 'decision', fromStatus: 'pending_approval', toStatus: verdict === 'approve' ? 'approved' : 'declined', message: verdict === 'approve' ? `Approved K${amount.toLocaleString()} over ${tenure} months` : 'Declined: Agree with the recommendation.', detail: verdict === 'approve' ? {} : { customerMessage: 'We were not able to approve this application.' }, visibleToCustomer: true })
        }
        if (status === 'disbursed') {
          await event({ at: new Date(decidedAt.getTime() + 86400000), actorId: officer.id, actorLabel: officer.name, type: 'status', fromStatus: 'approved', toStatus: 'disbursed', message: 'Paid out', visibleToCustomer: true })
        }
      }
    })
    created += 1
  }

  await recordAudit({ req, actor, action: 'demo.seeded', detail: { applications: created } })
  return { created }
}

const clear = async (req) => {
  if (!demoEnabled()) fail(403, 'Sample data is only available where demo access is on.', 'demo_disabled')
  const actor = await requireUser(req, { permission: 'settings.manage' })
  const db = await getDb()
  const removed = await db.delete(applications).where(sql`${applications.data}->>'__demo' = 'true'`).returning({ id: applications.id })
  await db.delete(users).where(and(eq(users.isDemo, true), inArray(users.email, ['demo.dsa-2@demo.los.local'])))
  await recordAudit({ req, actor, action: 'demo.cleared', detail: { applications: removed.length } })
  return { removed: removed.length }
}

export const demoRoutes = [
  ['POST', '/demo/seed', seed],
  ['POST', '/demo/clear', clear],
]
