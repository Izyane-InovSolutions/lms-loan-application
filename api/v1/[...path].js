import { createRouter } from '../_lib/http.js'
import { authRoutes } from '../_handlers/auth.js'
import { userRoutes } from '../_handlers/users.js'
import { auditRoutes } from '../_handlers/audit.js'
import { overviewRoutes } from '../_handlers/overview.js'
import { applicationRoutes } from '../_handlers/applications.js'
import { workflowRoutes } from '../_handlers/workflow.js'
import { stageDocumentRoutes } from '../_handlers/stageDocuments.js'
import { dashboardRoutes } from '../_handlers/dashboard.js'
import { demoRoutes } from '../_handlers/demo.js'
import { settingsRoutes } from '../_handlers/settings.js'
import { privacyRoutes } from '../_handlers/privacy.js'
import { notificationRoutes } from '../_handlers/notifications.js'
import { healthRoutes } from '../_handlers/health.js'
import { roleRoutes } from '../_handlers/roles.js'
import { draftRoutes } from '../_handlers/drafts.js'
import { templateRoutes } from '../_handlers/templates.js'
import { brandingRoutes } from '../_handlers/branding.js'
import { workflowConfigRoutes } from '../_handlers/workflowConfig.js'
import { zraRoutes } from '../_handlers/zra.js'
import { reportRoutes } from '../_handlers/reports.js'
import { dataWipeRoutes } from '../_handlers/dataWipe.js'
import { refreshCrb } from '../_lib/crb/index.js'

/*
 * Every /api/v1 endpoint, behind one Vercel function.
 *
 * One function rather than a file per route keeps the deployment's function count low
 * and lets all of them share a warm instance (and its database pool). Handlers live in
 * api/_handlers; add a feature's routes to this list.
 */
const router = createRouter([
  ...authRoutes,
  ...userRoutes,
  ...auditRoutes,
  ...overviewRoutes,
  ...applicationRoutes,
  ...workflowRoutes,
  ...stageDocumentRoutes,
  ...dashboardRoutes,
  ...reportRoutes,
  ...demoRoutes,
  ...settingsRoutes,
  ...privacyRoutes,
  ...dataWipeRoutes,
  ...notificationRoutes,
  ...healthRoutes,
  ...roleRoutes,
  ...templateRoutes,
  ...brandingRoutes,
  ...workflowConfigRoutes,
  ...zraRoutes,
  // Last: /drafts/:id must not shadow GET /drafts/file in applicationRoutes.
  ...draftRoutes,
])

/*
 * The credit bureau setup (Settings → Credit bureau) is read synchronously by its callers,
 * so the stored setting is brought up to date here first (at most every 30 seconds). If
 * it can't be read, the last known one (or the environment) still applies.
 */
export default async function handler(req, res) {
  await refreshCrb().catch(() => {})
  return router(req, res)
}
