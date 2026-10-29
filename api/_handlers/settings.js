import { sql } from 'drizzle-orm'
import { requireUser } from '../_lib/rbac.js'
import { features } from '../_lib/features.js'
import { getDb, schema } from '../_lib/db/client.js'
import { fail, text } from '../_lib/http.js'
import { recordAudit } from '../_lib/audit.js'
import { getPublicSetting, getSetting, setSetting, SETTING_DEFAULTS } from '../_lib/settings.js'
import { describeLms, getLms } from '../_lib/lms/index.js'
import { createFrappeLms } from '../_lib/lms/frappe.js'
import { CrbError, crbProviderFor, describeCrb, product109ConfigFrom, refreshCrb, resolveCrb } from '../_lib/crb/index.js'
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
import { validateDocumentKinds } from '../_lib/templates.js'
import { createZraClient, missingZraConfig, readZraConfig, ZraError } from '../_lib/zra/client.js'
import { getZraConfig } from '../_lib/zra/config.js'

const LEGACY_WORKFLOW_KEYS = ['workflow', 'offers', 'stages', 'lms']
import { BRAND_NAME_MAX } from '../../src/config/branding.js'
import { APPLICANT_FORMS, BUILT_IN_PRODUCT_IDS, DOCUMENT_CATALOGUE, PRODUCT_ID_PATTERN, buildProducts, defaultDocuments } from '../../src/config/loanProducts.js'
import { COLLATERAL_REQUIREMENTS } from '../../src/config/collateral.js'
import { isHexColour, normaliseTheme } from '../../src/config/theme.js'

/*
 * Settings → everything an administrator configures in the workspace. Each key is
 * validated here before it is stored; credentials are encrypted by settings.js.
 */

const CRB_PROVIDERS = ['environment', 'none', 'demo', 'product109']

const number =(value, { min = -Infinity, max = Infinity, integer = false, label }) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < min || parsed > max || (integer && !Number.isInteger(parsed))) {
    throw new Error(`${label} must be ${integer ? 'a whole number' : 'a number'}${Number.isFinite(min) ? ` from ${min}` : ''}${Number.isFinite(max) ? ` to ${max}` : ''}.`)
  }
  return parsed
}

const optionalDays = (value, label) => (value === null || value === '' || value === undefined ? null : number(value, { min: 1, max: 3650, integer: true, label }))

