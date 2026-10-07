import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Not, Repository } from 'typeorm';
import { Transaction } from '../billing/entities/transaction.entity';
import { Ticket } from '../tickets/entities/ticket.entity';
import { brDayWindow, formatBrDate } from '../common/br-date';
import { MassflowService } from '../massflow/massflow.service';

type SalePayload = {
  client?: string | null;
  plan?: string | null;
  value?: number | string | null;
  method?: string | null;
  gateway?: string | null;
  transactionId?: number | null;
  kind?: 'sale' | 'renewal';
  /** Nome de quem indicou. Ausente/null = venda direta, sem indicação. */
  referrer?: string | null;
};

type TicketPayload = {
  id: number;
  title?: string | null;
  user?: string | null;
  status?: string | null;
  action?: string;
};

type ErrorPayload = {
  context: string;
  detail?: string;
  path?: string;
  method?: string;
};

function money(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  return `R$ ${n.toFixed(2).replace('.', ',')}`;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private warnedMissingConfig = false;
  private dailyErrorCount = 0;
  private readonly dedupe = new Map<string, number>();

  constructor(
    @InjectRepository(Transaction) private txRepo: Repository<Transaction>,
    @InjectRepository(Ticket) private ticketRepo: Repository<Ticket>,
    private massflowService: MassflowService,
  ) {}

  /**
   * Espelha no webhook do MassFlow o aviso que foi para o grupo. Best-effort e sem
   * await: o MassFlow lento ou fora do ar não pode segurar a notificação nem a request.
   * Venda e renovação não passam por aqui — o billing manda com os dados do cliente.
   */
  private mirrorToMassflow(evento: string, message: string, dados: Record<string, unknown>) {
    void this.massflowService.notifyEvent(evento, message, dados).catch(() => undefined);
  }

  private get instanceId(): string {
    return process.env.ZAPI_INSTANCE_ID?.trim() ?? '';
  }

  private get token(): string {
    return process.env.ZAPI_TOKEN?.trim() ?? '';
  }

  private get clientToken(): string {
    return process.env.ZAPI_CLIENT_TOKEN?.trim() ?? '';
  }

  private parseGroups(raw: string | undefined): string[] {
    return (raw ?? '')
      .split(',')
      .map((phone) => phone.trim())
      .filter(Boolean)
      .map((phone) => phone.replace('@g.us', '-group'));
  }

  /** Grupo genérico (fallback quando não há grupo específico por tipo). */
  private get fallbackPhones(): string[] {
    return this.parseGroups(
      process.env.ZAPI_NOTIFY_GROUPS ?? process.env.ZAPI_NOTIFY_GROUP ?? process.env.ZAPI_SIGNAL_GROUP,
    );
  }

  /** Vendas, reembolsos, erros e relatório diário. */
  private get techPhones(): string[] {
    const p = this.parseGroups(process.env.ZAPI_GROUP_TECH);
    return p.length ? p : this.fallbackPhones;
  }

  /** Chamados abertos e atualizações de chamado. */
  private get supportPhones(): string[] {
    const p = this.parseGroups(process.env.ZAPI_GROUP_SUPORTE);
    return p.length ? p : this.fallbackPhones;
  }

  private isReady(): boolean {
    const ready = !!(this.instanceId && this.token && this.clientToken);
    if (!ready && !this.warnedMissingConfig) {
      this.warnedMissingConfig = true;
      this.logger.warn('Z-API notifications disabled: missing ZAPI_INSTANCE_ID, ZAPI_TOKEN or ZAPI_CLIENT_TOKEN.');
    }
    return ready;
  }

  private once(key: string, ttlMs = 24 * 60 * 60 * 1000): boolean {
    const now = Date.now();
    for (const [k, expires] of this.dedupe) {
      if (expires <= now) this.dedupe.delete(k);
    }
    if (this.dedupe.has(key)) return false;
    this.dedupe.set(key, now + ttlMs);
    return true;
  }

  private async sendText(message: string, phones: string[] = this.techPhones) {
    if (!this.isReady() || !phones.length) return;

    const url = `https://api.z-api.io/instances/${this.instanceId}/token/${this.token}/send-text`;
    await Promise.all(
      phones.map(async (phone) => {
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Client-Token': this.clientToken,
            },
            body: JSON.stringify({ phone, message }),
          });
          if (!res.ok) {
            const text = await res.text().catch(() => '');
            this.logger.warn(`Z-API send-text failed (${res.status}) to ${phone}: ${text.slice(0, 300)}`);
          }
        } catch (err) {
          this.logger.warn(`Z-API send-text error to ${phone}: ${(err as Error).message}`);
        }
      }),
    );
  }

  async notifySale(payload: SalePayload) {
    const key = payload.transactionId ? `sale:${payload.transactionId}` : `sale:${payload.client}:${payload.value}:${Date.now()}`;
    if (!this.once(key)) return;
    const title = payload.kind === 'renewal' ? 'RENOVAÇÃO CONFIRMADA' : 'VENDA CONFIRMADA';
    await this.sendText(
      [
        `*${title}*`,
        '',
        `Cliente: ${payload.client ?? '-'}`,
        `Plano: ${payload.plan ?? '-'}`,
        `Valor: ${money(payload.value)}`,
        `Metodo: ${payload.method ?? '-'}`,
        `Gateway: ${payload.gateway ?? '-'}`,
        `Indicacao: ${payload.referrer?.trim() ? `sim - ${payload.referrer.trim()}` : 'nao - venda direta'}`,
      ].join('\n'),
    );
  }

  async notifyRefundOrCancel(payload: SalePayload & { reason?: string | null }) {
    const key = payload.transactionId ? `refund:${payload.transactionId}:${payload.reason ?? ''}` : `refund:${payload.client}:${payload.value}`;
    if (!this.once(key)) return;
    const message = [
      '*REEMBOLSO/CANCELAMENTO*',
      '',
      `Cliente: ${payload.client ?? '-'}`,
      `Plano: ${payload.plan ?? '-'}`,
      `Valor: ${money(payload.value)}`,
      `Metodo: ${payload.method ?? '-'}`,
      `Gateway: ${payload.gateway ?? '-'}`,
      `Motivo/status: ${payload.reason ?? '-'}`,
    ].join('\n');
    await this.sendText(message);
    this.mirrorToMassflow('reembolso_cancelamento', message, {
      nome: payload.client ?? null,
      plano: payload.plan ?? null,
      valor: payload.value != null ? Number(payload.value) : null,
      metodoPagamento: payload.method ?? null,
      gateway: payload.gateway ?? null,
      motivo: payload.reason ?? null,
      transacaoId: payload.transactionId ?? null,
    });
  }

  /** Pedido de saque de comissão — vai pro grupo de tecnologia/financeiro. */
  async notifyWithdrawalRequested(payload: {
    id: number;
    client?: string | null;
    cpf?: string | null;
    value: number;
    pixKey?: string | null;
    pixKeyTypeLabel?: string | null;
  }) {
    if (!this.once(`withdrawal:${payload.id}`)) return;
    const message = [
      '*SAQUE SOLICITADO*',
      '',
      `Pedido: #${payload.id}`,
      `Cliente: ${payload.client ?? '-'}`,
      `CPF: ${payload.cpf ?? '-'}`,
      `Valor: ${money(payload.value)}`,
      `Chave PIX (${payload.pixKeyTypeLabel ?? '-'}): ${payload.pixKey ?? '-'}`,
      '',
      'Dar baixa no painel do admin (aba Saques).',
    ].join('\n');
    await this.sendText(message);
    // CPF e chave PIX ficam só no grupo interno — não vão para a automação.
    this.mirrorToMassflow('saque_solicitado', message.replace(/^(CPF|Chave PIX).*$/gm, ''), {
      pedidoId: payload.id,
      nome: payload.client ?? null,
      valor: Number(payload.value),
    });
  }

  async notifyTicketOpened(payload: TicketPayload) {
    if (!this.once(`ticket-open:${payload.id}`)) return;
    const message = [
      '*SUPORTE ABERTO*',
      '',
      `Chamado: #${payload.id}`,
      `Usuario: ${payload.user ?? '-'}`,
      `Titulo: ${payload.title ?? '-'}`,
      `Status: ${payload.status ?? '-'}`,
    ].join('\n');
    await this.sendText(message, this.supportPhones);
    this.mirrorToMassflow('chamado_aberto', message, {
      chamadoId: payload.id,
      nome: payload.user ?? null,
      titulo: payload.title ?? null,
      status: payload.status ?? null,
    });
  }

  async notifyTicketUpdated(payload: TicketPayload) {
    const message = [
      '*CHAMADO ATUALIZADO*',
      '',
      `Chamado: #${payload.id}`,
      `Usuario: ${payload.user ?? '-'}`,
      `Titulo: ${payload.title ?? '-'}`,
      `Acao: ${payload.action ?? 'Atualizacao'}`,
      `Status: ${payload.status ?? '-'}`,
    ].join('\n');
    await this.sendText(message, this.supportPhones);
    this.mirrorToMassflow('chamado_atualizado', message, {
      chamadoId: payload.id,
      nome: payload.user ?? null,
      titulo: payload.title ?? null,
      acao: payload.action ?? 'Atualizacao',
      status: payload.status ?? null,
    });
  }

  async notifyError(payload: ErrorPayload) {
    this.dailyErrorCount += 1;
    const key = `error:${payload.method ?? ''}:${payload.path ?? ''}:${payload.detail ?? payload.context}`;
    if (!this.once(key, 10 * 60 * 1000)) return;
    const message = [
      '*ERRO NO SISTEMA*',
      '',
      `Contexto: ${payload.context}`,
      payload.method || payload.path ? `Rota: ${payload.method ?? ''} ${payload.path ?? ''}`.trim() : null,
      `Detalhe: ${payload.detail ?? '-'}`,
    ]
      .filter(Boolean)
      .join('\n');
    await this.sendText(message);
    this.mirrorToMassflow('erro_sistema', message, {
      contexto: payload.context,
      rota: payload.method || payload.path ? `${payload.method ?? ''} ${payload.path ?? ''}`.trim() : null,
      detalhe: payload.detail ?? null,
    });
  }

  @Cron('55 23 * * *', { timeZone: 'America/Sao_Paulo' })
  async sendDailyReport() {
    const { start, endInclusive: end } = brDayWindow();
    const [transactions, ticketsOpened, ticketsUpdated] = await Promise.all([
      this.txRepo.find({
        where: { status: Not('duplicado'), createdAt: Between(start, end) },
      }),
      this.ticketRepo.count({ where: { createdAt: Between(start, end) } }),
      this.ticketRepo.count({ where: { updatedAt: Between(start, end) } }),
    ]);

    const paid = transactions.filter((tx) => tx.status === 'pago');
    const canceled = transactions.filter((tx) => tx.status === 'cancelado');
    const gross = paid.reduce((sum, tx) => sum + Number(tx.value), 0);
    const pix = paid.filter((tx) => `${tx.paymentMethod} ${tx.gatewayProvider}`.toLowerCase().includes('pix') || tx.gatewayProvider === 'woovi');
    const card = paid.filter((tx) => `${tx.paymentMethod} ${tx.gatewayProvider}`.toLowerCase().includes('cart') || tx.gatewayProvider === 'pagarme');

    const pixTotal = pix.reduce((sum, tx) => sum + Number(tx.value), 0);
    const cardTotal = card.reduce((sum, tx) => sum + Number(tx.value), 0);
    const message = [
      '*RELATORIO DIARIO - VIVA MAIS*',
      '',
      `Periodo: ${formatBrDate(start)}`,
      `Vendas pagas: ${paid.length}`,
      `Faturamento: ${money(gross)}`,
      `Pix: ${pix.length} venda(s) / ${money(pixTotal)}`,
      `Cartao: ${card.length} venda(s) / ${money(cardTotal)}`,
      `Cancelamentos/reembolsos: ${canceled.length}`,
      `Suportes abertos: ${ticketsOpened}`,
      `Chamados atualizados: ${ticketsUpdated}`,
      `Erros 500: ${this.dailyErrorCount}`,
    ].join('\n');
    await this.sendText(message);
    this.mirrorToMassflow('relatorio_diario', message, {
      periodo: formatBrDate(start),
      vendasPagas: paid.length,
      faturamento: Number(gross.toFixed(2)),
      pix: { quantidade: pix.length, valor: Number(pixTotal.toFixed(2)) },
      cartao: { quantidade: card.length, valor: Number(cardTotal.toFixed(2)) },
      cancelamentos: canceled.length,
      suportesAbertos: ticketsOpened,
      chamadosAtualizados: ticketsUpdated,
      erros500: this.dailyErrorCount,
    });
    this.dailyErrorCount = 0;
  }
}
