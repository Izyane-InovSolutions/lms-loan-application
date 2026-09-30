import { requireUser } from '../_lib/rbac.js'
import { fail, text } from '../_lib/http.js'
import { recordAudit } from '../_lib/audit.js'
import { getPublicSetting, getSetting, setSetting, SETTING_DEFAULTS } from '../_lib/settings.js'
import { describeLms, getLms } from '../_lib/lms/index.js'
import { createFrappeLms } from '../_lib/lms/frappe.js'
import { getCrb } from '../_lib/crb/index.js'
import { describeAi, testAiService } from '../_lib/ai/index.js'
import { parseServiceAccount } from '../_lib/ai/cloud/google.js'
import { AI_CONNECTIONS, AI_FIELDS, AI_MODEL_PROVIDERS, OCR_ENGINES } from '../../src/config/aiProviders.js'
import { getSms, toZambianE164 } from '../_lib/sms.js'
import { LEGAL_KINDS, discardLegalDraft, getDraftLegal, getPublishedLegal, isPlaceholder, legalHistory, publishLegalDraft, saveLegalDraft } from '../_lib/legal.js'
import { listRoles } from '../_lib/roles.js'
import { validateStagesConfig } from '../_lib/stages.js'
import { clearTwoFactorCache } from '../_lib/auth/twoFactor.js'
import { brandName } from '../_lib/branding.js'
import { regenerateLegacyWorkflow } from '../_lib/workflowVersions.js'

const LEGACY_WORKFLOW_KEYS = ['workflow', 'offers', 'stages', 'lms']
import { BRAND_NAME_MAX } from '../../src/config/branding.js'

/*
 * Settings → everything an administrator configures in the workspace. Each key is
 * validated here before it is stored; credentials are encrypted by settings.js.
 */

const number = (value, { min = -Infinity, max = Infinity, integer = false, label }) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < min || parsed > max || (integer && !Number.isInteger(parsed))) {
    throw new Error(`${label} must be ${integer ? 'a whole number' : 'a number'}${Number.isFinite(min) ? ` from ${min}` : ''}${Number.isFinite(max) ? ` to ${max}` : ''}.`)
  }
  return parsed
}

const optionalDays = (value, label) => (value === null || value === '' || value === undefined ? null : number(value, { min: 1, max: 3650, integer: true, label }))

const validatePricing = (id, value) => {
  const label = id === 'personal' ? 'Personal loan' : 'Business loan'
  const pricing = {
    enabled: Boolean(value.enabled),
    minAmount: number(value.minAmount, { min: 1, label: `${label}: minimum amount` }),
    maxAmount: number(value.maxAmount, { min: 1, label: `${label}: maximum amount` }),
    exampleAmount: number(value.exampleAmount, { min: 1, label: `${label}: example amount` }),
    minTenure: number(value.minTenure, { min: 1, max: 120, integer: true, label: `${label}: shortest tenure` }),
    maxTenure: number(value.maxTenure, { min: 1, max: 120, integer: true, label: `${label}: longest tenure` }),
    defaultTenure: number(value.defaultTenure, { min: 1, max: 120, integer: true, label: `${label}: default tenure` }),
    interestRate: number(value.interestRate, { min: 0, max: 1, label: `${label}: interest rate` }),
    interestBasis: value.interestBasis === 'month' ? 'month' : 'loan',
    facilityFee: number(value.facilityFee, { min: 0, label: `${label}: facility fee` }),
    facilityFeeType: value.facilityFeeType === 'percent' ? 'percent' : 'fixed',
  }
  if (pricing.minAmount > pricing.maxAmount) throw new Error(`${label}: the minimum amount is above the maximum.`)
  if (pricing.minTenure > pricing.maxTenure) throw new Error(`${label}: the shortest tenure is above the longest.`)
  if (pricing.defaultTenure < pricing.minTenure || pricing.defaultTenure > pricing.maxTenure) throw new Error(`${label}: the default tenure must be within the tenure range.`)
  if (pricing.exampleAmount < pricing.minAmount || pricing.exampleAmount > pricing.maxAmount) throw new Error(`${label}: the example amount must be within the amount range.`)
  if (pricing.facilityFeeType === 'percent' && pricing.facilityFee > 1) throw new Error(`${label}: a percentage fee is a fraction, e.g. 0.02 for 2%.`)
  return pricing
}

