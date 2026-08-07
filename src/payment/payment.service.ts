import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppConfig } from '../admin/entities/config.entity';

/**
 * Integração com o gateway de pagamento Veenca.
 * Docs: https://app.veenca.com/docs  (base https://app.veenca.com/api/v1)
 * Auth: headers x-public-key / x-secret-key (configurados pelo Admin, salvos em AppConfig).
 *
 * Fica inerte enquanto veencaPayEnabled != true ou faltar chave — assim o checkout
 * simulado atual segue funcionando até o Admin ligar com chaves reais.
 *
 * Opção A (escolhida): coletamos cartão e enviamos direto à API (POST /card/subscription).
 * ⚠️ Dado de cartão trafega pelo nosso backend (só encaminhado, nunca persistido) — escopo PCI.
 */

const VEENCA_BASE = 'https://app.veenca.com/api/v1/gateway';

/** Status de transação da Veenca (enum da doc). */
export type VeencaTxStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED' | 'CHARGED_BACK';

export interface CardData {
  number: string;
  owner: string;
  expiresAt: string; // como o usuário digitou (MM/AA); convertido para YYYY-MM aqui
  cvv: string;
}

export interface ClientAddress {
  zipCode?: string | null;
  street?: string | null; // logradouro + número combinados (nosso campo `address`)
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  complement?: string | null;
}

export interface SubscriptionInput {
  identifier: string; // idempotente, gerado por nós; volta como clientIdentifier
  amount: number; // em REAIS (ex.: 79.9) — a doc pede o valor final da venda em reais
  planName: string;
  planId: string;
  client: { name: string; email: string; phone: string; document: string };
  address?: ClientAddress; // endereço do cliente — exigido pela Veenca na cobrança
  callbackUrl: string;
  clientIp?: string;
  dueDate?: string; // YYYY-MM-DD — vencimento da cobrança PIX (opcional, ver doc)
  card?: CardData; // presente => cobrança em cartão; ausente => PIX
}

/** Monta o objeto address da Veenca a partir do nosso endereço (rua+número num campo só). */
export function buildVeencaAddress(a?: ClientAddress): Record<string, string> | undefined {
  if (!a || !(a.street || a.zipCode || a.city)) return undefined;
  const raw = (a.street ?? '').trim();
  const numMatch = raw.match(/(\d+)\s*$/);
  const number = numMatch ? numMatch[1] : 'S/N';
  const street = numMatch ? raw.slice(0, numMatch.index).replace(/[,\s]+$/, '').trim() : raw;
  const digits = (v?: string | null) => (v ?? '').replace(/\D/g, '');
  return {
    country: 'BR',
    zipCode: digits(a.zipCode),
    state: a.state ?? '',
    city: a.city ?? '',
    neighborhood: a.neighborhood ?? '',
    street: street || raw,
    number,
    complement: a.complement ?? '',
  };
}

/** A Veenca exige a validade do cartão em YYYY-MM; o formulário coleta MM/AA. */
export function toVeencaExpiry(raw: string): string {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length < 4) return raw;
  const month = digits.slice(0, 2);
  const rest = digits.slice(2);
  const year = rest.length === 2 ? `20${rest}` : rest.slice(0, 4);
  return `${year}-${month}`;
}

