import './load-env.js'
import { createZraClient, missingZraConfig, ZraError } from '../api/_lib/zra/client.js'
import { getZraConfig } from '../api/_lib/zra/config.js'

if (process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production') {
  console.error('Refusing to run the ZRA smoke test in production.')
  process.exitCode = 1
} else if (process.env.ZRA_UAT_SMOKE_ENABLED !== 'true') {
  console.error('ZRA smoke test is disabled. Set ZRA_UAT_SMOKE_ENABLED=true to explicitly enable it.')
  process.exitCode = 1
} else {
  const { config } = await getZraConfig()
  const missing = missingZraConfig(config)
  if (missing.length) {
    console.error(`ZRA smoke test is not configured. Set: ${missing.join(', ')}.`)
    process.exitCode = 1
  } else {
    const lookupType = (process.env.ZRA_TEST_LOOKUP_TYPE || '').trim().toUpperCase()
    const lookupValue = process.env.ZRA_TEST_LOOKUP_VALUE || ''

    try {
      if (!lookupType || !lookupValue.trim()) {
        throw new ZraError('Set ZRA_TEST_LOOKUP_TYPE and ZRA_TEST_LOOKUP_VALUE to a ZRA-approved UAT test identity.', 'zra_test_identity_missing')
      }
      const client = createZraClient({ config })
      const result = await client.lookup(lookupType, lookupValue)
      console.log('ZRA login: succeeded')
      console.log(`ZRA taxpayer lookup: ${result.found ? 'found a record' : 'no matching taxpayer'}`)
      if (result.found) console.log('Returned fields: TPIN and taxpayer name (values withheld)')
    } catch (error) {
      const code = error instanceof ZraError ? error.code : 'zra_failed'
      const message = error instanceof ZraError ? error.message : 'The ZRA smoke test failed.'
      console.error(`ZRA smoke test failed (${code}): ${message}`)
      process.exitCode = 1
    }
  }
}