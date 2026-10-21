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

/** 'INTERNAL_SERVER_ERROR' → 'Internal Server Error' (standard reason phrase). */
function statusReason(statusCode: number): string | undefined {
  const name = HttpStatus[statusCode]
  if (!name || typeof name !== 'string') return undefined
  return name
    .split('_')
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(' ')
}

/**
 * Duck-typed ZodError check: vitest/monorepo dependency resolution can give
 * the API and the shared package different zod instances, breaking instanceof.
 */
function isZodError(exception: unknown): exception is ZodError {
  if (exception instanceof ZodError) return true
  if (typeof exception !== 'object' || exception === null) return false
  const candidate = exception as { name?: unknown; issues?: unknown }
  return candidate.name === 'ZodError' && Array.isArray(candidate.issues)
}

/** Multer upload errors (duck-typed: no shared @types dependency). */
function multerCode(exception: unknown): string | undefined {
  if (typeof exception !== 'object' || exception === null) return undefined
  const candidate = exception as { name?: unknown; code?: unknown }
  if (candidate.name !== 'MulterError') return undefined
  return typeof candidate.code === 'string' ? candidate.code : undefined
}

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
    if (isZodError(exception)) {
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

    const code = multerCode(exception)
    if (code) {
      const tooLarge = code === 'LIMIT_FILE_SIZE'
      return {
        statusCode: tooLarge ? HttpStatus.PAYLOAD_TOO_LARGE : HttpStatus.BAD_REQUEST,
        error: tooLarge ? 'Payload Too Large' : 'Bad Request',
        message: tooLarge ? 'File exceeds the maximum allowed size' : `Upload rejected: ${code}`,
      }
    }

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus()
      const res = exception.getResponse()
      if (typeof res === 'object' && res !== null) {
        const obj = res as Record<string, unknown>
        return {
          statusCode,
          error: (obj.error as string) ?? statusReason(statusCode) ?? exception.name,
          message: (obj.message as string) ?? exception.message,
          ...(obj.fields ? { fields: obj.fields as { field: string; message: string }[] } : {}),
        }
      }
      return {
        statusCode,
        error: statusReason(statusCode) ?? 'Error',
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
