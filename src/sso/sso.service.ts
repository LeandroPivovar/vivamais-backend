import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ActivitiesService } from '../activities/activities.service';

const BENEFIT_TYPES: Record<string, 'health' | 'clube' | 'pet' | 'funeral'> = {
  telehealth: 'health',
  'clube-descontos': 'clube',
  'veterinario-24h': 'pet',
};

const BENEFIT_LABELS: Record<string, string> = {
  telehealth: 'Telemedicina',
  'clube-descontos': 'Clube de Descontos',
  'veterinario-24h': 'Veterinário 24h',
};

@Injectable()
export class SsoService {
  constructor(
    private jwtService: JwtService,
    private activitiesService: ActivitiesService,
  ) {}

  /**
   * Não existe integração real com os parceiros (Telemedicina/Clube/Funerária/Pet) — sem
   * credenciais de terceiro não há como abrir uma sessão real. Aqui é emitido um token
   * assinado e registrado o acesso de verdade (auditável), mas o redirectUrl continua
   * sendo um placeholder até haver integração com o parceiro real.
   */
  async requestAccess(userId: number, benefit: string) {
    const type = BENEFIT_TYPES[benefit];
    if (!type) return null;

    const token = this.jwtService.sign({ sub: userId, benefit }, { expiresIn: '5m' });
    await this.activitiesService.record(userId, `Acesso ao benefício ${BENEFIT_LABELS[benefit]}`, type);

    return {
      ssoToken: token,
      redirectUrl: `https://partner-placeholder.vivamaisclub.com/${benefit}?token=${token}`,
    };
  }
}
