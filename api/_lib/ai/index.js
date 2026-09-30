import { Buffer } from 'node:buffer'
import { createGeminiProvider, createVertexProvider } from './providers/gemini.js'
import { createMistralProvider } from './providers/mistral.js'
import { createAnthropicProvider } from './providers/anthropic.js'
import { createAzureOpenAiProvider, createOpenAiCompatibleProvider, createOpenAiProvider } from './providers/openaiCompatible.js'
import { createBedrockProvider } from './providers/bedrock.js'
import { createAzureDocumentIntelligenceOcr, createGoogleDocumentAiOcr, createMistralOcr, createTextractOcr } from './ocr.js'
import { AiProviderError, AiUnavailableError, AiUnsupportedInputError, classifyAiFailure } from './errors.js'
import { getSetting, SETTING_DEFAULTS } from '../settings.js'
import { AI_CONNECTIONS, AI_FIELDS, AI_MODEL_PROVIDERS, OCR_ENGINES, isServiceReady } from '../../../src/config/aiProviders.js'

export { AiProviderError, AiUnavailableError, AiUnsupportedInputError, classifyAiFailure } from './errors.js'

const DEFAULT_TIMEOUT_MS = 100000
const MIN_ATTEMPT_MS = 15000
// Time held back for the fallback provider, so a primary that hangs until its timeout
// still leaves the next one a fair attempt within the same request.
const FALLBACK_RESERVE_MS = 40000
const RETRY_DELAYS_MS = [1500, 4000]
const OCR_TIMEOUT_MS = 30000
// A safety cap on OCR text added to the prompt; a few pages of payslip is a few thousand.
const MAX_OCR_CHARS = 100000
const TEST_TIMEOUT_MS = 30000

const env = (name) => (process.env[name] || '').trim()

/*
 * Which backends to use comes from Settings → AI document checks (settings.js `ai`); the
 * connections themselves are described in src/config/aiProviders.js. Every field left
 * blank in Settings falls back to its environment variable, then to its default, and
 * provider "environment" follows AI_PROVIDER (default gemini).
 *
 * Read per call, not at module scope: a Settings change applies to the next request, and
 * (as in blob.js) a Sensitive variable is absent at build time, so a boot-time snapshot
 * would pin it as missing.
 */
const readSetting = async () => {
  try {
    return await getSetting('ai')
  } catch (error) {
    // Without the database the environment still describes a working setup.
    console.error('[ai] could not read the AI settings; using the environment', String(error?.message || error))
    return SETTING_DEFAULTS.ai
  }
}

const resolveValues = (setting, overrides = {}) =>
  Object.fromEntries(AI_FIELDS.map((field) => [field.key, String(overrides[field.key] || setting[field.key] || env(field.env) || field.default || '').trim()]))

const PROVIDER_FACTORIES = {
  gemini: (v) => createGeminiProvider({ apiKey: v.geminiApiKey, model: v.geminiModel }),
  mistral: (v) => createMistralProvider({ apiKey: v.mistralApiKey, model: v.mistralModel }),
  anthropic: (v) => createAnthropicProvider({ apiKey: v.anthropicApiKey, model: v.anthropicModel }),
  openai: (v) => createOpenAiProvider({ apiKey: v.openaiApiKey, model: v.openaiModel }),
  'azure-openai': (v) => createAzureOpenAiProvider({ endpoint: v.azureOpenaiEndpoint, apiKey: v.azureOpenaiApiKey, deployment: v.azureOpenaiDeployment }),
  vertex: (v) => createVertexProvider({ serviceAccount: v.googleServiceAccount, project: v.googleProject, location: v.vertexLocation, model: v.vertexModel }),
  bedrock: (v) => createBedrockProvider({ accessKeyId: v.awsAccessKeyId, secretAccessKey: v.awsSecretAccessKey, region: v.awsRegion, model: v.bedrockModel }),
  'openai-compatible': (v) => createOpenAiCompatibleProvider({ baseUrl: v.openaiCompatibleBaseUrl, apiKey: v.openaiCompatibleApiKey, model: v.openaiCompatibleModel }),
}

