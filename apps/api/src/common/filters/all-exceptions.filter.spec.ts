import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import { ZodError, z } from 'zod'
import { AllExceptionsFilter } from './all-exceptions.filter'

function makeHost(exceptionShape: { request?: Record<string, unknown> } = {}) {
  const json = vi.fn()
  const status = vi.fn(() => ({ json }))
  const response = { status }
  const request = {
    method: 'GET',
    url: '/api/v1/test',
    headers: {},
    ...exceptionShape.request,
  }
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost
  return { host, status, json }
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter()

  it('renders ZodError as 400 with field details', () => {
    const schema = z.object({ phone: z.string().min(11) })
    const result = schema.safeParse({ phone: '123' })
    const error = (result as { error: ZodError }).error

    const { host, status, json } = makeHost()
    filter.catch(error, host)

    expect(status).toHaveBeenCalledWith(400)
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Validation failed',
        fields: [expect.objectContaining({ field: 'phone' })],
      }),
    )
  })

  it('renders HttpException with its own status and message', () => {
    const { host, status, json } = makeHost()
    filter.catch(new HttpException('Nope', HttpStatus.FORBIDDEN), host)
    expect(status).toHaveBeenCalledWith(403)
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403, message: 'Nope' }),
    )
  })

  it('uses HTTP status names for the error label on guard exceptions', () => {
    const { host, json } = makeHost()
    filter.catch(new HttpException('Not authenticated', 401), host)
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 401, error: 'Unauthorized' }),
    )
  })

  it('passes through structured bodies (error/fields) from exceptions', () => {
    const { host, json } = makeHost()
    filter.catch(
      new HttpException(
        { statusCode: 400, error: 'Bad Request', message: 'Validation failed', fields: [] },
        400,
      ),
      host,
    )
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Bad Request', fields: [] }),
    )
  })

  it('hides unknown errors behind a generic 500 envelope', () => {
    const { host, status, json } = makeHost()
    filter.catch(new Error('connection string leaked in message'), host)
    expect(status).toHaveBeenCalledWith(500)
    expect(json).toHaveBeenCalledWith({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'An unexpected error occurred',
    })
  })

  it('echoes x-request-id when no AsyncLocalStorage id exists', () => {
    const { host, json } = makeHost({
      request: { headers: { 'x-request-id': 'req-123' } },
    })
    filter.catch(new Error('boom'), host)
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'req-123' }))
  })
})
