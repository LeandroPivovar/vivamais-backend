import { ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { ALLOW_KIDS_TEEN_KEY } from './allow-kids-teen.decorator';

/**
 * Tokens emitidos pelo login CPF-only do Kids/Teen carregam scope 'kids-teen' e só
 * acessam rotas marcadas com @AllowKidsTeen() — todo o resto (financeiro, dependentes,
 * admin etc.) exige o login completo (usuário/senha).
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ok = (await super.canActivate(context)) as boolean;
    if (!ok) return false;

    const request = context.switchToHttp().getRequest();
    if (request.user?.scope === 'kids-teen') {
      const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_KIDS_TEEN_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (!allowed) {
        throw new ForbiddenException('Acesso restrito ao Kids/Teen.');
      }
    }
    return true;
  }
}
