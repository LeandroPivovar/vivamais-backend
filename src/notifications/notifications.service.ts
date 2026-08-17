import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Not, Repository } from 'typeorm';
import { Transaction } from '../billing/entities/transaction.entity';
import { Ticket } from '../tickets/entities/ticket.entity';

type SalePayload = {
  client?: string | null;
  plan?: string | null;
  value?: number | string | null;
  method?: string | null;
  gateway?: string | null;
  transactionId?: number | null;
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

function spDayWindow(date = new Date()): { start: Date; end: Date } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const getPart = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const start = new Date(Date.UTC(getPart('year'), getPart('month') - 1, getPart('day'), 3, 0, 0, 0));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  end.setUTCMilliseconds(end.getUTCMilliseconds() - 1);
  return { start, end };
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
  ) {}

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
    await this.sendText(
      [
        '*VENDA CONFIRMADA*',
        '',
        `Cliente: ${payload.client ?? '-'}`,
        `Plano: ${payload.plan ?? '-'}`,
        `Valor: ${money(payload.value)}`,
        `Metodo: ${payload.method ?? '-'}`,
        `Gateway: ${payload.gateway ?? '-'}`,
      ].join('\n'),
    );
  }

  async notifyRefundOrCancel(payload: SalePayload & { reason?: string | null }) {
    const key = payload.transactionId ? `refund:${payload.transactionId}:${payload.reason ?? ''}` : `refund:${payload.client}:${payload.value}`;
    if (!this.once(key)) return;
    await this.sendText(
      [
        '*REEMBOLSO/CANCELAMENTO*',
        '',
        `Cliente: ${payload.client ?? '-'}`,
        `Plano: ${payload.plan ?? '-'}`,
        `Valor: ${money(payload.value)}`,
        `Metodo: ${payload.method ?? '-'}`,
        `Gateway: ${payload.gateway ?? '-'}`,
        `Motivo/status: ${payload.reason ?? '-'}`,
      ].join('\n'),
    );
  }

  async notifyTicketOpened(payload: TicketPayload) {
    if (!this.once(`ticket-open:${payload.id}`)) return;
    await this.sendText(
      [
        '*SUPORTE ABERTO*',
        '',
        `Chamado: #${payload.id}`,
        `Usuario: ${payload.user ?? '-'}`,
        `Titulo: ${payload.title ?? '-'}`,
        `Status: ${payload.status ?? '-'}`,
      ].join('\n'),
      this.supportPhones,
    );
  }

  async notifyTicketUpdated(payload: TicketPayload) {
    await this.sendText(
      [
        '*CHAMADO ATUALIZADO*',
        '',
        `Chamado: #${payload.id}`,
        `Usuario: ${payload.user ?? '-'}`,
        `Titulo: ${payload.title ?? '-'}`,
        `Acao: ${payload.action ?? 'Atualizacao'}`,
        `Status: ${payload.status ?? '-'}`,
      ].join('\n'),
      this.supportPhones,
    );
  }

  async notifyError(payload: ErrorPayload) {
    this.dailyErrorCount += 1;
    const key = `error:${payload.method ?? ''}:${payload.path ?? ''}:${payload.detail ?? payload.context}`;
    if (!this.once(key, 10 * 60 * 1000)) return;
    await this.sendText(
      [
        '*ERRO NO SISTEMA*',
        '',
        `Contexto: ${payload.context}`,
        payload.method || payload.path ? `Rota: ${payload.method ?? ''} ${payload.path ?? ''}`.trim() : null,
        `Detalhe: ${payload.detail ?? '-'}`,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  @Cron('55 23 * * *', { timeZone: 'America/Sao_Paulo' })
  async sendDailyReport() {
    const { start, end } = spDayWindow();
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

    await this.sendText(
      [
        '*RELATORIO DIARIO - VIVA MAIS*',
        '',
        `Periodo: ${start.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
        `Vendas pagas: ${paid.length}`,
        `Faturamento: ${money(gross)}`,
        `Pix: ${pix.length} venda(s) / ${money(pix.reduce((sum, tx) => sum + Number(tx.value), 0))}`,
        `Cartao: ${card.length} venda(s) / ${money(card.reduce((sum, tx) => sum + Number(tx.value), 0))}`,
        `Cancelamentos/reembolsos: ${canceled.length}`,
        `Suportes abertos: ${ticketsOpened}`,
        `Chamados atualizados: ${ticketsUpdated}`,
        `Erros 500: ${this.dailyErrorCount}`,
      ].join('\n'),
    );
    this.dailyErrorCount = 0;
  }
}
