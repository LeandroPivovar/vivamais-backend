import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { WithdrawalsService } from './withdrawals.service';

@Controller('withdrawals')
@UseGuards(JwtAuthGuard)
export class WithdrawalsController {
  constructor(private withdrawals: WithdrawalsService) {}

  /** Saldo disponível/pendente/sacado + histórico do usuário logado. */
  @Get('summary')
  summary(@CurrentUser() authUser: { id: number }) {
    return this.withdrawals.summary(authUser.id);
  }

  @Get()
  listMine(@CurrentUser() authUser: { id: number }) {
    return this.withdrawals.listMine(authUser.id);
  }

  /** Solicita o saque do saldo disponível (vira pendente até o admin dar baixa). */
  @Post()
  @HttpCode(200)
  request(@CurrentUser() authUser: { id: number }) {
    return this.withdrawals.request(authUser.id);
  }
}
