import { sql } from 'drizzle-orm'
import {
  pgTable,
  pgSequence,
  uuid,
  text,
  boolean,
  integer,
  numeric,
  timestamp,
  jsonb,
  bigserial,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

/*
 * The LOS's own records. Postgres, so the portal runs whether or not a Frappe LMS is
 * attached; Redis (kv.js) keeps the short-lived things — OTP codes, rate limits, drafts.
 *
 * Changing this file: run `npm run db:generate` to write a migration, and commit both.
 * Local dev applies migrations on startup (client.js); a hosted database is migrated
 * with `npm run db:migrate`.
 */

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}

/** Staff and customers alike; `role` is a built-in role (src/config/roles.js), a custom one from `roles`, or customer. */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Stored lower-cased; every lookup normalises first.
    email: text('email').notNull(),
    name: text('name').notNull(),
    phone: text('phone'),
    role: text('role').notNull(),
    // invited: has not set a password yet. disabled: kept for the audit trail, cannot sign in.
    status: text('status').notNull().default('invited'),
    // Null for customers, who sign in with an emailed code, and for staff still invited.
    passwordHash: text('password_hash'),
    // A DSA's relationship manager. Drives RM team visibility.
    managerId: uuid('manager_id').references(() => users.id, { onDelete: 'set null' }),
    // Stamped on applications that arrive through this person's link (Phase 5).
    referralCode: text('referral_code'),
    // The band of loan amounts this person may give final approval to. approvalMax null
    // means no upper limit. Administrators are never limited, whatever these hold.
    approvalMin: integer('approval_min').notNull().default(0),
    approvalMax: integer('approval_max'),
    isDemo: boolean('is_demo').notNull().default(false),
    // Two-step sign-in: the authenticator secret (encrypted, see secrets.js), when it was
    // switched on, and the hashes of unused one-time recovery codes.
    totpSecret: text('totp_secret'),
    totpEnabledAt: timestamp('totp_enabled_at', { withTimezone: true }),
    recoveryCodes: jsonb('recovery_codes'),
    // { email: false } turns off notification emails for this person.
    notificationPrefs: jsonb('notification_prefs').notNull().default(sql`'{}'::jsonb`),
    createdBy: uuid('created_by'),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('users_email_key').on(table.email),
    uniqueIndex('users_referral_code_key').on(table.referralCode),
    index('users_role_idx').on(table.role),
    index('users_manager_idx').on(table.managerId),
  ]
)

/**
 * Roles as the workspace has configured them. A built-in role (src/config/roles.js) has a
 * row only once an admin changes it; deleting that row restores its defaults. Custom roles
 * exist only here. `permissions` is a list of keys from PERMISSION_GROUPS.
 */
export const roles = pgTable('roles', {
  key: text('key').primaryKey(),
  label: text('label').notNull(),
  description: text('description'),
  // all | team | own — which applications members see (SCOPES).
  scope: text('scope').notNull().default('own'),
  permissions: jsonb('permissions').notNull().default(sql`'[]'::jsonb`),
  updatedBy: uuid('updated_by'),
  ...timestamps,
})

/** Signed-in browsers. `id` is the SHA-256 of the cookie token, so a database leak yields no usable sessions. */
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (table) => [index('sessions_user_idx').on(table.userId)]
)

/**
 * One-time links for setting a password: `invite` for a new account, `reset` for a
 * forgotten one. Same hashing as sessions.
 */
export const passwordTokens = pgTable(
  'password_tokens',
  {
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: text('purpose').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('password_tokens_user_idx').on(table.userId)]
)

