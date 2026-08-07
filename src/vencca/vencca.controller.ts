import { Controller, Get, ServiceUnavailableException, UseGuards } from '@nestjs/common';
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
   * Retorna a URL de Login SSO da telemedicina médica pro usuário logado.
   * Frontend abre essa URL em nova aba. Fluxo: consulta beneficiário pelo CPF →
   * pega uuid_telemed → monta a URL com id-parceiro.
   */
  @Get('sso')
  async sso(@CurrentUser() authUser: { id: number }) {
    if (!this.venccaService.isEnabled()) {
      throw new ServiceUnavailableException('Integração de telemedicina ainda não está ativa.');
    }
    const user = await this.usersService.findById(authUser.id);
    const beneficiario = await this.venccaService.getBeneficiaryByCpf(user.cpf);
    if (!beneficiario || !beneficiario.ativo) {
      throw new ServiceUnavailableException(
        'Seu cadastro de telemedicina ainda está sendo processado. Tente novamente em alguns minutos.',
      );
    }
    const redirectUrl = this.venccaService.buildSsoUrl(beneficiario.uuid_telemed);
    if (!redirectUrl) {
      throw new ServiceUnavailableException('Configuração de SSO da telemedicina incompleta.');
    }
    return { redirectUrl };
  }
}
