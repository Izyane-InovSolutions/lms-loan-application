import { and, desc, eq, sql } from 'drizzle-orm'
import { getDb, schema } from './db/client.js'
import { text } from './http.js'
import { getSetting } from './settings.js'
import { getDraftWorkflow, getPublishedWorkflow } from './workflowVersions.js'
import { TEMPLATE_KINDS, TEMPLATE_KIND_KEYS, documentKindKey, starterTemplate } from '../../src/config/templates.js'

const { documentTemplates } = schema

/*
 * Document templates — the offer letter, the facility letter and the lender's own kinds —
 * versioned like the terms (legal.js): at most one draft (version 0) and one published
 * version per kind. Publishing retires the previous version but keeps it, so every
 * generated document can name the version it came from. A fresh workspace publishes the
 * starting wording below as version 1, flagged as a placeholder until the lender
 * publishes its own.
 */

// ---------------------------------------------------------------------------
// Document kinds: the two built in, and the lender's own (the `documents` setting)
// ---------------------------------------------------------------------------

const BUILT_IN_KINDS = TEMPLATE_KIND_KEYS.map((key) => ({ key, ...TEMPLATE_KINDS[key], requiresSignature: true, builtIn: true, retired: false }))

/** Every document kind, built-in first. Retired kinds only with `includeRetired` (their documents keep their names). */
export const listDocumentKinds = async ({ includeRetired = false } = {}) => {
  const { kinds = [] } = await getSetting('documents')
  const custom = kinds.map((kind) => ({ key: kind.key, label: kind.label, description: kind.description || '', requiresSignature: Boolean(kind.requiresSignature), builtIn: false, retired: Boolean(kind.retired) }))
  return [...BUILT_IN_KINDS, ...custom].filter((kind) => includeRetired || !kind.retired)
}

export const documentKind = async (key) => (await listDocumentKinds({ includeRetired: true })).find((kind) => kind.key === key) || null

/** The states of the published workflow and the draft that send `key`, by label. */
const statesSending = async (key) => {
  const [published, draft] = await Promise.all([getPublishedWorkflow(), getDraftWorkflow()])
  const states = [...(published?.definition?.states || []), ...(draft?.definition?.states || [])]
  return [...new Set(states.filter((state) => (state.documents || []).some((entry) => entry.kind === key)).map((state) => state.label))]
}

const MAX_KINDS = 30

/**
 * The `documents` setting from Settings → Documents. A kind keeps its key for good: it
 * can be renamed or retired, never removed, so documents already sent keep their meaning.
 * One the workflow still sends can't be retired.
 */
