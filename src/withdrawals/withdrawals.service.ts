import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, Repository } from 'typeorm';
import { PixKeyType, Withdrawal, WithdrawalStatus } from './entities/withdrawal.entity';
import { CreateWithdrawalDto } from './dto/create-withdrawal.dto';
import { ReferralLink } from '../referrals/entities/referral-link.entity';
import { UsersService } from '../users/users.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TelegramService } from '../telegram/telegram.service';

/** Valor mínimo para solicitar um saque. */
const MIN_WITHDRAWAL = 20;

function money(value: number): string {
  return `R$ ${value.toFixed(2).replace('.', ',')}`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

const PIX_KEY_LABELS: Record<PixKeyType, string> = {
  cpf: 'CPF',
  email: 'E-mail',
  telefone: 'Telefone',
  aleatoria: 'Chave aleatória',
};

/**
 * Valida e normaliza a chave PIX conforme o tipo. CPF/telefone viram só dígitos
 * (é como o banco espera), e-mail vira minúsculo. Erro aqui é do usuário, então
 * a mensagem precisa dizer o que corrigir.
 */
function normalizePixKey(type: PixKeyType, raw: string): string {
  const value = (raw ?? '').trim();

  if (type === 'cpf') {
    const digits = value.replace(/\D/g, '');
    if (digits.length !== 11) throw new BadRequestException('Chave PIX inválida: o CPF deve ter 11 dígitos.');
    return digits;
  }

  if (type === 'telefone') {
    const digits = value.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 11) {
      throw new BadRequestException('Chave PIX inválida: informe o telefone com DDD (10 ou 11 dígitos).');
    }
    return digits;
  }

  if (type === 'email') {
    const email = value.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('Chave PIX inválida: informe um e-mail válido.');
    }
    return email;
  }

  // Aleatória (EVP): UUID de 32 hex, com ou sem hífens.
  const evp = value.toLowerCase();
  if (!/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/.test(evp)) {
    throw new BadRequestException('Chave PIX inválida: a chave aleatória tem 32 caracteres (formato UUID).');
  }
  return evp;
}

@Injectable()
export class WithdrawalsService {
  private readonly logger = new Logger(WithdrawalsService.name);

  constructor(
    @InjectRepository(Withdrawal) private withdrawalsRepo: Repository<Withdrawal>,
    @InjectRepository(ReferralLink) private linksRepo: Repository<ReferralLink>,
    private usersService: UsersService,
    private mailService: MailService,
    private notifications: NotificationsService,
    private telegram: TelegramService,
  ) {}

  private toResponse(w: Withdrawal) {
    return {
      id: w.id,
      amount: Number(w.amount),
      amountLabel: money(Number(w.amount)),
      status: w.status,
      pixKey: w.pixKey,
      pixKeyType: w.pixKeyType,
      pixKeyTypeLabel: w.pixKeyType ? PIX_KEY_LABELS[w.pixKeyType] : null,
      createdAt: w.createdAt,
      paidAt: w.paidAt,
      user: w.user ? { id: w.user.id, name: w.user.name, email: w.user.email, cpf: w.user.cpf } : null,
    };
  }

  /**
   * Saldo do usuário: comissão da rede (5 níveis) + bônus de indicações novas,
   * menos tudo que já foi solicitado (pendente ou pago). Espelha os cards de
   * "Ganhos Totais" e "Bônus" da tela de indicações.
   */
  async summary(userId: number) {
    const [commission, links, withdrawals] = await Promise.all([
      this.usersService.calculateUserCommission(userId),
      this.linksRepo.find({ where: { userId } }),
      this.withdrawalsRepo.find({
        where: { userId, status: In(['pendente', 'pago']) },
        order: { createdAt: 'DESC' },
      }),
    ]);

    const bonus = links.reduce((sum, l) => sum + Number(l.bonusTotal ?? 0), 0);
    const pending = withdrawals.filter((w) => w.status === 'pendente').reduce((s, w) => s + Number(w.amount), 0);
    const paid = withdrawals.filter((w) => w.status === 'pago').reduce((s, w) => s + Number(w.amount), 0);
    const earned = round2(commission + bonus);
    const available = round2(Math.max(0, earned - pending - paid));

    return {
      earned,
      earnedLabel: money(earned),
      pending: round2(pending),
      pendingLabel: money(round2(pending)),
      paid: round2(paid),
      paidLabel: money(round2(paid)),
      available,
      availableLabel: money(available),
      minWithdrawal: MIN_WITHDRAWAL,
      canRequest: available >= MIN_WITHDRAWAL && pending === 0,
      hasPending: pending > 0,
      history: withdrawals.map((w) => this.toResponse(w)),
    };
  }

