import { describe, expect, it } from 'vitest'

import { caseOwnership } from '../src/admin/case/ownership.js'

const reviewing = { phase: 'review', state: { roles: [] } }

describe('whose case it is, for the case page buttons', () => {
  it('a case nobody has taken: only taking it is offered', () => {
    expect(caseOwnership({ status: 'submitted', assignedOfficer: null }, reviewing, 'me')).toMatchObject({ free: true, mine: false, gated: true, ownerMay: false })
  })

  it('my case: its work is mine', () => {
    expect(caseOwnership({ status: 'in_review', assignedOfficer: 'me' }, reviewing, 'me')).toMatchObject({ free: false, mine: true, ownerMay: true })
  })

  it('a colleague’s case: named, and its work is theirs', () => {
    const owned = caseOwnership({ status: 'in_review', assignedOfficer: 'ann', assignedOfficerName: 'Ann Banda' }, reviewing, 'me')
    expect(owned).toMatchObject({ free: false, mine: false, ownerMay: false, ownerName: 'Ann Banda' })
  })

  it('a stage for given roles goes by who took it there, not the officer', () => {
    const flow = { phase: 'review', state: { roles: ['legal'] } }
    expect(caseOwnership({ status: 'in_review', assignedOfficer: 'ann', stateAssignee: 'me' }, flow, 'me').mine).toBe(true)
    expect(caseOwnership({ status: 'in_review', assignedOfficer: 'me', stateAssignee: null }, flow, 'me').free).toBe(true)
  })

  it('once decided (or closed), ownership no longer holds anything back', () => {
    expect(caseOwnership({ status: 'approved', assignedOfficer: 'ann' }, { phase: 'closing', state: { roles: [] } }, 'me').ownerMay).toBe(true)
    expect(caseOwnership({ status: 'declined', assignedOfficer: 'ann' }, reviewing, 'me').ownerMay).toBe(true)
  })
})
