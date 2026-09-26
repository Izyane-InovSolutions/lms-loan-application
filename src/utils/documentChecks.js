/*
 * Deterministic checks between what a document says and what the applicant typed.
 *
 * Run in the browser at render time against the current form, not once at upload: an
 * applicant who fixes a typo in their NRC after uploading sees the warning clear at once,
 * with no second model call. The model only extracts; matching is done here, where it is
 * predictable and testable.
 */

const digits = (value) => String(value || '').replace(/\D/g, '')

const nameTokens = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1)

// Documents print names in varying order and often drop middle names, so this asks for
// overlap rather than equality: two shared names, or the only one when a side has one.
const namesMatch = (a, b) => {
  const left = new Set(nameTokens(a))
  const right = nameTokens(b)
  if (!left.size || !right.length) return true
  const shared = right.filter((token) => left.has(token)).length
  return shared >= Math.min(2, left.size, right.length)
}

const COMPANY_SUFFIXES = /\b(limited|ltd|plc|company|co|incorporated|inc|enterprises?)\b/g

const companyKey = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(COMPANY_SUFFIXES, ' ')
    .replace(/[^a-z0-9]/g, '')

const companiesMatch = (a, b) => {
  const left = companyKey(a)
  const right = companyKey(b)
  if (!left || !right) return true
  return left.includes(right) || right.includes(left)
}

/**
 * @param analysis  result from /api/ai/analyze-document
 * @param expected  { name?, nrc?, companyName? } from the current form
 * @returns applicant-facing messages; empty when everything that can be compared agrees
 */
export const findFormMismatches = (analysis, expected = {}) => {
  const extracted = analysis?.extracted || {}
  const mismatches = []

  if (expected.nrc && extracted.nrcNumber && digits(expected.nrc) !== digits(extracted.nrcNumber)) {
    mismatches.push(
      `The NRC number on this document (${extracted.nrcNumber}) doesn't match the one you entered (${expected.nrc}).`
    )
  }

  if (expected.name && extracted.holderName && !namesMatch(expected.name, extracted.holderName)) {
    mismatches.push(`This document is in the name of ${extracted.holderName}, but you entered ${expected.name}.`)
  }

  if (expected.companyName) {
    const documentCompany = extracted.companyName || (expected.holderIsCompany ? extracted.holderName : '')
    if (documentCompany && !companiesMatch(expected.companyName, documentCompany)) {
      mismatches.push(
        `This document is for ${documentCompany}, but the company name you entered is ${expected.companyName}.`
      )
    }
  }

  return mismatches
}

/** Everything to show under an upload: the model's issues first, then form mismatches. */
export const documentNotes = (analysis, expected) => {
  if (!analysis) return []
  const notes = analysis.issues.map((issue) => issue.message)
  if (!analysis.matchesExpectedType && !analysis.issues.some((issue) => issue.code === 'wrong_document')) {
    notes.unshift(
      analysis.detectedType
        ? `This looks like a ${analysis.detectedType}, not the document requested here.`
        : "This doesn't look like the document requested here."
    )
  }
  return [...notes, ...findFormMismatches(analysis, expected)]
}
