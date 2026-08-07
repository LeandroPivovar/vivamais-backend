import { Controller, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SsoService } from './sso.service';

@Controller('sso')
@UseGuards(JwtAuthGuard)
export class SsoController {
  constructor(private ssoService: SsoService) {}

  @Post(':benefit')
  async requestAccess(@CurrentUser() authUser: { id: number }, @Param('benefit') benefit: string) {
    const result = await this.ssoService.requestAccess(authUser.id, benefit);
    if (!result) throw new NotFoundException('Benefício desconhecido.');
    return result;
  }
}
