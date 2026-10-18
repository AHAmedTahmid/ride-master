import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { Observable } from 'rxjs'
import { RequestContextData, requestContext } from '../context/request-context'

const REQUEST_ID_HEADER = 'x-request-id'

/**
 * Assigns every request a UUID (or honours an inbound X-Request-Id),
 * stores it in AsyncLocalStorage for logs/audit and echoes it in the response.
 */
@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle()
    }
    const req = context.switchToHttp().getRequest()
    const inbound = req.headers[REQUEST_ID_HEADER]
    const requestId =
      typeof inbound === 'string' && inbound.length > 0 && inbound.length <= 100
        ? inbound
        : randomUUID()

    req.requestId = requestId
    const res = context.switchToHttp().getResponse()
    res.setHeader('X-Request-Id', requestId)

    const store: RequestContextData = { requestId, ip: req.ip }
    return requestContext.run(store, () => next.handle())
  }
}