export const validateDocumentKinds = async (value) => {
  const stored = (await getSetting('documents')).kinds || []
  const keys = new Set(TEMPLATE_KIND_KEYS)
  const labels = new Set(BUILT_IN_KINDS.map((kind) => kind.label.toLowerCase()))
  const kinds = []
  for (const entry of (Array.isArray(value?.kinds) ? value.kinds : []).slice(0, MAX_KINDS)) {
    const label = text(entry?.label, 80).replace(/\s+/g, ' ')
    if (label.length < 2) throw new Error('Give each document a name of at least two characters.')
    if (labels.has(label.toLowerCase())) throw new Error(`There is already a document called “${label}”.`)
    labels.add(label.toLowerCase())
    // A new kind's key comes from its name; an existing one keeps its own.
    let key = stored.some((kind) => kind.key === entry?.key) ? entry.key : documentKindKey(entry?.key || label)
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(key)) key = `document_${key}`.slice(0, 40)
    const base = key
    for (let n = 2; keys.has(key); n += 1) key = `${base.slice(0, 36)}_${n}`
    keys.add(key)
    kinds.push({ key, label, description: text(entry?.description, 200), requiresSignature: Boolean(entry?.requiresSignature), retired: Boolean(entry?.retired) })
  }
  for (const old of stored) {
    if (!kinds.some((kind) => kind.key === old.key)) throw new Error(`“${old.label}” can’t be deleted once added. Retire it instead.`)
  }
  for (const kind of kinds.filter((entry) => entry.retired && !stored.find((old) => old.key === entry.key)?.retired)) {
    const states = await statesSending(kind.key)
    if (states.length) throw new Error(`“${kind.label}” is sent at ${states.map((label) => `“${label}”`).join(', ')} in the workflow. Take it off there before retiring it.`)
  }
  return { kinds }
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const PLACEHOLDERS = {
  offer_letter: {
    title: 'Loan offer',
    body: `{{today}}

{{customer_name}}
{{company_name}}
{{customer_address}}

Reference: {{reference}}

Dear {{customer_name}},

We are pleased to offer you a {{product}} on the terms below.

## The loan
- Amount: {{amount}}
- Tenure: {{tenure}}
- Interest: {{interest}} ({{interest_amount}})
- Facility fee: {{facility_fee}}
- Total repayable: {{total_repayable}}
- Monthly instalment: {{monthly_instalment}}

## Conditions
{{conditions}}

## Accepting this offer
This offer is open until {{offer_expiry_date}}. To accept it, sign in to your applications page, read this letter and the facility letter, and sign. Nothing is paid out until you do.

Yours sincerely,

{{approved_by}}
For {{lender_name}}`,
  },
  loan_agreement: {
    title: 'Facility letter',
    body: `{{today}}

{{customer_name}}
{{company_name}}
{{customer_address}}

Reference: {{reference}}

Dear {{customer_name}},

{{lender_name}} ("the Lender") is pleased to make available to you ("the Borrower") a {{product}} facility, as described below and on the terms and conditions of this letter.

## 1. The facility
- Borrower: {{customer_name}}, NRC {{customer_nrc}}
- Facility: {{product}}, a term loan
- Amount: {{amount}}
- Tenure: {{tenure}}
- Interest: {{interest}}, being {{interest_amount}} over the tenure
- Facility fee: {{facility_fee}}, deducted from the amount paid out
- Total repayable: {{total_repayable}}
- Repayment: monthly instalments of {{monthly_instalment}}

## 2. Conditions precedent
The facility is paid out only once the following are met to the Lender's satisfaction:
- This letter signed and returned by the Borrower.
- {{conditions}}

## 3. Repayment
- The Borrower repays each instalment in full on its due date, by the method agreed with the Lender.
- The Borrower may repay the facility early, in whole or in part, after telling the Lender, who confirms the amount to settle.
- A late instalment may attract the charges set out in the Lender's published tariff.

## 4. Representations
The Borrower confirms that the information and documents given in the application are true, complete and not misleading, and that nothing has changed since they were given.

## 5. Events of default
The Lender may demand repayment of everything outstanding at once if the Borrower:
- fails to pay any amount when it is due;
- gave information in the application that was untrue or misleading; or
- breaks any other term of this letter and does not put it right within 14 days of being asked to.

## 6. General
This letter is governed by the laws of the Republic of Zambia. The Borrower's information is used as described in the Lender's privacy notice.

## 7. Validity and acceptance
This offer of a facility is open until {{offer_expiry_date}}. If it is not accepted by then, it lapses. The Borrower accepts it by signing below.

Yours faithfully,

{{approved_by}}
For {{lender_name}}

## Acceptance by the Borrower
I have read and understood this facility letter and accept the facility on its terms and conditions.

{{customer_signature}}`,
  },
}

// The loan agreement's starting wording before it became a facility letter. A workspace
// whose published template is still exactly this gets the facility letter as a new version.
export const LEGACY_LOAN_AGREEMENT_BODY = `This agreement is between {{lender_name}} ("we") and {{customer_name}}, NRC {{customer_nrc}} ("you"), for application {{reference}}.

## 1. The loan
We lend you {{amount}} for {{tenure}}. Interest is {{interest}}, which comes to {{interest_amount}}, and the facility fee is {{facility_fee}}. You repay {{total_repayable}} in total, in monthly instalments of {{monthly_instalment}}.

## 2. Conditions
{{conditions}}

## 3. Repaying
- You agree to repay each instalment in full on its due date.
- You may repay early at any time. Tell us first so we can give you the amount to settle.
- If you expect to miss a payment, contact us straight away so we can discuss your options.

## 4. Your information
You confirm that the information and documents in your application are true and complete. We use them as described in our privacy notice.

## 5. Signing
You sign this agreement electronically. Your signature, the time, and a code sent to your email address are recorded with it.`

/** The starting wording of a kind: the built-in text, or the starter for one of the lender's own. */
const placeholderFor = async (kind) => {
  if (PLACEHOLDERS[kind]) return PLACEHOLDERS[kind]
  const meta = await documentKind(kind)
  if (!meta) throw new Error(`There is no document called “${kind}”.`)
  return starterTemplate(meta)
}

/** Whether a template is still the starting wording. `meta` is its kind, for the lender's own kinds. */
export const isPlaceholderTemplate = (template, meta = null) =>
  template?.source === 'text' && template.body === (PLACEHOLDERS[template.kind] || (meta ? starterTemplate(meta) : null))?.body

const isLegacyLoanAgreement = (template) => template.kind === 'loan_agreement' && template.source === 'text' && template.body === LEGACY_LOAN_AGREEMENT_BODY

/**
 * Publishes the facility letter as the next version over the old starting wording, once.
 * The old version is retired, not changed, so documents made from it still name it.
 */
