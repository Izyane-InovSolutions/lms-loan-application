import { AiProviderError, isRetryableStatus } from '../errors.js'

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

/*
 * Google Gemini via the REST generateContent endpoint.
 *
 * Plain fetch rather than an SDK: the whole integration is one request shape, and keeping
 * it dependency-free means the OpenAI-compatible adapter next to it (used for self-hosted
 * Gemma) is a true drop-in with the same inputs and outputs.
 *
 * Gemini reads PDFs natively, so documents are sent as-is — no rasterising or OCR step.
 * Temperature is left at the model default: Google advises against lowering it on
 * Gemini 3 models, and the JSON schema already constrains the output.
 */
export const createGeminiProvider = ({ apiKey, model }) => ({
  name: 'gemini',
  model,
  acceptsMimeType: (mimeType) => mimeType === 'application/pdf' || mimeType.startsWith('image/'),

  async generateJson({ system, text, files = [], schema, timeoutMs }) {
    const parts = [
      ...files.map((file) => ({
        inline_data: { mime_type: file.mimeType, data: file.data.toString('base64') },
      })),
      { text },
    ]

    const response = await fetch(`${GEMINI_BASE_URL}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseJsonSchema: schema,
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })

    if (!response.ok) {
      // Error bodies carry Google's explanation (bad model id, invalid schema, quota) and
      // never echo the key, so a snippet is safe to log and is what makes these debuggable.
      const detail = (await response.text().catch(() => '')).slice(0, 500)
      throw new AiProviderError(`Gemini request failed (${response.status}): ${detail}`, {
        status: response.status,
        retryable: isRetryableStatus(response.status),
      })
    }

    const body = await response.json()
    const candidate = body.candidates?.[0]
    const output = (candidate?.content?.parts || []).map((part) => part.text || '').join('')
    if (!output) {
      const reason = candidate?.finishReason || body.promptFeedback?.blockReason || 'unknown'
      throw new AiProviderError(`Gemini returned no content (reason: ${reason}).`)
    }
    return JSON.parse(output)
  },
})
