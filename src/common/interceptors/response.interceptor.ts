    import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map, Observable } from 'rxjs';
import { RESPONSE_MESSAGE_KEY } from '../decorators/response-message.decorator.js';
import { Paginated } from '../responses/paginated.js';


@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const message =
      this.reflector.getAllAndOverride<string>(RESPONSE_MESSAGE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'Success';

    return next.handle().pipe(
      map((result: unknown) => {
        // file downloads must not be wrapped
        if (result instanceof StreamableFile) return result;

        if (result instanceof Paginated) {
          return {
            success: true,
            message,
            data: result.items,
            meta: result.meta,
          };
        }

        return { success: true, message, data: result ?? null };
      }),
    );
  }
}