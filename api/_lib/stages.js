import { text } from './http.js'
import { listRoles } from './roles.js'
import { PHASE_KEYS, RENAMABLE_STATUSES } from '../../src/config/stages.js'

/*
 * Checks a stages configuration from Settings → Stages before it is saved. Throws an
 * Error whose message is shown to the admin. Stage and checklist keys are kept once made,
 * so a case's recorded progress keeps pointing at the same stage after a rename.
 */

const MAX_STAGES_PER_PHASE = 10
const MAX_CHECKS = 20
const PRODUCTS = ['personal', 'business']

const slug = (value) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)

const uniqueKey = (wanted, taken, fallback) => {
  const base = slug(wanted) || fallback
  let key = base
  for (let n = 2; taken.has(key); n += 1) key = `${base}_${n}`
  taken.add(key)
  return key
}

export const validateStagesConfig = async (value) => {
  const roleKeys = new Set((await listRoles()).map((role) => role.key))

  // Every renamable status is written, blank for "keep the default", so clearing a name
  // really clears it (settings merge over what is stored).
  const labels = Object.fromEntries(RENAMABLE_STATUSES.map((status) => [status, text(value.labels?.[status], 40)]))

  const rawChecks = Array.isArray(value.checklist) ? value.checklist : []
  if (rawChecks.length > MAX_CHECKS) throw new Error(`The checklist can have at most ${MAX_CHECKS} items.`)
  const checkKeys = new Set()
  const checklist = rawChecks.map((check, index) => {
    const label = text(check?.label, 80)
    if (label.length < 2) throw new Error(`Checklist item ${index + 1} needs a name.`)
    const key = check.key && !checkKeys.has(slug(check.key)) ? (checkKeys.add(slug(check.key)), slug(check.key)) : uniqueKey(label, checkKeys, 'check')
    return { key, label, hint: text(check?.hint, 200), requiredToApprove: Boolean(check?.requiredToApprove) }
  })

  const stageIds = new Set()
  const phases = {}
  for (const phase of PHASE_KEYS) {
    const raw = Array.isArray(value[phase]) ? value[phase] : []
    if (raw.length > MAX_STAGES_PER_PHASE) throw new Error(`Each part of the flow can have at most ${MAX_STAGES_PER_PHASE} stages.`)
    phases[phase] = raw.map((stage, index) => {
      const label = text(stage?.label, 60)
      if (label.length < 2) throw new Error(`Stage ${index + 1} needs a name.`)
      const id = stage.id && !stageIds.has(slug(stage.id)) ? (stageIds.add(slug(stage.id)), slug(stage.id)) : uniqueKey(label, stageIds, 'stage')
      const roles = (Array.isArray(stage.roles) ? stage.roles : []).filter((role) => roleKeys.has(role))
      const checks = (Array.isArray(stage.checks) ? stage.checks : []).filter((key) => checkKeys.has(key))
      const products = (Array.isArray(stage.products) ? stage.products : []).filter((product) => PRODUCTS.includes(product))
      return {
        id,
        label,
        description: text(stage?.description, 300),
        roles: [...new Set(roles)],
        checks: [...new Set(checks)],
        products: products.length === PRODUCTS.length ? [] : [...new Set(products)],
        // Approval stages: someone other than the recommender, or whoever brought the case in.
        differentPerson: phase === 'approval' ? stage?.differentPerson !== false : false,
      }
    })
  }

  return { labels, checklist, ...phases }
}