// A single leading slash: "//host/…" is a protocol-relative URL and would leave the LMS host.
const path = (value, label) => {
  const cleaned = text(value, 300)
  if (!cleaned.startsWith('/') || cleaned.startsWith('//') || cleaned.includes('\\')) throw new Error(`${label} must be a path starting with /.`)
  return cleaned
}

// Model ids go into request paths and bodies; blank means the default.
const modelName = (value, label) => {
  const cleaned = text(value, 200)
  if (cleaned && !/^[\w.:/@-]+$/.test(cleaned)) throw new Error(`${label} should be a model id such as gemini-3.8-flash or mistral-small-latest.`)
  return cleaned
}

const AI_FIELD_LABELS = Object.fromEntries(AI_CONNECTIONS.flatMap((connection) => connection.fields.map((field) => [field.key, `${connection.label}: ${field.label}`])))

/** One AI connection field (src/config/aiProviders.js). Secrets: null clears, blank keeps. */
const aiField = (field, raw) => {
  const label = AI_FIELD_LABELS[field.key]
  if (field.secret && raw === null) return null
  if (field.kind === 'json') {
    const cleaned = String(raw ?? '').trim()
    if (cleaned.length > 20000) throw new Error(`${label} is too long to be a service account key.`)
    if (cleaned) parseServiceAccount(cleaned)
    return cleaned
  }
  if (field.secret) return text(raw, 500)
  if (field.kind === 'model') return modelName(raw, label)
  if (field.kind === 'url') {
    const cleaned = text(raw, 300).replace(/\/+$/, '')
    if (cleaned && !/^https:\/\/[^\s]+$/i.test(cleaned) && !(field.allowHttp && /^http:\/\/[^\s]+$/i.test(cleaned))) {
      throw new Error(`${label} must start with https://${field.allowHttp ? ' (or http:// on your own network)' : ''}.`)
    }
    return cleaned
  }
  return text(raw, 200)
}

const aiFieldValues = (value, { onlyPresent = false } = {}) =>
  Object.fromEntries(AI_FIELDS.filter((field) => !onlyPresent || value[field.key]).map((field) => [field.key, aiField(field, value[field.key])]))

