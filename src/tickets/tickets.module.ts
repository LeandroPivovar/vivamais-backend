import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Ticket } from './entities/ticket.entity';
import { TicketMessage } from './entities/ticket-message.entity';
import { TicketsService } from './tickets.service';
import { TicketsController } from './tickets.controller';
import { AdminTicketsController } from './admin-tickets.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Ticket, TicketMessage])],
  controllers: [TicketsController, AdminTicketsController],
  providers: [TicketsService],
})
export class TicketsModule {}
