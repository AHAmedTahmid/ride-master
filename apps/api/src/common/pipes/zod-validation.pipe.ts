import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common'
import { ZodTypeAny, z } from 'zod'

/**
 * Validates and transforms a request body with a zod schema from
 * @ride-master/shared. Throws 400 with field details on failure.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodTypeAny) {}

  transform(value: unknown): z.infer<ZodTypeAny> {
    const result = this.schema.safeParse(value)
    if (!result.success) {
      // ZodError is rendered as 400 with field list by AllExceptionsFilter.
      throw result.error
    }
    return result.data
  }
}

/** Convenience for optional query strings that must become integers etc. */
export function parseWith<T extends ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value)
  if (!result.success) throw new BadRequestException('Validation failed')
  return result.data
}
