import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { TicketsService } from './tickets.service';
import { AddMessageDto } from './dto/add-message.dto';

@Controller('admin/tickets')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminTicketsController {
  constructor(private tickets: TicketsService) {}

  @Get()
  list() {
    return this.tickets.listAll();
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.tickets.getAny(id);
  }

  @Post(':id/messages')
  reply(@Param('id', ParseIntPipe) id: number, @Body() dto: AddMessageDto) {
    return this.tickets.addAdminMessage(id, dto);
  }

  @Put(':id/status')
  status(@Param('id', ParseIntPipe) id: number, @Body('status') status: string) {
    const allowed = ['enviado', 'respondido', 'fechado'] as const;
    const next = (allowed as readonly string[]).includes(status) ? (status as (typeof allowed)[number]) : 'fechado';
    return this.tickets.setStatus(id, next);
  }
}
