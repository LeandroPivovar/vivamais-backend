import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppConfig } from '../admin/entities/config.entity';

/**
 * Integração com a Woovi/OpenPix — Pix Automático (débito automático do Banco Central).
 * Docs: https://developers.woovi.com/api
 *
 * Diferença crucial vs Veenca: aqui recebemos o `pixRecurring.emv` — o QR de
 * AUTORIZAÇÃO da recorrência (`/qr/v2/rec/...`). O cliente escaneia uma vez, autoriza
 * no app do banco e a mensalidade é debitada automaticamente. A Veenca só devolvia o
 * QR de cobrança única (`/qr/v2/cob/...`), por isso não dava auto-débito.
 *
 * Auth: header `Authorization: <AppID>` (valor bruto, sem "Bearer"). Fica inerte
 * enquanto wooviEnabled != true ou faltar AppID.
 */

const PROD_BASE = 'https://api.woovi.com/api/v1';
const SANDBOX_BASE = 'https://api.woovi-sandbox.com/api/v1';
const PUBLIC_URL = process.env.PUBLIC_URL ?? 'https://conta.vivamaisclub.net';
const WEBHOOK_URL = `${PUBLIC_URL}/api/billing/webhook/woovi`;
// Eventos do Pix Automático que precisamos escutar.
const WEBHOOK_EVENTS = [
  'PIX_AUTOMATIC_COBR_COMPLETED',
  'PIX_AUTOMATIC_APPROVED',
  'PIX_AUTOMATIC_REJECTED',
  'PIX_AUTOMATIC_COBR_REJECTED',
];

/** Status da assinatura Pix Automático (pixRecurring.status). */
export type WooviPixRecStatus = 'CREATED' | 'APPROVED' | 'CANCELED' | 'EXPIRED' | 'REJECTED';

export interface WooviSubscriptionInput {
  correlationID: string; // idempotente, gerado por nós; volta em todos os eventos
  amountCents: number; // valor em CENTAVOS (ex.: 7990)
  planName: string;
  client: { name: string; email: string; phone: string; taxID: string };
  /** Dia do mês (1-28) em que as cobranças recorrentes são geradas. */
  dayGenerateCharge?: number;
}

export interface WooviSubscriptionResult {
  ok: boolean;
  subscriptionId?: string; // globalID
  emv?: string; // QR copia-e-cola de AUTORIZAÇÃO da recorrência (pixRecurring.emv)
  recurrencyId?: string;
  pixRecStatus?: string; // CREATED até o cliente autorizar
  paymentLinkUrl?: string;
  error?: string;
}

@Injectable()
export class WooviService {
  private readonly logger = new Logger(WooviService.name);
  private webhookEnsured = false;

  constructor(@InjectRepository(AppConfig) private configRepo: Repository<AppConfig>) {}

  /**
   * Garante (uma vez por processo) que os webhooks do Pix Automático estão registrados
   * na Woovi apontando para a nossa rota. Idempotente: não duplica os que já existem.
   * Best-effort — nunca derruba o fluxo de cobrança se falhar.
   */
  async ensureWebhook(cfg: AppConfig): Promise<void> {
    if (this.webhookEnsured) return;
    try {
      const listRes = await fetch(`${this.baseUrl(cfg)}/webhook?limit=100`, { headers: this.headers(cfg) });
      const listData: any = listRes.ok ? await listRes.json().catch(() => ({})) : {};
      const existing: any[] = listData?.webhooks ?? [];
      const already = new Set(
        existing.filter((w) => w?.url === WEBHOOK_URL && w?.event).map((w) => w.event),
      );
      for (const event of WEBHOOK_EVENTS) {
        if (already.has(event)) continue;
        const res = await fetch(`${this.baseUrl(cfg)}/webhook`, {
          method: 'POST',
          headers: this.headers(cfg),
          body: JSON.stringify({
            webhook: { name: `VivaMais ${event}`, event, url: WEBHOOK_URL, isActive: true },
          }),
        });
        if (!res.ok) {
          const d: any = await res.json().catch(() => ({}));
          this.logger.warn(`Registrar webhook Woovi ${event} falhou: ${d?.errors?.[0]?.message || res.status}`);
        } else {
          this.logger.log(`Webhook Woovi registrado: ${event} -> ${WEBHOOK_URL}`);
        }
      }
      this.webhookEnsured = true;
    } catch (err) {
      this.logger.warn(`ensureWebhook Woovi falhou: ${(err as Error).message}`);
    }
  }

  private async getConfig(): Promise<AppConfig | null> {
    return this.configRepo.findOne({ where: {} });
  }

