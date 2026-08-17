import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ReferralsModule } from './referrals/referrals.module';
import { BillingModule } from './billing/billing.module';
import { ActivitiesModule } from './activities/activities.module';
import { AdminModule } from './admin/admin.module';
import { ContentModule } from './content/content.module';
import { SsoModule } from './sso/sso.module';
import { VenccaModule } from './vencca/vencca.module';
import { PaymentModule } from './payment/payment.module';
import { MailModule } from './mail/mail.module';
import { ClubeCertoModule } from './clube-certo/clube-certo.module';
import { DependentsModule } from './dependents/dependents.module';
import { TelegramModule } from './telegram/telegram.module';
import { TicketsModule } from './tickets/tickets.module';
import { ChatModule } from './chat/chat.module';
import { UploadsModule } from './uploads/uploads.module';
import { NotificationsModule } from './notifications/notifications.module';
import { User } from './users/entities/user.entity';
import { ReferralLink } from './referrals/entities/referral-link.entity';
import { Transaction } from './billing/entities/transaction.entity';
import { Activity } from './activities/entities/activity.entity';
import { AppConfig } from './admin/entities/config.entity';
import { Ticket } from './tickets/entities/ticket.entity';
import { TicketMessage } from './tickets/entities/ticket-message.entity';
import { ChatConversation } from './chat/entities/chat-conversation.entity';
import { ChatMessage } from './chat/entities/chat-message.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRoot({
      type: 'mysql',
      host: process.env.DB_HOST ?? 'localhost',
      port: Number(process.env.DB_PORT ?? 3306),
      username: process.env.DB_USERNAME ?? 'root',
      password: process.env.DB_PASSWORD ?? '',
      database: process.env.DB_DATABASE ?? 'acesso_saude',
      entities: [User, ReferralLink, Transaction, Activity, AppConfig, Ticket, TicketMessage, ChatConversation, ChatMessage],
      synchronize: false,
      migrationsRun: false,
    }),
    AuthModule,
    UsersModule,
    ReferralsModule,
    BillingModule,
    ActivitiesModule,
    AdminModule,
    ContentModule,
    SsoModule,
    VenccaModule,
    PaymentModule,
    MailModule,
    ClubeCertoModule,
    DependentsModule,
    TelegramModule,
    TicketsModule,
    ChatModule,
    UploadsModule,
    NotificationsModule,
  ],
})
export class AppModule {}
