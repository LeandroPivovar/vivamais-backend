import 'reflect-metadata';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { ReferralLink } from '../referrals/entities/referral-link.entity';
import { Transaction } from '../billing/entities/transaction.entity';
import { Activity } from '../activities/entities/activity.entity';
import { AppConfig } from '../admin/entities/config.entity';
import { Ticket } from '../tickets/entities/ticket.entity';
import { TicketMessage } from '../tickets/entities/ticket-message.entity';
import { ChatConversation } from '../chat/entities/chat-conversation.entity';
import { ChatMessage } from '../chat/entities/chat-message.entity';
import { Heir } from '../heirs/entities/heir.entity';

config();

export const AppDataSource = new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 3306),
  username: process.env.DB_USERNAME ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_DATABASE ?? 'acesso_saude',
  entities: [User, ReferralLink, Transaction, Activity, AppConfig, Ticket, TicketMessage, ChatConversation, ChatMessage, Heir],
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  synchronize: false,
});
