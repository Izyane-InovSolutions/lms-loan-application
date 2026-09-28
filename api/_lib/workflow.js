import { and, eq } from 'drizzle-orm'
import { getDb, schema } from './db/client.js'
import { fail, text } from './http.js'
import { addEvent } from './applications.js'
import { getSetting } from './settings.js'
import { CHECKS, OPEN_STATUSES, WITHDRAWABLE_STATUSES } from '../../src/config/applications.js'
import { checkOtp } from './otp.js'
import { priceLoan } from '../../src/config/loanProducts.js'
import { getProducts } from './products.js'

const { applications, appraisals, users } = schema

/*
 * The appraisal workflow, as one function per action. Each runs in a transaction against
 * the row it read, bumps `version`, and writes its timeline entry, so a transition and
 * its record can never come apart.
 *
 *   submitted ──start──▶ in_review ──recommend──▶ pending_approval ──decide──▶ approved / declined
 *        ▲                  │  ▲                        │                       │
 *        └── respond ── info_requested            return (back to in_review)    ▼
 *                                                          accepted (customer) ─▶ disbursed
 *   Any open or approved case can be withdrawn; an unaccepted offer expires.
 *
 * Guard rails (Settings → Workflow):
 *   - four-eyes: whoever recommends, or brought the customer in, cannot give the decision;
 *   - loan officers decide up to an amount limit; above it an administrator must.
 */

export const CREDIT_ROLES = ['admin', 'loan_officer']
const isCredit = (viewer) => CREDIT_ROLES.includes(viewer.role)

const requireCredit = (viewer) => {
  if (!isCredit(viewer)) fail(403, 'Only loan officers and administrators can do this.', 'forbidden')
}

const requireStatus = (application, allowed, message) => {
  if (!allowed.includes(application.status)) fail(409, message, 'invalid_state')
}

const reason = (input, message = 'Add a short explanation.') => {
  const value = text(input, 2000)
  if (value.length < 3) fail(400, message, 'invalid_input')
  return value
}

/** Approved amount and tenure, defaulting to what was asked for and held to the product limits. */
const terms = (application, input, settings) => {
  const product = settings.products.find((entry) => entry.id === application.loanType)
  const amount = input.amount === undefined || input.amount === '' ? application.amount : Number(input.amount)
  const tenure = input.tenure === undefined || input.tenure === '' ? application.tenure : Number(input.tenure)
  if (!Number.isFinite(amount) || amount < product.minAmount || amount > product.maxAmount) {
    fail(400, `The amount must be between K${product.minAmount.toLocaleString()} and K${product.maxAmount.toLocaleString()}.`, 'invalid_amount')
  }
  if (!Number.isInteger(tenure) || tenure < product.minTenure || tenure > product.maxTenure) {
    fail(400, `The tenure must be between ${product.minTenure} and ${product.maxTenure} months.`, 'invalid_tenure')
  }
  return { amount, tenure }
}

