/**
 * Client for /api/v1. The session travels as an httpOnly cookie, so there is no token
 * to store or attach — requests just need to stay same-origin.
 *
 * Failures throw an Error carrying `status` and the server's `code`, so callers can
 * branch on the reason ("invalid_token", "email_taken", …) and show `message` as-is.
 */
export async function api(path, { method = 'GET', body, signal } = {}) {
  let response
  try {
    response = await fetch(`/api/v1${path}`, {
      method,
      credentials: 'same-origin',
      signal,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw Object.assign(new Error('We couldn’t reach the server. Check your connection and try again.'), {
      status: 0,
      code: 'network',
    })
  }

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw Object.assign(new Error(data.message || 'Something went wrong. Please try again.'), {
      status: response.status,
      code: data.code,
    })
  }
  return data
}

/** Builds a query string from an object, skipping empty values. */
export const toQuery = (params) => {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '' && value !== 'all') search.set(key, value)
  })
  const encoded = search.toString()
  return encoded ? `?${encoded}` : ''
}
