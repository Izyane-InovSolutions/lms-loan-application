/*
 * Distance between where the applicant was and where they say they live.
 *
 * Needs a geocoder to turn the typed address into coordinates. Off by default
 * (GEOCODER unset), in which case the distance is simply unknown and rules over it are
 * not evaluated. GEOCODER=nominatim uses OpenStreetMap's public service — fine for low
 * volumes; set GEOCODER_URL to a self-hosted Nominatim for anything more. The typed
 * address, and the GPS coordinates (to name the place they were at), are sent to that
 * service, so enable it only where the privacy notice covers it.
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

const nominatim = async (path, params) => {
  const base = (process.env.GEOCODER_URL || 'https://nominatim.openstreetmap.org').replace(/\/+$/, '')
  const url = new URL(`${base}/${path}`)
  Object.entries({ format: 'json', ...params }).forEach(([key, value]) => url.searchParams.set(key, value))
  const response = await fetch(url, {
    headers: { 'User-Agent': 'LoanOrigination/1.0 (contact via APP_URL)' },
    signal: AbortSignal.timeout(8000),
  })
  // Busy or failing: the caller says the service didn't answer, not that the place is unknown.
  if (!response.ok) throw new Error(`Geocoder answered ${response.status}`)
  return response.json()
}

const geocodeNominatim = async (address) => {
  const [hit] = await nominatim('search', { q: address, limit: '1', countrycodes: 'zm' })
  return hit ? { latitude: Number(hit.lat), longitude: Number(hit.lon), label: shortPlace(hit.display_name) } : null
}

/** "Kabulonga, Lusaka, Lusaka District, Lusaka Province, Zambia" → "Kabulonga, Lusaka". */
const shortPlace = (name) =>
  [...new Set(String(name || '').split(',').map((part) => part.trim()).filter((part) => part && !/district|province|^zambia$|^\d+$/i.test(part)))].slice(0, 3).join(', ') || null

/** The nearest named place to a point ("Kabulonga, Lusaka"), or null when the service can't say. */
const placeNear = async (point) => {
  const hit = await nominatim('reverse', { lat: String(point.latitude), lon: String(point.longitude), zoom: '16' }).catch(() => null)
  return hit?.display_name ? shortPlace(hit.display_name) : null
}

const gpsLabel = (point) => `${Number(point.latitude).toFixed(5)}, ${Number(point.longitude).toFixed(5)}`

/**
 * Compares where the applicant was when they submitted — the GPS coordinates their device
 * gave — with the home address they typed. Returns:
 *   km             the distance between the two, or null when it can't be measured
 *   gps            the coordinates compared, and the nearest named place to them
 *   address        what was typed, whether it was found on the map, and where
 *   reason         when km is null, why — in words an officer can act on
 * No AI is involved: the typed address is looked up on OpenStreetMap (GEOCODER).
 */
export const addressDistance = async (application, point) => {
  const typed = String(addressOf(application) || '').trim()
  const address = { typed: typed || null, found: null, label: null }
  if (!point) return { km: null, gps: null, address, reason: 'The applicant’s location wasn’t recorded when they submitted.' }
  const geocoding = (process.env.GEOCODER || '').trim() === 'nominatim'
  const gps = { latitude: Number(point.latitude), longitude: Number(point.longitude), accuracy: point.accuracyMeters ?? point.accuracy ?? null, place: geocoding ? await placeNear(point) : null }
  const at = `They submitted from ${gpsLabel(gps)}${gps.place ? ` (near ${gps.place})` : ''}`
  if (!geocoding) return { km: null, gps, address, reason: `${at}, but address look-up isn’t set up (GEOCODER), so the home address can’t be placed on the map to compare.` }
  if (typed.length < 5) return { km: null, gps, address: { ...address, found: false }, reason: `${at}, but the home address they typed${typed ? `, “${typed}”,` : ''} is too short to find on the map. Check the address with the applicant.` }
  const place = await geocodeNominatim(typed).catch(() => undefined)
  if (place === undefined) return { km: null, gps, address, reason: `${at}, but the map service didn’t answer when looking up their home address. Run the rules again to retry.` }
  if (!place) return { km: null, gps, address: { ...address, found: false }, reason: `${at}, but the home address they typed, “${typed}”, couldn’t be found on the map to compare. Check the address with the applicant.` }
  return { km: Number(haversineKm(place, gps).toFixed(1)), gps, address: { typed, found: true, label: place.label, latitude: place.latitude, longitude: place.longitude } }
}

/** Kilometres from the stated address to `point`, or null when it cannot be worked out. */
export const addressDistanceKm = async (application, point) => (await addressDistance(application, point)).km
