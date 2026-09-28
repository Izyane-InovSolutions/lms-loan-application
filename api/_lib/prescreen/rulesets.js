import { desc, eq, sql } from 'drizzle-orm'
import { getDb, schema } from '../db/client.js'
import { DEFAULT_RULES } from '../../../src/config/creditRules.js'

const { rulesets } = schema

/**
 * The rules in force. A new database starts with the default policy as version 1, so
 * prescreening works before anyone has opened the rules editor.
 */
export const getPublishedRuleset = async () => {
  const db = await getDb()
  const [published] = await db.select().from(rulesets).where(eq(rulesets.status, 'published')).orderBy(desc(rulesets.version)).limit(1)
  if (published) return published
  const [created] = await db
    .insert(rulesets)
    .values({ version: 1, status: 'published', rules: DEFAULT_RULES, note: 'Default policy — replace the placeholder thresholds with your own.', publishedAt: new Date() })
    .onConflictDoNothing()
    .returning()
  // Lost a race with a parallel first run: read what the other one wrote.
  return created || (await db.select().from(rulesets).where(eq(rulesets.status, 'published')).limit(1))[0]
}

export const getDraftRuleset = async () => {
  const db = await getDb()
  const [draft] = await db.select().from(rulesets).where(eq(rulesets.status, 'draft')).limit(1)
  return draft || null
}

export const saveDraftRuleset = async (rules, note, actor) => {
  const db = await getDb()
  const draft = await getDraftRuleset()
  if (draft) {
    const [updated] = await db.update(rulesets).set({ rules, note, updatedAt: new Date() }).where(eq(rulesets.id, draft.id)).returning()
    return updated
  }
  const [created] = await db.insert(rulesets).values({ status: 'draft', rules, note, createdBy: actor.id }).returning()
  return created
}

/** Promotes the draft to the next version; the previous published set is archived. */
export const publishDraftRuleset = async (actor, note) => {
  const db = await getDb()
  return db.transaction(async (tx) => {
    const [draft] = await tx.select().from(rulesets).where(eq(rulesets.status, 'draft')).limit(1)
    if (!draft) return null
    const [{ max }] = await tx.select({ max: sql`coalesce(max(${rulesets.version}), 0)::int` }).from(rulesets)
    await tx.update(rulesets).set({ status: 'archived', updatedAt: new Date() }).where(eq(rulesets.status, 'published'))
    const [published] = await tx
      .update(rulesets)
      .set({ status: 'published', version: max + 1, note: note || draft.note, publishedBy: actor.id, publishedAt: new Date(), updatedAt: new Date() })
      .where(eq(rulesets.id, draft.id))
      .returning()
    return published
  })
}

export const listRulesetHistory = async () => {
  const db = await getDb()
  return db
    .select({ version: rulesets.version, status: rulesets.status, note: rulesets.note, publishedAt: rulesets.publishedAt, publishedBy: rulesets.publishedBy, ruleCount: sql`jsonb_array_length(${rulesets.rules})::int` })
    .from(rulesets)
    .where(sql`${rulesets.status} <> 'draft'`)
    .orderBy(desc(rulesets.version))
    .limit(30)
}