  async isEnabled(): Promise<boolean> {
    const c = await this.getConfig();
    return !!(c && c.wooviEnabled && c.wooviAppId);
  }

  private baseUrl(cfg: AppConfig): string {
    return cfg.wooviSandbox ? SANDBOX_BASE : PROD_BASE;
  }

  private headers(cfg: AppConfig): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: cfg.wooviAppId ?? '',
    };
  }

  /**
   * Cria uma assinatura Pix Automático (type: PIX_RECURRING) e devolve o QR de
   * autorização (pixRecurring.emv). journey PAYMENT_ON_APPROVAL: a 1ª cobrança
   * ocorre assim que o cliente autoriza a recorrência no banco.
   */
  async createPixAutomaticSubscription(input: WooviSubscriptionInput): Promise<WooviSubscriptionResult> {
    const cfg = await this.getConfig();
    if (!cfg || !cfg.wooviEnabled || !cfg.wooviAppId) {
      return { ok: false, error: 'woovi_disabled' };
    }

    // Registra os webhooks na 1ª cobrança (antes de criar a assinatura), idempotente.
    await this.ensureWebhook(cfg);

    const body = {
      type: 'PIX_RECURRING',
      value: input.amountCents,
      correlationID: input.correlationID,
      name: `Viva Mais - ${input.planName}`,
      frequency: 'MONTHLY',
      dayGenerateCharge: input.dayGenerateCharge ?? 5,
      dayDue: 7,
      customer: {
        name: input.client.name,
        email: input.client.email,
        phone: input.client.phone,
        taxID: input.client.taxID,
      },
      pixRecurringOptions: {
        journey: 'PAYMENT_ON_APPROVAL',
        retryPolicy: 'THREE_RETRIES_7_DAYS',
      },
    };

    try {
      const res = await fetch(`${this.baseUrl(cfg)}/subscriptions`, {
        method: 'POST',
        headers: this.headers(cfg),
        body: JSON.stringify(body),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data?.errors?.[0]?.message || data?.error || `HTTP ${res.status}`;
        this.logger.error(`Woovi criar assinatura falhou: ${msg} — ${JSON.stringify(data)?.slice(0, 400)}`);
        return { ok: false, error: msg };
      }
      const sub = data?.subscription ?? data;
      // O emv de recorrência vem em pixRecurring (resposta ao vivo) ou pixRecurringOptions (spec).
      const pixRec = sub?.pixRecurring ?? sub?.pixRecurringOptions ?? {};
      return {
        ok: true,
        subscriptionId: sub?.globalID,
        emv: pixRec?.emv,
        recurrencyId: pixRec?.recurrencyId,
        pixRecStatus: pixRec?.status,
        paymentLinkUrl: sub?.paymentLinkUrl,
      };
    } catch (err) {
      this.logger.error(`Erro ao chamar Woovi: ${(err as Error).message}`);
      return { ok: false, error: (err as Error).message };
    }
  }

  /**
   * Consulta a assinatura pelo nosso correlationID — fonte de verdade do status
   * (usada pela reconciliação e pela revalidação do webhook). Devolve o estado da
   * recorrência (pixRecurring.status) e da assinatura.
   */
  async getSubscriptionByCorrelation(correlationID: string): Promise<{
    subscriptionId?: string;
    subStatus?: string;
    pixRecStatus?: string;
    installmentsCount?: number | null;
  } | null> {
    const cfg = await this.getConfig();
    if (!cfg?.wooviEnabled || !cfg?.wooviAppId) return null;
    try {
      const url = `${this.baseUrl(cfg)}/subscriptions?correlationID=${encodeURIComponent(correlationID)}`;
      const res = await fetch(url, { headers: this.headers(cfg) });
      if (!res.ok) {
        this.logger.warn(`Consulta assinatura Woovi ${correlationID} falhou: HTTP ${res.status}`);
        return null;
      }
      const data: any = await res.json().catch(() => null);
      const sub = Array.isArray(data?.subscriptions) ? data.subscriptions[0] : (data?.subscription ?? null);
      if (!sub) return null;
      const pixRec = sub.pixRecurring ?? sub.pixRecurringOptions ?? {};
      return {
        subscriptionId: sub.globalID,
        subStatus: sub.status,
        pixRecStatus: pixRec.status,
        installmentsCount: sub.installmentsCount ?? null,
      };
    } catch (err) {
      this.logger.error(`Erro ao consultar assinatura Woovi ${correlationID}: ${(err as Error).message}`);
      return null;
    }
  }
}
