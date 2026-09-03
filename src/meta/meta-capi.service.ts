import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { AppConfig } from '../admin/entities/config.entity';
import { onlyDigits } from '../common/phone';
import { publicUrl } from '../common/public-url';

/**
 * Meta Conversions API (server-side). Complementa o pixel do navegador: o PIX
 * confirma via webhook, quando o cliente já fechou a aba, então o servidor é
 * quem garante que a venda é reportada.
 *
 * Os dois lados mandam o MESMO event_id — a Meta usa isso para deduplicar e não
 * contar a venda em dobro.
 *
 * Credenciais: o painel do Admin (Configurações → Meta) é a fonte principal. As
 * variáveis de ambiente abaixo continuam valendo como fallback para quem já as
 * configurou antes de existir a tela:
 *   META_PIXEL_ID=...
 *   META_CAPI_TOKEN=...
 *   META_TEST_EVENT_CODE=...  (opcional, para o Test Events do Gerenciador)
 */

const GRAPH_VERSION = 'v21.0';

export type PurchaseEvent = {
  transactionId: number;
  value: number;
  planName: string;
  email: string;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
};

/** A Meta exige os dados pessoais normalizados e em SHA-256. */
function hash(value: string | null | undefined): string | undefined {
  const v = (value ?? '').trim().toLowerCase();
  if (!v) return undefined;
  return createHash('sha256').update(v).digest('hex');
}

type MetaSettings = {
  enabled: boolean;
  pixelId: string;
  token: string;
  testEventCode: string;
};

@Injectable()
export class MetaCapiService {
  private readonly logger = new Logger(MetaCapiService.name);

  constructor(@InjectRepository(AppConfig) private readonly configRepo: Repository<AppConfig>) {}

  /**
   * Credenciais do painel, caindo para o .env quando o campo está vazio. Se o banco
   * estiver fora do ar por algum motivo, o .env ainda responde — reportar a venda
   * nunca pode derrubar a confirmação do pagamento.
   */
  private async settings(): Promise<MetaSettings> {
    let config: AppConfig | null = null;
    try {
      config = await this.configRepo.findOne({ where: {} });
    } catch (err) {
      this.logger.warn(`Não foi possível ler a config da Meta no banco: ${(err as Error).message}`);
    }
    const pixelId = (config?.metaPixelId ?? '').trim() || (process.env.META_PIXEL_ID?.trim() ?? '');
    const token = (config?.metaCapiToken ?? '').trim() || (process.env.META_CAPI_TOKEN?.trim() ?? '');
    const testEventCode =
      (config?.metaTestEventCode ?? '').trim() || (process.env.META_TEST_EVENT_CODE?.trim() ?? '');
    // Sem linha de config (base nova), o .env sozinho já liga a integração.
    const toggle = config ? config.metaCapiEnabled : true;
    return { enabled: !!(toggle && pixelId && token), pixelId, token, testEventCode };
  }

  async isEnabled(): Promise<boolean> {
    return (await this.settings()).enabled;
  }

  /** Mesmo id usado pelo pixel no navegador — é o que permite a deduplicação. */
  eventId(transactionId: number): string {
    return `vm-purchase-${transactionId}`;
  }

  async trackPurchase(ev: PurchaseEvent): Promise<boolean> {
    const { enabled, pixelId, token, testEventCode } = await this.settings();
    if (!enabled) {
      this.logger.warn(
        'Meta CAPI desligado (configure o pixel e o token em Admin → Configurações → Meta).',
      );
      return false;
    }

    // Telefone precisa de DDI para casar com o cadastro do usuário na Meta.
    const phoneDigits = onlyDigits(ev.phone);
    const phone = phoneDigits ? (phoneDigits.startsWith('55') ? phoneDigits : `55${phoneDigits}`) : null;

    const userData: Record<string, unknown> = {
      em: hash(ev.email),
      ph: hash(phone),
      fn: hash(ev.firstName),
      ln: hash(ev.lastName),
      ct: hash(ev.city),
      st: hash(ev.state),
      zp: hash(onlyDigits(ev.zipCode)),
      country: hash('br'),
    };
    Object.keys(userData).forEach((k) => userData[k] === undefined && delete userData[k]);

    const body: Record<string, unknown> = {
      data: [
        {
          event_name: 'Purchase',
          event_time: Math.floor(Date.now() / 1000),
          event_id: this.eventId(ev.transactionId),
          action_source: 'website',
          event_source_url: publicUrl('/'),
          user_data: userData,
          custom_data: {
            currency: 'BRL',
            value: Number(Number(ev.value).toFixed(2)),
            content_name: `Plano ${ev.planName}`,
            content_type: 'product',
          },
        },
      ],
    };
    if (testEventCode) body.test_event_code = testEventCode;

    try {
      const res = await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/${pixelId}/events?access_token=${encodeURIComponent(token)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      );
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        this.logger.warn(`Meta CAPI Purchase falhou (${res.status}): ${data?.error?.message ?? ''}`);
        return false;
      }
      this.logger.log(
        `Meta CAPI Purchase enviado (tx ${ev.transactionId}, ${ev.planName}) — recebidos: ${data?.events_received ?? '?'}.`,
      );
      return true;
    } catch (err) {
      this.logger.warn(`Meta CAPI indisponível: ${(err as Error).message}`);
      return false;
    }
  }
}
