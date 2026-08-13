import { kv as vercelKv } from '@vercel/kv'
import { createMemoryKv } from './memoryKv.js'

const hasVercelKv = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)

export default hasVercelKv ? vercelKv : createMemoryKv()
