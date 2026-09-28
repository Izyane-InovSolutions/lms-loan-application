// No provider configured for this deployment. Endpoints answer 503 so the client can
// quietly hide AI features instead of showing an error the applicant cannot act on.
export class AiUnavailableError extends Error {
  constructor(message = 'AI analysis is not configured for this deployment.') {
    super(message)
    this.name = 'AiUnavailableError'
  }
}

// The configured model cannot take this input — e.g. a PDF sent to a self-hosted Gemma,
// which only accepts images. Not a failure of the request, so it is reported as skipped.
export class AiUnsupportedInputError extends Error {
  constructor(message) {
    super(message)
    this.name = 'AiUnsupportedInputError'
  }
}

export class AiProviderError extends Error {
  constructor(message, { status, retryable = false } = {}) {
    super(message)
    this.name = 'AiProviderError'
    this.status = status
    this.retryable = retryable
  }
}

// Rate limits and overloaded backends clear up on their own; a 400 (bad schema, bad
// key) fails identically however often it is repeated.
export const isRetryableStatus = (status) => status === 429 || status >= 500

// Billing and quota problems come back under several statuses depending on the provider
// (Gemini uses 429 RESOURCE_EXHAUSTED, 403 or 400 for billing), so the body is checked too.
const PROVIDER_CAPACITY_PATTERN = /quota|billing|credit|exhausted|overloaded|unavailable|prepayment/i

/**
 * Maps a failed model call to the response the client acts on. `code` is what the wizard
 * keys its message off; the provider's own error text is logged, never returned.
 */
export const classifyAiFailure = (error) => {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
    return { status: 504, code: 'timeout', message: 'The automatic check timed out.' }
  }
  if (error instanceof AiProviderError) {
    const status = error.status
    if ([402, 403, 429].includes(status) || status >= 500 || PROVIDER_CAPACITY_PATTERN.test(error.message)) {
      return { status: 503, code: 'provider_unavailable', message: 'Automatic checks are unavailable right now.' }
    }
  }
  return { status: 502, code: 'check_failed', message: 'The automatic check failed.' }
}