const OCR_FACTORIES = {
  'mistral-ocr': (v) => createMistralOcr({ apiKey: v.mistralApiKey, model: v.mistralOcrModel }),
  'azure-document-intelligence': (v) =>
    createAzureDocumentIntelligenceOcr({ endpoint: v.azureDocumentIntelligenceEndpoint, apiKey: v.azureDocumentIntelligenceApiKey, model: v.azureDocumentIntelligenceModel }),
  'google-document-ai': (v) =>
    createGoogleDocumentAiOcr({ serviceAccount: v.googleServiceAccount, project: v.googleProject, location: v.documentAiLocation, processorId: v.documentAiProcessorId }),
  'aws-textract': (v) => createTextractOcr({ accessKeyId: v.awsAccessKeyId, secretAccessKey: v.awsSecretAccessKey, region: v.awsRegion }),
}

// Null when the service is unknown or its connection is missing something it needs.
const build = (catalog, factories, id, values) => {
  const service = catalog.find((entry) => entry.id === id)
  if (!service) {
    if (id && id !== 'off') console.error(`[ai] unknown AI service "${id}"`)
    return null
  }
  return isServiceReady(service, (key) => Boolean(values[key])) ? { ...factories[id](values), label: service.label } : null
}

const resolveSetup = (setting) => {
  const values = resolveValues(setting)
  const choice = setting.provider === 'environment' ? env('AI_PROVIDER') || 'gemini' : setting.provider
  const primary = build(AI_MODEL_PROVIDERS, PROVIDER_FACTORIES, choice, values)
  const fallbacks =
    primary && setting.fallback !== false
      ? (setting.fallbacks || [])
          .filter((id, index, list) => id !== choice && list.indexOf(id) === index)
          .map((id) => build(AI_MODEL_PROVIDERS, PROVIDER_FACTORIES, id, values))
          .filter(Boolean)
      : []
  return {
    choice,
    // A fallback never stands in for a chosen provider that isn't set up.
    providers: primary ? [primary, ...fallbacks] : [],
    ocr: setting.ocr && setting.ocr !== 'off' ? build(OCR_ENGINES, OCR_FACTORIES, setting.ocr, values) : null,
    ocrMode: setting.ocrMode === 'always' ? 'always' : 'when_needed',
  }
}

/** The models to try, in order: the chosen one, then the configured fallbacks. */
export const getAiProviders = async () => resolveSetup(await readSetting()).providers

/** The chosen provider, or null when AI checks are off. */
export const getAiProvider = async () => (await getAiProviders())[0] || null

/** Whether an upload of this type can be checked at all (by a model directly, or after OCR). */
export const canReadMimeType = async (mimeType) => {
  const { providers, ocr } = resolveSetup(await readSetting())
  return providers.some((provider) => provider.acceptsMimeType(mimeType)) || Boolean(providers.length && ocr?.acceptsMimeType(mimeType))
}

/** What is in use, for Settings and System health — names and models only, never keys. */
export const describeAi = async () => {
  const setup = resolveSetup(await readSetting())
  const [active, ...fallbacks] = setup.providers.map((provider) => ({ name: provider.name, label: provider.label, model: provider.model }))
  return {
    active: active || null,
    fallbacks,
    ocr: setup.ocr ? { name: setup.ocr.name, label: setup.ocr.label, mode: setup.ocrMode } : null,
    choice: setup.choice,
    environment: {
      provider: env('AI_PROVIDER') || 'gemini',
      // Which fields have a value in the environment, so the form can say so.
      set: AI_FIELDS.filter((field) => env(field.env)).map((field) => field.key),
    },
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Overload, rate limits, billing and timeouts are the provider's problem, so the next one
// may well answer. A bad schema or an unreadable file would fail there too.
const shouldFallBack = (error) => ['provider_unavailable', 'timeout'].includes(classifyAiFailure(error).code)

const callProvider = async (provider, request, { deadline, reserveMs, retryDelays }) => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const timeoutMs = Math.max(deadline - reserveMs - Date.now(), 1)
      const result = await provider.generateJson({ ...request, timeoutMs })
      return { result, provider: provider.name, model: provider.model }
    } catch (error) {
      const retryable = error instanceof AiProviderError && error.retryable
      if (!retryable || attempt >= retryDelays.length) throw error
      const delay = retryDelays[attempt]
      if (deadline - reserveMs - Date.now() - delay < MIN_ATTEMPT_MS) throw error
      await wait(delay)
    }
  }
}

