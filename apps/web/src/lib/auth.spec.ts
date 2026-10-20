import { describe, expect, it } from 'vitest'
import { homePathForRole } from './auth'

describe('homePathForRole', () => {
  it('maps every role to its dashboard route', () => {
    expect(homePathForRole('superadmin')).toBe('/admin')
    expect(homePathForRole('company_owner')).toBe('/company')
    expect(homePathForRole('driver')).toBe('/driver')
    expect(homePathForRole('rider')).toBe('/rider')
  })
})
