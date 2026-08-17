import { Global, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Transaction } from '../billing/entities/transaction.entity';
import { Ticket } from '../tickets/entities/ticket.entity';
import { NotificationExceptionFilter } from './notification-exception.filter';
import { NotificationsService } from './notifications.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Transaction, Ticket])],
  providers: [
    NotificationsService,
    {
      provide: APP_FILTER,
      useClass: NotificationExceptionFilter,
    },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
