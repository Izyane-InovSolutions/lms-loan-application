import { and, desc, eq, sql } from 'drizzle-orm'
import { getDb, schema } from './db/client.js'
import { TEMPLATE_KIND_KEYS } from '../../src/config/templates.js'

const { documentTemplates } = schema

/*
 * Offer letter and loan agreement templates, versioned like the terms (legal.js): at most
 * one draft (version 0) and one published version per kind. Publishing retires the
 * previous version but keeps it, so every generated document can name the version it came
 * from. A fresh workspace publishes the starting wording below as version 1, flagged as a
 * placeholder until the lender publishes its own.
 */

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
This offer is open until {{offer_expiry_date}}. To accept it, sign in to your applications page, read this letter and the loan agreement, and sign. Nothing is paid out until you do.

Yours sincerely,

{{approved_by}}
For {{lender_name}}`,
  },
  loan_agreement: {
    title: 'Loan agreement',
    body: `This agreement is between {{lender_name}} ("we") and {{customer_name}}, NRC {{customer_nrc}} ("you"), for application {{reference}}.

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
You sign this agreement electronically. Your signature, the time, and a code sent to your email address are recorded with it.`,
  },
}

export const isPlaceholderTemplate = (template) =>
  template?.version === 1 && template.source === 'text' && template.body === PLACEHOLDERS[template.kind]?.body

export const assertTemplateKind = (kind) => TEMPLATE_KIND_KEYS.includes(kind)

/** The published template of a kind, publishing the starting wording on first use. */
export const getPublishedTemplate = async (kind) => {
  const db = await getDb()
  const [published] = await db
    .select()
    .from(documentTemplates)
    .where(and(eq(documentTemplates.kind, kind), eq(documentTemplates.status, 'published')))
    .orderBy(desc(documentTemplates.version))
    .limit(1)
  if (published) return published
  const [created] = await db
    .insert(documentTemplates)
    .values({ kind, version: 1, status: 'published', source: 'text', ...PLACEHOLDERS[kind], publishedAt: new Date() })
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
