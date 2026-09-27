import { and, desc, eq, sql } from 'drizzle-orm'
import { getDb, schema } from './db/client.js'

const { legalDocuments } = schema

export const LEGAL_KINDS = ['terms', 'privacy']

/*
 * Starting text, published as version 1 on a fresh database so applicants always see
 * something coherent. It is deliberately generic and flagged as a placeholder in the
 * workspace until the lender publishes its own approved wording.
 */
const PLACEHOLDERS = {
  terms: {
    title: 'Loan terms and conditions',
    body: `These terms apply to your application and to any loan offered to you.

## Your application
- The information and documents you give must be true and complete. Giving false information may lead to your application being declined or any loan being recalled.
- Submitting an application does not mean it will be approved. We assess every application against our lending policy.

## If we make you an offer
- The offer states the amount, tenure, interest, facility fee, total repayable and monthly instalment. Nothing is paid out until you accept it.
- The offer lapses if you do not accept it within the time stated.

## Repayment
- You agree to repay the total amount in the monthly instalments shown in your offer, on the dates agreed.
- Tell us straight away if you expect to have difficulty repaying, so we can discuss your options.

## Contact
- We will contact you about your application by email, and by phone or text message where you have given a number.`,
  },
  privacy: {
    title: 'How we use your information',
    body: `We use the information and documents in your application to assess it, verify your identity and income, prevent fraud, and manage any loan that follows.

## Who sees it
- Only staff who work on your application can see it, and every time they open it is recorded.
- If your loan goes ahead, your details are passed to our loan management system.

## Automated checks
- Your documents are checked automatically for completeness and consistency, and your application is checked against our lending policy. A person makes the final decision.

## How long we keep it
- Applications that do not go ahead are deleted after a set period. Loan records are kept as the law requires.

## Your rights
- You can ask for a copy of the information we hold about you, or ask us to correct or delete it, as the Data Protection Act allows.`,
  },
}

export const isPlaceholder = (document) => document?.version === 1 && document.body === PLACEHOLDERS[document.kind]?.body

/** The published document of a kind, creating the placeholder version 1 on first use. */
export const getPublishedLegal = async (kind) => {
  const db = await getDb()
  const [published] = await db
    .select()
    .from(legalDocuments)
    .where(and(eq(legalDocuments.kind, kind), eq(legalDocuments.status, 'published')))
    .orderBy(desc(legalDocuments.version))
    .limit(1)
  if (published) return published
  const [created] = await db
    .insert(legalDocuments)
    .values({ kind, version: 1, status: 'published', ...PLACEHOLDERS[kind], publishedAt: new Date() })
    .onConflictDoNothing()
    .returning()
  // Lost a race with a parallel first read: return what the other request wrote.
  return created || getPublishedLegal(kind)
}

export const getDraftLegal = async (kind) => {
  const db = await getDb()
  const [draft] = await db
    .select()
    .from(legalDocuments)
    .where(and(eq(legalDocuments.kind, kind), eq(legalDocuments.status, 'draft')))
    .limit(1)
  return draft || null
}

export const saveLegalDraft = async (kind, { title, body }) => {
  const db = await getDb()
  const draft = await getDraftLegal(kind)
  if (draft) {
    const [updated] = await db.update(legalDocuments).set({ title, body, updatedAt: new Date() }).where(eq(legalDocuments.id, draft.id)).returning()
    return updated
  }
  const [created] = await db.insert(legalDocuments).values({ kind, status: 'draft', title, body }).returning()
  return created
}

export const discardLegalDraft = async (kind) => {
  const db = await getDb()
  await db.delete(legalDocuments).where(and(eq(legalDocuments.kind, kind), eq(legalDocuments.status, 'draft')))
}

export const publishLegalDraft = async (kind, actor) => {
  const db = await getDb()
  await getPublishedLegal(kind)
  return db.transaction(async (tx) => {
    const [draft] = await tx.select().from(legalDocuments).where(and(eq(legalDocuments.kind, kind), eq(legalDocuments.status, 'draft'))).limit(1)
    if (!draft) return null
    const [{ max }] = await tx.select({ max: sql`coalesce(max(${legalDocuments.version}), 0)::int` }).from(legalDocuments).where(eq(legalDocuments.kind, kind))
    await tx.update(legalDocuments).set({ status: 'archived', updatedAt: new Date() }).where(and(eq(legalDocuments.kind, kind), eq(legalDocuments.status, 'published')))
    const [published] = await tx
      .update(legalDocuments)
      .set({ status: 'published', version: max + 1, publishedBy: actor.id, publishedAt: new Date(), updatedAt: new Date() })
      .where(eq(legalDocuments.id, draft.id))
      .returning()
    return published
  })
}

export const legalHistory = async (kind) => {
  const db = await getDb()
  return db
    .select({ id: legalDocuments.id, version: legalDocuments.version, status: legalDocuments.status, title: legalDocuments.title, publishedAt: legalDocuments.publishedAt })
    .from(legalDocuments)
    .where(and(eq(legalDocuments.kind, kind), sql`${legalDocuments.status} <> 'draft'`))
    .orderBy(desc(legalDocuments.version))
}

/** What a data-processing consent records: the exact versions shown, e.g. "terms-v3+privacy-v2". */
export const currentConsentVersion = async () => {
  const [terms, privacy] = await Promise.all([getPublishedLegal('terms'), getPublishedLegal('privacy')])
  return `terms-v${terms.version}+privacy-v${privacy.version}`
}
