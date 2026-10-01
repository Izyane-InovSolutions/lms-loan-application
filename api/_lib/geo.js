/*
 * Distance between where the applicant was and where they say they live.
 *
 * Needs a geocoder to turn the typed address into coordinates. Off by default
 * (GEOCODER unset), in which case the distance is simply unknown and rules over it are
 * not evaluated. GEOCODER=nominatim uses OpenStreetMap's public service — fine for low
 * volumes; set GEOCODER_URL to a self-hosted Nominatim for anything more. The address
 * is sent to that service, so enable it only where the privacy notice covers it.
 */

const EARTH_RADIUS_KM = 6371

export const haversineKm = (a, b) => {
  const toRadians = (degrees) => (degrees * Math.PI) / 180
  const dLat = toRadians(b.latitude - a.latitude)
  const dLon = toRadians(b.longitude - a.longitude)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h))
}

const addressOf = (application) =>
  application.loanType === 'personal' ? application.data?.employmentInfo?.residentialAddress : application.data?.directorInfo?.applicantAddress

const geocodeNominatim = async (address) => {
  const base = (process.env.GEOCODER_URL || 'https://nominatim.openstreetmap.org').replace(/\/+$/, '')
  const url = new URL(`${base}/search`)
  url.searchParams.set('q', address)
  url.searchParams.set('format', 'json')
  url.searchParams.set('limit', '1')
  url.searchParams.set('countrycodes', 'zm')
  const response = await fetch(url, {
    headers: { 'User-Agent': 'LoanOrigination/1.0 (contact via APP_URL)' },
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) return null
  const [hit] = await response.json()
  return hit ? { latitude: Number(hit.lat), longitude: Number(hit.lon) } : null
}

/** Kilometres from the stated address to `point`, or null when it cannot be worked out. */
export const addressDistanceKm = async (application, point) => {
  if ((process.env.GEOCODER || '').trim() !== 'nominatim') return null
  const address = String(addressOf(application) || '').trim()
  if (address.length < 5) return null
  const place = await geocodeNominatim(address)
  return place ? Number(haversineKm(place, point).toFixed(1)) : null
}
