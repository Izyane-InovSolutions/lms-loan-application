import fs from 'node:fs'
import path from 'node:path'

// Stand-in for @vercel/kv, used only when no KV store is configured (local `vite dev`
// without a linked Vercel project). Same get/set/del/expire/exists surface our API
// routes rely on, including TTL semantics.
//
// Backed by a JSON file rather than a bare Map, mirroring the disk fallback the Blob
// helper already uses. A pure in-process Map was wiped by every dev-server restart,
// which made drafts vanish mid-test and surfaced as "No in-progress application found
// for this email" at the OTP step. If the filesystem is not writable (e.g. a serverless
// runtime), it silently degrades to memory-only.
const STORE_FILE = path.resolve(process.cwd(), '.local-kv.json')

let store = null

const load = () => {
  if (store) return store
  store = new Map()
  try {
    const raw = fs.readFileSync(STORE_FILE, 'utf8')
    for (const [key, entry] of Object.entries(JSON.parse(raw))) {
      store.set(key, entry)
    }
  } catch {
    // No store yet, or unreadable — start empty.
  }
  return store
}

const persist = () => {
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(Object.fromEntries(load()), null, 2), 'utf8')
  } catch {
    // Read-only filesystem: keep working from memory for this process.
  }
}

const isExpired = (entry) => entry.expiresAt !== null && Date.now() > entry.expiresAt

export function createMemoryKv() {
  return {
    async get(key) {
      const entries = load()
      const entry = entries.get(key)
      if (!entry || isExpired(entry)) {
        if (entry) {
          entries.delete(key)
          persist()
        }
        return null
      }
      return entry.value
    },
    async set(key, value, options = {}) {
      const entries = load()
      const existing = entries.get(key)
      let expiresAt = null
      if (options.keepTtl && existing && !isExpired(existing)) {
        expiresAt = existing.expiresAt
      } else if (options.ex) {
        expiresAt = Date.now() + options.ex * 1000
      }
      entries.set(key, { value, expiresAt })
      persist()
    },
    async del(key) {
      load().delete(key)
      persist()
    },
    async expire(key, seconds) {
      const entry = load().get(key)
      if (entry) {
        entry.expiresAt = Date.now() + seconds * 1000
        persist()
      }
    },
    async exists(key) {
      const entries = load()
      const entry = entries.get(key)
      if (!entry || isExpired(entry)) {
        if (entry) {
          entries.delete(key)
          persist()
        }
        return 0
      }
      return 1
    },
  }
}