const ACTIONS = {
  /** Officer takes a case, or an admin / officer hands it to an officer. */
  async assign(tx, viewer, application, input) {
    requireCredit(viewer)
    requireStatus(application, OPEN_STATUSES, 'This case is closed.')
    const officerId = input.officerId || viewer.id
    const [person] = await tx.select().from(users).where(eq(users.id, officerId)).limit(1)
    if (!person || !CREDIT_ROLES.includes(person.role) || person.status !== 'active') fail(400, 'Choose an active loan officer.', 'invalid_officer')
    return {
      changes: { assignedOfficer: person.id },
      event: { type: 'assignment', message: person.id === viewer.id ? `${viewer.name} took the case` : `Assigned to ${person.name}` },
    }
  },

  async start_review(tx, viewer, application) {
    requireCredit(viewer)
    requireStatus(application, ['submitted'], 'Only a newly submitted case can be started.')
    return {
      changes: { status: 'in_review', assignedOfficer: application.assignedOfficer || viewer.id },
      event: { type: 'status', message: 'Review started', visibleToCustomer: true },
    }
  },

  /** Asks the applicant (or their agent) for something; they answer from their page. */
  async request_info(tx, viewer, application, input) {
    requireCredit(viewer)
    requireStatus(application, ['submitted', 'in_review'], 'Information can only be requested while a case is being reviewed.')
    const message = reason(input.message, 'Say what the applicant needs to send or explain.')
    return {
      changes: { status: 'info_requested', infoRequest: { message, requestedBy: viewer.name, requestedAt: new Date().toISOString() } },
      event: { type: 'info_request', message, visibleToCustomer: true },
      notify: { headline: 'We need something from you', body: `Please send us the following so we can continue with your application: ${message}` },
    }
  },

  /** Ticks or clears a checklist item. Ticking needs a note of what was seen. */
  async check(tx, viewer, application, input) {
    requireCredit(viewer)
    requireStatus(application, ['submitted', 'in_review', 'info_requested'], 'The checklist is locked once a recommendation is made.')
    if (!CHECKS[input.check]) fail(400, 'Unknown check.', 'invalid_input')
    const done = Boolean(input.done)
    const note = done ? reason(input.note, 'Note what you checked, e.g. which document or reference.') : text(input.note, 500)
    const checks = { ...(application.checks || {}), [input.check]: { done, note, by: viewer.name, at: new Date().toISOString() } }
    return {
      changes: { checks },
      event: { type: 'check', message: `${CHECKS[input.check].label}: ${done ? 'done' : 'reopened'}${note ? ` (${note})` : ''}` },
    }
  },

  /**
   * The officer's recommendation. With four-eyes on it waits for someone else; with it
   * off, the officer's own call stands (within their limit).
   */
  async recommend(tx, viewer, application, input, settings) {
    requireCredit(viewer)
    requireStatus(application, ['in_review'], 'Start the review before recommending.')
    const verdict = input.verdict
    if (!['approve', 'decline'].includes(verdict)) fail(400, 'Choose approve or decline.', 'invalid_input')
    const rationale = reason(input.rationale, 'Explain the recommendation for the approver.')
    const conditions = text(input.conditions, 2000) || null
    const { amount, tenure } = verdict === 'approve' ? terms(application, input, settings) : { amount: null, tenure: null }

    if (verdict === 'approve') {
      const missing = Object.entries(CHECKS).filter(([key, check]) => check.requiredToApprove && !application.checks?.[key]?.done)
      if (missing.length) fail(400, `Complete these checks first: ${missing.map(([, check]) => check.label.toLowerCase()).join(', ')}.`, 'checks_incomplete')
    }

    await tx.insert(appraisals).values({
      applicationId: application.id,
      kind: 'recommendation',
      verdict,
      amount,
      tenure,
      conditions,
      rationale,
      officerId: viewer.id,
      officerName: viewer.name,
    })

    if (settings.workflow.requireSecondApproval) {
      return {
        changes: { status: 'pending_approval', assignedOfficer: application.assignedOfficer || viewer.id },
        event: { type: 'recommendation', message: `Recommended ${verdict === 'approve' ? `approval of K${amount.toLocaleString()} over ${tenure} months` : 'decline'}: ${rationale}` },
      }
    }
    return finalDecision(tx, viewer, application, { verdict, amount, tenure, conditions, rationale }, settings, { recordAppraisal: false })
  },

  /** The second person's decision on a recommendation. */
  async decide(tx, viewer, application, input, settings) {
    requireCredit(viewer)
    requireStatus(application, ['pending_approval'], 'This case is not waiting for a decision.')
    const verdict = input.verdict
    if (!['approve', 'decline', 'return'].includes(verdict)) fail(400, 'Choose approve, decline or send back.', 'invalid_input')
    const rationale = reason(input.rationale, 'Explain the decision.')

    const [recommendation] = await tx
      .select()
      .from(appraisals)
      .where(and(eq(appraisals.applicationId, application.id), eq(appraisals.kind, 'recommendation')))
      .orderBy(appraisals.createdAt)
      .then((rows) => rows.slice(-1))
    if (settings.workflow.requireSecondApproval && recommendation?.officerId === viewer.id) {
      fail(403, 'A different person must decide a case you recommended.', 'four_eyes')
    }

    if (verdict === 'return') {
      await tx.insert(appraisals).values({ applicationId: application.id, kind: 'decision', verdict: 'return', rationale, officerId: viewer.id, officerName: viewer.name })
      return { changes: { status: 'in_review' }, event: { type: 'decision', message: `Sent back for more work: ${rationale}` } }
    }

    const amount = verdict === 'approve' ? input.amount ?? recommendation?.amount : null
    const tenure = verdict === 'approve' ? input.tenure ?? recommendation?.tenure : null
    const conditions = text(input.conditions, 2000) || recommendation?.conditions || null
    return finalDecision(tx, viewer, application, { verdict, amount, tenure, conditions, rationale }, settings, { recordAppraisal: true })
  },

  /**
   * The customer accepted the offer in person: the agent or officer enters the code the
   * customer received by email, as proof it was them.
   */
  async record_acceptance(tx, viewer, application, input) {
    requireStatus(application, ['approved'], 'There is no offer waiting to be accepted.')
    if (application.offerExpiresAt && new Date(application.offerExpiresAt) < new Date()) fail(409, 'This offer has expired.', 'offer_expired')
    const code = text(input.code, 12)
    if (!code) fail(400, 'Enter the code the customer received by email.', 'invalid_input')
    const otpError = await checkOtp(application.applicantEmail, code)
    if (otpError) fail(otpError.status, otpError.message.replace('The code entered', 'The customer’s code'), 'invalid_code')
    return {
      changes: { status: 'accepted', acceptedAt: new Date() },
      event: { type: 'status', message: `Offer accepted by the customer, recorded by ${viewer.name}`, visibleToCustomer: true },
      accepted: true,
      consumeOtpFor: application.applicantEmail,
    }
  },

  /** Withdraws the application at the customer's request (recorded by staff). */
  async withdraw(tx, viewer, application, input) {
    requireStatus(application, WITHDRAWABLE_STATUSES, 'This application can no longer be withdrawn.')
    const why = reason(input.reason, 'Note why the customer is withdrawing.')
    return {
      changes: { status: 'withdrawn', withdrawnAt: new Date(), closedReason: why },
      event: { type: 'status', message: `Withdrawn at the customer’s request: ${why}`, customerMessage: 'The application was withdrawn at your request.', visibleToCustomer: true },
    }
  },

  async note(tx, viewer, application, input) {
    const message = reason(input.message, 'Write the note.')
    return { changes: {}, event: { type: 'note', message } }
  },

  /** Records that the loan was paid out, when the LMS does not report it back. */
  async mark_disbursed(tx, viewer, application, input, settings) {
    requireCredit(viewer)
    const ready = settings.offers.requireAcceptance ? ['accepted'] : ['approved', 'accepted']
    requireStatus(application, ready, settings.offers.requireAcceptance ? 'The customer must accept the offer before it is paid out.' : 'Only an approved loan can be marked as paid out.')
    const reference = text(input.reference, 100)
    return {
      changes: { status: 'disbursed' },
      event: { type: 'status', message: reference ? `Paid out (${reference})` : 'Paid out', visibleToCustomer: true },
    }
  },
}

