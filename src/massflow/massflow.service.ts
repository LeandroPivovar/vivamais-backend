import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppConfig } from '../admin/entities/config.entity';
import { onlyDigits } from '../common/phone';

/**
 * Webhooks do MassFlow (automação de WhatsApp). Duas esteiras:
 *  - eventos -> venda, renovação e os mesmos avisos que vão para o grupo de WhatsApp
 *    (reembolso/cancelamento, saque, chamados, erros, relatório diário). O MassFlow
 *    separa pelo campo `evento`.
 *  - carrinho abandonado (pendente há 5 min) -> esteira própria.
 *
 * URLs: o painel do Admin (Configurações → MassFlow) é a fonte principal; o .env
 * (MASSFLOW_WEBHOOK_PURCHASE / MASSFLOW_WEBHOOK_CART) continua valendo como fallback.
 * As URLs carregam token no path, por isso nunca vão para o repo nem saem do servidor.
 * Sem URL nenhuma o serviço vira no-op — dev/local roda sem disparar nada.
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

export type MassflowTarget = 'eventos' | 'carrinho';

export type MassflowSendResult = {
  ok: boolean;
  status: number | null;
  /** De onde veio a URL usada — ajuda o admin a saber se o painel está valendo. */
  source: 'painel' | 'env' | null;
  response?: string;
  error?: string;
};

type MassflowUrls = {
  events: string;
  eventsSource: 'painel' | 'env' | null;
  cart: string;
  cartSource: 'painel' | 'env' | null;
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

/** host + 4 últimos caracteres — o suficiente para o admin reconhecer a URL sem expor o token. */
export function maskWebhookUrl(url: string | null | undefined): string | null {
  const u = (url ?? '').trim();
  if (!u) return null;
  let host = '';
  try {
    host = new URL(u).host;
  } catch {
    host = '';
  }
  return `${host ? `https://${host}/` : ''}…${u.slice(-4)}`;
}

@Injectable()
export class MassflowService {
  private readonly logger = new Logger(MassflowService.name);

  constructor(@InjectRepository(AppConfig) private readonly configRepo: Repository<AppConfig>) {}

  /**
   * URLs do painel, caindo para o .env quando o campo está vazio. Se o banco estiver
   * fora do ar, o .env ainda responde — o aviso nunca pode derrubar o pagamento.
   */
  async urls(): Promise<MassflowUrls> {
    let config: AppConfig | null = null;
    try {
      config = await this.configRepo.findOne({ where: {} });
    } catch (err) {
      this.logger.warn(`Não foi possível ler a config do MassFlow no banco: ${(err as Error).message}`);
    }
    const pick = (panel: string | null | undefined, env: string | undefined) => {
      const p = (panel ?? '').trim();
      if (p) return { url: p, source: 'painel' as const };
      const e = env?.trim() ?? '';
      return { url: e, source: e ? ('env' as const) : null };
    };
    const events = pick(config?.massflowWebhookUrl, process.env.MASSFLOW_WEBHOOK_PURCHASE);
    const cart = pick(config?.massflowCartWebhookUrl, process.env.MASSFLOW_WEBHOOK_CART);
    return { events: events.url, eventsSource: events.source, cart: cart.url, cartSource: cart.source };
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

  private async send(
    url: string,
    source: MassflowSendResult['source'],
    label: string,
    body: Record<string, unknown>,
  ): Promise<MassflowSendResult> {
    if (!url) {
      this.logger.warn(`MassFlow ${label} não configurado (painel e env vazios) — payload descartado.`);
      return { ok: false, status: null, source: null, error: 'Webhook não configurado.' };
    }
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      const text = await res.text().catch(() => '');
      if (!res.ok) {
        this.logger.warn(`MassFlow ${label} respondeu ${res.status}: ${text.slice(0, 200)}`);
        return { ok: false, status: res.status, source, response: text.slice(0, 500) };
      }
      this.logger.log(`MassFlow ${label} enviado (${body.evento}${body.email ? `: ${body.email}` : ''}).`);
      return { ok: true, status: res.status, source, response: text.slice(0, 500) };
    } catch (err) {
      this.logger.warn(`MassFlow ${label} falhou: ${(err as Error).message}`);
      return { ok: false, status: null, source, error: (err as Error).message };
    }
  }

  private async sendEvent(body: Record<string, unknown>): Promise<boolean> {
    const { events, eventsSource } = await this.urls();
    return (await this.send(events, eventsSource, 'eventos', body)).ok;
  }

  /** Pagamento processado — dispara a esteira de compra. */
  async notifyPurchase(lead: MassflowLead): Promise<boolean> {
    return this.sendEvent({
      evento: 'compra_concluida',
      ...this.basePayload(lead),
      metodoPagamento: lead.paymentMethod ?? null,
      data: new Date().toISOString(),
    });
  }

  /** Cobrança mensal seguinte paga (Pix Automático ou cartão). */
  async notifyRenewal(lead: MassflowLead): Promise<boolean> {
    return this.sendEvent({
      evento: 'renovacao_confirmada',
      ...this.basePayload(lead),
      metodoPagamento: lead.paymentMethod ?? null,
      data: new Date().toISOString(),
    });
  }

  /**
   * Os demais avisos que também vão para o grupo de WhatsApp (reembolso, saque,
   * chamados, erros, relatório). `mensagem` é o mesmo texto enviado no grupo.
   */
  async notifyEvent(evento: string, mensagem: string, dados: Record<string, unknown> = {}): Promise<boolean> {
    return this.sendEvent({ evento, mensagem, ...dados, data: new Date().toISOString() });
  }

  /** Cobrança parada há 5 min sem pagamento — dispara a esteira de carrinho. */
  async notifyAbandonedCart(lead: MassflowLead & { minutesPending: number; checkoutUrl: string }): Promise<boolean> {
    const { cart, cartSource } = await this.urls();
    const res = await this.send(cart, cartSource, 'carrinho', {
      evento: 'carrinho_abandonado',
      ...this.basePayload(lead),
      metodoPagamento: lead.paymentMethod ?? null,
      minutosPendente: lead.minutesPending,
      linkPagamento: lead.checkoutUrl,
      data: new Date().toISOString(),
    });
    return res.ok;
  }

  /**
   * Evento de teste disparado pelo painel. `teste: true` permite filtrar no MassFlow;
   * o telefone é opcional — preenchido, a automação pode mandar mensagem de verdade.
   */
  async sendTest(target: MassflowTarget, contact: { name?: string; phone?: string; email?: string }) {
    const urls = await this.urls();
    const url = target === 'carrinho' ? urls.cart : urls.events;
    const source = target === 'carrinho' ? urls.cartSource : urls.eventsSource;
    const name = contact.name?.trim() || 'Teste Viva Mais';
    return this.send(url, source, `teste ${target}`, {
      evento: target === 'carrinho' ? 'carrinho_abandonado' : 'teste',
      teste: true,
      nome: name,
      primeiroNome: name.split(/\s+/)[0],
      telefone: whatsappPhone(contact.phone),
      email: contact.email?.trim() || 'teste@vivamaisclub.com',
      plano: 'Individual',
      valor: 79.9,
      valorFormatado: money(79.9),
      transacaoId: null,
      metodoPagamento: 'Teste',
      mensagem: 'Evento de teste enviado pelo painel do Viva Mais Club.',
      data: new Date().toISOString(),
    });
  }
}
