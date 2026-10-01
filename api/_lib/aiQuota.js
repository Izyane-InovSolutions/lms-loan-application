import { countAttempt, ipOf, rateKey } from './rateLimit.js'

/*
 * Daily caps on model calls, so endpoints reachable with a draft token cannot be looped
 * into an unbounded provider bill. Three layers, because starting a draft costs nothing:
 * per applicant (one draft's worth of documents and prescreens), per caller address (one
 * client minting drafts for many emails), and a global ceiling for the whole deployment.
 *
 * A real applicant uses roughly one call per document plus a couple of prescreens, so the
 * per-applicant default leaves plenty of room for replacing files. Each call counts
 * against every layer even when a later one refuses it, which errs towards refusing.
 */
const DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT_PER_APPLICANT) || 60
const DAILY_LIMIT_PER_IP = Number(process.env.AI_DAILY_LIMIT_PER_IP) || 300
const DAILY_LIMIT_GLOBAL = Number(process.env.AI_DAILY_LIMIT_GLOBAL) || 5000
const WINDOW_SECONDS = 24 * 60 * 60

export const consumeAiQuota = async (email, req) => {
  const [perApplicant, perIp, global] = await Promise.all([
    countAttempt(`aiQuota:${email}`, WINDOW_SECONDS),
    countAttempt(rateKey('ai-ip', ipOf(req)), WINDOW_SECONDS),
    countAttempt('aiQuota:global', WINDOW_SECONDS),
  ])
  if (global > DAILY_LIMIT_GLOBAL) console.warn('[ai] daily call ceiling reached (AI_DAILY_LIMIT_GLOBAL)')
  return perApplicant <= DAILY_LIMIT && perIp <= DAILY_LIMIT_PER_IP && global <= DAILY_LIMIT_GLOBAL
}