/** Approve or decline, enforcing four-eyes against the originator and the officer limit. */
const finalDecision = async (tx, viewer, application, { verdict, amount, tenure, conditions, rationale }, settings, { recordAppraisal }) => {
  if (settings.workflow.requireSecondApproval && application.sourcedBy === viewer.id) {
    fail(403, 'A different person must decide a case you brought in.', 'four_eyes')
  }
  let approved = null
  if (verdict === 'approve') {
    approved = terms(application, { amount, tenure }, settings)
    if (viewer.role !== 'admin' && approved.amount > settings.workflow.officerApprovalLimit) {
      fail(403, `Approvals above K${settings.workflow.officerApprovalLimit.toLocaleString()} need an administrator.`, 'over_limit')
    }
  }
  if (recordAppraisal) {
    await tx.insert(appraisals).values({
      applicationId: application.id,
      kind: 'decision',
      verdict,
      amount: approved?.amount ?? null,
      tenure: approved?.tenure ?? null,
      conditions,
      rationale,
      officerId: viewer.id,
      officerName: viewer.name,
    })
  }

  if (verdict === 'approve') {
    const changed = approved.amount !== application.amount || approved.tenure !== application.tenure
    const needsAcceptance = settings.offers.requireAcceptance
    return {
      changes: {
        status: 'approved',
        decidedAt: new Date(),
        approvedAmount: approved.amount,
        approvedTenure: approved.tenure,
        offerExpiresAt: needsAcceptance ? new Date(Date.now() + settings.offers.expiryDays * 86400000) : null,
        ...(changed
          ? {
              ...(() => {
                const price = priceLoan(approved.amount, approved.tenure, settings.products.find((entry) => entry.id === application.loanType))
                return { totalRepayable: price.total, monthlyInstalment: price.monthly }
              })(),
            }
          : {}),
      },
      event: {
        type: 'decision',
        message: `Approved K${approved.amount.toLocaleString()} over ${approved.tenure} months${conditions ? `. Conditions: ${conditions}` : ''}`,
        visibleToCustomer: true,
      },
      approved: true,
      notify: {
        headline: 'Your loan has been approved',
        body: needsAcceptance
          ? `Good news: your application has been approved for K${approved.amount.toLocaleString()} over ${approved.tenure} months. Sign in to review and accept the offer within ${settings.offers.expiryDays} days.`
          : `Good news: your application has been approved for K${approved.amount.toLocaleString()} over ${approved.tenure} months. We will contact you about the next steps.`,
      },
    }
  }
  return {
    changes: { status: 'declined', decidedAt: new Date() },
    // The applicant sees the outcome, not the internal rationale.
    event: { type: 'decision', message: `Declined: ${rationale}`, customerMessage: 'We were not able to approve this application.', visibleToCustomer: true },
    notify: { headline: 'An update on your application', body: 'We were not able to approve your application this time. You are welcome to apply again in future.' },
  }
}

