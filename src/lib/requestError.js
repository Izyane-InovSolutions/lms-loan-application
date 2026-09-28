/**
 * One-line description of a failed axios request for the console: the status (or
 * "network" when no response came back), the server's reason code and its message.
 * Full error objects dump the request config and stack, which buries the one fact
 * worth reading.
 */
export const describeRequestError = (error) => {
  const status = error?.response?.status ?? (error?.code === 'ECONNABORTED' ? 'timeout' : 'network')
  const code = error?.response?.data?.code
  const message = error?.response?.data?.message || error?.message || 'unknown error'
  return [status, code, message].filter(Boolean).join(' · ')
}

/** The draft token the request carried is unknown to the server (expired or lost). */
export const isInvalidTokenError = (error) => error?.response?.status === 401
