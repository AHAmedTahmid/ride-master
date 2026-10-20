import { describe, expect, it } from 'vitest'
import { compactPhone, formatDateTime, formatLaari } from './format'

describe('formatLaari', () => {
  it('formats integer laari as exact MVR', () => {
    expect(formatLaari(0)).toBe('0.00')
    expect(formatLaari(50)).toBe('0.50')
    expect(formatLaari(1250)).toBe('12.50')
    expect(formatLaari(100_00)).toBe('100.00')
    expect(formatLaari(-2050)).toBe('-20.50')
  })

  it('rejects non-integer money', () => {
    expect(() => formatLaari(12.34)).toThrow(TypeError)
  })
})

describe('compactPhone', () => {
  it('strips the country code for display', () => {
    expect(compactPhone('+9607712345')).toBe('7712345')
    expect(compactPhone('7712345')).toBe('7712345')
  })
})

describe('formatDateTime', () => {
  it('renders Maldives local time (UTC+5)', () => {
    // 2026-01-01T00:00:00Z → 05:00 local
    expect(formatDateTime('2026-01-01T00:00:00.000Z')).toBe('2026-01-01 05:00')
  })

  it('passes through unparseable values', () => {
    expect(formatDateTime('not-a-date')).toBe('not-a-date')
  })
})
