import { list, del } from '@vercel/blob'
import kv from '../_lib/kv.js'

// Vercel KV entries (draft:*, draftToken:*) expire on their own TTL, but Blob
// objects have no TTL — this sweeps document blobs whose owning draft has
// already expired out of KV and removes them.
export default async function handler(req, res) {
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ message: 'Unauthorized' })
    }
  }

  let cursor
  let deleted = 0
  let scanned = 0

  do {
    const page = await list({ prefix: 'drafts/', cursor, limit: 1000 })
    cursor = page.cursor

    for (const blob of page.blobs) {
      scanned += 1
      const email = blob.pathname.split('/')[1]
      if (!email) continue
      const draftExists = await kv.exists(`draft:${email}`)
      if (!draftExists) {
        await del(blob.url)
        deleted += 1
      }
    }
  } while (cursor)

  return res.status(200).json({ scanned, deleted })
}
