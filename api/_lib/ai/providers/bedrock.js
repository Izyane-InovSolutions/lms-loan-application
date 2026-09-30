import { AiProviderError, isRetryableStatus } from '../errors.js'
import { awsPost } from '../cloud/aws.js'

/*
 * Amazon Bedrock through the Converse API, which gives every Bedrock model (Claude,
 * Mistral, Nova, Llama…) one request shape. PDFs go in as `document` blocks and photos as
 * `image` blocks; whether a given model reads them is up to the model.
 *
 * Converse has no JSON-schema response mode shared by all models, so the schema is given
 * as a tool and the model is asked to call it. Tool choice is left on "auto" because the
 * newest Claude models reject a forced tool choice; a model that answers in plain JSON
 * text instead is accepted too.
 */
const IMAGE_FORMATS = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' }
const TOOL_NAME = 'record_result'

export const createBedrockProvider = ({ accessKeyId, secretAccessKey, region, model }) => ({
  name: 'bedrock',
  model,
  acceptsMimeType: (mimeType) => mimeType === 'application/pdf' || Boolean(IMAGE_FORMATS[mimeType]),

  async generateJson({ system, text, files = [], schema, timeoutMs }) {
    const content = [
      ...files.map((file) => {
        const bytes = file.data.toString('base64')
        return file.mimeType === 'application/pdf'
          ? { document: { format: 'pdf', name: 'uploaded document', source: { bytes } } }
          : { image: { format: IMAGE_FORMATS[file.mimeType], source: { bytes } } }
      }),
      { text: `${text}\n\nGive your answer by calling the ${TOOL_NAME} tool.` },
    ]
    const body = JSON.stringify({
      system: [{ text: system }],
      messages: [{ role: 'user', content }],
      toolConfig: {
        tools: [{ toolSpec: { name: TOOL_NAME, description: 'Records the result of the check.', inputSchema: { json: schema } } }],
        toolChoice: { auto: {} },
      },
      inferenceConfig: { maxTokens: 8000 },
    })

    const response = await awsPost({
      service: 'bedrock',
      region,
      host: `bedrock-runtime.${region}.amazonaws.com`,
      path: `/model/${model}/converse`,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body,
      accessKeyId,
      secretAccessKey,
      timeoutMs,
    })

    if (!response.ok) {
      // ThrottlingException (429), ServiceUnavailableException (503), ModelNotReadyException…
      const detail = (await response.text().catch(() => '')).slice(0, 500)
      throw new AiProviderError(`Bedrock request failed (${response.status}): ${detail}`, {
        status: response.status,
        retryable: isRetryableStatus(response.status),
      })
    }

    const result = await response.json()
    const blocks = result.output?.message?.content || []
    const toolUse = blocks.find((block) => block.toolUse?.name === TOOL_NAME)
    if (toolUse) return toolUse.toolUse.input
    const output = blocks.map((block) => block.text || '').join('').trim()
    if (!output) throw new AiProviderError(`Bedrock returned no content (stopReason: ${result.stopReason}).`)
    return JSON.parse(output.replace(/^```(?:json)?\s*|\s*```$/g, ''))
  },
})
