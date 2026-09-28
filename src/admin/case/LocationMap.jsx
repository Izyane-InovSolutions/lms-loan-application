import React, { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// OpenStreetMap by default; set VITE_MAP_TILE_URL for a commercial or self-hosted tile
// server (OSM's public tiles are for light use only).
const TILE_URL = import.meta.env.VITE_MAP_TILE_URL || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const ATTRIBUTION = import.meta.env.VITE_MAP_ATTRIBUTION || '&copy; OpenStreetMap contributors'

const COLOURS = { applicant: '#1b4f72', field_visit: '#d0021b' }

/**
 * Where the applicant was when they submitted, and where staff visited. Circle markers
 * sized by the reported accuracy, so a vague fix reads as vague.
 */
export function LocationMap({ points }) {
  const container = useRef(null)
  const map = useRef(null)

  useEffect(() => {
    if (!container.current || !points.length) return undefined
    map.current = L.map(container.current, { scrollWheelZoom: false, attributionControl: true })
    L.tileLayer(TILE_URL, { attribution: ATTRIBUTION, maxZoom: 18 }).addTo(map.current)
    const bounds = []
    points.forEach((point) => {
      const latLng = [point.latitude, point.longitude]
      bounds.push(latLng)
      const colour = COLOURS[point.source] || COLOURS.applicant
      if (point.accuracyMeters) {
        L.circle(latLng, { radius: point.accuracyMeters, color: colour, weight: 1, fillOpacity: 0.08 }).addTo(map.current)
      }
      L.circleMarker(latLng, { radius: 7, color: '#fff', weight: 2, fillColor: colour, fillOpacity: 1 })
        .bindTooltip(`${point.source === 'applicant' ? 'Applicant at submission' : `Visit by ${point.capturedByName || 'staff'}`}${point.note ? `: ${point.note}` : ''}`)
        .addTo(map.current)
    })
    map.current.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 })
    return () => {
      map.current?.remove()
      map.current = null
    }
  }, [points])

  if (!points.length) return null
  return <div ref={container} className="h-56 w-full overflow-hidden rounded-lg border" role="img" aria-label="Map of recorded locations" />
}
