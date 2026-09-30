import { AiProviderError, isRetryableStatus } from '../errors.js'
import { googleAccessToken, parseServiceAccount } from '../cloud/google.js'

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

/*
 * Google Gemini via the REST generateContent endpoint — either the Gemini API (AI Studio
 * key) or Vertex AI (service account), which take the same request body.
 *
 * Plain fetch rather than an SDK: the whole integration is one request shape, and keeping
 * it dependency-free means the adapters next to it are true drop-ins with the same inputs
 * and outputs.
 *
 * Gemini reads PDFs natively, so documents are sent as-is — no rasterising or OCR step.
 * Temperature is left at the model default: Google advises against lowering it on
 * Gemini 3 models, and the JSON schema already constrains the output.
 *
 * Thinking is turned down to "low": Gemini 3 models otherwise reason at length before
 * answering, which on multi-page PDFs such as payslips was enough to hit the timeout,
 * and reading fields off a document does not need it. Gemini 2.x models take a
 * thinkingBudget instead and reject thinkingLevel, so they keep their defaults.
 */
const supportsThinkingLevel = (model) => !/^gemini-[12]\./.test(model)

const acceptsMimeType = (mimeType) => mimeType === 'application/pdf' || mimeType.startsWith('image/')

const requestBody = ({ system, text, files, schema, model }) =>
  JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: [
      {
        role: 'user',
        parts: [...files.map((file) => ({ inlineData: { mimeType: file.mimeType, data: file.data.toString('base64') } })), { text }],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseJsonSchema: schema,
      ...(supportsThinkingLevel(model) ? { thinkingConfig: { thinkingLevel: 'low' } } : {}),
    },
  })

const readResponse = async (response, label) => {
  if (!response.ok) {
    // Error bodies carry Google's explanation (bad model id, invalid schema, quota) and
    // never echo the key, so a snippet is safe to log and is what makes these debuggable.
    const detail = (await response.text().catch(() => '')).slice(0, 500)
    throw new AiProviderError(`${label} request failed (${response.status}): ${detail}`, {
      status: response.status,
      retryable: isRetryableStatus(response.status),
    })
  }
  const body = await response.json()
  const candidate = body.candidates?.[0]
  const output = (candidate?.content?.parts || []).map((part) => (part.thought ? '' : part.text || '')).join('')
  if (!output) {
    const reason = candidate?.finishReason || body.promptFeedback?.blockReason || 'unknown'
    throw new AiProviderError(`${label} returned no content (reason: ${reason}).`)
  }
  return JSON.parse(output)
}

export const createGeminiProvider = ({ apiKey, model }) => ({
  name: 'gemini',
  model,
  acceptsMimeType,

  async generateJson({ system, text, files = [], schema, timeoutMs }) {
    const response = await fetch(`${GEMINI_BASE_URL}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: requestBody({ system, text, files, schema, model }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    return readResponse(response, 'Gemini')
  },
})

/**
 * Gemini on Vertex AI: the same models under Google Cloud's enterprise terms, billed to a
 * Cloud project. "global" is the default location; regional ones keep data in a region.
 */
export const createVertexProvider = ({ serviceAccount, project, location, model }) => ({
  name: 'vertex',
  model,
  acceptsMimeType,

  async generateJson({ system, text, files = [], schema, timeoutMs }) {
    const projectId = project || parseServiceAccount(serviceAccount).project_id
    const host = location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`
    const token = await googleAccessToken(serviceAccount)
    const response = await fetch(
      `https://${host}/v1/projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: requestBody({ system, text, files, schema, model }),
        signal: AbortSignal.timeout(timeoutMs),
      }
    )
    return readResponse(response, 'Vertex AI')
  },
})
