import { isDeployed } from './runtime.js'

/*
 * Admin tools that delete records wholesale or decide how long loan records are kept.
 * A loan system shouldn't carry them switched on: each is on by default only on a
 * developer's machine, and a deployment shows it only while its variable is "true".
 * Off, its Settings tab is hidden and its endpoints answer as if they didn't exist.
 *
 *   LOS_DATA_WIPE_ENABLED            Settings → Danger zone (Wipe data)
 *   LOS_RETENTION_SETTINGS_ENABLED   Settings → Data retention (editing the periods; the
 *                                    daily clean-up keeps applying the saved ones)
 *
 * Locally, "false" turns one off, to see the workspace as production does.
 */
const flag = (name) => process.env[name] === 'true' || (!isDeployed() && process.env[name] !== 'false')

export const features = () => ({
  dataWipe: flag('LOS_DATA_WIPE_ENABLED'),
  retentionSettings: flag('LOS_RETENTION_SETTINGS_ENABLED'),
})