  /** Solicita o saque do saldo disponível inteiro. Um pedido pendente por vez. */
  async request(userId: number, dto: CreateWithdrawalDto) {
    const summary = await this.summary(userId);

    if (summary.hasPending) {
      throw new BadRequestException('Você já tem um saque pendente. Aguarde a liberação para solicitar outro.');
    }
    if (summary.available < MIN_WITHDRAWAL) {
      throw new BadRequestException(
        `Saldo insuficiente. O valor mínimo para saque é ${money(MIN_WITHDRAWAL)}.`,
      );
    }

    // Valida antes de gravar — chave errada significa dinheiro indo pro lugar errado.
    const pixKey = normalizePixKey(dto.pixKeyType, dto.pixKey);

    const saved = await this.withdrawalsRepo.save(
      this.withdrawalsRepo.create({
        userId,
        amount: summary.available,
        status: 'pendente',
        pixKeyType: dto.pixKeyType,
        pixKey,
      }),
    );

    const user = await this.usersService.findById(userId);

    // Confirmação por e-mail. Best-effort: o pedido vale mesmo se o e-mail falhar.
    try {
      await this.mailService.sendWithdrawalRequested(
        user.email,
        user.name,
        money(Number(saved.amount)),
        {
          id: saved.id,
          requestedAt: saved.createdAt,
          pixKey,
          pixKeyTypeLabel: PIX_KEY_LABELS[dto.pixKeyType],
        },
      );
    } catch (err) {
      this.logger.warn(`Falha ao enviar e-mail de pedido de saque #${saved.id}: ${(err as Error).message}`);
    }

    // Avisa nos dois canais (WhatsApp/Z-API + Telegram). Best-effort: o pedido
    // vale mesmo se as notificações falharem.
    const notifyPayload = {
      id: saved.id,
      client: user.name,
      cpf: user.cpf,
      value: Number(saved.amount),
      pixKey,
      pixKeyTypeLabel: PIX_KEY_LABELS[dto.pixKeyType],
    };
    void this.notifications.notifyWithdrawalRequested(notifyPayload);
    void this.telegram.notifyWithdrawalRequested(notifyPayload);

    this.logger.log(`Saque solicitado: #${saved.id}, user ${userId}, ${money(Number(saved.amount))}.`);
    return { withdrawal: this.toResponse(saved), summary: await this.summary(userId) };
  }

  /** Histórico do próprio usuário. */
  async listMine(userId: number) {
    const rows = await this.withdrawalsRepo.find({ where: { userId }, order: { createdAt: 'DESC' } });
    return rows.map((w) => this.toResponse(w));
  }

  /** Lista paginada para o admin (mais recentes primeiro; pendentes no topo). */
  async listAll(page = 1, limit = 10, status?: string) {
    const take = Math.min(Math.max(Number(limit) || 10, 1), 100);
    const skip = (Math.max(Number(page) || 1, 1) - 1) * take;
    const where: FindOptionsWhere<Withdrawal> =
      status === 'pendente' || status === 'pago' ? { status: status as WithdrawalStatus } : {};

    const [rows, total] = await this.withdrawalsRepo.findAndCount({
      where,
      relations: ['user'],
      order: { status: 'ASC', createdAt: 'DESC' }, // 'pago' > 'pendente' alfabeticamente, então pendente vem primeiro
      skip,
      take,
    });

    const pendingTotal = await this.withdrawalsRepo
      .createQueryBuilder('w')
      .select('COALESCE(SUM(w.amount), 0)', 'sum')
      .where('w.status = :s', { s: 'pendente' })
      .getRawOne<{ sum: string }>();

    return {
      items: rows.map((w) => this.toResponse(w)),
      total,
      page: Math.max(Number(page) || 1, 1),
      limit: take,
      totalPages: Math.max(1, Math.ceil(total / take)),
      pendingTotal: round2(Number(pendingTotal?.sum ?? 0)),
    };
  }

  /** Dá baixa no saque: marca como pago e avisa o usuário por e-mail. */
  async markPaid(id: number) {
    const withdrawal = await this.withdrawalsRepo.findOne({ where: { id }, relations: ['user'] });
    if (!withdrawal) throw new NotFoundException('Saque não encontrado.');
    if (withdrawal.status === 'pago') throw new BadRequestException('Esse saque já foi liberado.');

    withdrawal.status = 'pago';
    withdrawal.paidAt = new Date();
    await this.withdrawalsRepo.save(withdrawal);

    // E-mail de confirmação. Best-effort: a baixa vale mesmo se o e-mail falhar.
    if (withdrawal.user) {
      try {
        await this.mailService.sendWithdrawalPaid(
          withdrawal.user.email,
          withdrawal.user.name,
          money(Number(withdrawal.amount)),
          { id: withdrawal.id, requestedAt: withdrawal.createdAt, paidAt: withdrawal.paidAt },
        );
      } catch (err) {
        this.logger.warn(`Falha ao enviar e-mail de saque #${id}: ${(err as Error).message}`);
      }
    }

    this.logger.log(`Saque #${id} liberado (${money(Number(withdrawal.amount))}).`);
    return this.toResponse(withdrawal);
  }
}
