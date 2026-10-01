import { describe, expect, it } from 'vitest'
import { actionTarget, analyzeWorkflow, legacyStateOf, legacyToWorkflow, resolveState, validateWorkflow } from '../src/config/workflow.js'

const ROLES = ['admin', 'loan_officer', 'sales_manager', 'rm', 'dsa']
const valid = (definition) => {
  const result = validateWorkflow(definition, { roles: ROLES })
  expect(result.errors, JSON.stringify(result.errors, null, 2)).toEqual([])
  return result
}
const errorsOf = (definition) => validateWorkflow(definition, { roles: ROLES }).errors.map((error) => error.message).join('\n')
const ids = (definition) => definition.states.map((state) => state.id)

// The stages tests/stages.test.js configures, after the server gave them ids.
const STAGES = {
  labels: { in_review: 'Assessment' },
  checklist: [
    { key: 'identity', label: 'Identity verified', requiredToApprove: true },
    { key: 'documents', label: 'Documents reviewed', requiredToApprove: true },
    { key: 'site_visit', label: 'Site visit', requiredToApprove: false },
  ],
  review: [
    { id: 'document_check', label: 'Document check', checks: ['documents'], roles: [], products: [] },
    { id: 'field_verification', label: 'Field verification', checks: ['site_visit'], roles: ['loan_officer'], products: [] },
  ],
  approval: [{ id: 'credit_committee', label: 'Credit committee', checks: [], roles: [], products: [], differentPerson: true }],
  closing: [{ id: 'security_documents_signed', label: 'Security documents signed', checks: [], roles: [], products: ['personal'] }],
}

describe('the workflow today’s settings describe', () => {
  it('is the usual backbone by default: review, a second approver, an offer, payout', () => {
    const definition = legacyToWorkflow({})
    expect(ids(definition)).toEqual(['submitted', 'in_review', 'pending_approval', 'approved', 'accepted', 'paid_out', 'declined', 'withdrawn', 'expired'])
    const { categories } = valid(definition)
    expect(categories).toMatchObject({
      submitted: 'submitted',
      in_review: 'in_review',
      pending_approval: 'pending_approval',
      approved: 'approved',
      accepted: 'accepted',
      paid_out: 'disbursed',
      declined: 'declined',
    })
    expect(definition.states.find((state) => state.id === 'approved').type).toBe('offer')
    // Recommending approval needs the checks marked "needed to approve".
    expect(definition.states.find((state) => state.id === 'in_review').actions[0].options.checks).toEqual(['identity', 'documents', 'income'])
  })

  it('lets the officer decide alone with four-eyes off', () => {
    const definition = legacyToWorkflow({ workflow: { requireSecondApproval: false } })
    expect(ids(definition)).not.toContain('pending_approval')
    const review = definition.states.find((state) => state.id === 'in_review')
    expect(review.actions.map((action) => action.kind)).toEqual(['approve', 'reject'])
    expect(review.actions[0]).toMatchObject({ permission: 'cases.recommend', options: { singleStep: true } })
    valid(definition)
  })

  it('goes straight to payout when offers needn’t be accepted', () => {
    const definition = legacyToWorkflow({ offers: { requireAcceptance: false } })
    expect(definition.states.some((state) => state.type === 'offer')).toBe(false)
    const { categories } = valid(definition)
    expect(categories.approved).toBe('approved')
  })

  it('hands to the LMS on submission or before payout, as configured', () => {
    const onSubmit = legacyToWorkflow({ lms: { syncOn: 'submit' } })
    expect(onSubmit.states.filter((state) => state.handToLms).map((state) => state.id)).toEqual(['submitted'])
    const onApproval = legacyToWorkflow({ lms: { syncOn: 'approval' } })
    expect(onApproval.states.filter((state) => state.handToLms).map((state) => state.id)).toEqual(['accepted'])
  })

  it('turns each stage into a state of its own, in its part of the journey', () => {
    const definition = legacyToWorkflow({ stages: STAGES })
    expect(ids(definition)).toEqual([
      'submitted',
      'document_check',
      'field_verification',
      'in_review',
      'credit_committee',
      'pending_approval',
      'approved',
      'security_documents_signed',
      'accepted',
      'paid_out',
      'declined',
      'withdrawn',
      'expired',
    ])
    const byId = Object.fromEntries(definition.states.map((state) => [state.id, state]))
    expect(byId.field_verification).toMatchObject({ label: 'Assessment: Field verification', roles: ['loan_officer'], requiredChecks: ['site_visit'], trackProgress: true })
    expect(byId.in_review.label).toBe('Assessment: ready to recommend')
    expect(byId.credit_committee.actions[0].options.fourEyes).toBe(true)
    expect(byId.approved.offer.onAccept).toBe('security_documents_signed')

    const { categories, order } = valid(definition)
    expect(categories).toMatchObject({ document_check: 'in_review', credit_committee: 'pending_approval', pending_approval: 'pending_approval', security_documents_signed: 'accepted' })
    expect(order.indexOf('document_check')).toBeLessThan(order.indexOf('in_review'))
    // Business loans skip the personal-only closing stage.
    expect(resolveState(definition, 'security_documents_signed', 'business').id).toBe('accepted')
    expect(resolveState(definition, 'security_documents_signed', 'personal').id).toBe('security_documents_signed')
  })

  it('maps existing cases onto those states', () => {
    const definition = legacyToWorkflow({ stages: STAGES })
    const state = (application, options) => legacyStateOf(definition, { loanType: 'personal', stageProgress: {}, ...application }, options)
    expect(state({ status: 'submitted' })).toBe('submitted')
    expect(state({ status: 'in_review' })).toBe('document_check')
    expect(state({ status: 'in_review', stageProgress: { document_check: { done: true } } })).toBe('field_verification')
    expect(state({ status: 'in_review', stageProgress: { document_check: { done: true }, field_verification: { done: true } } })).toBe('in_review')
    expect(state({ status: 'info_requested', stageProgress: { document_check: { done: true } } }, { fromStatus: 'in_review' })).toBe('field_verification')
    expect(state({ status: 'pending_approval' })).toBe('credit_committee')
    expect(state({ status: 'approved' })).toBe('approved')
    expect(state({ status: 'accepted' })).toBe('security_documents_signed')
    expect(state({ status: 'accepted', loanType: 'business' })).toBe('accepted')
    expect(state({ status: 'disbursed' })).toBe('paid_out')
    expect(state({ status: 'expired' })).toBe('expired')
  })
})