const validatePricing = (id, value, label = id === 'personal' ? 'Personal loan' : 'Business loan') => {
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

const CUSTOM_DOCUMENT_SLOT = /^custom\.[a-z0-9-]{2,40}$/

/** A product's document list: catalogue documents of its form, or its own (custom.*), each once. */
const validateProductDocuments = (form, value, label) => {
  const catalogue = Object.fromEntries(DOCUMENT_CATALOGUE[form].map((entry) => [entry.slot, entry]))
  const seen = new Set()
  const documents = (Array.isArray(value) ? value : []).slice(0, 30).map((entry) => {
    const slot = text(entry?.slot, 50)
    const known = catalogue[slot]
    if (!known && !CUSTOM_DOCUMENT_SLOT.test(slot)) throw new Error(`${label}: unknown document "${slot}".`)
    if (seen.has(slot)) throw new Error(`${label}: "${known?.label || slot}" is listed twice.`)
    seen.add(slot)
    const name = text(entry.label, 80) || known?.label
    if (!name) throw new Error(`${label}: every document needs a name.`)
    return { slot, label: name, docType: known ? known.docType : 'custom', description: text(entry.description, 300), required: Boolean(entry.required) }
  })
  return documents
}

/** One product, built-in or added: its words, form, pricing, documents and collateral rules. */
const validateProduct = (id, value, current, collateralTypes) => {
  const builtIn = BUILT_IN_PRODUCT_IDS.includes(id)
  const form = builtIn ? id : current?.form || value.form
  if (!APPLICANT_FORMS[form]) throw new Error(`Choose the application form "${text(value.name, 80) || id}" uses.`)
  const name = text(value.name, 80)
  if (name.length < 3) throw new Error('Every loan product needs a name of at least 3 characters.')
  const label = name
  const requirement = Object.keys(COLLATERAL_REQUIREMENTS).includes(value.collateral?.requirement) ? value.collateral.requirement : 'none'
  const known = new Set(collateralTypes.map((type) => type.key))
  const coverage = value.collateral?.minCoverage
  return {
    ...validatePricing(id, value, label),
    form,
    name,
    tagline: text(value.tagline, 120),
    description: text(value.description, 600),
    // Left out of the request: kept as they are (or the form's usual ones), never emptied by omission.
    documents: value.documents === undefined ? current?.documents || defaultDocuments(form) : validateProductDocuments(form, value.documents, label),
    collateral: {
      requirement,
      types: (Array.isArray(value.collateral?.types) ? value.collateral.types : []).filter((key, index, list) => known.has(key) && list.indexOf(key) === index),
      minCoverage: requirement === 'none' || coverage === null || coverage === '' || coverage === undefined ? null : number(coverage, { min: 0.1, max: 10, label: `${label}: minimum collateral cover` }),
    },
    // Added products keep the time they were made, which orders them after the built-in ones.
    ...(builtIn ? {} : { createdAt: current?.createdAt || new Date().toISOString() }),
  }
}

const validateProducts = async (value) => {
  const stored = await getSetting('products')
  const { types } = await getSetting('collateral')
  const products = {}
  for (const [id, entry] of Object.entries(value || {})) {
    if (!BUILT_IN_PRODUCT_IDS.includes(id) && !PRODUCT_ID_PATTERN.test(id)) throw new Error(`"${id}" can’t be a product id: use lower-case letters, numbers and dashes.`)
    products[id] = validateProduct(id, entry || {}, stored[id], types)
  }
  if (!buildProducts({ ...stored, ...products }).some((product) => product.enabled)) throw new Error('Keep at least one loan product switched on.')
  return products
}

/** Whether any application pledged collateral of this type. */
const collateralTypeInUse = async (key) => {
  const db = await getDb()
  const [row] = await db
    .select({ id: schema.applications.id })
    .from(schema.applications)
    .where(sql`${schema.applications.data} -> 'collateral' -> 'items' @> ${JSON.stringify([{ type: key }])}::jsonb`)
    .limit(1)
  return Boolean(row)
}

/** The collateral types. One left out is deleted, unless applications already name it: then it is switched off, so they still read. */
const validateCollateralTypes = async (value) => {
  const { types: stored } = await getSetting('collateral')
  const seen = new Set()
  const types = (Array.isArray(value?.types) ? value.types : []).slice(0, 40).map((entry) => {
    const key = text(entry?.key, 40)
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(key)) throw new Error(`"${key}" can’t be a collateral type key: use lower-case letters, numbers and underscores.`)
    if (seen.has(key)) throw new Error(`The collateral type "${key}" is listed twice.`)
    seen.add(key)
    const label = text(entry.label, 60)
    if (label.length < 2) throw new Error('Every collateral type needs a name.')
    return { key, label, description: text(entry.description, 200), retired: Boolean(entry.retired) }
  })
  for (const type of stored) if (!seen.has(type.key) && (await collateralTypeInUse(type.key))) types.push({ ...type, retired: true })
  if (!types.some((type) => !type.retired)) throw new Error('Keep at least one collateral type active.')
  return { types }
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
  // Each panel of Settings → Branding (name, letterhead, theme) saves only its own fields;
  // those it leaves out keep their saved values.
  branding: (value) => {
    const next = {}
    if (value.name !== undefined) {
      next.name = text(value.name, BRAND_NAME_MAX).replace(/\s+/g, ' ')
      if (next.name.length < 2) throw new Error('Give the product a name of at least two characters.')
    }
    if (value.email !== undefined) {
      next.email = text(value.email, 120)
      if (next.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.email)) throw new Error('The letterhead email address doesn’t look right.')
    }
    for (const [key, max] of [['address', 200], ['phone', 40], ['website', 120]]) if (value[key] !== undefined) next[key] = text(value[key], max)
    if (value.colour !== undefined && !isHexColour(String(value.colour).trim())) throw new Error('Give the accent colour as a hex value, like #1b4f72.')
    // The theme: unknown choices fall back to the defaults rather than failing.
    const theme = normaliseTheme(value)
    for (const key of ['colour', 'sidebar', 'radius', 'font']) if (value[key] !== undefined) next[key] = theme[key]
    return next
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
  zra: (value) => {
    const baseUrl = text(value.baseUrl, 300).replace(/\/+$/, '')
    if (baseUrl) {
      let url
      try {
        url = new URL(baseUrl)
      } catch {
        throw new Error('The ZRA address must be a valid HTTPS origin.')
      }
      if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
        throw new Error('The ZRA address must be an HTTPS origin without a path or credentials.')
      }
    }
    return {
      enabled: Boolean(value.enabled),
      baseUrl,
      apiKey: value.apiKey === null ? null : text(value.apiKey, 500),
      username: value.username === null ? null : text(value.username, 200),
      password: value.password === null ? null : String(value.password || '').slice(0, 500),
      timeoutSeconds: number(value.timeoutSeconds, { min: 5, max: 120, integer: true, label: 'The ZRA timeout' }),
    }
  },
  crb: (value) => {
    const provider = CRB_PROVIDERS.includes(value.provider) ? value.provider : 'environment'
    const wsdlUrl = text(value.wsdlUrl, 500)
    if (wsdlUrl) {
      let url
      try {
        url = new URL(wsdlUrl)
      } catch {
        throw new Error('The WSDL address must be a valid HTTPS address.')
      }
      // Plain HTTP only to this machine, as the adapter allows (a local stand-in).
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      if (!(url.protocol === 'https:' || (local && url.protocol === 'http:')) || url.username || url.password) {
        throw new Error('The WSDL address must use HTTPS and carry no credentials.')
      }
    }
    const testIdentity = text(value.testIdentity, 200)
    if (testIdentity && testIdentity.split('|').map((part) => part.trim()).filter(Boolean).length !== 3) {
      throw new Error('The bureau test identity must be "NRC|other names|surname".')
    }
    // Passwords are kept as typed: spaces may be part of them.
    const secret = (field) => (value[field] === null ? null : String(value[field] || '').slice(0, 500))
    return {
      provider,
      wsdlUrl,
      transportUsername: text(value.transportUsername, 200),
      transportPassword: secret('transportPassword'),
      messageUsername: text(value.messageUsername, 200),
      messagePassword: secret('messagePassword'),
      code: text(value.code, 100),
      infinityCode: text(value.infinityCode, 100),
      reportReason: number(value.reportReason, { min: 1, max: 99, integer: true, label: 'The report reason' }),
      reportSector: number(value.reportSector, { min: 1, max: 99, integer: true, label: 'The report sector' }),
      timeoutSeconds: number(value.timeoutSeconds, { min: 5, max: 120, integer: true, label: 'The bureau timeout' }),
      testIdentity,
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
  products: validateProducts,
  collateral: validateCollateralTypes,
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
      enabled: value.enabled !== false,
      provider: ['environment', 'off', ...providerIds].includes(value.provider) ? value.provider : 'environment',
      fallback: Boolean(value.fallback),
      fallbacks: (Array.isArray(value.fallbacks) ? value.fallbacks : []).filter((id, index, list) => providerIds.includes(id) && list.indexOf(id) === index),
      ocr: ['off', ...OCR_ENGINES.map((entry) => entry.id)].includes(value.ocr) ? value.ocr : 'off',
      ocrMode: value.ocrMode === 'always' ? 'always' : 'when_needed',
      ...aiFieldValues(value),
    }
  },
  customerOptions: (value) => ({ helpWithFinishing: value.helpWithFinishing !== false }),
  stages: (value) => validateStagesConfig(value),
  documents: (value) => validateDocumentKinds(value),
  security: async (value) => {
    const known = new Set((await listRoles()).map((role) => role.key))
    return { requireTwoFactorRoles: (Array.isArray(value.requireTwoFactorRoles) ? value.requireTwoFactorRoles : []).filter((role) => known.has(role)) }
  },
}

