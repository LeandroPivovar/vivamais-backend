import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UsersService } from '../users/users.service';
import { ClubeCertoService } from './clube-certo.service';

/**
 * Clube de Descontos (Clube Certo) para o usuário logado. Usa o CPF da conta para
 * gerar o Token de Usuário no Clube Certo. Se a integração estiver desligada ou o
 * CPF não for associado, os endpoints devolvem { enabled:false } / listas vazias — o
 * front cai no conteúdo estático.
 */
@Controller('clube')
@UseGuards(JwtAuthGuard)
export class ClubeCertoController {
  constructor(
    private clubeCerto: ClubeCertoService,
    private usersService: UsersService,
  ) {}

  private async cpf(userId: number): Promise<string> {
    const user = await this.usersService.findById(userId);
    return user.cpf;
  }

  @Get('enabled')
  async enabled() {
    return { enabled: await this.clubeCerto.isEnabled() };
  }

  /** URL do WebApp do Clube Certo p/ o usuário logado (redirect ao clicar em "Entrar"). */
  @Get('access-url')
  async accessUrl(@CurrentUser() u: { id: number }) {
    return { url: await this.clubeCerto.getAccessUrl(await this.cpf(u.id)) };
  }

  @Get('categories')
  async categories(@CurrentUser() u: { id: number }) {
    return (await this.clubeCerto.listCategories(await this.cpf(u.id))) ?? [];
  }

  @Get('establishments')
  async establishments(
    @CurrentUser() u: { id: number },
    @Query() query: Record<string, string>,
  ) {
    return (await this.clubeCerto.searchEstablishments(await this.cpf(u.id), query)) ?? [];
  }

  @Get('establishment/:id')
  async establishment(@CurrentUser() u: { id: number }, @Param('id') id: string) {
    return (await this.clubeCerto.establishmentDetail(await this.cpf(u.id), id)) ?? null;
  }

  @Get('states')
  async states(@CurrentUser() u: { id: number }) {
    return (await this.clubeCerto.listStates(await this.cpf(u.id))) ?? [];
  }

  @Get('cities/:stateId')
  async cities(@CurrentUser() u: { id: number }, @Param('stateId') stateId: string) {
    return (await this.clubeCerto.listCities(await this.cpf(u.id), stateId)) ?? [];
  }

  @Get('cashback')
  async cashback(@CurrentUser() u: { id: number }) {
    return (await this.clubeCerto.listCashback(await this.cpf(u.id))) ?? [];
  }
}