/** A flow like the screenshot's, built from scratch. */
const custom = () => ({
  start: 'draft',
  checklist: [{ key: 'identity', label: 'Identity verified' }],
  states: [
    { id: 'draft', label: 'Application draft', type: 'work', roles: ['dsa'], actions: [{ id: 'submit', label: 'Submit for prescreening', kind: 'move', to: 'prescreening' }] },
    {
      id: 'prescreening',
      label: 'Prescreening',
      type: 'work',
      roles: ['loan_officer'],
      askApplicant: true,
      actions: [
        { id: 'send', label: 'Send to appraisal', kind: 'move', to: 'appraisal' },
        { id: 'back', label: 'Return', kind: 'return', to: 'draft' },
        { id: 'reject', label: 'Reject', kind: 'reject', to: 'declined' },
      ],
    },
    {
      id: 'appraisal',
      label: 'Loan appraisal',
      type: 'work',
      actions: [
        { id: 'send', label: 'Send to underwriting', kind: 'recommend', to: 'underwriting' },
        { id: 'back', label: 'Return', kind: 'return', to: 'prescreening' },
        { id: 'reject', label: 'Reject', kind: 'reject', to: 'declined' },
      ],
    },
    {
      id: 'underwriting',
      label: 'Underwriting',
      type: 'work',
      roles: ['sales_manager'],
      actions: [
        { id: 'approve', label: 'Approve', kind: 'approve', to: 'offer', options: { fourEyes: true } },
        { id: 'back', label: 'Return', kind: 'return', to: 'appraisal' },
        { id: 'reject', label: 'Reject', kind: 'reject', to: 'declined' },
      ],
    },
    { id: 'offer', label: 'Offer', type: 'offer', offer: { onAccept: 'disbursement' }, actions: [] },
    { id: 'disbursement', label: 'Disbursement', type: 'work', handToLms: true, actions: [{ id: 'pay', label: 'Mark as paid out', kind: 'pay_out', to: 'paid_out' }] },
    { id: 'paid_out', label: 'Approved', type: 'final', actions: [] },
    { id: 'declined', label: 'Rejected', type: 'final', actions: [] },
    { id: 'withdrawn', label: 'Withdrawn', type: 'final', actions: [] },
    { id: 'expired', label: 'Offer expired', type: 'final', actions: [] },
  ],
})

const edit = (definition, id, change) => ({ ...definition, states: definition.states.map((state) => (state.id === id ? { ...state, ...change(state) } : state)) })