/**
 * Every staff action, including reads of an applicant's personal data — the Data
 * Protection Act expects the controller to be able to say who saw what. Append-only:
 * nothing in the app updates or deletes rows here.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    actorId: uuid('actor_id'),
    // Kept alongside the id so the trail still reads correctly after a rename or deletion.
    actorLabel: text('actor_label').notNull(),
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    detail: jsonb('detail').notNull().default(sql`'{}'::jsonb`),
    ip: text('ip'),
  },
  (table) => [
    index('audit_log_at_idx').on(table.at),
    index('audit_log_actor_idx').on(table.actorId),
    index('audit_log_entity_idx').on(table.entityType, table.entityId),
  ]
)

/** Admin-editable configuration (credit policy, LMS sync options, …) as JSON values. */
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedBy: uuid('updated_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------

/** Feeds the human-readable reference, LOS-2026-000123. Never reused, even after a rollback. */
export const applicationReferenceSeq = pgSequence('application_reference_seq', { startWith: 1 })

const money = (name) => numeric(name, { precision: 14, scale: 2, mode: 'number' })

/**
 * A submitted loan application. `status` is one of APPLICATION_STATUSES in
 * src/config/applications.js; `version` increases on every change so two staff members
 * editing the same case cannot silently overwrite each other.
 */
export const applications = pgTable(
  'applications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reference: text('reference').notNull(),
    // Sent by the browser with each submit attempt; a retry after a dropped connection
    // finds the existing row instead of filing the loan twice.
    submissionKey: text('submission_key').notNull(),
    loanType: text('loan_type').notNull(),
    status: text('status').notNull().default('submitted'),
    version: integer('version').notNull().default(0),

    customerId: uuid('customer_id').references(() => users.id, { onDelete: 'set null' }),
    applicantEmail: text('applicant_email').notNull(),
    applicantName: text('applicant_name').notNull(),
    applicantPhone: text('applicant_phone'),
    // Business loans only; searchable alongside the applicant.
    companyName: text('company_name'),

    amount: money('amount').notNull(),
    tenure: integer('tenure').notNull(),
    totalRepayable: money('total_repayable').notNull(),
    monthlyInstalment: money('monthly_instalment').notNull(),
    // The wizard's personalData / businessData, with attachments replaced by markers.
    data: jsonb('data').notNull(),

    // Who brought it in: self (the public site), or an agent / RM by referral or assisted entry.
    channel: text('channel').notNull().default('self'),
    sourcedBy: uuid('sourced_by').references(() => users.id, { onDelete: 'set null' }),
    assignedRm: uuid('assigned_rm').references(() => users.id, { onDelete: 'set null' }),
    assignedOfficer: uuid('assigned_officer').references(() => users.id, { onDelete: 'set null' }),
    referralCode: text('referral_code'),

    // The open "please send us…" request while status is info_requested.
    infoRequest: jsonb('info_request'),
    // Verification checklist: { identity: { done, note, by, at }, documents: …, income: …, crb: … }
    checks: jsonb('checks').notNull().default(sql`'{}'::jsonb`),
    // Configurable stages done so far (Settings → Stages): { [stageId]: { done, note, by, byName, at } }
    stageProgress: jsonb('stage_progress').notNull().default(sql`'{}'::jsonb`),
    // What was approved, when it differs from what was asked for.
    approvedAmount: money('approved_amount'),
    approvedTenure: integer('approved_tenure'),

    // Frappe LMS hand-off: not_configured (no LMS), waiting (sent once approved), pending,
    // sending, synced, failed, uncertain (no reply — someone must check the LMS first)
    lmsSyncStatus: text('lms_sync_status').notNull().default('not_configured'),
    lmsReference: text('lms_reference'),
    lmsError: text('lms_error'),
    lmsAttempts: integer('lms_attempts').notNull().default(0),
    lmsSyncedAt: timestamp('lms_synced_at', { withTimezone: true }),

    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    // The approved offer waits for the customer to accept it until this moment.
    offerExpiresAt: timestamp('offer_expires_at', { withTimezone: true }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    closedReason: text('closed_reason'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('applications_reference_key').on(table.reference),
    uniqueIndex('applications_submission_key').on(table.submissionKey),
    index('applications_status_idx').on(table.status),
    index('applications_email_idx').on(table.applicantEmail),
    index('applications_sourced_by_idx').on(table.sourcedBy),
    index('applications_assigned_rm_idx').on(table.assignedRm),
    index('applications_assigned_officer_idx').on(table.assignedOfficer),
    index('applications_submitted_at_idx').on(table.submittedAt),
    index('applications_lms_sync_idx').on(table.lmsSyncStatus),
  ]
)

/**
 * A started, not yet submitted application, for the pipeline's Draft column. The draft
 * itself (every field, the attachments) stays in Redis where the wizard saves it; this is
 * the searchable summary, written on every save and removed on submit, discard or expiry.
 *
 * Customers' own drafts are listed for staff only once they agreed up front that staff may
 * contact them about it (`contactConsentAt`); drafts staff started are always listed.
 */
export const applicationDrafts = pgTable(
  'application_drafts',
  {
    // The id kept in the Redis draft record.
    id: uuid('id').primaryKey(),
    email: text('email').notNull(),
    loanType: text('loan_type').notNull(),
    applicantName: text('applicant_name'),
    applicantPhone: text('applicant_phone'),
    companyName: text('company_name'),
    amount: money('amount'),
    tenure: integer('tenure'),
    // Zero-based wizard step the applicant last reached, and how many there are.
    currentStep: integer('current_step').notNull().default(0),
    stepCount: integer('step_count').notNull().default(5),
    documentCount: integer('document_count').notNull().default(0),
    channel: text('channel').notNull().default('self'),
    sourcedBy: uuid('sourced_by').references(() => users.id, { onDelete: 'set null' }),
    assignedRm: uuid('assigned_rm').references(() => users.id, { onDelete: 'set null' }),
    startedByStaff: boolean('started_by_staff').notNull().default(false),
    contactConsentAt: timestamp('contact_consent_at', { withTimezone: true }),
    contactConsentVersion: text('contact_consent_version'),
    remindedAt: timestamp('reminded_at', { withTimezone: true }),
    lastSavedAt: timestamp('last_saved_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    index('application_drafts_email_idx').on(table.email),
    index('application_drafts_sourced_by_idx').on(table.sourcedBy),
    index('application_drafts_expires_at_idx').on(table.expiresAt),
  ]
)

/**
 * One attached file. `slot` is the wizard's field key (payslips, director.0.nrc, …);
 * the file lives in Blob storage at `pathname`, copied out of the draft on submit.
 */
export const applicationDocuments = pgTable(
  'application_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    slot: text('slot').notNull(),
    docType: text('doc_type').notNull(),
    label: text('label').notNull(),
    pathname: text('pathname').notNull(),
    url: text('url').notNull(),
    filename: text('filename').notNull(),
    contentType: text('content_type'),
    size: integer('size'),
    // applicant (the wizard), staff (added by an officer), info_response (sent after a request),
    // system (an offer letter or agreement the workspace generated, and their signed copies)
    source: text('source').notNull().default('applicant'),
    // The AI document check, as recorded by the server when the file was analysed.
    aiAnalysis: jsonb('ai_analysis'),
    // Set once uploaded to Frappe, so a retried sync does not upload it again.
    lmsFileUrl: text('lms_file_url'),
    // Generated documents (source "system"): { kind, templateVersion, sha256, signed }.
    meta: jsonb('meta').notNull().default(sql`'{}'::jsonb`),
    uploadedBy: uuid('uploaded_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('application_documents_application_idx').on(table.applicationId)]
)

/** The case timeline. `visibleToCustomer` rows also appear on the applicant's own page. */
export const applicationEvents = pgTable(
  'application_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    actorId: uuid('actor_id'),
    actorLabel: text('actor_label').notNull(),
    type: text('type').notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status'),
    message: text('message'),
    detail: jsonb('detail').notNull().default(sql`'{}'::jsonb`),
    visibleToCustomer: boolean('visible_to_customer').notNull().default(false),
  },
  (table) => [index('application_events_application_idx').on(table.applicationId, table.at)]
)

// ---------------------------------------------------------------------------
// Credit rules and prescreening (Phase 3)
// ---------------------------------------------------------------------------

/**
 * Versioned credit rules. One `published` set is in force; at most one `draft` is being
 * edited; older sets are `archived`. Each prescreen records the version it used, so a
 * decision can always be traced to the rules that applied at the time.
 */
export const rulesets = pgTable(
  'rulesets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    version: integer('version'),
    status: text('status').notNull(),
    rules: jsonb('rules').notNull(),
    note: text('note'),
    createdBy: uuid('created_by'),
    publishedBy: uuid('published_by'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index('rulesets_status_idx').on(table.status), uniqueIndex('rulesets_version_key').on(table.version)]
)

/** The latest prescreen of an application: computed facts, rule results, and the AI's explanation. */
export const prescreens = pgTable(
  'prescreens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    rulesetVersion: integer('ruleset_version').notNull(),
    facts: jsonb('facts').notNull(),
    ruleResults: jsonb('rule_results').notNull(),
    // pass | refer | decline
    outcome: text('outcome').notNull(),
    aiReview: jsonb('ai_review'),
    aiError: text('ai_error'),
    ...timestamps,
  },
  (table) => [uniqueIndex('prescreens_application_key').on(table.applicationId), index('prescreens_outcome_idx').on(table.outcome)]
)

// ---------------------------------------------------------------------------
// Appraisal (Phase 4)
// ---------------------------------------------------------------------------

/**
 * Credit judgements on a case. An officer's `recommendation`, then — when four-eyes
 * approval is on — a different person's `decision`. Append-only: a returned case gets a
 * new recommendation rather than an edited one.
 */
export const appraisals = pgTable(
  'appraisals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    // approve | decline | return (a decision sending the case back for more work)
    verdict: text('verdict').notNull(),
    amount: money('amount'),
    tenure: integer('tenure'),
    conditions: text('conditions'),
    rationale: text('rationale').notNull(),
    officerId: uuid('officer_id'),
    officerName: text('officer_name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('appraisals_application_idx').on(table.applicationId)]
)

// ---------------------------------------------------------------------------
// Consent and location (Phase 7), credit bureau (Phase 8)
// ---------------------------------------------------------------------------

/**
 * What the applicant agreed to, and how. `noticeVersion` identifies the exact wording
 * shown (src/config/consent.js), so a consent can be shown back later word for word.
 */
export const consents = pgTable(
  'consents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    // data_processing | location | crb
    type: text('type').notNull(),
    granted: boolean('granted').notNull(),
    noticeVersion: text('notice_version').notNull(),
    // applicant_checkbox (self-service) | customer_code (assisted: the customer read back an emailed code)
    method: text('method').notNull(),
    capturedBy: uuid('captured_by'),
    ip: text('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('consents_application_idx').on(table.applicationId)]
)

/**
 * Positions tied to an application: where the applicant was when they submitted (with
 * consent), and where staff were on field visits. Deleted with the application.
 */
export const locations = pgTable(
  'locations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    // applicant | field_visit
    source: text('source').notNull(),
    latitude: numeric('latitude', { precision: 9, scale: 6, mode: 'number' }).notNull(),
    longitude: numeric('longitude', { precision: 9, scale: 6, mode: 'number' }).notNull(),
    accuracyMeters: integer('accuracy_meters'),
    note: text('note'),
    capturedBy: uuid('captured_by'),
    capturedByName: text('captured_by_name'),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('locations_application_idx').on(table.applicationId)]
)

/** Credit bureau reports pulled for an application. `report` is the provider's summary, never the raw file. */
export const crbReports = pgTable(
  'crb_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    score: integer('score'),
    report: jsonb('report').notNull(),
    requestedBy: uuid('requested_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('crb_reports_application_idx').on(table.applicationId)]
)

// ---------------------------------------------------------------------------
// Notifications, legal documents, error log
// ---------------------------------------------------------------------------

/** In-app notifications for staff (the bell), optionally also emailed. */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    applicationId: uuid('application_id').references(() => applications.id, { onDelete: 'cascade' }),
    readAt: timestamp('read_at', { withTimezone: true }),
    emailedAt: timestamp('emailed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('notifications_user_idx').on(table.userId, table.createdAt)]
)

/**
 * The terms and privacy notice applicants accept, versioned like the credit rules. A
 * consent row records `kind-version`, so the exact text agreed to can be shown later.
 */
export const legalDocuments = pgTable(
  'legal_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // terms | privacy
    kind: text('kind').notNull(),
    version: integer('version'),
    status: text('status').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    publishedBy: uuid('published_by'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index('legal_documents_kind_idx').on(table.kind, table.status), uniqueIndex('legal_documents_version_key').on(table.kind, table.version)]
)

/**
 * The offer letter and loan agreement templates (Settings → Documents), versioned like the
 * terms: one draft and one published version per kind; publishing retires the last one.
 * `source` is text (written in the workspace, `body` with {{fields}}) or pdf (uploaded;
 * `pdfPathname` in storage, `fields` the form field names found in it).
 */
export const documentTemplates = pgTable(
  'document_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(),
    version: integer('version').notNull(),
    // draft | published | retired
    status: text('status').notNull(),
    source: text('source').notNull().default('text'),
    title: text('title').notNull(),
    body: text('body'),
    pdfPathname: text('pdf_pathname'),
    pdfUrl: text('pdf_url'),
    pdfFilename: text('pdf_filename'),
    fields: jsonb('fields').notNull().default(sql`'[]'::jsonb`),
    createdBy: uuid('created_by'),
    publishedBy: uuid('published_by'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [uniqueIndex('document_templates_kind_version_key').on(table.kind, table.version), index('document_templates_kind_status_idx').on(table.kind, table.status)]
)

/**
 * A customer's signature on their offer: who, how, when, from where, and a SHA-256 of each
 * document before and after it was signed, so a signed copy can later be shown to be the
 * one they saw. `image` is the drawn (or typed-and-rendered) signature as a PNG data URL.
 */
export const signatures = pgTable(
  'signatures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    signerName: text('signer_name').notNull(),
    signerEmail: text('signer_email').notNull(),
    // drawn | typed
    method: text('method').notNull(),
    image: text('image').notNull(),
    // The emailed code the customer entered to confirm it was them.
    codeVerified: boolean('code_verified').notNull().default(false),
    // Staff member present, for an acceptance recorded in person.
    capturedBy: uuid('captured_by').references(() => users.id, { onDelete: 'set null' }),
    ip: text('ip'),
    userAgent: text('user_agent'),
    // [{ kind, label, documentId, sha256, signedDocumentId, signedSha256, templateVersion }]
    documents: jsonb('documents').notNull().default(sql`'[]'::jsonb`),
    signedAt: timestamp('signed_at', { withTimezone: true }).notNull().defaultNow(),
    // HMAC over the record and every document fingerprint (signing.js), keyed from the
    // environment: whoever can edit the database and file store still can't forge one.
    seal: text('seal'),
  },
  (table) => [index('signatures_application_idx').on(table.applicationId)]
)

/** Server and browser errors, for the System health page. Grouped by fingerprint. */
export const errorReports = pgTable(
  'error_reports',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    fingerprint: text('fingerprint').notNull(),
    source: text('source').notNull(),
    message: text('message').notNull(),
    stack: text('stack'),
    route: text('route'),
    count: integer('count').notNull().default(1),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    detail: jsonb('detail').notNull().default(sql`'{}'::jsonb`),
  },
  (table) => [uniqueIndex('error_reports_fingerprint_key').on(table.fingerprint), index('error_reports_last_seen_idx').on(table.lastSeenAt)]
)
