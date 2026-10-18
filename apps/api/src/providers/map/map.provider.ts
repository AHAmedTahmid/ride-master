export interface LatLng {
  lat: number
  lng: number
}

export interface MapProvider {
  /** Great-circle distance in kilometres. */
  distanceKm(a: LatLng, b: LatLng): number
  /** Rough ETA assuming urban average speed; refined by Google adapter later. */
  etaMinutes(a: LatLng, b: LatLng): number
}

export const MAP_PROVIDER = 'MAP_PROVIDER'
