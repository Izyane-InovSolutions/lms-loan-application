import { AiProviderError, isRetryableStatus } from '../errors.js'

const MISTRAL_BASE_URL = 'https://api.mistral.ai/v1'

/*
 * Mistral's Chat Completions API (La Plateforme).
 *
 * Same request shape as the OpenAI-compatible adapter, with two Mistral specifics: PDFs go
 * in as a base64 `document_url` part (Mistral reads them natively, so no rasterising), and
 * images as a plain data-URL string in `image_url`. The JSON schema is enforced with
 * strict structured output, which accepts the same subset documents.js keeps to.
 *
 * The default model (mistral-small-latest) reads both PDFs and images; any vision-capable
 * Mistral model can be chosen in Settings → AI document checks.
 */
export const createMistralProvider = ({ apiKey, model }) => ({
  name: 'mistral',
  model,
  acceptsMimeType: (mimeType) => mimeType === 'application/pdf' || mimeType.startsWith('image/'),

  async generateJson({ system, text, files = [], schema, schemaName, timeoutMs }) {
    const content = [
      { type: 'text', text },
      ...files.map((file) => {
        const url = `data:${file.mimeType};base64,${file.data.toString('base64')}`
        return file.mimeType === 'application/pdf' ? { type: 'document_url', document_url: url } : { type: 'image_url', image_url: url }
      }),
    ]

    const response = await fetch(`${MISTRAL_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: schemaName, schema, strict: true },
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })

    if (!response.ok) {
      // Mistral's error bodies name the problem (unknown model, invalid schema, rate
      // limit) and never echo the key.
      const detail = (await response.text().catch(() => '')).slice(0, 500)
      throw new AiProviderError(`Mistral request failed (${response.status}): ${detail}`, {
        status: response.status,
        retryable: isRetryableStatus(response.status),
      })
    }

    const body = await response.json()
    const message = body.choices?.[0]?.message
    // Reasoning models answer with a list of chunks rather than a single string.
    const output = Array.isArray(message?.content)
      ? message.content.map((chunk) => (chunk.type === 'text' ? chunk.text : '')).join('')
      : message?.content
    if (!output) {
      throw new AiProviderError(`Mistral returned no content (finish_reason: ${body.choices?.[0]?.finish_reason}).`)
    }
    return JSON.parse(output)
  },
})
