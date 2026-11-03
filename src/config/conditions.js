/**
 * An offer's conditions: what must be done before the loan is booked and paid out — a
 * payroll deduction confirmed, insurance in place, a guarantor signed. The approver writes
 * them, one per line; they are kept on the case as a checklist (applications.checks.conditions:
 * [{ id, text, met, note, by, byName, at }]). Until each is ticked off, the LMS hand-off that
 * books the loan and "Mark as paid out" wait.
 */

/** The approver's conditions text as a checklist: one per line (or per "; "), all open. */
export const parseConditions = (text) =>
  String(text || '')
    .split(/\n|;\s+/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter((line) => line.length >= 3)
    .slice(0, 20)
    .map((line, index) => ({ id: `c${index + 1}`, text: line.slice(0, 300), met: false, note: null, by: null, byName: null, at: null }))

/** The case's conditions. */
export const conditionsOf = (application) => (Array.isArray(application?.checks?.conditions) ? application.checks.conditions : [])

/** Those not yet met. */
export const openConditions = (application) => conditionsOf(application).filter((condition) => !condition.met)