const getSettings = async (req) => {
  await requireUser(req, { permission: 'settings.manage' })
  const entries = await Promise.all(Object.keys(SETTING_DEFAULTS).map(async (key) => [key, await getPublicSetting(key)]))
  const [lms, terms, privacy] = await Promise.all([describeLms(), getPublishedLegal('terms'), getPublishedLegal('privacy')])
  const zraConfig = await getZraConfig()
  await refreshCrb({ force: true })
  return {
    settings: Object.fromEntries(entries),
    integrations: {
      lms,
      zra: { source: zraConfig.source, configured: missingZraConfig(zraConfig.config).length === 0 },
      crb: describeCrb(),
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
  // Retention periods are only edited where LOS_RETENTION_SETTINGS_ENABLED allows it (features.js).
  if (!validate || (params.key === 'retention' && !features().retentionSettings)) fail(404, 'Unknown setting.', 'not_found')
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
  if (params.key === 'crb') await refreshCrb({ force: true })
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

const testZra = async (req) => {
  const actor = await requireUser(req, { permission: 'settings.manage' })
  let config
  if (req.body && Object.keys(req.body).length) {
    let form
    try {
      form = VALIDATORS.zra({ ...req.body, enabled: true })
    } catch (error) {
      fail(400, error.message, 'invalid_input')
    }
    const [saved, environment] = await Promise.all([getSetting('zra'), Promise.resolve(readZraConfig())])
    const sameHost = Boolean(saved.baseUrl) && form.baseUrl === saved.baseUrl
    const sameEnvironmentHost = Boolean(environment.baseUrl) && form.baseUrl === environment.baseUrl
    const fallback = sameHost ? saved : sameEnvironmentHost ? environment : {}
    config = {
      ...form,
      apiKey: form.apiKey || fallback.apiKey || '',
      username: form.username || fallback.username || '',
      password: form.password || fallback.password || '',
    }
  } else {
    config = (await getZraConfig()).config
  }

  const missing = missingZraConfig(config)
  if (missing.length) fail(400, `Configure the ZRA connection first (missing ${missing.join(', ')}).`, 'zra_not_configured')

  const startedAt = Date.now()
  try {
    await createZraClient({ config }).authenticate()
    await recordAudit({ req, actor, action: 'settings.zra_tested', detail: { ok: true } })
    return { ok: true, message: `Authenticated with ZRA in ${Date.now() - startedAt} ms.` }
  } catch (error) {
    await recordAudit({ req, actor, action: 'settings.zra_tested', detail: { ok: false } })
    return { ok: false, message: error instanceof ZraError ? error.message : 'ZRA could not be reached.' }
  }
}

/**
 * Tries the credit bureau — the saved setup, or the form's values before saving — without
 * an enquiry (product109.js testConnection). Passwords left blank fall back to the saved
 * or environment ones only for the same WSDL address, as for the LMS and ZRA.
 */
const testCrb = async (req) => {
  const actor = await requireUser(req, { permission: 'settings.manage' })
  let resolved
  if (req.body && Object.keys(req.body).length) {
    let form
    try {
      form = VALIDATORS.crb(req.body)
    } catch (error) {
      fail(400, error.message, 'invalid_input')
    }
    if (form.provider === 'environment') {
      resolved = resolveCrb(null)
    } else {
      const [saved, environment] = await Promise.all([getSetting('crb'), Promise.resolve(resolveCrb(null).config)])
      const fallback = saved.wsdlUrl && form.wsdlUrl === saved.wsdlUrl ? saved : environment.wsdlUrl && form.wsdlUrl === environment.wsdlUrl ? environment : {}
      resolved = {
        source: 'settings',
        provider: form.provider,
        config: product109ConfigFrom({ ...form, transportPassword: form.transportPassword || fallback.transportPassword || '', messagePassword: form.messagePassword || fallback.messagePassword || '' }),
      }
    }
  } else {
    await refreshCrb({ force: true })
    resolved = resolveCrb()
  }

  let crb
  try {
    crb = crbProviderFor(resolved)
  } catch (error) {
    fail(400, error.message, 'invalid_input')
  }
  if (!crb) fail(400, 'No credit bureau is selected.', 'crb_not_configured')
  if (crb.sample) return { ok: true, message: 'Sample data needs no connection: credit checks will return made-up scores.' }

  try {
    const { milliseconds } = await crb.testConnection()
    await recordAudit({ req, actor, action: 'settings.crb_tested', detail: { ok: true, source: resolved.source } })
    return { ok: true, message: `Reached the bureau and its Product 109 service in ${milliseconds} ms. The message username and password are only checked by a real credit check.` }
  } catch (error) {
    await recordAudit({ req, actor, action: 'settings.crb_tested', detail: { ok: false, source: resolved.source, code: error?.code || null } })
    return { ok: false, message: error instanceof CrbError ? error.message : 'The credit bureau could not be reached.' }
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
  ['POST', '/settings/zra/test', testZra],
  ['POST', '/settings/crb/test', testCrb],
  ['POST', '/settings/sms/test', testSms],
  ['POST', '/settings/ai/test', testAi],
  ['GET', '/legal/:kind', publishedLegal],
  ['GET', '/admin/legal/:kind', legalForAdmin],
  ['PUT', '/admin/legal/:kind/draft', saveLegal],
  ['DELETE', '/admin/legal/:kind/draft', discardLegal],
  ['POST', '/admin/legal/:kind/publish', publishLegal],
]
