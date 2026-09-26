import { AiProviderError, AiUnsupportedInputError, isRetryableStatus } from '../errors.js'

/*
 * Any server speaking the OpenAI Chat Completions API — the route for self-hosting Gemma.
 * Ollama (`<host>:11434/v1`), vLLM (`<host>:8000/v1`) and llama.cpp's server all expose
 * it, as does Gemini's own OpenAI-compatible endpoint, so switching models is a matter of
 * AI_BASE_URL / AI_MODEL rather than code.
 *
 * Gemma 3 and later take images but not PDFs. Almost every document in this flow is a PDF,
 * so until a PDF-to-image step exists here, those files are reported as unsupported and
 * the endpoint answers "skipped" — the applicant just sees no AI note. Passport photos
 * (images) and the text-only prescreen work unchanged.
 */
export const createOpenAiCompatibleProvider = ({ baseUrl, apiKey, model }) => ({
  name: 'openai-compatible',
  model,
  acceptsMimeType: (mimeType) => mimeType.startsWith('image/'),

  async generateJson({ system, text, files = [], schema, schemaName, timeoutMs }) {
    const unsupported = files.find((file) => !file.mimeType.startsWith('image/'))
    if (unsupported) {
      throw new AiUnsupportedInputError(`${model} cannot read ${unsupported.mimeType} files.`)
    }

    const content = [
      { type: 'text', text },
      ...files.map((file) => ({
        type: 'image_url',
        image_url: { url: `data:${file.mimeType};base64,${file.data.toString('base64')}` },
      })),
    ]

    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
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
      const detail = (await response.text().catch(() => '')).slice(0, 500)
      throw new AiProviderError(`${model} request failed (${response.status}): ${detail}`, {
        status: response.status,
        retryable: isRetryableStatus(response.status),
      })
    }

    const body = await response.json()
    const output = body.choices?.[0]?.message?.content
    if (!output) {
      throw new AiProviderError(`${model} returned no content (finish_reason: ${body.choices?.[0]?.finish_reason}).`)
    }
    return JSON.parse(output)
  },
})
