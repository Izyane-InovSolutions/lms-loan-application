import { describe, expect, it } from 'vitest'
import { legacyToWorkflow, validateWorkflow } from '../src/config/workflow.js'
import { addState, changeState, forEditing, listSteps, moveStep, setStateEnabled } from '../src/admin/workflow/editing.js'

const ROLES = ['admin', 'loan_officer', 'sales_manager', 'rm', 'dsa']
const errors = (definition) => validateWorkflow(definition, { roles: ROLES }).errors.map((error) => error.message)
const steps = (definition) => listSteps(definition).map((state) => state.id)
const links = (definition, id) => {
  const state = definition.states.find((entry) => entry.id === id)
  return state.type === 'offer' ? [`accept→${state.offer.onAccept}`] : state.actions.map((action) => `${action.kind}→${action.to}`)
}

// Today's default: New → In review → Awaiting approval → Offer → Accepted.
const base = () => forEditing(legacyToWorkflow({}))

describe('the list view’s moves', () => {
  it('puts a new step in the path where it is dropped', () => {
    const added = addState(base(), { label: 'Underwriting' })
    const moved = moveStep(added.definition, added.id, 'pending_approval')
    expect(steps(moved)).toEqual(['submitted', 'in_review', 'underwriting', 'pending_approval', 'approved', 'accepted'])
    expect(links(moved, 'in_review')).toEqual(['recommend→underwriting'])
    expect(links(moved, 'underwriting')).toEqual(['move→pending_approval'])
    expect(moved.states.find((state) => state.id === 'underwriting').actions[0].label).toBe('Send to Awaiting approval')
    expect(errors(moved)).toEqual([])
  })

  it('reconnects the steps it leaves, and the ones it lands between', () => {
    const added = addState(base(), { label: 'Underwriting' })
    const first = moveStep(added.definition, added.id, 'pending_approval')
    // Up above In review: New now leads to it, it leads to In review, and In review skips it.
    const moved = moveStep(first, 'underwriting', 'in_review')
    expect(steps(moved)).toEqual(['submitted', 'underwriting', 'in_review', 'pending_approval', 'approved', 'accepted'])
    expect(links(moved, 'submitted')).toEqual(['move→underwriting'])
    expect(links(moved, 'underwriting')).toEqual(['move→in_review'])
    expect(links(moved, 'in_review')).toEqual(['recommend→pending_approval'])
    // Its default name follows its new target.
    expect(moved.states.find((state) => state.id === 'underwriting').actions[0].label).toBe('Send to In review')
    expect(errors(moved)).toEqual([])
  })

  it('makes the step moved to the top the start', () => {
    const added = addState(base(), { label: 'Prescreening' })
    const moved = moveStep(added.definition, added.id, 'submitted')
    expect(moved.start).toBe('prescreening')
    expect(links(moved, 'prescreening')).toEqual(['move→submitted'])
    expect(errors(moved)).toEqual([])
  })

  it('leaves a step where it is when dropped on its own place', () => {
    const definition = base()
    expect(moveStep(definition, 'in_review', 'in_review')).toBe(definition)
    expect(moveStep(definition, 'in_review', 'pending_approval')).toBe(definition)
  })
})

describe('turning a step off', () => {
  it('keeps its setup, and turning it on again restores it', () => {
    const added = addState(base(), { label: 'Underwriting' })
    const placed = changeState(moveStep(added.definition, added.id, 'pending_approval'), 'underwriting', { roles: ['sales_manager'] })
    const off = setStateEnabled(placed, 'underwriting', false)
    expect(off.states.find((state) => state.id === 'underwriting')).toMatchObject({ disabled: true, roles: ['sales_manager'] })
    expect(errors(off)).toEqual([])
    expect(JSON.stringify(setStateEnabled(off, 'underwriting', true))).toBe(JSON.stringify(placed))
    // The built-in ends can't be turned off.
    expect(setStateEnabled(placed, 'declined', false)).toBe(placed)
  })
})
