import { LatLng, MapProvider } from './map.provider'

const EARTH_RADIUS_KM = 6371
/** Average Malé/Hulhumalé urban speed including stops, km/h. */
const AVG_URBAN_SPEED_KMH = 28

function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

/**
 * Haversine distance + simple urban ETA. The default dev provider; the
 * Google Maps adapter (Phase 4) replaces it via MAP_PROVIDER without
 * touching callers.
 */
export class HaversineMapProvider implements MapProvider {
  distanceKm(a: LatLng, b: LatLng): number {
    const dLat = toRad(b.lat - a.lat)
    const dLng = toRad(b.lng - a.lng)
    const lat1 = toRad(a.lat)
    const lat2 = toRad(b.lat)
    const h =
      Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
    return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h))
  }

  etaMinutes(a: LatLng, b: LatLng): number {
    const km = this.distanceKm(a, b)
    return Math.max(1, Math.round((km / AVG_URBAN_SPEED_KMH) * 60))
  }
}
