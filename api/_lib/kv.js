import { createClient } from '@vercel/kv'
import { createMemoryKv } from './memoryKv.js'

// @vercel/kv is a thin wrapper over @upstash/redis, so it talks to an Upstash Redis
// store from the Vercel Marketplace unchanged — which is what "KV" means on Vercel
// now that the first-party KV product was retired and existing stores were moved to
// Upstash. The Marketplace integration injects KV_REST_API_URL/KV_REST_API_TOKEN; a
// store provisioned directly from Upstash names the same pair UPSTASH_REDIS_REST_*,
// so accept either rather than depending on which route was taken.
const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN

// The file-backed stand-in in memoryKv.js is a local-dev convenience only. On Vercel
// every invocation gets its own instance on a read-only filesystem, so a draft written
// by one request is invisible to the next — the OTP step would keep reporting "No
// in-progress application found for this email" with no obvious cause. Fail loudly on
// the first store access instead of half-working.
const createUnconfiguredKv = () =>
  new Proxy(
    {},
    {
      get() {
        throw new Error(
          'No Redis store is configured for this deployment. Add an Upstash Redis store ' +
            '(Vercel dashboard → Storage → Marketplace) and link it to this project so ' +
            'KV_REST_API_URL and KV_REST_API_TOKEN are injected.'
        )
      },
    }
  )

const kv = url && token
  ? createClient({ url, token })
  : process.env.VERCEL
    ? createUnconfiguredKv()
    : createMemoryKv()

export default kv
