import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ReferralLink } from './entities/referral-link.entity';
import { AppConfig } from '../admin/entities/config.entity';
import { UsersService } from '../users/users.service';
import { CreateLinkDto } from './dto/create-link.dto';
import { UpdateLinkDto } from './dto/update-link.dto';

const PAYMENT_LABELS: Record<string, string> = {
  ambos: 'Cartão ou PIX',
  cartao: 'Apenas Cartão',
  pix: 'Apenas PIX',
};

function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

@Injectable()
export class ReferralsService {
  constructor(
    @InjectRepository(ReferralLink) private linksRepo: Repository<ReferralLink>,
    @InjectRepository(AppConfig) private configRepo: Repository<AppConfig>,
    private usersService: UsersService,
  ) {}

  toLinkResponse(link: ReferralLink) {
    return {
      id: link.id,
      name: link.name,
      planType: link.planType,
      desc: link.desc,
      price: link.price,
      payment: link.payment,
      url: link.url,
      cliques: link.cliques,
      conversoes: link.conversoes,
      comissao: `R$ ${Number(link.comissao).toFixed(2).replace('.', ',')}`,
      /** Bônus de R$30/indicação nova (primeiro mês), acumulado no link. */
      bonus: `R$ ${Number(link.bonusTotal).toFixed(2).replace('.', ',')}`,
      status: link.status,
    };
  }

  async listReferrals(userId: number) {
    return this.usersService.getReferralListFlat(userId);
  }

  /** Árvore da rede do usuário (hierarquia) — raiz = o próprio usuário. */
  async getReferralTree(userId: number) {
    return this.usersService.getReferralTree(userId);
  }

  async listLinks(userId: number) {
    const links = await this.linksRepo.find({ where: { userId }, order: { createdAt: 'DESC' } });
    return links.map((l) => this.toLinkResponse(l));
  }

  /** refCode estável do usuário (mesmo entre chamadas) para os links de indicação. */
  private refCodeFor(user: { id: number; name: string }): string {
    const base = slugify(user.name).replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    return `${base || 'membro'}-${user.id}`;
  }

  /**
   * Retorna os links de indicação do usuário — um por plano (Individual e Família),
   * criando-os na hora se ainda não existirem. Reusa links já criados (mantém refCode antigo).
   */
  async getOrCreatePlanLinks(userId: number) {
    const user = await this.usersService.findById(userId);
    const config = await this.getConfig();
    const refCode = this.refCodeFor(user);
    const plans = ['Individual', 'Família'];
    const out: ReturnType<ReferralsService['toLinkResponse']>[] = [];

    for (const plan of plans) {
      let link = await this.linksRepo.findOne({ where: { userId, planType: plan } });
      if (!link) {
        const price = this.basePriceForPlan(plan, config);
        link = await this.linksRepo.save(
          this.linksRepo.create({
            userId,
            name: `Plano ${plan}`,
            planType: plan,
            desc: `Link de indicação do Plano ${plan}`,
            price: `R$ ${price.toFixed(2).replace('.', ',')}/mês`,
            payment: PAYMENT_LABELS.ambos,
            url: `https://conta.vivamaisclub.com/plano-${slugify(plan)}?ref=${refCode}`,
            cliques: 0,
            conversoes: 0,
            comissao: 0,
            status: 'Ativo',
          }),
        );
      }
      out.push(this.toLinkResponse(link));
    }
    return out;
  }

  private async getConfig(): Promise<AppConfig> {
    const config = await this.configRepo.findOne({ where: {} });
    if (!config) throw new NotFoundException('Configuração do sistema não encontrada.');
    return config;
  }

  private basePriceForPlan(plan: string, config: AppConfig): number {
    if (plan === 'Família') return Number(config.planFamilyPrice);
    if (plan === 'Bronze') return Number(config.planIndividualPrice) * 0.5;
    return Number(config.planIndividualPrice);
  }

  async createLink(userId: number, dto: CreateLinkDto) {
    const config = await this.getConfig();
    const price = this.basePriceForPlan(dto.planType, config);
    const slug = slugify(dto.planType);

    const link = this.linksRepo.create({
      userId,
      name: `Checkout - Plano ${dto.planType}`,
      planType: dto.planType,
      desc: 'Link de checkout personalizado',
      price: `R$ ${price.toFixed(2).replace('.', ',')}/mês`,
      payment: PAYMENT_LABELS[dto.paymentMethod],
      url: `https://conta.vivamaisclub.com/plano-${slug}?ref=${dto.refCode}`,
      cliques: 0,
      conversoes: 0,
      comissao: 0,
      status: 'Ativo',
    });
    return this.toLinkResponse(await this.linksRepo.save(link));
  }

  async updateLink(userId: number, linkId: number, dto: UpdateLinkDto) {
    const link = await this.linksRepo.findOne({ where: { id: linkId } });
    if (!link) throw new NotFoundException('Link não encontrado.');
    if (link.userId !== userId) throw new ForbiddenException('Esse link não pertence a você.');

    const slug = slugify(dto.planType);
    link.name = dto.name;
    link.planType = dto.planType;
    link.status = dto.status;
    link.url = `https://conta.vivamaisclub.com/plano-${slug}?ref=${dto.refCode}`;
    return this.toLinkResponse(await this.linksRepo.save(link));
  }

  /**
   * Um mesmo refCode aparece em vários links do usuário (um por plano) — resolver
   * apenas pelo refCode é ambíguo, então o plano comprado desempata para o link certo.
   */
  async findLinkByRefCodeAndPlan(refCode: string, planType: string): Promise<ReferralLink | null> {
    return this.linksRepo
      .createQueryBuilder('link')
      .where('link.url LIKE :pattern', { pattern: `%ref=${refCode}%` })
      .andWhere('link.planType = :planType', { planType })
      .getOne();
  }

  /** Link do dono (indicador) para um plano — usado no webhook, onde não temos o refCode. */
  async findLinkByOwnerAndPlan(ownerUserId: number, planType: string): Promise<ReferralLink | null> {
    return this.linksRepo.findOne({ where: { userId: ownerUserId, planType } });
  }

  /** Incrementa cliques do link ao abrir o checkout público (por refCode + plano). */
  async registerClickByRefCode(refCode: string, planType?: string): Promise<void> {
    if (!refCode) return;
    const qb = this.linksRepo
      .createQueryBuilder('link')
      .where('link.url LIKE :p', { p: `%ref=${refCode}%` });
    if (planType) qb.andWhere('link.planType = :pt', { pt: planType });
    const link = await qb.getOne();
    if (!link) return;
    await this.linksRepo.increment({ id: link.id }, 'cliques', 1);
  }

  /** Bônus do primeiro mês de uma indicação nova, além da comissão de 10% de sempre. */
  static readonly NEW_REFERRAL_BONUS = 30;

  /**
   * Roda só na 1ª cobrança paga de uma assinatura vinda de indicação (nunca em
   * renovação — ver confirmPaid/recordRecurringCharge no billing). Por isso o bônus
   * de R$30 aqui é sempre "indicação nova", nunca retroativo a conversões antigas.
   */
  async registerConversion(linkId: number, amount: number): Promise<{ bonus: number }> {
    const link = await this.linksRepo.findOne({ where: { id: linkId } });
    if (!link) return { bonus: 0 };
    link.conversoes += 1;
    link.comissao = Number(link.comissao) + amount * 0.1;
    link.bonusTotal = Number(link.bonusTotal) + ReferralsService.NEW_REFERRAL_BONUS;
    await this.linksRepo.save(link);
    return { bonus: ReferralsService.NEW_REFERRAL_BONUS };
  }
}
