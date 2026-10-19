import { describe, expect, it } from 'vitest'
import { calculateCommission, formatMvr, laariToMvr, mvrToLaari } from './money'

describe('money utils', () => {
  it('converts laari to MVR with two decimals', () => {
    expect(laariToMvr(15050)).toBe('150.50')
    expect(laariToMvr(0)).toBe('0.00')
    expect(laariToMvr(5)).toBe('0.05')
  })

  it('converts MVR to integer laari, rounding to the nearest laari', () => {
    expect(mvrToLaari(150.5)).toBe(15050)
    expect(mvrToLaari(0.005)).toBe(1)
    expect(mvrToLaari(0)).toBe(0)
  })

  it('round-trips common fare amounts exactly', () => {
    for (const laari of [100, 1250, 45900, 999999]) {
      expect(mvrToLaari(Number(laariToMvr(laari)))).toBe(laari)
    }
  })

  it('calculates commission from basis points', () => {
    expect(calculateCommission(15000, 1000)).toBe(1500) // 10%
    expect(calculateCommission(15000, 0)).toBe(0)
    expect(calculateCommission(15000, 10000)).toBe(15000) // 100%
    expect(calculateCommission(999, 1550)).toBe(Math.round((999 * 1550) / 10000))
  })

  it('formats laari as a display MVR string', () => {
    expect(formatMvr(15050)).toBe('MVR 150.50')
  })
})
