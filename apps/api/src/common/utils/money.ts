import { MVR_TO_LAARI, BASIS_POINTS } from '@ride-master/shared'

/**
 * Convert laari (integer) to MVR display string (e.g. 15050 → "150.50").
 */
export function laariToMvr(laari: number): string {
  const mvr = laari / MVR_TO_LAARI
  return mvr.toFixed(2)
}

/**
 * Convert MVR (decimal) to laari (integer). Rounds to nearest laari.
 */
export function mvrToLaari(mvr: number): number {
  return Math.round(mvr * MVR_TO_LAARI)
}

/**
 * Calculate commission in laari from fare and rate in basis points.
 * Example: fare 15000 laari at 1000 bps (10%) → 1500 laari.
 */
export function calculateCommission(fareLaari: number, rateBps: number): number {
  return Math.round((fareLaari * rateBps) / BASIS_POINTS)
}

/**
 * Format laari as MVR with currency symbol (e.g. "MVR 150.50").
 */
export function formatMvr(laari: number): string {
  return `MVR ${laariToMvr(laari)}`
}
