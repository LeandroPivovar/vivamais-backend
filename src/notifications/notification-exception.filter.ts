import { ArgumentsHost, Catch, HttpException, Injectable } from '@nestjs/common';
import { BaseExceptionFilter, HttpAdapterHost } from '@nestjs/core';
import { NotificationsService } from './notifications.service';

@Catch()
@Injectable()
export class NotificationExceptionFilter extends BaseExceptionFilter {
  constructor(
    private readonly notifications: NotificationsService,
    adapterHost: HttpAdapterHost,
  ) {
    super(adapterHost.httpAdapter);
  }

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<{ method?: string; url?: string; originalUrl?: string }>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;

    if (status >= 500) {
      void this.notifications.notifyError({
        context: exception instanceof Error ? exception.name : 'Erro inesperado',
        detail: exception instanceof Error ? exception.message : String(exception),
        method: request?.method,
        path: request?.originalUrl ?? request?.url,
      });
    }

    super.catch(exception, host);
  }
}
