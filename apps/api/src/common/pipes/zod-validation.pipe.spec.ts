import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ZodValidationPipe, parseWith } from './zod-validation.pipe'

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(
    z.object({ settingKey: z.string().min(1), value: z.union([z.number(), z.string()]) }),
  )

  it('passes valid values through, applying defaults', () => {
    const defaulted = new ZodValidationPipe(
      z.object({ passengers: z.number().int().min(1).default(1) }),
    )
    expect(defaulted.transform({})).toEqual({ passengers: 1 })
  })

  it('throws the ZodError (rendered as 400 with fields by the filter)', () => {
    expect(() => pipe.transform({ settingKey: '', value: true })).toThrow()
    try {
      pipe.transform({ settingKey: '', value: true })
    } catch (err) {
      expect(err).toBeInstanceOf(z.ZodError)
    }
  })
})

describe('parseWith', () => {
  it('returns parsed data for valid input', () => {
    expect(parseWith(z.object({ page: z.coerce.number().int() }), { page: '3' })).toEqual({
      page: 3,
    })
  })

  it('throws BadRequestException for invalid input', () => {
    expect(() => parseWith(z.object({ page: z.number() }), { page: 'x' })).toThrow(
      /Validation failed/,
    )
  })
})
