import { eq } from 'drizzle-orm'
import { getDb, schema } from './db/client.js'
import { decryptSecret, encryptSecret, isEncrypted } from './secrets.js'
import { DEFAULT_PRICING } from '../../src/config/loanProducts.js'
import { AI_FIELDS, AI_SECRET_FIELDS } from '../../src/config/aiProviders.js'
import { DEFAULT_STAGES_CONFIG } from '../../src/config/stages.js'
import { DEFAULT_BRAND_NAME } from '../../src/config/branding.js'

/*
 * Admin-editable configuration. Each key has a default here, so a fresh database
 * behaves sensibly and a missing row is never an error. Values are merged one level
 * deep over the defaults, so adding a field later needs no data migration.
 *
 * Fields listed in SECRET_FIELDS are stored encrypted (secrets.js) and never sent back
 * to the browser; the admin sees whether one is set, not its value.
 */
export const SETTING_DEFAULTS = {
  /*
   * The name and logo applicants and staff see (Settings → Branding). `logo` is the stored
   * file ({ pathname, url, contentType, size, filename, version }), or null for the
   * bundled one. Only the logo upload endpoint sets it (api/_handlers/branding.js).
   */
  branding: { name: DEFAULT_BRAND_NAME, logo: null },
  // When to hand applications to the LMS: on submit, once approved, or once the customer
  // has accepted the offer (the default when acceptance is required).
  lms: { syncOn: 'approval', sendPrescreen: false },
  /*
   * How to reach the LMS. Entered in Settings → LMS connection once the LMS team provides
   * it; environment variables (LMS_BASE_URL, …) still work and are used when this is off.
   */
  lmsConnection: {
    enabled: false,
    provider: 'frappe',
    baseUrl: '',
    // token: API key + secret ("Authorization: token key:secret"); password: login method + sid
    authMethod: 'token',
    apiKey: '',
    apiSecret: '',
    username: '',
    password: '',
    // Frappe method paths, as the LMS team names them.
    methods: {
      login: '/api/method/auth_api.user_management.api.auth.login',
      upload: '/api/method/upload_file',
      create: '/api/method/rolaface_lms_app.modules.loan.custom_api.loanApplication.api.create_custom_loan_application',
      byEmail: '/api/method/rolaface_lms_app.modules.loan.custom_api.loanApplication.api.get_custom_loan_application_by_email',
    },
    // Sent with every application so a resend can be matched to what the LMS already has.
    referenceField: 'los_reference',
    // Where the LMS keeps its status, and which values mean the loan was paid out.
    statusField: 'loan_application_status',
    disbursedStatuses: ['Disbursed'],
    timeoutSeconds: 60,
  },
  workflow: {
    // A second person must approve what an officer recommends (four-eyes).
    requireSecondApproval: true,
    // Days an open case may sit before it is flagged as overdue in the queue.
    slaDays: 3,
    // Note: how much each person may finally approve is now a per-user limit band on their
    // team profile (users.approvalMin / approvalMax), not a workflow-wide setting.
  },
  offers: {
    // The customer confirms an approved offer before it is paid out or sent to the LMS.
    requireAcceptance: true,
    // An unaccepted offer lapses after this many days.
    expiryDays: 14,
    // Accepting means signing the offer letter and agreement (drawn or typed, confirmed
    // by an emailed code), stamped into signed copies kept with the case.
    requireSignature: true,
  },
  // The processing flow around the fixed backbone: renamed statuses, the checklist, and
  // the workspace's own stages (src/config/stages.js). Empty stage lists: the flow as built.
  stages: DEFAULT_STAGES_CONFIG,
  // Automatic decline on a failed rule. Off: rules recommend, people decide.
  prescreen: { autoDecline: false },
  products: DEFAULT_PRICING,
  /*
   * How long closed applications are kept before they and their documents are deleted.
   * null keeps them indefinitely. Approved and paid-out loans are kept by default: they
   * are loan records.
   */
  retention: {
    declinedDays: 180,
    withdrawnDays: 90,
    expiredDays: 90,
    disbursedDays: null,
    auditLogDays: null,
  },
  notifications: {
    // Also email staff their notifications (they can opt out individually).
    staffEmail: true,
    // Text customers when something needs them or a decision is made (needs an SMS provider).
    customerSms: false,
  },
  sms: {
    provider: 'none',
    username: '',
    apiKey: '',
    senderId: '',
  },
  // What applicants are offered while applying. Set by admins; applicants don't choose.
  customerOptions: {
    // Staff may see unfinished applications and contact the applicant to help finish them.
    helpWithFinishing: true,
  },
  security: {
    // Roles that must use two-step sign-in. Members without it are asked to set it up.
    requireTwoFactorRoles: [],
  },
  /*
   * Which model reads uploads and reviews applications (api/_lib/ai), and the connection
   * details for each backend (src/config/aiProviders.js). "environment" keeps following
   * AI_PROVIDER; any field left blank falls back to its environment variable.
   */
  ai: {
    // Admin switch for AI document checks and the AI prescreen, for applicants and staff alike.
    enabled: true,
    provider: 'environment',
    // When the chosen model is overloaded, rate-limited or times out, try these in order.
    fallback: true,
    fallbacks: ['gemini', 'mistral'],
    // Optional OCR before the model: only for files the model can't read, or always.
    ocr: 'off',
    ocrMode: 'when_needed',
    ...Object.fromEntries(AI_FIELDS.map((field) => [field.key, ''])),
  },
}

const SECRET_FIELDS = {
  lmsConnection: ['apiSecret', 'password'],
  sms: ['apiKey'],
  ai: AI_SECRET_FIELDS,
}

const mergeDeep = (base, override) => {
  if (!override || typeof override !== 'object' || Array.isArray(override)) return override === undefined ? base : override
  const merged = { ...base }
  Object.entries(override).forEach(([key, value]) => {
    merged[key] = base && typeof base[key] === 'object' && !Array.isArray(base[key]) && base[key] !== null ? mergeDeep(base[key], value) : value
  })
  return merged
}

const readRow = async (key) => {
  const db = await getDb()
  const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, key)).limit(1)
  return row?.value || {}
}

/** The setting with secrets decrypted — for server use only. */
export const getSetting = async (key) => {
  const value = mergeDeep(SETTING_DEFAULTS[key], await readRow(key))
  for (const field of SECRET_FIELDS[key] || []) value[field] = decryptSecret(value[field]) || ''
  return value
}

/** The setting as the admin screen may see it: secrets replaced by whether they are set. */
export const getPublicSetting = async (key) => {
  const value = mergeDeep(SETTING_DEFAULTS[key], await readRow(key))
  for (const field of SECRET_FIELDS[key] || []) {
    value[`${field}Set`] = isEncrypted(value[field])
    value[field] = ''
  }
  return value
}

/**
 * Saves a setting. For secret fields, an empty value keeps what is stored (the form
 * never receives it to send back) and `null` clears it.
 */
export const setSetting = async (key, value, actor) => {
  const db = await getDb()
  const stored = await readRow(key)
  const next = mergeDeep(mergeDeep(SETTING_DEFAULTS[key], stored), value)
  for (const field of SECRET_FIELDS[key] || []) {
    delete next[`${field}Set`]
    if (value[field] === null) next[field] = null
    else if (value[field]) next[field] = encryptSecret(value[field])
    else next[field] = stored[field] ?? null
  }
  await db
    .insert(schema.settings)
    .values({ key, value: next, updatedBy: actor?.id ?? null, updatedAt: new Date() })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: next, updatedBy: actor?.id ?? null, updatedAt: new Date() } })
  return getPublicSetting(key)
}
