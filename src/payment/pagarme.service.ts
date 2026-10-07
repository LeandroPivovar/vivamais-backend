import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppConfig } from '../admin/entities/config.entity';

/**
 * Integração com a Pagar.me (v5) — cartão de crédito RECORRENTE (assinatura) em todos
 * os checkouts. O cartão é tokenizado no frontend com a public key (POST /tokens?appId=pk)
 * e só o `card_token` chega ao backend — o número do cartão nunca passa pelo nosso servidor.
 *
 * Auth: Basic base64(secretKey + ':'). Base: https://api.pagar.me/core/v5.
 * Confirmação: por polling (faturas da assinatura) + webhook (dashboard, /webhook/pagarme).
 */

const BASE = 'https://api.pagar.me/core/v5';

export interface PagarmeSubInput {
  code: string; // nosso identificador (casa o webhook/polling)
  customer: {
    name: string;
    email: string;
    document: string;
    phone?: string;
    address?: { line_1?: string | null; zipCode?: string | null; city?: string | null; state?: string | null };
  };
  cardToken: string;
  planName: string;
  amountCents: number;
}

export interface PagarmeInvoice {
  invoiceId: string;
  chargeId: string | null;
  status: 'paid' | 'pending' | 'failed' | null;
  amountCents: number;
  createdAt: Date | null;
  paidAt: Date | null;
}

export interface PagarmeSubResult {
  ok: boolean;
  subscriptionId?: string;
  status?: string;
  error?: string;
}

@Injectable()
export class PagarmeService {
  private readonly logger = new Logger(PagarmeService.name);

  constructor(@InjectRepository(AppConfig) private configRepo: Repository<AppConfig>) {}

  private async getConfig(): Promise<AppConfig | null> {
    return this.configRepo.findOne({ where: {} });
  }

  async isEnabled(): Promise<boolean> {
    const c = await this.getConfig();
    return !!(c && c.pagarmeEnabled && c.pagarmeSecretKey);
  }

  private authHeader(cfg: AppConfig): string {
    return 'Basic ' + Buffer.from(`${cfg.pagarmeSecretKey}:`).toString('base64');
  }

