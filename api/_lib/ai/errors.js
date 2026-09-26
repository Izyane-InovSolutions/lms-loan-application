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
