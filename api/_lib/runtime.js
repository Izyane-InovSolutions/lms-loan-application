/**
 * Whether this is a real deployment (a production container or server, or Vercel)
 * rather than a developer's machine or a test run. Development conveniences — the
 * in-process database, the fixed secrets key, OTP codes in the console — are refused
 * here, so a missing setting fails loudly instead of half-working.
 */
export const isDeployed = () => Boolean(process.env.VERCEL) || process.env.NODE_ENV === 'production'
