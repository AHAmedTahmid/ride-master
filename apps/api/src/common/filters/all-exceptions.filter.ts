import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common'
import { Request, Response } from 'express'
import { ZodError } from 'zod'
import { ApiError } from '@ride-master/shared'
import { currentRequestId } from '../context/request-context'

/**
 * All errors leave the API in one envelope:
 *   { statusCode, error, message, requestId, fields? }
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name)

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()
    const request = ctx.getRequest<Request>()
    const requestId = currentRequestId() ?? String(request.headers['x-request-id'] ?? '')

    const { statusCode, error, message, fields } = this.resolve(exception)

    if (statusCode >= 500) {
      this.logger.error(
        `${request.method} ${request.url} → ${statusCode}`,
        exception instanceof Error ? exception.stack : String(exception),
      )
    }

    const body: ApiError = {
      statusCode,
      error,
      message,
      ...(requestId ? { requestId } : {}),
      ...(fields ? { fields } : {}),
    }
    response.status(statusCode).json(body)
  }

  private resolve(exception: unknown): {
    statusCode: number
    error: string
    message: string
    fields?: { field: string; message: string }[]
  } {
    if (exception instanceof ZodError) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Bad Request',
        message: 'Validation failed',
        fields: exception.issues.map((i) => ({
          field: i.path.join('.') || '(root)',
          message: i.message,
        })),
      }
    }

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus()
      const res = exception.getResponse()
      if (typeof res === 'object' && res !== null) {
        const obj = res as Record<string, unknown>
        return {
          statusCode,
          error: (obj.error as string) ?? HttpStatus[statusCode] ?? exception.name,
          message: (obj.message as string) ?? exception.message,
          ...(obj.fields ? { fields: obj.fields as { field: string; message: string }[] } : {}),
        }
      }
      return {
        statusCode,
        error: HttpStatus[statusCode] ?? 'Error',
        message: String(res),
      }
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      message: 'An unexpected error occurred',
    }
  }
}