export interface SubscriptionResult {
  ok: boolean;
  transactionId?: string;
  subscriptionId?: string;
  status?: string;
  pixCode?: string; // copia-e-cola (só PIX)
  pixImage?: string;
  error?: string;
}

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(@InjectRepository(AppConfig) private configRepo: Repository<AppConfig>) {}

  private async getConfig(): Promise<AppConfig | null> {
    return this.configRepo.findOne({ where: {} });
  }

  async isEnabled(): Promise<boolean> {
    const c = await this.getConfig();
    return !!(c && c.veencaPayEnabled && c.veencaPublicKey && c.veencaSecretKey);
  }

  private headers(cfg: AppConfig): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-public-key': cfg.veencaPublicKey ?? '',
      'x-secret-key': cfg.veencaSecretKey ?? '',
    };
  }

  /**
   * Cria assinatura recorrente na Veenca. Rota depende do método:
   *  - cartão presente  -> POST /card/subscription
   *  - sem cartão (PIX) -> POST /pix/subscription
   */
  async createSubscription(input: SubscriptionInput): Promise<SubscriptionResult> {
    const cfg = await this.getConfig();
    if (!cfg || !cfg.veencaPayEnabled || !cfg.veencaPublicKey || !cfg.veencaSecretKey) {
      return { ok: false, error: 'gateway_disabled' };
    }

    const isCard = !!input.card;
    const url = `${VEENCA_BASE}/${isCard ? 'card' : 'pix'}/subscription`;

    // O schema da Veenca (pix/card subscription) não tem campo de endereço — só
    // client{name,email,phone,document}. Não enviamos address.
    // ID do produto na Veenca por plano (PIX recorrente). Cai no slug só se não configurado.
    const productId =
      (input.planName === 'Família' ? cfg.veencaProductFamily : cfg.veencaProductIndividual) ||
      input.planId;

    const body: Record<string, unknown> = {
      identifier: input.identifier,
      amount: input.amount,
      product: { id: productId, name: input.planName, price: input.amount },
      subscription: {
        periodicityType: cfg.veencaPeriodicityType || 'MONTHS',
        periodicity: 1,
        firstChargeIn: 0,
      },
      client: input.client,
      ...(input.dueDate ? { dueDate: input.dueDate } : {}),
      callbackUrl: input.callbackUrl,
    };
    if (isCard) {
      body.clientIp = input.clientIp ?? '0.0.0.0';
      body.card = {
        number: input.card!.number,
        owner: input.card!.owner,
        expiresAt: toVeencaExpiry(input.card!.expiresAt),
        cvv: input.card!.cvv,
      };
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: this.headers(cfg),
        body: JSON.stringify(body),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        this.logger.error(`Veenca ${isCard ? 'card' : 'pix'} subscription falhou: HTTP ${res.status} — ${JSON.stringify(data)}`);
        return { ok: false, error: data?.message || `HTTP ${res.status}` };
      }
      return {
        ok: true,
        transactionId: data?.transactionId,
        subscriptionId: data?.subscription?.id,
        status: data?.status,
        pixCode: data?.pix?.code,
        pixImage: data?.pix?.image ?? data?.pix?.base64,
      };
    } catch (err) {
      this.logger.error(`Erro ao chamar Veenca: ${(err as Error).message}`);
      return { ok: false, error: (err as Error).message };
    }
  }

  /**
   * Busca a transação na Veenca (GET /gateway/transactions?id=).
   *
   * É a fonte de verdade do status: o corpo do webhook chega por uma rota pública e
   * não é confiável, então quem decide se algo foi pago é esta consulta autenticada.
   */
  async getTransaction(
    id: string,
  ): Promise<{
    id: string;
    clientIdentifier?: string;
    subscriptionId?: string;
    status: VeencaTxStatus;
    amount?: number;
  } | null> {
    const cfg = await this.getConfig();
    if (!cfg?.veencaPublicKey || !cfg?.veencaSecretKey) return null;

    try {
      const res = await fetch(`${VEENCA_BASE}/transactions?id=${encodeURIComponent(id)}`, {
        headers: this.headers(cfg),
      });
      if (!res.ok) {
        this.logger.warn(`Consulta de transação ${id} falhou: HTTP ${res.status}`);
        return null;
      }
      const data: any = await res.json().catch(() => null);
      // A rota é de busca: pode devolver o objeto direto ou uma lista.
      const tx = Array.isArray(data) ? data[0] : (data?.data ?? data);
      if (!tx?.status) return null;
      return {
        id: tx.id ?? id,
        clientIdentifier: tx.clientIdentifier,
        subscriptionId: tx.subscriptionId ?? tx.subscription?.id ?? tx.subscription,
        status: tx.status,
        amount: tx.amount,
      };
    } catch (err) {
      this.logger.error(`Erro ao consultar transação ${id}: ${(err as Error).message}`);
      return null;
    }
  }
}
