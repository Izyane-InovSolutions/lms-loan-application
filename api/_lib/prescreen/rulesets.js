import { desc, eq, sql } from 'drizzle-orm'
import { getDb, schema } from '../db/client.js'
import { DEFAULT_POLICIES, countPolicyRules, flattenPolicies, isEligibilityRule, rulesToPolicies } from '../../../src/config/creditRules.js'
import { FORMER_STANDARD_MIN_INCOME, buildProducts, liveProducts } from '../../../src/config/loanProducts.js'
import { getSetting, setSetting } from '../settings.js'
import { DEFAULT_ELIGIBILITY_RULES, policyEligibilityRules, rulesetEligibility } from '../../../src/config/productEligibility.js'

const { rulesets } = schema

/** A stored ruleset's policies (adapts legacy flat-rule rows to the policies shape). */
export const rulesetPolicies = (ruleset) => rulesToPolicies(ruleset?.rules)

/**
 * Everything that decides which loans an applicant qualifies for (productEligibility.js):
 * the Product eligibility requirements, and the policies' "Not eligible for…" rules.
 */
export const rulesetEligibilityRules = (ruleset) => [...rulesetEligibility(ruleset?.rules), ...policyEligibilityRules(rulesToPolicies(ruleset?.rules))]

/** A stored ruleset flattened to the plain rule list the engine evaluates. */
export const rulesetFlatRules = (ruleset) => flattenPolicies(rulesetPolicies(ruleset))

let movedMinimums = false

/**
 * A product's minimum income was once set on the product (Settings → Loan products); the
 * policies' "Not eligible for…" rules decide that now. Once per process: every product with
 * a minimum that no such rule names gets one in its form's policy — "Net monthly pay is less
 * than K5,000 → not eligible for Vehicle Loan" — published as the next version, and the
 * product's own minimum is cleared, so there is one place it is set.
 */
const moveProductMinimums = async (published) => {
  const stored = await getSetting('products')
  const products = liveProducts(buildProducts(stored))
  const policies = rulesToPolicies(published.rules)
  const named = new Set(flattenPolicies(policies).filter(isEligibilityRule).flatMap((rule) => rule.products || []))
  // Each product's minimum: its own, else (a standard product never saved) the one it came with.
  const minimums = products
    .map((product) => ({ product, minimum: Number(product.eligibility?.minIncome) || (stored[product.id]?.eligibility?.minIncome === undefined ? FORMER_STANDARD_MIN_INCOME[product.id] : null) }))
    .filter(({ product, minimum }) => minimum > 0 && !named.has(product.id))
  const cleared = products.filter((product) => Number(product.eligibility?.minIncome) > 0)
  if (!minimums.length && !cleared.length) return published

  let next = published
  if (minimums.length) {
    const bands = new Map()
    for (const { product, minimum } of minimums) {
      const key = `${product.form}:${minimum}`
      if (!bands.has(key)) bands.set(key, { form: product.form, minimum, products: [] })
      bands.get(key).products.push(product.id)
    }
    const updated = policies.map((policy) => ({ ...policy, rules: [...(policy.rules || [])] }))
    for (const { form, minimum, products: ids } of [...bands.values()].sort((a, b) => a.minimum - b.minimum)) {
      let policy = updated.find((entry) => entry.product === form)
      if (!policy) {
        policy = { id: form, name: form === 'personal' ? 'Personal Policy' : 'Business Policy', product: form, enabled: true, rules: [] }
        updated.push(policy)
      }
      const fact = form === 'personal' ? 'net_monthly_pay' : 'average_monthly_credits'
      const words = form === 'personal' ? 'net pay of at least' : 'monthly revenue of at least'
      policy.rules.push({ id: `${policy.id}min${minimum}`, fact, operator: 'lt', value: minimum, outcome: 'not_eligible', products: ids, message: `Needs ${words} K${minimum.toLocaleString('en-ZM')} a month.`, enabled: true })
    }
    const db = await getDb()
    next = await db.transaction(async (tx) => {
      const [{ max }] = await tx.select({ max: sql`coalesce(max(${rulesets.version}), 0)::int` }).from(rulesets)
      await tx.update(rulesets).set({ status: 'archived', updatedAt: new Date() }).where(eq(rulesets.status, 'published'))
      const [row] = await tx
        .insert(rulesets)
        .values({
          version: max + 1,
          status: 'published',
          rules: { ...(Array.isArray(published.rules) ? {} : published.rules), policies: updated, eligibility: rulesetEligibility(published.rules) },
          note: 'Each loan product’s minimum net pay (or monthly revenue) moved into the policies as “Not eligible for…” rules.',
          publishedAt: new Date(),
        })
        .returning()
      return row
    })
  }
  // The products' own minimums, now the policies' to decide.
  if (cleared.length || minimums.length) {
    await setSetting('products', Object.fromEntries([...new Set([...cleared, ...minimums.map((entry) => entry.product)])].map((product) => [product.id, { eligibility: { minIncome: null } }])))
  }
  return next
}

/**
 * The rules in force. A new database starts with the default policy as version 1, so
 * prescreening works before anyone has opened the rules editor.
 */
export const getPublishedRuleset = async () => {
  const db = await getDb()
  const [published] = await db.select().from(rulesets).where(eq(rulesets.status, 'published')).orderBy(desc(rulesets.version)).limit(1)
  if (published && !movedMinimums) {
    movedMinimums = true
    return moveProductMinimums(published)
  }
  if (published) return published
  const [created] = await db
    .insert(rulesets)
    .values({ version: 1, status: 'published', rules: { policies: DEFAULT_POLICIES, eligibility: DEFAULT_ELIGIBILITY_RULES }, note: 'Default policy — replace the placeholder thresholds with your own.', publishedAt: new Date() })
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
  const rows = await db
    .select({ version: rulesets.version, status: rulesets.status, note: rulesets.note, publishedAt: rulesets.publishedAt, publishedBy: rulesets.publishedBy, rules: rulesets.rules })
    .from(rulesets)
    .where(sql`${rulesets.status} <> 'draft'`)
    .orderBy(desc(rulesets.version))
    .limit(30)
  return rows.map(({ rules, ...row }) => {
    const policies = rulesToPolicies(rules)
    return { ...row, policyCount: policies.length, ruleCount: countPolicyRules(policies), eligibilityCount: rulesetEligibility(rules).length }
  })
}
