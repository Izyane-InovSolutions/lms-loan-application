import { OUTCOMES, PRODUCTS, describeCondition } from '@/config/creditRules'

const RULE_FIELDS = ['fact', 'operator', 'value', 'outcome', 'message', 'enabled']
const POLICY_FIELDS = ['name', 'product', 'enabled']

const label = (rule) => describeCondition(rule) || rule.fact
const show = (field, value) => {
  if (field === 'enabled') return value === false ? 'off' : 'on'
  if (field === 'outcome') return OUTCOMES[value]?.label || String(value)
  if (field === 'product') return PRODUCTS[value] || String(value)
  return value === '' || value == null ? 'empty' : String(value)
}
const same = (a, b) => (a ?? '') === (b ?? '') || String(a) === String(b)

/**
 * What publishing `next` would change relative to `base`, matched by id.
 * Returns [{ kind: 'added'|'changed'|'removed', scope: 'policy'|'rule', policy, title, changes? }].
 */
export function diffPolicies(base = [], next = []) {
  const out = []
  const baseById = new Map(base.map((policy) => [policy.id, policy]))
  const nextIds = new Set(next.map((policy) => policy.id))
  next.forEach((policy) => {
    const before = baseById.get(policy.id)
    if (!before) {
      out.push({ kind: 'added', scope: 'policy', policy: policy.name, title: `Policy “${policy.name}” with ${policy.rules.length} ${policy.rules.length === 1 ? 'rule' : 'rules'}` })
      return
    }
    const policyChanges = POLICY_FIELDS.filter((field) => !same(before[field] ?? true, policy[field] ?? true)).map((field) => ({ field, from: show(field, before[field]), to: show(field, policy[field]) }))
    if (policyChanges.length) out.push({ kind: 'changed', scope: 'policy', policy: policy.name, title: `Policy “${before.name}”`, changes: policyChanges })
    const beforeRules = new Map(before.rules.map((rule) => [rule.id, rule]))
    const ruleIds = new Set(policy.rules.map((rule) => rule.id))
    policy.rules.forEach((rule) => {
      const old = beforeRules.get(rule.id)
      if (!old) return out.push({ kind: 'added', scope: 'rule', policy: policy.name, title: label(rule) })
      const changes = RULE_FIELDS.filter((field) => !same(old[field] ?? (field === 'enabled' ? true : ''), rule[field] ?? (field === 'enabled' ? true : ''))).map((field) => ({
        field,
        from: show(field, old[field]),
        to: show(field, rule[field]),
      }))
      if (changes.length) out.push({ kind: 'changed', scope: 'rule', policy: policy.name, title: label(old), changes })
    })
    before.rules.filter((rule) => !ruleIds.has(rule.id)).forEach((rule) => out.push({ kind: 'removed', scope: 'rule', policy: policy.name, title: label(rule) }))
  })
  base.filter((policy) => !nextIds.has(policy.id)).forEach((policy) => out.push({ kind: 'removed', scope: 'policy', policy: policy.name, title: `Policy “${policy.name}” with ${policy.rules.length} ${policy.rules.length === 1 ? 'rule' : 'rules'}` }))
  return out
}

const csvCell = (value) => {
  let text = value == null ? '' : String(value)
  // Stop spreadsheets treating text as a formula.
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export const policiesToCsv = (policies) => {
  const header = ['policy', 'product', 'policy_enabled', 'fact', 'operator', 'value', 'outcome', 'message', 'rule_enabled']
  const rows = policies.flatMap((policy) =>
    policy.rules.map((rule) => [policy.name, policy.product, policy.enabled !== false, rule.fact, rule.operator, rule.value, rule.outcome, rule.message, rule.enabled !== false])
  )
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')
}
