import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, IsNull, LessThan, MoreThan, Not, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { Transaction } from './entities/transaction.entity';
import { TrialSignupLink } from './entities/trial-signup-link.entity';
import { AppConfig } from '../admin/entities/config.entity';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { ReferralsService } from '../referrals/referrals.service';
import { VenccaService } from '../vencca/vencca.service';
import { PaymentService } from '../payment/payment.service';
import { WooviService } from '../payment/woovi.service';
import { PagarmeService } from '../payment/pagarme.service';
import { ClubeCertoService } from '../clube-certo/clube-certo.service';
import { MailService } from '../mail/mail.service';
import { TelegramService } from '../telegram/telegram.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ReferralLink } from '../referrals/entities/referral-link.entity';
import { CheckoutDto } from './dto/checkout.dto';
import { TrialSignupDto } from './dto/trial-signup.dto';
import { PayDto } from './dto/pay.dto';
import { basePriceForPlan } from '../common/pricing';
import { onlyDigits, formatBrazilPhone } from '../common/phone';
import { publicUrl } from '../common/public-url';
import { brDayWindow, formatBrDate } from '../common/br-date';

// Teto de tentativas de cadastro na telemedicina antes de o cron desistir do registro.
const MAX_TELEMED_ATTEMPTS = 5;

/** Data YYYY-MM-DD daqui a N dias (vencimento do PIX). */
function dueDateInDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Senha temporária legível (sem caracteres ambíguos). */
function generatePassword(length = 8): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function formatDate(date: Date): string {
  return formatBrDate(date);
}