const VALIDATORS = {
  // The name only: the logo is set by its own upload endpoint (branding.js), never from a
  // body here, which could otherwise point it at any stored file.
  branding: (value) => {
    const name = text(value.name, BRAND_NAME_MAX).replace(/\s+/g, ' ')
    if (name.length < 2) throw new Error('Give the product a name of at least two characters.')
    return { name }
  },
  lms: (value) => {
    if (!['submit', 'approval'].includes(value.syncOn)) throw new Error('Choose when to send applications to the LMS.')
    return { syncOn: value.syncOn, sendPrescreen: Boolean(value.sendPrescreen) }
  },
  lmsConnection: (value) => {
    const baseUrl = text(value.baseUrl, 300).replace(/\/+$/, '')
    if (value.enabled && !/^https:\/\/[^\s]+$/i.test(baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(baseUrl)) {
      throw new Error('The LMS address must start with https:// (http:// only for localhost).')
    }
    const methods = value.methods || {}
    return {
      enabled: Boolean(value.enabled),
      provider: 'frappe',
      baseUrl,
      authMethod: value.authMethod === 'password' ? 'password' : 'token',
      apiKey: text(value.apiKey, 200),
      apiSecret: value.apiSecret === null ? null : text(value.apiSecret, 500),
      username: text(value.username, 200),
      password: value.password === null ? null : String(value.password || '').slice(0, 500),
      methods: {
        login: path(methods.login, 'The login method'),
        upload: path(methods.upload, 'The upload method'),
        create: path(methods.create, 'The create-application method'),
        byEmail: path(methods.byEmail, 'The find-by-email method'),
      },
      referenceField: text(value.referenceField, 100),
      statusField: text(value.statusField, 100) || 'status',
      disbursedStatuses: (Array.isArray(value.disbursedStatuses) ? value.disbursedStatuses : String(value.disbursedStatuses || '').split(','))
        .map((entry) => text(entry, 60))
        .filter(Boolean),
      timeoutSeconds: number(value.timeoutSeconds, { min: 5, max: 300, integer: true, label: 'The timeout' }),
    }
  },
  workflow: (value) => ({
    requireSecondApproval: Boolean(value.requireSecondApproval),
    slaDays: number(value.slaDays, { min: 1, max: 60, integer: true, label: 'The target days' }),
  }),
  offers: (value) => ({
    requireAcceptance: Boolean(value.requireAcceptance),
    requireSignature: value.requireSignature !== false,
    expiryDays: number(value.expiryDays, { min: 1, max: 90, integer: true, label: 'The offer period' }),
  }),
  prescreen: (value) => ({ autoDecline: Boolean(value.autoDecline) }),
  products: (value) => ({ personal: validatePricing('personal', value.personal || {}), business: validatePricing('business', value.business || {}) }),
  retention: (value) => ({
    declinedDays: optionalDays(value.declinedDays, 'Declined applications'),
    withdrawnDays: optionalDays(value.withdrawnDays, 'Withdrawn applications'),
    expiredDays: optionalDays(value.expiredDays, 'Expired offers'),
    disbursedDays: optionalDays(value.disbursedDays, 'Paid-out loans'),
    auditLogDays: optionalDays(value.auditLogDays, 'The audit log'),
  }),
  notifications: (value) => ({ staffEmail: Boolean(value.staffEmail), customerSms: Boolean(value.customerSms) }),
  sms: (value) => {
    const provider = value.provider === 'africastalking' ? 'africastalking' : 'none'
    return { provider, username: text(value.username, 100), apiKey: value.apiKey === null ? null : text(value.apiKey, 300), senderId: text(value.senderId, 11) }
  },
  ai: (value) => {
    const providerIds = AI_MODEL_PROVIDERS.map((entry) => entry.id)
    return {
      provider: ['environment', 'off', ...providerIds].includes(value.provider) ? value.provider : 'environment',
      fallback: Boolean(value.fallback),
      fallbacks: (Array.isArray(value.fallbacks) ? value.fallbacks : []).filter((id, index, list) => providerIds.includes(id) && list.indexOf(id) === index),
      ocr: ['off', ...OCR_ENGINES.map((entry) => entry.id)].includes(value.ocr) ? value.ocr : 'off',
      ocrMode: value.ocrMode === 'always' ? 'always' : 'when_needed',
      ...aiFieldValues(value),
    }
  },
  stages: (value) => validateStagesConfig(value),
  security: async (value) => {
    const known = new Set((await listRoles()).map((role) => role.key))
    return { requireTwoFactorRoles: (Array.isArray(value.requireTwoFactorRoles) ? value.requireTwoFactorRoles : []).filter((role) => known.has(role)) }
  },
}

const getSettings = async (req) => {
  await requireUser(req, { permission: 'settings.manage' })
  const entries = await Promise.all(Object.keys(SETTING_DEFAULTS).map(async (key) => [key, await getPublicSetting(key)]))
  const [lms, terms, privacy] = await Promise.all([describeLms(), getPublishedLegal('terms'), getPublishedLegal('privacy')])
  return {
    settings: Object.fromEntries(entries),
    integrations: {
      lms,
      crb: getCrb()?.name || null,
      ai: await describeAi(),
      geocoder: (process.env.GEOCODER || '').trim() || null,
      sms: Boolean(await getSms()),
      email: Boolean(process.env.EMAIL_HOST && process.env.EMAIL_HOST_USER),
      secretsKey: Boolean((process.env.LOS_SECRETS_KEY || '').trim()),
      virusScan: Boolean((process.env.CLAMAV_HOST || '').trim()),
    },
    legalPlaceholders: { terms: isPlaceholder(terms), privacy: isPlaceholder(privacy) },
  }
}

const saveSetting = async (req, res, { params }) => {
  const actor = await requireUser(req, { permission: 'settings.manage' })
  const validate = VALIDATORS[params.key]
  if (!validate) fail(404, 'Unknown setting.', 'not_found')
  let value
  try {
    value = await validate(req.body || {})
  } catch (error) {
    fail(400, error.message, 'invalid_input')
  }
  const before = await getPublicSetting(params.key)
  let saved
  try {
    saved = await setSetting(params.key, value, actor)
  } catch (error) {
    // e.g. LOS_SECRETS_KEY missing on a deployment.
    fail(400, error.message, 'cannot_save')
  }
  if (params.key === 'security') clearTwoFactorCache()
  // These still describe the workflow until someone publishes one from the editor.
  if (LEGACY_WORKFLOW_KEYS.includes(params.key)) await regenerateLegacyWorkflow(actor)
  await recordAudit({ req, actor, action: 'settings.updated', entityType: 'setting', entityId: params.key, detail: { before, after: saved } })
  return { [params.key]: saved }
}

/**
 * Tries the LMS connection — the saved one, or the values in the form before saving.
 * Secrets left blank fall back to the saved ones only for the saved address: a test
 * pointed at another host must bring its own, or it would hand that host our credentials.
 */
const testLms = async (req) => {
  const actor = await requireUser(req, { permission: 'settings.manage' })
  let client
  if (req.body && Object.keys(req.body).length) {
    let form
    try {
      form = VALIDATORS.lmsConnection({ ...req.body, enabled: true })
    } catch (error) {
      fail(400, error.message, 'invalid_input')
    }
    const saved = await getSetting('lmsConnection')
    const sameHost = Boolean(saved.baseUrl) && form.baseUrl === saved.baseUrl
    if (!sameHost && ((form.authMethod === 'token' && !form.apiSecret) || (form.authMethod !== 'token' && !form.password))) {
      fail(400, 'Enter the secret or password again to test a new LMS address.', 'secret_required')
    }
    client = createFrappeLms({ ...form, apiSecret: form.apiSecret || (sameHost ? saved.apiSecret : ''), password: form.password || (sameHost ? saved.password : '') })
  } else {
    client = await getLms()
    if (!client) fail(400, 'No LMS connection is set up yet.', 'lms_not_configured')
  }
  try {
    const result = await client.testConnection()
    await recordAudit({ req, actor, action: 'settings.lms_tested', detail: { ok: true } })
    return { ok: true, message: `Connected in ${result.milliseconds} ms.` }
  } catch (error) {
    await recordAudit({ req, actor, action: 'settings.lms_tested', detail: { ok: false } })
    return { ok: false, message: error.message || 'The LMS could not be reached.' }
  }
}

/** Sends a test text to the admin's number. */
const testSms = async (req) => {
  await requireUser(req, { permission: 'settings.manage' })
  const sms = await getSms()
  if (!sms) fail(400, 'Save an SMS provider first.', 'sms_not_configured')
  const to = toZambianE164(req.body?.phone)
  if (!to) fail(400, 'Enter a Zambian mobile number, e.g. 0971234567.', 'invalid_input')
  try {
    await sms.send(to, `Test message from the ${await brandName()} workspace.`)
    return { ok: true, message: `Sent to ${to}.` }
  } catch (error) {
    return { ok: false, message: error.message }
  }
}

/**
 * Tries one model provider or OCR engine with the values in the form (blank ones fall
 * back to the saved values, then the environment).
 */
const testAi = async (req) => {
  const actor = await requireUser(req, { permission: 'settings.manage' })
  const service = String(req.body?.service || '')
  let values
  try {
    values = aiFieldValues(req.body?.values || {}, { onlyPresent: true })
  } catch (error) {
    fail(400, error.message, 'invalid_input')
  }
  const result = await testAiService(service, values)
  await recordAudit({ req, actor, action: 'settings.ai_tested', detail: { service, ok: result.ok } })
  return result
}

// ---------------------------------------------------------------------------
// Terms and privacy notice
// ---------------------------------------------------------------------------

const assertKind = (kind) => {
  if (!LEGAL_KINDS.includes(kind)) fail(404, 'Unknown document.', 'not_found')
}

/** Public: the published text applicants read before submitting. */
const publishedLegal = async (req, res, { params }) => {
  assertKind(params.kind)
  const document = await getPublishedLegal(params.kind)
  return { kind: document.kind, version: document.version, title: document.title, body: document.body, publishedAt: document.publishedAt }
}

const legalForAdmin = async (req, res, { params }) => {
  await requireUser(req, { permission: 'settings.manage' })
  assertKind(params.kind)
  const [published, draft, history] = await Promise.all([getPublishedLegal(params.kind), getDraftLegal(params.kind), legalHistory(params.kind)])
  return { published, draft, history, placeholder: isPlaceholder(published) }
}

const saveLegal = async (req, res, { params }) => {
  const actor = await requireUser(req, { permission: 'settings.manage' })
  assertKind(params.kind)
  const title = text(req.body?.title, 200)
  const body = String(req.body?.body || '').trim().slice(0, 50000)
  if (title.length < 3 || body.length < 20) fail(400, 'Give the document a title and its full text.', 'invalid_input')
  const draft = await saveLegalDraft(params.kind, { title, body })
  await recordAudit({ req, actor, action: 'legal.draft_saved', entityType: 'legal', entityId: params.kind })
  return { draft }
}

const discardLegal = async (req, res, { params }) => {
  const actor = await requireUser(req, { permission: 'settings.manage' })
  assertKind(params.kind)
  await discardLegalDraft(params.kind)
  await recordAudit({ req, actor, action: 'legal.draft_discarded', entityType: 'legal', entityId: params.kind })
  return { ok: true }
}

const publishLegal = async (req, res, { params }) => {
  const actor = await requireUser(req, { permission: 'settings.manage' })
  assertKind(params.kind)
  const published = await publishLegalDraft(params.kind, actor)
  if (!published) fail(400, 'Save a draft before publishing.', 'no_draft')
  await recordAudit({ req, actor, action: 'legal.published', entityType: 'legal', entityId: params.kind, detail: { version: published.version } })
  return { published }
}

/** The processing flow, for every staff member's pipeline, case page and status names. */
const stagesForStaff = async (req) => {
  await requireUser(req, { staff: true })
  return { stages: await getSetting('stages'), requireAcceptance: (await getSetting('offers')).requireAcceptance }
}

export const settingsRoutes = [
  ['GET', '/settings', getSettings],
  ['GET', '/stages', stagesForStaff],
  ['PUT', '/settings/:key', saveSetting],
  ['POST', '/settings/lms/test', testLms],
  ['POST', '/settings/sms/test', testSms],
  ['POST', '/settings/ai/test', testAi],
  ['GET', '/legal/:kind', publishedLegal],
  ['GET', '/admin/legal/:kind', legalForAdmin],
  ['PUT', '/admin/legal/:kind/draft', saveLegal],
  ['DELETE', '/admin/legal/:kind/draft', discardLegal],
  ['POST', '/admin/legal/:kind/publish', publishLegal],
]
