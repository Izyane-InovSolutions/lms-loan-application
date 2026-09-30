import { and, desc, eq, inArray, isNull, ne, notInArray, or, sql } from 'drizzle-orm'
import { getDb, schema } from './db/client.js'
import { getSetting } from './settings.js'
import { SYSTEM_FINAL_IDS, analyzeWorkflow, legacyStateOf, legacyToWorkflow } from '../../src/config/workflow.js'

const { workflowVersions, applications, applicationEvents } = schema

/*
 * The workflow's versions (src/config/workflow.js), stored like the credit rules: one
 * draft, one published, the rest retired. New applications follow the published one; an
 * open case keeps the version it started on. Published definitions never change, so
 * they are cached here by version number.
 *
 * Until someone publishes from the Workflow editor, the workflow is "legacy-managed": it
 * is generated from the old settings (four-eyes, offers, the LMS moment, Settings →
 * Stages) and regenerated whenever they change, taking open cases along. That keeps those
 * settings meaning what they always did. The first publish from the editor ends it.
 */

const byVersion = new Map()

/** A published version's definition and its analysis (phases, categories, order). */
const withAnalysis = (row) => ({ version: row.version, legacy: row.legacy, definition: row.definition, analysis: analyzeWorkflow(row.definition), publishedAt: row.publishedAt })

const cached = (row) => {
  if (!byVersion.has(row.version)) byVersion.set(row.version, withAnalysis(row))
  return byVersion.get(row.version)
}

/** The settings the legacy workflow is made from. */
const legacySettings = async () => ({
  workflow: await getSetting('workflow'),
  offers: await getSetting('offers'),
  lms: await getSetting('lms'),
  stages: await getSetting('stages'),
})

/** The last status a case had before it started waiting on the applicant, for mapping it to a state. */
const statusesBeforeInfoRequests = async (db, ids) => {
  if (!ids.length) return {}
  const rows = await db
    .select({ applicationId: applicationEvents.applicationId, fromStatus: applicationEvents.fromStatus, at: applicationEvents.at })
    .from(applicationEvents)
    .where(and(inArray(applicationEvents.applicationId, ids), eq(applicationEvents.toStatus, 'info_requested')))
    .orderBy(applicationEvents.at)
  return Object.fromEntries(rows.map((row) => [row.applicationId, row.fromStatus]))
}

/**
 * Puts cases on `target` (a legacy version) by their status and stage progress: all cases
 * without a state yet, and — when regenerating — the open cases on earlier legacy versions.
 */
const mapCasesOnto = async (db, target, { fromVersions = [] } = {}) => {
  const conditions = [isNull(applications.state)]
  if (fromVersions.length) conditions.push(and(inArray(applications.workflowVersion, fromVersions), notInArray(applications.state, SYSTEM_FINAL_IDS)))
  const rows = await db
    .select({ id: applications.id, status: applications.status, loanType: applications.loanType, stageProgress: applications.stageProgress, state: applications.state, updatedAt: applications.updatedAt })
    .from(applications)
    .where(or(...conditions))
  const waiting = await statusesBeforeInfoRequests(db, rows.filter((row) => row.status === 'info_requested').map((row) => row.id))
  for (const row of rows) {
    const state = legacyStateOf(target.definition, row, { fromStatus: waiting[row.id] })
    await db
      .update(applications)
      .set({ state, workflowVersion: target.version, ...(row.state ? {} : { stateEnteredAt: row.updatedAt }) })
      .where(eq(applications.id, row.id))
  }
  return rows.length
}

const publishedRow = async (db) => (await db.select().from(workflowVersions).where(eq(workflowVersions.status, 'published')).orderBy(desc(workflowVersions.version)).limit(1))[0] || null

let ensuring = null

/**
 * The workflow new applications follow. The first call on a database without one builds
 * version 1 from the current settings and puts every existing case on it.
 */
export const getPublishedWorkflow = async () => {
  const db = await getDb()
  const row = await publishedRow(db)
  if (row) return cached(row)
  // One build per process at a time; a parallel instance is caught by the unique version.
  ensuring = ensuring || buildFirstVersion().finally(() => (ensuring = null))
  return ensuring
}

const buildFirstVersion = async () => {
  const db = await getDb()
  const definition = legacyToWorkflow(await legacySettings())
  await db
    .insert(workflowVersions)
    .values({ version: 1, status: 'published', definition, legacy: true, note: 'Made from the existing settings.', publishedAt: new Date() })
    .onConflictDoNothing()
  const published = cached(await publishedRow(db))
  await mapCasesOnto(db, published)
  return published
}

/**
 * A case's own version (cached), falling back to the published one for cases not yet on
 * any. Inside a transaction, pass it as `db`: a query on another connection would wait
 * for the transaction to finish (PGlite runs one at a time).
 */
