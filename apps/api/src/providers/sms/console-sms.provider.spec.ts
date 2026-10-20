import { afterEach, describe, expect, it } from 'vitest'
import { ConsoleSmsProvider } from './console-sms.provider'

describe('ConsoleSmsProvider', () => {
  const original = process.env.NODE_ENV

  afterEach(() => {
    process.env.NODE_ENV = original
  })

  it('constructs outside production', () => {
    process.env.NODE_ENV = 'development'
    expect(() => new ConsoleSmsProvider()).not.toThrow()
  })

  it('refuses to construct in production', () => {
    process.env.NODE_ENV = 'production'
    expect(() => new ConsoleSmsProvider()).toThrow(/must not be used in production/)
  })

  it('sends without throwing (message goes to the log)', async () => {
    process.env.NODE_ENV = 'development'
    const provider = new ConsoleSmsProvider()
    await expect(provider.send('+9607712345', 'code 123456')).resolves.toBeUndefined()
  })
})
