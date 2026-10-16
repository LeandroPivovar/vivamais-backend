import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { AppConfig } from '../admin/entities/config.entity';
import { onlyDigits } from '../common/phone';
import { publicUrl } from '../common/public-url';

// TikTok Events API; legacy class name retained for existing billing injection.
const EVENTS_URL = 'https://business-api.tiktok.com/open_api/v1.3/event/track/';

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

/** O TikTok exige os dados pessoais normalizados e em SHA-256. */
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
      this.logger.warn(`Não foi possível ler a config do TikTok no banco: ${(err as Error).message}`);
    }
    const pixelId = (config?.tiktokPixelId ?? '').trim() || (process.env.TIKTOK_PIXEL_ID?.trim() ?? '');
    const token = (config?.tiktokEventsToken ?? '').trim() || (process.env.TIKTOK_EVENTS_TOKEN?.trim() ?? '');
    const testEventCode =
      (config?.tiktokTestEventCode ?? '').trim() || (process.env.TIKTOK_TEST_EVENT_CODE?.trim() ?? '');
    // Sem linha de config (base nova), o .env sozinho já liga a integração.
    const toggle = config ? config.tiktokEventsEnabled : true;
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
    return this.trackEvent(ev, 'Purchase', this.eventId(ev.transactionId));
  }

  async trackAbandonedCart(ev: PurchaseEvent): Promise<boolean> {
    return this.trackEvent(ev, 'AbandonedCart', `vm-abandoned-cart-${ev.transactionId}`);
  }

  private async trackEvent(ev: PurchaseEvent, event: 'Purchase' | 'AbandonedCart', eventId: string): Promise<boolean> {
    const { enabled, pixelId, token, testEventCode } = await this.settings();
    if (!enabled) {
      this.logger.warn(
        'TikTok Events API desligado (configure o pixel e o token em Admin → Configurações → TikTok).',
      );
      return false;
    }

    // Telefone precisa de DDI para casar com o cadastro do usuário no TikTok.
    const phoneDigits = onlyDigits(ev.phone);
    const phone = phoneDigits ? (phoneDigits.startsWith('55') ? phoneDigits : `55${phoneDigits}`) : null;

    const user: Record<string, unknown> = { email: hash(ev.email), phone: hash(phone) };
    Object.keys(user).forEach(k => user[k] === undefined && delete user[k]);
    const body: Record<string, unknown> = {
      event_source: 'web', event_source_id: pixelId,
      data: [{
        event, event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,
        user, page: { url: publicUrl('/') },
        properties: { currency: 'BRL', value: Number(Number(ev.value).toFixed(2)),
          contents: [{ content_id: ev.planName, content_name: 'Plano ' + ev.planName, content_type: 'product', quantity: 1 }] }
      }]
    };
    if (testEventCode) body.test_event_code = testEventCode;

    try {
      const res = await fetch(EVENTS_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Access-Token': token },
        body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok || data.code !== 0) {
        this.logger.warn(`TikTok Events API ${event} falhou (${res.status}): ${data?.message ?? ''}`);
        return false;
      }
      this.logger.log(
        `TikTok Events API ${event} enviado (tx ${ev.transactionId}, ${ev.planName}) — recebidos: ${data?.code === 0 ? 'OK' : 'erro'}.`,
      );
      return true;
    } catch (err) {
      this.logger.warn(`TikTok Events API indisponível: ${(err as Error).message}`);
      return false;
    }
  }
}
