import { Injectable, Logger } from '@nestjs/common';
import { onlyDigits } from '../common/phone';

/**
 * Webhooks do MassFlow (automação de WhatsApp). Duas esteiras:
 *  - compra concluída  -> MASSFLOW_WEBHOOK_PURCHASE
 *  - carrinho abandonado (pendente há 5 min) -> MASSFLOW_WEBHOOK_CART
 *
 * As URLs carregam token no path, por isso ficam em env (nunca no repo). Sem a
 * env configurada o serviço vira no-op — dev/local roda sem disparar nada.
 */

export type MassflowLead = {
  name: string;
  phone?: string | null;
  email: string;
  plan: string;
  value?: number | null;
  transactionId?: number | null;
  paymentMethod?: string | null;
};

/** WhatsApp precisa do DDI: 11 dígitos viram 55 + DDD + número. */
function whatsappPhone(raw: string | null | undefined): string {
  const d = onlyDigits(raw);
  if (!d) return '';
  if (d.startsWith('55') && d.length >= 12) return d;
  return `55${d}`;
}

function money(value?: number | null): string {
  return `R$ ${Number(value ?? 0).toFixed(2).replace('.', ',')}`;
}

@Injectable()
export class MassflowService {
  private readonly logger = new Logger(MassflowService.name);

  private get purchaseUrl(): string {
    return process.env.MASSFLOW_WEBHOOK_PURCHASE?.trim() ?? '';
  }

  private get cartUrl(): string {
    return process.env.MASSFLOW_WEBHOOK_CART?.trim() ?? '';
  }

  private basePayload(lead: MassflowLead) {
    return {
      nome: lead.name,
      primeiroNome: (lead.name ?? '').trim().split(/\s+/)[0] ?? '',
      telefone: whatsappPhone(lead.phone),
      email: lead.email,
      plano: lead.plan,
      valor: lead.value != null ? Number(Number(lead.value).toFixed(2)) : null,
      valorFormatado: money(lead.value),
      transacaoId: lead.transactionId ?? null,
    };
  }

  private async post(url: string, label: string, body: Record<string, unknown>): Promise<boolean> {
    if (!url) {
      this.logger.warn(`MassFlow ${label} não configurado (env ausente) — payload descartado.`);
      return false;
    }
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        this.logger.warn(`MassFlow ${label} respondeu ${res.status}: ${text.slice(0, 200)}`);
        return false;
      }
      this.logger.log(`MassFlow ${label} enviado: ${body.email} (${body.plano}).`);
      return true;
    } catch (err) {
      this.logger.warn(`MassFlow ${label} falhou: ${(err as Error).message}`);
      return false;
    }
  }

  /** Pagamento processado — dispara a esteira de compra. */
  async notifyPurchase(lead: MassflowLead): Promise<boolean> {
    return this.post(this.purchaseUrl, 'compra', {
      evento: 'compra_concluida',
      ...this.basePayload(lead),
      metodoPagamento: lead.paymentMethod ?? null,
      data: new Date().toISOString(),
    });
  }

  /** Cobrança parada há 5 min sem pagamento — dispara a esteira de carrinho. */
  async notifyAbandonedCart(lead: MassflowLead & { minutesPending: number; checkoutUrl: string }): Promise<boolean> {
    return this.post(this.cartUrl, 'carrinho', {
      evento: 'carrinho_abandonado',
      ...this.basePayload(lead),
      metodoPagamento: lead.paymentMethod ?? null,
      minutosPendente: lead.minutesPending,
      linkPagamento: lead.checkoutUrl,
      data: new Date().toISOString(),
    });
  }
}
