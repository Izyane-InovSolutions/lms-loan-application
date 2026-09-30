import { and, desc, eq } from 'drizzle-orm'
import { getDb, schema } from './db/client.js'
import { putBlob, readBlob } from './blob.js'
import { getProductConfig } from './products.js'
import { getPublishedTemplate } from './templates.js'
import { fillUploadedPdf, renderTextTemplate, sha256 } from './pdf.js'
import { addEvent } from './applications.js'
import { LOAN_TYPE_LABELS, APPROVED_STATUSES } from '../../src/config/applications.js'
import { TEMPLATE_KINDS, TEMPLATE_KIND_KEYS } from '../../src/config/templates.js'
import { describeInterest, priceLoan } from '../../src/config/loanProducts.js'

const { applications, applicationDocuments, appraisals } = schema

/*
 * The offer letter and loan agreement for an approved loan, made from the published
 * templates (templates.js) and stored with the case as documents of source "system". Made
 * once per approval: right after the decision, or on first need (the customer opening the
 * offer, an older approval) if that did not happen. What the customer signs is exactly the
 * stored file, fingerprinted with SHA-256.
 */

export const LENDER_NAME = () => (process.env.LENDER_NAME || 'iZyane').trim()

const kwacha = (value) =>
  `K${Number(value || 0).toLocaleString('en-ZM', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const longDate = (value) =>
  value ? new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Lusaka' }) : ''

const phoneLabel = (value) => (value ? `+260 ${value}` : '')

/** The approval behind the offer: who decided it, and its conditions. */
const approvalOf = async (db, applicationId) => {
  const [row] = await db
    .select()
    .from(appraisals)
    .where(and(eq(appraisals.applicationId, applicationId), eq(appraisals.verdict, 'approve')))
    .orderBy(desc(appraisals.createdAt))
    .limit(1)
  return row || null
}

/** Every merge field (src/config/templates.js) for one application. */
export const mergeValuesFor = async (application) => {
  const db = await getDb()
  const approval = await approvalOf(db, application.id)
  const product = await getProductConfig(application.loanType)
  const amount = application.approvedAmount ?? application.amount
  const tenure = application.approvedTenure ?? application.tenure
  const price = product ? priceLoan(amount, tenure, product) : { interest: 0, fee: 0, total: application.totalRepayable, monthly: application.monthlyInstalment }
  const data = application.data || {}
  const personal = application.loanType === 'personal'
  const info = personal ? data.personalInfo || {} : data.directorInfo || {}
  return {
    customer_name: application.applicantName,
    customer_nrc: (personal ? info.nrc : info.applicantNrc) || '',
    customer_email: application.applicantEmail,
    customer_phone: phoneLabel(application.applicantPhone),
    customer_address: (personal ? data.employmentInfo?.residentialAddress : info.applicantAddress || data.businessInfo?.registeredOffice) || '',
    company_name: application.companyName || '',
    reference: application.reference,
    product: LOAN_TYPE_LABELS[application.loanType] || 'Loan',
    amount: kwacha(amount),
    tenure: `${tenure} ${tenure === 1 ? 'month' : 'months'}`,
    interest: product ? describeInterest(product) : '',
    interest_amount: kwacha(price.interest),
    facility_fee: kwacha(price.fee),
    total_repayable: kwacha(application.totalRepayable ?? price.total),
    monthly_instalment: kwacha(application.monthlyInstalment ?? price.monthly),
    conditions: approval?.conditions || 'None.',
    offer_expiry_date: application.offerExpiresAt ? longDate(application.offerExpiresAt) : 'the date we tell you',
    decision_date: longDate(application.decidedAt),
    approved_by: approval?.officerName || '',
    lender_name: LENDER_NAME(),
    today: longDate(new Date()),
  }
}

/** Renders a template (any version) with the given values. Returns the PDF and where a signature goes. */
export const renderTemplate = async (template, values) => {
  const footer = `${values.lender_name}   ·   ${values.reference}`
  if (template.source === 'pdf') {
    const stored = await readBlob({ pathname: template.pdfPathname, url: template.pdfUrl })
    if (!stored) throw new Error(`The uploaded ${TEMPLATE_KINDS[template.kind].label.toLowerCase()} is no longer in storage. Upload it again.`)
    return fillUploadedPdf(stored.data, {
      values,
      footer,
      summary: {
        title: `${TEMPLATE_KINDS[template.kind].label}: summary`,
        intro: `The terms of the loan offered under application ${values.reference}.`,
        rows: [
          ['Borrower', [values.customer_name, values.company_name].filter(Boolean).join(', ')],
          ['NRC', values.customer_nrc],
          ['Amount', values.amount],
          ['Tenure', values.tenure],
          ['Interest', `${values.interest} (${values.interest_amount})`],
          ['Facility fee', values.facility_fee],
          ['Total repayable', values.total_repayable],
          ['Monthly instalment', values.monthly_instalment],
          ['Conditions', values.conditions],
          ['Offer open until', values.offer_expiry_date],
        ],
      },
    })
  }
  return renderTextTemplate({ title: template.title, body: template.body, values, footer })
}

const slotFor = (kind) => `offer.${kind}`

/** The generated, unsigned documents of an application, by kind. */
export const offerDocumentsOf = async (applicationId) => {
  const db = await getDb()
  const rows = await db
    .select()
    .from(applicationDocuments)
    .where(and(eq(applicationDocuments.applicationId, applicationId), eq(applicationDocuments.source, 'system')))
    .orderBy(desc(applicationDocuments.createdAt))
  const latest = {}
  for (const row of rows) {
    const kind = row.meta?.kind
    if (!kind) continue
    const bucket = row.meta.signed ? 'signed' : 'unsigned'
    latest[kind] = latest[kind] || {}
    if (!latest[kind][bucket]) latest[kind][bucket] = row
  }
  return latest
}

/**
 * Makes the offer letter and agreement for an approved application if they don't exist
 * yet, and returns every kind's unsigned document. Never throws for a single failed kind:
 * the failure is logged on the case, and the next call tries again.
 */
// One generation per application at a time in this process: the approval's background
// run and a first page view arriving together must not both make the documents.
const inFlight = new Map()

export const ensureOfferDocuments = (applicationId) => {
  if (!inFlight.has(applicationId)) {
    inFlight.set(
      applicationId,
      generateMissing(applicationId).finally(() => inFlight.delete(applicationId))
    )
  }
  return inFlight.get(applicationId)
}

const generateMissing = async (applicationId) => {
  const db = await getDb()
  const [application] = await db.select().from(applications).where(eq(applications.id, applicationId)).limit(1)
  if (!application || !APPROVED_STATUSES.includes(application.status)) return {}
  const existing = await offerDocumentsOf(applicationId)
  const missing = TEMPLATE_KIND_KEYS.filter((kind) => !existing[kind]?.unsigned)
  if (!missing.length) return existing

  const values = await mergeValuesFor(application)
  for (const kind of missing) {
    try {
      const template = await getPublishedTemplate(kind)
      const { bytes, signatureSpots } = await renderTemplate(template, values)
      const label = TEMPLATE_KINDS[kind].label
      const filename = `${label.replace(/\s+/g, '-').toLowerCase()}-${application.reference}.pdf`
      const stored = await putBlob(`applications/${application.id}/${slotFor(kind)}-${filename}`, Buffer.from(bytes), { contentType: 'application/pdf' })
      await db.insert(applicationDocuments).values({
        applicationId: application.id,
        slot: slotFor(kind),
        docType: kind,
        label,
        pathname: stored.pathname,
        url: stored.url,
        filename,
        contentType: 'application/pdf',
        size: bytes.length,
        source: 'system',
        meta: { kind, templateVersion: template.version, templateSource: template.source, sha256: sha256(bytes), signed: false, signatureSpots },
      })
    } catch (error) {
      console.warn(`[offer documents] ${kind} for ${application.reference} not made: ${error?.message || error}`)
      await addEvent(db, { applicationId: application.id, actor: null, type: 'document', message: `The ${TEMPLATE_KINDS[kind].label.toLowerCase()} could not be generated: ${error?.message || error}` }).catch(() => {})
    }
  }
  return offerDocumentsOf(applicationId)
}
