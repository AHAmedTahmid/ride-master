import { describe, expect, it } from 'vitest'
import { HaversineMapProvider } from './haversine-map.provider'

describe('HaversineMapProvider', () => {
  const provider = new HaversineMapProvider()

  // Male city center → Hulhumale phase 1 (approx. 8-10 km by road, ~5.8 km straight).
  const male = { lat: 4.1755, lng: 73.5093 }
  const hulhumale = { lat: 4.2195, lng: 73.5348 }

  it('returns 0 for identical points', () => {
    expect(provider.distanceKm(male, male)).toBe(0)
  })

  it('matches the known great-circle distance for Male→Hulhumale', () => {
    const km = provider.distanceKm(male, hulhumale)
    expect(km).toBeGreaterThan(5)
    expect(km).toBeLessThan(7)
  })

  it('is symmetric', () => {
    expect(provider.distanceKm(male, hulhumale)).toBeCloseTo(
      provider.distanceKm(hulhumale, male),
      10,
    )
  })

  it('ETA uses the urban speed floor of 1 minute', () => {
    expect(provider.etaMinutes(male, male)).toBe(1)
  })

  it('ETA grows with distance at ~28 km/h', () => {
    const minutes = provider.etaMinutes(male, hulhumale)
    const km = provider.distanceKm(male, hulhumale)
    const expected = Math.max(1, Math.round((km / 28) * 60))
    expect(minutes).toBe(expected)
    expect(minutes).toBeGreaterThanOrEqual(10)
    expect(minutes).toBeLessThanOrEqual(20)
  })
})
