import { Controller, ForbiddenException, Get, Query, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UsersService } from '../users/users.service';
import { VenccaService } from './vencca.service';

@Controller('telemedicina')
@UseGuards(JwtAuthGuard)
export class VenccaController {
  constructor(
    private usersService: UsersService,
    private venccaService: VenccaService,
  ) {}

  /**
   * Retorna a URL de Login SSO da telemedicina médica pro usuário logado (ou, se
   * `dependentId` for informado, para o dependente selecionado no modal "para quem
   * é a consulta"). Frontend abre essa URL em nova aba. Fluxo: consulta beneficiário
   * pelo CPF → pega uuid_telemed → monta a URL com id-parceiro.
   */
  @Get('sso')
  async sso(@CurrentUser() authUser: { id: number }, @Query('dependentId') dependentId?: string) {
    if (!this.venccaService.isEnabled()) {
      throw new ServiceUnavailableException('Integração de telemedicina ainda não está ativa.');
    }

    let targetUser = await this.usersService.findById(authUser.id);
    if (dependentId) {
      const dependent = await this.usersService.findById(Number(dependentId));
      if (!dependent || dependent.holderId !== authUser.id) {
        throw new ForbiddenException('Dependente inválido.');
      }
      targetUser = dependent;
    }

    const beneficiario = await this.venccaService.getBeneficiaryByCpf(targetUser.cpf);
    if (!beneficiario || !beneficiario.ativo) {
      throw new ServiceUnavailableException(
        'Cadastro de telemedicina ainda está sendo processado. Tente novamente em alguns minutos.',
      );
    }
    const redirectUrl = this.venccaService.buildSsoUrl(beneficiario.uuid_telemed);
    if (!redirectUrl) {
      throw new ServiceUnavailableException('Configuração de SSO da telemedicina incompleta.');
    }
    return { redirectUrl };
  }
}