describe('a workflow built in the editor', () => {
  it('is valid, and gets its categories from where each state sits', () => {
    const { categories, order } = valid(custom())
    expect(categories).toMatchObject({ draft: 'submitted', prescreening: 'in_review', appraisal: 'in_review', underwriting: 'pending_approval', offer: 'approved', disbursement: 'accepted', paid_out: 'disbursed' })
    expect(order.slice(0, 6)).toEqual(['draft', 'prescreening', 'appraisal', 'underwriting', 'offer', 'disbursement'])
  })

  it('refuses a loop of forward actions', () => {
    const looped = edit(custom(), 'appraisal', (state) => ({ actions: [...state.actions, { id: 'loop', label: 'Again', kind: 'move', to: 'prescreening' }] }))
    expect(errorsOf(looped)).toMatch(/loop back on each other/)
  })

  it('refuses a state nothing leads to, and one with no way out', () => {
    const extra = custom()
    extra.states.splice(1, 0, { id: 'orphan', label: 'Orphan', type: 'work', actions: [{ id: 'on', label: 'On', kind: 'move', to: 'prescreening' }] })
    expect(errorsOf(extra)).toMatch(/“Orphan” can’t be reached/)
    const stuck = edit(custom(), 'disbursement', () => ({ actions: [] }))
    expect(errorsOf(stuck)).toMatch(/“Disbursement” has no way forward/)
  })

  it('refuses returning past the decision, or forward', () => {
    const pastDecision = edit(custom(), 'disbursement', (state) => ({ actions: [...state.actions, { id: 'back', label: 'Back to underwriting', kind: 'return', to: 'underwriting' }] }))
    expect(errorsOf(pastDecision)).toMatch(/can’t go back past the decision/)
    const forward = edit(custom(), 'prescreening', (state) => ({ actions: [...state.actions, { id: 'jump', label: 'Jump', kind: 'return', to: 'underwriting' }] }))
    expect(errorsOf(forward)).toMatch(/earlier state/)
  })

  it('refuses a state reachable both before and after approval', () => {
    const both = custom()
    both.states.splice(1, 0, { id: 'checks', label: 'Extra checks', type: 'work', actions: [{ id: 'on', label: 'On', kind: 'move', to: 'disbursement' }] })
    const conflicted = edit(edit(both, 'draft', (state) => ({ actions: [...state.actions, { id: 'checks', label: 'Checks', kind: 'move', to: 'checks' }] })), 'offer', () => ({ offer: { onAccept: 'checks' } }))
    expect(errorsOf(conflicted)).toMatch(/can be reached both/)
  })

  it('keeps the built-in ends', () => {
    const noExpiry = { ...custom(), states: custom().states.filter((state) => state.id !== 'expired') }
    expect(errorsOf(noExpiry)).toMatch(/“Offer expired” end is missing/)
    const extraFinal = custom()
    extraFinal.states.push({ id: 'closed', label: 'Closed', type: 'final', actions: [] })
    expect(errorsOf(extraFinal)).toMatch(/only the built-in ends can be final/)
  })

  it('checks where each kind of action may lead', () => {
    expect(errorsOf(edit(custom(), 'prescreening', (state) => ({ actions: [{ ...state.actions[0], to: 'declined' }, ...state.actions.slice(1)] })))).toMatch(/can’t end the case/)
    expect(errorsOf(edit(custom(), 'appraisal', (state) => ({ actions: [...state.actions.slice(0, 2), { id: 'reject', label: 'Reject', kind: 'reject', to: 'withdrawn' }] })))).toMatch(/must lead to “Rejected”/)
    expect(errorsOf(edit(custom(), 'disbursement', (state) => ({ actions: [...state.actions, { id: 'reject', label: 'Reject', kind: 'reject', to: 'declined' }] })))).toMatch(/withdrawn, not rejected/)
    expect(errorsOf(edit(custom(), 'prescreening', (state) => ({ actions: [...state.actions, { id: 'pay', label: 'Pay', kind: 'pay_out', to: 'paid_out' }] })))).toMatch(/paid out only after it is approved/)
  })

  it('checks the offer, product filters and asking the applicant', () => {
    expect(errorsOf(edit(custom(), 'offer', () => ({ offer: {} })))).toMatch(/where a case goes once the customer accepts/)
    expect(errorsOf(edit(custom(), 'disbursement', () => ({ askApplicant: true })))).toMatch(/only be asked for more before the decision/)
    const filtered = edit(custom(), 'appraisal', () => ({ products: ['business'] }))
    expect(errorsOf(filtered)).toMatch(/needs exactly one Move action/)
  })
})

describe('a state turned off', () => {
  const off = (definition, id) => edit(definition, id, () => ({ disabled: true }))

  it('is passed straight through, forward and back', () => {
    const definition = off(custom(), 'prescreening')
    const { categories } = valid(definition)
    expect(resolveState(definition, 'prescreening', 'personal').id).toBe('appraisal')
    // Appraisal's Return to prescreening goes back one further, to the draft.
    const back = definition.states.find((state) => state.id === 'appraisal').actions.find((action) => action.kind === 'return')
    expect(actionTarget(definition, back, 'personal').id).toBe('draft')
    expect(categories.appraisal).toBe('in_review')
  })

  it('needs exactly one Move to pass cases on, and can’t be the start, the offer or an end', () => {
    expect(errorsOf(off(custom(), 'appraisal'))).toMatch(/“Loan appraisal” is turned off, so cases pass straight through it by its Move action/)
    expect(errorsOf(off(custom(), 'draft'))).toMatch(/so it can’t be turned off/)
    expect(errorsOf(off(custom(), 'offer'))).toMatch(/“Offer” is the offer: it can’t be turned off/)
    expect(errorsOf(off(custom(), 'declined'))).toMatch(/“Rejected” is an end: it can’t be turned off/)
  })
})
