import { Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { WithdrawalsService } from './withdrawals.service';

@Controller('admin/withdrawals')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminWithdrawalsController {
  constructor(private withdrawals: WithdrawalsService) {}

  /** Lista paginada dos pedidos de saque (pendentes primeiro). */
  @Get()
  list(@Query('page') page?: string, @Query('limit') limit?: string, @Query('status') status?: string) {
    return this.withdrawals.listAll(Number(page) || 1, Number(limit) || 10, status);
  }

  /** Dá baixa: marca como pago e dispara o e-mail pro usuário. */
  @Post(':id/pay')
  @HttpCode(200)
  pay(@Param('id', ParseIntPipe) id: number) {
    return this.withdrawals.markPaid(id);
  }
}
