import Anthropic from '@anthropic-ai/sdk'
import { AiProviderError, isRetryableStatus } from '../errors.js'

/*
 * Anthropic Claude through the official SDK. PDFs go in as base64 `document` blocks and
 * photos as `image` blocks, both read natively; the JSON schema is enforced with
 * structured outputs (`output_config.format`).
 *
 * The SDK's own retries are off (maxRetries: 0): index.js decides whether to retry the
 * same provider or move on to a fallback, and double retrying would eat the time budget.
 *
 * Effort is set to "medium" on the models that take it — reading fields off a document
 * doesn't need deep reasoning. On the newest models a request declined by Anthropic's
 * safety classifiers is re-run server-side on Anthropic's recommended fallback model
 * (`fallbacks: "default"`) rather than coming back as a refusal.
 */
const EFFORT_MODELS = /^claude-(fable|mythos|opus-5|sonnet-5|opus-4-[678]|sonnet-4-6)/
const SERVER_FALLBACK_MODELS = /^claude-(fable-5-1|opus-5-5|opus-5|sonnet-5-5)$/
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

export const createAnthropicProvider = ({ apiKey, model }) => ({
  name: 'anthropic',
  model,
  acceptsMimeType: (mimeType) => mimeType === 'application/pdf' || IMAGE_TYPES.includes(mimeType),

  async generateJson({ system, text, files = [], schema, timeoutMs }) {
    const client = new Anthropic({ apiKey, maxRetries: 0 })
    const content = [
      ...files.map((file) => {
        const data = file.data.toString('base64')
        return file.mimeType === 'application/pdf'
          ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
          : { type: 'image', source: { type: 'base64', media_type: file.mimeType, data } }
      }),
      { type: 'text', text },
    ]
    const params = {
      model,
      max_tokens: 16000,
      system,
      messages: [{ role: 'user', content }],
      output_config: { format: { type: 'json_schema', schema }, ...(EFFORT_MODELS.test(model) ? { effort: 'medium' } : {}) },
    }

    let response
    try {
      response = SERVER_FALLBACK_MODELS.test(model)
        ? await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, { timeout: timeoutMs })
        : await client.messages.create(params, { timeout: timeoutMs })
    } catch (error) {
      if (error instanceof Anthropic.APIConnectionTimeoutError) {
        const timeout = new Error('The operation was aborted due to timeout')
        timeout.name = 'TimeoutError'
        throw timeout
      }
      if (error instanceof Anthropic.APIError && error.status) {
        // 529 (overloaded) and 429 are retryable and count as "provider unavailable".
        throw new AiProviderError(`Claude request failed (${error.status}): ${String(error.message).slice(0, 500)}`, {
          status: error.status,
          retryable: isRetryableStatus(error.status),
        })
      }
      throw error
    }

    if (response.stop_reason === 'refusal') {
      throw new AiProviderError(`Claude declined to check this file (${response.stop_details?.category || 'no category given'}).`)
    }
    if (response.stop_reason === 'max_tokens') {
      throw new AiProviderError('Claude ran out of output space before finishing the check.')
    }
    const output = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')
    if (!output) throw new AiProviderError(`Claude returned no content (stop_reason: ${response.stop_reason}).`)
    return JSON.parse(output)
  },
})