  /** Cria uma assinatura recorrente no cartão (débito mensal automático). */
  async createCardSubscription(input: PagarmeSubInput): Promise<PagarmeSubResult> {
    const cfg = await this.getConfig();
    if (!cfg || !cfg.pagarmeEnabled || !cfg.pagarmeSecretKey) {
      return { ok: false, error: 'pagarme_disabled' };
    }
    // Pagar.me exige ao menos um telefone no cliente.
    const pdigits = (input.customer.phone || '').replace(/\D/g, '').replace(/^55/, '');
    const phones =
      pdigits.length >= 10
        ? { mobile_phone: { country_code: '55', area_code: pdigits.slice(0, 2), number: pdigits.slice(2) } }
        : undefined;

    const a = input.customer.address;
    const address =
      a && (a.line_1 || a.city)
        ? {
            line_1: a.line_1 || 'S/N',
            zip_code: (a.zipCode || '').replace(/\D/g, ''),
            city: a.city || '',
            state: a.state || '',
            country: 'BR',
          }
        : undefined;

    const body = {
      code: input.code,
      customer: {
        name: input.customer.name,
        email: input.customer.email,
        document: (input.customer.document || '').replace(/\D/g, ''),
        document_type: 'CPF',
        type: 'individual',
        ...(phones ? { phones } : {}),
        ...(address ? { address } : {}),
      },
      // Antifraude exige billing_address NO cartão — token sozinho não carrega. Vai junto.
      card: {
        token: input.cardToken,
        ...(address ? { billing_address: address } : {}),
      },
      payment_method: 'credit_card',
      interval: 'month',
      interval_count: 1,
      billing_type: 'prepaid',
      installments: 1,
      items: [
        {
          // Antifraude exige `code` no item.
          code: `plano-${(input.planName || 'assinatura').toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-')}`,
          description: `Viva Mais - ${input.planName}`,
          quantity: 1,
          pricing_scheme: { scheme_type: 'unit', price: input.amountCents },
        },
      ],
    };
    try {
      const res = await fetch(`${BASE}/subscriptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: this.authHeader(cfg) },
        body: JSON.stringify(body),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          data?.message ||
          data?.errors?.[Object.keys(data?.errors || {})[0]]?.[0] ||
          `HTTP ${res.status}`;
        this.logger.error(`Pagar.me criar assinatura falhou: ${msg} — ${JSON.stringify(data).slice(0, 400)}`);
        return { ok: false, error: msg };
      }
      return { ok: true, subscriptionId: data?.id, status: data?.status };
    } catch (err) {
      this.logger.error(`Erro ao chamar Pagar.me: ${(err as Error).message}`);
      return { ok: false, error: (err as Error).message };
    }
  }

  /**
   * Faturas da assinatura (mais recente primeiro). Cada ciclo mensal gera uma fatura
   * com a sua cobrança. Usa /invoices porque o /charges da v5 IGNORA o filtro
   * subscription_id e devolve as últimas cobranças da conta inteira (de outros clientes).
   * null = falha na consulta (não confundir com "sem faturas").
   */
  async listSubscriptionInvoices(subscriptionId: string, size = 10): Promise<PagarmeInvoice[] | null> {
    const cfg = await this.getConfig();
    if (!cfg?.pagarmeSecretKey) return null;
    try {
      const res = await fetch(
        `${BASE}/invoices?subscription_id=${encodeURIComponent(subscriptionId)}&size=${size}`,
        { headers: { Authorization: this.authHeader(cfg) } },
      );
      if (!res.ok) {
        this.logger.warn(`Consulta faturas Pagar.me ${subscriptionId} falhou: HTTP ${res.status}`);
        return null;
      }
      const data: any = await res.json().catch(() => ({}));
      const items: any[] = Array.isArray(data?.data) ? data.data : [];
      return items
        // Defesa: se o filtro for ignorado, não deixa fatura de outra assinatura passar.
        .filter((inv) => !inv?.subscription?.id || inv.subscription.id === subscriptionId)
        .map((inv) => ({
          invoiceId: String(inv?.id ?? ''),
          chargeId: inv?.charge?.id ? String(inv.charge.id) : null,
          status: this.mapStatus(inv?.charge?.status ?? inv?.status),
          amountCents: Number(inv?.amount ?? inv?.charge?.amount ?? 0),
          createdAt: inv?.created_at ? new Date(inv.created_at) : null,
          paidAt: inv?.charge?.paid_at ? new Date(inv.charge.paid_at) : null,
        }))
        .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
    } catch (err) {
      this.logger.warn(`Consulta faturas Pagar.me ${subscriptionId} falhou: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Status da última cobrança da assinatura → 'paid' | 'pending' | 'failed' | null.
   * Fonte de verdade do polling e da revalidação do webhook.
   */
  async getLatestChargeStatus(subscriptionId: string): Promise<'paid' | 'pending' | 'failed' | null> {
    const invoices = await this.listSubscriptionInvoices(subscriptionId, 1);
    return invoices?.[0]?.status ?? null;
  }

  private mapStatus(s?: string): 'paid' | 'pending' | 'failed' | null {
    if (!s) return null;
    if (s === 'paid' || s === 'overpaid') return 'paid';
    if (['failed', 'canceled', 'chargedback', 'refunded'].includes(s)) return 'failed';
    return 'pending';
  }

  /**
   * Extrai do corpo do webhook Pagar.me o subscription_id + code. Cobre os eventos de
   * fatura (invoice.*: data.subscription_id), de cobrança (charge.*: data.invoice.subscription_id)
   * e de assinatura (subscription.*: data.id).
   * Não confia no corpo p/ liberar acesso — o billing revalida pelas faturas da assinatura.
   */
  parseWebhook(body: any): { subscriptionId?: string; code?: string; type?: string } {
    const type: string | undefined = body?.type;
    const data = body?.data ?? {};
    const subscriptionId =
      data?.subscription_id ??
      data?.subscription?.id ??
      data?.invoice?.subscription_id ??
      data?.invoice?.subscription?.id ??
      (type?.startsWith('subscription.') ? data?.id : undefined);
    const code = data?.code ?? data?.subscription?.code;
    return { subscriptionId, code, type };
  }
}
