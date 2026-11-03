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

// Today's default: Pre-screening → Appraisal → Underwriting → Underwriting: approval → Offer Issuance → Loan Booking.
const base = () => forEditing(legacyToWorkflow({}))

describe('the list view’s moves', () => {
  it('puts a new step in the path where it is dropped', () => {
    const added = addState(base(), { label: 'Credit check' })
    const moved = moveStep(added.definition, added.id, 'pending_approval')
    expect(steps(moved)).toEqual(['submitted', 'appraisal', 'in_review', 'credit_check', 'pending_approval', 'approved', 'accepted'])
    expect(links(moved, 'in_review')).toEqual(['recommend→credit_check'])
    expect(links(moved, 'credit_check')).toEqual(['move→pending_approval'])
    expect(moved.states.find((state) => state.id === 'credit_check').actions[0].label).toBe('Send to Underwriting: approval')
    expect(errors(moved)).toEqual([])
  })

  it('reconnects the steps it leaves, and the ones it lands between', () => {
    const added = addState(base(), { label: 'Credit check' })
    const first = moveStep(added.definition, added.id, 'pending_approval')
    // Up above Underwriting: Appraisal now leads to it, it leads to Underwriting, and Underwriting skips it.
    const moved = moveStep(first, 'credit_check', 'in_review')
    expect(steps(moved)).toEqual(['submitted', 'appraisal', 'credit_check', 'in_review', 'pending_approval', 'approved', 'accepted'])
    expect(links(moved, 'appraisal')).toEqual(['move→credit_check'])
    expect(links(moved, 'credit_check')).toEqual(['move→in_review'])
    expect(links(moved, 'in_review')).toEqual(['recommend→pending_approval'])
    // Its default name follows its new target.
    expect(moved.states.find((state) => state.id === 'credit_check').actions[0].label).toBe('Send to Underwriting')
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

describe('workflows published from the editor before today’s stages', () => {
  // As the editor saved the old default: no Appraisal stage, the review called by a former name.
  const former = (labels) => {
    const today = legacyToWorkflow({})
    const states = today.states
      .filter((state) => state.id !== 'appraisal')
      .map((state) => ({
        ...state,
        label: labels[state.id] || state.label,
        askApplicant: state.id === 'pending_approval' ? false : state.askApplicant,
        actions: (state.actions || []).map((action) => (action.id === 'start_review' ? { ...action, label: labels.startAction, to: 'in_review' } : action)),
      }))
    return { ...today, states }
  }

  it('are brought in line: renamed, an Appraisal stage put in after the start, underwriting able to ask', async () => {
    const { withCurrentStageNames } = await import('../api/_lib/workflowVersions.js')
    // November's names: "Appraisal" was the officer's review. One stage renamed by the workspace.
    const november = former({ submitted: 'Pre-screening', in_review: 'Appraisal', pending_approval: 'Underwriting', approved: 'Offer Issuance', accepted: 'Customer signed', startAction: 'Start appraisal' })
    const upgraded = withCurrentStageNames(november)
    const label = (id) => upgraded.states.find((state) => state.id === id).label
    expect(upgraded.states.map((state) => state.id).slice(0, 4)).toEqual(['submitted', 'appraisal', 'in_review', 'pending_approval'])
    expect(['submitted', 'appraisal', 'in_review', 'pending_approval', 'approved', 'accepted'].map(label)).toEqual(['Pre-screening', 'Appraisal', 'Underwriting', 'Underwriting: approval', 'Offer Issuance', 'Customer signed'])
    expect(upgraded.states.find((state) => state.id === 'submitted').actions[0]).toMatchObject({ label: 'Start the review', to: 'appraisal' })
    expect(upgraded.states.find((state) => state.id === 'appraisal').actions[0].to).toBe('in_review')
    expect(upgraded.states.find((state) => state.id === 'pending_approval').askApplicant).toBe(true)
    expect(errors(upgraded)).toEqual([])
    // Done once.
    expect(withCurrentStageNames(upgraded)).toBeNull()

    // October's names too.
    const october = withCurrentStageNames(former({ submitted: 'New', in_review: 'In review', pending_approval: 'Awaiting approval', approved: 'Offer made', accepted: 'Offer accepted', startAction: 'Start review' }))
    expect(['submitted', 'appraisal', 'in_review', 'pending_approval', 'approved', 'accepted'].map((id) => october.states.find((state) => state.id === id).label)).toEqual([
      'Pre-screening',
      'Appraisal',
      'Underwriting',
      'Underwriting: approval',
      'Offer Issuance',
      'Loan Booking',
    ])
  })

  it('leave a workflow the workspace built itself alone', async () => {
    const { withCurrentStageNames } = await import('../api/_lib/workflowVersions.js')
    expect(withCurrentStageNames(former({ submitted: 'Intake', in_review: 'Credit review', pending_approval: 'Committee', approved: 'Offer', accepted: 'Signed', startAction: 'Begin' }))).toBeNull()
  })
})
