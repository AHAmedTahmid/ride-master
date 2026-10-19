import { describe, expect, it } from 'vitest'
import { generateUlid } from './ulid'

describe('generateUlid', () => {
  it('produces 26-character Crockford base32 IDs', () => {
    const id = generateUlid()
    expect(id).toHaveLength(26)
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
  })

  it('is unique', () => {
    const ids = new Set(Array.from({ length: 500 }, () => generateUlid()))
    expect(ids.size).toBe(500)
  })

  it('is monotonic within the same millisecond', () => {
    const [a, b] = [generateUlid(), generateUlid()]
    expect(a < b).toBe(true)
  })
})
