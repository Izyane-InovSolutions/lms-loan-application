import { AiProviderError, AiUnsupportedInputError, isRetryableStatus } from '../errors.js'

/*
 * The OpenAI Chat Completions request shape, which three of the options speak:
 *
 *   openai             api.openai.com; reads PDFs (as a base64 `file` part) and images
 *   azure-openai       an Azure OpenAI resource's v1 endpoint, the deployment as `model`
 *   openai-compatible  a self-hosted server — Ollama (`<host>:11434/v1`), vLLM
 *                      (`<host>:8000/v1`), llama.cpp — usually running Gemma
 *
 * Gemma 3 and later take images but not PDFs, and almost every document in this flow is a
 * PDF. For the self-hosted option those files either go through the OCR step (Settings →
 * AI document checks) or are skipped, and the applicant just sees no AI note.
 *
 * Temperature is pinned to 0 only for self-hosted models: OpenAI's reasoning models reject
 * any value but the default, and the JSON schema already constrains the output.
 */
const chatCompletionsProvider = ({ name, url, headers, model, readsPdf, temperature }) => {
  const acceptsMimeType = (mimeType) => mimeType.startsWith('image/') || (readsPdf && mimeType === 'application/pdf')

  return {
    name,
    model,
    acceptsMimeType,

    async generateJson({ system, text, files = [], schema, schemaName, timeoutMs }) {
      const unsupported = files.find((file) => !acceptsMimeType(file.mimeType))
      if (unsupported) {
        throw new AiUnsupportedInputError(`${model} cannot read ${unsupported.mimeType} files.`)
      }

      const content = [
        { type: 'text', text },
        ...files.map((file) => {
          const dataUrl = `data:${file.mimeType};base64,${file.data.toString('base64')}`
          return file.mimeType === 'application/pdf'
            ? { type: 'file', file: { filename: 'document.pdf', file_data: dataUrl } }
            : { type: 'image_url', image_url: { url: dataUrl } }
        }),
      ]

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          model,
          ...(temperature === undefined ? {} : { temperature }),
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
      const message = body.choices?.[0]?.message
      if (message?.refusal) throw new AiProviderError(`${model} declined: ${String(message.refusal).slice(0, 200)}`)
      const output = message?.content
      if (!output) {
        throw new AiProviderError(`${model} returned no content (finish_reason: ${body.choices?.[0]?.finish_reason}).`)
      }
      return JSON.parse(output)
    },
  }
}

export const createOpenAiCompatibleProvider = ({ baseUrl, apiKey, model }) =>
  chatCompletionsProvider({
    name: 'openai-compatible',
    url: `${baseUrl.replace(/\/+$/, '')}/chat/completions`,
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    model,
    readsPdf: false,
    temperature: 0,
  })

export const createOpenAiProvider = ({ apiKey, model }) =>
  chatCompletionsProvider({
    name: 'openai',
    url: 'https://api.openai.com/v1/chat/completions',
    headers: { Authorization: `Bearer ${apiKey}` },
    model,
    readsPdf: true,
  })

// Azure's v1 API takes the deployment name as `model`, with no api-version to track.
export const createAzureOpenAiProvider = ({ endpoint, apiKey, deployment }) =>
  chatCompletionsProvider({
    name: 'azure-openai',
    url: `${endpoint.replace(/\/+$/, '')}/openai/v1/chat/completions`,
    headers: { 'api-key': apiKey },
    model: deployment,
    readsPdf: true,
  })
