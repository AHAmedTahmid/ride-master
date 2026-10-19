import { describe, expect, it } from 'vitest'
import { normalizePhone, validatePhone } from './phone'

describe('normalizePhone', () => {
  it('accepts a 7-digit local number', () => {
    expect(normalizePhone('7712345')).toBe('+9607712345')
  })

  it('accepts +960 format', () => {
    expect(normalizePhone('+9607712345')).toBe('+9607712345')
  })

  it('accepts 960 format without plus', () => {
    expect(normalizePhone('9607712345')).toBe('+9607712345')
  })

  it('strips spaces and dashes', () => {
    expect(normalizePhone('960 771-2345')).toBe('+9607712345')
    expect(normalizePhone('+960 771 2345')).toBe('+9607712345')
  })

  it('rejects numbers that are not Maldivian', () => {
    expect(() => normalizePhone('12345')).toThrow(/Invalid Maldivian phone/)
    expect(() => normalizePhone('+9601234567890')).toThrow(/Invalid Maldivian phone/)
    expect(() => normalizePhone('+12025550123')).toThrow(/Invalid Maldivian phone/)
    expect(() => normalizePhone('')).toThrow()
  })
})

describe('validatePhone', () => {
  it('accepts exactly +960 + 7 digits', () => {
    expect(validatePhone('+9607712345')).toBe(true)
  })

  it('rejects anything else', () => {
    expect(validatePhone('7712345')).toBe(false)
    expect(validatePhone('+960771234')).toBe(false)
    expect(validatePhone('+96077123456')).toBe(false)
    expect(validatePhone('+12025550123')).toBe(false)
  })
})