/**
 * Applies one action. `input.version` must match the row, so an action taken on a stale
 * screen is refused with a prompt to refresh instead of overwriting a colleague's work.
 * Returns { application, result } where result carries `approved` / `notify` hints.
 */
export const applyAction = async (viewer, applicationId, input) => {
  const handler = ACTIONS[input?.action]
  if (!handler) fail(400, 'Unknown action.', 'invalid_input')
  const settings = { workflow: await getSetting('workflow'), offers: await getSetting('offers'), products: await getProducts() }
  const db = await getDb()

  return db.transaction(async (tx) => {
    const [application] = await tx.select().from(applications).where(eq(applications.id, applicationId)).limit(1)
    if (!application) fail(404, 'Application not found.', 'not_found')
    if (Number(input.version) !== application.version) {
      fail(409, 'Someone else has updated this case. Refresh to see their changes before you continue.', 'stale')
    }

    const result = await handler(tx, viewer, application, input, settings)
    const nextStatus = result.changes.status
    const [updated] = await tx
      .update(applications)
      .set({ ...result.changes, version: application.version + 1, updatedAt: new Date() })
      .where(and(eq(applications.id, application.id), eq(applications.version, application.version)))
      .returning()
    if (!updated) fail(409, 'Someone else has updated this case. Refresh and try again.', 'stale')

    const { customerMessage, ...event } = result.event
    await addEvent(tx, {
      applicationId: application.id,
      actor: viewer,
      fromStatus: nextStatus && nextStatus !== application.status ? application.status : null,
      toStatus: nextStatus && nextStatus !== application.status ? nextStatus : null,
      ...event,
      // The customer-facing copy of a staff message, where the two differ.
      ...(customerMessage ? { detail: { customerMessage } } : {}),
    })
    return { application: updated, result }
  })
}
