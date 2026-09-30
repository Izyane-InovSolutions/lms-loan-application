import { AiProviderError, isRetryableStatus } from './errors.js'
import { awsPost } from './cloud/aws.js'
import { googleAccessToken, parseServiceAccount } from './cloud/google.js'

/*
 * OCR engines: each turns one uploaded file into plain text, for the optional step before
 * the model (index.js). They all share one shape:
 *
 *   { name, label, acceptsMimeType(mimeType), extractText({ mimeType, data }, { timeoutMs }) }
 *
 * OCR only reads text. Judging what the document is and pulling out fields stays with the
 * model; the OCR text is what lets a model that can't open PDFs (a self-hosted Gemma) do
 * that, or gives a model that can a second reading of a poor scan.
 */

const failIfNotOk = async (response, label) => {
  if (response.ok) return
  const detail = (await response.text().catch(() => '')).slice(0, 500)
  throw new AiProviderError(`${label} failed (${response.status}): ${detail}`, { status: response.status, retryable: isRetryableStatus(response.status) })
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const dataUrl = (file) => `data:${file.mimeType};base64,${file.data.toString('base64')}`
const pdfOrImage = (mimeType) => mimeType === 'application/pdf' || mimeType.startsWith('image/')

/** Mistral OCR: a PDF or photo in, Markdown per page out. Uses the Mistral connection's key. */
export const createMistralOcr = ({ apiKey, model }) => ({
  name: 'mistral-ocr',
  label: 'Mistral OCR',
  acceptsMimeType: pdfOrImage,

  async extractText(file, { timeoutMs }) {
    const document = file.mimeType === 'application/pdf' ? { type: 'document_url', document_url: dataUrl(file) } : { type: 'image_url', image_url: dataUrl(file) }
    const response = await fetch('https://api.mistral.ai/v1/ocr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, document }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    await failIfNotOk(response, 'Mistral OCR')
    const body = await response.json()
    return (body.pages || []).map((page) => page.markdown || '').join('\n\n')
  },
})

/**
 * Azure AI Document Intelligence: submit, then poll the operation until it finishes.
 * "prebuilt-read" is plain OCR; "prebuilt-layout" also keeps tables.
 */
export const createAzureDocumentIntelligenceOcr = ({ endpoint, apiKey, model }) => ({
  name: 'azure-document-intelligence',
  label: 'Azure Document Intelligence',
  acceptsMimeType: pdfOrImage,

  async extractText(file, { timeoutMs }) {
    const deadline = Date.now() + timeoutMs
    const headers = { 'Ocp-Apim-Subscription-Key': apiKey }
    const submitted = await fetch(`${endpoint.replace(/\/+$/, '')}/documentintelligence/documentModels/${encodeURIComponent(model)}:analyze?api-version=2024-11-30`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64Source: file.data.toString('base64') }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    await failIfNotOk(submitted, 'Azure Document Intelligence')
    const operation = submitted.headers.get('operation-location')
    if (!operation) throw new AiProviderError('Azure Document Intelligence did not return an operation to poll.')

    for (;;) {
      await wait(Math.min(Number(submitted.headers.get('retry-after')) * 1000 || 1000, 2000))
      if (Date.now() > deadline) {
        const timeout = new Error('The operation was aborted due to timeout')
        timeout.name = 'TimeoutError'
        throw timeout
      }
      const polled = await fetch(operation, { headers, signal: AbortSignal.timeout(Math.max(deadline - Date.now(), 1)) })
      await failIfNotOk(polled, 'Azure Document Intelligence')
      const body = await polled.json()
      if (body.status === 'succeeded') return body.analyzeResult?.content || ''
      if (body.status === 'failed') throw new AiProviderError(`Azure Document Intelligence could not read the file: ${body.error?.message || 'no reason given'}`)
    }
  },
})

/** Google Document AI, through an OCR processor created in the Cloud console. */
export const createGoogleDocumentAiOcr = ({ serviceAccount, project, location, processorId }) => ({
  name: 'google-document-ai',
  label: 'Google Document AI',
  acceptsMimeType: pdfOrImage,

  async extractText(file, { timeoutMs }) {
    const projectId = project || parseServiceAccount(serviceAccount).project_id
    const token = await googleAccessToken(serviceAccount)
    const response = await fetch(
      `https://${location}-documentai.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(location)}/processors/${encodeURIComponent(processorId)}:process`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ rawDocument: { content: file.data.toString('base64'), mimeType: file.mimeType } }),
        signal: AbortSignal.timeout(timeoutMs),
      }
    )
    await failIfNotOk(response, 'Google Document AI')
    const body = await response.json()
    return body.document?.text || ''
  },
})

/**
 * AWS Textract's synchronous text detection. It takes photos and single-page PDFs only —
 * a longer PDF fails here, and index.js then sends the file to the model as it is.
 */
export const createTextractOcr = ({ accessKeyId, secretAccessKey, region }) => ({
  name: 'aws-textract',
  label: 'AWS Textract',
  acceptsMimeType: (mimeType) => ['application/pdf', 'image/jpeg', 'image/png', 'image/tiff'].includes(mimeType),

  async extractText(file, { timeoutMs }) {
    const response = await awsPost({
      service: 'textract',
      region,
      host: `textract.${region}.amazonaws.com`,
      path: '/',
      headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'Textract.DetectDocumentText' },
      body: JSON.stringify({ Document: { Bytes: file.data.toString('base64') } }),
      accessKeyId,
      secretAccessKey,
      timeoutMs,
    })
    await failIfNotOk(response, 'AWS Textract')
    const body = await response.json()
    return (body.Blocks || [])
      .filter((block) => block.BlockType === 'LINE')
      .map((block) => block.Text)
      .join('\n')
  },
})
