import { createRouter } from '../_lib/http.js'
import { authRoutes } from '../_handlers/auth.js'
import { userRoutes } from '../_handlers/users.js'
import { auditRoutes } from '../_handlers/audit.js'
import { overviewRoutes } from '../_handlers/overview.js'
import { applicationRoutes } from '../_handlers/applications.js'
import { workflowRoutes } from '../_handlers/workflow.js'
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

/*
 * Every /api/v1 endpoint, behind one Vercel function.
 *
 * One function rather than a file per route keeps the deployment's function count low
 * and lets all of them share a warm instance (and its database pool). Handlers live in
 * api/_handlers; add a feature's routes to this list.
 */
export default createRouter([
  ...authRoutes,
  ...userRoutes,
  ...auditRoutes,
  ...overviewRoutes,
  ...applicationRoutes,
  ...workflowRoutes,
  ...dashboardRoutes,
  ...demoRoutes,
  ...settingsRoutes,
  ...privacyRoutes,
  ...notificationRoutes,
  ...healthRoutes,
  ...roleRoutes,
  ...templateRoutes,
  ...brandingRoutes,
  ...workflowConfigRoutes,
  // Last: /drafts/:id must not shadow GET /drafts/file in applicationRoutes.
  ...draftRoutes,
])