function formatCurrency(value: number): string {
  return `R$ ${value.toFixed(2).replace('.', ',')}`;
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly webhookDedupe = new Map<string, number>();
  private reconciling = false;
  private reconcilingPagarme = false;
  private reconcilingPaidAccess = false;
  private retryingTelemed = false;

  constructor(
    @InjectRepository(Transaction) private txRepo: Repository<Transaction>,
    @InjectRepository(TrialSignupLink) private trialLinksRepo: Repository<TrialSignupLink>,
    @InjectRepository(AppConfig) private configRepo: Repository<AppConfig>,
    @InjectRepository(User) private usersRepo: Repository<User>,
    private usersService: UsersService,
    private referralsService: ReferralsService,
    private venccaService: VenccaService,
    private paymentService: PaymentService,
    private wooviService: WooviService,
    private pagarmeService: PagarmeService,
    private clubeCertoService: ClubeCertoService,
    private mailService: MailService,
    private telegramService: TelegramService,
    private notificationsService: NotificationsService,
  ) {}

  private onceWebhook(key: string, ttlMs = 24 * 60 * 60 * 1000): boolean {
    const now = Date.now();
    for (const [k, expires] of this.webhookDedupe) {
      if (expires <= now) this.webhookDedupe.delete(k);
    }
    if (this.webhookDedupe.has(key)) return false;
    this.webhookDedupe.set(key, now + ttlMs);
    return true;
  }

  /**
   * Histórico de mensalidades: UMA fatura por mês (não uma por QR/tentativa gerada).
   * As faturas são derivadas do início da assinatura, uma por mês, aparecendo cada
   * uma a partir de 3 dias antes do vencimento. Cada pagamento confirmado quita a
   * fatura em aberto MAIS ANTIGA (paidCount faturas mais antigas = pagas). Assim,
   * gerar vários QRs não multiplica faturas, e pagar (mesmo atrasado) quita a mais antiga.
   */
  async listInvoices(userId: number) {
    await this.ensurePaidAccessForUser(userId);
    const user = await this.usersService.findById(userId);
    const config = await this.configRepo.findOne({ where: {} });
    const price = config ? basePriceForPlan(user.plan, config) : 0;

    const txs = await this.txRepo.find({ where: { userId, status: Not('duplicado') }, order: { createdAt: 'ASC' } });
    const isPaid = (s: string) => s === 'pago' || s === 'Renovado (Pago)';
    const paidCount = txs.filter((t) => isPaid(t.status)).length;
    const method =
      txs.find((t) => isPaid(t.status))?.paymentMethod ?? txs[txs.length - 1]?.paymentMethod ?? 'PIX';

    const start = new Date(user.trialEndsAt ?? user.createdAt);
    const now = Date.now();
    const THREE_DAYS = 3 * 24 * 60 * 60 * 1000;

    // Gera as faturas mensais já "visíveis" (vencimento a até 3 dias no futuro ou já passado).
    const faturas: Array<{ due: Date; paid: boolean; k: number }> = [];
    for (let k = 0; k < 600; k++) {
      const due = new Date(start);
      due.setMonth(due.getMonth() + k);
      if (due.getTime() - THREE_DAYS > now) break;
      faturas.push({ due, paid: k < paidCount, k });
    }

    // Mais recente primeiro.
    return faturas.reverse().map((f) => ({
      id: `${userId}-${f.due.getFullYear()}${String(f.due.getMonth() + 1).padStart(2, '0')}`,
      date: formatDate(f.due),
      value: formatCurrency(price),
      status: f.paid ? 'pago' : 'pendente',
      method,
    }));
  }

  async getSummary(userId: number) {
    await this.ensurePaidAccessForUser(userId);
    const user = await this.usersService.findById(userId);
    const config = await this.configRepo.findOne({ where: {} });
    if (!config) throw new NotFoundException('Configuração do sistema não encontrada.');

    const price = basePriceForPlan(user.plan, config); // cobra o valor da tabela do plano (79,90 / 129,90)
    const lastTx = await this.txRepo.findOne({ where: { userId, status: Not('duplicado') }, order: { createdAt: 'DESC' } });
    const nextBilling = user.trialEndsAt && !lastTx ? new Date(user.trialEndsAt) : lastTx ? new Date(lastTx.createdAt) : new Date();
    if (!user.trialEndsAt || lastTx) nextBilling.setMonth(nextBilling.getMonth() + 1);

    return {
      plan: user.plan,
      monthlyValue: formatCurrency(price),
      nextBillingDate: formatDate(nextBilling),
    };
  }

  /** Config de cartão pro checkout público: public key da Pagar.me + se está habilitado. */
  async getCardConfig() {
    const config = await this.configRepo.findOne({ where: {} });
    const enabled = await this.pagarmeService.isEnabled();
    return { enabled, publicKey: enabled ? config?.pagarmePublicKey ?? null : null };
  }

  /** Registra um clique no link de indicação (checkout público aberto). */
  async registerReferralClick(refCode: string, planType?: string) {
    await this.referralsService.registerClickByRefCode(refCode, planType);
    return { ok: true };
  }

  async getTrialSignupLink(token: string) {
    const link = await this.trialLinksRepo.findOne({ where: { token } });
    if (!link || link.status !== 'active' || link.usedAt) {
      throw new NotFoundException('Link de cadastro não encontrado ou já utilizado.');
    }
    return {
      token: link.token,
      plan: link.plan,
      trialDays: 30,
    };
  }

  async trialSignup(dto: TrialSignupDto) {
    const initialPassword = generatePassword();
    const passwordHash = await bcrypt.hash(initialPassword, 10);

    const { user, trialEndsAt } = await this.trialLinksRepo.manager.transaction(async (manager) => {
      const link = await manager.findOne(TrialSignupLink, {
        where: { token: dto.token },
        lock: { mode: 'pessimistic_write' },
      });
      if (!link || link.status !== 'active' || link.usedAt) {
        throw new BadRequestException('Este link de cadastro já foi utilizado ou não está disponível.');
      }

      const existing = await manager.findOne(User, { where: [{ email: dto.email }, { cpf: dto.cpf }] });
      if (existing) throw new BadRequestException('Já existe uma conta com esse e-mail ou CPF.');

      const due = new Date();
      due.setDate(due.getDate() + 30);

      const savedUser = await manager.save(
        User,
        manager.create(User, {
          name: dto.name,
          email: dto.email,
          cpf: dto.cpf,
          phone: dto.phone,
          birthDate: dto.birthDate,
          gender: dto.gender as User['gender'],
          address: dto.address,
          neighborhood: dto.neighborhood,
          complement: dto.complement ?? null,
          city: dto.city,
          state: dto.state,
          zipCode: dto.zipCode,
          passwordHash,
          plan: link.plan as User['plan'],
          level: '1º Nível',
          referredById: null,
          status: 'ativo',
          accessHealth: true,
          accessClube: true,
          accessPet: true,
          accessFuneral: false,
          trialEndsAt: due,
        }),
      );

      link.status = 'used';
      link.usedAt = new Date();
      link.usedById = savedUser.id;
      await manager.save(TrialSignupLink, link);

      return { user: savedUser, trialEndsAt: due };
    });

    await this.mailService.sendWelcomePassword(user.email, user.name, initialPassword);
    try {
      await this.mailService.sendWelcome(user.email);
    } catch (err) {
      this.logger.warn(`Falha ao enviar boas-vindas do cadastro 30 dias (user ${user.id}): ${(err as Error).message}`);
    }
    const venccaOk = await this.venccaService.registerAssociates([this.venccaService.mapUserToCliente(user)]);
    if (venccaOk) {
      user.telemedRegistered = true;
      await this.usersRepo.save(user);
    }
    await this.clubeCertoService.registerAssociate(user);

    return {
      success: true,
      status: 'trial_active',
      user: { name: user.name, plan: user.plan, active: true },
      trialEndsAt: formatDate(trialEndsAt),
    };
  }

  async checkout(dto: CheckoutDto, clientIp?: string) {
    // Sem refCode = venda direta (sem indicação/comissão). Com refCode, exige link válido.
    let link: ReferralLink | null = null;
    if (dto.refCode?.trim()) {
      link = await this.referralsService.findLinkByRefCodeAndPlan(dto.refCode, dto.planType);
      if (!link) throw new BadRequestException('Link de indicação inválido para o plano selecionado.');
    }

    const existing = await this.usersRepo.findOne({ where: [{ email: dto.email }, { cpf: dto.cpf }] });
    if (existing) throw new BadRequestException('Já existe uma conta com esse e-mail ou CPF.');

    const config = await this.configRepo.findOne({ where: {} });
    if (!config) throw new NotFoundException('Configuração do sistema não encontrada.');

    const price = basePriceForPlan(dto.planType, config);

    // Senha inicial do indicado: gerada legível e enviada por e-mail após criar a conta.
    const initialPassword = generatePassword();

    const newUser = this.usersRepo.create({
      name: dto.name,
      email: dto.email,
      cpf: dto.cpf,
      phone: dto.phone,
      birthDate: dto.birthDate,
      gender: dto.gender as User['gender'],
      address: dto.address,
      neighborhood: dto.neighborhood,
      complement: dto.complement ?? null,
      city: dto.city,
      state: dto.state,
      zipCode: dto.zipCode,
      passwordHash: await bcrypt.hash(initialPassword, 10),
      plan: dto.planType as User['plan'],
      level: '1º Nível',
      referredById: link ? link.userId : null,
      // Nasce pendente: só vira 'ativo' quando o pagamento é confirmado (confirmPaid).
      // Enquanto pendente, não gera comissão pra rede do indicador.
      status: 'pendente',
    });
    const savedUser = await this.usersRepo.save(newUser);

    // ---- Fluxo Cartão de Crédito (Pagar.me) — vale p/ qualquer gateway PIX ativo ----
    if (dto.paymentMethod === 'card' && (await this.pagarmeService.isEnabled())) {
      if (!dto.cardToken) {
        await this.usersRepo.remove(savedUser);
        throw new BadRequestException('Não foi possível ler os dados do cartão. Tente novamente.');
      }
      const code = `vm-${savedUser.id}-${Date.now()}`;
      const transaction = this.txRepo.create({
        userId: savedUser.id,
        plan: dto.planType,
        value: price,
        status: 'pendente',
        paymentMethod: 'Cartão de Crédito',
        commissionMmn: 0,
        gatewayProvider: 'pagarme',
        gatewayIdentifier: code,
      });
      await this.txRepo.save(transaction);

      const result = await this.pagarmeService.createCardSubscription({
        code,
        customer: {
          name: dto.name,
          email: dto.email,
          document: onlyDigits(dto.cpf),
          phone: formatBrazilPhone(dto.phone) || onlyDigits(dto.phone),
          address: {
            line_1: [dto.address, dto.neighborhood].filter(Boolean).join(', '),
            zipCode: dto.zipCode,
            city: dto.city,
            state: dto.state,
          },
        },
        cardToken: dto.cardToken,
        planName: dto.planType,
        amountCents: Math.round(price * 100),
      });
      if (!result.ok || !result.subscriptionId) {
        await this.txRepo.remove(transaction);
        await this.usersRepo.remove(savedUser);
        {
          const errInfo = {
            context: 'Checkout — assinatura no cartão (Pagar.me)',
            detail: result.error || 'Não foi possível processar o cartão.',
            client: dto.name,
            value: price,
          };
          await this.telegramService.notifyError(errInfo);
        }
        throw new BadRequestException(result.error || 'Não foi possível processar o cartão.');
      }
      transaction.gatewaySubscriptionId = result.subscriptionId;
      await this.txRepo.save(transaction);

      // Cartão costuma ser síncrono: checa a 1ª cobrança na hora.
      const st = await this.pagarmeService.getLatestChargeStatus(result.subscriptionId);
      if (st === 'failed') {
        await this.txRepo.remove(transaction);
        await this.usersRepo.remove(savedUser);
        throw new BadRequestException('Pagamento recusado pela operadora do cartão.');
      }
      await this.mailService.sendWelcomePassword(savedUser.email, savedUser.name, initialPassword);
      const paidNow = st === 'paid';
      if (paidNow) {
        transaction.status = 'pago';
        await this.txRepo.save(transaction);
        await this.confirmPaid(transaction, link, savedUser);
      }
      return {
        success: true,
        transactionId: String(transaction.id),
        status: paidNow ? 'paid' : 'pending',
        user: { name: savedUser.name, plan: savedUser.plan, active: paidNow },
      };
    }

    // ---- Fluxo Woovi (Pix Automático / débito automático) ----
    if (config.activeGateway === 'woovi' && dto.paymentMethod !== 'card' && (await this.wooviService.isEnabled())) {
      const phone = formatBrazilPhone(dto.phone);
      if (!phone) {
        await this.usersRepo.remove(savedUser);
        throw new BadRequestException('Telefone inválido. Informe um número com DDD (ex.: 41999887766).');
      }
      const correlationID = `vm-${savedUser.id}-${Date.now()}`;
      const transaction = this.txRepo.create({
        userId: savedUser.id,
        plan: dto.planType,
        value: price,
        status: 'pendente',
        paymentMethod: 'Pix Automático',
        commissionMmn: 0,
        gatewayProvider: 'woovi',
        gatewayIdentifier: correlationID,
      });
      await this.txRepo.save(transaction);

      const result = await this.wooviService.createPixAutomaticSubscription({
        correlationID,
        amountCents: Math.round(price * 100),
        planName: dto.planType,
        client: { name: dto.name, email: dto.email, phone: `+55${phone}`, taxID: onlyDigits(dto.cpf) },
        dayGenerateCharge: new Date().getDate(), // PAYMENT_ON_APPROVAL exige o dia de hoje
      });

      if (!result.ok || !result.emv) {
        await this.txRepo.remove(transaction);
        await this.usersRepo.remove(savedUser);
        {
          const errInfo = {
            context: 'Checkout — Pix Automático (Woovi)',
            detail: result.error || 'Não foi possível gerar o Pix Automático.',
            client: dto.name,
            value: price,
          };
          await this.telegramService.notifyError(errInfo);
        }
        throw new BadRequestException(result.error || 'Não foi possível gerar o Pix Automático.');
      }

      await this.mailService.sendWelcomePassword(savedUser.email, savedUser.name, initialPassword);
      transaction.gatewaySubscriptionId = result.subscriptionId ?? null;
      transaction.pixCode = result.emv; // QR de AUTORIZAÇÃO da recorrência (/rec/)
      await this.txRepo.save(transaction);

      // Fica pendente até o cliente autorizar no banco (webhook PIX_AUTOMATIC_APPROVED /
      // primeira cobrança PIX_AUTOMATIC_COBR_COMPLETED confirma e ativa a conta).
      return {
        success: true,
        transactionId: String(transaction.id),
        status: 'pending',
        pixCode: result.emv,
        pixImage: null,
        user: { name: savedUser.name, plan: savedUser.plan, active: false },
      };
    }

    const gatewayOn = await this.paymentService.isEnabled();

    // ---- Fluxo simulado (gateway desligado): mantém comportamento antigo ----
    if (!gatewayOn) {
      const transaction = this.txRepo.create({
        userId: savedUser.id,
        plan: dto.planType,
        value: price,
        status: 'pago',
        paymentMethod: dto.paymentMethod === 'pix' ? 'PIX' : 'Cartão de Crédito',
        commissionMmn: 0,
      });
      await this.txRepo.save(transaction);
      await this.mailService.sendWelcomePassword(savedUser.email, savedUser.name, initialPassword);
      await this.confirmPaid(transaction, link, savedUser);
      return {
        success: true,
        transactionId: String(transaction.id),
        status: 'paid',
        user: { name: savedUser.name, plan: savedUser.plan, active: true },
      };
    }

    // ---- Fluxo real (gateway Veenca) ----
    const phone = formatBrazilPhone(dto.phone);
    if (!phone) {
      await this.usersRepo.remove(savedUser);
      throw new BadRequestException('Telefone inválido. Informe um número com DDD (ex.: 41999887766).');
    }

    const identifier = `vm-${savedUser.id}-${Date.now()}`;
    const transaction = this.txRepo.create({
      userId: savedUser.id,
      plan: dto.planType,
      value: price,
      status: 'pendente',
      paymentMethod: dto.paymentMethod === 'pix' ? 'PIX' : 'Cartão de Crédito',
      commissionMmn: 0,
      gatewayIdentifier: identifier,
    });
    await this.txRepo.save(transaction);

    const result = await this.paymentService.createSubscription({
      identifier,
      amount: Number(price.toFixed(2)), // reais — a doc pede o valor final da venda em reais, não centavos
      planName: dto.planType,
      planId: dto.planType.toLowerCase(),
      client: { name: dto.name, email: dto.email, phone, document: onlyDigits(dto.cpf) },
      address: {
        zipCode: dto.zipCode,
        street: dto.address,
        neighborhood: dto.neighborhood,
        city: dto.city,
        state: dto.state,
        complement: dto.complement,
      },
      callbackUrl: publicUrl('/api/billing/webhook/veenca'),
      dueDate: dueDateInDays(3),
      clientIp,
      card:
        dto.paymentMethod === 'card'
          ? {
              number: onlyDigits(dto.cardNumber),
              owner: dto.cardName ?? '',
              expiresAt: dto.cardExpiry ?? '',
              cvv: dto.cardCvv ?? '',
            }
          : undefined,
    });

    if (!result.ok) {
      // desfaz o usuário órfão pra permitir nova tentativa com o mesmo e-mail/CPF
      await this.txRepo.remove(transaction);
      await this.usersRepo.remove(savedUser);
      throw new BadRequestException(result.error || 'Não foi possível processar o pagamento.');
    }

    // Conta confirmada (não será removida) — envia o e-mail de boas-vindas com a senha.
    await this.mailService.sendWelcomePassword(savedUser.email, savedUser.name, initialPassword);

    transaction.gatewayTransactionId = result.transactionId ?? null;
    transaction.gatewaySubscriptionId = result.subscriptionId ?? null;
    transaction.pixCode = result.pixCode ?? null;

    // O `status` da resposta de criação é o status da requisição ("OK"), não do pagamento.
    // Cartão pode já sair aprovado, então o pagamento é confirmado na própria Veenca;
    // PIX fica pendente até o webhook (que também revalida na origem).
    const confirmed = result.transactionId
      ? await this.paymentService.getTransaction(result.transactionId)
      : null;
    const paidNow = confirmed?.status === 'COMPLETED';
    if (paidNow) {
      transaction.status = 'pago';
      await this.txRepo.save(transaction);
      await this.confirmPaid(transaction, link, savedUser);
    } else {
      await this.txRepo.save(transaction);
    }

    return {
      success: true,
      transactionId: String(transaction.id),
      status: paidNow ? 'paid' : 'pending',
      pixCode: result.pixCode ?? null,
      pixImage: result.pixImage ?? null,
      user: { name: savedUser.name, plan: savedUser.plan, active: paidNow },
    };
  }

  /**
   * Pagamento avulso da assinatura do usuário logado (botões PIX/Cartão no painel).
   * É uma renovação: cobra o valor mensal atual do usuário (base do plano + módulos),
   * mas NÃO credita comissão de indicação nem re-cadastra na Vencca — o identificador
   * `vm-renew-` sinaliza isso também no webhook.
   */
  async payCurrentSubscription(userId: number, dto: PayDto, clientIp?: string) {
    if (!(await this.paymentService.isEnabled())) {
      // Woovi pode estar ativo mesmo com a Veenca desligada — checado abaixo.
      const cfgEarly = await this.configRepo.findOne({ where: {} });
      if (!(cfgEarly?.activeGateway === 'woovi' && (await this.wooviService.isEnabled()))) {
        throw new BadRequestException('Pagamento online ainda não está disponível. Tente novamente mais tarde.');
      }
    }

    await this.ensurePaidAccessForUser(userId);
    const user = await this.usersService.findById(userId);
    const config = await this.configRepo.findOne({ where: {} });
    if (!config) throw new NotFoundException('Configuração do sistema não encontrada.');

    // ---- Fluxo Cartão de Crédito (Pagar.me) ----
    if (dto.paymentMethod === 'card' && (await this.pagarmeService.isEnabled())) {
      if (!dto.cardToken) throw new BadRequestException('Não foi possível ler os dados do cartão. Tente novamente.');
      const price = basePriceForPlan(user.plan, config);
      const isActivation = user.status !== 'ativo';
      const code = `vm-${isActivation ? 'activate' : 'renew'}-${userId}-${Date.now()}`;
      const transaction = this.txRepo.create({
        userId,
        plan: user.plan,
        value: price,
        status: 'pendente',
        paymentMethod: 'Cartão de Crédito',
        commissionMmn: 0,
        gatewayProvider: 'pagarme',
        gatewayIdentifier: code,
      });
      await this.txRepo.save(transaction);
      const result = await this.pagarmeService.createCardSubscription({
        code,
        customer: {
          name: user.name,
          email: user.email,
          document: onlyDigits(user.cpf),
          phone: formatBrazilPhone(user.phone) || onlyDigits(user.phone),
          address: {
            line_1: [user.address, user.neighborhood].filter(Boolean).join(', '),
            zipCode: user.zipCode,
            city: user.city,
            state: user.state,
          },
        },
        cardToken: dto.cardToken,
        planName: user.plan,
        amountCents: Math.round(price * 100),
      });
      if (!result.ok || !result.subscriptionId) {
        await this.txRepo.remove(transaction);
        throw new BadRequestException(result.error || 'Não foi possível processar o cartão.');
      }
      transaction.gatewaySubscriptionId = result.subscriptionId;
      await this.txRepo.save(transaction);
      const st = await this.pagarmeService.getLatestChargeStatus(result.subscriptionId);
      if (st === 'failed') {
        await this.txRepo.remove(transaction);
        throw new BadRequestException('Pagamento recusado pela operadora do cartão.');
      }
      const paidNow = st === 'paid';
      if (paidNow) {
        transaction.status = 'pago';
        await this.txRepo.save(transaction);
        if (isActivation) {
          const link = user.referredById
            ? await this.referralsService.findLinkByOwnerAndPlan(user.referredById, user.plan)
            : null;
          await this.confirmPaid(transaction, link, user);
        } else {
          await this.mailService.sendPaymentConfirmed(user.email, user.name, user.plan, formatCurrency(price));
        }
      }
      return {
        success: true,
        transactionId: String(transaction.id),
        status: (paidNow ? 'paid' : 'pending') as 'paid' | 'pending',
        value: formatCurrency(price),
        pixCode: null,
        pixImage: null,
      };
    }

    // ---- Fluxo Woovi (Pix Automático) ----
    if (config.activeGateway === 'woovi' && dto.paymentMethod !== 'card' && (await this.wooviService.isEnabled())) {
      const wphone = formatBrazilPhone(user.phone);
      if (!wphone) {
        throw new BadRequestException('Telefone inválido. Atualize seu telefone (com DDD) em Minha Conta antes de continuar.');
      }
      const wprice = basePriceForPlan(user.plan, config);

      // Reuso: assinatura Pix Automático pendente recente devolve o mesmo QR de autorização.
      const wfresh = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const wexisting = await this.txRepo.findOne({
        where: { userId, status: 'pendente', gatewayProvider: 'woovi', pixCode: Not(IsNull()), createdAt: MoreThan(wfresh) },
        order: { createdAt: 'DESC' },
      });
      if (wexisting?.pixCode) {
        return {
          success: true,
          transactionId: String(wexisting.id),
          status: 'pending' as const,
          value: formatCurrency(wprice),
          pixCode: wexisting.pixCode,
          pixImage: null,
        };
      }

      const wcorrelationID = `vm-${user.status !== 'ativo' ? 'activate' : 'renew'}-${userId}-${Date.now()}`;
      const wtx = this.txRepo.create({
        userId,
        plan: user.plan,
        value: wprice,
        status: 'pendente',
        paymentMethod: 'Pix Automático',
        commissionMmn: 0,
        gatewayProvider: 'woovi',
        gatewayIdentifier: wcorrelationID,
      });
      await this.txRepo.save(wtx);

      const wresult = await this.wooviService.createPixAutomaticSubscription({
        correlationID: wcorrelationID,
        amountCents: Math.round(wprice * 100),
        planName: user.plan,
        client: { name: user.name, email: user.email, phone: `+55${wphone}`, taxID: onlyDigits(user.cpf) },
        dayGenerateCharge: new Date().getDate(), // PAYMENT_ON_APPROVAL exige o dia de hoje
      });
      if (!wresult.ok || !wresult.emv) {
        await this.txRepo.remove(wtx);
        throw new BadRequestException(wresult.error || 'Não foi possível gerar o Pix Automático.');
      }
      wtx.gatewaySubscriptionId = wresult.subscriptionId ?? null;
      wtx.pixCode = wresult.emv;
      await this.txRepo.save(wtx);
      return {
        success: true,
        transactionId: String(wtx.id),
        status: 'pending' as const,
        value: formatCurrency(wprice),
        pixCode: wresult.emv,
        pixImage: null,
      };
    }

    const phone = formatBrazilPhone(user.phone);
    if (!phone) {
      throw new BadRequestException('Telefone inválido. Atualize seu telefone (com DDD) em Minha Conta antes de pagar.');
    }

    const price = basePriceForPlan(user.plan, config); // cobra o valor da tabela do plano (79,90 / 129,90)

    // Reuso: gerar vários QRs no mesmo ciclo NÃO cria novas subscrições na Veenca —
    // devolve o PIX pendente ainda válido (criado nos últimos 3 dias). O front regenera o QR do código.
    if (dto.paymentMethod === 'pix') {
      const fresh = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const existing = await this.txRepo.findOne({
        where: { userId, status: 'pendente', paymentMethod: 'PIX', pixCode: Not(IsNull()), createdAt: MoreThan(fresh) },
        order: { createdAt: 'DESC' },
      });
      if (existing?.pixCode) {
        return {
          success: true,
          transactionId: String(existing.id),
          status: 'pending' as const,
          value: formatCurrency(price),
          pixCode: existing.pixCode,
          pixImage: null,
        };
      }
    }

    // Ativação (primeiro pagamento de quem ainda não é ativo) roda confirmPaid
    // (ativa conta + credita comissão do indicador). Renovação (já ativo) não.
    const isActivation = user.status !== 'ativo';
    const identifier = `vm-${isActivation ? 'activate' : 'renew'}-${userId}-${Date.now()}`;
    const transaction = this.txRepo.create({
      userId,
      plan: user.plan,
      value: price,
      status: 'pendente',
      paymentMethod: dto.paymentMethod === 'pix' ? 'PIX' : 'Cartão de Crédito',
      commissionMmn: 0,
      gatewayIdentifier: identifier,
    });
    await this.txRepo.save(transaction);

    const result = await this.paymentService.createSubscription({
      identifier,
      amount: Number(price.toFixed(2)),
      planName: user.plan,
      planId: user.plan.toLowerCase(),
      client: {
        name: user.name,
        email: user.email,
        phone,
        document: onlyDigits(user.cpf),
      },
      address: {
        zipCode: user.zipCode,
        street: user.address,
        neighborhood: user.neighborhood,
        city: user.city,
        state: user.state,
        complement: user.complement,
      },
      callbackUrl: publicUrl('/api/billing/webhook/veenca'),
      dueDate: dueDateInDays(3),
      clientIp,
      card:
        dto.paymentMethod === 'card'
          ? {
              number: onlyDigits(dto.cardNumber),
              owner: dto.cardName ?? '',
              expiresAt: dto.cardExpiry ?? '',
              cvv: dto.cardCvv ?? '',
            }
          : undefined,
    });

    if (!result.ok) {
      await this.txRepo.remove(transaction);
      throw new BadRequestException(result.error || 'Não foi possível processar o pagamento.');
    }

    transaction.gatewayTransactionId = result.transactionId ?? null;
    transaction.gatewaySubscriptionId = result.subscriptionId ?? null;
    transaction.pixCode = result.pixCode ?? null;

    const confirmed = result.transactionId
      ? await this.paymentService.getTransaction(result.transactionId)
      : null;
    const paidNow = confirmed?.status === 'COMPLETED';
    if (paidNow) transaction.status = 'pago';
    await this.txRepo.save(transaction);

    // Cartão aprovado na hora numa ATIVAÇÃO: ativa a conta + credita comissão agora.
    // (PIX/pendente é confirmado depois pelo webhook/cron via applyConfirmedStatus.)
    if (paidNow && isActivation) {
      const link = user.referredById
        ? await this.referralsService.findLinkByOwnerAndPlan(user.referredById, user.plan)
        : null;
      await this.confirmPaid(transaction, link, user);
    } else if (paidNow) {
      // Renovação aprovada na hora: sem comissão, mas confirma o pagamento por e-mail.
      await this.mailService.sendPaymentConfirmed(user.email, user.name, user.plan, formatCurrency(price));
    }

    return {
      success: true,
      transactionId: String(transaction.id),
      status: paidNow ? 'paid' : 'pending',
      value: formatCurrency(price),
      pixCode: result.pixCode ?? null,
      pixImage: result.pixImage ?? null,
    };
  }

  /** Efeitos de pagamento confirmado: comissão do indicador + cadastro do associado na Vencca. */
  private async confirmPaid(transaction: Transaction, link: ReferralLink | null, user: User) {
    // Pagamento confirmado ativa a conta + libera os 3 benefícios inclusos no plano
    // (telemedicina, clube de descontos, veterinário) — sem depender do admin.
    // `firstActivation` separa a ativação inicial das renovações: boas-vindas e
    // avisos de liberação de benefício só fazem sentido na primeira vez.
    const firstActivation = user.status !== 'ativo' && !user.trialEndsAt;
    if (user.status !== 'ativo' || !user.accessHealth || !user.accessClube || !user.accessPet) {
      user.status = 'ativo';
      user.accessHealth = true;
      user.accessClube = true;
      user.accessPet = true;
      await this.usersRepo.save(user);
    }
    if (link) {
      const shouldCreditReferral = Number(transaction.referralBonus ?? 0) <= 0 && !user.referralBonusPaid;
      const { bonus, commission } = shouldCreditReferral
        ? await this.referralsService.registerConversion(link.id)
        : { bonus: Number(transaction.referralBonus ?? 0), commission: 0 };
      if (shouldCreditReferral && bonus > 0) {
        transaction.referralBonus = bonus;
        await this.txRepo.save(transaction);
        // Marca no indicado (não no indicador) que essa indicação rendeu o bônus --
        // é o que aparece como selo "indicação nova" no relatório do indicador.
        user.referralBonusPaid = true;
        await this.usersRepo.save(user);
      }
      // Avisa o INDICADOR (dono do link) que a indicação dele virou comissão.
      // Valor = a comissão configurada no Admin + bônus da indicação nova.
      // Best-effort: o pagamento do indicado não pode falhar aqui.
      try {
        const referrer = await this.usersRepo.findOne({ where: { id: link.userId } });
        if (shouldCreditReferral && referrer?.email) {
          const credited = commission + bonus;
          await this.mailService.sendCommissionProcessed(
            referrer.email,
            user.name,
            formatCurrency(Math.round(credited * 100) / 100),
          );
        }
      } catch (err) {
        this.logger.warn(`Falha ao avisar indicador da comissão (link ${link.id}): ${(err as Error).message}`);
      }
    }
    // Boas-vindas: só na ativação da conta (1º pagamento), não nas renovações.
    if (firstActivation) {
      try {
        await this.mailService.sendWelcome(user.email);
      } catch (err) {
        this.logger.warn(`Falha ao enviar boas-vindas (user ${user.id}): ${(err as Error).message}`);
      }
    }
    // Telemedicina (Vencca) — cadastro antigo, mantido. Marca sucesso pra não re-tentar no cron.
    const wasTelemedRegistered = user.telemedRegistered;
    const venccaOk = await this.venccaService.registerAssociates([this.venccaService.mapUserToCliente(user)]);
    if (venccaOk) {
      user.telemedRegistered = true;
      await this.usersRepo.save(user);
      // Avisa que telemedicina + pet estão liberadas — só na primeira liberação,
      // senão o cliente receberia o mesmo aviso a cada renovação. Best-effort.
      if (!wasTelemedRegistered) {
        try {
          await this.mailService.sendTelemedAccessReleased(user.email);
        } catch (err) {
          this.logger.warn(`Falha ao avisar liberação da telemedicina (user ${user.id}): ${(err as Error).message}`);
        }
      }
    }
    // Clube de Descontos (Clube Certo) — cadastro adicional (no-op se desligado).
    await this.clubeCertoService.registerAssociate(user);
    if (firstActivation) {
      try {
        await this.mailService.sendClubeAccessReleased(user.email);
      } catch (err) {
        this.logger.warn(`Falha ao avisar liberação do clube (user ${user.id}): ${(err as Error).message}`);
      }
    }
    // E-mail de confirmação de pagamento.
    await this.mailService.sendPaymentConfirmed(
      user.email,
      user.name,
      user.plan,
      formatCurrency(Number(transaction.value)),
    );
    // Notifica a venda confirmada (Telegram + WhatsApp/Z-API; no-op se não configurados).
    const saleInfo = {
      transactionId: transaction.id,
      client: user.name,
      plan: transaction.plan,
      value: Number(transaction.value),
      method: transaction.paymentMethod,
      gateway: transaction.gatewayProvider ?? undefined,
    };
    await this.telegramService.notifySale(saleInfo);
    await this.notificationsService.notifySale({
      transactionId: transaction.id,
      client: user.name,
      plan: transaction.plan,
      value: Number(transaction.value),
      method: transaction.paymentMethod,
      gateway: transaction.gatewayProvider ?? undefined,
    });
    // Telemedicina falhou no cadastro? Avisa o grupo de erros (venda ok, mas benefício pendente).
    if (!venccaOk) {
      {
        const errInfo = {
          context: 'Cadastro na telemedicina (Vencca) após pagamento',
          detail: 'Associado não registrado na telemedicina — o cron vai re-tentar. Verifique dados (ex.: CPF).',
          client: user.name,
          value: Number(transaction.value),
        };
        await this.telegramService.notifyError(errInfo);
      }
    }
  }

  private async ensurePaidAccessForUser(userId: number): Promise<boolean> {
    const paid = await this.txRepo.findOne({
      where: { userId, status: 'pago' },
      order: { createdAt: 'DESC' },
    });
    if (!paid) return false;
    return this.ensurePaidAccess(paid);
  }

  private async ensurePaidAccess(tx: Transaction): Promise<boolean> {
    if (tx.status !== 'pago') return false;
    const user = await this.usersService.findById(tx.userId);
    const missingAccess = user.status !== 'ativo' || !user.accessHealth || !user.accessClube || !user.accessPet;

    if (missingAccess) {
      user.status = 'ativo';
      user.accessHealth = true;
      user.accessClube = true;
      user.accessPet = true;
      await this.usersRepo.save(user);
    }

    await this.txRepo
      .createQueryBuilder()
      .update(Transaction)
      .set({ status: 'duplicado' })
      .where('userId = :userId', { userId: user.id })
      .andWhere('id <> :paidId', { paidId: tx.id })
      .andWhere('status = :pending', { pending: 'pendente' })
      .andWhere('gatewayIdentifier LIKE :activation', { activation: 'vm-activate-%' })
      .execute();

    if (missingAccess) {
      if (!user.telemedRegistered) {
        const venccaOk = await this.venccaService.registerAssociates([this.venccaService.mapUserToCliente(user)]);
        if (venccaOk) {
          user.telemedRegistered = true;
          await this.usersRepo.save(user);
        }
      }
      await this.clubeCertoService.registerAssociate(user);
      this.logger.warn(`Acesso reconciliado para usuário ${user.id} a partir da tx paga ${tx.id}.`);
    }

    return missingAccess;
  }

  /**
   * Processa webhook da Veenca.
   *
   * A rota é pública, então NADA do corpo é usado para decidir estado: dele sai apenas
   * o id da transação, que serve de ponteiro. O status vem sempre de uma consulta
   * autenticada à Veenca — sem isso qualquer um poderia forjar um "pago" e liberar
   * plano e comissão de indicação sem pagamento nenhum.
   */
  async handleVeencaWebhook(body: any) {
    const gatewayTxId: string | undefined = body?.transaction?.id;
    if (!gatewayTxId) return;

    const confirmed = await this.paymentService.getTransaction(gatewayTxId);
    if (!confirmed) return; // não existe na Veenca (ou consulta falhou) — ignora

    // 1) Cobrança que já conhecemos (a 1ª do PIX, ou uma renovação já gravada).
    //    Também casa pelo clientIdentifier caso o webhook chegue antes de gravarmos
    //    o gatewayTransactionId. Tudo confirmado via consulta autenticada.
    const tx =
      (await this.txRepo.findOne({ where: { gatewayTransactionId: confirmed.id } })) ??
      (confirmed.clientIdentifier
        ? await this.txRepo.findOne({ where: { gatewayIdentifier: confirmed.clientIdentifier } })
        : null);

    if (tx) {
      if (!tx.gatewayTransactionId) {
        tx.gatewayTransactionId = confirmed.id;
        await this.txRepo.save(tx);
      }
      await this.applyConfirmedStatus(tx, confirmed.status);
      return;
    }

    // 2) Cobrança nova (transactionId inédito) de uma ASSINATURA que já conhecemos:
    //    é a renovação mensal que a Veenca gera sozinha no PIX recorrente. Cada uma
    //    vira uma fatura paga própria, sem re-creditar comissão (é renovação).
    if (confirmed.subscriptionId && confirmed.status === 'COMPLETED') {
      await this.recordRecurringCharge(confirmed);
    }
  }

  /**
   * Registra uma cobrança recorrente da Veenca (renovação mensal do PIX automático)
   * como um lançamento pago novo, herdando plano/valor do lançamento original da
   * assinatura. Idempotente: o chamador só entra aqui quando não existe lançamento
   * com esse gatewayTransactionId.
   */
  private async recordRecurringCharge(confirmed: {
    id: string;
    subscriptionId?: string;
    amount?: number;
  }) {
    const origin = await this.txRepo.findOne({
      where: { gatewaySubscriptionId: confirmed.subscriptionId },
      order: { createdAt: 'ASC' },
    });
    if (!origin) return; // assinatura desconhecida — ignora (não forja pagamento)

    const renewal = await this.txRepo.save(
      this.txRepo.create({
        userId: origin.userId,
        plan: origin.plan,
        value: origin.value,
        status: 'pago',
        commissionMmn: 0, // renovação não gera comissão de indicação
        gatewayIdentifier: `vm-renew-${origin.userId}-${confirmed.id}`,
        gatewayTransactionId: confirmed.id,
        gatewaySubscriptionId: confirmed.subscriptionId,
      }),
    );

    const user = await this.usersService.findById(origin.userId);
    await this.mailService.sendPaymentConfirmed(
      user.email,
      user.name,
      user.plan,
      formatCurrency(Number(renewal.value)),
    );
    await this.notificationsService.notifySale({
      transactionId: renewal.id,
      client: user.name,
      plan: renewal.plan,
      value: Number(renewal.value),
      method: renewal.paymentMethod,
      gateway: renewal.gatewayProvider ?? undefined,
    });
    this.logger.log(
      `Renovação recorrente registrada: assinatura ${confirmed.subscriptionId}, user ${origin.userId}, tx ${confirmed.id}.`,
    );
  }

  /**
   * Webhook da Woovi (Pix Automático). Rota pública — o corpo é usado só como ponteiro
   * (correlationID / globalID da assinatura); a decisão de ativar vem de casar com o
   * nosso lançamento. Eventos relevantes:
   *  - PIX_AUTOMATIC_COBR_COMPLETED: uma cobrança foi paga → ativa (1ª) ou registra renovação.
   *  - PIX_AUTOMATIC_REJECTED / *_EXPIRED / *_CANCELED: autorização não vingou → cancela pendente.
   */
  async handleWooviWebhook(body: any) {
    const event: string | undefined = body?.event;
    if (!event) return;

    const sub = body?.subscription ?? body?.charge?.subscription ?? body?.pixRecurring?.subscription ?? null;
    const correlationID: string | undefined =
      sub?.correlationID ?? body?.charge?.correlationID ?? body?.correlationID ?? body?.pixQrCode?.correlationID;
    const subGlobalID: string | undefined = sub?.globalID ?? body?.subscriptionGlobalID;
    const charge = body?.charge ?? body?.cobr ?? body?.pixAutomaticCobr ?? null;
    const chargeId: string | undefined =
      charge?.globalID ?? charge?.transactionID ?? charge?.identifier ?? charge?.correlationID;

    // Casa com o lançamento de origem (assinatura) pelo correlationID ou globalID.
    let origin: Transaction | null = null;
    if (correlationID) {
      origin = await this.txRepo.findOne({ where: { gatewayIdentifier: correlationID, gatewayProvider: 'woovi' } });
    }
    if (!origin && subGlobalID) {
      origin = await this.txRepo.findOne({
        where: { gatewaySubscriptionId: subGlobalID, gatewayProvider: 'woovi' },
        order: { createdAt: 'ASC' },
      });
    }
    if (!origin) return; // assinatura desconhecida — ignora

    const isRenewalSub = (origin.gatewayIdentifier || '').includes('-renew-');

    if (event === 'PIX_AUTOMATIC_COBR_COMPLETED') {
      const eventKey = chargeId ? `${event}:${chargeId}` : `${event}:${origin.id}`;
      if (!this.onceWebhook(eventKey)) return;

      // Idempotência: se já registramos essa cobrança, sai.
      if (chargeId) {
        const dup = await this.txRepo.findOne({ where: { gatewayTransactionId: String(chargeId) } });
        if (dup) return;
      } else if (origin.status !== 'pendente') {
        this.logger.warn(
          `Woovi: webhook ${event} sem id de cobranÃ§a ignorado para assinatura jÃ¡ processada (user ${origin.userId}).`,
        );
        return;
      }

      if (origin.status === 'pendente') {
        // 1ª cobrança da assinatura quita o lançamento de origem.
        const patch: Partial<Transaction> = { status: 'pago' };
        if (chargeId) patch.gatewayTransactionId = String(chargeId);
        const updated = await this.txRepo.update({ id: origin.id, status: 'pendente' }, patch);
        if (!updated.affected) return;
        origin.status = 'pago';
        if (chargeId) origin.gatewayTransactionId = String(chargeId);
        const user = await this.usersService.findById(origin.userId);
        if (isRenewalSub) {
          await this.mailService.sendPaymentConfirmed(user.email, user.name, user.plan, formatCurrency(Number(origin.value)));
          await this.notificationsService.notifySale({
            transactionId: origin.id,
            client: user.name,
            plan: origin.plan,
            value: Number(origin.value),
            method: origin.paymentMethod,
            gateway: origin.gatewayProvider ?? undefined,
          });
        } else {
          const link = user.referredById
            ? await this.referralsService.findLinkByOwnerAndPlan(user.referredById, user.plan)
            : null;
          await this.confirmPaid(origin, link, user); // ativa conta + comissão + telemed
        }
        this.logger.log(`Woovi: 1ª cobrança paga (assinatura user ${origin.userId}), conta ${isRenewalSub ? 'renovada' : 'ativada'}.`);
      } else {
        // Cobrança mensal seguinte → nova fatura paga (renovação, sem comissão).
        const renewal = await this.txRepo.save(
          this.txRepo.create({
            userId: origin.userId,
            plan: origin.plan,
            value: origin.value,
            status: 'pago',
            paymentMethod: 'Pix Automático',
            commissionMmn: 0,
            gatewayProvider: 'woovi',
            gatewayIdentifier: `vm-renew-${origin.userId}-${chargeId ?? Date.now()}`,
            gatewayTransactionId: chargeId ? String(chargeId) : null,
            gatewaySubscriptionId: origin.gatewaySubscriptionId,
          }),
        );
        const user = await this.usersService.findById(origin.userId);
        await this.mailService.sendPaymentConfirmed(user.email, user.name, user.plan, formatCurrency(Number(renewal.value)));
        await this.notificationsService.notifySale({
          transactionId: renewal.id,
          client: user.name,
          plan: renewal.plan,
          value: Number(renewal.value),
          method: renewal.paymentMethod,
          gateway: renewal.gatewayProvider ?? undefined,
        });
        this.logger.log(`Woovi: renovação recorrente paga (user ${origin.userId}, cobr ${chargeId}).`);
      }
    } else if (['PIX_AUTOMATIC_REJECTED', 'PIX_AUTOMATIC_COBR_REJECTED'].includes(event)) {
      if (origin.status === 'pendente') {
        origin.status = 'cancelado';
        await this.txRepo.save(origin);
        const user = await this.usersService.findById(origin.userId);
        await this.notificationsService.notifyRefundOrCancel({
          transactionId: origin.id,
          client: user.name,
          plan: origin.plan,
          value: Number(origin.value),
          method: origin.paymentMethod,
          gateway: origin.gatewayProvider ?? undefined,
          reason: event,
        });
        this.logger.warn(`Woovi: autorização/cobrança rejeitada (user ${origin.userId}, event ${event}).`);
      }
    } else if (event === 'PIX_AUTOMATIC_APPROVED') {
      const approvedKey = subGlobalID ? `${event}:${subGlobalID}` : `${event}:${origin.id}`;
      if (!this.onceWebhook(approvedKey)) return;

      // A autorização do débito automático foi aprovada no banco. Não ativa a conta
      // sozinha (esperamos o dinheiro entrar via COBR_COMPLETED), mas é o momento em
      // que a renovação automática passa a valer — avisa o cliente. Best-effort.
      try {
        const user = await this.usersService.findById(origin.userId);
        await this.mailService.sendAutoRenewalActive(user.email);
        this.logger.log(`Woovi: renovação automática aprovada (user ${origin.userId}).`);
      } catch (err) {
        this.logger.warn(`Falha ao avisar renovação automática: ${(err as Error).message}`);
      }
    }
    // Demais eventos são ignorados.
  }

  /**
   * Aplica a um lançamento Pagar.me o status da cobrança ('paid'|'failed'). Idempotente.
   * 1ª cobrança → ativa/comissão (ou e-mail se renovação); recusa → cancela.
   */
  private async applyPagarmeStatus(tx: Transaction, status: 'paid' | 'pending' | 'failed') {
    if (status === 'paid' && tx.status !== 'pago') {
      tx.status = 'pago';
      await this.txRepo.save(tx);
      const user = await this.usersService.findById(tx.userId);
      if (!tx.gatewayIdentifier?.includes('-renew-')) {
        const link = user.referredById
          ? await this.referralsService.findLinkByOwnerAndPlan(user.referredById, user.plan)
          : null;
        await this.confirmPaid(tx, link, user);
      } else {
        await this.mailService.sendPaymentConfirmed(user.email, user.name, user.plan, formatCurrency(Number(tx.value)));
        await this.notificationsService.notifySale({
          transactionId: tx.id,
          client: user.name,
          plan: tx.plan,
          value: Number(tx.value),
          method: tx.paymentMethod,
          gateway: tx.gatewayProvider ?? undefined,
        });
      }
    } else if (status === 'failed' && tx.status !== 'pago' && tx.status !== 'cancelado') {
      tx.status = 'cancelado';
      await this.txRepo.save(tx);
      const user = await this.usersService.findById(tx.userId);
      await this.notificationsService.notifyRefundOrCancel({
        transactionId: tx.id,
        client: user.name,
        plan: tx.plan,
        value: Number(tx.value),
        method: tx.paymentMethod,
        gateway: tx.gatewayProvider ?? undefined,
        reason: status,
      });
    } else if (status === 'failed' && tx.status === 'pago') {
      const user = await this.usersService.findById(tx.userId);
      await this.notificationsService.notifyRefundOrCancel({
        transactionId: tx.id,
        client: user.name,
        plan: tx.plan,
        value: Number(tx.value),
        method: tx.paymentMethod,
        gateway: tx.gatewayProvider ?? undefined,
        reason: status,
      });
    }
  }

  /**
   * Webhook da Pagar.me (dashboard → /webhook/pagarme). Corpo é ponteiro; o status é
   * revalidado por consulta autenticada. Cobrança mensal seguinte vira fatura paga nova.
   */
  async handlePagarmeWebhook(body: any) {
    const { subscriptionId } = this.pagarmeService.parseWebhook(body);
    if (!subscriptionId) return;
    const origin = await this.txRepo.findOne({
      where: { gatewaySubscriptionId: subscriptionId, gatewayProvider: 'pagarme' },
      order: { createdAt: 'ASC' },
    });
    if (!origin) return;
    const st = await this.pagarmeService.getLatestChargeStatus(subscriptionId);
    if (!st) return;

    // Assinatura já paga + nova cobrança paga = renovação mensal → nova fatura paga.
    if (st === 'paid' && origin.status === 'pago') {
      const chargeId = body?.data?.id ?? body?.data?.last_transaction?.id;
      if (chargeId) {
        const dup = await this.txRepo.findOne({ where: { gatewayTransactionId: String(chargeId) } });
        if (dup) return;
      }
      const renewal = await this.txRepo.save(
        this.txRepo.create({
          userId: origin.userId,
          plan: origin.plan,
          value: origin.value,
          status: 'pago',
          paymentMethod: 'Cartão de Crédito',
          commissionMmn: 0,
          gatewayProvider: 'pagarme',
          gatewayIdentifier: `vm-renew-${origin.userId}-${chargeId ?? Date.now()}`,
          gatewayTransactionId: chargeId ? String(chargeId) : null,
          gatewaySubscriptionId: subscriptionId,
        }),
      );
      const user = await this.usersService.findById(origin.userId);
      await this.mailService.sendPaymentConfirmed(user.email, user.name, user.plan, formatCurrency(Number(renewal.value)));
      await this.notificationsService.notifySale({
        transactionId: renewal.id,
        client: user.name,
        plan: renewal.plan,
        value: Number(renewal.value),
        method: renewal.paymentMethod,
        gateway: renewal.gatewayProvider ?? undefined,
      });
      this.logger.log(`Pagar.me: renovação recorrente paga (user ${origin.userId}, charge ${chargeId}).`);
      return;
    }

    await this.applyPagarmeStatus(origin, st);
  }

  /**
   * Aplica a um lançamento local o status confirmado na Veenca. Fonte única usada
   * pelo webhook e pelo polling — idempotente (não re-credita se já 'pago').
   */
  private async applyConfirmedStatus(tx: Transaction, veencaStatus: string) {
    if (veencaStatus === 'COMPLETED' && tx.status !== 'pago') {
      tx.status = 'pago';
      await this.txRepo.save(tx);
      // Renovação avulsa (vm-renew-): só quita a cobrança, sem comissão nem re-cadastro.
      if (!tx.gatewayIdentifier?.startsWith('vm-renew-')) {
        const user = await this.usersService.findById(tx.userId);
        const link = user.referredById
          ? await this.referralsService.findLinkByOwnerAndPlan(user.referredById, user.plan)
          : null;
        await this.confirmPaid(tx, link, user);
      } else {
        // Renovação: confirma o pagamento por e-mail (sem comissão).
        const user = await this.usersService.findById(tx.userId);
        await this.mailService.sendPaymentConfirmed(
          user.email,
          user.name,
          user.plan,
          formatCurrency(Number(tx.value)),
        );
      }
    } else if (
      ['FAILED', 'REFUNDED', 'CHARGED_BACK'].includes(veencaStatus) &&
      tx.status !== 'cancelado' &&
      tx.status !== 'pago'
    ) {
      tx.status = 'cancelado';
      await this.txRepo.save(tx);
    }
  }

  /**
   * Status de um lançamento para o polling do front. Se ainda pendente, reconsulta a
   * Veenca (não depende só do webhook) e liquida na hora se já foi pago.
   */
  async getTransactionStatus(txId: number): Promise<{ status: 'paid' | 'pending' | 'cancelled' }> {
    const tx = await this.txRepo.findOne({ where: { id: txId } });
    if (!tx) throw new NotFoundException('Lançamento não encontrado.');

    if (tx.status === 'pendente' && tx.gatewayProvider === 'pagarme' && tx.gatewaySubscriptionId) {
      const st = await this.pagarmeService.getLatestChargeStatus(tx.gatewaySubscriptionId);
      if (st) await this.applyPagarmeStatus(tx, st);
    } else if (tx.status === 'pendente' && tx.gatewayTransactionId) {
      const confirmed = await this.paymentService.getTransaction(tx.gatewayTransactionId);
      if (confirmed) await this.applyConfirmedStatus(tx, confirmed.status);
    }

    const map: Record<string, 'paid' | 'pending' | 'cancelled'> = {
      pago: 'paid',
      cancelado: 'cancelled',
    };
    return { status: map[tx.status] ?? 'pending' };
  }

  /**
   * Polling server-side (a cada minuto): reconcilia com a Veenca os lançamentos ainda
   * pendentes que têm id de gateway. Rede de segurança do webhook — se o webhook não
   * chegar, o pagamento é confirmado aqui (ativa conta + comissão via applyConfirmedStatus).
   *
   * Escopo limitado (últimos 3 dias, no máx. 100 por rodada) para respeitar o rate limit
   * da Veenca (100 req / 2 min) e não varrer PIX antigos já expirados eternamente.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async reconcilePendingSubscriptions() {
    if (this.reconciling) return;
    if (!(await this.paymentService.isEnabled())) return;

    this.reconciling = true;
    try {
      const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const pendings = await this.txRepo.find({
        where: {
          status: 'pendente',
          gatewayTransactionId: Not(IsNull()),
          createdAt: MoreThan(since),
        },
        order: { createdAt: 'DESC' },
        take: 100,
      });
      if (!pendings.length) return;

      let confirmados = 0;
      for (const tx of pendings) {
        try {
          const confirmed = await this.paymentService.getTransaction(tx.gatewayTransactionId!);
          if (!confirmed) continue;
          const antes = tx.status;
          await this.applyConfirmedStatus(tx, confirmed.status);
          if (antes !== tx.status && tx.status === 'pago') confirmados += 1;
        } catch (err) {
          this.logger.warn(`Reconciliação da tx ${tx.id} falhou: ${(err as Error).message}`);
        }
      }
      if (confirmados) this.logger.log(`Polling: ${confirmados} pagamento(s) confirmado(s) de ${pendings.length} pendente(s).`);
    } catch (err) {
      this.logger.error(`Polling de assinaturas falhou: ${(err as Error).message}`);
    } finally {
      this.reconciling = false;
    }
  }

  /**
   * Polling das cobranças de cartão (Pagar.me) ainda pendentes — rede de segurança do
   * webhook (que na v5 é configurado no dashboard). Confirma/cancela pela consulta autenticada.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async reconcilePendingPagarme() {
    if (this.reconcilingPagarme) return;
    if (!(await this.pagarmeService.isEnabled())) return;
    this.reconcilingPagarme = true;
    try {
      const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const pendings = await this.txRepo.find({
        where: {
          status: 'pendente',
          gatewayProvider: 'pagarme',
          gatewaySubscriptionId: Not(IsNull()),
          createdAt: MoreThan(since),
        },
        order: { createdAt: 'DESC' },
        take: 100,
      });
      for (const tx of pendings) {
        try {
          const st = await this.pagarmeService.getLatestChargeStatus(tx.gatewaySubscriptionId!);
          if (st) await this.applyPagarmeStatus(tx, st);
        } catch (err) {
          this.logger.warn(`Reconciliação Pagar.me tx ${tx.id} falhou: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      this.logger.error(`Polling Pagar.me falhou: ${(err as Error).message}`);
    } finally {
      this.reconcilingPagarme = false;
    }
  }

  /**
   * Rede de segurança: se existe lançamento pago, o titular não pode continuar
   * pendente nem sem benefícios. Também limpa pendências de ativação criadas depois
   * de um pagamento já confirmado.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async reconcilePaidAccess() {
    if (this.reconcilingPaidAccess) return;
    this.reconcilingPaidAccess = true;
    try {
      const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const paid = await this.txRepo
        .createQueryBuilder('tx')
        .innerJoin('tx.user', 'user')
        .where('tx.status = :paid', { paid: 'pago' })
        .andWhere('tx.createdAt > :since', { since })
        .andWhere('(user.status <> :active OR user.accessHealth = false OR user.accessClube = false OR user.accessPet = false)', {
          active: 'ativo',
        })
        .orderBy('tx.createdAt', 'DESC')
        .take(100)
        .getMany();

      let fixed = 0;
      for (const tx of paid) {
        try {
          if (await this.ensurePaidAccess(tx)) fixed += 1;
        } catch (err) {
          this.logger.warn(`Reconciliação de acesso da tx ${tx.id} falhou: ${(err as Error).message}`);
        }
      }
      if (fixed) this.logger.log(`Reconciliação de acesso: ${fixed} usuário(s) ativado(s).`);
    } catch (err) {
      this.logger.error(`Reconciliação de acesso pago falhou: ${(err as Error).message}`);
    } finally {
      this.reconcilingPaidAccess = false;
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async expireTrialSignupAccounts() {
    const due = await this.usersRepo.find({
      where: {
        holderId: IsNull(),
        status: 'ativo',
        trialEndsAt: LessThan(new Date()),
      },
      order: { trialEndsAt: 'ASC' },
      take: 100,
    });
    if (!due.length) return;

    let blocked = 0;
    for (const user of due) {
      try {
        const paidAfterTrial = user.trialEndsAt
          ? await this.txRepo.count({ where: { userId: user.id, status: 'pago', createdAt: MoreThan(user.trialEndsAt) } })
          : 0;
        if (paidAfterTrial > 0) continue;
        user.status = 'pendente';
        user.accessHealth = false;
        user.accessClube = false;
        user.accessPet = false;
        await this.usersRepo.save(user);
        blocked += 1;
      } catch (err) {
        this.logger.warn(`Bloqueio do cadastro 30 dias falhou (user ${user.id}): ${(err as Error).message}`);
      }
    }
    if (blocked) this.logger.log(`Cadastro 30 dias: ${blocked} usuário(s) bloqueado(s) após vencimento.`);
  }

  @Cron('0 9 * * *', { timeZone: 'America/Sao_Paulo' })
  async remindTrialSignupPayments() {
    const config = await this.configRepo.findOne({ where: {} });
    if (!config) return;

    for (const days of [7, 3, 1] as const) {
      const target = new Date();
      target.setDate(target.getDate() + days);
      const { start, endInclusive } = brDayWindow(target);
      const field = `trialReminder${days}At` as 'trialReminder7At' | 'trialReminder3At' | 'trialReminder1At';
      const users = await this.usersRepo.find({
        where: {
          holderId: IsNull(),
          status: 'ativo',
          trialEndsAt: Between(start, endInclusive),
          [field]: IsNull(),
        },
        order: { trialEndsAt: 'ASC' },
        take: 200,
      });

      for (const user of users) {
        user[field] = new Date();
        await this.usersRepo.save(user);
        try {
          await this.mailService.sendTrialPaymentReminder(
            user.email,
            user.name,
            user.plan,
            formatCurrency(basePriceForPlan(user.plan, config)),
            formatDate(user.trialEndsAt!),
            days,
          );
        } catch (err) {
          this.logger.warn(`Lembrete de cadastro 30 dias falhou (user ${user.id}, ${days}d): ${(err as Error).message}`);
        }
      }
      if (users.length) this.logger.log(`Cadastro 30 dias: ${users.length} lembrete(s) de ${days} dia(s) processado(s).`);
    }
  }

  /**
   * Lembrete único de pagamento pendente: um lançamento que continua 'pendente'
   * 24h depois de criado rende um e-mail, e só um (pendingReminderAt trava o
   * reenvio). Roda 1x por dia às 10h de São Paulo para não acordar ninguém.
   */
  @Cron('0 10 * * *', { timeZone: 'America/Sao_Paulo' })
  async remindPendingPayments() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 1);

    const pending = await this.txRepo.find({
      where: { status: 'pendente', pendingReminderAt: IsNull(), createdAt: LessThan(cutoff) },
      order: { createdAt: 'ASC' },
      take: 100,
    });
    if (!pending.length) return;

    for (const tx of pending) {
      // Marca antes de enviar: se o e-mail falhar, não insistimos amanhã.
      tx.pendingReminderAt = new Date();
      await this.txRepo.save(tx);
      try {
        const user = await this.usersService.findById(tx.userId);
        // Conta que já virou ativa por outro caminho não precisa de cobrança.
        if (user.status === 'ativo') continue;
        await this.mailService.sendPaymentPending(user.email, tx.plan, formatCurrency(Number(tx.value)));
      } catch (err) {
        this.logger.warn(`Lembrete de pendência falhou (tx ${tx.id}): ${(err as Error).message}`);
      }
    }
    this.logger.log(`Lembretes de pagamento pendente processados: ${pending.length}.`);
  }

  /**
   * Retry de cadastro na telemedicina (Vencca): associados ativos, titulares (sem
   * holderId), que ainda não foram registrados com sucesso (telemedRegistered=false).
   * Cobre falhas pontuais (ex.: endereço com caractere especial, Vencca fora do ar).
   * Cadastra um a um (a API é all-or-nothing por request) e marca o sucesso.
   * Limite por rodada pra respeitar o rate limit da Vencca.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async retryTelemedRegistrations() {
    if (!this.venccaService.isEnabled()) return;
    if (this.retryingTelemed) return;

    this.retryingTelemed = true;
    try {
      // Para de tentar após MAX_TELEMED_ATTEMPTS falhas (dado inválido persistente).
      const pending = await this.usersRepo.find({
        where: {
          status: 'ativo',
          telemedRegistered: false,
          holderId: IsNull(),
          telemedAttempts: LessThan(MAX_TELEMED_ATTEMPTS),
        },
        order: { createdAt: 'ASC' },
        take: 20,
      });
      if (!pending.length) return;

      let ok = 0;
      for (const user of pending) {
        try {
          const registered = await this.venccaService.registerAssociates([
            this.venccaService.mapUserToCliente(user),
          ]);
          if (registered) {
            await this.usersService.markTelemedRegistered(user.id);
            ok += 1;
            // Cadastro só vingou agora — avisa o cliente que o acesso liberou.
            try {
              await this.mailService.sendTelemedAccessReleased(user.email);
            } catch {
              // aviso é best-effort; o cadastro na Vencca é o que importa aqui
            }
          } else {
            await this.usersService.incrementTelemedAttempts(user.id);
          }
        } catch (err) {
          await this.usersService.incrementTelemedAttempts(user.id);
          this.logger.warn(`Retry telemedicina do usuário ${user.id} falhou: ${(err as Error).message}`);
        }
      }
      if (ok) this.logger.log(`Retry telemedicina: ${ok}/${pending.length} associado(s) cadastrado(s).`);
    } catch (err) {
      this.logger.error(`Retry de telemedicina falhou: ${(err as Error).message}`);
    } finally {
      this.retryingTelemed = false;
    }
  }
}
