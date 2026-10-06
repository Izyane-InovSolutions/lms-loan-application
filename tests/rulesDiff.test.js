import { describe, expect, it } from 'vitest'
import { diffPolicies, policiesToCsv } from '../src/admin/rulesDiff.js'

const rule = (id, extra = {}) => ({ id, fact: 'amount', operator: 'gt', value: 100, outcome: 'refer', message: 'Big', enabled: true, ...extra })
const policy = (id, rules, extra = {}) => ({ id, name: id, product: 'personal', enabled: true, rules, ...extra })

describe('diffPolicies', () => {
  it('reports added, changed and removed rules and policies', () => {
    const base = [policy('p1', [rule('a'), rule('b')]), policy('p2', [rule('c')])]
    const next = [policy('p1', [rule('a', { value: 200, outcome: 'decline' }), rule('d')]), policy('p3', [])]
    const diff = diffPolicies(base, next)
    expect(diff.find((d) => d.kind === 'changed' && d.scope === 'rule').changes.map((c) => c.field)).toEqual(['value', 'outcome'])
    expect(diff.filter((d) => d.kind === 'added').map((d) => d.scope)).toEqual(['rule', 'policy'])
    expect(diff.filter((d) => d.kind === 'removed').map((d) => d.scope)).toEqual(['rule', 'policy'])
  })
  it('is empty when nothing changed (numeric strings equal numbers)', () => {
    const base = [policy('p1', [rule('a')])]
    expect(diffPolicies(base, [policy('p1', [rule('a', { value: '100' })])])).toEqual([])
  })
})

describe('policiesToCsv', () => {
  it('quotes cells and neutralises formulas', () => {
    const csv = policiesToCsv([policy('p1', [rule('a', { message: '=SUM(A1), "x"' })])])
    expect(csv.split('\n')[1]).toContain('"\'=SUM(A1), ""x"""')
  })
})
