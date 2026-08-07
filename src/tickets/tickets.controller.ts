import { Body, Controller, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TicketsService } from './tickets.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { AddMessageDto } from './dto/add-message.dto';

@Controller('tickets')
@UseGuards(JwtAuthGuard)
export class TicketsController {
  constructor(private tickets: TicketsService) {}

  @Post()
  create(@CurrentUser() u: { id: number }, @Body() dto: CreateTicketDto) {
    return this.tickets.create(u.id, dto);
  }

  @Get()
  list(@CurrentUser() u: { id: number }) {
    return this.tickets.listForUser(u.id);
  }

  @Get(':id')
  get(@CurrentUser() u: { id: number }, @Param('id', ParseIntPipe) id: number) {
    return this.tickets.getForUser(u.id, id);
  }

  @Post(':id/messages')
  message(
    @CurrentUser() u: { id: number },
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddMessageDto,
  ) {
    return this.tickets.addUserMessage(u.id, id, dto);
  }
}