const upgradeLegacyLoanAgreement = async (db, legacy) => {
  await db.transaction(async (tx) => {
    const retired = await tx
      .update(documentTemplates)
      .set({ status: 'retired', updatedAt: new Date() })
      .where(and(eq(documentTemplates.id, legacy.id), eq(documentTemplates.status, 'published')))
      .returning({ id: documentTemplates.id })
    // Another request upgraded it first.
    if (!retired.length) return
    const [{ max }] = await tx.select({ max: sql`coalesce(max(${documentTemplates.version}), 0)::int` }).from(documentTemplates).where(eq(documentTemplates.kind, legacy.kind))
    await tx.insert(documentTemplates).values({ kind: legacy.kind, version: max + 1, status: 'published', source: 'text', ...PLACEHOLDERS.loan_agreement, publishedAt: new Date() })
  })
  return getPublishedTemplate(legacy.kind)
}

/** The published template of a kind, publishing the starting wording on first use. */
export const getPublishedTemplate = async (kind) => {
  const db = await getDb()
  const [published] = await db
    .select()
    .from(documentTemplates)
    .where(and(eq(documentTemplates.kind, kind), eq(documentTemplates.status, 'published')))
    .orderBy(desc(documentTemplates.version))
    .limit(1)
  if (published && isLegacyLoanAgreement(published)) return upgradeLegacyLoanAgreement(db, published)
  if (published) return published
  const [created] = await db
    .insert(documentTemplates)
    .values({ kind, version: 1, status: 'published', source: 'text', ...(await placeholderFor(kind)), publishedAt: new Date() })
    .onConflictDoNothing()
    .returning()
  return created || getPublishedTemplate(kind)
}

export const getTemplateVersion = async (kind, version) => {
  const db = await getDb()
  const [row] = await db
    .select()
    .from(documentTemplates)
    .where(and(eq(documentTemplates.kind, kind), eq(documentTemplates.version, version)))
    .limit(1)
  return row || null
}

export const getDraftTemplate = (kind) => getTemplateVersion(kind, 0)

/** Saves the one draft of a kind: written text, or an uploaded PDF. */
export const saveTemplateDraft = async (kind, values, actor) => {
  const db = await getDb()
  const draft = await getDraftTemplate(kind)
  const row = {
    title: values.title,
    source: values.source,
    body: values.source === 'text' ? values.body : null,
    pdfPathname: values.source === 'pdf' ? values.pdfPathname : null,
    pdfUrl: values.source === 'pdf' ? values.pdfUrl : null,
    pdfFilename: values.source === 'pdf' ? values.pdfFilename : null,
    fields: values.source === 'pdf' ? values.fields || [] : [],
  }
  if (draft) {
    const [updated] = await db.update(documentTemplates).set({ ...row, updatedAt: new Date() }).where(eq(documentTemplates.id, draft.id)).returning()
    return updated
  }
  const [created] = await db.insert(documentTemplates).values({ kind, version: 0, status: 'draft', createdBy: actor?.id ?? null, ...row }).returning()
  return created
}

export const discardTemplateDraft = async (kind) => {
  const db = await getDb()
  const [removed] = await db.delete(documentTemplates).where(and(eq(documentTemplates.kind, kind), eq(documentTemplates.status, 'draft'))).returning()
  return removed || null
}

export const publishTemplateDraft = async (kind, actor) => {
  await getPublishedTemplate(kind)
  const db = await getDb()
  return db.transaction(async (tx) => {
    const [draft] = await tx.select().from(documentTemplates).where(and(eq(documentTemplates.kind, kind), eq(documentTemplates.status, 'draft'))).limit(1)
    if (!draft) return null
    const [{ max }] = await tx.select({ max: sql`coalesce(max(${documentTemplates.version}), 0)::int` }).from(documentTemplates).where(eq(documentTemplates.kind, kind))
    await tx.update(documentTemplates).set({ status: 'retired', updatedAt: new Date() }).where(and(eq(documentTemplates.kind, kind), eq(documentTemplates.status, 'published')))
    const [published] = await tx
      .update(documentTemplates)
      .set({ status: 'published', version: max + 1, publishedBy: actor?.id ?? null, publishedAt: new Date(), updatedAt: new Date() })
      .where(eq(documentTemplates.id, draft.id))
      .returning()
    return published
  })
}

export const templateHistory = async (kind) => {
  const db = await getDb()
  return db
    .select({ id: documentTemplates.id, version: documentTemplates.version, status: documentTemplates.status, source: documentTemplates.source, title: documentTemplates.title, publishedAt: documentTemplates.publishedAt })
    .from(documentTemplates)
    .where(and(eq(documentTemplates.kind, kind), sql`${documentTemplates.status} <> 'draft'`))
    .orderBy(desc(documentTemplates.version))
}