// OCR failures are logged, not fatal: the model may still read the file itself.
const runOcr = async (ocr, files, timeoutMs) => {
  const texts = []
  for (const file of files.filter((entry) => ocr.acceptsMimeType(entry.mimeType))) {
    try {
      texts.push(await ocr.extractText(file, { timeoutMs }))
    } catch (error) {
      console.warn(`[ai] ${ocr.name} could not read a ${file.mimeType} file`, String(error?.message || error).slice(0, 300))
    }
  }
  const text = texts.join('\n\n').trim()
  if (!text) return null
  return text.length > MAX_OCR_CHARS ? `${text.slice(0, MAX_OCR_CHARS)}\n[OCR text cut off here]` : text
}

const withOcrText = (request, ocr, ocrText, { keepFiles }) => ({
  ...request,
  files: keepFiles ? request.files : [],
  text: `${request.text}\n\n${
    keepFiles ? `Text read from the file by OCR (${ocr.label}), as a second reading; it may contain recognition errors:` : `The file itself could not be sent to you. This is its text as read by OCR (${ocr.label}); it may contain recognition errors, and you cannot see the layout or photos, so judge legibility and authenticity from the text alone:`
  }\n<ocr_text>\n${ocrText}\n</ocr_text>`,
})

/**
 * Runs one structured-output request and returns the parsed JSON with the provider and
 * model that answered. `files` are `{ mimeType, data: Buffer }`.
 *
 * With an OCR engine set, files go through it first — always, or only when some model in
 * line can't read them — and a model that can't open the file gets the OCR text instead.
 *
 * With fallbacks, a busy provider gets one attempt and the request moves on straight away
 * rather than waiting out retries against an overloaded model; the last provider in line
 * retries transient failures (429, 5xx) itself.
 *
 * `timeoutMs` is the budget for the whole call, OCR and fallbacks included, so it has to
 * stay under the 120 s maxDuration of api/ai/* (vercel.json; nginx allows 130 s).
 */
export const generateJson = async ({ system, text, files = [], schema, schemaName, timeoutMs = DEFAULT_TIMEOUT_MS }) => {
  const { providers, ocr, ocrMode } = resolveSetup(await readSetting())
  if (!providers.length) throw new AiUnavailableError()

  const deadline = Date.now() + timeoutMs
  const request = { system, text, files, schema, schemaName }
  const readsAll = (provider) => files.every((file) => provider.acceptsMimeType(file.mimeType))

  let ocrText = null
  if (files.length && ocr && (ocrMode === 'always' || !providers.every(readsAll))) {
    ocrText = await runOcr(ocr, files, Math.max(Math.min(OCR_TIMEOUT_MS, deadline - Date.now() - FALLBACK_RESERVE_MS), 5000))
  }

  const attempts = providers
    .map((provider) => {
      if (readsAll(provider)) return { provider, request: ocrText && ocrMode === 'always' ? withOcrText(request, ocr, ocrText, { keepFiles: true }) : request }
      if (ocrText) return { provider, request: withOcrText(request, ocr, ocrText, { keepFiles: false }) }
      return null
    })
    .filter(Boolean)
  if (!attempts.length) {
    const unreadable = files.find((file) => !providers[0].acceptsMimeType(file.mimeType))
    throw new AiUnsupportedInputError(`${providers[0].model} cannot read ${unreadable.mimeType} files${ocr ? `, and ${ocr.label} found no text in it` : ''}.`)
  }

  for (const [index, { provider, request: attemptRequest }] of attempts.entries()) {
    const isLast = index === attempts.length - 1
    try {
      const answer = await callProvider(provider, attemptRequest, {
        deadline,
        reserveMs: isLast ? 0 : FALLBACK_RESERVE_MS,
        retryDelays: isLast ? RETRY_DELAYS_MS : [],
      })
      return { ...answer, ocr: ocrText && attemptRequest !== request ? ocr.name : null }
    } catch (error) {
      if (isLast || !shouldFallBack(error)) throw error
      const next = attempts[index + 1].provider
      console.warn(`[ai] ${provider.name} (${provider.model}) unavailable, trying ${next.name} (${next.model})`, String(error?.message || error).slice(0, 300))
    }
  }
}

