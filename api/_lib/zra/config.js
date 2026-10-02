import { getSetting } from '../settings.js'
import { readZraConfig } from './client.js'

export const getZraConfig = async () => {
  const stored = await getSetting('zra')
  if (!stored.enabled) return { config: readZraConfig(), source: 'environment' }
  return {
    source: 'database',
    config: {
      baseUrl: stored.baseUrl,
      apiKey: stored.apiKey,
      username: stored.username,
      password: stored.password,
      timeoutSeconds: stored.timeoutSeconds,
    },
  }
}