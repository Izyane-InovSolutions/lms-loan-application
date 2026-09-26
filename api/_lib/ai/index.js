import { createGeminiProvider } from './providers/gemini.js'
import { createOpenAiCompatibleProvider } from './providers/openaiCompatible.js'
import { AiProviderError, AiUnavailableError } from './errors.js'

export { AiProviderError, AiUnavailableError, AiUnsupportedInputError } from './errors.js'

const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash'
const DEFAULT_TIMEOUT_MS = 60000
const RETRY_DELAYS_MS = [1500, 4000]

const env = (name) => (process.env[name] || '').trim()

/*
 * Resolves the configured model backend, or null when none is set up.
 *
 *   AI_PROVIDER=gemini             (default) GEMINI_API_KEY, optional GEMINI_MODEL
 *   AI_PROVIDER=openai-compatible  AI_BASE_URL, AI_MODEL, optional AI_API_KEY
 *
 * Read per call, not at module scope, for the same reason as blob.js: a Sensitive
 * variable is absent at build time, and a boot-time snapshot would pin it as missing.
 */
export const getAiProvider = () => {
  const provider = env('AI_PROVIDER') || 'gemini'

  if (provider === 'gemini') {
    const apiKey = env('GEMINI_API_KEY')
    if (!apiKey) return null
    return createGeminiProvider({ apiKey, model: env('GEMINI_MODEL') || DEFAULT_GEMINI_MODEL })
  }

  if (provider === 'openai-compatible') {
    const baseUrl = env('AI_BASE_URL')
    const model = env('AI_MODEL')
    if (!baseUrl || !model) return null
    return createOpenAiCompatibleProvider({ baseUrl, model, apiKey: env('AI_API_KEY') })
  }

  throw new Error(`Unknown AI_PROVIDER "${provider}". Use "gemini" or "openai-compatible".`)
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Runs one structured-output request against the configured provider and returns the
 * parsed JSON. `files` are `{ mimeType, data: Buffer }`. Transient provider failures
 * (429, 5xx) are retried; everything else surfaces immediately.
 */
export const generateJson = async ({ system, text, files = [], schema, schemaName, timeoutMs = DEFAULT_TIMEOUT_MS }) => {
  const provider = getAiProvider()
  if (!provider) throw new AiUnavailableError()

  for (let attempt = 0; ; attempt += 1) {
    try {
      const result = await provider.generateJson({ system, text, files, schema, schemaName, timeoutMs })
      return { result, provider: provider.name, model: provider.model }
    } catch (error) {
      const retryable = error instanceof AiProviderError && error.retryable
      if (!retryable || attempt >= RETRY_DELAYS_MS.length) throw error
      await wait(RETRY_DELAYS_MS[attempt])
    }
  }
}