export const getWorkflowVersion = async (version, db = null) => {
  if (version && byVersion.has(version)) return byVersion.get(version)
  if (!version) return getPublishedWorkflow()
  db = db || (await getDb())
  const [row] = await db.select().from(workflowVersions).where(and(eq(workflowVersions.version, version), ne(workflowVersions.status, 'draft'))).limit(1)
  return row ? cached(row) : getPublishedWorkflow()
}

/** Whether the workflow still follows the old settings (nobody has published from the editor). */
export const isLegacyManaged = async () => (await getPublishedWorkflow()).legacy

/**
 * After the old settings change: publishes the workflow they now describe and moves open
 * cases onto it, while the workflow is still legacy-managed. Returns the version in force.
 */
export const regenerateLegacyWorkflow = async (actor = null) => {
  const current = await getPublishedWorkflow()
  if (!current.legacy) return current
  const definition = legacyToWorkflow(await legacySettings())
  if (JSON.stringify(definition) === JSON.stringify(current.definition)) return current
  const db = await getDb()
  const published = await db.transaction(async (tx) => {
    const [{ max }] = await tx.select({ max: sql`coalesce(max(${workflowVersions.version}), 0)::int` }).from(workflowVersions)
    await tx.update(workflowVersions).set({ status: 'retired', updatedAt: new Date() }).where(eq(workflowVersions.status, 'published'))
    const [row] = await tx
      .insert(workflowVersions)
      .values({ version: max + 1, status: 'published', definition, legacy: true, note: 'Updated from the settings.', publishedBy: actor?.id ?? null, publishedAt: new Date() })
      .returning()
    return row
  })
  const target = cached(published)
  const legacyVersions = (await db.select({ version: workflowVersions.version }).from(workflowVersions).where(and(eq(workflowVersions.legacy, true), ne(workflowVersions.version, target.version)))).map((row) => row.version)
  await mapCasesOnto(db, target, { fromVersions: legacyVersions })
  return target
}

// ---------------------------------------------------------------------------
// The editor's draft (Workflow page)
// ---------------------------------------------------------------------------

export const getDraftWorkflow = async () => {
  const db = await getDb()
  const [draft] = await db.select().from(workflowVersions).where(eq(workflowVersions.status, 'draft')).limit(1)
  return draft || null
}

export const saveDraftWorkflow = async (definition, note, actor) => {
  const db = await getDb()
  const draft = await getDraftWorkflow()
  if (draft) {
    const [updated] = await db.update(workflowVersions).set({ definition, note, updatedAt: new Date() }).where(eq(workflowVersions.id, draft.id)).returning()
    return updated
  }
  const [created] = await db.insert(workflowVersions).values({ status: 'draft', definition, note, createdBy: actor?.id ?? null }).returning()
  return created
}

export const discardDraftWorkflow = async () => {
  const db = await getDb()
  await db.delete(workflowVersions).where(eq(workflowVersions.status, 'draft'))
}

/**
 * Promotes the draft to the next version. Open cases stay on the version they are on;
 * new applications follow this one. Ends legacy management for good.
 */
export const publishDraftWorkflow = async (actor, note) => {
  const db = await getDb()
  const published = await db.transaction(async (tx) => {
    const [draft] = await tx.select().from(workflowVersions).where(eq(workflowVersions.status, 'draft')).limit(1)
    if (!draft) return null
    const [{ max }] = await tx.select({ max: sql`coalesce(max(${workflowVersions.version}), 0)::int` }).from(workflowVersions)
    await tx.update(workflowVersions).set({ status: 'retired', updatedAt: new Date() }).where(eq(workflowVersions.status, 'published'))
    const [row] = await tx
      .update(workflowVersions)
      .set({ status: 'published', version: max + 1, legacy: false, note: note || draft.note, publishedBy: actor?.id ?? null, publishedAt: new Date(), updatedAt: new Date() })
      .where(eq(workflowVersions.id, draft.id))
      .returning()
    return row
  })
  return published ? cached(published) : null
}

export const listWorkflowHistory = async () => {
  const db = await getDb()
  const rows = await db
    .select({ version: workflowVersions.version, status: workflowVersions.status, legacy: workflowVersions.legacy, note: workflowVersions.note, publishedAt: workflowVersions.publishedAt, publishedBy: workflowVersions.publishedBy })
    .from(workflowVersions)
    .where(ne(workflowVersions.status, 'draft'))
    .orderBy(desc(workflowVersions.version))
    .limit(30)
  const counts = await db
    .select({ version: applications.workflowVersion, count: sql`count(*)::int` })
    .from(applications)
    .where(notInArray(applications.state, SYSTEM_FINAL_IDS))
    .groupBy(applications.workflowVersion)
  const open = Object.fromEntries(counts.map((row) => [row.version, row.count]))
  return rows.map((row) => ({ ...row, openCases: open[row.version] || 0 }))
}

/** For tests: forget cached versions (each test file has its own database). */
export const clearWorkflowCache = () => byVersion.clear()