// A one-page PDF that says "Connection test 42", built here so the OCR test needs no file.
const samplePdf = () => {
  const stream = 'BT /F1 24 Tf 30 60 Td (Connection test 42) Tj ET'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 320 140] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = objects.map((body, index) => {
    const offset = pdf.length
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
    return offset
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}

const describeTestFailure = (error) =>
  classifyAiFailure(error).code === 'timeout' ? `No answer within ${TEST_TIMEOUT_MS / 1000} s.` : String(error?.message || error).slice(0, 400)

/**
 * Tries one model provider or OCR engine, for the Test buttons in Settings. Uses the
 * values typed in the form, falling back to what is saved, then the environment.
 */
/*
 * A test may try an address typed into the form before it is saved, but the saved keys
 * only ever go to the saved address: pointing the test at another host must not send
 * that host the stored secret. When a connection's address differs from the saved one,
 * its secrets come from the form alone.
 */
const withoutSavedSecretsForNewAddress = (setting, formValues) => {
  const saved = resolveValues(setting)
  const values = resolveValues(setting, formValues)
  AI_CONNECTIONS.forEach((connection) => {
    const moved = connection.fields.some((field) => field.kind === 'url' && values[field.key] !== saved[field.key])
    if (!moved) return
    connection.fields.filter((field) => field.secret).forEach((field) => {
      values[field.key] = String(formValues[field.key] || '').trim()
    })
  })
  return values
}

export const testAiService = async (id, formValues = {}) => {
  const values = withoutSavedSecretsForNewAddress(await readSetting(), formValues)
  const modelService = AI_MODEL_PROVIDERS.find((entry) => entry.id === id)
  const ocrService = OCR_ENGINES.find((entry) => entry.id === id)
  if (!modelService && !ocrService) return { ok: false, message: 'Unknown service.' }

  const started = Date.now()
  if (modelService) {
    const provider = build(AI_MODEL_PROVIDERS, PROVIDER_FACTORIES, id, values)
    if (!provider) return { ok: false, message: `Fill in the ${modelService.label} connection first.` }
    try {
      await provider.generateJson({
        system: 'You answer connection checks.',
        text: 'Reply with ok set to true.',
        schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false },
        schemaName: 'connection_check',
        timeoutMs: TEST_TIMEOUT_MS,
      })
      return { ok: true, message: `${provider.model} answered in ${Date.now() - started} ms.` }
    } catch (error) {
      return { ok: false, message: `${provider.model}: ${describeTestFailure(error)}` }
    }
  }

  const ocr = build(OCR_ENGINES, OCR_FACTORIES, id, values)
  if (!ocr) return { ok: false, message: `Fill in the ${ocrService.label} connection first.` }
  try {
    const text = (await ocr.extractText({ mimeType: 'application/pdf', data: samplePdf() }, { timeoutMs: TEST_TIMEOUT_MS })).replace(/\s+/g, ' ').trim()
    return text.includes('42')
      ? { ok: true, message: `Read “${text.slice(0, 60)}” from a test page in ${Date.now() - started} ms.` }
      : { ok: false, message: `Connected, but the test page came back as “${text.slice(0, 60) || 'nothing'}”.` }
  } catch (error) {
    return { ok: false, message: describeTestFailure(error) }
  }
}
